"""Presentation-safe API + LXD health for Admin (Issue #37)."""
from __future__ import annotations

import threading
from concurrent.futures import Future, ThreadPoolExecutor, TimeoutError as FuturesTimeout
from typing import Optional, Tuple

from fastapi import APIRouter, Depends

from auth import require_role, verify_token
from capacity import available_ram_mb, build_capacity_payload, count_active_pods
from config import MAX_PODS, POD_STORAGE_MB, PROFILE_NAME
from db import get_db_connection

HEALTHY = "Healthy"
DEGRADED = "Degraded"
UNAVAILABLE = "Unavailable"

LXD_PROBE_TIMEOUT_S = 2.0

# One shared worker for LXD probes. Concurrent callers wait on the same
# in-flight future (each with its own timeout) instead of stacking workers
# or returning a fake immediate timeout (#55 will reuse this pattern).
_lxd_pool = ThreadPoolExecutor(max_workers=1)
_lxd_lock = threading.Lock()
_lxd_inflight: Optional[Future] = None

router = APIRouter()


def classify_api(*, db_ok: bool, available_mb: Optional[int]) -> dict:
    if not db_ok:
        return {
            "name": "API",
            "status": UNAVAILABLE,
            "detail": "pod database query failed",
        }
    if available_mb is None:
        return {
            "name": "API",
            "status": DEGRADED,
            "detail": "host meminfo unreadable",
        }
    return {
        "name": "API",
        "status": HEALTHY,
        "detail": "provisioning API responding",
    }


def classify_lxd(
    *, free_mb: Optional[float], timed_out: bool, pod_storage_mb: int
) -> dict:
    if timed_out:
        return {
            "name": "LXD",
            "status": UNAVAILABLE,
            "detail": "LXD probe timed out",
        }
    if free_mb is None:
        return {
            "name": "LXD",
            "status": UNAVAILABLE,
            "detail": "LXD storage check failed",
        }
    free_i = int(free_mb)
    if free_i < pod_storage_mb:
        return {
            "name": "LXD",
            "status": DEGRADED,
            "detail": f"{free_i} MiB free (below {pod_storage_mb} MiB pod storage)",
        }
    return {
        "name": "LXD",
        "status": HEALTHY,
        "detail": f"{free_i} MiB free",
    }


def probe_lxd_free_mb(timeout_s: float = LXD_PROBE_TIMEOUT_S) -> Tuple[Optional[float], bool]:
    """Return (free_mb, timed_out). Never raise into the request handler.

    Cap LXD work at one in-flight future on the module pool. Concurrent
    callers wait on that same future (each with its own timeout) instead of
    returning timed-out immediately. A truly hung job still times out after
    timeout_s for every waiter.
    """
    global _lxd_inflight
    from provision import get_lxd_free_mb

    with _lxd_lock:
        if _lxd_inflight is not None and not _lxd_inflight.done():
            fut = _lxd_inflight
        else:
            fut = _lxd_pool.submit(get_lxd_free_mb)
            _lxd_inflight = fut

    try:
        return fut.result(timeout=timeout_s), False
    except FuturesTimeout:
        return None, True
    except Exception:
        return None, False


def _read_active_pods() -> Tuple[bool, Optional[int]]:
    try:
        conn = get_db_connection()
        try:
            active = count_active_pods(conn)
        finally:
            conn.close()
        return True, int(active)
    except Exception:
        return False, None


@router.get("/admin/infra-health")
def admin_infra_health(claims: dict = Depends(verify_token)):
    require_role(["admin"], claims)

    # Host I/O first, then a short COUNT. Do not hold a SQLite lock across LXD.
    avail = available_ram_mb()
    free_mb, timed_out = probe_lxd_free_mb()
    db_ok, active = _read_active_pods()

    capacity = None
    if db_ok and active is not None:
        capacity = build_capacity_payload(active, avail, MAX_PODS, PROFILE_NAME)

    return {
        "capacity": capacity,
        "services": [
            classify_api(db_ok=db_ok, available_mb=avail if db_ok else None),
            classify_lxd(
                free_mb=free_mb,
                timed_out=timed_out,
                pod_storage_mb=POD_STORAGE_MB,
            ),
        ],
    }
