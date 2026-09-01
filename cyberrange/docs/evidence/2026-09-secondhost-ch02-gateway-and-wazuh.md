# Second host — Chapter 02: Gateway and Wazuh

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
| 1 | OVN installed | `ovn-central ovn-host openvswitch-switch ovn-northd` all active | |
| 2 | **OVS ovn-remote set before creating networks** | `ovs-vsctl get ... external_ids:ovn-remote` | |
| 3 | vmbr1 | bridge 10.93.10.1/24, dhcp=false, ovn.ranges set | |
| 4 | OVN networks | mgmt-net 10.0.10.1/24 + mon-net 10.0.40.1/24, uplink vmbr1, CREATED | |
| 5 | **Peer wrapper** | `sudo -n /usr/local/sbin/cyberrange-lxc-peer` prints usage, no password prompt | |
| 6 | **Bidirectional peer smoke** | create/list/delete both directions, none hangs | |
| 7 | Profiles | pod-security-base + pod-target-base via REST | |
| 8 | guacamole dual-home | 10.0.10.12 (eth0) + 10.115.77.12 (eth1, needs netplan) | |
| 9 | nginx | `ss -ltn` shows **10.115.77.12:80 only**, never 0.0.0.0 | |
| 10 | nginx sanity | `GET /` -> **502** (portal not up yet). 200 = stock site still bound | |
| 11 | wazuh-manager | 4.7.5-1 held, 3GB, dual-homed 10.0.40.10 + lxdbr0 | |
| 12 | VD off | `ls /var/ossec/tmp | wc -l` -> 0; nvd and msu providers checked individually | |
| 13 | API proxy | `curl -sk https://localhost:55000/` -> 401 | |
| 14 | Cert extracted | SAN shows `DNS:localhost` | |

---

## Output

```text
<paste the command output that backs each gate above>
```

---

## Deviations from the Manual

Anything you had to do that Chapter 02 does not say, or that it says wrongly.
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

Chapter 03.
