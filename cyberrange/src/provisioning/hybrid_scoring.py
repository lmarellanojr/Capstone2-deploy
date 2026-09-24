"""SCORE-HYBRID: Hybrid scoring engine correlating flag submission, container state, and rubrics."""
from __future__ import annotations

import json
import logging
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, Literal, Optional, Tuple

from db import log_event
from rubrics import get_rubric, validate_flag
import scoring_state

logger = logging.getLogger("provision_api")


@dataclass
class HybridScoreResult:
    outcome: Literal["PASS", "ESCALATED", "INCOMPLETE"]
    status: str
    scenario_id: int
    milestone_id: int
    message: str
    review_id: Optional[int] = None
    verified_at: Optional[str] = None
    rubric_criteria: Optional[str] = None


async def _check_container_state(
    conn: sqlite3.Connection,
    student_id: str,
    scenario_id: int,
    milestone_id: int,
    active_pod: Optional[dict] = None,
) -> Tuple[bool, Optional[int]]:
    """Determine whether the milestone's container state is verified as PASS.

    Returns:
        (state_pass, pod_id)
    """
    # 1. Check if milestone_verification already has a PASS row for this student
    row = conn.execute(
        """
        SELECT pod_id, status FROM milestone_verification
        WHERE student_id=? AND scenario_id=? AND milestone_id=? AND status='PASS'
        ORDER BY id DESC LIMIT 1
        """,
        (student_id, scenario_id, milestone_id),
    ).fetchone()
    if row:
        return True, row["pod_id"]

    # 2. Check for an active pod to run live container verification
    pod = active_pod
    if not pod:
        # Scenario id can be stored with or without leading zero
        s_id_str = str(scenario_id)
        s_id_pad = str(scenario_id).zfill(2)
        pod_row = conn.execute(
            """
            SELECT * FROM pods
            WHERE student_id=? AND (scenario_id=? OR scenario_id=?)
              AND status = 'ACTIVE'
            ORDER BY id DESC LIMIT 1
            """,
            (student_id, s_id_str, s_id_pad),
        ).fetchone()
        if pod_row:
            pod = dict(pod_row)

    if pod and scoring_state.SCORING_ENABLED:
        ssh_cls = getattr(scoring_state, "SSHVerifier", None)
        if ssh_cls:
            try:
                verifier = ssh_cls()
                status_res, msg = await verifier.verify_milestone(
                    student_id, scenario_id, milestone_id
                )
                if status_res == "PASS":
                    pod_id = pod.get("pod_id", 0)
                    # Persist the newly corroborated pass in milestone_verification
                    with conn:
                        conn.execute(
                            """
                            INSERT INTO milestone_verification
                            (pod_id, student_id, scenario_id, milestone_id, status, detection_score, detection_data)
                            VALUES (?, ?, ?, ?, 'PASS', 0, 'corroborated_live_check')
                            """,
                            (pod_id, student_id, scenario_id, milestone_id),
                        )
                    return True, pod_id
            except Exception as e:
                logger.warning(f"Error checking live container state for pod {pod.get('pod_id')}: {e}")

    return False, None


def _resolve_pod_id_for_student(conn: sqlite3.Connection, student_id: str, scenario_id: int) -> int:
    """Safely find a pod_id for milestone_verification strictly scoped to this scenario.

    Never borrows another scenario's pod to prevent corrupting time-to-milestone metrics.
    """
    s_id_str = str(scenario_id)
    s_id_pad = str(scenario_id).zfill(2)
    row = conn.execute(
        """
        SELECT pod_id FROM pods
        WHERE student_id=? AND (scenario_id=? OR scenario_id=?)
        ORDER BY id DESC LIMIT 1
        """,
        (student_id, s_id_str, s_id_pad),
    ).fetchone()
    if row and row["pod_id"]:
        return row["pod_id"]

    # Explicit fallback if student has no pod record for this scenario
    return 0


