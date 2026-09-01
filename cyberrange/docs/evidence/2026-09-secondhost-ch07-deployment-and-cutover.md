# Second host — Chapter 07: Deployment and cutover

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
| 1 | **Path B gate — login** | student reaches /dashboard over http://10.115.77.12 via SSH tunnel | |
| 2 | **Path B gate — pod** | PROVISIONING -> ACTIVE; three containers on 10.0.51.{10,20,30} | |
| 3 | **Path B gate — kali** | `whoami` -> student; eth0 up; `default via 10.0.51.1` | |
| 4 | **Path B gate — meta** | `whoami` -> msfadmin | |
| 5 | **Path B gate — DVWA** | login.php, **not** setup.php | |
| 6 | **Path B gate — destroy** | pod gone; `can_provision` back to true | |
| 7 | Ch 06 deferred checks (if scoring on) | agent active; `/pods/1/alerts` 200 | |
| 8 | cloudflared installed | version, aarch64 | |
| 9 | Token placed | `/etc/cloudflared/token` 600 owner llms_admin | |
| 10 | Unit is a **system** unit | `/etc/systemd/system/cloudflared.service`, enabled, active | |
| 11 | Tunnel registered | `Registered tunnel connection` in journal | |
| 12 | **Secrets rotated (all five)** | Wazuh admin, Keycloak admin, client secret, NEXTAUTH_SECRET, student pw | |
| 13 | Public hostname | one HTTP hostname, origin **10.115.77.12:80** | |
| 14 | **Internet probe** | tunnel /login 200; public IP :80/:443/:3000/:5000/:8765/:18301 all **timeout** | |
| 15 | URLs flipped | NEXTAUTH_URL + public issuer HTTPS; server-side issuer stays Path B | |
| 16 | HTTPS login from a **home browser** | reaches /dashboard (a VM-side script is not proof) | |

---

## Output

```text
<paste the command output that backs each gate above>
```

---

## Deviations from the Manual

Anything you had to do that Chapter 07 does not say, or that it says wrongly.
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

Chapter 08.
