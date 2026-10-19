# Scoring check diagnostics

Instructors get a reason when a scored check fails. Students still see the generic result. Scoring rules, points, milestone history and pod teardown are unchanged. Scenario 3 was the pilot ([SCENARIO3-DIAGNOSTICS.md](SCENARIO3-DIAGNOSTICS.md)). Other scenarios use the same pieces, but each has its own reason codes and its own switch.

## Scenarios

| Scorer id | Catalog scenario | Reason codes | Status |
|---|---|---|---|
| 1 | Scenario 1 — Network Reconnaissance & Exploitation | [SCENARIO1-DIAGNOSTICS.md](SCENARIO1-DIAGNOSTICS.md) | Mapped; off until the pilot is reviewed |
| 9 | Scenario 3 — SIEM Alert Triage | [SCENARIO3-DIAGNOSTICS.md](SCENARIO3-DIAGNOSTICS.md) | Pilot |

A scenario is listed here only after its check-to-code map has been reviewed against the live verifier. Codes describe a condition the check actually tested, in the order it tested them. A failure the check can't tell apart stays generic.

## How it works

1. For each listed scenario, its `check_scenario_N` in `scoring_checks.sh` prints one line before the unchanged `PASS`/`FAIL` token:

   ```
   DIAG reason=<CODE> location=<LOC> copies=<N>
   FAIL
   ```

   Callers read only the last line, so the token contract is the same. `reason=NONE` means the check passed. `location` and `copies` are only meaningful for artifact checks; the others print `location=NONE copies=0`.
2. `SSHVerifier.verify_milestone_detailed` parses that line with `scoring_diagnostics.parse_diag(stdout, scenario_id)`. Anything off-format is dropped. A code outside that scenario's list (`REASON_CODES_BY_SCENARIO`) becomes `CHECK_ERROR`.
3. `scoring.verify_milestone` writes the score row exactly as before. Then, only when that scenario is switched on, it upserts one `scoring_diagnostics` row. A database error here is logged and swallowed, so it never affects scoring. Manual Verify and the score poller both go through this path.
4. `GET /instructor/students/{student_id}/diagnostics` (instructor or admin) returns the rows. The portal's **Check reasons** panel on the instructor student page shows one table per scenario.

## What is stored

One row per student + pod slot + `pod_created_at` + scenario + milestone, so repeated polls update a single row and a reused pod slot gets a new one. Each row holds the reason code, location name, copy count, ids, status, check count, and first/last seen time. A PASS replaces an earlier failure (`reason_code` NULL). Artifact contents, commands, shell output, exception text and student-chosen paths are never stored, and the reason is never written to the lab VM's log (the student has sudo there).

## Access

- The role is checked first: `auth.require_role(["instructor", "admin"])`. Students and accounts with no role get 403, including for their own id.
- Rows are always scoped to the path's `student_id`. `pod_id` and `pod_created_at` can narrow the result to one lab.
- Values are re-checked against the row's scenario list on read, and React escapes everything it displays.
- Student routes (`/progress`, `/pods/{id}/milestones`, verify responses) are unchanged and carry no reason.

## Configuration

| Variable | Default | Effect |
|---|---|---|
| `SCORING_DIAGNOSTICS_SCENARIOS` | empty | comma list of scorer ids to record, e.g. `9` or `9,1`. Ids with no reviewed code list are ignored |
| `S3_DIAGNOSTICS_ENABLED` | off | `1` also turns on `9` (the pilot's flag, still honoured) |
| `SCORING_DIAGNOSTICS_RETENTION_DAYS` | `14` | rows not updated for this many days are purged. Falls back to `S3_DIAGNOSTICS_RETENTION_DAYS` |

The score poller purges at most once an hour, even with every scenario switched off. The API response carries `enabled_scenarios` so the panel and UAT checks can see what is on.

## Adding a scenario

1. Baseline the deployed scorer for that scenario and map each check to a code. Leave failures the check can't tell apart generic.
2. Print the DIAG line from that scenario's check, computing PASS/FAIL from the same reason so the two can't disagree. Keep the predicates and their order.
3. Add the scenario's codes to `REASON_CODES_BY_SCENARIO` and its copy and milestone labels to `portal/src/lib/scoringDiagnostics.ts`.
4. Test every mapped branch against the real script, plus "no text leaks" and "nothing in the VM log".
5. Enable it on its own by adding its id to `SCORING_DIAGNOSTICS_SCENARIOS`, after the Scenario 3 pilot has been reviewed.

## Rollback

- **One scenario:** remove its id from `SCORING_DIAGNOSTICS_SCENARIOS` and restart. Nothing new is recorded for it and its rows age out. The other scenarios are unaffected.
- **All diagnostics:** clear `SCORING_DIAGNOSTICS_SCENARIOS`, unset `S3_DIAGNOSTICS_ENABLED`, restart. The panel hides itself once no rows are left.
- **Code:** redeploy the last known-good release. The v14 table stays and is inert. Older code reads only the scorer's last line, so a DIAG line doesn't affect it.
