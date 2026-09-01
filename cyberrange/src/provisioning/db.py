"""SQLite database helpers."""
import os
import sqlite3

from config import DB_PATH


def get_db_connection():
    # Without an explicit timeout, sqlite3 uses a 5s default before raising
    # "database is locked" under concurrent provision/destroy/reaper/heartbeat
    # writers; PRAGMA busy_timeout governs SQLite's own retry loop and is not
    # set by connect()'s timeout= alone on every code path, so both are set
    # explicitly (branch-review Issue 13). WAL mode is applied once by
    # migrate.apply(), not per-connection.
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.execute("PRAGMA busy_timeout=30000")
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    import migrate

    migrate.apply(DB_PATH)


def log_event(
    event_type: str,
    student_id: str = None,
    pod_id: int = None,
    vmid: str = None,
    result: str = None,
    detail: str = None,
):
    conn = get_db_connection()
    with conn:
        conn.execute(
            "INSERT INTO audit_log (event_type, student_id, pod_id, vmid, result, detail) VALUES (?,?,?,?,?,?)",
            (event_type, student_id, pod_id, vmid, result, detail),
        )
    conn.close()