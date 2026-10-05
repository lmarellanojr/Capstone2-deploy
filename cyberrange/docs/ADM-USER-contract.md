# ADM-USER User & Role Management Contract

**Audience:** Maricar Punzalan (Admin UI, `portal/src/app/admin/users`)
**Author / backend owner:** Lenie Joice Mendoza
**Review partner:** Shekinah Jabez Florentino (authorization boundaries, disabled-user behavior, role refresh, regression evidence; no self-approval)
**Issue:** [#32](https://github.com/lmarellanojr/Capstone2-deploy/issues/32). Depends on AUTH-02, AUTH-03 [#30](https://github.com/lmarellanojr/Capstone2-deploy/issues/30), ADM-UI [#31](https://github.com/lmarellanojr/Capstone2-deploy/issues/31)
**Source of truth:** `src/provisioning/users_router.py`, `src/provisioning/keycloak_admin.py`, `src/provisioning/test_admin_users.py`

---

## 1. Scope

Admin-only, server-side Keycloak operations on the `cyber-range` realm:

- list users with their application role and enabled state
- create a test user with exactly one role
- enable / disable a user
- replace a user's application role
- reset another user's password (added after #32; see §2)
- reset another user's authenticator after a lost phone (SEC-03 MFA; see §2)

**Not provided, by design:**

- **No public signup.** There is no unauthenticated or self-service route that creates users. The setup script also forces `registrationAllowed=false` on the realm.
- No delete-user route. Disable is the supported off-switch, which keeps `student_id` history (pods, milestones, `review_cases`) attached to a real account.
- No last-login time. Keycloak's user API doesn't return it; it would need event storage, which is out of scope.

Roles are exactly `student`, `instructor` and `admin`: realm roles, per the AUTH-03 contract. Keycloak-internal roles (`default-roles-cyber-range`, `offline_access`, `uma_authorization`) are never shown, assigned or removed.

---

## 2. Routes (FastAPI, `http://10.115.77.1:5000`)

All five routes use `verify_token` followed by `require_role(["admin"])`.

| Method | Path | Body | Success |
|---|---|---|---|
| `GET` | `/admin/users?search=&first=0&max=100` | none | **200** `{ "users": [User, ...] }` |
| `POST` | `/admin/users` | `CreateUser` | **201** `User` |
| `PATCH` | `/admin/users/{id}/enabled` | `{ "enabled": bool }` | **200** `User` |
| `PUT` | `/admin/users/{id}/role` | `{ "role": "student" \| "instructor" \| "admin" }` | **200** `User` |
| `PUT` | `/admin/users/{id}/password` | `{ "password": "<8-128 chars>", "temporary": true }` | **200** `User` |
| `DELETE` | `/admin/users/{id}/mfa` | none | **200** `User` |

`{id}` is the Keycloak user UUID taken from `User.id`, not the username. `max` is capped at 200. `search` matches Keycloak's username, email and name search.

### `User`

```json
{
  "id": "5d2c1f0e-8a57-4f5e-9d59-0c5b1c7e2a11",
  "username": "test_student1",
  "email": "test_student1@local",
  "first_name": "Test",
  "last_name": "Student",
  "enabled": true,
  "role": "student",
  "roles": ["student"],
  "created_at": "2026-09-22T03:14:00Z"
}
```

- `role` is the single application role, or `null` if the user has none. If a user somehow holds several, `role` follows AUTH-03 precedence (admin > instructor > student) and `roles` lists all of them.
- Service-account users (`service-account-*`) are never listed, and trying to change one returns 404.

### `CreateUser`

```json
{
  "username": "test_student1",
  "email": "test_student1@local",
  "first_name": "Test",
  "last_name": "Student",
  "role": "student",
  "password": "<initial password, 8-128 chars>",
  "temporary_password": true
}
```

- `username`: required. Must match `^[a-z0-9][a-z0-9_.-]{0,31}$`: lowercase, because Keycloak lower-cases usernames, and the username becomes the `student_id` used in LXD pod names.
- `role` and `password`: required. `email`, `first_name` and `last_name` are optional.
- `temporary_password` defaults to `true`, which means Keycloak forces a new password at first sign-in.
- **Unknown fields are rejected with 422.** You can't pass `realmRoles`, `enabled`, `credentials` or `attributes`.
- The password is never returned, logged or audited.

---

## 3. Error matrix

| Status | When | `detail` |
|---|---|---|
| 401 | Missing or invalid bearer token | `Missing or malformed Authorization header` / `Invalid or expired token` |
| 403 | Authenticated but not `admin` (student, instructor, or no app role) | `Forbidden: Insufficient privileges` |
| 404 | `{id}` isn't a (manageable) user in the realm | `User not found` |
| 409 | Create: username or email already exists | `Username or email already exists` |
| 403 | Write by a caller whose token still says `admin` but who is no longer an enabled Admin in Keycloak (revoked moments ago) | `Forbidden: Insufficient privileges` |
| 409 | An Admin tries to disable themselves or change their own role | `Admins cannot disable or change the role of their own account` |
| 409 | An Admin tries to reset their own password through this API | `Admins can't reset their own password here; use your Keycloak account page` |
| 409 | An Admin tries to reset their own authenticator through this API | `Admins can't reset their own authenticator here; ask another Admin` |
| 409 | Disabling or demoting the last enabled Admin (backstop; not reachable through the normal flow) | `Cannot disable or demote the last enabled Admin` |
| 422 | Validation: bad username/email/role, short password, unknown field, `{id}` not a UUID, `max` > 200 | FastAPI validation body |
| 422 | Keycloak's password policy rejected the password (create: the user isn't created; reset: nothing changes) | `Password does not meet the Keycloak password policy` |
| 503 | User management isn't configured on this host | `User management is not configured` |
| 503 | Keycloak unreachable or answered unexpectedly | `User management service unavailable` |

