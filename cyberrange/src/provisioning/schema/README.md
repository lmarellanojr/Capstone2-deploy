# SQLite schema migrations

- Canonical DDL: `vN.sql` (v1 = extract of original `init_db()`).
- Runner: `../migrate.py` (`--apply`, `--check`).
- **Rule:** additive migrations only in production; no `DROP` without TRB approval.
- v3 (`student_id` on `milestone_verification`) is forward-only (TRB 2026-09-07).
- v12 updates the Scenario 1 M5 rubric copy.
- v13 (`booking_account_claims`) is retained as historical schema because deployed databases have applied it. Booking no longer uses this table; it is inert and must not be removed from the migration history.
- v14 (`scoring_diagnostics`) is additive: Scenario 3 reason codes only, one row per student + lab + milestone, purged after `S3_DIAGNOSTICS_RETENTION_DAYS` (default 14). A code rollback leaves it inert; dropping it needs TRB approval like any other `DROP`.
- Known quirk (v1): `milestone_verification` FK references `pods(pod_id)` — pre-existing, documented in `v1.sql` header.
