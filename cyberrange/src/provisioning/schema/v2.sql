-- v2: one non-terminal pod per student (branch-review Issue 3).
--
-- pods.pod_id is UNIQUE but pods.student_id was unconstrained, so a
-- same-student provision race could leave one student owning two live pods --
-- bypassing product policy and doubling RAM/storage use on a host with room
-- for neither. pods_router re-checks inside BEGIN IMMEDIATE so the race
-- surfaces as a clean 409; this index is the durable backstop behind that
-- check, and holds even if the application logic regresses later.
--
-- Terminal statuses are excluded so a student can provision again after
-- teardown. The predicate deliberately matches the status set used by
-- pods_router's existing-pod query, active-count query, and slot selection --
-- a mismatch there would be a silent correctness hole.
--
-- Additive only, no DROP, per schema/README.md. Rollback for this migration is
-- pre-approved by TRB: DROP INDEX idx_pods_one_active_per_student (dropping an
-- index is non-destructive).
--
-- If this fails with "UNIQUE constraint failed", the database already holds
-- duplicate live pods. scripts/s6_host_deploy.sh pre-flights for exactly this
-- and will name the students before the migration runs. To reconcile manually:
--
--   SELECT student_id, COUNT(*) AS n FROM pods
--    WHERE status NOT IN ('DESTROYED','FAILED_ROLLBACK_COMPLETE')
--    GROUP BY student_id HAVING n > 1;
--
-- Destroy the extras via the API (DELETE /pods/{id}/destroy) so LXD resources
-- are released too -- do not just UPDATE the rows -- then re-run:
--   python migrate.py --apply

CREATE UNIQUE INDEX IF NOT EXISTS idx_pods_one_active_per_student
    ON pods (student_id)
    WHERE status NOT IN ('DESTROYED', 'FAILED_ROLLBACK_COMPLETE');