def _escalate_conflict(
    conn: sqlite3.Connection,
    student_id: str,
    scenario_id: int,
    milestone_id: int,
    conflict_reason: str,
    evidence_dict: dict,
) -> int:
    """Insert or update a conflict case in review_cases inside an atomic transaction.

    Enforces zero-leakage: evidence_dict must NEVER contain expected_flag.
    """
    evidence_json = json.dumps(evidence_dict)
    with conn:
        if not conn.in_transaction:
            conn.execute("BEGIN IMMEDIATE")

        # Deduplication: check if a PENDING conflict review case already exists
        existing = conn.execute(
            """
            SELECT review_id FROM review_cases
            WHERE student_id=? AND scenario_id=? AND milestone_id=?
              AND case_type='SCORING_CONFLICT' AND status='PENDING'
            LIMIT 1
            """,
            (student_id, scenario_id, milestone_id),
        ).fetchone()

        if existing:
            rev_id = existing["review_id"]
            conn.execute(
                """
                UPDATE review_cases
                SET conflict_reason=?, evidence_data=?, updated_at=CURRENT_TIMESTAMP
                WHERE review_id=?
                """,
                (conflict_reason, evidence_json, rev_id),
            )
            return rev_id
        else:
            cursor = conn.execute(
                """
                INSERT INTO review_cases (
                    student_id, scenario_id, milestone_id, case_type,
                    conflict_reason, evidence_data, status
                ) VALUES (?, ?, ?, 'SCORING_CONFLICT', ?, ?, 'PENDING')
                """,
                (student_id, scenario_id, milestone_id, conflict_reason, evidence_json),
            )
            return cursor.lastrowid


