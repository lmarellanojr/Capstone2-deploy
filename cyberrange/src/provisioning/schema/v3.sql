-- v3: persist milestone_verification across pod teardown (GitHub issue 11).
-- Forward-only (TRB r2 grant): student_id TEXT is added by migrate.py via
-- ALTER TABLE after PRAGMA table_info shows the column is missing. Do not
-- DROP COLUMN in production. Do not put ALTER TABLE in this file
-- (executescript would not be idempotent).
--
-- Backfill from the current pods row for that pod_id. Slot reuse deletes
-- then immediately inserts a new occupant, so a leftover is attributed to
-- the current occupant. student_id stays NULL only when no pods row has
-- that pod_id (true orphan, unrestorable).
--
-- This file is idempotent: UPDATE + CREATE INDEX IF NOT EXISTS.

UPDATE milestone_verification
   SET student_id = (
       SELECT student_id FROM pods WHERE pods.pod_id = milestone_verification.pod_id
   )
 WHERE student_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_milestone_verification_student
    ON milestone_verification (student_id, scenario_id, milestone_id);
