# SQLite schema migrations

- Canonical DDL: `vN.sql` (v1 = extract of original `init_db()`).
- Runner: `../migrate.py` (`--apply`, `--check`).
- **Rule:** additive migrations only in production; no `DROP` without TRB approval.
- v3 (`student_id` on `milestone_verification`) is forward-only (TRB 2026-09-07).
- Known quirk (v1): `milestone_verification` FK references `pods(pod_id)` — pre-existing, documented in `v1.sql` header.