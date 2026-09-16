"""Pod provisioning and lifecycle API routes."""
import json
import sqlite3
from typing import Optional, Union
from pydantic import BaseModel

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status

import auth
from auth import caller_identity, require_owner, verify_token
from capacity import available_ram_mb, can_provision_ram, ram_required_mb
from config import MAX_PODS, POD_STORAGE_MB, STORAGE_LIMIT_MB
from db import get_db_connection, log_event
from models import PodResponse, ProvisionRequest, VerificationResponse
from provision import get_lxd_free_mb, perform_destruction, perform_provisioning, vmids_for_pod
from scoring import verify_milestone
from ttl import ttl_payload

router = APIRouter()


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
    body.update(ttl_payload(body.get("created_at")))
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

        active_pods = conn.execute(
            "SELECT COUNT(*) FROM pods WHERE status NOT IN ('DESTROYED', 'FAILED_ROLLBACK_COMPLETE')"
        ).fetchone()[0]
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
    student_id = caller_identity(claims, student_id)
    # With AUTH_ENABLED=true, caller_identity ignores the query fallback and
    # returns only claims["preferred_username"]. A token that introspects as
    # active but omits that claim (service account, misconfigured mapper,
    # empty string) must not silently fall through to the unfiltered branch
    # below and enumerate every student's pods (branch-review Issue 1). The
    # unfiltered branch stays reachable only in AUTH_ENABLED=false bootstrap
    # mode, where it is the existing documented admin-list behaviour.
    if auth.AUTH_ENABLED and not student_id:
        raise HTTPException(status_code=401, detail="Identity required")
    conn = get_db_connection()
    base = "SELECT * FROM pods WHERE status NOT IN ('DESTROYED','FAILED_ROLLBACK_COMPLETE')"
    if student_id:
        rows = conn.execute(base + " AND student_id=? ORDER BY pod_id", (student_id,)).fetchall()
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

    require_owner(pod, claims)

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

    conn.close()
    return await verify_milestone(dict(pod), scenario_id, milestone_id, **deps)


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
    conn.close()

    log_event(
        "SCENARIO_PROGRESS_RESET",
        student_id=student_id,
        detail=f"scenario_id={scenario_id}, {deleted} milestone row(s) deleted",
    )

    return {"student_id": student_id, "scenario_id": scenario_id, "deleted": deleted}


@router.get("/pods/{pod_id}/milestones")
def get_pod_milestones(pod_id: int, claims: dict = Depends(verify_token)):
    conn = get_db_connection()
    pod = conn.execute("SELECT * FROM pods WHERE pod_id=?", (pod_id,)).fetchone()
    if not pod:
        conn.close()
        raise HTTPException(status_code=404, detail="Pod not found")

    require_owner(pod, claims)
    conn.close()

    return {
        "pod_id": pod_id,
        "student_id": pod["student_id"],
        "milestones": list_milestones_for_pod(dict(pod)),
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

    milestone_rows = conn.execute(
        "SELECT scenario_id, milestone_id, status, detection_score, verified_at "
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


class ReviewSubmitRequest(BaseModel):
    scenario_id: int
    milestone_id: Optional[int] = None
    case_type: Optional[str] = "WRITTEN_REPORT"
    report_text: Optional[str] = None
    conflict_reason: Optional[str] = None
    evidence_data: Optional[Union[str, dict, list]] = None


@router.post("/reviews/submit")
def submit_student_review(
    body: ReviewSubmitRequest, claims: dict = Depends(verify_token)
):
    """Student endpoint to submit review cases (written reports, scoring conflicts, manual reviews)."""
    student_id = caller_identity(claims, None)
    if not student_id:
        raise HTTPException(status_code=401, detail="Identity required")

    c_type = (body.case_type or "WRITTEN_REPORT").upper().strip()
    valid_case_types = ("WRITTEN_REPORT", "SCORING_CONFLICT", "MANUAL_REVIEW")
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

    return {"status": "submitted", "review_id": review_id}


@router.get("/instructor/reviews")
def list_student_reviews(
    status_filter: Optional[str] = None, claims: dict = Depends(verify_token)
):
    """Instructor / Admin endpoint to list student review cases."""
    auth.require_role(["instructor", "admin"], claims)
    conn = get_db_connection()
    if status_filter:
        rows = conn.execute(
            "SELECT * FROM review_cases WHERE status=? ORDER BY created_at DESC",
            (status_filter.upper(),),
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



