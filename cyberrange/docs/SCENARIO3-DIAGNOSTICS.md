# Scenario 3 check diagnostics

Instructors get a reason when a Scenario 3 (SIEM Alert Triage, scorer id 9) artifact check fails. Students still see the generic result. Scoring rules, points, milestone history and pod teardown are unchanged.

## How it works

1. `check_scenario_9` in `scoring_checks.sh` runs the same predicates in the same order as before. It reports the first one that fails as a code, on one line before the unchanged `PASS`/`FAIL` token:

   ```
   DIAG reason=AGENT_MISMATCH location=HOME_MSFADMIN copies=2
   FAIL
   ```

   Callers read only the last line, so the token contract is the same.
2. `SSHVerifier.verify_milestone_detailed` parses that line through `scoring_diagnostics.parse_diag`. Anything off-format is dropped, and an unknown code becomes `CHECK_ERROR`. `verify_milestone` still returns `(status, message)`, and the message is still `Check completed: FAIL`.
3. `scoring.verify_milestone` writes the score row exactly as before. Then, only for scenario 9 and only when the feature is on, it upserts one `scoring_diagnostics` row. A database error here is logged and swallowed, so it never affects scoring.
4. `GET /instructor/students/{student_id}/diagnostics` (instructor or admin) returns the rows. The portal shows them in the **Scenario 3 check reasons** panel on the instructor student page.

## Reason codes

| Code | M1 triage | M2 timeline | M3 report |
|---|---|---|---|
| `ARTIFACT_MISSING` | no `alert_triage.json` | no `incident_timeline.md` | no `incident_report.txt` |
| `ARTIFACT_UNREADABLE` | file exists, can't be read | same | same |
| `ARTIFACT_INVALID` | none of `alert_id`/`severity`/`rule` | — | none of system/attack/alert/recommend |
| `PLACEHOLDER_OR_EXAMPLE` | `PASTE…`/`HH:MM`/`<…>` or guide fiction | same | guide fiction or the §5 example report |
| `AGENT_MISSING` | no `agent … pod-…-meta` | — | no pod-…-meta named |
| `AGENT_MISMATCH` | a pod-…-meta, not this lab's | — | a pod-…-meta, not this lab's |
| `RULE_MISSING` | no 5710 and no rule number | no `rule`/`Rule … 5710` line, no rule number | no 5710, no rule number |
| `RULE_MISMATCH` | a rule number, not 5710 | same | same |
| `TIMESTAMP_MISSING` | no ISO `…Z` time | no `…Z` on a rule 5710 line | — |
| `TIMESTAMP_NOT_MATCHED` | `…Z` not within ±5 min of a real invalid-user SSH event | same | — |
| `REPORT_TOO_SHORT` | — | — | ≤ 200 bytes |
| `REPORT_BODY_TOO_SHORT` | — | — | < 120 chars after headings |
| `CHECK_ERROR` | no auth log, unknown agent, or verifier ERROR | no auth log or verifier ERROR | unknown agent or verifier ERROR |

**Reasons follow what the scorer read.** The M1 agent check and the M2 timeline check read the file line by line. They skip a last line with no trailing newline, and the timeline check only reads lines starting `rule`/`Rule` (not `RULE`). The reasons are computed the same way, so they name what the scorer actually saw:

- `AGENT_MISSING` on a one-line triage file can mean the correct agent is on a final line with no newline.
- `RULE_MISSING` on a timeline can mean the rule 5710 line has no final newline or is written `RULE 5710`.

Have the student check the file in either case. Fixing the scorer itself changes scores, so it is tracked separately in #243.

A row is stored for a PASS too (`reason_code` NULL). It replaces the earlier failure for that lab and milestone. JSON syntax was never a scoring predicate, so a malformed but otherwise complete triage file still passes, and it gets no reason.

## Artifact location

The guide's `/home/msfadmin` is checked first, then `/home/student`, then `/tmp`. Students who saved only to `/tmp` still score. A stale `/tmp` copy can no longer override the file the guide told the student to edit. This is the one intended change in which file gets scored: before, `/tmp` was checked first. `location` records which directory was used, as a fixed name rather than a path. `copies` records how many supported directories held the file.

## What is stored

Each row holds the reason code, location name, copy count, student id, pod id, `pod_created_at`, the open `lab_sessions.id`, scenario, milestone, status, check count, and first/last seen time. Artifact contents, shell output, exception text and student-chosen paths are never stored. There is one row per student + pod slot + `pod_created_at` + milestone, so repeated polls update a single row. A reused pod slot gets a new row.

## Access

- The role is checked first: `auth.require_role(["instructor", "admin"])`. Students and accounts with no role get 403, including for their own id.
- Rows are always scoped to the path's `student_id`. `pod_id` and `pod_created_at` can narrow the result to one lab.
- Values are re-checked against the allowlists on read, and React escapes everything it displays.
- Student routes (`/progress`, `/pods/{id}/milestones`, verify responses) are unchanged and carry no reason.

## Configuration

| Variable | Default | Effect |
|---|---|---|
| `S3_DIAGNOSTICS_ENABLED` | off | `1` records diagnostics for scenario 9 |
| `S3_DIAGNOSTICS_RETENTION_DAYS` | `14` | rows not updated for this many days are purged |

The score poller purges at most once an hour, and it does so even when the flag is off.

## UAT rollout

1. Deploy. The API runs migration v14 on startup. Back up `pod_mgmt.db` first.
2. Set `S3_DIAGNOSTICS_ENABLED=1` in the API environment and restart the API.
3. Run a few observed submissions on one pod: one passing set, then one failure per milestone (missing file, wrong agent, wrong rule, fabricated time, short report, a stale `/tmp` copy next to a correct `/home/msfadmin` file).
4. For each one, compare the panel's reason and location with the actual file and the PASS/FAIL the student saw.
5. Confirm that a Student account gets 403 on `/api/instructor/students/<id>/diagnostics`.
6. Watch the table's size: `SELECT COUNT(*) FROM scoring_diagnostics;` should stay at no more than 3 rows per lab.
7. Expand use only after the team reviews the evidence.

## Rollback

- **Fast (diagnostics only):** unset `S3_DIAGNOSTICS_ENABLED` and restart. Nothing new is recorded, the panel hides itself, and old rows age out. This does **not** revert the artifact path order: `/home/msfadmin` before `/tmp` is in `scoring_checks.sh` and is not behind the flag. Scoring keeps the new order.
- **Code:** redeploy the last known-good release. This is the only way to restore the old `/tmp`-first path order if UAT shows a problem with it. The v14 table stays and is inert: older `migrate.apply()` skips versions it has already applied, and `milestone_verification` was never altered. Older code reads the scorer's last line only, so it is unaffected by the DIAG line. Dropping the table needs TRB approval (see `schema/README.md`).
