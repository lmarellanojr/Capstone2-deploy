"""Scenario 3 (scorer id 9) failure diagnostics for instructors.

scoring_checks.sh prints `DIAG reason=<CODE> location=<LOC> copies=<N>` before
its PASS/FAIL token. This module turns that line into allowlisted values,
keeps one current row per student + lab + milestone (schema v14), and reads
them back for the instructor view. It never stores artifact contents, shell
output, or exception text: anything outside the allowlists is dropped.

Off unless S3_DIAGNOSTICS_ENABLED=1, so rollback is unsetting the flag.
Scoring never depends on this module -- every write here is best-effort.
"""
from __future__ import annotations

import logging
import os
import re
import sqlite3
from typing import Optional

logger = logging.getLogger("provision_api")

DIAGNOSTIC_SCENARIO_IDS = frozenset({9})

# Keep in sync with the code list at check_scenario_9 in scoring_checks.sh.
REASON_CODES = frozenset({
    "ARTIFACT_MISSING",
    "ARTIFACT_UNREADABLE",
    "ARTIFACT_INVALID",
    "PLACEHOLDER_OR_EXAMPLE",
    "AGENT_MISSING",
    "AGENT_MISMATCH",
    "RULE_MISSING",
    "RULE_MISMATCH",
    "TIMESTAMP_MISSING",
    "TIMESTAMP_NOT_MATCHED",
    "REPORT_TOO_SHORT",
    "REPORT_BODY_TOO_SHORT",
    "CHECK_ERROR",
})
LOCATION_CODES = frozenset({"HOME_MSFADMIN", "HOME_STUDENT", "TMP", "NONE"})
STATUSES = frozenset({"PASS", "FAIL", "ERROR", "UNKNOWN"})

_DIAG_RE = re.compile(r"^DIAG reason=([A-Z_]+) location=([A-Z_]+) copies=([0-3])$")
_MAX_COPIES = 3


def enabled() -> bool:
    return os.getenv("S3_DIAGNOSTICS_ENABLED", "").strip().lower() in ("1", "true", "yes")


def retention_days() -> int:
    try:
        days = int(os.getenv("S3_DIAGNOSTICS_RETENTION_DAYS", "14"))
    except ValueError:
        return 14
    return days if days > 0 else 14


def applies_to(scenario_id: int) -> bool:
    return enabled() and scenario_id in DIAGNOSTIC_SCENARIO_IDS


def parse_diag(stdout: str) -> Optional[dict]:
    """The script's DIAG line as {reason, location, copies}, or None.

    reason is None for a pass ("NONE"). An unrecognised code becomes
    CHECK_ERROR rather than being passed through.
    """
    for raw in reversed((stdout or "").splitlines()):
        m = _DIAG_RE.match(raw.strip())
        if not m:
            continue
        reason, location, copies = m.group(1), m.group(2), int(m.group(3))
        if reason == "NONE":
            reason = None
        elif reason not in REASON_CODES:
            reason = "CHECK_ERROR"
        if location not in LOCATION_CODES:
            location = "NONE"
        return {"reason": reason, "location": location, "copies": copies}
    return None


def _has_table(conn: sqlite3.Connection, name: str) -> bool:
    return conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)
    ).fetchone() is not None


def _open_lab_session_id(conn: sqlite3.Connection, pod_id: int, student_id: str) -> Optional[int]:
    if not _has_table(conn, "lab_sessions"):
        return None
    row = conn.execute(
        "SELECT id FROM lab_sessions WHERE pod_id=? AND student_id=? AND ended_at IS NULL "
        "ORDER BY id DESC LIMIT 1",
        (pod_id, student_id),
    ).fetchone()
    return int(row[0]) if row else None


