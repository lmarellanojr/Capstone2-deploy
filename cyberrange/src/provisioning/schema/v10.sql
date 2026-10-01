-- Schema migration v10: one-shot Manual Check lock (G1).
--
-- A student gets a SINGLE automated Manual Check per milestone after automatic
-- scoring fails to detect their work. A failed Manual Check records a row here,
-- which locks the task to Instructor Review -- the Manual Check button is then
-- replaced and cannot be triggered again, and no points are awarded until an
-- instructor approves the review.
--
-- Rows are written ONLY by an explicit student Manual Check (the
-- /pods/{id}/verify/... route), never by the background auto-detect poller
-- (which calls verify_milestone directly), so auto-detect FAILs never consume
-- the student's one attempt.
--
-- Keyed by student (not pod) so the lock is durable across page refreshes, new
-- pods, and re-login, per the agreed behaviour.
CREATE TABLE IF NOT EXISTS manual_check_attempts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id   TEXT NOT NULL,
    scenario_id  INTEGER NOT NULL,
    milestone_id INTEGER NOT NULL,
    result       TEXT NOT NULL,              -- the Manual Check outcome: PASS / FAIL / ERROR
    created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(student_id, scenario_id, milestone_id)
);

CREATE INDEX IF NOT EXISTS idx_manual_check_student
    ON manual_check_attempts (student_id, scenario_id);

-- New pure-flag "find the flag" final tasks (flag-only scoring). Seeded here so
-- the rubric/flag lookup resolves for DBs already past v5. INSERT OR IGNORE so
-- re-runs and fresh v5 seeds stay idempotent.
INSERT OR IGNORE INTO milestone_rubrics (scenario_id, milestone_id, name, criteria, expected_flag, points, mitre_technique, nist_phase)
VALUES
  (1, 5, 'Capture the Flag (whoami)', 'From the tomcat shell, confirm your identity with whoami and submit the flag from the tomcat user''s home directory.', 'FLAG{S01_M5_C3D5E7A9B1F2}', 50, 'T1083', 'Post-Exploitation'),
  (6, 5, 'Capture the Flag', 'Use SQL injection to read the flag stored in the application database and submit it.', 'FLAG{S06_M5_4C6E8A0B2D4F}', 50, 'T1190', 'Data Access');
