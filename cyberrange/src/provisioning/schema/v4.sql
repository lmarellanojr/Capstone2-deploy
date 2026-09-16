-- Schema migration v4: Generalized review cases (written reports, scoring conflicts, manual reviews)
CREATE TABLE IF NOT EXISTS review_cases (
    review_id       INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id      TEXT NOT NULL,
    scenario_id     INTEGER NOT NULL,
    milestone_id    INTEGER,
    case_type       TEXT CHECK(case_type IN ('WRITTEN_REPORT','SCORING_CONFLICT','MANUAL_REVIEW')) DEFAULT 'WRITTEN_REPORT',
    report_text     TEXT,
    conflict_reason TEXT,
    evidence_data   TEXT,
    score           INTEGER CHECK(score IS NULL OR (score >= 0 AND score <= 100)),
    status          TEXT CHECK(status IN ('PENDING','APPROVED','REJECTED','RETRY')) DEFAULT 'PENDING',
    feedback        TEXT,
    graded_by       TEXT,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_review_cases_student ON review_cases(student_id);
CREATE INDEX IF NOT EXISTS idx_review_cases_status ON review_cases(status);
CREATE INDEX IF NOT EXISTS idx_review_cases_case_type ON review_cases(case_type);
