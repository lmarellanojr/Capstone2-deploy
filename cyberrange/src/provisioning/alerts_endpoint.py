"""GET /pods/{pod_id}/alerts — Scenario 9 SIEM viewer (provision API).

M4 pods_router.py hook (include router; do not wholesale-replace pods_router):

    from fastapi import FastAPI
    import alerts_endpoint as ae
    from auth import verify_token as real_vt, require_owner as real_ro, require_role as real_rr
    from db import get_db_connection as real_db

    app = FastAPI()
    app.include_router(ae.alerts_router)
    # Real auth uses Header/Depends — override the *dep*, not ae.verify_token alone.
    # Depends() freezes the callable at import; ae.verify_token = real_vt does NOT
    # rebind FastAPI. Use dependency_overrides on verify_token_dep:
    app.dependency_overrides[ae.verify_token_dep] = real_vt
    # Module attrs (looked up at request time) still work for non-Depends deps:
    ae.require_owner = real_ro
    ae.require_staff = lambda c: real_rr(["instructor", "admin"], c)
    ae.get_db_connection = real_db
"""
from __future__ import annotations

import json
import re
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse

from alerts_reader import ManagerUnavailable, list_siem_alerts
import lab_history
from ttl import created_at_utc, siem_window_minutes

alerts_router = APIRouter()

# Newest-window flood after a full LXD pool. Still returned if rule_id=1007.
DISK_FULL_RULE_ID = "1007"


def verify_token() -> dict:
    """Stub claims; replace module global for simple callables, or override verify_token_dep."""
    return {}


def verify_token_dep() -> dict:
    """Indirection so Depends re-resolves the module-global verify_token each request.

    Assigning ae.verify_token = fn works for zero-arg callables.
    Host auth that needs Header/HTTPBearer must use:
        app.dependency_overrides[ae.verify_token_dep] = real_verify_token
    """
    return verify_token()


def require_owner(pod_row: Any, claims: dict) -> None:
    """404 (not 403) when caller is not the pod owner — matches auth.require_owner."""
    owner = pod_row["student_id"]
    caller = claims.get("preferred_username") or claims.get("sub")
    if caller != owner:
        raise HTTPException(status_code=404, detail="Pod not found")


def _pod_field(pod: Any, key: str):
    """Row or dict field; None if the row lacks it (older stubs)."""
    try:
        return pod[key]
    except (KeyError, IndexError):
        return None


def _pod_created_at(pod: Any):
    """pods.created_at as UTC datetime; None if the row lacks it (older stubs)."""
    return created_at_utc(_pod_field(pod, "created_at"))


def get_db_connection():
    """Stub; production replaces with db.get_db_connection."""
    raise RuntimeError("get_db_connection not configured")


def _deny_staff(claims: dict) -> None:
    """Fail-closed default for require_staff: refuse everyone until wired."""
    raise HTTPException(status_code=403, detail="Forbidden: Insufficient privileges")


# Instructor/Admin gate for the read-only instructor alerts view. Production
# replaces it with ``lambda c: auth.require_role(["instructor", "admin"], c)``.
require_staff = _deny_staff


def _load_pod(pod_id: int):
    conn = get_db_connection()
    try:
        return conn.execute(
            "SELECT * FROM pods WHERE pod_id=?", (pod_id,)
        ).fetchone()
    finally:
        conn.close()