def record(
    conn: sqlite3.Connection,
    pod: dict,
    scenario_id: int,
    milestone_id: int,
    status: str,
    diag: Optional[dict],
) -> None:
    """Upsert this lab's current diagnostic for one milestone.

    A FAIL keeps its reason; a PASS replaces an earlier failure (reason NULL).
    ERROR from the verifier (exec/timeout) is CHECK_ERROR. The caller commits.
    """
    if status not in STATUSES:
        status = "ERROR"
    if status == "PASS":
        reason = None
    elif diag and diag.get("reason") in REASON_CODES:
        reason = diag["reason"]
    else:
        reason = "CHECK_ERROR"
    location = (diag or {}).get("location")
    if location not in LOCATION_CODES:
        location = None
    copies = (diag or {}).get("copies", 0)
    if not isinstance(copies, int) or copies < 0 or copies > _MAX_COPIES:
        copies = 0

    student_id = pod["student_id"]
    pod_id = pod["pod_id"]
    conn.execute(
        "INSERT INTO scoring_diagnostics "
        "(student_id, pod_id, pod_created_at, lab_session_id, scenario_id, milestone_id, "
        " status, reason_code, location, copies) "
        "VALUES (?,?,?,?,?,?,?,?,?,?) "
        "ON CONFLICT (student_id, pod_id, pod_created_at, scenario_id, milestone_id) DO UPDATE SET "
        " status=excluded.status, reason_code=excluded.reason_code, "
        " location=excluded.location, copies=excluded.copies, "
        " lab_session_id=COALESCE(scoring_diagnostics.lab_session_id, excluded.lab_session_id), "
        " check_count=scoring_diagnostics.check_count + 1, last_seen_at=CURRENT_TIMESTAMP",
        (
            student_id,
            pod_id,
            str(pod.get("created_at") or ""),
            _open_lab_session_id(conn, pod_id, student_id),
            scenario_id,
            milestone_id,
            status,
            reason,
            location,
            copies,
        ),
    )


def record_safely(pod: dict, scenario_id: int, milestone_id: int, status: str, diag: Optional[dict]) -> None:
    """record() on its own connection; logs and swallows any error so a
    diagnostics problem (e.g. v14 not applied, a malformed pod row) can never
    affect scoring or the Verify response."""
    from db import get_db_connection

    try:
        conn = get_db_connection()
        try:
            with conn:
                record(conn, pod, scenario_id, milestone_id, status, diag)
        finally:
            conn.close()
    except Exception as e:  # runs after the score commit; never raise into scoring
        logger.warning("scoring_diagnostics: not recorded (%s)", type(e).__name__)


def purge_expired(conn: sqlite3.Connection, days: Optional[int] = None) -> int:
    if not _has_table(conn, "scoring_diagnostics"):
        return 0
    days = days if days is not None else retention_days()
    return conn.execute(
        "DELETE FROM scoring_diagnostics WHERE last_seen_at < datetime('now', ?)",
        (f"-{int(days)} days",),
    ).rowcount


def list_for_student(
    conn: sqlite3.Connection,
    student_id: str,
    pod_id: Optional[int] = None,
    pod_created_at: Optional[str] = None,
) -> list[dict]:
    """This student's diagnostics, newest first, optionally one lab only.
    Values are re-checked against the allowlists on the way out."""
    if not _has_table(conn, "scoring_diagnostics"):
        return []
    sql = (
        "SELECT pod_id, pod_created_at, lab_session_id, scenario_id, milestone_id, status, "
        "reason_code, location, copies, check_count, first_seen_at, last_seen_at "
        "FROM scoring_diagnostics WHERE student_id=?"
    )
    args: list = [student_id]
    if pod_id is not None:
        sql += " AND pod_id=?"
        args.append(pod_id)
    if pod_created_at is not None:
        sql += " AND pod_created_at=?"
        args.append(pod_created_at)
    sql += " ORDER BY last_seen_at DESC, id DESC"
    out = []
    for r in conn.execute(sql, args).fetchall():
        d = dict(r)
        if d["reason_code"] is not None and d["reason_code"] not in REASON_CODES:
            d["reason_code"] = "CHECK_ERROR"
        if d["location"] not in LOCATION_CODES:
            d["location"] = None
        if d["status"] not in STATUSES:
            d["status"] = "ERROR"
        out.append(d)
    return out