Create is all-or-nothing. If setting the password or the role fails after the Keycloak user is created, the user is deleted again and the call fails.

---

## 4. Behavior the UI should reflect

- **Disable** blocks new sign-ins and ends all of the user's Keycloak sessions. Their refresh token stops working immediately, and the provision API evicts their cached tokens, so their current access token is rejected on the very next request.
- **Role change** also ends the user's sessions, whenever the role actually changes, so the new role applies at their next sign-in. Their cached tokens are evicted too, so a demoted Admin's existing token stops working on the next request. Re-sending the same role is a no-op and doesn't sign them out.
- **Enable** doesn't end any session.
- **Password reset** ends all of the user's sessions and evicts their cached tokens, so the old password and any live session stop working at once. `temporary` defaults to `true` (Keycloak forces a new password at next sign-in). The password is never returned, logged or audited.
- **MFA reset** deletes the user's OTP (authenticator) credentials only; the password and roles are untouched. It ends all of the user's sessions and evicts their cached tokens. Because SEC-03 makes the OTP step REQUIRED, the user is shown the QR enrolment page at their next sign-in. It is idempotent: a user with no authenticator returns 200 and is audited with `removed=0`. If Keycloak fails part-way through deleting several authenticators, the route still tries to end the user's sessions, always evicts their cached tokens, returns 503, and audits `FAILED` with `removed=<n> sessions=ended|not_ended reason=keycloak_partial_remove`; retrying the reset finishes the job.
- **Self-protection:** hide or disable the Disable and Change-role controls on the signed-in Admin's own row (`User.username === session.user` username). The API enforces this regardless with a 409.
- **Writes re-check the caller against Keycloak.** A token that still says `admin` is not trusted for create, enable/disable or role changes: the caller must currently be an enabled Admin in Keycloak, or the call returns 403. Writes are also serialized. Together with self-protection, this means the realm can't be left without an enabled Admin through this API, even with several Admins acting at once.

---

## 5. Audit

Every write, including denied attempts (`reason=self`, `reason=actor_not_admin`, `reason=last_admin`) and failures, adds a row to the existing `audit_log` table. No schema change was needed.

| `event_type` | `student_id` | `result` | `detail` example |
|---|---|---|---|
| `ADMIN_USER_CREATE` | target username | `OK` / `FAILED` / `DENIED` | `actor=admin_demo role=student temporary_password=True` |
| `ADMIN_USER_DISABLE` / `ADMIN_USER_ENABLE` | target username | `OK` / `FAILED` / `DENIED` | `actor=admin_demo` |
| `ADMIN_USER_ROLE_SET` | target username | `OK` / `FAILED` / `DENIED` | `actor=admin_demo role=instructor previous=student` |
| `ADMIN_USER_PASSWORD_RESET` | target username | `OK` / `FAILED` / `DENIED` | `actor=admin_demo temporary=True` |
| `ADMIN_USER_MFA_RESET` | target username | `OK` / `FAILED` / `DENIED` | `actor=admin_demo removed=1` |

Admins can read the trail in the portal at `/admin/audit`, backed by the read-only `GET /admin/audit-log` (`audit_router.py`; filters `event_type`, `student_id`, `result`; keyset paging with `before_id`). Admin force-destroys are audited too, as `ADMIN_POD_FORCE_DESTROY` (`student_id` = pod owner, `detail` = `actor=… previous_status=…`).

---

## 6. Portal integration (done)

The portal now uses the live API; the fixture data (`mockUsers`, `lib/mock/adminMock.ts`) is gone.

- Proxies (all via `proxyToApi`, ids validated as UUIDs before forwarding): `app/api/admin/users/route.ts` (`GET`/`POST`), `users/[id]/enabled` (`PATCH`), `users/[id]/role` (`PUT`), `users/[id]/password` (`PUT`), `users/[id]/mfa` (`DELETE`), and `app/api/admin/audit-log/route.ts` (`GET`). Instructor-denial coverage for each is in `portal/src/lib/sec02AdminDenial.test.ts`.
- `admin/users/page.tsx`: live list with search, create, role change and disable (both confirmed, since they sign the user out), enable, password reset, and authenticator (MFA) reset. `name` = `first_name` + `last_name` falling back to `username`; `role: null` shows as "No role"; there is no last-login column. The signed-in Admin's own row offers none of these actions.
- A 503 "not configured" response shows the §7 one-time setup step.

## 7. Deployment (one-time per host)

```bash
bash ~/cyberrange/deploy/host/setup_user_admin_client.sh
# then restart the provision API so it loads KEYCLOAK_USER_ADMIN_CLIENT_SECRET
```

This creates a confidential, service-account-only client, `cyberrange-user-admin`. It has no browser or password flows. Its service account gets `realm-management` → `view-users`, `query-users`, `manage-users` and `view-realm` (read-only), and nothing else. The script forces `registrationAllowed=false`, then smoke-tests the exact Admin REST reads the API performs, and writes the client ID and secret to `env/.env` without printing the secret. The `portal` client secret isn't reused.

Until this script has run, `/admin/users*` answers 503 and every other endpoint behaves as before.

**Live verification:** `bash ~/cyberrange/deploy/host/verify_adm_user.sh | tee ~/adm-user-evidence.txt`. It checks the authorization boundary, create, role assignment (including rejection of old tokens), disable/enable, Admin self-protection and the audit trail. Output is sanitized: no tokens, passwords or secrets. Each run creates one throwaway `adm_user_test_*` user and leaves it disabled.
