"""Pod provisioning and lifecycle API routes."""
import hmac
import json
import logging
import os
import sqlite3
from datetime import datetime, timezone
from typing import Optional, Union
from pydantic import BaseModel

logger = logging.getLogger(__name__)

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, Header, HTTPException, Query, Response, UploadFile, status

import auth
from auth import caller_identity, require_owner, verify_token
from capacity import available_ram_mb, can_provision_ram, count_active_pods, ram_required_mb
from config import MAX_PODS, POD_STORAGE_MB, STORAGE_LIMIT_MB
from db import get_db_connection, log_event
from knowledge_gain import (
    TelemetrySaltConfigError,
    compute_knowledge_gain_summary,
    extract_knowledge_gain_records,
    format_records_csv,
)
from models import (
    FlagSubmissionRequest,
    FlagSubmissionResponse,
    MilestoneRubricResponse,
    PodResponse,
    ProvisionRequest,
    ReviewResolveRequest,
    ReviewResolveResponse,
    ReviewResubmitRequest,
    ReviewResubmitResponse,
    ScenarioRubricsResponse,
    VerificationResponse,
)
from hybrid_scoring import evaluate_hybrid_submission
from rubrics import CATALOG_SCENARIO_IDS, list_rubrics
from provision import get_lxd_free_mb, perform_destruction, perform_provisioning, vmids_for_pod
import lab_history
import evidence_images
from scoring import record_browser_milestone, verify_milestone
from ttl import ttl_payload

# SEC-01 (#36): every route here requires one of the three application roles,
# on top of whatever narrower check the route adds (require_owner,
# require_role(["instructor", "admin"]), ...). See auth.require_app_role.
router = APIRouter(dependencies=[Depends(auth.require_app_role)])

# Shared-secret browser scoring (#109). No JWT / require_app_role — the portal
# Node process authenticates with X-Browser-Score-Secret only.
internal_router = APIRouter()

_BROWSER_LABELS = {
    1: "browser:sqli-m1",
    2: "browser:sqli-m2",
    3: "browser:sqli-m3",
    4: "browser:xss-m4",
}


class BrowserScoreIn(BaseModel):
    student_id: str
    pod_id: int
    scenario_id: int
    milestone_id: int
    label: str


def _pod_scenario_is_06(raw) -> bool:
    return str(raw).lstrip("0") == "6" or str(raw) in {"6", "06"}


