-- Schema migration v9: student-uploaded evidence screenshots for review cases.
--
-- Image bytes are NOT stored here; they live on disk under EVIDENCE_IMAGE_DIR
-- (default ~/cyberrange-data/review_images), outside the release tree so a
-- deploy never touches them. This table is the index: which files belong to
-- which review, who uploaded them, and the re-encoded (metadata-stripped) type.
CREATE TABLE IF NOT EXISTS review_evidence_images (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    review_id     INTEGER NOT NULL,
    student_id    TEXT NOT NULL CHECK(length(student_id) > 0),
    stored_name   TEXT NOT NULL UNIQUE,   -- opaque on-disk filename (uuid.ext)
    original_name TEXT,                    -- as the student named it (display only)
    content_type  TEXT NOT NULL,          -- image/png | image/jpeg | image/webp
    byte_size     INTEGER NOT NULL,
    width         INTEGER,
    height        INTEGER,
    caption       TEXT,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_review_evidence_images_review
    ON review_evidence_images (review_id, created_at);
