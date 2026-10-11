"""Authenticated self-service onboarding state."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status

from auth import require_app_role
from db import get_db_connection

router = APIRouter()


def _subject(claims: dict) -> str:
    subject = claims.get("sub")
    if not isinstance(subject, str) or not subject.strip():
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authenticated subject missing")
    return subject


@router.get("/users/me/orientation")
def get_orientation(claims: dict = Depends(require_app_role)):
    subject = _subject(claims)
    conn = get_db_connection()
    try:
        row = conn.execute(
            "SELECT orientation_completed_at FROM user_onboarding WHERE subject = ?",
            (subject,),
        ).fetchone()
    finally:
        conn.close()
    return {"completed": bool(row and row["orientation_completed_at"])}


@router.post("/users/me/orientation", status_code=status.HTTP_200_OK)
def complete_orientation(claims: dict = Depends(require_app_role)):
    subject = _subject(claims)
    completed_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    conn = get_db_connection()
    try:
        with conn:
            conn.execute(
                """
                INSERT INTO user_onboarding (subject, orientation_completed_at)
                VALUES (?, ?)
                ON CONFLICT(subject) DO UPDATE SET orientation_completed_at = excluded.orientation_completed_at
                """,
                (subject, completed_at),
            )
    finally:
        conn.close()
    return {"completed": True}