@internal_router.post("/internal/browser-score")
def browser_score(
    body: BrowserScoreIn,
    x_browser_score_secret: str = Header(default=""),
):
    expected = os.environ.get("BROWSER_SCORE_SECRET") or ""
    if not expected:
        logger.warning(
            "BROWSER_SCORE_SECRET is unset; POST /internal/browser-score returns 503. "
            "Set the same value in env/.env and portal/.env.local."
        )
        raise HTTPException(status_code=503, detail="Browser scoring is not configured")
    got = x_browser_score_secret or ""
    # Bytes compare: never raises on non-ASCII (str compare_digest would -> 500),
    # and returns False for unequal length. Guarantees 401, not 500.
    if not hmac.compare_digest(got.encode("utf-8"), expected.encode("utf-8")):
        raise HTTPException(status_code=401, detail="Unauthorized")
    if body.scenario_id != 6 or body.milestone_id not in _BROWSER_LABELS:
        raise HTTPException(status_code=400, detail="Unsupported milestone")
    if body.label != _BROWSER_LABELS[body.milestone_id]:
        raise HTTPException(status_code=400, detail="Label does not match milestone")

    conn = get_db_connection()
    try:
        row = conn.execute(
            "SELECT * FROM pods WHERE pod_id=?", (body.pod_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Pod not found")
        pod = dict(row)
        if pod["status"] != "ACTIVE":
            raise HTTPException(
                status_code=409, detail=f"Pod not active (status: {pod['status']})"
            )
        if pod["student_id"] != body.student_id:
            raise HTTPException(status_code=403, detail="Pod owner mismatch")
        if not _pod_scenario_is_06(pod.get("scenario_id")):
            raise HTTPException(status_code=409, detail="Pod is not on scenario 06")
        with conn:
            record_browser_milestone(conn, pod, body.milestone_id, body.label)
    finally:
        conn.close()
    return {"status": "PASS", "milestone_id": body.milestone_id}


def _scoring_deps() -> dict:
    import scoring_state

    return {
        "scoring_enabled": scoring_state.SCORING_ENABLED,
        "ssh_verifier_cls": scoring_state.SSHVerifier,
        "detection_enabled": scoring_state.DETECTION_ENABLED,
        "detection_for": scoring_state.detection_for,
        "verify_siem_alert": scoring_state.verify_siem_alert,
    }


def serialize_pod(row) -> dict:
    body = dict(row)
    body.update(ttl_payload(body.get("created_at"), body.get("scenario_id")))
    return body


def serialize_instructor_pod(row) -> dict:
    body = serialize_pod(row)
    for k in list(body.keys()):
        if k.startswith("vmid_") or k in ("connection_id", "wazuh_agent_id"):
            body.pop(k, None)
    return body


def list_milestones_for_pod(pod: dict) -> list:
    """Historical PASSes/FAILs for this student+scenario. Empty if scenario_id missing."""
    raw_sid = pod["scenario_id"] if pod["scenario_id"] is not None else None
    if raw_sid is None or str(raw_sid).strip() == "":
        return []
    try:
        scenario_int = int(str(raw_sid).strip())
    except (TypeError, ValueError):
        return []
    conn = get_db_connection()
    rows = conn.execute(
        "SELECT scenario_id, milestone_id, status, detection_score, verified_at "
        "FROM milestone_verification "
        "WHERE student_id = ? AND scenario_id = ? "
        "ORDER BY verified_at DESC",
        (pod["student_id"], scenario_int),
    ).fetchall()
    conn.close()
    return [dict(m) for m in rows]


# --- One-shot Manual Check lock (G1) -----------------------------------------
# A student-initiated Manual Check (verify_milestone_route) is allowed once per
# milestone. A failed attempt is recorded in manual_check_attempts and locks the
# task to instructor review. The background auto-detect poller calls
# verify_milestone() directly (not this route), so its FAILs never consume the
# student's one attempt.


def _milestone_has_pass(conn: sqlite3.Connection, student_id: str, scenario_id: int, milestone_id: int) -> bool:
    row = conn.execute(
        "SELECT 1 FROM milestone_verification "
        "WHERE student_id=? AND scenario_id=? AND milestone_id=? AND status='PASS' LIMIT 1",
        (student_id, scenario_id, milestone_id),
    ).fetchone()
    return row is not None


def _manual_check_consumed(conn: sqlite3.Connection, student_id: str, scenario_id: int, milestone_id: int) -> bool:
    if not _has_table(conn, "manual_check_attempts"):
        return False
    row = conn.execute(
        "SELECT 1 FROM manual_check_attempts "
        "WHERE student_id=? AND scenario_id=? AND milestone_id=? LIMIT 1",
        (student_id, scenario_id, milestone_id),
    ).fetchone()
    return row is not None


def manual_check_locked_ids(student_id: str, scenario_id: int) -> list:
    """Milestone ids whose single Manual Check was used and did not result in a
    PASS (so the task is awaiting instructor review). Empty on legacy DBs without
    the table."""
    conn = get_db_connection()
    try:
        if not _has_table(conn, "manual_check_attempts"):
            return []
        rows = conn.execute(
            "SELECT a.milestone_id FROM manual_check_attempts a "
            "WHERE a.student_id=? AND a.scenario_id=? "
            "  AND NOT EXISTS ("
            "    SELECT 1 FROM milestone_verification v "
            "    WHERE v.student_id=a.student_id AND v.scenario_id=a.scenario_id "
            "      AND v.milestone_id=a.milestone_id AND v.status='PASS')",
            (student_id, scenario_id),
        ).fetchall()
        return [r["milestone_id"] for r in rows]
    finally:
        conn.close()


def _has_table(conn: sqlite3.Connection, name: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1", (name,)
    ).fetchone()
    return row is not None


def earned_points(milestones: list, catalog: dict) -> int:
    """Sum catalog points once per (scenario_id, milestone_id) PASS."""
    seen: set = set()
    pts = 0
    for row in milestones:
        if row["status"] != "PASS":
            continue
        sid = int(row["scenario_id"])
        mid = int(row["milestone_id"])
        key = (sid, mid)
        if key in seen:
            continue
        seen.add(key)
        pts += int(catalog.get(sid, {}).get(mid, 0))
    return pts


@router.post("/pods/provision", status_code=status.HTTP_202_ACCEPTED)
async def provision_pod(
    request: ProvisionRequest,
    background_tasks: BackgroundTasks,
    claims: dict = Depends(verify_token),
):
    student_id = caller_identity(claims, request.student_id)
    if not student_id:
        raise HTTPException(status_code=401, detail="Identity required")

    # Host I/O happens BEFORE the write lock is taken. available_ram_mb() reads
    # /proc/meminfo and get_lxd_free_mb() is a pylxd RPC over the LXD unix
    # socket; SQLite has a single writer, so holding BEGIN IMMEDIATE across
    # either one lets a slow or hung LXD stall heartbeat updates, destroy
    # transitions, and the TTL reaper (branch-review Issue 5).
    #
    # Accepted cost: both readings are staler by the duration of the lock
    # acquisition when the gates below consume them, which marginally widens the
    # point-in-time window documented as Issue 2. That is the right trade -- a
    # stalled single-writer lock is a whole-API outage, while a slightly stale
    # free-memory reading is bounded by MAX_PODS. Do NOT "fix" this by moving
    # the probes back inside the transaction.
    avail_mb = available_ram_mb()
    free_mb = get_lxd_free_mb()
    pod_storage_mb = POD_STORAGE_MB

    conn = get_db_connection()
    try:
        conn.execute("BEGIN IMMEDIATE")

        # Re-checked INSIDE the lock. Run before BEGIN IMMEDIATE, two concurrent
        # requests for one student could both see "no existing pod" and both
        # insert (branch-review Issue 3). schema v2's partial unique index is
        # the durable backstop; this check turns the race into a clean 409.
        existing = conn.execute(
            "SELECT pod_id FROM pods WHERE student_id=? AND status NOT IN ('DESTROYED','FAILED_ROLLBACK_COMPLETE')",
            (student_id,),
        ).fetchone()
        if existing:
            conn.rollback()
            raise HTTPException(
                status_code=409,
                detail={"error": "ALREADY_PROVISIONED", "pod_id": existing["pod_id"]},
            )

        active_pods = count_active_pods(conn)
        # MAX_PODS is the concurrency policy; the 1..6 slot pool below is only
        # the fixed pod-id/IP address space and must not be relied on alone
        # to enforce it (it was previously unenforced here). Detail stays a
        # BARE STRING: the portal compares it by identity
        # (cyberrange-portal/src/hooks/useScenarioPod.ts).
        if active_pods >= MAX_PODS:
            conn.rollback()
            raise HTTPException(status_code=503, detail="POD_CAP_REACHED")

        cursor = conn.execute("""
            SELECT MIN(available) FROM (
                SELECT 1 AS available UNION ALL SELECT 2 UNION ALL SELECT 3
                UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6
            ) WHERE available NOT IN (
                SELECT pod_id FROM pods
                WHERE status NOT IN ('DESTROYED', 'FAILED_ROLLBACK_COMPLETE')
            )
        """)
        pod_id = cursor.fetchone()[0]
        if pod_id is None:
            conn.rollback()
            raise HTTPException(status_code=503, detail="POD_CAP_REACHED")

        vmids = vmids_for_pod(pod_id, student_id)

        # MemAvailable already excludes RAM resident in RUNNING pods, so a
        # plain ram_required_mb(1) is correct once a pod's containers have
        # actually booted. It is NOT correct for pods still PROVISIONING:
        # avail_mb was sampled before this lock, and a concurrently-admitted
        # pod's containers may still be ramping up RAM usage that /proc/meminfo
        # has not caught up to yet. Reserve a full POD_RAM_MB per in-flight
        # PROVISIONING row as a conservative (worst-case) bound, in addition to
        # the pod being admitted here (branch-review Issue 11). ACTIVE rows are
        # deliberately excluded -- their RAM is already resident and already
        # reflected in avail_mb; reserving for them too would double-count.
        provisioning_count = conn.execute(
            "SELECT COUNT(*) FROM pods WHERE status='PROVISIONING'"
        ).fetchone()[0]
        pods_to_reserve = provisioning_count + 1
        if not can_provision_ram(avail_mb, adding=pods_to_reserve):
            conn.rollback()
            need = ram_required_mb(pods_to_reserve)
            raise HTTPException(
                status_code=503,
                detail=f"RAM_FULL: {avail_mb} MB available, need {need} MB for new pod",
            )

        if free_mb is not None:
            if free_mb < pod_storage_mb:
                conn.rollback()
                raise HTTPException(
                    status_code=503,
                    detail=f"STORAGE_FULL: Insufficient space ({free_mb:.0f} MB free, need {pod_storage_mb} MB)",
                )
        else:
            # Live LXD reading failed (see get_lxd_free_mb's own warning), so only
            # the coarser DB accounting guards disk here. Say so: a hard-coded
            # pool name once left this fallback in use on the live host unnoticed.
            logger.warning(
                "STORAGE gate: LXD free-space reading unavailable; falling back to "
                "DB accounting against STORAGE_LIMIT_MB=%s", STORAGE_LIMIT_MB
            )
            cursor2 = conn.execute("SELECT COALESCE(SUM(size_mb), 0) FROM storage_reservations")
            db_used_mb = cursor2.fetchone()[0]
            if db_used_mb + pod_storage_mb > STORAGE_LIMIT_MB:
                conn.rollback()
                raise HTTPException(status_code=503, detail="STORAGE_FULL: DB accounting limit exceeded")

        conn.execute("DELETE FROM storage_reservations WHERE vmid=?", (pod_id,))
        conn.execute("DELETE FROM pods WHERE pod_id=?", (pod_id,))

        conn.execute(
            "INSERT INTO pods (student_id, pod_id, vmid_kali, vmid_meta, vmid_dvwa, status, scenario_id) VALUES (?,?,?,?,?,?,?)",
            (student_id, pod_id, vmids["kali"], vmids["meta"], vmids["dvwa"], "PROVISIONING", request.scenario_id),
        )
        # Real start of this lab for the instructor SIEM history (v8). Same
        # transaction, so a refused/rolled-back provision leaves no session.
        lab_history.record_lab_start(conn, pod_id)
        # Same unit the gate above compared. A literal here (was 15360) drifts
        # from POD_STORAGE_MB, and this row is exactly what the DB-accounting
        # fallback sums (branch-review Issue 4).
        conn.execute(
            "INSERT INTO storage_reservations (vmid, size_mb) VALUES (?,?)",
            (pod_id, pod_storage_mb),
        )

        conn.commit()

    except sqlite3.Error as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Database error: {e}")
    finally:
        # Issue 13: the previous handler rolled back but never closed, leaking a
        # connection on every DB fault. finally covers the HTTPException refusal
        # paths too -- HTTPException is not a sqlite3.Error, so it propagates
        # past the except clause and still runs this.
        conn.close()

    background_tasks.add_task(perform_provisioning, student_id, pod_id, vmids, request.scenario_id)
    return {"status": "provisioning", "pod_id": pod_id, "vmids": vmids}


@router.get("/pods")
def list_pods(student_id: Optional[str] = None, claims: dict = Depends(verify_token)):
    # Preserve query ?student_id= before caller_identity overwrites it under AUTH_ENABLED.
    # Non-admins never use the query (identity wins). Admins may filter with it; omit for all.
    query_student_id = (student_id or "").strip() or None
    identity = caller_identity(claims, student_id)
    # With AUTH_ENABLED=true, caller_identity ignores the query fallback and
    # returns only claims["preferred_username"]. A token that introspects as
    # active but omits that claim (service account, misconfigured mapper,
    # empty string) must not silently fall through to the unfiltered branch
    # below and enumerate every student's pods (branch-review Issue 1). The
    # unfiltered branch stays reachable only in AUTH_ENABLED=false bootstrap
    # mode, where it is the existing documented admin-list behaviour.
    # Admin (Issue #29): no query → all live pods; ?student_id= → that owner only.
    if auth.AUTH_ENABLED and not identity:
        raise HTTPException(status_code=401, detail="Identity required")
    is_admin = auth.AUTH_ENABLED and "admin" in auth.extract_roles(claims)
    conn = get_db_connection()
    base = "SELECT * FROM pods WHERE status NOT IN ('DESTROYED','FAILED_ROLLBACK_COMPLETE')"
    if is_admin:
        if query_student_id:
            rows = conn.execute(
                base + " AND student_id=? ORDER BY pod_id", (query_student_id,)
            ).fetchall()
        else:
            rows = conn.execute(base + " ORDER BY pod_id").fetchall()
    elif identity:
        rows = conn.execute(base + " AND student_id=? ORDER BY pod_id", (identity,)).fetchall()
    else:
        rows = conn.execute(base + " ORDER BY pod_id").fetchall()
    conn.close()
    return {"pods": [serialize_pod(r) for r in rows]}


@router.get("/pods/{pod_id}/status", response_model=PodResponse)
def get_pod_status(pod_id: int, claims: dict = Depends(verify_token)):
    conn = get_db_connection()
    pod = conn.execute("SELECT * FROM pods WHERE pod_id=?", (pod_id,)).fetchone()
    if not pod:
        conn.close()
        raise HTTPException(status_code=404, detail="Pod not found")

    auth.require_owner_or_admin(pod, claims)

    if pod["status"] == "ACTIVE":
        conn.execute("UPDATE pods SET last_heartbeat=CURRENT_TIMESTAMP WHERE pod_id=?", (pod_id,))
        conn.commit()

    conn.close()
    return PodResponse(**serialize_pod(pod))


@router.get("/pods/{pod_id}/guac-token")
def get_pod_guac_token(pod_id: int, claims: dict = Depends(verify_token)):
    conn = get_db_connection()
    row = conn.execute(
        "SELECT student_id, status, connection_id FROM pods WHERE pod_id=?", (pod_id,)
    ).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Pod not found")

    require_owner(row, claims)

    if row["status"] != "ACTIVE":
        raise HTTPException(status_code=409, detail=f"Pod is {row['status']}, not ACTIVE")
    return {"token": "native-xterm-ws", "connection_id": 0}


@router.get("/pods/{pod_id}/lab-urls")
def get_pod_lab_urls(pod_id: int, claims: dict = Depends(verify_token)):
    """Student browser URLs for DVWA / SIEM (owner-only). See lab_proxy.py."""
    from lab_proxy import lab_urls_payload, probe_dvwa_proxy

    conn = get_db_connection()
    row = conn.execute(
        "SELECT student_id, status FROM pods WHERE pod_id=?", (pod_id,)
    ).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Pod not found")

    require_owner(row, claims)

    if row["status"] != "ACTIVE":
        raise HTTPException(status_code=409, detail=f"Pod is {row['status']}, not ACTIVE")

    payload = lab_urls_payload(pod_id, row["student_id"])
    status_code = probe_dvwa_proxy(pod_id)
    if status_code is None:
        payload["dvwa"]["ready"] = False
        payload["dvwa"]["probe"] = "unreachable"
        payload["dvwa"]["note"] = (
            payload["dvwa"].get("note", "")
            + " Proxy probe failed — re-provision if this pod predates lab-proxy, "
            "or check host listen address / firewall."
        )
    else:
        payload["dvwa"]["probe"] = status_code
    return payload


@router.delete("/pods/{pod_id}/destroy")
async def destroy_pod(
    pod_id: int, background_tasks: BackgroundTasks, claims: dict = Depends(verify_token)
):
    conn = get_db_connection()
    pod = conn.execute("SELECT * FROM pods WHERE pod_id=?", (pod_id,)).fetchone()
    if not pod:
        conn.close()
        raise HTTPException(status_code=404, detail="Pod not found")

    require_owner(pod, claims)

    # CAS: only ACTIVE/FAILED_ROLLBACK_COMPLETE rows may transition to
    # DESTROYING. PROVISIONING is excluded because perform_provisioning and
    # perform_destruction both touch the same LXD instances and OVN network --
    # tearing down mid-provision races them and can leave status flapping
    # between ACTIVE/DESTROYED/FAILED_ROLLBACK_COMPLETE. DESTROYING/DESTROYED
    # are excluded so two concurrent destroy calls -- or a destroy of an
    # already-destroyed pod -- don't both schedule perform_destruction
    # (branch-review Issue 3).
    cur = conn.execute(
        "UPDATE pods SET status='DESTROYING' WHERE pod_id=? AND status IN ('ACTIVE','FAILED_ROLLBACK_COMPLETE')",
        (pod_id,),
    )
    if cur.rowcount == 0:
        conn.close()
        raise HTTPException(
            status_code=409,
            detail=f"Pod is {pod['status']}, cannot destroy from this state",
        )
    conn.commit()
    conn.close()

    background_tasks.add_task(perform_destruction, dict(pod))
    return {"status": "destroying", "pod_id": pod_id}


@router.delete("/admin/pods/{pod_id}/force-destroy")
async def admin_force_destroy_pod(
    pod_id: int, background_tasks: BackgroundTasks, claims: dict = Depends(verify_token)
):
    """Admin-only destroy via existing teardown (ACTIVE / FAILED_ROLLBACK_COMPLETE).

    Audited like user-management writes (ADMIN_POD_FORCE_DESTROY), recording
    which Admin destroyed whose pod. The role check runs first, so a denied
    non-Admin attempt writes nothing (SEC-02 asserts audit_log is unchanged).
    """
    auth.require_role(["admin"], claims)
    actor = caller_identity(claims, None) or "unknown"
    conn = get_db_connection()
    pod = conn.execute("SELECT * FROM pods WHERE pod_id=?", (pod_id,)).fetchone()
    if not pod:
        conn.close()
        _audit_force_destroy(None, pod_id, "FAILED", f"actor={actor} reason=not_found")
        raise HTTPException(status_code=404, detail="Pod not found")

    # PROVISIONING excluded: in-flight perform_provisioning can still flip to ACTIVE.
    # DESTROYING excluded: immediate re-dispatch would race concurrent LXD teardown;
    # stuck DESTROYING retries stay with the reaper after STUCK_POD_GRACE_MINUTES.
    cur = conn.execute(
        "UPDATE pods SET status='DESTROYING' WHERE pod_id=? AND status IN "
        "('ACTIVE','FAILED_ROLLBACK_COMPLETE')",
        (pod_id,),
    )
    if cur.rowcount == 0:
        status = pod["status"]
        conn.close()
        _audit_force_destroy(
            pod["student_id"], pod_id, "FAILED", f"actor={actor} reason=state status={status}"
        )
        raise HTTPException(
            status_code=409,
            detail=f"Pod is {status}, cannot force-destroy from this state",
        )
    conn.commit()
    conn.close()

    _audit_force_destroy(
        pod["student_id"], pod_id, "OK", f"actor={actor} previous_status={pod['status']}"
    )
    background_tasks.add_task(perform_destruction, dict(pod))
    return {"status": "destroying", "pod_id": pod_id}


def _audit_force_destroy(student_id: Optional[str], pod_id: int, result: str, detail: str) -> None:
    # Records the request (who asked, for whose pod, from what state). The
    # teardown itself runs in the background and is logged by provision.py.
    try:
        log_event(
            "ADMIN_POD_FORCE_DESTROY",
            student_id=student_id or "",
            pod_id=pod_id,
            result=result,
            detail=detail,
        )
    except Exception:
        # Never let an audit-DB hiccup turn an accepted destroy into a 500.
        logger.exception("ADM-POD audit write failed: pod_id=%s result=%s", pod_id, result)


@router.post(
    "/pods/{pod_id}/verify/{scenario_id}/{milestone_id}", response_model=VerificationResponse
)
async def verify_milestone_route(
    pod_id: int,
    scenario_id: int,
    milestone_id: int,
    claims: dict = Depends(verify_token),
):
    deps = _scoring_deps()
    conn = get_db_connection()
    pod = conn.execute("SELECT * FROM pods WHERE pod_id=?", (pod_id,)).fetchone()
    if not pod:
        conn.close()
        raise HTTPException(status_code=404, detail="Pod not found")

    require_owner(pod, claims)

    if pod["status"] != "ACTIVE":
        conn.close()
        raise HTTPException(status_code=409, detail=f"Pod not active (status: {pod['status']})")

    pod = dict(pod)
    student_id = pod["student_id"]
    # UTC to match every other timestamp (hybrid_scoring, CURRENT_TIMESTAMP);
    # the frontend parses all timestamps as UTC, so a naive-local value here
    # would display shifted by the viewer's offset.
    now_iso = datetime.now(timezone.utc).isoformat()

    # G1 one-shot Manual Check gate (student-initiated check only):
    #  1. already passed      -> idempotent PASS (no new attempt)
    #  2. one check used, no pass -> REVIEW (locked to instructor review)
    #  3. otherwise           -> run the single allowed check, then record it
    if _milestone_has_pass(conn, student_id, scenario_id, milestone_id):
        conn.close()
        return VerificationResponse(
            status="PASS",
            message="This task is already complete.",
            pod_id=pod_id,
            scenario_id=scenario_id,
            milestone_id=milestone_id,
            detection_score=0,
            verified_at=now_iso,
        )
    if _manual_check_consumed(conn, student_id, scenario_id, milestone_id):
        conn.close()
        return VerificationResponse(
            status="REVIEW",
            message=(
                "Your Manual Check has already been used for this task and it could not "
                "verify your work. Ask an instructor to review it."
            ),
            pod_id=pod_id,
            scenario_id=scenario_id,
            milestone_id=milestone_id,
            detection_score=0,
            verified_at=now_iso,
        )
    conn.close()

    resp = await verify_milestone(pod, scenario_id, milestone_id, **deps)

    # Consume the one attempt on a definitive PASS/FAIL (an infra ERROR/UNKNOWN
    # does not burn it). A later auto-detect PASS still clears the locked state.
    if resp.status in ("PASS", "FAIL"):
        rec = get_db_connection()
        try:
            if _has_table(rec, "manual_check_attempts"):
                with rec:
                    rec.execute(
                        "INSERT OR IGNORE INTO manual_check_attempts "
                        "(student_id, scenario_id, milestone_id, result) VALUES (?,?,?,?)",
                        (student_id, scenario_id, milestone_id, resp.status),
                    )
        finally:
            rec.close()

    return resp


@router.get("/progress")
def get_progress(claims: dict = Depends(verify_token)):
    student_id = caller_identity(claims, None)
    if not student_id:
        raise HTTPException(status_code=401, detail="Identity required")
    conn = get_db_connection()
    rows = conn.execute(
        "SELECT pod_id, scenario_id, milestone_id, status, detection_score, verified_at "
        "FROM milestone_verification WHERE student_id=? ORDER BY verified_at DESC",
        (student_id,),
    ).fetchall()
    conn.close()
    return {"student_id": student_id, "milestones": [dict(r) for r in rows]}


@router.delete("/progress/{scenario_id}")
def reset_scenario_progress(scenario_id: int, claims: dict = Depends(verify_token)):
    """Permanently delete this caller's own milestone_verification rows for one
    scenario ("Try Again" reset). Scoped to caller_identity(claims) only -- a
    student can never target another student_id, since it's derived from the
    verified token, not a request parameter.

    Irreversible by design (the student explicitly asked to reset); the
    audit_log entry below is what survives the deletion, not the rows
    themselves.
    """
    student_id = caller_identity(claims, None)
    if not student_id:
        raise HTTPException(status_code=401, detail="Identity required")

    conn = get_db_connection()
    with conn:
        deleted = conn.execute(
            "DELETE FROM milestone_verification WHERE student_id=? AND scenario_id=?",
            (student_id, scenario_id),
        ).rowcount
        # Also clear one-shot Manual Check attempts for this scenario. Otherwise
        # reset ("Try Again") removes the PASS row but leaves the attempt row, so
        # manual_check_locked_ids still reports the milestone locked to instructor
        # review and the student can never re-run the automated check.
        attempts_cleared = 0
        if _has_table(conn, "manual_check_attempts"):
            attempts_cleared = conn.execute(
                "DELETE FROM manual_check_attempts WHERE student_id=? AND scenario_id=?",
                (student_id, scenario_id),
            ).rowcount
    conn.close()

    log_event(
        "SCENARIO_PROGRESS_RESET",
        student_id=student_id,
        detail=f"scenario_id={scenario_id}, {deleted} milestone row(s) deleted, "
               f"{attempts_cleared} manual-check attempt(s) cleared",
    )

    return {"student_id": student_id, "scenario_id": scenario_id, "deleted": deleted}


@router.post(
    "/progress/{scenario_id}/flag",
    response_model=FlagSubmissionResponse,
)
async def submit_milestone_flag(
    scenario_id: str,
    body: FlagSubmissionRequest,
    claims: dict = Depends(verify_token),
):
    """Submit a milestone flag for hybrid scoring correlation (SCORE-HYBRID).

    Evaluates the 3-outcome state machine:
    - Flag + State agree -> PASS
    - Flag without State -> server-side escalate; student sees INCOMPLETE (no review_id)
    - State without Flag -> server-side escalate; student sees INCOMPLETE (no review_id)
    - Neither -> INCOMPLETE

    Student-visible outcome ESCALATED is unused by Case 2/3; FlagSubmissionResponse
    keeps the Literal for compatibility. Cases 2/3 still escalate server-side.
    """
    student_id = caller_identity(claims, None)
    if not student_id:
        raise HTTPException(status_code=401, detail="Identity required")

    try:
        scen_id_int = int(scenario_id)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail=f"Invalid scenario_id: {scenario_id}")

    if scen_id_int not in CATALOG_SCENARIO_IDS:
        raise HTTPException(
            status_code=400,
            detail=f"Scenario {scen_id_int} is not an active catalog scenario {CATALOG_SCENARIO_IDS}",
        )

    clean_flag = body.flag.strip() if body.flag else ""
    if not clean_flag:
        raise HTTPException(status_code=400, detail="Flag cannot be empty")

    conn = get_db_connection()
    try:
        result = await evaluate_hybrid_submission(
            conn,
            student_id=student_id,
            scenario_id=scen_id_int,
            milestone_id=body.milestone_id,
            submitted_flag=clean_flag,
        )
        return FlagSubmissionResponse(
            outcome=result.outcome,
            status=result.status,
            scenario_id=result.scenario_id,
            milestone_id=result.milestone_id,
            message=result.message,
            review_id=result.review_id,
            verified_at=result.verified_at,
            rubric_criteria=result.rubric_criteria,
        )
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    finally:
        conn.close()


@router.get(
    "/progress/{scenario_id}/rubrics",
    response_model=ScenarioRubricsResponse,
)
def get_scenario_rubrics(
    scenario_id: str,
    claims: dict = Depends(verify_token),
):
    """Retrieve rubric criteria for all milestones in a scenario.

    Excludes expected_flag to prevent answer-key leakage (Anti Agent invariant).
    """
    student_id = caller_identity(claims, None)
    if not student_id:
        raise HTTPException(status_code=401, detail="Identity required")

    try:
        scen_id_int = int(scenario_id)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail=f"Invalid scenario_id: {scenario_id}")

    if scen_id_int not in CATALOG_SCENARIO_IDS:
        raise HTTPException(
            status_code=400,
            detail=f"Scenario {scen_id_int} is not an active catalog scenario {CATALOG_SCENARIO_IDS}",
        )

    conn = get_db_connection()
    try:
        rubrics_list = list_rubrics(conn, scen_id_int)
        clean_rubrics = [
            MilestoneRubricResponse(
                scenario_id=r["scenario_id"],
                milestone_id=r["milestone_id"],
                name=r["name"],
                criteria=r["criteria"],
                points=r.get("points", 50),
                mitre_technique=r.get("mitre_technique"),
                nist_phase=r.get("nist_phase"),
            )
            for r in rubrics_list
        ]
        return ScenarioRubricsResponse(
            scenario_id=scen_id_int,
            rubrics=clean_rubrics,
        )
    finally:
        conn.close()


