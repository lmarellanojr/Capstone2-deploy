# P0-01 Pod/API Contract Audit

Date: 2026-09-15  
Owner: Leonardo Arellano  
GitHub issue: [#22](https://github.com/lmarellanojr/Capstone2-deploy/issues/22)  
Branch: `feature/p0-01-pod-api-contract-audit`  
Code: `C:\Capstone2-Deploy\cyberrange` (`main` at audit time)  
TRB: `C:\Capstone Learning Guide\trb\TRB-2026-09-15-admin-pod-api-freeze-r2.md` (Approved)

**Rule:** reuse the current `GET /pods` shape. Do not invent a duplicate `/admin` pod schema. Student provision/destroy/scoring is **not** modified by this task.

P0-01 example `POST /pods/{id}/destroy` is **not** in the repo. Exact route is `DELETE /pods/{pod_id}/destroy`.

---

## Contract table (P0-01 deliverable)

| API | Exists? | Auth | Current response (success) | Admin requirement | Decision |
|---|---|---|---|---|---|
| `GET /capacity` | Yes | None | See capacity keys below. HTTP 200. | System status: `active_pods`, `max_pods`, `can_provision`, `available_mb` | **REUSE** |
| `GET /pods` | Yes | Bearer JWT (`verify_token`). With `AUTH_ENABLED=true`, scoped to `preferred_username`. Query `?student_id=` ignored. No role check. | `{ "pods": [ list_item ] }` — no `count`. Live rows only (not `DESTROYED` / `FAILED_ROLLBACK_COMPLETE`). HTTP 200. | List **all** students’ live pods (`pod_id`, `student_id`, `status`, `scenario_id`) | **EXTEND** (self-scoped; Admin cannot see others) |
| `GET /pods/{pod_id}/status` | Yes | Bearer + `require_owner` (non-owner **404**). No role check. | `PodResponse` (list keys **minus** `id`). HTTP 200. DB row, not live LXD. | Detail: owner, scenario, status, containers | **EXTEND** (owner-only; Admin 404 on another student’s pod) |
| `DELETE /pods/{pod_id}/destroy` | Yes | Bearer + owner. **Destructive.** | `{ "status": "destroying", "pod_id": N }` HTTP 200. Background LXD/OVN teardown. | Destroy a disposable **ACTIVE** test pod | **EXTEND** (works for owner; not Admin-on-any-pod) |
| `POST /pods/{id}/destroy` | **No** | — | — | (P0-01 example only) | — use DELETE |
| `DELETE /admin/pods/{pod_id}/force-destroy` | **No** on `main` | — | — | Stuck `PROVISIONING` / `DESTROYING` | **NEW** (today 409 on student destroy) |
| Lab reset / recreate | **No** | — | — | Clean lab restored | **NEW**: destroy → poll until `DESTROYED` → provision (same `scenario_id`). Do **not** call provision on HTTP 200 destroy. Do **not** use score wipe. |
| `DELETE /progress/{scenario_id}` | Yes | Bearer; caller identity only. **Destructive (scores).** | `{ student_id, scenario_id, deleted }` HTTP 200 | Not an Admin pod action | **Do not reuse** for lab reset |
| IPs / live LXD Running\|Stopped | IPs: derived in UI. Live LXD: **no** | — | `vmid_*` names on list/status. IPs: `10.0.{50+pod_id}.{10,20,30}` | Container + IP on detail | **REUSE** names + UI IPs. **NEW** only if live LXD probe is required (not needed for Oct 2 if `vmid_*` + formula suffice) |
| Failed provisioning visible | Partial | — | `PROVISIONING` is on `GET /pods`. `FAILED_ROLLBACK_COMPLETE` is **omitted** from list; owner `GET .../status` can still return it. | Detect failed provision | **EXTEND** (list hides the failed-rollback row) |

No new Admin JSON schema is proposed. After PR #44 merges, implement list-all / force-destroy by **extending** these routes (role + owner bypass), not by copying `/instructor/pods` (that strip `vmid_*`).

---

## Existing pod-related routes (inventory)

Handlers: `cyberrange/src/provisioning/pods_router.py`, `provision_api_fastapi.py`, `alerts_endpoint.py`.

| Method | Route | Auth | Destructive? | Admin freeze? |
|---|---|---|---|---|
| GET | `/health` | none | no | optional liveness |
| GET | `/capacity` | none | no | **yes** |
| POST | `/pods/provision` | Bearer | creates LXD/OVN | no (student create) |
| GET | `/pods` | Bearer | no | **yes** |
| GET | `/pods/{pod_id}/status` | Bearer + owner | heartbeat write if ACTIVE | **yes** |
| GET | `/pods/{pod_id}/guac-token` | Bearer + owner | no | no |
| GET | `/pods/{pod_id}/lab-urls` | Bearer + owner | no | no |
| DELETE | `/pods/{pod_id}/destroy` | Bearer + owner | **yes** (LXD/OVN) | **yes** (disposable ACTIVE) |
| POST | `/pods/{pod_id}/verify/{scenario_id}/{milestone_id}` | Bearer + owner | no | no |
| GET | `/pods/{pod_id}/milestones` | Bearer + owner | no | no |
| GET | `/pods/{pod_id}/alerts` | Bearer + owner | no | no |
| GET | `/progress` | Bearer | no | no |
| DELETE | `/progress/{scenario_id}` | Bearer | **yes** (scores only) | document only — not lab reset |

Shared JWT failures (`auth.py:71-95`): missing/malformed Bearer → **401**; inactive token → **401**; Keycloak introspect down → **503**. Non-integer `{pod_id}` → FastAPI **422**.

There is **no** FastAPI role guard on `main` (`require_role` is PR #44 / AUTH-02).

---

## Per-endpoint audit

### GET /capacity

| | |
|---|---|
| **File** | `provision_api_fastapi.py:111-129` |
| **Purpose** | Host RAM/pod budget. |
| **Auth** | None. Unauthenticated **200**. |
| **Request** | No path/query/body. |
| **Success** | 200 JSON keys below. `available_mb` is `int \| null` (`capacity.py:63-70`). `can_provision` is false if `available_mb` is null (`capacity.py:94-100`). |
| **Failures** | No HTTP error path in the handler. Unreadable meminfo → `available_mb: null`, `can_provision: false`. |
| **LXD** | Not called. |

| Key | Type | Notes |
|---|---|---|
| `available_mb` | `int \| null` | live |
| `active_pods` | `int` | host-wide, not `DESTROYED`/`FAILED_ROLLBACK_COMPLETE` |
| `max_pods` | `int` | oci_12gib default **1** |
| `pod_ram_mb` | `int` | default **4096** |
| `ram_buffer_mb` | `int` | oci_12gib default **1536** |
| `profile` | `string` | `"oci_12gib"` when `PROFILE=oci_12gib` |
| `ram_required_mb` | `int` | oci_12gib default **5632** |
| `can_provision` | `bool` | **advisory snapshot only** (see below) |

**`can_provision` formula** (`provision_api_fastapi.py:128`): `active_pods < MAX_PODS and can_provision_ram(avail)`. That is pod-count plus RAM headroom for **one** more pod (`ram_required_mb()`). It does **not** check:

- student already has a live row (`PROVISIONING` / `ACTIVE` / `DESTROYING`) → provision **409** `{ "error": "ALREADY_PROVISIONED", "pod_id": N }` (`pods_router.py:110-118`)
- host at `MAX_PODS` at admit time → **503** `POD_CAP_REACHED`
- RAM reserved for in-flight `PROVISIONING` pods (`adding=provisioning_count+1`) → **503** `RAM_FULL: …`
- LXD free disk or DB storage accounting → **503** `STORAGE_FULL: …`

Admin UI must treat `can_provision: true` as a snapshot, not a guarantee. Handle **409 ALREADY_PROVISIONED** and those **503**s even when the latest `/capacity` value is `true`.

Do not mock `available_mb` / `active_pods` / `can_provision` as constants. Unset `PROFILE` defaults to `onprem` (`ram_buffer_mb` 2048, `max_pods` 3).

No portal `/api/capacity` proxy (`portal/src/lib/apiProxy.ts`).

Sanitized shape (oci_12gib; live fields marked):

```json
{
  "available_mb": "<live int or null>",
  "active_pods": "<live int>",
  "max_pods": 1,
  "pod_ram_mb": 4096,
  "ram_buffer_mb": 1536,
  "profile": "oci_12gib",
  "ram_required_mb": 5632,
  "can_provision": "<live bool>"
}
```

Host evidence (Chapter 04 gate, not this PC): `/capacity` profile `oci_12gib`, `ram_required` 5632 — `cyberrange/docs/evidence/2026-09-secondhost-ch04-core-services.md:31`.

---

### GET /pods

| | |
|---|---|
| **File** | `pods_router.py:216-235`, `serialize_pod` `:32-35`, `ttl.py:66-82` |
| **Purpose** | List live pods. |
| **Auth** | `Depends(verify_token)`. `AUTH_ENABLED=true`: identity = `claims["preferred_username"]` (`auth.py:98-101`). Empty username → **401** `"Identity required"`. `AUTH_ENABLED=false`: optional `?student_id=`; omit = unfiltered list (bootstrap only). **No roles.** |
| **Request** | Query `student_id` optional, ignored when auth on. No body. |
| **Success** | 200 `{ "pods": [ list_item ] }`. No `count`. |
| **Failures** | 401 missing/invalid token; 401 no identity; 503 introspect down. Empty list is **200** `{ "pods": [] }`, not 404. |
| **LXD** | Not called. SQLite `pods` only. |

`list_item` = `SELECT *` plus TTL. Includes SQLite PK `id` (`schema/v1.sql:8`).

| Key | Type | Notes |
|---|---|---|
| `id` | `int` | list only; not the path param |
| `pod_id` | `int` | slot 1–6 |
| `student_id` | `string` | |
| `status` | `string` | live list: `PROVISIONING` \| `ACTIVE` \| `DESTROYING` |
| `vmid_kali` `vmid_meta` `vmid_dvwa` | `string \| null` | `"pod-{student_id}-…"` (`provision.py:41-46`) |
| `connection_id` | `int \| null` | |
| `wazuh_agent_id` | `string \| null` | |
| `last_heartbeat` | `string \| null` | live |
| `created_at` | `string \| null` | TTL clock |
| `scenario_id` | `string \| null` | e.g. `"01"` |
| `ttl_hours` | `int` | default **8** (`config.py:33`) |
| `remaining_seconds` | `int` | always present; **0** if `created_at` bad |
| `expires_at` | `string \| null` | ISO `…Z` |
| `ttl_expired` | `bool` | |

List length ≠ `capacity.active_pods` when auth is on.

Portal drift: `api.ts` types `count` and `vmid_*` as numbers. API has no `count`; `vmid_*` are strings. Offline proxy may return `{ pods: [], count: 0 }` (`apiProxy.ts:53-54`).

---

### GET /pods/{pod_id}/status

| | |
|---|---|
| **File** | `pods_router.py:238-253`, `models.py:22-37` |
| **Purpose** | One pod’s DB status + TTL. |
| **Auth** | Bearer + `require_owner` (`auth.py:104-108`). Non-owner **404** `"Pod not found"` (not 403). No roles. |
| **Request** | Path `pod_id` int required. No query/body. |
| **Success** | 200 `PodResponse`: same keys as list item **except no `id`**. No status filter — owner may see `DESTROYED` / `FAILED_ROLLBACK_COMPLETE`. |
| **Side effect** | If `ACTIVE`, `UPDATE last_heartbeat`. JSON `last_heartbeat` is the **pre-UPDATE** row. TTL reaper uses `created_at`, not heartbeat (`reaper.py:32-36`). |
| **Failures** | 401/503 auth; 422 bad id; 404 missing or not owner. Stopped LXD is **not** detected (no pylxd get). |
| **LXD / OVN** | Not called. Container identity is `vmid_*`. IPs are **not** in JSON. |

UI IPs (`pod_net.py:28-29`, `portal/src/lib/podIps.ts:20-27`):

| Container | IP |
|---|---|
| kali | `10.0.{50+pod_id}.10` |
| meta | `10.0.{50+pod_id}.20` |
| dvwa | `10.0.{50+pod_id}.30` |

Do not add an `ips` field.

---

### DELETE /pods/{pod_id}/destroy  (**destructive**)

| | |
|---|---|
| **File** | `pods_router.py:306-340` → `provision.perform_destruction` `:344-395` → `delete_pod_network` (`pod_net.py`) |
| **Purpose** | Tear down kali/meta/dvwa + OVN net; mark `DESTROYED`. |
| **Auth** | Bearer + owner. Non-owner 404. No roles. |
| **Request** | Path `pod_id`. No body. |
| **Success** | 200 `{ "status": "destroying", "pod_id": N }` (`destroying` is lowercase; row status becomes `DESTROYING`). LXD work is **background**. |
| **Allowed from** | `ACTIVE` or `FAILED_ROLLBACK_COMPLETE` only (`:327`). |
| **Failures** | 401/503; 422; 404 unknown/not owner; **409** if `PROVISIONING` / `DESTROYING` / `DESTROYED` (`cannot destroy from this state`). |
| **LXD failure** | HTTP already 200. If a container delete fails, row stays `DESTROYING`; reaper retries after `STUCK_POD_GRACE_MINUTES` (`reaper.py:86-90`). Not a JSON error on the DELETE. |
| **List vs destroy** | `FAILED_ROLLBACK_COMPLETE` is destroyable but **hidden** from `GET /pods`. |

**Reset must wait.** HTTP 200 means teardown is **queued**, not finished. `DESTROYING` still matches provision’s live-row check (`status NOT IN ('DESTROYED','FAILED_ROLLBACK_COMPLETE')`), so an immediate `POST /pods/provision` returns **409 ALREADY_PROVISIONED**. Failed container delete can leave the row in `DESTROYING` while the reaper retries.

Documented reset sequence (NEW, not implemented here):

1. `DELETE /pods/{pod_id}/destroy` (owner or future admin bypass).
2. Poll `GET /pods/{pod_id}/status` until `status == DESTROYED` (or the row is gone from `GET /pods`).
3. Timeout: surface a cleanup-failure message; do not provision. Stuck `DESTROYING` is ADM-POD-04 (force-destroy), not a silent retry of provision.
4. `POST /pods/provision` with the **same** `scenario_id` as the old row.
5. Keep `DELETE /progress/{scenario_id}` **separate** — scores stay unless the operator explicitly wipes them.

P0-01 asked to verify against a disposable pod. **Not run from this PC** (API `10.115.77.1:5000` timed out). Do not destroy a real student lab. State machine above is from the handler.

---

### DELETE /progress/{scenario_id}  (**destructive — scores, not lab**)

| | |
|---|---|
| **File** | `pods_router.py:384-413` |
| **Purpose** | Student “Try Again”: delete caller’s `milestone_verification` rows for one scenario. |
| **Auth** | Bearer; `student_id` from token only. |
| **Success** | 200 `{ "student_id", "scenario_id", "deleted" }` |
| **Failures** | 401/503. Unknown scenario deletes 0 rows (still 200). |
| **Not** | Lab reset. No `POST /pods/{pod_id}/reset`. |

---

## Key questions (P0-01)

| Can Admin already… | Answer | Class |
|---|---|---|
| List pods | Own pods only | EXTEND |
| See pod status | Owner status only; DB not live LXD | EXTEND |
| Identify student/owner | `student_id` on list/status | REUSE field / EXTEND access |
| Identify scenario | `scenario_id` | REUSE field / EXTEND access |
| See capacity | `GET /capacity` public; `can_provision` is advisory | REUSE snapshot / handle provision 409 and 503 |
| Destroy disposable pods | Owner DELETE destroy from ACTIVE | EXTEND |
| Reset/recreate pods | Missing | NEW (destroy → poll `DESTROYED` → provision; same scenario; scores separate) |
| Detect failed provisioning | `PROVISIONING` on list; `FAILED_ROLLBACK_COMPLETE` not on list | EXTEND |
| View LXD/container state | `vmid_*` + IP formula; no Running/Stopped probe | REUSE for Oct 2 detail |

---

## Evidence

| Source | What it shows |
|---|---|
| Handlers cited above | Request/response/auth/failures |
| `models.py:22-37` | Status body (no `id`) |
| `auth.py:71-108` | JWT 401/503; owner 404 |
| `capacity.py`, `profiles.py:35-39` | `available_mb` null; oci_12gib 1536 / 5632 |
| `provision.py:344-395` | Destroy LXD/OVN path |
| Ch04 evidence `:31` | Live `/capacity` `oci_12gib` / `ram_required` 5632; unauth `GET /pods` **401** |
| This workstation | `curl http://10.115.77.1:5000/health` → timeout (not on the Ampere LAN). No token used. No destroy issued. |

Do not paste access tokens. Do not copy r1 invented numbers (`ram_buffer_mb` 512, `ram_required_mb` 4608, `ttl_hours` 2, `available_mb` 1234).

---

## Admin UI subset (Maricar)

| Screen | Route | Fields |
|---|---|---|
| List | `GET /pods` | `pod_id`, `student_id`, `status`, `scenario_id`; optional `remaining_seconds`, `ttl_expired` |
| Detail | `GET /pods/{pod_id}/status` | those + `vmid_*` strings; IPs in UI |
| System | `GET /capacity` | `active_pods`, `max_pods`, `can_provision` (advisory), `available_mb`. Do not treat `true` as “provision will succeed”. |
| Destroy disposable ACTIVE | `DELETE /pods/{pod_id}/destroy` | `{ "status": "destroying", "pod_id" }` |

Ignore for Oct 2: list `id`, `connection_id`, `wazuh_agent_id`, `last_heartbeat`, portal `count`. Do not mock `GET /instructor/pods` (PR #44 strips `vmid_*`).

---

## Gaps after this audit (not this PR)

1. Admin list-all — EXTEND `GET /pods` (or equivalent) with admin role; wait for PR #44 merge (same file).
2. Admin inspect/destroy another student — EXTEND `require_owner` with admin bypass (Lenie AUTH-02).
3. Force-destroy stuck pods — NEW. Student DELETE is 409. Not on current PR #44 HEAD.
4. Lab reset — NEW. Destroy → poll until `DESTROYED` → provision (same `scenario_id`, timeout + cleanup-failure UI). Do not provision on destroy HTTP 200. Scores stay unless separately wiped.
5. Portal `/api/capacity` proxy — portal-only.
6. `FAILED_ROLLBACK_COMPLETE` hidden from list.

---

## Handoff

- **Maricar:** mock Admin UI from this table. Derive IPs. No `count` / `ips` schema. Treat `can_provision` as advisory; handle provision 409/503. Lab reset waits for `DESTROYED`.
- **Lenie:** role guard + owner bypass for list/status/destroy.
- **Leonardo:** after PR #44 is on `main`, `feature/admin-pod-management` — list-all + disposable destroy; force-destroy/reset only if still missing.

This audit does not change student provisioning behavior.
