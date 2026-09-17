# AUTH-03 Frozen Role Contract

Date: 2026-09-17
Owner: Lenie Joice Mendoza
Review partner: Shekinah Jabez Florentino (independent verification, no self-approval)
GitHub issue: [#30](https://github.com/lmarellanojr/Capstone2-deploy/issues/30)
Branch: `feature/auth-03-prototype-accounts-role-mapping`
Consumers: [AUTH-04 #52](https://github.com/lmarellanojr/Capstone2-deploy/issues/52) (Maricar Punzalan, portal route protection), [AUTH-05 #53](https://github.com/lmarellanojr/Capstone2-deploy/issues/53) (Maricar Punzalan, login role selector removal / authenticated routing)

**Rule:** the authenticated session role — `session.user.roles`, sourced from the Keycloak-issued JWT's `realm_access.roles` — is the **only** authoritative signal for what a user may access. The Sign In page's Student/Instructor/Admin tab selector (`cyberrange/portal/src/app/login`) is a **client-side display choice only**, is not sent to Keycloak as a role claim, and must never be trusted by AUTH-04 route guards or AUTH-05 routing logic. Removing that selector is AUTH-05's job; not trusting it in the meantime is AUTH-04's job.

This contract covers **accounts and role mapping only**. Portal route protection is AUTH-04. Login routing is AUTH-05. This document is what those two issues consume — it does not implement either.

---

## Prototype accounts (frozen)

| Username | Intended role | Realm role assigned | Status |
|---|---|---|---|
| `student_demo` | student | `student` | ✅ verified |
| `instructor_demo` | instructor | `instructor` | ✅ verified |
| `admin_demo` | admin | `admin` | ✅ verified |

Each account holds **exactly one** application role — confirmed via `kcadm.sh get-roles` and via a live JWT decode (see Verification evidence below). No account holds more than one of `student`/`instructor`/`admin`.

Realm: `cyber-range`. Client: `portal`. Roles were created and assigned via `cyberrange/deploy/host/create_demo_accounts.sh` (idempotent, re-runnable).

## Where the role lives

- Roles are **realm roles**, not client roles. They appear in the JWT at `realm_access.roles` (a plain string array).
- The portal (`cyberrange/portal/src/lib/auth.ts`) decodes `realm_access.roles` directly off the access token (unsigned payload decode — NextAuth's OAuth client already validated the token during the code exchange) and mirrors it onto `session.user.roles` in the `session()` callback.
- The FastAPI backend (`cyberrange/src/provisioning/auth.py::extract_roles`) reads the **union** of `realm_access.roles` and `resource_access.portal.roles` from Keycloak's token-introspection response. Since these three accounts only carry realm roles, both paths agree for them — but any future consumer should know the backend's contract is broader (realm ∪ client) than the portal's (realm only).
- `session.user.roles` is typed `string[]`, not a narrow union (see `next-auth.d.ts`). Every token also carries Keycloak-internal roles alongside the app role — see below.

## Exact string contract

Application roles are exactly, case-sensitively: `student`, `instructor`, `admin`.

Every authenticated user's roles array will also contain Keycloak-internal noise roles that are **not** application roles and must be ignored by any role check:

```
offline_access, uma_authorization, default-roles-cyber-range
```

A consumer must check for membership (`roles.includes("admin")`), never array equality or length, because of this noise.

## Multi-role / no-role policy (frozen decision for AUTH-05)

These three demo accounts are each single-role by design, but AUTH-05 needs a defined behavior for the general case:

- **No application role** (a user authenticates but their roles array contains none of `student`/`instructor`/`admin`): treat as **unauthorized** — route to an access-denied/error state, never default to the student portal. This matches the backend's existing behavior (`test_no_application_role_denied_on_instructor_endpoint`/`..._admin_endpoint` in `test_role_guard_matrix.py`), which already returns 403 rather than silently downgrading.
- **Multiple application roles** (not expected from Keycloak's current realm-role config, but not structurally prevented): precedence is **admin > instructor > student** for routing purposes — the highest-privilege role determines the landing page. This is a routing-precedence rule only; it does not grant a lower-privilege user admin capabilities, and it should not be needed in practice since roles here are intentionally exclusive per account.

Flag to Shekinah/Maricar if either policy needs to change before AUTH-05 implements against it — this is proposed-and-frozen, not independently re-derived elsewhere.

## Out of scope (explicitly not covered here)

- Enforcing these roles at the route/middleware level → AUTH-04 #52
- Removing the login page's role selector and routing off `session.user.roles` → AUTH-05 #53
- Backend endpoint authorization → already covered by AUTH-02 #26 (`require_role`), unaffected by this issue

## Verification evidence (sanitized — no credentials)

Method: password-grant token request directly against Keycloak (`directAccessGrantsEnabled=true` on the `portal` client), decoding only the resulting JWT's `preferred_username` and `realm_access.roles`. Exercises the same claim issuance and role mapping as the browser SSO flow; passwords never left the deploy host.

```
student_demo     LOGIN_OK  expected_role=student     present=YES  app_roles=student
instructor_demo  LOGIN_OK  expected_role=instructor  present=YES  app_roles=instructor
admin_demo       LOGIN_OK  expected_role=admin       present=YES  app_roles=admin
```

Full reproduction: `cyberrange/deploy/host/verify_demo_accounts.sh` (read-only, re-runnable, never prints passwords).

### Role refresh behavior — validated

Method: got an initial token pair for `student_demo` (roles: `student`), temporarily granted it `instructor` too, used its **refresh token** (no re-login) to mint a new access token, and confirmed the new token's `realm_access.roles` picked up `instructor` immediately. The temporary grant was then reverted — `student_demo` is confirmed back to `student` only.

```
before refresh: roles=default-roles-cyber-range,offline_access,student,uma_authorization
after refresh:  roles=default-roles-cyber-range,instructor,offline_access,student,uma_authorization
RESULT: PASS
final state check: student_demo roles now = default-roles-cyber-range,student
```

This confirms the exact mechanism `portal/src/lib/auth.ts`'s `doRefresh()` depends on: Keycloak evaluates role mappings at token-issuance time, so a mid-session role change is picked up on the next refresh, not only after a full re-login. Reproduction: `cyberrange/deploy/host/verify_role_refresh.sh`.

### `session.user.roles` — confirmed via live portal login

Owner (Lenie) manually logged in as all three demo accounts through the actual portal Sign In → "Continue with school SSO" flow at https://cyberrange.cyberlaboratory.online/ (real NextAuth PKCE flow, not the token-grant probe) and confirmed `session.user.roles` matches this contract for each account.

## Known open items (not yet closed)

- [ ] Contract doc has not yet been formally handed to Maricar (AUTH-04/AUTH-05 owner).
- [ ] Sanitized evidence package has not yet been formally handed to Shekinah for independent review/sign-off.

This document will be updated (not re-issued) as those close out; treat the account/role mapping above as frozen now, the open items as in progress.
