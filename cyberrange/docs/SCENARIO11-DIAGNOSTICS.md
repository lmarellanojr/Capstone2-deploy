# Scenario 4 (scorer id 11) check diagnostics

Instructors get a reason when a Vulnerability Hardening check fails. The portal calls this lab Scenario 4; the scorer calls it scenario 11. Students still see the generic result. Switches, storage, access and rollback are shared with every scenario: see [SCORING-DIAGNOSTICS.md](SCORING-DIAGNOSTICS.md).

## Live checks (baseline)

`check_scenario_11` runs on the student's meta container. Read at the release before this change:

| Milestone | Pass condition, in the order checked |
|---|---|
| M1 identify the weakness | a `sudo … tomcat-users` line (no pipe before `tomcat-users`) in shell history or the snoopy log |
| M2 apply the remediation | if `/etc/tomcat9/tomcat-users.xml` exists: it no longer has `password="tomcat"` or `password='tomcat'`. If it doesn't: a `sed -i … tomcat-users` line in history |
| M3 confirm the path is closed | `curl -u tomcat:tomcat` to `127.0.0.1:8180/manager/text/list` gets 401 or 403 → a curl to the manager with `tomcat:tomcat` in history |

## Reason codes

| Code | Milestones | Meaning |
|---|---|---|
| `COMMAND_NOT_FOUND` | 1, 3 | no related command at all: nothing naming `tomcat-users` (M1), no curl to the manager or port 8180 (M3) |
| `COMMAND_NOT_MATCHED` | 1, 3 | a related command exists, but not the one the check needs: `tomcat-users` without `sudo` (M1), a manager curl without `tomcat:tomcat` (M3) |
| `DEFAULT_PASSWORD_PRESENT` | 2 | the users file still has the default password, in either quote style |
| `CONFIG_MISSING` | 2 | no users file at the usual path, and no `sed -i` of it in history |
| `OLD_CREDS_ACCEPTED` | 3 | the manager still answers 200 to `tomcat:tomcat` |
| `MANAGER_UNREACHABLE` | 3 | the connection to port 8180 failed |
| `MANAGER_UNEXPECTED_STATUS` | 3 | the manager answered with something other than 200, 401 or 403 |
| `CHECK_ERROR` | 1–3 | curl is missing on meta, or the verifier returned ERROR |

The reason is the **first** condition that failed. M3 checks the manager before history, so a student who never ran the verification curl and never fixed the password gets `OLD_CREDS_ACCEPTED`.

The M3 check makes the same single curl as before; the reason is derived from that one response, so diagnostics add no extra requests to Tomcat. The DIAG line never carries commands, passwords or file text, and the reason is never written to meta's scoring log.

Known quirk, unchanged: an unreadable users file counts as fixed for M2, because `grep` fails and the check reads that as "no default password". The diagnostics follow the scorer and report a pass.

## Rollout

1. Enable only after the Scenario 3 pilot has been reviewed: add `11` to `SCORING_DIAGNOSTICS_SCENARIOS` (e.g. `9,11`) and restart the API.
2. On one pod: read the file with `cat` and no sudo, leave the default password, move the file away with no `sed -i` in history, check M3 with Tomcat stopped, then before and after restarting it, and once without running the verification curl.
3. Compare each reason in the instructor panel with what the student actually did, and confirm the PASS/FAIL the student saw is unchanged.
4. Roll back by removing `11` from the list and restarting.
