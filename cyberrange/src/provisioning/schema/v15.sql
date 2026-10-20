-- Schema migration v15: record where each milestone_verification row came from.
--
-- The background score poller re-checks every unpassed milestone of every
-- active pod every few seconds and stores each result, so a student's history
-- fills with automatic FAIL rows that instructors can't tell apart from the
-- student's own attempts (#266). `source` lets the instructor view separate
-- them without dropping any rows:
--
--   auto     background score poller (score_poller.py)
--   manual   student-initiated Manual Check (verify_milestone_route)
--   browser  Scenario 2 DVWA browser scoring (record_browser_milestone)
--   flag     hybrid flag capture (hybrid_scoring.py)
--   review   instructor approval of a review case (pods_router.py)
--
-- Rows written before v15 stay NULL (legacy, source unknown). Additive only:
-- nothing that reads status/scores changes, and rolling the code back leaves
-- the column unused.
ALTER TABLE milestone_verification ADD COLUMN source TEXT
  CHECK(source IS NULL OR source IN ('auto','manual','browser','flag','review'));
