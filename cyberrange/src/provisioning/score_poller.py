"""Background milestone auto-verification poller (issue #12).

The scenario guides tell students to "use Manual Check (or wait for
auto-detect)," but nothing previously called verify_milestone except an
explicit Manual Check click from the browser -- the frontend's own poll
only re-reads whatever is already in milestone_verification, it never
triggers a fresh check. This loop is what actually makes "wait for
auto-detect" true: it periodically re-runs the same scoring_checks.sh
behavioral check (via verify_milestone) for every active pod's still-
unpassed milestones, so a student who ran the right command but never
clicked anything still sees their score update within one poll interval.
"""
import asyncio
import logging

from config import SCORE_POLL_INTERVAL_SECONDS
from db import get_db_connection
import scoring_state
from scoring import verify_milestone

logger = logging.getLogger("provision_api")

# Milestone counts per scenario, mirroring the portal's own catalog
# (portal/src/hooks/useScenarios.ts SCENARIOS). Only scenarios actually
# wired into the portal need an entry -- see SCENARIO_TARGETS in
# ssh_verifier.py for the sibling list of which container role each
# scenario's checks run against.
SCENARIO_MILESTONE_COUNTS = {
    1: 4,
    6: 4,
    9: 3,
    11: 3,
}


def _pending_milestones(scenario_id: int, passed_ids: set) -> list:
    total = SCENARIO_MILESTONE_COUNTS.get(scenario_id)
    if not total:
        return []
    return [m for m in range(1, total + 1) if m not in passed_ids]


def _active_pods_with_scenario() -> list:
    conn = get_db_connection()
    rows = conn.execute(
        "SELECT * FROM pods WHERE status='ACTIVE' AND scenario_id IS NOT NULL"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def _passed_milestone_ids(student_id: str, scenario_id: int) -> set:
    conn = get_db_connection()
    rows = conn.execute(
        "SELECT DISTINCT milestone_id FROM milestone_verification "
        "WHERE student_id=? AND scenario_id=? AND status='PASS'",
        (student_id, scenario_id),
    ).fetchall()
    conn.close()
    return {r["milestone_id"] for r in rows}


async def score_poll_once() -> None:
    if not scoring_state.SCORING_ENABLED:
        return

    for pod in _active_pods_with_scenario():
        raw_sid = pod.get("scenario_id")
        try:
            scenario_id = int(str(raw_sid).strip())
        except (TypeError, ValueError):
            continue

        pending = _pending_milestones(
            scenario_id, _passed_milestone_ids(pod["student_id"], scenario_id)
        )
        for milestone_id in pending:
            try:
                await verify_milestone(
                    pod,
                    scenario_id,
                    milestone_id,
                    scoring_enabled=scoring_state.SCORING_ENABLED,
                    ssh_verifier_cls=scoring_state.SSHVerifier,
                    detection_enabled=scoring_state.DETECTION_ENABLED,
                    detection_for=scoring_state.detection_for,
                    verify_siem_alert=scoring_state.verify_siem_alert,
                )
            except Exception as e:
                # verify_milestone raises HTTPException on infra failure (bad
                # container, lxc exec error, etc.); this is a background sweep,
                # not a request, so log and move on -- next tick retries, and
                # one broken pod must never block the others in the batch.
                logger.debug(f"[score_poller] pod {pod['pod_id']} m{milestone_id}: {e}")


async def score_poller():
    while True:
        try:
            await score_poll_once()
        except Exception as e:
            logger.error(f"[score_poller] loop error: {e}")
        await asyncio.sleep(SCORE_POLL_INTERVAL_SECONDS)
