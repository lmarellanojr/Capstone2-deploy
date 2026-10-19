-- Schema migration v14: Scenario 3 (scorer id 9) failure diagnostics.
--
-- Instructor-only reason codes for a failed artifact check. One row per
-- student + lab (pod slot + pod_created_at) + milestone: repeated poll failures
-- update it, a later PASS replaces it, so polling never grows the table.
-- Holds only allowlisted codes and identifiers -- no artifact contents, shell
-- output, or student-chosen paths. Rows older than the retention period
-- (scoring_diagnostics.RETENTION_DAYS) are purged by the score poller.
--
-- Additive only: milestone_verification and scores are untouched. Rolling the
-- code back leaves this table inert (older migrate.apply() skips v14).
CREATE TABLE IF NOT EXISTS scoring_diagnostics (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id      TEXT NOT NULL CHECK(length(student_id) > 0),
    pod_id          INTEGER NOT NULL,
    pod_created_at  TEXT NOT NULL DEFAULT '',
    lab_session_id  INTEGER,
    scenario_id     INTEGER NOT NULL,
    milestone_id    INTEGER NOT NULL,
    status          TEXT NOT NULL CHECK(status IN ('PASS','FAIL','ERROR','UNKNOWN')),
    reason_code     TEXT,
    location        TEXT,
    copies          INTEGER NOT NULL DEFAULT 0,
    check_count     INTEGER NOT NULL DEFAULT 1,
    first_seen_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (student_id, pod_id, pod_created_at, scenario_id, milestone_id)
);

CREATE INDEX IF NOT EXISTS idx_scoring_diagnostics_student
    ON scoring_diagnostics (student_id, last_seen_at);
CREATE INDEX IF NOT EXISTS idx_scoring_diagnostics_last_seen
    ON scoring_diagnostics (last_seen_at);
