# Second host — Chapter 08: Verification

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
| 1 | Infrastructure | disk, memory, pool, networks, containers | |
| 2 | Services | three user units + cloudflared (sudo) + keycloak (in container) | |
| 3 | Binds | lxdbr0 only; nothing on 0.0.0.0 | |
| 4 | Student journey over HTTPS | login, create, both terminals, DVWA, destroy | |
| 5 | **Reboot persistence** | `sudo reboot`; everything returns without manual steps | |
| 6 | Security | SSH /32; no LXD 8443; `.env` 600; data dir 700 | |
| 7 | Cleanup | delete loop filtered to `^pod-student-`; guacamole + wazuh-manager survive | |
| 8 | **Recreate-ready** | if all PASS: L6 in PROJECT-LAYER-PLAN moves off `[~]`, citing this file | |

---

## Output

```text
<paste the command output that backs each gate above>
```

---

## Deviations from the Manual

Anything you had to do that Chapter 08 does not say, or that it says wrongly.
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

Chapter — (run complete).
