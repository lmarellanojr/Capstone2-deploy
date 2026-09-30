"""Admin read access to audit_log (previously only reachable via SQLite on the host).

Read-only by design: there is no route that edits or deletes audit rows. Rows
never contain passwords or tokens (every writer -- users_router._audit,
pods_router._audit_force_destroy, db.log_event callers -- keeps secrets out of
`detail`), so returning them to an Admin exposes nothing beyond who did what.
"""
from typing import Optional

from fastapi import APIRouter, Depends, Query

import auth
from auth import verify_token
from db import get_db_connection

router = APIRouter()

MAX_LIMIT = 500


@router.get("/admin/audit-log")
def admin_list_audit_log(
    event_type: Optional[str] = Query(None, max_length=64),
    student_id: Optional[str] = Query(None, max_length=64),
    result: Optional[str] = Query(None, max_length=16),
    before_id: Optional[int] = Query(None, ge=1),
    limit: int = Query(100, ge=1, le=MAX_LIMIT),
    claims: dict = Depends(verify_token),
):
    """Newest-first audit events, filterable, paged by id.

    Page through with `before_id` = the previous page's `next_before_id`
    (keyset paging: stable while new events keep arriving, unlike OFFSET).
    """
    auth.require_role(["admin"], claims)

    where: list[str] = []
    params: list[object] = []
    if event_type:
        where.append("event_type = ?")
        params.append(event_type.strip())
    if student_id:
        where.append("student_id = ?")
        params.append(student_id.strip())
    if result:
        where.append("result = ?")
        params.append(result.strip().upper())
    if before_id:
        where.append("id < ?")
        params.append(before_id)
    clause = f" WHERE {' AND '.join(where)}" if where else ""

    conn = get_db_connection()
    try:
        # One extra row tells us whether another page exists without a COUNT.
        rows = conn.execute(
            "SELECT id, event_type, student_id, pod_id, vmid, result, detail, timestamp "
            f"FROM audit_log{clause} ORDER BY id DESC LIMIT ?",
            (*params, limit + 1),
        ).fetchall()
        event_types = [
            r["event_type"]
            for r in conn.execute("SELECT DISTINCT event_type FROM audit_log ORDER BY event_type").fetchall()
        ]
    finally:
        conn.close()

    page = [dict(r) for r in rows[:limit]]
    return {
        "events": page,
        "next_before_id": page[-1]["id"] if len(rows) > limit and page else None,
        "event_types": event_types,
    }
