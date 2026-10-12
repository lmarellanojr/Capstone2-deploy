# Scenario 3 SIEM scoring and review fix

Branch: `fix/scenario3-timeline-mentor`

Scenario 3 Task 2 now requires a complete UTC timestamp that matches a real Rule 5710 invalid-user event in `auth.log` within five minutes. SIEM displays UTC consistently and copies a canonical ISO timestamp with `Z`; the checker validates dates, rejects placeholders and longer rule IDs, infers the year for yearless syslog dates from the trusted UTC clock, and handles New Year rollover.

Scored incomplete SIEM tasks now show the instructor-review action after milestone progress loads. Preparation, completed tasks, pending/retry reviews, and expired sessions use the appropriate visibility and status states. Task 3's existing report length scoring requirement is unchanged.

Validation performed:
- `bash -n cyberrange/src/provisioning/scoring_checks.sh` passed.
- `git diff --check` passed.
- Direct Bash regression checks passed for correct match, wrong date/year, impossible date, missing UTC designator, longer rule ID, planted event exclusion, and New Year rollover.
- Dual-agent final reviews approved the change.
- The pytest and portal Jest suites could not run in this checkout because Python/pytest and portal `node_modules` are unavailable.

The changes are local to this branch; they need to be merged and deployed before the live domain changes.
