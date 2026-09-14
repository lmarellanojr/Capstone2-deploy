-- Schema migration v4: Written student report review cases
CREATE TABLE IF NOT EXISTS review_cases (
    review_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id   TEXT NOT NULL,
    scenario_id  INTEGER NOT NULL,
    milestone_id INTEGER,
    report_text  TEXT NOT NULL,
    score        INTEGER DEFAULT 0,
    status       TEXT CHECK(status IN ('PENDING','APPROVED','REJECTED','RETRY')) DEFAULT 'PENDING',
    feedback     TEXT,
    graded_by    TEXT,
    created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_review_cases_student ON review_cases(student_id);
CREATE INDEX IF NOT EXISTS idx_review_cases_status ON review_cases(status);
