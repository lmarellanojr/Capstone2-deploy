-- Schema v1 — extract of db.py init_db() DDL (P2 S6-1).
-- PRAGMA journal_mode=WAL is applied by migrate.py at connection open, not here.
--
-- Known quirk (out of scope S6): milestone_verification FK references pods(pod_id)
-- but pods PK is id — pre-existing; do not fix silently in v1.

CREATE TABLE IF NOT EXISTS pods (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id       TEXT NOT NULL,
    pod_id           INTEGER NOT NULL UNIQUE,
    vmid_kali        TEXT,
    vmid_meta        TEXT,
    vmid_dvwa        TEXT,
    status           TEXT NOT NULL,
    connection_id    INTEGER,
    wazuh_agent_id   TEXT,
    last_heartbeat   TIMESTAMP,
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    scenario_id      TEXT
);

CREATE TABLE IF NOT EXISTS storage_reservations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    vmid       INTEGER NOT NULL,
    size_mb    INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    student_id TEXT,
    pod_id     INTEGER,
    vmid       TEXT,
    result     TEXT,
    detail     TEXT,
    timestamp  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS milestone_verification (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    pod_id          INTEGER NOT NULL,
    scenario_id     INTEGER NOT NULL,
    milestone_id    INTEGER NOT NULL,
    status          TEXT NOT NULL,
    detection_score  INTEGER DEFAULT 0,
    detection_data   TEXT,
    verified_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (pod_id) REFERENCES pods(pod_id)
);

CREATE INDEX IF NOT EXISTS idx_milestone_verification_pod
ON milestone_verification(pod_id);

CREATE TABLE IF NOT EXISTS schema_version (
    version    INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);