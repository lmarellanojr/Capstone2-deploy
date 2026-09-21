"""Host RAM capacity helpers for pod provisioning (P1 T-010)."""
from __future__ import annotations

import os
from typing import Optional

from profiles import active_profile

_PROFILE = active_profile()

# Profile supplies the default; the environment still wins. On oci_12gib this
# is what stops a .env that omits RAM_BUFFER_MB from silently inheriting the
# on-prem 2048 on a host that cannot spare it.
POD_RAM_MB = int(os.getenv("POD_RAM_MB", str(_PROFILE.pod_ram_mb)))
RAM_BUFFER_MB = int(os.getenv("RAM_BUFFER_MB", str(_PROFILE.ram_buffer_mb)))

# Hosts at or below this MemTotal cannot honour a multi-pod cap: the admission
# check is point-in-time with no reservation, so MAX_PODS=1 is the interlock.
# 13 GiB, chosen to sit just above the 12 GiB OCI Always Free shape.
#
# Deliberately NOT env-tunable. This guard exists to catch a missing or
# wrong-template .env; if that same .env could relax the threshold, the guard
# would be advisory rather than an interlock.
SMALL_HOST_MB = 13312


class CapacityConfigError(RuntimeError):
    """Raised when MAX_PODS is unsafe for the host this process is running on."""


def _parse_meminfo_kb(meminfo: str, field: str) -> Optional[int]:
    prefix = f"{field}:"
    for line in meminfo.splitlines():
        if line.startswith(prefix):
            parts = line.split()
            if len(parts) < 2:
                return None
            try:
                return int(parts[1])
            except ValueError:
                # Unparseable is indistinguishable from unknown; the caller must
                # fail closed rather than see an exception (branch-review 12).
                return None
    return None


def parse_memavailable_kb(meminfo: str) -> Optional[int]:
    return _parse_meminfo_kb(meminfo, "MemAvailable")


def parse_memtotal_kb(meminfo: str) -> Optional[int]:
    return _parse_meminfo_kb(meminfo, "MemTotal")


def _read_meminfo() -> Optional[str]:
    try:
        with open("/proc/meminfo", encoding="ascii") as f:
            return f.read()
    except OSError:
        return None


def available_ram_mb(meminfo: Optional[str] = None) -> Optional[int]:
    """MemAvailable in MiB; None if unreadable or unparseable (Windows/dev)."""
    if meminfo is None:
        meminfo = _read_meminfo()
    if meminfo is None:
        return None
    kb = parse_memavailable_kb(meminfo)
    return None if kb is None else kb // 1024


def total_ram_mb(meminfo: Optional[str] = None) -> Optional[int]:
    """MemTotal in MiB; None if unreadable or unparseable (Windows/dev)."""
    if meminfo is None:
        meminfo = _read_meminfo()
    if meminfo is None:
        return None
    kb = parse_memtotal_kb(meminfo)
    return None if kb is None else kb // 1024


def ram_required_mb(adding: int = 1) -> int:
    """Free MiB that must be available to admit `adding` new pods.

    MemAvailable already excludes memory resident in running pods, so this is a
    FREE-HEADROOM requirement and must not re-count active pods. Comparing a
    whole-fleet total against MemAvailable double-counts and produces false
    refusals on multi-pod hosts (branch-review Issue 1).
    """
    return adding * POD_RAM_MB + RAM_BUFFER_MB


def can_provision_ram(avail_mb: Optional[int], adding: int = 1) -> bool:
    # Fail closed: an unreadable /proc/meminfo means we cannot prove there is
    # room, so refuse rather than provision blind (12 GiB OCI target has no
    # slack for a wrong guess here).
    if avail_mb is None:
        return False
    return avail_mb >= ram_required_mb(adding)


def validate_capacity_config(max_pods: int, meminfo: Optional[str] = None) -> None:
    """Refuse to start with a multi-pod cap on a host too small to honour it.

    The RAM gate is point-in-time and reserves nothing (branch-review Issue 2):
    concurrent admits can all pass while MemAvailable is still near idle, then
    race into real allocation. MAX_PODS=1 is what actually prevents that on the
    12 GiB target, and it arrives via .env -- so a missing or wrong-template
    .env silently restores a multi-pod cap on a host that cannot hold one.

    Unknown MemTotal is not an error: on a dev box there is nothing to assert,
    and admission still fails closed per-request via can_provision_ram(None).
    """
    total = total_ram_mb(meminfo)
    if total is None:
        return
    if total <= SMALL_HOST_MB and max_pods > 1:
        raise CapacityConfigError(
            f"MAX_PODS={max_pods} is unsafe on a {total} MiB host. Hosts at or "
            f"below {SMALL_HOST_MB} MiB must set MAX_PODS=1: the RAM gate is "
            f"point-in-time and reserves nothing, so the pod cap is the only "
            f"real interlock. Set MAX_PODS=1 in the API .env "
            f"(see Docs/superpowers/specs/2026-07-30-oci-12gib-stability-design.md)."
        )


ACTIVE_PODS_SQL = (
    "SELECT COUNT(*) FROM pods WHERE status NOT IN "
    "('DESTROYED', 'FAILED_ROLLBACK_COMPLETE')"
)


def count_active_pods(conn) -> int:
    """Host-wide live pod count used by /capacity and /admin/infra-health."""
    return int(conn.execute(ACTIVE_PODS_SQL).fetchone()[0])


def build_capacity_payload(
    active_pods: int,
    avail_mb: Optional[int],
    max_pods: int,
    profile_name: str,
) -> dict:
    """Same JSON object GET /capacity already returns. Keep keys stable."""
    return {
        "available_mb": avail_mb,
        "active_pods": active_pods,
        "max_pods": max_pods,
        "pod_ram_mb": POD_RAM_MB,
        "ram_buffer_mb": RAM_BUFFER_MB,
        "profile": profile_name,
        "ram_required_mb": ram_required_mb(),
        "can_provision": active_pods < max_pods and can_provision_ram(avail_mb),
    }
