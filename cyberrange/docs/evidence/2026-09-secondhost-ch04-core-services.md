# Second host — Chapter 04: Core services

**Date:** 2026-09-__ (UTC __:__Z)
**Host:** `llms_admin@<SECOND_HOST_PUBLIC_IP>` (instance `<name>`)
**Manual commit:** `<sha of C:\Capstone2-Manual at the time of the run>`
**Product commit:** `<sha of the ~/cyberrange checkout on the host>`
**Verdict:** **PASS | FAIL | PARTIAL**

> Fill this in **as you go**, not afterwards. Paste real output; do not retype it.
> A gate with no output pasted under it is **NOT VERIFIED**, not PASS.

---

## Gates

| # | Gate | Expected | Result |
|---|---|---|---|
| 1 | Linger | `loginctl show-user` -> Linger=yes | |
| 2 | Keycloak installed in guacamole | `keycloak native install: OK`; master well-known 200 | |
| 3 | `/auth/` through nginx | 302 (404 = nginx needs stop/start, not reload) | |
| 4 | **Realm created** | `REALM_OK`; cyber-range well-known 200; issuer = http://10.115.77.12/auth/realms/cyber-range | |
| 5 | Secrets written | `env/.env` has a non-empty client secret; `cyberrange-data/student.env` mode 600 | |
| 6 | Path B redirect URI added | portal client has both 10.115.77.1:3000/* and 10.115.77.12/* | |
| 7 | API venv | `import fastapi, uvicorn, pylxd` OK | |
| 8 | Node | `~/opt/node/bin/node --version` -> v20.18.1 | |
| 9 | Portal shipped from the PC | `.next` + public + lockfile; `npm ci --omit=dev` on host | |
| 10 | Bridge venv + env | websockets 12.0; `.env.bridge` mode 600 | |
| 11 | Units | provision-api / portal / ssh-bridge all `active (running)` | |
| 12 | Portal memory cap | `MemoryMax=536870912` | |
| 13 | **Binds** | `ss -ltn` = 10.115.77.1:{5000,3000,8765}. **No 0.0.0.0** | |
| 14 | API | `/health` ok; `/capacity` profile oci_12gib, ram_required 5632 | |
| 15 | **Auth on** | unauthenticated `GET /pods` -> **401** | |
| 16 | Bridge handshake | `/api/ssh-websocket` -> 101 then timeout (correct) | |
| 17 | Unit templates | `pytest deploy/systemd/test_validate_units.py` -> 8 passed | |

---

## Output

```text
<paste the command output that backs each gate above>
```

---

## Deviations from the Manual

Anything you had to do that Chapter 04 does not say, or that it says wrongly.
**This section is the point of the whole run** — it is what Phase 3 fixes.

| # | Manual says | What was actually needed | Chapter/§ |
|---|---|---|---|
| 1 | | | |

If this table is empty, say so explicitly: "No deviations." An empty table with no
statement reads as "not filled in."

---

## Time

| | |
|---|---|
| Started | |
| Finished | |
| Blocked on | |

---

## Next

Chapter 05.