@router.get("/pods/{pod_id}/milestones")
def get_pod_milestones(pod_id: int, claims: dict = Depends(verify_token)):
    conn = get_db_connection()
    pod = conn.execute("SELECT * FROM pods WHERE pod_id=?", (pod_id,)).fetchone()
    if not pod:
        conn.close()
        raise HTTPException(status_code=404, detail="Pod not found")

    require_owner(pod, claims)
    conn.close()

    pod = dict(pod)
    # Scenario id this pod is running, used to scope the Manual Check lock set.
    locked: list = []
    raw_sid = pod.get("scenario_id")
    if raw_sid is not None and str(raw_sid).strip() != "":
        try:
            locked = manual_check_locked_ids(pod["student_id"], int(str(raw_sid).strip()))
        except (TypeError, ValueError):
            locked = []

    return {
        "pod_id": pod_id,
        "student_id": pod["student_id"],
        "milestones": list_milestones_for_pod(pod),
        # Milestones whose single Manual Check was used without passing -> the
        # portal shows "awaiting instructor review" instead of a Manual Check button.
        "manual_check_locked": locked,
    }


@router.get("/instructor/pods")
def instructor_list_pods(claims: dict = Depends(verify_token)):
    """List all active student pods with milestone progress for instructor monitoring."""
    auth.require_role(["instructor", "admin"], claims)
    conn = get_db_connection()
    rows = conn.execute(
        "SELECT * FROM pods WHERE status NOT IN ('DESTROYED','FAILED_ROLLBACK_COMPLETE') ORDER BY pod_id"
    ).fetchall()
    pods = []
    for r in rows:
        pod_dict = serialize_instructor_pod(r)
        pod_dict["milestones"] = list_milestones_for_pod(dict(r))
        pods.append(pod_dict)
    conn.close()
    return {"pods": pods}


