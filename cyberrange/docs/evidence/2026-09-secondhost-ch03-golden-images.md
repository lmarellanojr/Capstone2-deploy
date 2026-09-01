# Second host — Chapter 03: Golden images

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
| 1 | Filter confirmed | `cyberrange-lxd-iptables.service` active (installed in Ch 01) | |
| 2 | Containers stopped if Ch 02 already ran | guacamole + wazuh-manager stopped for the bake | |
| 3 | Bake invoked correctly | `REPO=$HOME/cyberrange PHASE3=... bash deploy/oci_build_goldens_arm64.sh` | |
| 4 | Three bases published | kali-base, meta-base, dvwa-base | |
| 5 | Sizes sane | ~4.5 GiB / ~600 MiB / ~1.0 GiB | |
| 6 | Pool usage | `space used` ~6.5GiB — **not** tens of GiB | |
| 7 | **Student account baked** | `lxc exec test-kali -- su - student -c whoami` -> `student` | |
| 8 | No builders left | no `*-build` or `bake-*` in `lxc list` | |
| 9 | wazuh-agent rebake (optional) | meta-base + agent 4.7.5; rollback alias created | |
| 10 | dvwa-ready rebake | `users` table present; description ends `security low` | |

---

## Output

```text
<paste the command output that backs each gate above>
```

---

## Deviations from the Manual

Anything you had to do that Chapter 03 does not say, or that it says wrongly.
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

Chapter 04.