def _alerts_for_pod(pod: Any, pod_id: int, limit, since_minutes, rule_id):
    """Shared by the student and instructor routes, so both return the same
    allowlisted fields, window bounds, and pod-lifetime cutoff (SIEM-SCOPE)."""
    if pod["status"] != "ACTIVE":
        raise HTTPException(
            status_code=409, detail=f"Pod is {pod['status']}, not ACTIVE"
        )

    limit = max(1, min(int(limit), 200))
    max_win = siem_window_minutes(_pod_field(pod, "scenario_id"))
    since_minutes = max(1, min(int(since_minutes), max_win))
    if rule_id and not re.fullmatch(r"[A-Za-z0-9]+", rule_id):
        raise HTTPException(status_code=422, detail="invalid rule_id")

    student = str(pod["student_id"] or "")
    agent_ids: list[str] = []
    agent_names = [f"pod-{student}-meta", f"pod-{student}-dvwa"] if student else []
    raw_ids = pod["wazuh_agent_id"]
    if raw_ids and str(raw_ids).startswith("{"):
        try:
            id_map = json.loads(raw_ids)
            agent_ids = [str(v) for v in id_map.values() if v]
            if student and id_map:
                agent_names = [f"pod-{student}-{role}" for role in id_map]
        except (TypeError, ValueError):
            agent_ids = []

    if not agent_ids and not agent_names:
        return {
            "pod_id": pod_id,
            "alerts": [],
            "total_count": 0,
            "query_window_minutes": since_minutes,
        }

    try:
        exclude = None if rule_id == DISK_FULL_RULE_ID else [DISK_FULL_RULE_ID]
        page = list_siem_alerts(
            agent_ids,
            agent_names=agent_names,
            since_minutes=since_minutes,
            rule_id=rule_id,
            exclude_rule_ids=exclude,
            limit=limit,
            # Only this pod's lifetime: a re-provisioned pod reuses the
            # pod-<student>-<role> agent names, so the name match alone would
            # show the previous pod's alerts.
            not_before=_pod_created_at(pod),
        )
    except ManagerUnavailable:
        return JSONResponse(
            status_code=503,
            content={
                "error": "manager_unavailable",
                "pod_id": pod_id,
                "alerts": [],
                "total_count": 0,
                "query_window_minutes": since_minutes,
            },
        )

    return {
        "pod_id": pod_id,
        "alerts": page.alerts,
        "total_count": page.total_count,
        "query_window_minutes": since_minutes,
    }


@alerts_router.get("/pods/{pod_id}/alerts")
def get_pod_alerts(
    pod_id: int,
    limit: int = 50,
    since_minutes: int = 240,
    rule_id: Optional[str] = None,
    claims: dict = Depends(verify_token_dep),
):
    pod = _load_pod(pod_id)
    if not pod:
        raise HTTPException(status_code=404, detail="Pod not found")
    require_owner(pod, claims)
    return _alerts_for_pod(pod, pod_id, limit, since_minutes, rule_id)


@alerts_router.get("/instructor/pods/{pod_id}/alerts")
def get_instructor_pod_alerts(
    pod_id: int,
    limit: int = 50,
    since_minutes: int = 240,
    rule_id: Optional[str] = None,
    claims: dict = Depends(verify_token_dep),
):
    """Read-only view of any student's pod alerts for Instructors/Admins.

    Role is checked before the pod lookup so a Student can't probe which
    pod ids exist (403, never 404/409).
    """
    require_staff(claims)
    pod = _load_pod(pod_id)
    if not pod:
        raise HTTPException(status_code=404, detail="Pod not found")
    return _alerts_for_pod(pod, pod_id, limit, since_minutes, rule_id)


# ── Instructor SIEM history (labs that have ended) ───────────────────────────


@alerts_router.get("/instructor/students/{student_id}/labs")
def get_student_labs(student_id: str, claims: dict = Depends(verify_token_dep)):
    """Every lab this student has run, newest first, with the window used to
    scope its archived alerts. Pre-v8 labs carry end_estimated=True."""
    require_staff(claims)
    conn = get_db_connection()
    try:
        return {"student_id": student_id, "labs": lab_history.list_labs(conn, student_id)}
    finally:
        conn.close()


@alerts_router.get("/instructor/students/{student_id}/labs/{pod_id}/alerts")
def get_student_lab_alerts(
    student_id: str,
    pod_id: int,
    started_at: str,
    limit: int = lab_history.HISTORY_LIMIT,
    claims: dict = Depends(verify_token_dep),
):
    """Archived alerts for one of the student's labs. The window is looked up
    server-side from (pod_id, started_at) -- a caller can't pass an arbitrary
    time range or another student's agents."""
    require_staff(claims)
    conn = get_db_connection()
    try:
        lab = lab_history.find_lab(conn, student_id, pod_id, started_at)
    finally:
        conn.close()
    if lab is None:
        raise HTTPException(status_code=404, detail="Lab not found for this student")
    try:
        page = lab_history.lab_alerts(student_id, lab, limit=limit)
    except ManagerUnavailable:
        return JSONResponse(
            status_code=503,
            content={"error": "manager_unavailable", "lab": lab, "alerts": [], "total_count": 0},
        )
    return {"lab": lab, "alerts": page.alerts, "total_count": page.total_count, "truncated": page.truncated}


@alerts_router.get("/instructor/reviews/{review_id}/alert-snapshot")
def get_review_alert_snapshot(review_id: int, claims: dict = Depends(verify_token_dep)):
    """The alerts frozen when the student submitted this report (latest
    submission). snapshot is null for reports filed before snapshots existed."""
    require_staff(claims)
    conn = get_db_connection()
    try:
        return {"snapshot": lab_history.latest_snapshot(conn, review_id)}
    finally:
        conn.close()
