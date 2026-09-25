"""Pod lab TTL. Deadline = created_at (SQLite UTC) + POD_TTL_HOURS.

Changing POD_TTL_HOURS on API restart retimes in-flight labs. No expires_at column.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from config import POD_TTL_HOURS

logger = logging.getLogger("provision_api")
_SQLITE_NAIVE = "%Y-%m-%d %H:%M:%S"


def parse_created_at_utc(created_at: str) -> datetime:
    text = created_at.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    if "T" in text:
        dt = datetime.fromisoformat(text)
    else:
        dt = datetime.strptime(text[:19], _SQLITE_NAIVE)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _try_parse(created_at: Optional[str]) -> Optional[datetime]:
    if not created_at or not str(created_at).strip():
        return None
    try:
        return parse_created_at_utc(str(created_at))
    except (TypeError, ValueError, OSError):
        logger.warning("ttl: unparseable created_at %r", created_at)
        return None


def created_at_utc(created_at: Optional[str]) -> Optional[datetime]:
    """Parsed pods.created_at (UTC), or None when missing or unparseable."""
    return _try_parse(created_at)


def minutes_since_created(
    created_at: Optional[str],
    cap_minutes: int,
    now: Optional[datetime] = None,
) -> int:
    """SIEM look-back for one pod: whole minutes since created_at, capped.

    Rounds up so an alert raised in the pod's first seconds is never cut off.
    Falls back to cap_minutes when created_at is missing or unparseable.
    """
    created = _try_parse(created_at)
    if created is None:
        return cap_minutes
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    elapsed = (now - created).total_seconds()
    return max(1, min(cap_minutes, -(-int(elapsed) // 60)))


def ttl_seconds_remaining(
    created_at: Optional[str],
    now: Optional[datetime] = None,
    ttl_hours: Optional[int] = None,
) -> int:
    created = _try_parse(created_at)
    if created is None:
        return 0
    hours = POD_TTL_HOURS if ttl_hours is None else ttl_hours
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    expires = created + timedelta(hours=hours)
    return max(0, int((expires - now).total_seconds()))


def is_ttl_expired(
    created_at: Optional[str],
    now: Optional[datetime] = None,
    ttl_hours: Optional[int] = None,
) -> bool:
    if _try_parse(created_at) is None:
        return False
    return ttl_seconds_remaining(created_at, now, ttl_hours) <= 0


def ttl_payload(
    created_at: Optional[str],
    now: Optional[datetime] = None,
    ttl_hours: Optional[int] = None,
) -> dict:
    hours = POD_TTL_HOURS if ttl_hours is None else ttl_hours
    created = _try_parse(created_at)
    remaining = ttl_seconds_remaining(created_at, now, hours)
    expires_at = None
    if created is not None:
        expires_at = (created + timedelta(hours=hours)).strftime("%Y-%m-%dT%H:%M:%SZ")
    return {
        "ttl_hours": hours,
        "remaining_seconds": remaining,
        "expires_at": expires_at,
        "ttl_expired": is_ttl_expired(created_at, now, hours),
    }
