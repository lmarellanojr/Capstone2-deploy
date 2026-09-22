# SEC-02 Instructor Cannot Perform Admin Operations — Evidence

**Issue:** [#54](https://github.com/lmarellanojr/Capstone2-deploy/issues/54)
**Owner:** Lenie Joice Mendoza
**Review partner:** Shekinah Jabez Florentino (independently reproduce representative denials; no self-approval)
**Depends on:** AUTH-02 #26, AUTH-03 #30, AUTH-04 #52, ADM-USER #32, ADM-POD #29
**Coordinates with:** SEC-01 #36 (merged in #89)

---

## 1. Scope and split with SEC-01

SEC-01 proved the **role boundary**: every Admin-only route answers 403 to an Instructor, and Admin pages redirect an Instructor to `/dashboard`. SEC-02 does not repeat that matrix. It adds the part SEC-01 handed over:

| SEC-02 adds | Where |
|---|---|
| **Nothing happened** when an Instructor is denied: no DB row, no Keycloak call, no pod teardown, no token revocation | `src/provisioning/test_sec02_instructor_admin_denial.py` |
| Realistic targets: a live pod, the Instructor's own pod, the Instructor's own account, the only Admin | same |
| An Admin control run of every same request, to show the detectors are not passing vacuously | same |
| The real `verify_token` path (fake Keycloak introspection), so forged headers, cookies and query strings go through production code | same |
| Admin-looking roles that must not count (`Admin`, `ADMIN`, `realm-admin`, `admin` on another client) | same |
| Reset: recorded as **not implemented** | same, plus the live script |
| Force-destroy on a **disposable** pod owned by `instructor_demo` | `deploy/host/verify_sec02_instructor_admin.sh --with-disposable-pod` |
| Portal: the real force-destroy proxy route with an Instructor session, the `/api/admin` surface, and Admin controls absent from the Instructor UI | `portal/src/lib/sec02AdminDenial.test.ts` |

## 2. Admin-only operations on `main` (`7d8ba1e`)

| Operation | Backend route | Portal path | Covered |
|---|---|---|---|
| Force-destroy a pod (ADM-POD #29) | `DELETE /admin/pods/{pod_id}/force-destroy` | `/admin/pods`, `/admin/pods/[id]` → `DELETE /api/admin/pods/[id]/force-destroy` | unit + portal + live |
| List / search users (ADM-USER #32) | `GET /admin/users` | none yet (Admin Users page shows fixture data) | unit + live |
| Create a user with a role | `POST /admin/users` | none yet | unit + live |
| Enable / disable a user | `PATCH /admin/users/{user_id}/enabled` | none yet | unit + live |
| Change a user's role | `PUT /admin/users/{user_id}/role` | none yet | unit + live |
| Admin pod inspection (any pod's status) | `GET /pods/{pod_id}/status` (Admin branch) | `/admin/pods/[id]` | unit (Instructor gets 404) |
| System management | none: `/capacity` is public read-only; `/admin/system` is a page only. ADM-SYS-01 (#95) is still open | `/admin/system` (page redirect, SEC-01) | recorded; inventory test catches new routes |
| **Reset** | **not implemented** (PR #50 shipped none) | none | recorded as unavailable (§5) |

Two inventory tests keep this table honest. `test_every_admin_only_route_is_covered` fails if any served `/admin*` route is missing from SEC-02's cases, or if SEC-01's Admin policy set and SEC-02 drift apart. `sec02AdminDenial.test.ts` fails if a new `/api/admin/*` proxy route appears without coverage.

## 3. Unit evidence (backend)

`test_sec02_instructor_admin_denial.py`: 87 tests. It uses a temporary SQLite database per test (conftest `temp_db`), never the shared `pod_mgmt.db`, and never reaches LXD, Keycloak, Guacamole or Wazuh.

**What "no side effect" means in these tests.** After every denied request:
- a full before/after snapshot of `pods`, `audit_log`, `review_cases` and `milestone_verification` is identical
- `perform_destruction` and `perform_provisioning` were never called
- the recording Keycloak fake saw **zero** Admin API calls (reads included), and its users, roles, passwords and sessions are unchanged
- `users_router._revoke_cached_tokens` was never called

**Instructor callers.** There are three Instructor tokens, each introspected through the real `verify_token`:
- `instructor-realm`: `instructor` as a realm role
- `instructor-client`: `instructor` as a `portal` client role
- `instructor-lookalike`: `instructor` plus `Admin`, `ADMIN`, `administrator` and `realm-admin` realm roles, plus `admin` on the `account` and `admin-cli` clients, plus `realm-admin`, `manage-users` and `manage-realm` on `realm-management`

Observed result: every row below is 403 `Forbidden: Insufficient privileges` with no side effect, for all three tokens.

| Operation | Target | Status × 3 tokens |
|---|---|---|
| force-destroy | a student's ACTIVE pod | 403 |
| force-destroy | a FAILED_ROLLBACK_COMPLETE pod | 403 |
| force-destroy | the Instructor's **own** ACTIVE pod (ownership does not unlock it) | 403 |
| list users | all accounts | 403 |
| list users | `?search=admin` | 403 |
| create user | a new **Admin** account, non-temporary password | 403 |
| create user | a Student account | 403 |
| disable | the only Admin | 403 |
| disable | a Student | 403 |
| enable | a disabled account | 403 |
| set role | **self → admin** | 403 |
| set role | the only Admin → student | 403 |
| set role | Student → instructor | 403 |

**Admin control.** The same 13 requests as `admin_demo` are all allowed, and every one produces a detectable effect: a DB change, Keycloak calls or a scheduled teardown. Force-destroy as Admin returns `{"status": "destroying"}`, sets the pod to `DESTROYING` and schedules exactly one teardown. That is *scheduled*, not completed, as the issue requires.

**Bypass attempts as `instructor-realm`, all with no side effect:**

| Attempt | force-destroy | promote self | create Admin |
|---|---|---|---|
| Forged `X-Roles`, `X-User-Roles`, `X-Forwarded-User`, `X-Forwarded-Groups`, `X-Auth-Request-Groups`, `X-Original-URL`, `X-Rewrite-URL`, `X-HTTP-Method-Override` | 403 | 403 | 403 |
| `?role=admin&as=admin_demo&student_id=admin_demo` | 403 | 403 | 403 |
| `role=admin` / `roles=admin` cookies | 403 | 403 | 403 |
| Admin token appended in the same `Authorization` header | 401 | 401 | 401 |
| `realmRoles` / `roles` / `clientRoles` added to the body | n/a | 422 | 422 |
| Retried 5× (promote self) | n/a | 403 ×5, roles still `instructor` | n/a |

| Path / method trick on force-destroy | Status |
|---|---|
| trailing slash, `/%61dmin/...`, `/admin/pods/1%2Fforce-destroy` | 403 |
| `/instructor/../admin/...`, `/pods/../admin/...` (the client normalizes these to `/admin/...`) | 403 |
| `//admin/...`, `/ADMIN/...` | 404 |
| `POST` or `GET` instead of `DELETE` | 405 |

**Side doors.** An Instructor calling the Student owner routes on someone else's pod gets `DELETE /pods/{id}/destroy` → 404 (for ACTIVE and FAILED pods) and Admin inspect `GET /pods/{id}/status` → 404. `GET /pods?student_id=student_demo` returns only the Instructor's own pods. No pod changed.

**Proof that the tests catch a real regression.** Each guard was removed temporarily, then restored:

| Mutation | Result |
|---|---|
| `require_role(["admin"])` removed from force-destroy | 17 failed |
| `require_role(["admin"])` removed from `_require_admin` (all user routes) | 37 failed |
| `extract_roles` counts roles from **every** client, not just `portal` | 13 failed (the lookalike token) |

Reproduce:
```bash
cd cyberrange
.venv/bin/python -m pytest -q -p no:warnings                                             # 461 passed (374 existing + 87 new)
SEC02_EVIDENCE_OUT=sec02.md .venv/bin/python -m pytest -q src/provisioning/test_sec02_instructor_admin_denial.py
```

## 4. Unit evidence (portal)

`portal/src/lib/sec02AdminDenial.test.ts`: 7 tests.
- The real `DELETE /api/admin/pods/[id]/force-destroy` handler with an Instructor session returns the backend's 403 body unchanged. It makes exactly one upstream `DELETE /admin/pods/5/force-destroy` with the Instructor's own token. A client-supplied `Authorization`, `X-Roles` or `X-Forwarded-User` header is not forwarded, and nothing is retried after the denial.
- The `/api/admin` surface is exactly `pods/[id]/force-destroy`. User/role management has no portal proxy yet, so those operations are only reachable on the backend, where §3 covers them.
- Hidden controls: the Instructor sidebar has no `/admin` links, no Instructor page links to an Admin page or calls an Admin operation, and `forceDestroyPod` is only called from `/admin` pages. This does not replace backend enforcement (§3 shows the backend denies regardless). It confirms that the Instructor UI offers no path to these operations.

```bash
cd cyberrange/portal && npx jest src/lib/sec02AdminDenial.test.ts   # 7 passed
```

## 5. Reset

PR #50 did **not** implement a reset API, and none exists on `main`. SEC-02 records reset as **unavailable** and does not substitute any other route:
- `test_no_pod_reset_route_is_served`: no served path contains `reset`, `restart`, `rebuild` or `reprovision`, and the only `/admin/pods` route is force-destroy. If a reset route is added, this test fails so reset denial coverage gets written instead of being skipped.
- `POST|PUT /admin/pods/{id}/reset`, `POST /pods/{id}/reset`, `POST /admin/pods/{id}/restart` and `POST /admin/reset` all return 404 as an Instructor, with no side effect.
- `DELETE /progress/{scenario_id}` is the Student "Try Again" score wipe. It is self-scoped, not Admin-only and **not a pod reset**, so it is not used as reset evidence.

## 6. Live evidence (test host)

Run on the host after deploying this branch, with ADM-USER's `setup_user_admin_client.sh` already applied:

```bash
bash ~/cyberrange/deploy/host/verify_sec02_instructor_admin.sh | tee ~/sec02-evidence.txt
# controlled negative test on a disposable pod owned by instructor_demo:
bash ~/cyberrange/deploy/host/verify_sec02_instructor_admin.sh --with-disposable-pod | tee ~/sec02-evidence-pod.txt
```

What it does:
1. **User/role**: `instructor_demo` tries each user/role operation against the **real** ids of `admin_demo`, `student_demo` and itself, including forged headers and `?role=admin`. `admin_demo` takes a read-only realm snapshot (username, enabled, roles) before and after, and the two must be identical. `sec02_backdoor` must not exist. A **fresh** Instructor sign-in must still be denied `/admin/users` and still be allowed `/instructor/students`.
2. **Force-destroy**: 403 on a nonexistent pod. The role check runs before the lookup; the Admin control on the same URL gets 404. `POST` instead of `DELETE` gets 405.
3. **`--with-disposable-pod`**: the script provisions a pod **owned by `instructor_demo`**, never a student's, and waits for ACTIVE. `instructor_demo` calls force-destroy on it and must get 403, with the pod state unchanged. The script then tears the pod down through the owner route and polls `/status` until `DESTROYED`, so completed teardown is verified through status. If `instructor_demo` already has a live pod, that pod is used and left running.
4. **Reset**: reset-shaped URLs must be unrouted (404/405), and `/openapi.json` must list no reset route.

Output is status codes and pod states only: no tokens, passwords or secrets.

**Run 2026-09-22 on the test host** (`cyberrange.cyberlaboratory.online`). The host's `auth.py`, `pods_router.py`, `users_router.py` and `keycloak_admin.py` were checked byte-identical (SHA-1) to this branch before running; this PR changes no app code, so only the script was copied to the host.

Default run:
```
=== SEC-02 Instructor -> Admin denial evidence  2026-09-22T16:11:14Z  api=http://10.115.77.1:5000

=== 1. User / role management (real targets)
PASS  instructor GET /admin/users -> 403
PASS  instructor GET /admin/users?search=admin -> 403
PASS  instructor POST /admin/users (new Admin account) -> 403
PASS  instructor PATCH admin_demo enabled=false -> 403
PASS  instructor PATCH student_demo enabled=false -> 403
PASS  instructor PUT own role -> admin -> 403
PASS  instructor PUT admin_demo role -> student -> 403
PASS  instructor PUT student_demo role -> instructor -> 403
PASS    + forged X-Roles/X-Forwarded-User headers -> 403
PASS    + ?role=admin query -> 403
PASS  realm unchanged (5 accounts; usernames, enabled flags and roles identical)
PASS  no sec02_backdoor account
PASS  fresh instructor token still denied GET /admin/users -> 403
PASS  fresh instructor token still allowed /instructor/students -> 200

=== 2. Force-destroy
PASS  instructor DELETE /admin/pods/999999/force-destroy (403 before lookup) -> 403
PASS    + forged X-Roles header -> 403
PASS    POST instead of DELETE -> 405
PASS  admin control: same URL reaches the pod lookup -> 404
(disposable-pod test skipped; rerun with --with-disposable-pod)

=== 3. Reset (not implemented in PR #50 -> must be unrouted)
PASS  instructor POST /admin/pods/999999/reset -> 404
PASS  instructor PUT /admin/pods/999999/reset -> 404
PASS  instructor POST /pods/999999/reset -> 404
PASS  instructor POST /admin/pods/999999/restart -> 404
PASS  no reset route in /openapi.json

=== RESULT: 0 failure(s)
```

`--with-disposable-pod` run (sections 1, 2 and 3 repeated with the same PASS results and `RESULT: 0 failure(s)`; only the added section is shown):
```
=== 2b. Disposable pod (owned by instructor_demo)
pod 1 (created by this run: 1)
state before: FAILED_ROLLBACK_COMPLETE
PASS  instructor force-destroy on own FAILED_ROLLBACK_COMPLETE pod -> 403
PASS  pod state unchanged after denial (FAILED_ROLLBACK_COMPLETE) -> FAILED_ROLLBACK_COMPLETE
cleanup: owner destroy -> 200
PASS  disposable pod torn down (status) -> DESTROYED
```

**Note on the disposable pod.** Provisioning of the disposable pod failed on the host and rolled back to `FAILED_ROLLBACK_COMPLETE` about 13 s after the pod network setup, so it never reached ACTIVE. `FAILED_ROLLBACK_COMPLETE` is one of the two states force-destroy accepts, so the denial test is valid: the Instructor got 403 and the state was unchanged. The ACTIVE-pod case is covered by the unit tests only. The provisioning failure is a host issue outside SEC-02 and needs to be raised with the team. The host's pod slot was free again afterwards (`/capacity`: `active_pods: 0`).

## 7. Live pages + proxy (browser)

The SEC-01 §6 browser check already shows `instructor_demo` redirected from `/admin/users` to `/dashboard`. For SEC-02, sign in as `instructor_demo` on https://cyberrange.cyberlaboratory.online, open DevTools → Console and run:

```js
const rows = []
for (const p of ["/admin", "/admin/users", "/admin/pods", "/admin/pods/999999", "/admin/system"]) {
  const r = await fetch(p, { credentials: "include" })
  rows.push({ target: p, got: new URL(r.url).pathname, result: new URL(r.url).pathname === "/dashboard" ? "PASS" : "FAIL" })
}
const r = await fetch("/api/admin/pods/999999/force-destroy", { method: "DELETE", credentials: "include", headers: { "X-Roles": "admin" } })
rows.push({ target: "DELETE /api/admin/pods/999999/force-destroy", got: r.status, result: r.status === 403 ? "PASS" : "FAIL" })
console.table(rows)
```

It uses a nonexistent pod id, so nothing can change even if a denial failed.

**Run 2026-09-22 on the test host**, signed in through the real portal login as `instructor_demo`; the snippet above plus two Instructor controls and a sidebar check:

| Target | Got | Result |
|---|---|---|
| `/admin` | → `/dashboard` | PASS |
| `/admin/users` | → `/dashboard` | PASS |
| `/admin/pods` | → `/dashboard` | PASS |
| `/admin/pods/999999` | → `/dashboard` | PASS |
| `/admin/system` | → `/dashboard` | PASS |
| `DELETE /api/admin/pods/999999/force-destroy` with `X-Roles: admin` | 403 | PASS |
| control: `GET /api/instructor/students` | 200 | PASS |
| control: `/instructor` | opens | PASS |
| Instructor sidebar links | `/instructor`, `/instructor/students`, `/instructor/reviews` (no `/admin` link, no force-destroy button) | PASS |

## 8. Review partner reproduction (Shekinah)

Reproduce independently. Representative denials:
- [ ] `instructor_demo` → `PUT /admin/users/<own id>/role {"role":"admin"}` → 403; the account is still `instructor` after a fresh sign-in
- [ ] `instructor_demo` → `POST /admin/users` with `role: admin` → 403; no new account in the Admin Users list
- [ ] `instructor_demo` → `DELETE /admin/pods/<id>/force-destroy` → 403; the pod's `/status` is unchanged
- [ ] `instructor_demo` on `/admin/users` and `/admin/pods` in the browser → redirected to `/dashboard`; no Admin links in the Instructor sidebar

## 9. Findings

**Status:** unit evidence (§3, §4) and live host evidence (§6, §7, 2026-09-22) complete. Review-partner reproduction (§8) pending; until it is in, this PR relates to #54 rather than closing it.

| Severity | Finding | Action |
|---|---|---|
| None | No Instructor → Admin bypass found in the unit tests (§3, §4) or on the live host (§6, §7): every Admin-only operation is denied, with no change to the realm or the pod. The §8 review-partner reproduction is still pending. | none |
| Env | Disposable-pod provisioning on the test host failed and rolled back (`FAILED_ROLLBACK_COMPLETE`) on 2026-09-22, so the live force-destroy denial ran on a FAILED pod, not an ACTIVE one (§6). Students may be unable to start labs on this host. | raise with the team; outside SEC-02 |
| Info | User-route role smuggling in the body (`realmRoles`, `roles`, `clientRoles`) gets **422** (`extra="forbid"`) before the role check's 403. No action is performed. This is the same as the SEC-01 §3 informational finding. | none (unchanged) |
| Info | Reset is not implemented (PR #50). Recorded as unavailable. The inventory test will require coverage when it lands. | revisit when a reset contract exists |
| Info | ADM-SYS-01 (#95) will add Admin system-management routes. `test_every_admin_only_route_is_covered` fails until they get SEC-02 cases. | extend when #95 merges |
