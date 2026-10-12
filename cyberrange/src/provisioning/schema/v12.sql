-- Durable per-realm coordination for public booking account provisioning.
CREATE TABLE IF NOT EXISTS booking_account_claims (
    email TEXT PRIMARY KEY,
    owner_token TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('creating', 'pending', 'created', 'existing', 'email_failed', 'failed', 'needs_review')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
