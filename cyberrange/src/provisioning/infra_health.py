"""Presentation-safe API + LXD health for Admin (Issue #37)."""
from __future__ import annotations

from typing import Optional

HEALTHY = "Healthy"
DEGRADED = "Degraded"
UNAVAILABLE = "Unavailable"

LXD_PROBE_TIMEOUT_S = 2.0


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
