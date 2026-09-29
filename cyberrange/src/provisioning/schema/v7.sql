-- Schema migration v7: Dynamic per-student milestone flags (SCORE-HYBRID #111)
CREATE TABLE IF NOT EXISTS pod_milestone_flags (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    pod_id          INTEGER NOT NULL,
    student_id      TEXT NOT NULL CHECK(length(student_id) > 0),
    scenario_id     INTEGER NOT NULL CHECK(scenario_id > 0),
    milestone_id    INTEGER NOT NULL CHECK(milestone_id > 0),
    expected_flag   TEXT NOT NULL CHECK(length(expected_flag) > 0),
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (student_id, scenario_id, milestone_id)
);

CREATE INDEX IF NOT EXISTS idx_pod_milestone_flags_pod
    ON pod_milestone_flags (pod_id);
