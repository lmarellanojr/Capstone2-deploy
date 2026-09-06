"""Milestone verification and SIEM detection scoring."""
import json
import logging
from datetime import datetime
from typing import Any, Callable, Optional, Tuple, Type

from fastapi import HTTPException

from config import POD_TTL_HOURS
from db import get_db_connection, log_event
from models import VerificationResponse

logger = logging.getLogger("provision_api")


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
        verifier = ssh_verifier_cls()
        status_result, message = await verifier.verify_milestone(
            pod["student_id"], scenario_id, milestone_id
        )

        detection_score, detection_data = 0, None
        det = detection_for(scenario_id, milestone_id) if detection_enabled and detection_for else None
        if det and pod["wazuh_agent_id"] and str(pod["wazuh_agent_id"]).startswith("{"):
            try:
                aid = json.loads(pod["wazuh_agent_id"]).get(det["role"])
                if aid and verify_siem_alert(
                    aid, det["rule_id"], since_minutes=POD_TTL_HOURS * 60
                ):
                    detection_score = 1
                    detection_data = f"rule {det['rule_id']} on agent {aid}"
            except Exception as e:
                detection_data = f"siem-check-error: {e}"

        pod_id = pod["pod_id"]
        conn = get_db_connection()
        with conn:
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