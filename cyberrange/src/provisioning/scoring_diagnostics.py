"""Instructor-only failure diagnostics for scored artifact/behavior checks.

scoring_checks.sh prints `DIAG reason=<CODE> location=<LOC> copies=<N>` before
its PASS/FAIL token for each scenario listed in REASON_CODES_BY_SCENARIO. This
module turns that line into allowlisted values, keeps one current row per
student + lab + scenario + milestone (schema v14), and reads them back for the
instructor view. It never stores artifact contents, shell output, or exception
text: anything outside the allowlists is dropped.

Each scenario has its own switch, so it can be enabled and rolled back alone:
SCORING_DIAGNOSTICS_SCENARIOS is a comma list of scorer ids (e.g. "9" or "9,1").
S3_DIAGNOSTICS_ENABLED=1 still turns on scenario 9 (the Scenario 3 pilot).
Scoring never depends on this module -- every write here is best-effort.
"""
from __future__ import annotations

import logging
import os
import re
import sqlite3
from typing import Optional

logger = logging.getLogger("provision_api")

# Scorer scenario id -> the codes its check may print. Keep each set in sync
# with the code list above that scenario's check in scoring_checks.sh.
REASON_CODES_BY_SCENARIO: dict[int, frozenset[str]] = {
    # Catalog Scenario 1, Network Reconnaissance & Exploitation (check_scenario_1).
    1: frozenset({
        "NO_POD_ADDRESS",
        "NO_SUBNET_ROUTE",
        "COMMAND_NOT_FOUND",
        "COMMAND_NOT_MATCHED",
        "MSF_NOT_RUNNING",
        "SESSION_NOT_OPENED",
        "SESSION_NOT_LIVE",
        "CHECK_ERROR",
    }),
    # Catalog Scenario 3, SIEM Alert Triage (check_scenario_9).
    9: frozenset({
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
    }),
    # Catalog Scenario 4, Vulnerability Hardening (check_scenario_11).
    11: frozenset({
        "COMMAND_NOT_FOUND",
        "COMMAND_NOT_MATCHED",
        "DEFAULT_PASSWORD_PRESENT",
        "CONFIG_MISSING",
        "OLD_CREDS_ACCEPTED",
        "MANAGER_UNREACHABLE",
        "MANAGER_UNEXPECTED_STATUS",
        "CHECK_ERROR",
    }),
    # Catalog Scenario 2, SQL Injection. Not from scoring_checks.sh: the portal
    # DVWA proxy classifies an attempt that did not score (browserNearMiss in
    # portal/src/lib/dvwaScoreSignals.ts) and posts only the code.
    6: frozenset({
        "SECURITY_NOT_LOW",
        "PAYLOAD_NO_ROWS",
        "QUOTE_NO_ERROR",
        "UNION_NO_METADATA",
        "UNION_NO_HASH",
        "XSS_NOT_REFLECTED",
        "CHECK_ERROR",
    }),
}
DIAGNOSTIC_SCENARIO_IDS = frozenset(REASON_CODES_BY_SCENARIO)
# Scenarios whose failure reasons come from the portal proxy. Their shell-scorer
# fallback prints no DIAG line, so only its PASS is recorded (scoring.py).
BROWSER_SCENARIO_IDS = frozenset({6})
# Every code any scenario may print (for "never shown to students" checks).
REASON_CODES = frozenset().union(*REASON_CODES_BY_SCENARIO.values())
LOCATION_CODES = frozenset({"HOME_MSFADMIN", "HOME_STUDENT", "TMP", "NONE"})
STATUSES = frozenset({"PASS", "FAIL", "ERROR", "UNKNOWN"})

_DIAG_RE = re.compile(r"^DIAG reason=([A-Z_]+) location=([A-Z_]+) copies=([0-3])$")
_MAX_COPIES = 3


def _truthy(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in ("1", "true", "yes")


def enabled_scenarios() -> list[int]:
    """Scorer ids whose diagnostics are switched on, sorted. Ids without a
    reason-code list are ignored, so a typo can't enable an unmapped check."""
    ids: set[int] = set()
    for part in os.getenv("SCORING_DIAGNOSTICS_SCENARIOS", "").split(","):
        part = part.strip()
        # isascii: isdigit() also accepts e.g. "²", which int() rejects, and an
        # env typo must never turn every Verify into a 500.
        if part.isascii() and part.isdigit():
            ids.add(int(part))
    if _truthy("S3_DIAGNOSTICS_ENABLED"):
        ids.add(9)
    return sorted(ids & DIAGNOSTIC_SCENARIO_IDS)


def enabled() -> bool:
    return bool(enabled_scenarios())


def retention_days() -> int:
    """The first positive int of the shared name, then the pilot's; else 14.
    A bad shared value falls through to the pilot's, so an operator's shorter
    retention for this student data is never silently replaced by the default."""
    for name in ("SCORING_DIAGNOSTICS_RETENTION_DAYS", "S3_DIAGNOSTICS_RETENTION_DAYS"):
        try:
            days = int(os.getenv(name, "").strip())
        except ValueError:
            continue
        if days > 0:
            return days
    return 14


def applies_to(scenario_id: int) -> bool:
    return scenario_id in enabled_scenarios()


def _codes_for(scenario_id) -> frozenset[str]:
    try:
        return REASON_CODES_BY_SCENARIO.get(int(scenario_id), frozenset())
    except (TypeError, ValueError):
        return frozenset()


def parse_diag(stdout: str, scenario_id: int) -> Optional[dict]:
    """The script's DIAG line as {reason, location, copies}, or None.

    reason is None for a pass ("NONE"). A code outside this scenario's list
    becomes CHECK_ERROR rather than being passed through.
    """
    for raw in reversed((stdout or "").splitlines()):
        m = _DIAG_RE.match(raw.strip())
        if not m:
            continue
        reason, location, copies = m.group(1), m.group(2), int(m.group(3))
        if reason == "NONE":
            reason = None
        elif reason not in _codes_for(scenario_id):
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
    keep_pass: bool = False,
) -> None:
    """Upsert this lab's current diagnostic for one scenario milestone.

    A FAIL keeps its reason; a PASS replaces an earlier failure (reason NULL).
    ERROR from the verifier (exec/timeout) is CHECK_ERROR. The caller commits.
    keep_pass: leave an existing PASS row alone, decided in the same statement
    as the write (a near-miss that races a browser pass must not overwrite it).
    """
    if status not in STATUSES:
        status = "ERROR"
    if status == "PASS":
        reason = None
    elif diag and diag.get("reason") in _codes_for(scenario_id):
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
        " check_count=scoring_diagnostics.check_count + 1, last_seen_at=CURRENT_TIMESTAMP"
        + (" WHERE scoring_diagnostics.status <> 'PASS'" if keep_pass else ""),
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


def record_safely(
    pod: dict, scenario_id: int, milestone_id: int, status: str, diag: Optional[dict], keep_pass: bool = False
) -> None:
    """record() on its own connection; logs and swallows any error so a
    diagnostics problem (e.g. v14 not applied, a malformed pod row) can never
    affect scoring or the Verify response."""
    from db import get_db_connection

    try:
        conn = get_db_connection()
        try:
            with conn:
                record(conn, pod, scenario_id, milestone_id, status, diag, keep_pass=keep_pass)
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
        if d["reason_code"] is not None and d["reason_code"] not in _codes_for(d["scenario_id"]):
            d["reason_code"] = "CHECK_ERROR"
        if d["location"] not in LOCATION_CODES:
            d["location"] = None
        if d["status"] not in STATUSES:
            d["status"] = "ERROR"
        out.append(d)
    return out
