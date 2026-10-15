"""Admin read access to audit_log (previously only reachable via SQLite on the host).

Read-only by design: there is no route that edits or deletes audit rows. Rows
never contain passwords or tokens (every writer -- users_router._audit,
pods_router._audit_force_destroy, db.log_event callers -- keeps secrets out of
`detail`), so returning them to an Admin exposes nothing beyond who did what.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

import auth
from auth import verify_token
from db import get_db_connection

router = APIRouter()

MAX_LIMIT = 500
MAX_EVENT_TYPES = 64

# The Result filter matches every row whose badge reads OK / Failed, which is
# more than `result = ?`: scoring writes PASS / FAIL / ERROR, and provisioning
# writers record the outcome only in the event name (PROVISION_FAILED,
# DVWA_READY_OK, ...) with `result` NULL. Keep in step with
# RESULT_FILTER_GROUPS / auditResult in portal/src/lib/auditEvents.ts.
_RESULT_GROUPS = {
    "OK": ("OK", "PASS"),
    "FAILED": ("FAILED", "FAIL", "ERROR"),
}
_NAME_SUFFIXES = {
    "OK": ("_OK", "_SUCCESS"),
    "FAILED": ("_FAIL", "_FAILED"),
}


def _like_suffix(suffix: str) -> str:
    return "%" + suffix.replace("_", "\\_")


@router.get("/admin/audit-log")
def admin_list_audit_log(
    event_type: Optional[str] = Query(None, max_length=64),
    event_types: Optional[str] = Query(None, max_length=4096),
    student_id: Optional[str] = Query(None, max_length=64),
    result: Optional[str] = Query(None, max_length=16),
    before_id: Optional[int] = Query(None, ge=1),
    limit: int = Query(100, ge=1, le=MAX_LIMIT),
    claims: dict = Depends(verify_token),
):
    """Newest-first audit events, filterable, paged by id.

    Page through with `before_id` = the previous page's `next_before_id`
    (keyset paging: stable while new events keep arriving, unlike OFFSET).
    `event_types` is a comma-separated set (the portal's category tabs).
    """
    auth.require_role(["admin"], claims)

    where: list[str] = []
    params: list[object] = []
    if event_type:
        where.append("event_type = ?")
        params.append(event_type.strip())
    if event_types:
        types = sorted({t.strip() for t in event_types.split(",") if t.strip()})
        if len(types) > MAX_EVENT_TYPES:
            raise HTTPException(status_code=422, detail=f"At most {MAX_EVENT_TYPES} event types")
        if types:
            where.append(f"event_type IN ({','.join('?' * len(types))})")
            params.extend(types)
    if student_id:
        where.append("student_id = ?")
        params.append(student_id.strip())
    if result:
        wanted = result.strip().upper()
        if wanted in _RESULT_GROUPS:
            values = _RESULT_GROUPS[wanted]
            suffixes = _NAME_SUFFIXES[wanted]
            by_name = " OR ".join("event_type LIKE ? ESCAPE '\\'" for _ in suffixes)
            where.append(f"(result IN ({','.join('?' * len(values))}) OR (result IS NULL AND ({by_name})))")
            params.extend([*values, *(_like_suffix(s) for s in suffixes)])
        else:
            where.append("result = ?")
            params.append(wanted)
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
