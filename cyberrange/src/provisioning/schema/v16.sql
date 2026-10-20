-- Schema migration v16: accounts left out of research (knowledge-gain) data.
--
-- Test accounts used by the system owners during UAT score milestones like
-- real students. Admins mark them in Admin -> Users, and the knowledge-gain
-- export skips them (staff roles are skipped automatically from Keycloak).
-- Nothing is deleted: scores and history stay, and an account can be
-- included again at any time. Keyed by username = milestone_verification.student_id.
CREATE TABLE IF NOT EXISTS research_exclusions (
    student_id   TEXT PRIMARY KEY CHECK(length(student_id) > 0),
    reason       TEXT NOT NULL CHECK(reason IN ('test_account','team_member','other')),
    excluded_by  TEXT NOT NULL,
    excluded_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
