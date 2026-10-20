"""Milestone verification and SIEM detection scoring."""
import json
import logging
import sqlite3
from datetime import datetime
from typing import Any, Callable, Optional, Tuple, Type

from fastapi import HTTPException

import scoring_diagnostics
from db import get_db_connection, log_event
from models import VerificationResponse
from ttl import minutes_since_created, siem_window_minutes

logger = logging.getLogger("provision_api")

# milestone_verification.source values (schema v15, #266). NULL = pre-v15 row.
SOURCE_AUTO = "auto"        # background score poller
SOURCE_MANUAL = "manual"    # student-initiated Manual Check
SOURCE_BROWSER = "browser"  # Scenario 2 DVWA browser scoring
SOURCE_FLAG = "flag"        # hybrid flag capture
SOURCE_REVIEW = "review"    # instructor approval of a review case

_ALLOWED_SOURCES = frozenset(
    {SOURCE_AUTO, SOURCE_MANUAL, SOURCE_BROWSER, SOURCE_FLAG, SOURCE_REVIEW}
)


def validate_source(source: Optional[str]) -> Optional[str]:
    """Return source unchanged, or raise if a non-null value is not allowlisted."""
    if source is None:
        return None
    if source not in _ALLOWED_SOURCES:
        raise ValueError(
            f"invalid milestone_verification.source {source!r}; "
            f"allowed: {sorted(_ALLOWED_SOURCES)}"
        )
    return source


def mv_column_names(conn: sqlite3.Connection) -> set:
    return {r[1] for r in conn.execute("PRAGMA table_info(milestone_verification)").fetchall()}


def insert_verification_row(
    conn: sqlite3.Connection,
    *,
    pod_id: int,
    student_id: str,
    scenario_id: int,
    milestone_id: int,
    status: str,
    detection_score: int = 0,
    detection_data: Optional[str] = None,
    source: Optional[str] = None,
    pod_created_at: Optional[str] = None,
) -> None:
    """Insert one milestone_verification row; optional columns via PRAGMA.

    Omitting source leaves NULL. Non-null source must be a SOURCE_* constant.
    Caller owns the transaction.
    """
    source = validate_source(source)
    cols = [
        "pod_id",
        "student_id",
        "scenario_id",
        "milestone_id",
        "status",
        "detection_score",
        "detection_data",
    ]
    vals: list = [
        pod_id,
        student_id,
        scenario_id,
        milestone_id,
        status,
        detection_score,
        detection_data,
    ]
    mv_cols = mv_column_names(conn)
    if "pod_created_at" in mv_cols:
        cols.append("pod_created_at")
        vals.append(pod_created_at)
    if "source" in mv_cols:
        cols.append("source")
        vals.append(source)
    conn.execute(
        f"INSERT INTO milestone_verification ({', '.join(cols)}) "
        f"VALUES ({','.join('?' * len(cols))})",
        vals,
    )


def has_browser_pass(
    conn: sqlite3.Connection,
    pod_id: int,
    student_id: str,
    scenario_id: int,
    milestone_id: int,
) -> bool:
    """True if this student already has a browser PASS on this pod/scenario/milestone.

    student_id is required: pod slots 1–6 are reused, and a prior student's
    browser PASS must not short-circuit Manual Check for the next occupant.
    """
    row = conn.execute(
        "SELECT 1 FROM milestone_verification "
        "WHERE pod_id=? AND student_id=? AND scenario_id=? AND milestone_id=? "
        "AND status='PASS' AND detection_data LIKE 'browser:%' LIMIT 1",
        (pod_id, student_id, scenario_id, milestone_id),
    ).fetchone()
    return row is not None


def pod_created_at_for(
    conn: sqlite3.Connection, pod_id: Optional[int], student_id: str
) -> Optional[str]:
    """created_at of this student's current pods row on this slot, or None.

    Flag and browser PASSes are scored while the lab is running, so this is the
    lab they belong to. Recording it on the row keeps time-to-milestone after
    the slot's pods row is replaced by the next provision.
    """
    if not pod_id:
        return None
    row = conn.execute(
        "SELECT created_at FROM pods WHERE pod_id=? AND student_id=?",
        (pod_id, student_id),
    ).fetchone()
    return row[0] if row and row[0] else None