@router.get("/instructor/students")
def instructor_list_students(claims: dict = Depends(verify_token)):
    """List all students across pods, milestone verifications, and reviews with their current and historical progress."""
    auth.require_role(["instructor", "admin"], claims)
    conn = get_db_connection()
    student_rows = conn.execute(
        "SELECT DISTINCT student_id FROM ("
        "  SELECT student_id FROM milestone_verification WHERE student_id IS NOT NULL AND TRIM(student_id) != '' "
        "  UNION "
        "  SELECT student_id FROM pods WHERE student_id IS NOT NULL AND TRIM(student_id) != '' "
        "  UNION "
        "  SELECT student_id FROM review_cases WHERE student_id IS NOT NULL AND TRIM(student_id) != '' "
        ") ORDER BY student_id"
    ).fetchall()

    # 1. Grouped query for active pods across all students (latest non-destroyed pod per student)
    active_pod_rows = conn.execute(
        "SELECT * FROM pods "
        "WHERE status NOT IN ('DESTROYED', 'FAILED_ROLLBACK_COMPLETE') "
        "  AND student_id IS NOT NULL AND TRIM(student_id) != '' "
        "ORDER BY pod_id DESC"
    ).fetchall()
    active_pods_by_student = {}
    for p_row in active_pod_rows:
        sid = p_row["student_id"]
        if sid not in active_pods_by_student:
            active_pods_by_student[sid] = serialize_instructor_pod(p_row)

    # 2. Grouped query for historical milestones across all students
    milestone_rows = conn.execute(
        "SELECT student_id, scenario_id, milestone_id, status, detection_score, verified_at "
        "FROM milestone_verification "
        "WHERE student_id IS NOT NULL AND TRIM(student_id) != '' "
        "ORDER BY verified_at DESC"
    ).fetchall()
    milestones_by_student = {}
    for m_row in milestone_rows:
        sid = m_row["student_id"]
        milestones_by_student.setdefault(sid, []).append({
            "scenario_id": m_row["scenario_id"],
            "milestone_id": m_row["milestone_id"],
            "status": m_row["status"],
            "detection_score": m_row["detection_score"],
            "verified_at": m_row["verified_at"],
        })

    # 3. Grouped query for pending review counts per student
    pending_rows = conn.execute(
        "SELECT student_id, COUNT(*) AS pending_count "
        "FROM review_cases "
        "WHERE status = 'PENDING' AND student_id IS NOT NULL AND TRIM(student_id) != '' "
        "GROUP BY student_id"
    ).fetchall()
    pending_counts_by_student = {
        r["student_id"]: r["pending_count"] for r in pending_rows
    }

    conn.close()

    students = []
    for s_row in student_rows:
        sid = s_row["student_id"]
        students.append({
            "student_id": sid,
            "active_pod": active_pods_by_student.get(sid),
            "milestones": milestones_by_student.get(sid, []),
            "pending_review_count": pending_counts_by_student.get(sid, 0),
        })

    return {"students": students}


