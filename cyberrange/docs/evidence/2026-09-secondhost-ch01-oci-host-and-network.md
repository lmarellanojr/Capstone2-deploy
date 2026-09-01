# Second host — Chapter 01: OCI host and network

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
| 1 | Shape proof | `uname -m` aarch64; `nproc` 2; `free -g` ~11 | |
| 2 | Disks | boot ~46.6G + block 150G on `/dev/sdb` | |
| 3 | btrfs mounted | `df -h /mnt/ampere-lxd` shows 150G | |
| 4 | LXD pool | `lxc storage info default` -> total space 150.00GiB | |
| 5 | lxdbr0 | `ipv4.address` 10.115.77.1/24 | |
| 6 | **OCI packet filter** | `lxd_oci_iptables=PASS`; `cyberrange-lxd-iptables.service` active | |
| 7 | **Container egress** | `nettest` pings 1.1.1.1 — this gates Chapters 02 and 03 | |
| 8 | **zram** | `systemd-zram-setup@zram0` active; `swapon --show` = /dev/zram0 3G lz4; no disk swap | |
| 9 | VCN ingress | TCP 22 from your `/32` only. **No 80, no 443.** Screenshot the full table | |
| 10 | Repo on host | the nine-file `OK/MISS` loop — every line OK | |
| 11 | Data dir | `~/cyberrange-data` mode 700 | |

---

## Output

```text
<paste the command output that backs each gate above>
```

---

## Deviations from the Manual

Anything you had to do that Chapter 01 does not say, or that it says wrongly.
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

Chapter 02.
