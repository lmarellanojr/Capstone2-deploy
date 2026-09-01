"""In-memory Keycloak introspection cache (API + bridge)."""
from __future__ import annotations

import hashlib
import logging
import threading
import time

logger = logging.getLogger("provision_api")

_MAX_TTL_SECONDS = 60.0
_lock = threading.Lock()
_entries: dict[str, tuple[dict, float]] = {}


def _token_key(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _ttl_seconds(claims: dict) -> float:
    exp = claims.get("exp")
    if exp is not None:
        try:
            remaining = float(exp) - time.time()
        except (TypeError, ValueError):
            remaining = _MAX_TTL_SECONDS
        return min(max(remaining, 0.0), _MAX_TTL_SECONDS)
    return _MAX_TTL_SECONDS


def get_cached(token: str) -> dict | None:
    key = _token_key(token)
    now = time.time()
    with _lock:
        entry = _entries.get(key)
        if not entry:
            logger.debug("introspect cache miss")
            return None
        claims, expires_at = entry
        if now >= expires_at:
            del _entries[key]
            logger.debug("introspect cache expired")
            return None
        logger.debug("introspect cache hit")
        return dict(claims)


def store(token: str, claims: dict) -> None:
    if not claims.get("active"):
        return
    ttl = _ttl_seconds(claims)
    if ttl <= 0:
        return
    key = _token_key(token)
    expires_at = time.time() + ttl
    with _lock:
        _entries[key] = (dict(claims), expires_at)


def reset_for_tests() -> None:
    with _lock:
        _entries.clear()