"""Presentation-safe API + LXD (#37) and Keycloak + Wazuh (#55) health for Admin."""
from __future__ import annotations

import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor, TimeoutError as FuturesTimeout
from typing import Callable, Optional, Tuple

import requests
from fastapi import APIRouter, Depends

import auth
import wazuh_client
from auth import require_role, verify_token
from capacity import available_ram_mb, build_capacity_payload, count_active_pods
from config import MAX_PODS, POD_STORAGE_MB, PROFILE_NAME
from db import get_db_connection

HEALTHY = "Healthy"
DEGRADED = "Degraded"
UNAVAILABLE = "Unavailable"

LXD_PROBE_TIMEOUT_S = 2.0
# Keycloak and Wazuh run in parallel with the LXD probe and share one deadline,
# so the endpoint stays around LXD_PROBE_TIMEOUT_S even when both hang.
SERVICE_PROBE_TIMEOUT_S = 2.0

# Agent 000 statuses Wazuh can report. Anything else is not echoed to the UI.
_WAZUH_AGENT_STATUSES = ("active", "disconnected", "pending", "never_connected")
# A reverse proxy answering for a dead upstream.
_PROXY_DOWN = (502, 503, 504)

# One shared worker for LXD probes. Concurrent callers wait on the same
# in-flight future (each with its own timeout) instead of stacking workers
# or returning a fake immediate timeout (_SingleFlight below does the same
# for Keycloak and Wazuh).
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


def _row(name: str, status: str, detail: str) -> dict:
    return {"name": name, "status": status, "detail": detail}


class _SingleFlight:
    """One in-flight probe per service on its own worker, like the LXD probe.
    Concurrent requests share the running future instead of stacking threads
    on a hung dependency."""

    def __init__(self) -> None:
        self._pool = ThreadPoolExecutor(max_workers=1)
        self._lock = threading.Lock()
        self._inflight: Optional[Future] = None

    def start(self, fn: Callable[[], dict]) -> Future:
        with self._lock:
            if self._inflight is None or self._inflight.done():
                self._inflight = self._pool.submit(fn)
            return self._inflight

    def reset(self) -> None:
        with self._lock:
            self._inflight = None


_keycloak_flight = _SingleFlight()
_wazuh_flight = _SingleFlight()


def await_row(name: str, fut: Future, deadline: float) -> dict:
    """Wait for a probe until the shared deadline. Never raises; a timeout or
    crash is Unavailable, never Healthy."""
    try:
        return fut.result(timeout=max(0.0, deadline - time.monotonic()))
    except FuturesTimeout:
        return _row(name, UNAVAILABLE, f"{name} probe timed out")
    except Exception:
        return _row(name, UNAVAILABLE, f"{name} check failed")


def classify_keycloak(
    *,
    configured: bool,
    timed_out: bool = False,
    unreachable: bool = False,
    http_status: Optional[int] = None,
    body: Optional[dict] = None,
) -> dict:
    """Classify the API's own token-introspection path (the one every
    authenticated request depends on). Details are fixed strings: no URLs,
    client ids, secrets or exception text reach the Admin UI."""
    name = "Keycloak"
    if not configured:
        return _row(name, UNAVAILABLE, "token introspection not configured on the API")
    if timed_out:
        return _row(name, UNAVAILABLE, "Keycloak probe timed out")
    if unreachable or http_status is None:
        return _row(name, UNAVAILABLE, "Keycloak unreachable")
    if http_status in _PROXY_DOWN:
        return _row(name, UNAVAILABLE, f"Keycloak not responding (HTTP {http_status})")
    if http_status in (401, 403):
        return _row(name, DEGRADED, "reachable, but the API client credentials were rejected")
    if http_status != 200:
        return _row(name, DEGRADED, f"token introspection answered HTTP {http_status}")
    # The probe token is garbage, so a healthy realm must say active: false.
    if not isinstance(body, dict) or body.get("active") is not False:
        return _row(name, DEGRADED, "unexpected token introspection response")
    return _row(name, HEALTHY, "token introspection responding")