def record_browser_milestone(
    conn: sqlite3.Connection, pod: dict, milestone_id: int, label: str
) -> None:
    """Insert one browser PASS on this conn. detection_score=0. detection_data=label.

    Idempotent: skips when a browser PASS already exists for this pod/student/milestone.
    """
    if has_browser_pass(conn, pod["pod_id"], pod["student_id"], 6, milestone_id):
        return
    try:
        insert_verification_row(
            conn,
            pod_id=pod["pod_id"],
            student_id=pod["student_id"],
            scenario_id=6,
            milestone_id=milestone_id,
            status="PASS",
            detection_score=0,
            detection_data=label,
            source=SOURCE_BROWSER,
            pod_created_at=pod.get("created_at"),
        )
    except sqlite3.IntegrityError:
        return


async def verify_milestone(
    pod: dict,
    scenario_id: int,
    milestone_id: int,
    *,
    scoring_enabled: bool,
    ssh_verifier_cls: Optional[Type],
    detection_enabled: bool,
    detection_for: Optional[Callable],
    verify_siem_alert: Optional[Callable],
    source: Optional[str] = None,
) -> VerificationResponse:
    if not scoring_enabled or ssh_verifier_cls is None:
        raise HTTPException(status_code=503, detail="Scoring engine not available")

    try:
        if scenario_id == 6:
            conn = get_db_connection()
            try:
                if has_browser_pass(
                    conn, pod["pod_id"], pod["student_id"], 6, milestone_id
                ):
                    return VerificationResponse(
                        status="PASS",
                        message="browser evidence already recorded",
                        pod_id=pod["pod_id"],
                        scenario_id=6,
                        milestone_id=milestone_id,
                        detection_score=0,
                        verified_at=datetime.now().isoformat(),
                    )
            finally:
                conn.close()

        verifier = ssh_verifier_cls()
        diagnose = scoring_diagnostics.applies_to(scenario_id)
        diag = None
        if diagnose and hasattr(type(verifier), "verify_milestone_detailed"):
            status_result, message, diag = await verifier.verify_milestone_detailed(
                pod["student_id"], scenario_id, milestone_id
            )
        else:
            status_result, message = await verifier.verify_milestone(
                pod["student_id"], scenario_id, milestone_id
            )

        detection_score, detection_data = 0, None
        det = detection_for(scenario_id, milestone_id) if detection_enabled and detection_for else None
        if det and pod["wazuh_agent_id"] and str(pod["wazuh_agent_id"]).startswith("{"):
            try:
                aid = json.loads(pod["wazuh_agent_id"]).get(det["role"])
                # Window = this pod's lifetime, so an alert from the student's
                # previous pod can't set detection_score on the new one.
                window = minutes_since_created(pod.get("created_at"), siem_window_minutes(scenario_id))
                if aid and verify_siem_alert(aid, det["rule_id"], since_minutes=window):
                    detection_score = 1
                    detection_data = f"rule {det['rule_id']} on agent {aid}"
            except Exception as e:
                detection_data = f"siem-check-error: {e}"

        pod_id = pod["pod_id"]
        pod_created_at = pod.get("created_at")
        conn = get_db_connection()
        with conn:
            insert_verification_row(
                conn,
                pod_id=pod_id,
                student_id=pod["student_id"],
                scenario_id=scenario_id,
                milestone_id=milestone_id,
                status=status_result,
                detection_score=detection_score,
                detection_data=detection_data,
                source=source,
                pod_created_at=pod_created_at,
            )
        conn.close()

        # Instructor-only reason code; after the score commit so it can't block it.
        # A browser scenario's Kali-fallback FAIL has no reason, so it must not
        # overwrite the proxy's; its PASS still clears an earlier failure.
        if diagnose and (
            status_result == "PASS" or scenario_id not in scoring_diagnostics.BROWSER_SCENARIO_IDS
        ):
            scoring_diagnostics.record_safely(pod, scenario_id, milestone_id, status_result, diag)

        log_event(
            "MILESTONE_VERIFIED",
            student_id=pod["student_id"],
            pod_id=pod_id,
            result=status_result,
            detail=f"Scenario {scenario_id}, Milestone {milestone_id}: {message}",
        )

        return VerificationResponse(
            status=status_result,
            message=message,
            pod_id=pod_id,
            scenario_id=scenario_id,
            milestone_id=milestone_id,
            detection_score=detection_score,
            verified_at=datetime.now().isoformat(),
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Verification failed for pod {pod['pod_id']}: {e}")
        log_event(
            "MILESTONE_VERIFY_FAILED",
            student_id=pod["student_id"],
            pod_id=pod["pod_id"],
            detail=str(e),
        )
        raise HTTPException(status_code=500, detail=f"Verification failed: {str(e)}")