@router.get("/instructor/students/{student_id}")
def instructor_get_student_progress(student_id: str, claims: dict = Depends(verify_token)):
    """Get active pod, historical milestone progress, and review cases for a specific student."""
    auth.require_role(["instructor", "admin"], claims)
    conn = get_db_connection()
    exists = conn.execute(
        "SELECT 1 FROM ("
        "  SELECT student_id FROM milestone_verification WHERE student_id = ? "
        "  UNION "
        "  SELECT student_id FROM pods WHERE student_id = ? "
        "  UNION "
        "  SELECT student_id FROM review_cases WHERE student_id = ? "
        ") LIMIT 1",
        (student_id, student_id, student_id),
    ).fetchone()

    if not exists:
        conn.close()
        raise HTTPException(status_code=404, detail="Student not found")

    active_pod_row = conn.execute(
        "SELECT * FROM pods WHERE student_id=? AND status NOT IN ('DESTROYED','FAILED_ROLLBACK_COMPLETE') "
        "ORDER BY pod_id DESC LIMIT 1",
        (student_id,),
    ).fetchone()
    active_pod = serialize_instructor_pod(active_pod_row) if active_pod_row else None

    # pod_id + detection_data let the review page show which lab an attempt
    # ran on and what corroborated it (Wazuh rule/agent, browser label,
    # hybrid flag agreement, instructor approval) -- evidence, not just PASS/FAIL.
    milestone_rows = conn.execute(
        "SELECT pod_id, scenario_id, milestone_id, status, detection_score, detection_data, verified_at "
        "FROM milestone_verification "
        "WHERE student_id = ? "
        "ORDER BY verified_at DESC",
        (student_id,),
    ).fetchall()

    review_rows = conn.execute(
        "SELECT * FROM review_cases WHERE student_id = ? ORDER BY created_at DESC",
        (student_id,),
    ).fetchall()
    conn.close()

    return {
        "student_id": student_id,
        "active_pod": active_pod,
        "milestones": [dict(m) for m in milestone_rows],
        "reviews": [dict(r) for r in review_rows],
    }