async def evaluate_hybrid_submission(
    conn: sqlite3.Connection,
    student_id: str,
    scenario_id: int,
    milestone_id: int,
    submitted_flag: str,
    active_pod: Optional[dict] = None,
) -> HybridScoreResult:
    """Execute the 3-outcome hybrid scoring state machine.

    1. Flag + State agree -> PASS (marks milestone_verification PASS)
    2. Flag without State -> ESCALATE (routes to review_cases as SCORING_CONFLICT)
    3. State without Flag -> ESCALATE (routes to review_cases as SCORING_CONFLICT)
    4. Neither -> INCOMPLETE (no review case created)
    """
    flag_valid, rubric = validate_flag(conn, scenario_id, milestone_id, submitted_flag)
    if not rubric:
        raise ValueError(f"Rubric not found for scenario {scenario_id}, milestone {milestone_id}")

    now_iso = datetime.now(timezone.utc).isoformat()
    rubric_criteria = rubric.get("criteria", "")
    rubric_name = rubric.get("name", f"Milestone {milestone_id}")

    # Check if milestone is already passed in milestone_verification (Finding #2)
    already_passed_row = conn.execute(
        """
        SELECT pod_id FROM milestone_verification
        WHERE student_id=? AND scenario_id=? AND milestone_id=? AND status='PASS'
        ORDER BY id DESC LIMIT 1
        """,
        (student_id, scenario_id, milestone_id),
    ).fetchone()

    if already_passed_row and not flag_valid:
        # Finding #2: If the milestone is already completed, submitting an invalid flag
        # or typo does NOT open a conflict case for instructors to review.
        return HybridScoreResult(
            outcome="INCOMPLETE",
            status="INCOMPLETE",
            scenario_id=scenario_id,
            milestone_id=milestone_id,
            message="Milestone already verified, but submitted flag did not match rubric criteria.",
            review_id=None,
            verified_at=now_iso,
            rubric_criteria=rubric_criteria,
        )

    state_pass, pod_id = await _check_container_state(
        conn, student_id, scenario_id, milestone_id, active_pod=active_pod
    )

    now_iso = datetime.now(timezone.utc).isoformat()
    # Mask submitted flag preview for zero-leakage audit logging & evidence
    clean_sub = submitted_flag.strip()
    masked_preview = (clean_sub[:4] + "***") if len(clean_sub) >= 4 else "***"

    # --- 3-Outcome State Machine ---

    # Case 1: Flag + State agree -> PASS
    if flag_valid and state_pass:
        target_pod_id = pod_id or _resolve_pod_id_for_student(conn, student_id, scenario_id)
        auto_resolved_review_ids = []
        with conn:
            # Ensure a PASS record exists in milestone_verification
            exists = conn.execute(
                """
                SELECT id FROM milestone_verification
                WHERE student_id=? AND scenario_id=? AND milestone_id=? AND status='PASS'
                LIMIT 1
                """,
                (student_id, scenario_id, milestone_id),
            ).fetchone()
            if not exists:
                conn.execute(
                    """
                    INSERT INTO milestone_verification
                    (pod_id, student_id, scenario_id, milestone_id, status, detection_score, detection_data)
                    VALUES (?, ?, ?, ?, 'PASS', 0, 'corroborated_hybrid_flag_state')
                    """,
                    (target_pod_id, student_id, scenario_id, milestone_id),
                )

            # If there was a pending conflict case, collect IDs and auto-resolve it
            pending_rows = conn.execute(
                """
                SELECT review_id FROM review_cases
                WHERE student_id=? AND scenario_id=? AND milestone_id=?
                  AND case_type='SCORING_CONFLICT' AND status='PENDING'
                """,
                (student_id, scenario_id, milestone_id),
            ).fetchall()
            auto_resolved_review_ids = [r["review_id"] for r in pending_rows]

            if auto_resolved_review_ids:
                conn.execute(
                    """
                    UPDATE review_cases
                    SET status='APPROVED', score=100, graded_by='SYSTEM_HYBRID',
                        feedback='Corroborated by automated flag and container state agreement',
                        updated_at=CURRENT_TIMESTAMP
                    WHERE student_id=? AND scenario_id=? AND milestone_id=?
                      AND case_type='SCORING_CONFLICT' AND status='PENDING'
                    """,
                    (student_id, scenario_id, milestone_id),
                )

        log_event(
            "HYBRID_SCORE_PASS",
            student_id=student_id,
            result="PASS",
            detail=f"Scenario {scenario_id}, Milestone {milestone_id}: Flag and state corroborated.",
        )

        # Finding #4: Log REVIEW_CASE_RESOLVED event for each auto-resolved review case
        for r_id in auto_resolved_review_ids:
            try:
                log_event(
                    "REVIEW_CASE_RESOLVED",
                    student_id=student_id,
                    result="APPROVED",
                    detail=f"review_id={r_id}, score=100, graded_by=SYSTEM_HYBRID",
                )
            except Exception as exc:
                logger.warning(
                    "Failed to record REVIEW_CASE_RESOLVED audit log for review_id=%s: %s",
                    r_id,
                    exc,
                    exc_info=True,
                )

        return HybridScoreResult(
            outcome="PASS",
            status="PASS",
            scenario_id=scenario_id,
            milestone_id=milestone_id,
            message="Milestone passed! Valid flag and container state corroborated.",
            review_id=None,
            verified_at=now_iso,
            rubric_criteria=rubric_criteria,
        )

    # Case 2: Flag without State -> ESCALATE (server-side conflict, opaque to student)
    if flag_valid and not state_pass:
        conflict_reason = "Flag valid but automated container state check failed or was not corroborated."
        evidence = {
            "submitted_flag_preview": masked_preview,
            "flag_valid": True,
            "state_status": "FAIL",
            "rubric_name": rubric_name,
            "timestamp": now_iso,
        }
        review_id = _escalate_conflict(
            conn, student_id, scenario_id, milestone_id, conflict_reason, evidence
        )

        log_event(
            "HYBRID_SCORE_ESCALATED",
            student_id=student_id,
            result="ESCALATED",
            detail=f"Scenario {scenario_id}, Milestone {milestone_id}: Flag valid without container state (review_id={review_id}).",
        )

        # Finding #1: The student response must be indistinguishable from INCOMPLETE
        # so this endpoint cannot be used as an oracle to confirm guessed flags.
        return HybridScoreResult(
            outcome="INCOMPLETE",
            status="INCOMPLETE",
            scenario_id=scenario_id,
            milestone_id=milestone_id,
            message="Milestone incomplete: Neither the submitted flag nor container state satisfied rubric criteria.",
            review_id=None,
            verified_at=now_iso,
            rubric_criteria=rubric_criteria,
        )

    # Case 3: State without Flag -> ESCALATE
    if not flag_valid and state_pass:
        conflict_reason = "Automated container state passed but invalid or incorrect flag submitted."
        evidence = {
            "submitted_flag_preview": masked_preview,
            "flag_valid": False,
            "state_status": "PASS",
            "rubric_name": rubric_name,
            "timestamp": now_iso,
        }
        review_id = _escalate_conflict(
            conn, student_id, scenario_id, milestone_id, conflict_reason, evidence
        )

        log_event(
            "HYBRID_SCORE_ESCALATED",
            student_id=student_id,
            result="ESCALATED",
            detail=f"Scenario {scenario_id}, Milestone {milestone_id}: State passed without valid flag (review_id={review_id}).",
        )

        return HybridScoreResult(
            outcome="ESCALATED",
            status="ESCALATED",
            scenario_id=scenario_id,
            milestone_id=milestone_id,
            message="Scoring conflict: Container state verified, but submitted flag was invalid. Escalated to instructor review queue.",
            review_id=review_id,
            verified_at=now_iso,
            rubric_criteria=rubric_criteria,
        )

    # Case 4: Neither -> INCOMPLETE
    log_event(
        "HYBRID_SCORE_INCOMPLETE",
        student_id=student_id,
        result="INCOMPLETE",
        detail=f"Scenario {scenario_id}, Milestone {milestone_id}: Neither flag nor container state criteria satisfied.",
    )

    return HybridScoreResult(
        outcome="INCOMPLETE",
        status="INCOMPLETE",
        scenario_id=scenario_id,
        milestone_id=milestone_id,
        message="Milestone incomplete: Neither the submitted flag nor container state satisfied rubric criteria.",
        review_id=None,
        verified_at=now_iso,
        rubric_criteria=rubric_criteria,
    )

