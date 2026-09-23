# SEC-01 RBAC Bypass & Authorization Evidence

**Issue:** [#36](https://github.com/lmarellanojr/Capstone2-deploy/issues/36)
**Owner:** Lenie Joice Mendoza
**Review partner:** Shekinah Jabez Florentino (independently reproduce representative denials, especially review/progress endpoints; no self-approval)
**Related:** SEC-02 [#54](https://github.com/lmarellanojr/Capstone2-deploy/issues/54) owns the deeper Instructor → Admin coverage: force-destroy against a disposable pod, "no side effect occurred" checks, and reset. This document covers the role boundary across all three layers and links SEC-02 for the rest.

---

## 1. What was tested

| Layer | What enforces it | Test |
|---|---|---|
| **Pages** (`/dashboard`, `/instructor/*`, `/admin/*`, ...) | `portal/src/middleware.ts` + `routeRoles.ts` (AUTH-04/05) | `portal/src/middleware.test.ts`: 5 callers × 13 pages, manual URL attempts, and a matcher inventory proving every non-public page is protected |
| **Proxy routes** (`/api/*`) | `portal/src/lib/apiProxy.ts` requires a session and forwards **only the session's own token**; the backend decides | `portal/src/lib/apiProxy.test.ts`: no session → 401 with no upstream call, client `Authorization`/`X-Roles` headers ignored, backend 401/403 passed through unchanged, and an inventory proving every `/api` route goes through the proxy or is a reviewed exception |
| **Backend URLs** (FastAPI) | `auth.require_app_role` (new, router-level) + `require_role` / `require_owner` per route | `src/provisioning/test_sec01_rbac_matrix.py`: 5 callers × every served route (27), plus IDOR and identity-smuggling attempts. A route inventory fails if any route is added without a policy |
| **Live backend** | same, against the real Keycloak + API | `deploy/host/verify_sec01_rbac.sh` (§5) |
| **Live pages + proxy** | same, through the real portal and browser session | browser console check (§6) |

The callers are: unauthenticated, **authenticated with no application role**, Student, Instructor and Admin.

---

## 2. Finding fixed in this PR

**Role-less accounts could use every Student API.** AUTH-03's policy is that an account with none of `student` / `instructor` / `admin` is unauthorized. The portal enforces that for pages (middleware → `/no-role`). But the self-scoped Student routes only checked *who* was calling, never *whether they had a role*: `POST /pods/provision`, `GET /pods`, `/pods/{id}/*`, `/progress`, `DELETE /progress/{id}`, `POST /reviews/submit`, and INST-03's (#86) `GET /reviews/{id}` and `POST /reviews/{id}/resubmit`. A role-less Keycloak account could skip `/no-role` by calling `/api/*` or the backend directly, and provision a pod or write review cases.

**Fix:** `auth.require_app_role` is a FastAPI dependency attached to the **whole** `pods_router` and alerts router, so a future route cannot forget it. Instructor/Admin routes keep their narrower `require_role`.

**Proof:** against unfixed `main` (`2fb5206`, after INST-03), `test_sec01_rbac_matrix.py` gives `15 failed, 162 passed`: exactly the 14 no-role matrix rows plus `test_no_role_account_cannot_provision_or_write`. Every other row, including the IDOR tests on INST-03's review routes, already passed there, so the existing Student / Instructor / Admin guards were correct. No current account is affected: every user in the test realm holds exactly one application role (read-only `kcadm` check, 2026-09-21).

---

## 3. Other findings (not changed here)

| Severity | Finding | Why not fixed here |
|---|---|---|
| Low (latent) | `portal/src/app/api/guac-websocket/route.ts` verifies JWTs using the Keycloak **public key PEM as an HMAC secret** (`jwtVerify(token, TextEncoder(pem))`). That is the classic algorithm-confusion pattern: anyone can sign an HS256 token with the public key. It is **not exploitable today**: its ownership check calls a backend route that doesn't exist (`GET /pods/{id}`) with a dummy token, so it always ends in 404 or 501, and the frontend calls a different path (`/api/guac-websocket/{podId}`) that doesn't match it. | Unused, non-functional code in Maricar's portal area. Recommend **deleting the route**, not fixing it; flagged for the team. |
| Low | Proxy routes interpolate `[id]` params into the backend path without `encodeURIComponent`, so a crafted id can steer the proxy to a different backend path. | **No privilege gain**: the proxy always sends the caller's own token, so the backend applies the caller's role wherever the request lands (backend path-trick tests pass). Hardening only. |
| Info | `/admin/users*` checks the Admin role inside the handler, after request-body validation, so a non-admin sending an *invalid* body gets 422 instead of 403. | No action is performed and the schema is already public (`/openapi.json`). |
| Env | The test host's `pod_mgmt.db` had `schema_version` 4 recorded without `review_cases` (collision with an uncommitted earlier "v4"; stray `scenario_settings` table). `migrate.py` versions by number only and `_upgrade_review_cases_schema` returns early when the table is missing, so it can't self-heal. | Repaired on the test host (§5). Worth checking the **production** DB for the same state before INST-03 ships there; DB-01/INST-03 owners. |
| Info | Page middleware reads roles from the session cookie; a role revoked in Keycloak is honored there until the next token refresh (documented AUTH-04 limitation). | The backend rejects the revoked user's API calls immediately (ADM-USER #32 evicts the token cache), so data stays protected. |

---

## 4. Backend matrix (unit, observed)

`SEC01_MATRIX_OUT=matrix.md .venv/bin/python -m pytest src/provisioning/test_sec01_rbac_matrix.py`. "Allowed" means past authorization (anything but 401/403). 404/409 on an allowed row is the route's own business logic, e.g. the test pod is `DESTROYED`.

| Method | Route | Policy | unauthenticated | no_role | student | instructor | admin |
|---|---|---|---|---|---|---|---|
| GET | `/health` | public | 200 ✅ | 200 ✅ | 200 ✅ | 200 ✅ | 200 ✅ |
| GET | `/capacity` | public | 200 ✅ | 200 ✅ | 200 ✅ | 200 ✅ | 200 ✅ |
| POST | `/pods/provision` | app_role | 401 ✅ | 403 ✅ | 202 ✅ | 202 ✅ | 202 ✅ |
| GET | `/pods` | app_role | 401 ✅ | 403 ✅ | 200 ✅ | 200 ✅ | 200 ✅ |
| GET | `/pods/{pod_id}/status` | app_role | 401 ✅ | 403 ✅ | 200 ✅ | 200 ✅ | 200 ✅ |
| GET | `/pods/{pod_id}/guac-token` | app_role | 401 ✅ | 403 ✅ | 409 ✅ | 409 ✅ | 409 ✅ |
| GET | `/pods/{pod_id}/lab-urls` | app_role | 401 ✅ | 403 ✅ | 409 ✅ | 409 ✅ | 409 ✅ |
| DELETE | `/pods/{pod_id}/destroy` | app_role | 401 ✅ | 403 ✅ | 409 ✅ | 409 ✅ | 409 ✅ |
| POST | `/pods/{pod_id}/verify/{scenario_id}/{milestone_id}` | app_role | 401 ✅ | 403 ✅ | 409 ✅ | 409 ✅ | 409 ✅ |
| GET | `/pods/{pod_id}/milestones` | app_role | 401 ✅ | 403 ✅ | 200 ✅ | 200 ✅ | 200 ✅ |
| GET | `/pods/{pod_id}/alerts` | app_role | 401 ✅ | 403 ✅ | 409 ✅ | 409 ✅ | 409 ✅ |
| GET | `/progress` | app_role | 401 ✅ | 403 ✅ | 200 ✅ | 200 ✅ | 200 ✅ |
| DELETE | `/progress/{scenario_id}` | app_role | 401 ✅ | 403 ✅ | 200 ✅ | 200 ✅ | 200 ✅ |
| POST | `/reviews/submit` | app_role | 401 ✅ | 403 ✅ | 200 ✅ | 200 ✅ | 200 ✅ |
| GET | `/reviews/{review_id}` | app_role | 401 ✅ | 403 ✅ | 404 ✅ | 404 ✅ | 404 ✅ |
| POST | `/reviews/{review_id}/resubmit` | app_role | 401 ✅ | 403 ✅ | 404 ✅ | 404 ✅ | 404 ✅ |
| GET | `/instructor/pods` | instructor | 401 ✅ | 403 ✅ | 403 ✅ | 200 ✅ | 200 ✅ |
| GET | `/instructor/students` | instructor | 401 ✅ | 403 ✅ | 403 ✅ | 200 ✅ | 200 ✅ |
| GET | `/instructor/students/{student_id}` | instructor | 401 ✅ | 403 ✅ | 403 ✅ | 404 ✅ | 404 ✅ |
| GET | `/instructor/reviews` | instructor | 401 ✅ | 403 ✅ | 403 ✅ | 200 ✅ | 200 ✅ |
| GET | `/instructor/reviews/{review_id}` | instructor | 401 ✅ | 403 ✅ | 403 ✅ | 404 ✅ | 404 ✅ |
| POST | `/instructor/reviews/{review_id}/resolve` | instructor | 401 ✅ | 403 ✅ | 403 ✅ | 404 ✅ | 404 ✅ |
| DELETE | `/admin/pods/{pod_id}/force-destroy` | admin | 401 ✅ | 403 ✅ | 403 ✅ | 403 ✅ | 409 ✅ |
| GET | `/admin/users` | admin | 401 ✅ | 403 ✅ | 403 ✅ | 403 ✅ | 200 ✅ |
| POST | `/admin/users` | admin | 401 ✅ | 403 ✅ | 403 ✅ | 403 ✅ | 201 ✅ |
| PATCH | `/admin/users/{user_id}/enabled` | admin | 401 ✅ | 403 ✅ | 403 ✅ | 403 ✅ | 404 ✅ |
| PUT | `/admin/users/{user_id}/role` | admin | 401 ✅ | 403 ✅ | 403 ✅ | 403 ✅ | 404 ✅ |

**Manual URL/API bypass (unit):**
- **Another user's pod id in the URL:** 404 for Student, Instructor and Admin on guac-token, lab-urls, milestones, alerts, verify and destroy. The victim's pod is untouched. `/status` gives 404 for Student and Instructor, 200 for Admin (admin inspect).
- **Another student's review (INST-03):** `GET /reviews/{id}` → 404 for Student, 200 for Instructor/Admin. `POST /reviews/{id}/resubmit` → 404 for everyone but the owner, including staff, and the row is unchanged. `POST /instructor/reviews/{id}/resolve` → 403 for Student and role-less accounts, and the row is unchanged.
- **`?student_id=victim` on `GET /pods`:** ignored for Student and Instructor.
- **`student_id` in the provision or review body:** ignored; rows are stored under the caller.
- **`DELETE /progress/{id}`:** only removes the caller's own rows.
- **Path tricks** (`..%2F`, `/instructor/../admin`, `/ADMIN`, trailing slash): never reach `/admin/users`.
- **Forged roles in the body or `X-Roles` / `X-Forwarded-User` headers:** ignored.

---

## 5. Live backend matrix

Run on the host once the API is running this branch, with ADM-USER's `setup_user_admin_client.sh` already run:

```bash
bash ~/cyberrange/deploy/host/verify_sec01_rbac.sh | tee ~/sec01-backend-evidence.txt
```

The script signs in as `student_demo`, `instructor_demo` and `admin_demo`, and also tries every route unauthenticated. It uses a nonexistent pod id, and invalid bodies for allowed writes, so no pod, user, review or progress changes. It also runs header, query, traversal and tampered-token bypass attempts, plus an IDOR check against a real pod if one exists. Output is status codes only.

**Run 2026-09-21 on the test host** (`cyberrange.cyberlaboratory.online`), branch at `34bdf79` (`main` + SEC-01), API and portal redeployed, ADM-USER Keycloak setup applied:

```
=== SEC-01 backend RBAC evidence  2026-09-21T15:35:50Z  api=http://10.115.77.1:5000

METHOD  ROUTE                                    POLICY      unauthenticated   student           instructor        admin            
GET     /health                                  public      200/ok PASS       200/ok PASS       200/ok PASS       200/ok PASS      
GET     /capacity                                public      200/ok PASS       200/ok PASS       200/ok PASS       200/ok PASS      
POST    /pods/provision                          app_role    401/401 PASS      422/ok PASS       422/ok PASS       422/ok PASS      
GET     /pods                                    app_role    401/401 PASS      200/ok PASS       200/ok PASS       200/ok PASS      
GET     /pods/999999/status                      app_role    401/401 PASS      404/ok PASS       404/ok PASS       404/ok PASS      
GET     /pods/999999/guac-token                  app_role    401/401 PASS      404/ok PASS       404/ok PASS       404/ok PASS      
GET     /pods/999999/lab-urls                    app_role    401/401 PASS      404/ok PASS       404/ok PASS       404/ok PASS      
DELETE  /pods/999999/destroy                     app_role    401/401 PASS      404/ok PASS       404/ok PASS       404/ok PASS      
POST    /pods/999999/verify/1/1                  app_role    401/401 PASS      404/ok PASS       404/ok PASS       404/ok PASS      
GET     /pods/999999/milestones                  app_role    401/401 PASS      404/ok PASS       404/ok PASS       404/ok PASS      
GET     /pods/999999/alerts                      app_role    401/401 PASS      404/ok PASS       404/ok PASS       404/ok PASS      
GET     /progress                                app_role    401/401 PASS      200/ok PASS       200/ok PASS       200/ok PASS      
DELETE  /progress/999999                         app_role    401/401 PASS      200/ok PASS       200/ok PASS       200/ok PASS      
POST    /reviews/submit                          app_role    401/401 PASS      422/ok PASS       422/ok PASS       422/ok PASS      
GET     /reviews/999999                          app_role    401/401 PASS      404/ok PASS       404/ok PASS       404/ok PASS      
POST    /reviews/999999/resubmit                 app_role    401/401 PASS      404/ok PASS       404/ok PASS       404/ok PASS      
GET     /instructor/pods                         instructor  401/401 PASS      403/403 PASS      200/ok PASS       200/ok PASS      
GET     /instructor/students                     instructor  401/401 PASS      403/403 PASS      200/ok PASS       200/ok PASS      
GET     /instructor/students/student_demo        instructor  401/401 PASS      403/403 PASS      404/ok PASS       404/ok PASS      
GET     /instructor/reviews                      instructor  401/401 PASS      403/403 PASS      200/ok PASS       200/ok PASS      
GET     /instructor/reviews/999999               instructor  401/401 PASS      403/403 PASS      404/ok PASS       404/ok PASS      
POST    /instructor/reviews/999999/resolve       instructor  401/401 PASS      403/403 PASS      404/ok PASS       404/ok PASS      
DELETE  /admin/pods/999999/force-destroy         admin       401/401 PASS      403/403 PASS      403/403 PASS      404/ok PASS      
GET     /admin/users                             admin       401/401 PASS      403/403 PASS      403/403 PASS      200/ok PASS      
POST    /admin/users                             admin       401/401 PASS      403/403 PASS      403/403 PASS      422/ok PASS      
PATCH   /admin/users/00000000-0000-0000-0000-000000000000/enabled admin       401/401 PASS      403/403 PASS      403/403 PASS      404/ok PASS      
PUT     /admin/users/00000000-0000-0000-0000-000000000000/role admin       401/401 PASS      403/403 PASS      403/403 PASS      404/ok PASS      

=== Manual URL/API bypass attempts (student_demo)
PASS  forged X-Roles/X-Forwarded-User headers on GET /admin/users -> 403
PASS  ?role=admin on GET /instructor/students -> 403
PASS  path traversal /instructor/../admin/users -> 404
PASS  garbage bearer token on GET /pods -> 401
PASS  token with its signature stripped on GET /pods -> 401

=== IDOR: skipped (no live pod owned by a non-demo user); covered by the unit matrix

=== RESULT: 0 failure(s)
```

The first run on this host returned 16 × HTTP 500 on the review and `/instructor/students*` routes, all for *allowed* callers (every denial already passed). Cause: the host's `pod_mgmt.db` recorded `schema_version` 4 from an earlier, uncommitted deploy that never created `review_cases`, so `migrate.py` skipped `main`'s `v4.sql`. The database was backed up, then `v4.sql` was applied (it contains only `CREATE TABLE/INDEX IF NOT EXISTS`; nothing else changed, `integrity_check` = ok), and the run above followed. This is a host database issue outside SEC-01; flagged to the team (see §3).

---

## 6. Live pages + proxy (browser)

Proxy routes need a real portal session, so this runs in the browser. On https://cyberrange.cyberlaboratory.online, sign in as each demo account in turn. Open DevTools → Console, set `ROLE` on the first line, and paste the rest. It only uses a nonexistent pod id and invalid bodies, so nothing changes.

```js
const ROLE = "student" // "student" | "instructor" | "admin"
const P = 999999
const PAGES = { "/dashboard": "student", "/instructor": "instructor", "/instructor/students": "instructor",
  "/instructor/reviews": "instructor", "/admin": "admin", "/admin/users": "admin", "/admin/pods": "admin" }
const API = [ // [method, path, policy, body]
  ["GET", "/api/pods", "app"], ["GET", `/api/pods/${P}/status`, "app"], ["GET", "/api/progress", "app"],
  ["POST", "/api/pods/provision", "app", { student_id: "!!" }], ["DELETE", `/api/progress/${P}`, "app"],
  ["GET", "/api/instructor/students", "instructor"], ["GET", "/api/instructor/students/student_demo", "instructor"],
  ["DELETE", `/api/admin/pods/${P}/force-destroy`, "admin"],
]
const allowed = (policy) => policy === "app" || policy === "student" ? true
  : policy === "instructor" ? ROLE !== "student" : ROLE === "admin"
const rows = []
for (const [page, policy] of Object.entries(PAGES)) {
  const r = await fetch(page, { credentials: "include" })
  const landed = new URL(r.url).pathname
  const ok = allowed(policy) ? landed === page : landed === "/dashboard"
  rows.push({ kind: "page", target: page, expect: allowed(policy) ? "allow" : "→ /dashboard", got: landed, result: ok ? "PASS" : "FAIL" })
}
for (const [method, path, policy, body] of API) {
  const r = await fetch(path, { method, credentials: "include", headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined })
  const ok = allowed(policy) ? ![401, 403].includes(r.status) && r.status < 500 : r.status === 403
  rows.push({ kind: "api", target: `${method} ${path}`, expect: allowed(policy) ? "not 401/403" : 403, got: r.status, result: ok ? "PASS" : "FAIL" })
}
console.table(rows); console.log(`${ROLE}: ${rows.filter((x) => x.result === "FAIL").length} failure(s)`)
```

Then open a private window with no sign-in and visit `/admin/users` and `/instructor` directly. Both should redirect to `/login?callbackUrl=...`.

**Run 2026-09-21 on the test host**, same deployment as §5. Manual browser check by the owner (Lenie), signed in through the real portal login as each demo account, typing each URL directly:

| URL | student_demo | instructor_demo | admin_demo |
|---|---|---|---|
| `/instructor` | → `/dashboard` ✅ | opens ✅ | opens ✅ |
| `/admin/users` | → `/dashboard` ✅ | → `/dashboard` ✅ | opens ✅ |
| `/api/instructor/students` | `403 Forbidden: Insufficient privileges` ✅ | JSON list ✅ | JSON list ✅ |
| `/api/pods` | JSON ✅ | JSON ✅ | JSON ✅ |

Result: every cell matched the expected outcome.

Not signed in (curl against the public URL, same day):

```
GET /admin/users               -> 307 /login?callbackUrl=%2Fadmin%2Fusers
GET /instructor                -> 307 /login?callbackUrl=%2Finstructor
GET /api/instructor/students   -> 401
```

---

## 7. Reproduce the unit evidence

```bash
cd cyberrange
.venv/bin/python -m pytest -q -p no:warnings                                   # backend: 374 passed
cd portal && npx jest                                                          # portal: 142 passed
```
