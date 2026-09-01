# Second host — Chapter 00: Prerequisites

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
| 1 | OCI account is Always Free eligible | quota shows an available A1 shape | |
| 2 | SSH keypair generated | `~/.ssh/id_oci_arm64` + `.pub` exist | |
| 3 | Key is NOT registered under Identity -> Users -> API Keys | confirmed; it goes in the instance launch field | |
| 4 | Cloudflare zone active, Zero Trust -> Tunnels reachable | screenshot | |
| 5 | Ubuntu 24.04 (Noble) aarch64 offered in the launch wizard | no image upload needed | |
| 6 | Compartment OCID noted | recorded off-repo | |

---

## Output

```text
<paste the command output that backs each gate above>
```

---

## Deviations from the Manual

Anything you had to do that Chapter 00 does not say, or that it says wrongly.
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

Chapter 01.
