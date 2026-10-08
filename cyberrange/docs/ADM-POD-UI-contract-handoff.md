# ADM-POD-UI Contract Handoff

**Audience:** Maricar Punzalan (ADM-POD-UI [#33](https://github.com/lmarellanojr/Capstone2-deploy/issues/33) owner)  
**Author:** Leonardo Arellano (backend lifecycle contract)  
**Date:** 2026-09-17  
**Baseline `main` tip:** `9503917` (includes PR [#50](https://github.com/lmarellanojr/Capstone2-deploy/pull/50) ADM-POD + PR [#51](https://github.com/lmarellanojr/Capstone2-deploy/pull/51) AUTH-02)  
**Related issues:** Relates to #33 — **does not** close #33. ADM-UI [#31](https://github.com/lmarellanojr/Capstone2-deploy/issues/31) still **OPEN** (UI integration gate). ADM-SYS-01 [#37](https://github.com/lmarellanojr/Capstone2-deploy/issues/37) queued separately.

**Source of truth for Admin pods:** this note + merged PR #50 / `test_admin_pods.py`. Prefer this over stale sections of `docs/P0-01-pod-api-contract.md` that still say Admin force-destroy is missing or status is owner-only.

Sanitized fixtures: [`fixtures/adm-pod-ui-samples.json`](fixtures/adm-pod-ui-samples.json).

---

## 1. Purpose / non-goals

### Purpose
Give Maricar an implementation-ready contract for later Admin Pods UI integration (#33): exact FastAPI routes, auth, fields, samples, error matrix, destroy accepted-vs-completed polling, and portal adapter gaps.

### Non-goals (this handoff)
- **Do not** implement Admin UI (#33 stays NOT STARTED until Maricar starts it).
- **Do not** add FastAPI routes or change `auth.py` / `pods_router.py`.
- **Do not** claim a reset API exists.
- **Do not** treat `DELETE /progress/{scenario_id}` as lab reset (it wipes scores).
- **Do not** close #33 with a docs-only PR (`Relates to #33` only).

Leonardo reviews Maricar’s #33 UI later for contract fidelity. Review ≠ implementation ownership of #33.

---

## 2. FastAPI routes (authoritative)

| Method | FastAPI path | Auth | Admin behavior | Student / Instructor |
|--------|--------------|------|----------------|----------------------|
| `GET` | `/pods` | `verify_token`; Admin via `"admin" in extract_roles(claims)` | No query → all **live** pods (`status NOT IN ('DESTROYED','FAILED_ROLLBACK_COMPLETE')`). `?student_id=` → that owner’s live pods only | Self-scoped by `preferred_username`; query param ignored |
| `GET` | `/pods/{pod_id}/status` | `require_owner_or_admin` | Inspect any pod if row exists (incl. `DESTROYED` / `FAILED_ROLLBACK_COMPLETE`) | Owner only; else **404** (not 403) |
| `GET` | `/capacity` | **None** (unauthenticated **200**) | Same payload for all callers | Same |
| `DELETE` | `/admin/pods/{pod_id}/force-destroy` | `verify_token` + `require_role(["admin"])` | CAS allows `ACTIVE` / `FAILED_ROLLBACK_COMPLETE` only → **200** `{ "status": "destroying", "pod_id": N }` and schedules `perform_destruction` | Student / Instructor **403**; unauthenticated **401** |

### Not Admin APIs — do not wire Admin Destroy / inspect bypass here

| Path | Why |
|------|-----|
| `DELETE /pods/{pod_id}/destroy` | **Owner-only** student destroy (`require_owner`) |
| `GET /pods/{id}/guac-token`, `/lab-urls`, verify, milestones, alerts | **Owner-only**; Admin bypass is **not** applied |

Instructor host-wide overview (stripped `vmid_*`) is `GET /instructor/pods`, **not** Admin `GET /pods`.

---

## 3. Portal adapter reality (read-only findings)

| Portal today | Proxies to | Gap for #33 |
|--------------|------------|-------------|
| `GET /api/pods` | `GET /pods` | Exists. Admin session with `admin` role should receive all-live list. **Does not forward** `?student_id=` today (`app/api/pods/route.ts`). Filter client-side or append `req.nextUrl.search` in #33. |
| `GET /api/pods/{id}/status` | `GET /pods/{id}/status` | Exists. Admin inspect works via `require_owner_or_admin`. |
| `DELETE /api/pods/{id}/destroy` | **`DELETE /pods/{id}/destroy`** (student) | **Wrong target for Admin.** Add a portal proxy to `DELETE /admin/pods/{id}/force-destroy`. Do **not** reuse student destroy. Do **not** call `provisioning.destroyPod` / `api.destroyPod` from Admin UI (`portal/src/lib/api.ts`). |
| No `/api/capacity` | FastAPI `GET /capacity` exists | Add a minimal portal proxy for ADM-POD-01. Mock `mockCapacity` keys do **not** match FastAPI. |
| Offline `proxyToApi` fallback for `GET /pods` | `{ pods: [], count: 0 }` | Live FastAPI has **no** `count`. Do not treat `count` as contract. `listPods` TS type currently expects `count` — fix when wiring. |
| Admin pods page | `mockPods` + disabled Reset/Destroy | Replace mock; hide/disable Reset; Destroy only after confirm → Admin force-destroy. |

---

## 4. Field contract

### 4.1 List vs status shape

| Endpoint | Shape |
|----------|--------|
| `GET /pods` | `{ "pods": [ ... ] }` — each item is `serialize_pod(row)` = full SQLite row dict + TTL fields. **No top-level `count`.** May include SQLite PK **`id`** **and** **`pod_id`**. |
| `GET /pods/{pod_id}/status` | `PodResponse` only. Tests assert **`"id" not in body`**. Use **`pod_id`** as the UI identity — never map mock/`id` string to SQLite `id`. |

### 4.2 Required / useful fields for Admin table + detail

From `PodResponse` / `serialize_pod` (TTL via `ttl_payload`):

| Field | Type (runtime) | Notes |
|-------|----------------|-------|
| `pod_id` | `int` | Primary UI key |
| `student_id` | `string` | Keycloak username — **not** a display name |
| `status` | `string` (uppercase) | See status enum below |
| `scenario_id` | `string \| null` | |
| `vmid_kali`, `vmid_meta`, `vmid_dvwa` | `string \| null` | e.g. `pod-student1-kali`. Admin list **keeps** these (do not use `serialize_instructor_pod`) |
| `connection_id` | `int \| null` | |
| `wazuh_agent_id` | `string \| null` | |
| `created_at` | `string \| null` | |
| `last_heartbeat` | `string \| null` | |
| `ttl_minutes`, `remaining_seconds`, `expires_at`, `ttl_expired` | TTL helper fields | |

### 4.3 Status enum (backend)

`PROVISIONING` | `ACTIVE` | `DESTROYING` | `DESTROYED` | `FAILED_ROLLBACK_COMPLETE`

These are the statuses set/filtered by the provisioning backend on `main` (`pods_router.py` / destroy+reaper paths). `#33` does not need defensive UI for other labels.

**Not** backend statuses: mock `stopped`, lowercase `active` / `failed`. Stale TS union member `ORPHANED_CLEANED` in `portal/src/lib/api.ts` is not produced by the API — drop it when touching that type in #33.

### 4.4 Capacity payload (`GET /capacity`)

| Key | Notes |
|-----|--------|
| `active_pods` | Live count (excludes `DESTROYED` / `FAILED_ROLLBACK_COMPLETE`) |
| `max_pods` | |
| `can_provision` | **Snapshot**, not a reservation guarantee |
| `available_mb` | `int \| null` (null if host meminfo unavailable) |
| `pod_ram_mb`, `ram_buffer_mb`, `ram_required_mb`, `profile` | |

Mock `podsInUse` / `storageUsedGb` are **not** this contract.

### 4.5 Mock / TS mismatches to fix in #33

| Topic | Backend | Current Admin mock / TS |
|-------|---------|-------------------------|
| Identity | `pod_id: int` | mock `id: "pod-a1f9"` |
| Owner | `student_id` | mock `student` display name |
| Status | Uppercase enum | lowercase; includes fake `stopped` |
| VMs | string names | `portal/src/lib/api.ts` `Pod.vmid_*` typed as `number` — **TS bug**, not a backend change |

---

## 5. Destroy: accepted vs completed + polling

1. Admin confirms Destroy on a **disposable** pod (prefer list-visible `ACTIVE`; `FAILED_ROLLBACK_COMPLETE` is destroyable via status-by-id but **hidden** from `GET /pods`).
2. `DELETE /admin/pods/{pod_id}/force-destroy` → **200** `{ "status": "destroying", "pod_id": N }` means **accepted/scheduled**, not LXD finished. DB row becomes `DESTROYING`.
3. Poll `GET /pods/{pod_id}/status` until JSON `status === "DESTROYED"` (uppercase). `perform_destruction` **updates** the row; it does **not** delete it.
4. After `DESTROYED`, `GET /pods` **omits** the row. Status-by-id still returns it if present.
5. **Do not** treat poll **404** as success. Student `useStatusPoller(..., "destroy")` maps 404 → `DESTROYED` for the **student** path — **do not import that behavior for Admin**. Admin 404 = unknown pod / proxy miss / non-owner 404 semantics — not teardown proof.
6. Transient 5xx / network: keep polling; do not mark complete.
7. Disable Destroy for `PROVISIONING` and `DESTROYING` (both **409**). Stuck `DESTROYING` retries are the **reaper** after `STUCK_POD_GRACE_MINUTES`.

---

## 6. Action / error matrix

| Action | Caller | Expected |
|--------|--------|----------|
| `GET /pods` | Admin | **200**, all live pods (`vmid_*` present; no `count`) |
| `GET /pods?student_id=student1` | Admin | **200**, that owner’s live pods only (backend; portal must forward query) |
| `GET /pods` | Student | **200**, own live pods |
| `GET /pods` | Instructor | **200**, only pods owned by instructor username (typically empty) — **not** host-wide |
| `GET /pods` | No token | **401** |
| `GET /pods/{id}/status` | Admin, other student’s pod | **200** |
| `GET /pods/{id}/status` | Student/Instructor non-owner | **404** |
| `GET /pods/{id}/status` | Missing id | **404** |
| `GET /capacity` | Anyone | **200** |
| `DELETE /admin/pods/{id}/force-destroy` | Admin, `ACTIVE` | **200** `{status: destroying, pod_id}` |
| same | Admin, `FAILED_ROLLBACK_COMPLETE` | **200** (CAS allows; row not in live list) |
| same | Admin, `PROVISIONING` | **409** |
| same | Admin, `DESTROYING` | **409** |
| same | Admin, `DESTROYED` | **409** |
| same | Student / Instructor | **403** |
| same | No token | **401** |
| same | Unknown id | **404** |
| Reset control | — | **Disabled / hidden** — no API |

---

## 7. Reset

**Unavailable.** PR #50 did not add a reset/recreate API. A reliable reset would be orchestration: destroy → poll until `DESTROYED` → provision same `scenario_id` (future work). **Never** use `DELETE /progress/{scenario_id}` (score wipe).

---

## 8. `FAILED_ROLLBACK_COMPLETE`

- Hidden from `GET /pods` live list.
- Destroyable by Admin force-destroy if Admin knows `pod_id` (status-by-id).
- UI: do not expect these rows in the overview table unless a separate admin query is added later.

---

## 9. INST-01 screen / field check

`portal/src/app/instructor/page.tsx` (still mock as of this baseline):

- Cards: Students, Pending Reviews, **Active Pods**.
- **Active Pods** = `mockStudents.filter(s => s.activePod).length` — **not** Admin `GET /pods` and **not** `GET /capacity.active_pods`.
- Review queue fields are review-case shaped, not pod-row shaped.
- Instructor host-wide pods: `GET /instructor/pods` (strips `vmid_*`).

**Do not** wire INST-01 to Admin force-destroy or Admin unfiltered `GET /pods`. If an INST-01 plan expects Admin-shaped rows for the Instructor dashboard, adjust INST-01 (owner: Maricar) — Leonardo does not change Instructor APIs in this handoff.

---

## 10. Future adapter / UI checklist (#33)

Gate real UI work on ADM-UI **#31** (or an explicit exception from #31’s owner).

- [ ] Map mock columns → `pod_id`, `student_id`, `scenario_id`, `status`, `created_at` (+ optional `vmid_*` on detail)
- [ ] Uppercase status badges; drop mock `stopped`
- [ ] Capacity from FastAPI keys (`active_pods`, `max_pods`, `can_provision`, `available_mb`, …) — not mock GB storage
- [ ] Confirm dialog before force-destroy; disposable pod only
- [ ] After **200**, poll status until `DESTROYED`; handle 409/403/401; **never** 404-as-success
- [ ] Disable Destroy for `PROVISIONING` / `DESTROYING`
- [ ] Hide/disable Reset; tooltip: no reset API
- [ ] New portal proxy → `DELETE /admin/pods/{id}/force-destroy` (do not call `/api/pods/{id}/destroy`)
- [ ] Keep Student `DELETE /pods/{id}/destroy` unchanged
- [ ] Optional: forward `?student_id=` on `GET /api/pods` or filter client-side
- [ ] Fix TS `Pod.vmid_*` to `string | null` and drop false `count` requirement when touching `api.ts`
- [ ] Do not reuse `useStatusPoller(..., "destroy")` as-is for Admin

---

## 11. Unresolved API questions + owner

| Question | Recommendation | Owner |
|----------|----------------|--------|
| Treat student-poller 404 as DESTROYED in Admin UI? | **No** — poll until `status === "DESTROYED"`. | Maricar (#33) |
| New portal route for force-destroy? | **Yes** — e.g. `DELETE /api/admin/pods/[id]/force-destroy` → FastAPI Admin path. | Maricar (#33) |
| Capacity proxy vs ADM-SYS-01 #37? | Minimal `GET /api/capacity` proxy is enough for ADM-POD-01; richer health stays #37. | Maricar (#33) / Leonardo (#37 later) |
| Display name vs `student_id`? | Backend has username only; names need user directory (ADM-USER / Keycloak). Fallback UI to `student_id`. | Lenie (users) / Maricar (UI) |
| Reset? | Unavailable until a later validated composition. | Leonardo (backend) — deferred |
| Forward Admin `?student_id=` through portal? | Needed only if Admin UI filters server-side; else filter client-side from full list. | Maricar (#33) |

---

## 12. Test evidence

**Baseline:** `9503917` (`Merge pull request #51 … AUTH-02`)  
**Host:** isolated temp SQLite via pytest; `perform_destruction` mocked in Admin destroy tests — **no** live LXD / `pod_mgmt.db`.

```text
cd cyberrange/src/provisioning
python -m pytest test_admin_pods.py test_reviews.py test_pod_ttl.py test_score_persistence.py -q
```

**Result (2026-09-17):** `76 passed, 10 warnings` (FastAPI `on_event` deprecation only).

Live destructive Admin UI tests: **not executed** in this documentation task (out of scope).

---

## 13. Abbreviated sanitized samples

Full JSON: [`fixtures/adm-pod-ui-samples.json`](fixtures/adm-pod-ui-samples.json).

**Admin `GET /pods` 200 (excerpt):**
```json
{
  "pods": [
    {
      "pod_id": 1,
      "student_id": "student1",
      "status": "ACTIVE",
      "scenario_id": "01",
      "vmid_kali": "pod-student1-kali",
      "vmid_meta": "pod-student1-meta",
      "vmid_dvwa": "pod-student1-dvwa"
    }
  ]
}
```

**Force-destroy accepted 200:**
```json
{ "status": "destroying", "pod_id": 1 }
```

**PROVISIONING rejected 409:** detail includes `Pod is PROVISIONING, cannot force-destroy from this state`.
