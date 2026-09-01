"""GET /pods/{pod_id}/alerts — Scenario 9 SIEM viewer (provision API).

M4 pods_router.py hook (include router; do not wholesale-replace pods_router):

    from fastapi import FastAPI
    import alerts_endpoint as ae
    from auth import verify_token as real_vt, require_owner as real_ro
    from db import get_db_connection as real_db

    app = FastAPI()
    app.include_router(ae.alerts_router)
    # Real auth uses Header/Depends — override the *dep*, not ae.verify_token alone.
    # Depends() freezes the callable at import; ae.verify_token = real_vt does NOT
    # rebind FastAPI. Use dependency_overrides on verify_token_dep:
    app.dependency_overrides[ae.verify_token_dep] = real_vt
    # Module attrs (looked up at request time) still work for non-Depends deps:
    ae.require_owner = real_ro
    ae.get_db_connection = real_db
"""
from __future__ import annotations

import json
import os
import re
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse

from alerts_reader import ManagerUnavailable, list_siem_alerts

alerts_router = APIRouter()

POD_TTL_HOURS = int(os.getenv("POD_TTL_HOURS", "8"))
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


def get_db_connection():
    """Stub; production replaces with db.get_db_connection."""
    raise RuntimeError("get_db_connection not configured")


@alerts_router.get("/pods/{pod_id}/alerts")
def get_pod_alerts(
    pod_id: int,
    limit: int = 50,
    since_minutes: int = 240,
    rule_id: Optional[str] = None,
    claims: dict = Depends(verify_token_dep),
):
    conn = get_db_connection()
    try:
        pod = conn.execute(
            "SELECT * FROM pods WHERE pod_id=?", (pod_id,)
        ).fetchone()
    finally:
        conn.close()

    if not pod:
        raise HTTPException(status_code=404, detail="Pod not found")
    require_owner(pod, claims)
    if pod["status"] != "ACTIVE":
        raise HTTPException(
            status_code=409, detail=f"Pod is {pod['status']}, not ACTIVE"
        )

    limit = max(1, min(int(limit), 200))
    max_win = max(1, POD_TTL_HOURS * 60)
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