@router.get(
    "/instructor/export/knowledge-gain",
    responses={
        200: {
            "description": "Exported knowledge gain metrics in JSON or CSV format",
            "content": {
                "application/json": {"schema": {"$ref": "#/components/schemas/KnowledgeGainExportResponse"}},
                "text/csv": {"schema": {"type": "string"}},
            },
        },
        503: {
            "description": "Anonymized export requested but TELEMETRY_ANONYMIZATION_SALT is not configured",
        },
    },
)
def export_knowledge_gain(
    format: str = Query("json"),
    scenario_id: Optional[int] = Query(None, ge=1),
    status_filter: Optional[str] = Query(None),
    anonymize: bool = Query(True),
    claims: dict = Depends(verify_token),
):
    """Export Section D.5 / PAPER-16 knowledge-gain scoring records.

    Defaults to anonymized student IDs (requires TELEMETRY_ANONYMIZATION_SALT).
    Pass anonymize=false for cleartext instructor dumps. Instructor/Admin only.
    """
    auth.require_role(["instructor", "admin"], claims)

    fmt = (format or "json").strip().lower()
    if fmt not in ("json", "csv"):
        raise HTTPException(
            status_code=400,
            detail="Invalid format: must be 'json' or 'csv'",
        )

    clean_status = status_filter.strip().upper() if status_filter else None
    if clean_status and clean_status not in ("PASS", "FAIL", "ERROR", "UNKNOWN"):
        raise HTTPException(
            status_code=400,
            detail="Invalid status_filter: must be PASS, FAIL, ERROR, or UNKNOWN",
        )

    conn = get_db_connection()
    try:
        try:
            all_records = extract_knowledge_gain_records(
                conn,
                scenario_id=scenario_id,
                status_filter=None,
                anonymize=anonymize,
            )
        except TelemetrySaltConfigError:
            raise HTTPException(
                status_code=503,
                detail="TELEMETRY_ANONYMIZATION_SALT is not configured",
            )
    finally:
        conn.close()

    summary = compute_knowledge_gain_summary(all_records)
    if clean_status:
        records = [r for r in all_records if r.get("status") == clean_status]
    else:
        records = all_records

    if fmt == "csv":
        csv_text = format_records_csv(records)
        return Response(
            content=csv_text,
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": "attachment; filename=knowledge_gain_metrics.csv"},
        )

    return {
        "summary": summary,
        "records": records,
    }


class ReviewSubmitRequest(BaseModel):
    scenario_id: int
    milestone_id: Optional[int] = None
    case_type: Optional[str] = "WRITTEN_REPORT"
    report_text: Optional[str] = None
    conflict_reason: Optional[str] = None
    evidence_data: Optional[Union[str, dict, list]] = None


@router.post("/reviews/submit")
def submit_student_review(
    body: ReviewSubmitRequest,
    background_tasks: BackgroundTasks,
    claims: dict = Depends(verify_token),
):
    """Student endpoint to submit review cases (written reports, scoring conflicts, manual reviews)."""
    student_id = caller_identity(claims, None)
    if not student_id:
        raise HTTPException(status_code=401, detail="Identity required")

    c_type = (body.case_type or "WRITTEN_REPORT").upper().strip()
    # SCORING_CONFLICT is system-only (hybrid escalate); students cannot forge credit via submit.
    if c_type == "SCORING_CONFLICT":
        raise HTTPException(
            status_code=400,
            detail="SCORING_CONFLICT cases are created by the hybrid scoring system only",
        )
    valid_case_types = ("WRITTEN_REPORT", "MANUAL_REVIEW")
    if c_type not in valid_case_types:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid case_type: must be one of {valid_case_types}",
        )

    clean_report = body.report_text.strip() if (body.report_text and body.report_text.strip()) else None
    clean_conflict = body.conflict_reason.strip() if (body.conflict_reason and body.conflict_reason.strip()) else None

    if c_type == "WRITTEN_REPORT":
        if not clean_report:
            raise HTTPException(
                status_code=400, detail="report_text cannot be empty for WRITTEN_REPORT"
            )
    else:
        if not clean_report and not clean_conflict:
            raise HTTPException(
                status_code=400,
                detail="Either conflict_reason or report_text is required for this case type",
            )

    evidence_text = None
    if body.evidence_data is not None:
        if isinstance(body.evidence_data, (dict, list)):
            evidence_text = json.dumps(body.evidence_data)
        else:
            evidence_text = str(body.evidence_data)

    conn = get_db_connection()
    cursor = conn.execute(
        "INSERT INTO review_cases ("
        "  student_id, scenario_id, milestone_id, case_type, "
        "  report_text, conflict_reason, evidence_data, status"
        ") VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING')",
        (
            student_id,
            body.scenario_id,
            body.milestone_id,
            c_type,
            clean_report,
            clean_conflict,
            evidence_text,
        ),
    )
    review_id = cursor.lastrowid
    conn.commit()
    conn.close()

    # Freeze this lab's SIEM alerts alongside the report (runs after the
    # response; a Wazuh problem is recorded on the snapshot, never raised).
    background_tasks.add_task(lab_history.capture_review_snapshot, review_id)
    return {"status": "submitted", "review_id": review_id}


