"""Pod TTL reaper and storage drift cleanup."""
import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import Optional

from config import REAP_INTERVAL_SECONDS, STUCK_POD_GRACE_MINUTES, TTL_CHECK_INTERVAL_SECONDS
from db import get_db_connection, log_event
from pod_net import reconcile_pod_networks
from provision import cleanup_after_failure, perform_destruction
from ttl import is_ttl_expired, ttl_minutes_for

logger = logging.getLogger("provision_api")


def purge_storage_drift() -> None:
    """Drop storage_reservations whose vmid is not a live pod.

    Does not delete milestone_verification — DESTROYED pods still own scores.
    """
    conn = get_db_connection()
    with conn:
        d = conn.execute(
            "DELETE FROM storage_reservations WHERE vmid NOT IN "
            "(SELECT pod_id FROM pods WHERE status NOT IN "
            "('DESTROYED','FAILED_ROLLBACK_COMPLETE'))"
        )
        if d.rowcount:
            logger.info(f"[reaper] purged {d.rowcount} orphaned storage_reservations")
    conn.close()


async def reap_ttl_once() -> None:
    conn = get_db_connection()
    rows = conn.execute(
        "SELECT * FROM pods WHERE status='ACTIVE' AND created_at IS NOT NULL"
    ).fetchall()
    conn.close()
    now = datetime.now(timezone.utc)
    for row in rows:
        pod = dict(row)
        try:
            limit = ttl_minutes_for(pod.get("scenario_id"))
            expired = is_ttl_expired(pod.get("created_at"), limit, now)
        except Exception:
            logger.warning("[reaper] skip pod %s: bad created_at", pod.get("pod_id"))
            continue
        if not expired:
            continue
        pid = pod["pod_id"]
        cas = get_db_connection()
        with cas:
            cur = cas.execute(
                "UPDATE pods SET status='DESTROYING' WHERE pod_id=? AND status='ACTIVE'",
                (pid,),
            )
        won = cur.rowcount == 1
        cas.close()
        if not won:
            continue
        logger.info(
            f"[reaper] pod {pid} (student {pod.get('student_id')}) exceeded TTL {limit}m — destroying"
        )
        log_event("POD_TTL_REAP", student_id=pod.get("student_id"), pod_id=pid)
        try:
            await asyncio.to_thread(perform_destruction, pod)
        except Exception as e:
            logger.error(f"[reaper] destruction failed for pod {pid}: {e}")


async def pod_ttl_reaper():
    last_sweep: Optional[float] = None
    while True:
        logger.debug("reaper tick", extra={"event": "reaper_tick"})
        try:
            await reap_ttl_once()

            # Expiry runs every tick; the sweeps below only every
            # REAP_INTERVAL_SECONDS. Same loop, so a sweep never races a TTL
            # destroy that is still in flight.
            now = time.monotonic()
            if last_sweep is None or now - last_sweep >= REAP_INTERVAL_SECONDS:
                last_sweep = now

                # Stuck-state sweep (branch-review Issue 4). The TTL query above
                # only ever looks at status='ACTIVE', so a row left in
                # PROVISIONING or DESTROYING by a crashed background task, a hung
                # LXD call, or an API restart mid-flight is never revisited by
                # anything -- it permanently occupies a MAX_PODS slot and the v2
                # one-live-pod-per-student index until someone cleans up by hand.
                # Known residual: if cleanup/destruction takes longer than one
                # reap tick, the same row can be picked up again next tick and
                # re-dispatched; both cleanup_after_failure and perform_destruction
                # tolerate that (idempotent best-effort deletes), so a duplicate
                # dispatch is wasted work, not corruption.
                stuck_conn = get_db_connection()
                stuck_rows = stuck_conn.execute(
                    "SELECT * FROM pods WHERE status IN ('PROVISIONING','DESTROYING') "
                    "AND created_at IS NOT NULL AND created_at <= datetime('now', ?)",
                    (f"-{STUCK_POD_GRACE_MINUTES} minutes",),
                ).fetchall()
                stuck_conn.close()
                for row in stuck_rows:
                    pod = dict(row)
                    pid = pod["pod_id"]
                    if pod["status"] == "PROVISIONING":
                        cas = get_db_connection()
                        with cas:
                            cur = cas.execute(
                                "UPDATE pods SET status='DESTROYING' WHERE pod_id=? AND status='PROVISIONING'",
                                (pid,),
                            )
                        won = cur.rowcount == 1
                        cas.close()
                        if not won:
                            continue
                        logger.warning(
                            f"[reaper] pod {pid} (student {pod.get('student_id')}) stuck in "
                            f"PROVISIONING past {STUCK_POD_GRACE_MINUTES}m grace — forcing rollback"
                        )
                        log_event("POD_STUCK_PROVISIONING_REAP", student_id=pod.get("student_id"), pod_id=pid)
                        try:
                            await asyncio.to_thread(
                                cleanup_after_failure,
                                pod.get("student_id"),
                                pid,
                                pod.get("wazuh_agent_id"),
                                pod.get("connection_id"),
                            )
                        except Exception as e:
                            logger.error(f"[reaper] stuck-provisioning cleanup failed for pod {pid}: {e}")
                    else:  # DESTROYING
                        logger.warning(
                            f"[reaper] pod {pid} (student {pod.get('student_id')}) stuck in "
                            f"DESTROYING past {STUCK_POD_GRACE_MINUTES}m grace — retrying destruction"
                        )
                        log_event("POD_STUCK_DESTROYING_REAP", student_id=pod.get("student_id"), pod_id=pid)
                        try:
                            await asyncio.to_thread(perform_destruction, pod)
                        except Exception as e:
                            logger.error(f"[reaper] stuck-destroying retry failed for pod {pid}: {e}")

                purge_storage_drift()

                await asyncio.to_thread(reconcile_pod_networks)
        except Exception as e:
            logger.error(f"[reaper] loop error: {e}")
        await asyncio.sleep(TTL_CHECK_INTERVAL_SECONDS)