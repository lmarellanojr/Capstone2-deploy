# Provision helpers (packed into Capstone2)

Tracked, unit-testable provision helpers. Live in `src/provisioning/` on the host (`~/cyberrange`). Copy these files to the VM; do not copy listen addresses from another machine.

## Contents

| File | Role |
|------|------|
| `guest_nic.py` | Kali/meta/dvwa eth0 UP + `/24` + **default via .1** |
| `dvwa_compose.py` | Official DigiNinja compose (`db` + `DB_SERVER=db`) + `docker-compose up` |
| `dvwa_ready.py` | Import `dvwa-init.sql` / setup POST if `users` missing |
| `alerts_reader.py` | `list_siem_alerts` — 64 MiB tail, allowlist (no `full_log`) |
| `alerts_endpoint.py` | `GET /pods/{id}/alerts` router |
| `test_*.py` | Unit tests (FakeInst; no LXD) |
| `provision.py` | **Reference only** — hook sites, not a live drop-in |

## Deploy rules (M4 and Ampere)

- **Do not** `scp` this folder’s `provision.py` over the live file (Issue 9 key install).
- Deploy `guest_nic.py` + `dvwa_compose.py` + `dvwa_ready.py` + `alerts_reader.py` + `alerts_endpoint.py` (+ tests).
- Wire hooks **surgically** in live `provision.py` / `provision_api_fastapi.py`.
- `/alerts`: `include_router` + `dependency_overrides[verify_token_dep]` (not `ae.verify_token = …`). Restart the API after scp.

## Tests

```bash
cd src/provisioning
python -m pytest test_guest_nic.py test_dvwa_compose.py test_dvwa_ready.py test_alerts_reader.py test_alerts_endpoint.py -v
```
