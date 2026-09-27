-- Schema migration v6: one browser PASS per student/pod/scenario/milestone (SCEN-06-SCORE / #109)
-- v5 is owned by SCORE-HYBRID (#106 / milestone_rubrics). Do not reuse v5.
-- student_id is required: pod slots are reused; a prior student's browser PASS must not
-- block or spoof the next occupant (PR #110 findings 6–7).
CREATE UNIQUE INDEX IF NOT EXISTS ux_milestone_browser_pass
ON milestone_verification(pod_id, student_id, scenario_id, milestone_id)
WHERE status = 'PASS' AND detection_data LIKE 'browser:%';
