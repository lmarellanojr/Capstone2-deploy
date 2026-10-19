# Scenario 1 check diagnostics

Instructors get a reason when a Scenario 1 (Network Reconnaissance & Exploitation, scorer id 1) check fails. Students still see the generic result. Switches, storage, access and rollback are shared with every scenario: see [SCORING-DIAGNOSTICS.md](SCORING-DIAGNOSTICS.md).

## Live checks (baseline)

`check_scenario_1` runs on the student's Kali container. Read at the release before this change:

| Milestone | Pass condition, in the order checked |
|---|---|
| M1 host discovery | eth0 has an IPv4 address → an `nmap … <this pod>.0/24` line in shell history or snoopy log → a route to a `10.0.N.0/24` pod subnet now |
| M2 port enumeration | eth0 has an IPv4 address → a pod-subnet route now → `nmap` with `-p`/`-F` against this pod's `.20` or `.30` |
| M3 service versions | eth0 has an IPv4 address → `nmap -sV` against this pod's `.20` or `.30` → a pod-subnet route now |
| M4 Tomcat manager exploit | eth0 has an IPv4 address → exactly one tmux `lab` pane, running msfconsole → its output shows a `tomcat_mgr_deploy` run that opened a session to this pod's `.20` → msfconsole still holds that connection |

M5 (flag) is scored by flag submission, not by this script, and has no reasons.

## Reason codes

| Code | Milestones | Meaning |
|---|---|---|
| `NO_POD_ADDRESS` | 1–4 | eth0 had no IPv4 when scoring ran, so the check could not tell which subnet is this pod's |
| `NO_SUBNET_ROUTE` | 1–3 | no route to a pod subnet when scoring ran. It is checked at verify time, not when the scan ran, so it says nothing about whether the scan reached its targets |
| `COMMAND_NOT_FOUND` | 1–3 | no `nmap` run where a command starts (line start, after `;` `&` `\|`, or snoopy's `]: `; optionally behind `sudo` or a path) with an argument. `man nmap \| less`, `sudo apt install nmap -y`, `which nmap` and `zenmap` don't count |
| `COMMAND_NOT_MATCHED` | 1–3 | an `nmap` command with arguments was run, but none matched this milestone's flags and this pod's target |
| `MSF_NOT_RUNNING` | 4 | no single `lab` pane, or that pane isn't running msfconsole |
| `SESSION_NOT_OPENED` | 4 | msfconsole is running, but its output shows no `tomcat_mgr_deploy` session to this pod's meta |
| `SESSION_NOT_LIVE` | 4 | a session was opened, but msfconsole no longer holds a connection to it |
| `CHECK_ERROR` | 1–4 | the check could not run (`ip`, tmux, ss or runuser missing, malformed pane data) or the verifier returned ERROR. A missing `ip` is checked first, so it is not reported as `NO_POD_ADDRESS`/`NO_SUBNET_ROUTE` |

The reason is the **first** condition that failed, in the order above. So, for example, M1 with no nmap and no route reports `COMMAND_NOT_FOUND` (the command is checked first), while M2 with the same state reports `NO_SUBNET_ROUTE`.

`COMMAND_NOT_MATCHED` only says that some `nmap` command exists. It does not say what was wrong with it, because the check doesn't record which line came closest. The DIAG line never carries commands, addresses or pane text, and the reason is never written to Kali's scoring log.

## Rollout

1. Enable only after the Scenario 3 pilot has been reviewed: add `1` to `SCORING_DIAGNOSTICS_SCENARIOS` (e.g. `9,1`) and restart the API.
2. On one pod, cause one failure per code you can reproduce: no scan yet, a scan of the wrong subnet, `-p` missing on M2, `-sV` missing on M3, msfconsole closed, the exploit run without a session, then `sessions -K`.
3. Compare each reason in the instructor panel with what the student actually did, and confirm the PASS/FAIL the student saw is unchanged.
4. Roll back by removing `1` from the list and restarting.
