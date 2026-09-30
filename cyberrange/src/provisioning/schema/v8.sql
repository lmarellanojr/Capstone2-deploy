-- Schema migration v8: instructor SIEM history (SIEM audit gap 6 follow-up).
--
-- pods rows are deleted/reused per slot, so nothing recorded when a lab ended.
-- lab_sessions keeps each lab's real start/end so an instructor can read that
-- lab's alerts from the Wazuh daily archives after it is gone. Labs from
-- before this migration are reconstructed (with an estimated end) from
-- milestone_verification.pod_created_at by lab_history.py.
CREATE TABLE IF NOT EXISTS lab_sessions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    pod_id       INTEGER NOT NULL,
    student_id   TEXT NOT NULL CHECK(length(student_id) > 0),
    scenario_id  TEXT,
    started_at   TIMESTAMP NOT NULL,
    ended_at     TIMESTAMP,
    end_status   TEXT
);

CREATE INDEX IF NOT EXISTS idx_lab_sessions_student
    ON lab_sessions (student_id, started_at);
CREATE INDEX IF NOT EXISTS idx_lab_sessions_open
    ON lab_sessions (pod_id) WHERE ended_at IS NULL;

-- The alerts that fired during the student's lab, frozen when they submitted
-- (or resubmitted) a report, so the evidence being graded can't drift or age
-- out of the archives. Same allowlisted fields as the live alerts view.
CREATE TABLE IF NOT EXISTS review_alert_snapshots (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    review_id     INTEGER NOT NULL,
    pod_id        INTEGER,
    window_start  TIMESTAMP,
    window_end    TIMESTAMP,
    end_estimated INTEGER NOT NULL DEFAULT 0,
    total_count   INTEGER NOT NULL DEFAULT 0,
    alerts_json   TEXT NOT NULL DEFAULT '[]',
    error         TEXT,
    captured_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_review_alert_snapshots_review
    ON review_alert_snapshots (review_id, captured_at);