@router.get("/instructor/reviews")
def list_student_reviews(
    status_filter: Optional[str] = None, claims: dict = Depends(verify_token)
):
    """Instructor / Admin endpoint to list student review cases."""
    auth.require_role(["instructor", "admin"], claims)
    conn = get_db_connection()
    if status_filter:
        clean_filter = status_filter.strip().upper()
        if clean_filter not in {"PENDING", "APPROVED", "REJECTED", "RETRY", "ALL"}:
            conn.close()
            raise HTTPException(
                status_code=400,
                detail="Invalid status_filter: must be one of ('PENDING', 'APPROVED', 'REJECTED', 'RETRY', 'ALL')",
            )
        if clean_filter != "ALL":
            rows = conn.execute(
                "SELECT * FROM review_cases WHERE status=? ORDER BY created_at DESC",
                (clean_filter,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM review_cases ORDER BY created_at DESC"
            ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM review_cases ORDER BY created_at DESC"
        ).fetchall()
    conn.close()
    return {"reviews": [dict(r) for r in rows]}


@router.get("/instructor/reviews/{review_id}")
def get_student_review_detail(
    review_id: int, claims: dict = Depends(verify_token)
):
    """Instructor / Admin endpoint to view details of a specific review case."""
    auth.require_role(["instructor", "admin"], claims)
    conn = get_db_connection()
    row = conn.execute(
        "SELECT * FROM review_cases WHERE review_id=?", (review_id,)
    ).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Review case not found")
    return dict(row)


@router.post(
    "/instructor/reviews/{review_id}/resolve",
    response_model=ReviewResolveResponse,
)
def resolve_student_review(
    review_id: int,
    body: ReviewResolveRequest,
    claims: dict = Depends(verify_token),
):
    """Instructor / Admin endpoint to evaluate and resolve a student review case (Approve, Reject, or Retry)."""
    auth.require_role(["instructor", "admin"], claims)

    grader = caller_identity(claims, None)
    if not grader:
        raise HTTPException(status_code=401, detail="Identity required")

    clean_status = body.status.strip().upper() if body.status else ""
    if clean_status not in {"APPROVED", "REJECTED", "RETRY"}:
        raise HTTPException(
            status_code=400,
            detail="Invalid status: must be one of ('APPROVED', 'REJECTED', 'RETRY')",
        )

    # expected_status is CAS versioning: None = legacy first-resolve (PENDING/RETRY only).
    # Any provided value (including "") is treated as client-supplied and validated.
    expected_status = None
    if body.expected_status is not None:
        expected_status = body.expected_status.strip().upper()
        if expected_status not in {"PENDING", "APPROVED", "REJECTED", "RETRY"}:
            raise HTTPException(
                status_code=400,
                detail="Invalid expected_status: must be one of ('PENDING', 'APPROVED', 'REJECTED', 'RETRY')",
            )

    final_score = body.score
    if final_score is not None:
        if not isinstance(final_score, int) or final_score < 0 or final_score > 100:
            raise HTTPException(
                status_code=400,
                detail="score must be between 0 and 100",
            )
    else:
        if clean_status == "APPROVED":
            final_score = 100
        elif clean_status == "REJECTED":
            final_score = 0
        elif clean_status == "RETRY":
            final_score = None

    clean_feedback = (
        body.feedback.strip()
        if (body.feedback and body.feedback.strip())
        else None
    )
    if clean_feedback and len(clean_feedback) > 5000:
        raise HTTPException(
            status_code=400,
            detail="feedback exceeds maximum length of 5000 characters",
        )

    conn = get_db_connection()
    try:
        with conn:
            row = conn.execute(
                "SELECT student_id, scenario_id, milestone_id, case_type "
                "FROM review_cases WHERE review_id=?",
                (review_id,),
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Review case not found")

            student_id = row["student_id"]
            scenario_id = row["scenario_id"]
            milestone_id = row["milestone_id"]
            case_type = (
                row["case_type"]
                if "case_type" in row.keys() and row["case_type"]
                else "WRITTEN_REPORT"
            )
            # RETRY has no student-visible path for staff-only SCORING_CONFLICT cases.
            if case_type == "SCORING_CONFLICT" and clean_status == "RETRY":
                raise HTTPException(
                    status_code=400,
                    detail="RETRY is not allowed for SCORING_CONFLICT review cases",
                )
            if expected_status is not None:
                cur = conn.execute(
                    "UPDATE review_cases "
                    "SET status = ?, score = ?, feedback = ?, graded_by = ?, updated_at = CURRENT_TIMESTAMP "
                    "WHERE review_id = ? AND status = ?",
                    (clean_status, final_score, clean_feedback, grader, review_id, expected_status),
                )
            else:
                cur = conn.execute(
                    "UPDATE review_cases "
                    "SET status = ?, score = ?, feedback = ?, graded_by = ?, updated_at = CURRENT_TIMESTAMP "
                    "WHERE review_id = ? AND status IN ('PENDING', 'RETRY')",
                    (clean_status, final_score, clean_feedback, grader, review_id),
                )
            if cur.rowcount == 0:
                check_row = conn.execute(
                    "SELECT status FROM review_cases WHERE review_id = ?",
                    (review_id,),
                ).fetchone()
                if not check_row:
                    raise HTTPException(status_code=404, detail="Review case not found")
                raise HTTPException(
                    status_code=409,
                    detail=(
                        f"Review case status changed "
                        f"(expected {expected_status or 'PENDING/RETRY'}, "
                        f"current {check_row['status']})"
                    ),
                )

            # SCORE-SYNC FIX: An instructor APPROVE must give the student durable
            # credit so it flows into GET /progress (the single source the student
            # scenario page, dashboard, catalog and progress bars all read from).
            # Previously this PASS insert was gated to case_type=='SCORING_CONFLICT',
            # so approving a student-submitted WRITTEN_REPORT / MANUAL_REVIEW (the
            # "Ask an instructor to check" flow) updated review_cases but never wrote
            # the milestone_verification PASS row -> the score showed on the
            # instructor side and never reached the student. Now any APPROVED,
            # milestone-scoped case writes the PASS row (deduped, so an already-auto
            # -scored milestone is never double-counted).
            if clean_status == "APPROVED" and milestone_id is not None:
                s_id_str = str(scenario_id)
                s_id_pad = str(scenario_id).zfill(2)
                pod_row = conn.execute(
                    "SELECT pod_id FROM pods WHERE student_id=? AND (scenario_id=? OR scenario_id=?) ORDER BY id DESC LIMIT 1",
                    (student_id, s_id_str, s_id_pad),
                ).fetchone()
                target_pod_id = pod_row["pod_id"] if pod_row and pod_row["pod_id"] else 0
                exists = conn.execute(
                    "SELECT id FROM milestone_verification WHERE student_id=? AND scenario_id=? AND milestone_id=? AND status='PASS' LIMIT 1",
                    (student_id, scenario_id, milestone_id),
                ).fetchone()
                if not exists:
                    detection_data = (
                        "instructor_approved_conflict"
                        if case_type == "SCORING_CONFLICT"
                        else "instructor_approved_review"
                    )
                    conn.execute(
                        "INSERT INTO milestone_verification "
                        "(pod_id, student_id, scenario_id, milestone_id, status, detection_score, detection_data) "
                        "VALUES (?, ?, ?, ?, 'PASS', 0, ?)",
                        (target_pod_id, student_id, scenario_id, milestone_id, detection_data),
                    )
            # Reversing an instructor decision (APPROVED -> REJECTED/RETRY) must also
            # undo the PASS that the earlier APPROVE inserted; otherwise the student
            # keeps the points for a now-rejected case. Only remove instructor-granted
            # PASS rows -- never an auto-detected or pure-flag PASS the student earned
            # on their own.
            elif clean_status in ("REJECTED", "RETRY") and milestone_id is not None:
                conn.execute(
                    "DELETE FROM milestone_verification "
                    "WHERE student_id=? AND scenario_id=? AND milestone_id=? AND status='PASS' "
                    "AND detection_data IN ('instructor_approved_review', 'instructor_approved_conflict')",
                    (student_id, scenario_id, milestone_id),
                )
    finally:
        conn.close()

    # Log event on independent connection to prevent SQLite deadlock
    try:
        log_event(
            "REVIEW_CASE_RESOLVED",
            student_id=student_id,
            result=clean_status,
            detail=f"review_id={review_id}, score={final_score}, graded_by={grader}",
        )
    except Exception as exc:
        logger.warning(
            "Failed to record REVIEW_CASE_RESOLVED audit log for review_id=%s: %s",
            review_id,
            exc,
            exc_info=True,
        )

    return ReviewResolveResponse(
        status="resolved",
        review_id=review_id,
        decision=clean_status,
    )


@router.post(
    "/reviews/{review_id}/resubmit",
    response_model=ReviewResubmitResponse,
)
def resubmit_student_review(
    review_id: int,
    body: ReviewResubmitRequest,
    background_tasks: BackgroundTasks,
    claims: dict = Depends(verify_token),
):
    """Student endpoint to resubmit a review case that was returned for RETRY."""
    caller = caller_identity(claims, None)
    if not caller:
        raise HTTPException(status_code=401, detail="Identity required")

    clean_report = (
        body.report_text.strip()
        if (body.report_text and body.report_text.strip())
        else None
    )
    if clean_report and len(clean_report) > 10000:
        raise HTTPException(
            status_code=400,
            detail="report_text exceeds maximum length of 10000 characters",
        )

    clean_conflict = (
        body.conflict_reason.strip()
        if (body.conflict_reason and body.conflict_reason.strip())
        else None
    )
    if clean_conflict and len(clean_conflict) > 10000:
        raise HTTPException(
            status_code=400,
            detail="conflict_reason exceeds maximum length of 10000 characters",
        )

    evidence_text = None
    if body.evidence_data is not None:
        if isinstance(body.evidence_data, (dict, list)):
            evidence_text = json.dumps(body.evidence_data) if body.evidence_data else None
        elif isinstance(body.evidence_data, str):
            s = body.evidence_data.strip()
            if not s or s in ("{}", "[]"):
                evidence_text = None
            else:
                try:
                    parsed = json.loads(s)
                    evidence_text = None if isinstance(parsed, (dict, list)) and not parsed else s
                except Exception:
                    evidence_text = s

    if evidence_text is not None:
        try:
            raw_bytes = evidence_text.encode("utf-8")
        except UnicodeEncodeError:
            raise HTTPException(
                status_code=400,
                detail="evidence_data contains invalid Unicode characters",
            )
        if len(raw_bytes) > 65536:
            raise HTTPException(
                status_code=400,
                detail="evidence_data exceeds maximum length of 65536 bytes",
            )

    if clean_report is None and clean_conflict is None and evidence_text is None:
        raise HTTPException(
            status_code=400,
            detail="At least one updated field (report_text, conflict_reason, evidence_data) must be provided for resubmission",
        )

    conn = get_db_connection()
    try:
        with conn:
            row = conn.execute(
                "SELECT student_id, status FROM review_cases WHERE review_id=?",
                (review_id,),
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Review case not found")

            # Ownership check strictly PRECEDES status check to avoid status-oracle leaks
            if row["student_id"] != caller:
                raise HTTPException(status_code=404, detail="Review case not found")

            # SCORING_CONFLICT is staff-only; 404 before status branch (no 400 oracle)
            case_row = conn.execute(
                "SELECT case_type FROM review_cases WHERE review_id=?",
                (review_id,),
            ).fetchone()
            case_type = (
                case_row["case_type"]
                if case_row and "case_type" in case_row.keys()
                else "WRITTEN_REPORT"
            )
            if case_type == "SCORING_CONFLICT":
                raise HTTPException(status_code=404, detail="Review case not found")

            if row["status"] != "RETRY":
                raise HTTPException(
                    status_code=400,
                    detail="Only reviews in RETRY status can be resubmitted",
                )

            cur = conn.execute(
                "UPDATE review_cases "
                "SET status = 'PENDING', "
                "    report_text = COALESCE(?, report_text), "
                "    conflict_reason = COALESCE(?, conflict_reason), "
                "    evidence_data = COALESCE(?, evidence_data), "
                "    score = NULL, "
                "    feedback = NULL, "
                "    graded_by = NULL, "
                "    updated_at = CURRENT_TIMESTAMP "
                "WHERE review_id = ? AND student_id = ? AND status = 'RETRY'",
                (clean_report, clean_conflict, evidence_text, review_id, caller),
            )
            if cur.rowcount == 0:
                raise HTTPException(
                    status_code=409,
                    detail="Review case was modified concurrently or is no longer in RETRY status",
                )
    finally:
        conn.close()

    # Log event on independent connection
    try:
        log_event(
            "REVIEW_CASE_RESUBMITTED",
            student_id=caller,
            result="PENDING",
            detail=f"review_id={review_id}",
        )
    except Exception as exc:
        logger.warning(
            "Failed to record REVIEW_CASE_RESUBMITTED audit log for review_id=%s: %s",
            review_id,
            exc,
            exc_info=True,
        )

    # Re-snapshot: the resubmitted report may cover a newer lab.
    background_tasks.add_task(lab_history.capture_review_snapshot, review_id)
    return ReviewResubmitResponse(
        status="resubmitted",
        review_id=review_id,
    )


@router.get("/reviews/{review_id}")
def get_review_detail(
    review_id: int, claims: dict = Depends(verify_token)
):
    """Get review case details. Accessible by the owning student, or instructors and admins."""
    caller = caller_identity(claims, None)
    if not caller:
        raise HTTPException(status_code=401, detail="Identity required")

    roles = auth.extract_roles(claims)
    is_staff = any(r in roles for r in ("instructor", "admin"))

    conn = get_db_connection()
    try:
        row = conn.execute(
            "SELECT * FROM review_cases WHERE review_id=?", (review_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Review case not found")

        if not is_staff:
            if row["student_id"] != caller:
                raise HTTPException(status_code=404, detail="Review case not found")
            # SCORING_CONFLICT is never student-visible (any status)
            case_type = row["case_type"] if "case_type" in row.keys() else "WRITTEN_REPORT"
            if case_type == "SCORING_CONFLICT":
                raise HTTPException(status_code=404, detail="Review case not found")

        return dict(row)
    finally:
        conn.close()






# === Review evidence screenshots (student uploads; staff + owner can view) ===


def _review_row_for_access(conn, review_id: int, claims: dict, owner_only: bool):
    """Return the review_cases row if the caller may act on its images, else raise.

    Owner (the student who filed it) always may. Instructors/Admins may unless
    owner_only. A student who is not the owner gets 404 (no existence probing).
    """
    row = conn.execute(
        "SELECT review_id, student_id FROM review_cases WHERE review_id=?", (review_id,)
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Review case not found")
    caller = caller_identity(claims, None)
    if caller and caller == row["student_id"]:
        return row
    if not owner_only:
        try:
            auth.require_role(["instructor", "admin"], claims)
            return row
        except HTTPException:
            pass
    # Not owner and (owner_only or not staff): hide existence.
    raise HTTPException(status_code=404, detail="Review case not found")


def _serialize_image(r) -> dict:
    return {
        "id": r["id"],
        "review_id": r["review_id"],
        "original_name": r["original_name"],
        "content_type": r["content_type"],
        "byte_size": r["byte_size"],
        "width": r["width"],
        "height": r["height"],
        "caption": r["caption"],
        "created_at": r["created_at"],
    }


@router.post("/reviews/{review_id}/images")
async def upload_review_image(
    review_id: int,
    file: UploadFile = File(...),
    caption: Optional[str] = Form(None),
    claims: dict = Depends(verify_token),
):
    """Student attaches a screenshot to their own review case."""
    conn = get_db_connection()
    try:
        review = _review_row_for_access(conn, review_id, claims, owner_only=True)
        count = conn.execute(
            "SELECT COUNT(*) FROM review_evidence_images WHERE review_id=?", (review_id,)
        ).fetchone()[0]
        if count >= evidence_images.MAX_PER_REVIEW:
            raise HTTPException(
                status_code=400,
                detail=f"You can attach at most {evidence_images.MAX_PER_REVIEW} images to a report.",
            )
        raw = await file.read()
        try:
            saved = evidence_images.validate_and_store(raw)
        except evidence_images.ImageRejected as e:
            raise HTTPException(status_code=400, detail=str(e))
        except ImportError:
            raise HTTPException(status_code=503, detail="Image support is not configured on the server.")

        clean_caption = (caption or "").strip()[:300] or None
        orig = (file.filename or "").strip()[:200] or None
        cur = conn.execute(
            "INSERT INTO review_evidence_images "
            "(review_id, student_id, stored_name, original_name, content_type, byte_size, width, height, caption) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            (review_id, review["student_id"], saved.stored_name, orig, saved.content_type,
             saved.byte_size, saved.width, saved.height, clean_caption),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM review_evidence_images WHERE id=?", (cur.lastrowid,)
        ).fetchone()
        return _serialize_image(row)
    finally:
        conn.close()


@router.get("/reviews/{review_id}/images")
def list_review_images(review_id: int, claims: dict = Depends(verify_token)):
    """List image metadata for a review (owner or instructor/admin)."""
    conn = get_db_connection()
    try:
        _review_row_for_access(conn, review_id, claims, owner_only=False)
        rows = conn.execute(
            "SELECT * FROM review_evidence_images WHERE review_id=? ORDER BY created_at, id",
            (review_id,),
        ).fetchall()
        return {"review_id": review_id, "images": [_serialize_image(r) for r in rows]}
    finally:
        conn.close()


@router.get("/reviews/{review_id}/images/{image_id}")
def get_review_image(review_id: int, image_id: int, claims: dict = Depends(verify_token)):
    """Serve one image's bytes (owner or instructor/admin)."""
    conn = get_db_connection()
    try:
        _review_row_for_access(conn, review_id, claims, owner_only=False)
        row = conn.execute(
            "SELECT * FROM review_evidence_images WHERE id=? AND review_id=?",
            (image_id, review_id),
        ).fetchone()
    finally:
        conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Image not found")
    data = evidence_images.read_file(row["stored_name"])
    if data is None:
        raise HTTPException(status_code=404, detail="Image file missing")
    return Response(
        content=data,
        media_type=row["content_type"],
        headers={
            "Content-Disposition": "inline",
            "Cache-Control": "private, max-age=3600",
            # Defence in depth: never let a served upload be interpreted as a page.
            "Content-Security-Policy": "default-src 'none'; sandbox",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.delete("/reviews/{review_id}/images/{image_id}")
def delete_review_image(review_id: int, image_id: int, claims: dict = Depends(verify_token)):
    """Owner removes one of their own attached images."""
    conn = get_db_connection()
    try:
        _review_row_for_access(conn, review_id, claims, owner_only=True)
        row = conn.execute(
            "SELECT stored_name FROM review_evidence_images WHERE id=? AND review_id=?",
            (image_id, review_id),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Image not found")
        conn.execute("DELETE FROM review_evidence_images WHERE id=?", (image_id,))
        conn.commit()
    finally:
        conn.close()
    evidence_images.delete_file(row["stored_name"])
    return {"status": "deleted", "image_id": image_id}