def check_keycloak(timeout_s: float = SERVICE_PROBE_TIMEOUT_S) -> dict:
    if not auth.AUTH_ENABLED or not auth.KEYCLOAK_INTROSPECT or not auth.KEYCLOAK_CLIENT_SECRET:
        return classify_keycloak(configured=False)
    try:
        r = auth.probe_introspection(timeout=timeout_s)
    except requests.Timeout:
        return classify_keycloak(configured=True, timed_out=True)
    except requests.RequestException:
        return classify_keycloak(configured=True, unreachable=True)
    try:
        body = r.json()
    except ValueError:
        body = None
    return classify_keycloak(configured=True, http_status=r.status_code, body=body)


def classify_wazuh(
    *,
    configured: bool,
    reachable: bool = False,
    timed_out: bool = False,
    unreachable: bool = False,
    tls_failed: bool = False,
    auth_status: Optional[int] = None,
    agents_status: Optional[int] = None,
    manager_status: Optional[str] = None,
) -> dict:
    """Classify the scoring integration: authenticate as the read-only scoring
    user, then read agent 000 (the manager). auth_status / agents_status are
    HTTP errors from those two calls, None when the call succeeded."""
    name = "Wazuh"
    if not configured and reachable:
        return _row(name, DEGRADED, "manager API reachable, but scoring credentials not configured on the API")
    if not configured:
        return _row(name, UNAVAILABLE, "scoring credentials not configured on the API; manager API unreachable")
    if timed_out:
        return _row(name, UNAVAILABLE, "Wazuh probe timed out")
    if unreachable:
        return _row(name, UNAVAILABLE, "Wazuh manager API unreachable")
    if tls_failed:
        return _row(name, DEGRADED, "reachable, but TLS verification failed")
    for code in (auth_status, agents_status):
        if code in _PROXY_DOWN:
            return _row(name, UNAVAILABLE, f"Wazuh manager API not responding (HTTP {code})")
    if auth_status in (401, 403):
        return _row(name, DEGRADED, "reachable, but the scoring credentials were rejected")
    if auth_status is not None:
        return _row(name, DEGRADED, f"authentication answered HTTP {auth_status}")
    if agents_status == 403:
        return _row(name, DEGRADED, "scoring user cannot read agents")
    if agents_status is not None:
        return _row(name, DEGRADED, f"agent query answered HTTP {agents_status}")
    if manager_status == "active":
        return _row(name, HEALTHY, "manager API authenticated, manager active")
    if manager_status in _WAZUH_AGENT_STATUSES:
        return _row(name, DEGRADED, f"manager agent reports {manager_status}")
    return _row(name, DEGRADED, "manager agent status unknown")


def _http_status(exc: requests.HTTPError) -> int:
    return exc.response.status_code if exc.response is not None else 0


def check_wazuh(timeout_s: float = SERVICE_PROBE_TIMEOUT_S) -> dict:
    if not wazuh_client.WAZUH_USER or not wazuh_client.WAZUH_PASS:
        # No credentials to log in with: still tell "manager down" apart from
        # "manager up, scoring not wired" with an unauthenticated request.
        try:
            wazuh_client.ping_manager_api(timeout=timeout_s)
            reachable = True
        except requests.exceptions.SSLError:
            reachable = True  # something answered the TLS handshake
        except requests.RequestException:
            reachable = False
        return classify_wazuh(configured=False, reachable=reachable)
    try:
        try:
            token = wazuh_client.get_wazuh_token(timeout=timeout_s)
        except requests.HTTPError as e:
            return classify_wazuh(configured=True, auth_status=_http_status(e))
        try:
            status = wazuh_client.get_manager_agent_status(token, timeout=timeout_s)
        except requests.HTTPError as e:
            return classify_wazuh(configured=True, agents_status=_http_status(e))
    except requests.Timeout:
        return classify_wazuh(configured=True, timed_out=True)
    except requests.exceptions.SSLError:
        return classify_wazuh(configured=True, tls_failed=True)
    except requests.RequestException:
        return classify_wazuh(configured=True, unreachable=True)
    return classify_wazuh(configured=True, manager_status=status)


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

    # Identity/SIEM probes run on their own workers while LXD is checked.
    deadline = time.monotonic() + SERVICE_PROBE_TIMEOUT_S
    keycloak_fut = _keycloak_flight.start(check_keycloak)
    wazuh_fut = _wazuh_flight.start(check_wazuh)

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
            await_row("Keycloak", keycloak_fut, deadline),
            await_row("Wazuh", wazuh_fut, deadline),
        ],
    }
