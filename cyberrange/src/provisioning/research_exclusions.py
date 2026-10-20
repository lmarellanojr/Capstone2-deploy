"""Accounts left out of the knowledge-gain export (schema v16, PAPER-16 / D.5).

Admins mark test accounts in Admin -> Users. Staff (instructor/admin roles)
are left out automatically by the export, so only student-role test accounts
need marking. Nothing here deletes scoring data.
"""
from __future__ import annotations

import sqlite3
from typing import Optional

REASONS = ("test_account", "team_member", "other")


def _has_table(conn: sqlite3.Connection) -> bool:
    return bool(
        conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='research_exclusions'"
        ).fetchone()
    )


def list_exclusions(conn: sqlite3.Connection) -> dict[str, dict]:
    """username -> {reason, excluded_by, excluded_at}. Empty before v16."""
    if not _has_table(conn):
        return {}
    rows = conn.execute(
        "SELECT student_id, reason, excluded_by, excluded_at FROM research_exclusions"
    ).fetchall()
    return {
        r[0]: {"reason": r[1], "excluded_by": r[2], "excluded_at": r[3]} for r in rows
    }


def get_exclusion(conn: sqlite3.Connection, username: Optional[str]) -> Optional[dict]:
    if not username or not _has_table(conn):
        return None
    r = conn.execute(
        "SELECT reason, excluded_by, excluded_at FROM research_exclusions WHERE student_id=?",
        (username,),
    ).fetchone()
    return {"reason": r[0], "excluded_by": r[1], "excluded_at": r[2]} if r else None


def set_exclusion(conn: sqlite3.Connection, username: str, reason: str, actor: str) -> None:
    if reason not in REASONS:
        raise ValueError(f"invalid research exclusion reason {reason!r}")
    conn.execute(
        "INSERT INTO research_exclusions (student_id, reason, excluded_by) VALUES (?,?,?) "
        "ON CONFLICT(student_id) DO UPDATE SET reason=excluded.reason, "
        "excluded_by=excluded.excluded_by, excluded_at=CURRENT_TIMESTAMP",
        (username, reason, actor),
    )


def clear_exclusion(conn: sqlite3.Connection, username: str) -> bool:
    return conn.execute(
        "DELETE FROM research_exclusions WHERE student_id=?", (username,)
    ).rowcount > 0
