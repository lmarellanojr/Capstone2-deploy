"""Milestone verification and SIEM detection scoring."""
import json
import logging
import sqlite3
from datetime import datetime
from typing import Any, Callable, Optional, Tuple, Type

from fastapi import HTTPException

from db import get_db_connection, log_event
from models import VerificationResponse
from ttl import minutes_since_created, siem_window_minutes

logger = logging.getLogger("provision_api")


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


def record_browser_milestone(
    conn: sqlite3.Connection, pod: dict, milestone_id: int, label: str
) -> None:
    """Insert one browser PASS on this conn. detection_score=0. detection_data=label."""
    try:
        conn.execute(
            """
            INSERT INTO milestone_verification
            (pod_id, student_id, scenario_id, milestone_id, status, detection_score, detection_data)
            SELECT ?, ?, 6, ?, 'PASS', 0, ?
            WHERE NOT EXISTS (
                SELECT 1 FROM milestone_verification
                WHERE pod_id=? AND student_id=? AND scenario_id=6 AND milestone_id=?
                  AND status='PASS' AND detection_data LIKE 'browser:%'
            )
            """,
            (
                pod["pod_id"],
                pod["student_id"],
                milestone_id,
                label,
                pod["pod_id"],
                pod["student_id"],
                milestone_id,
            ),
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
            mv_cols = {r[1] for r in conn.execute("PRAGMA table_info(milestone_verification)").fetchall()}
            if "pod_created_at" in mv_cols:
                conn.execute(
                    "INSERT INTO milestone_verification "
                    "(pod_id, student_id, scenario_id, milestone_id, status, detection_score, detection_data, pod_created_at) "
                    "VALUES (?,?,?,?,?,?,?,?)",
                    (
                        pod_id,
                        pod["student_id"],
                        scenario_id,
                        milestone_id,
                        status_result,
                        detection_score,
                        detection_data,
                        pod_created_at,
                    ),
                )
            else:
                conn.execute(
                    "INSERT INTO milestone_verification "
                    "(pod_id, student_id, scenario_id, milestone_id, status, detection_score, detection_data) "
                    "VALUES (?,?,?,?,?,?,?)",
                    (
                        pod_id,
                        pod["student_id"],
                        scenario_id,
                        milestone_id,
                        status_result,
                        detection_score,
                        detection_data,
                    ),
                )
        conn.close()

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