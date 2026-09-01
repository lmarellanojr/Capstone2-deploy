"""Per-pod lab web proxy helpers (LXD proxy devices).

Host has no L3 route into pod OVN nets, so student browsers cannot reach
DVWA at 10.0.<50+pod>.30 directly. An LXD ``proxy`` device binds a host
(or lxdbr0) TCP port and forwards into the container via the control plane.

Port scheme (deterministic, no DB column required):
  dvwa HTTP  →  LAB_PROXY_PORT_BASE + pod_id   (default 18300 + pod_id)

Primary bind defaults to lxdbr0 host IP (LAB_PROXY_LISTEN) so the gateway
container and host-side reachability checks can use a real connectable
address (not 0.0.0.0 / 127.0.0.1-only). A second proxy device
(lab-dvwa-http-pub) also binds LAB_PUBLIC_HOST so the URL shown to students
answers on the LAN-facing NIC. This is a LAN-trust posture (no data-plane
auth on DVWA itself) — not session-auth security.
"""
from __future__ import annotations

import logging
import os
import subprocess
from typing import Any, Dict, Optional

logger = logging.getLogger("provision_api")

DEVICE_DVWA_HTTP = "lab-dvwa-http"
# Second device binds LAB_PUBLIC_HOST so student browsers on the LAN can open
# the advertised URL. Distinct name — must not collide with lab-dvwa-http.
DEVICE_DVWA_HTTP_PUB = "lab-dvwa-http-pub"

# 18301..18306 for pod_id 1..6
LAB_PROXY_PORT_BASE = int(os.getenv("LAB_PROXY_PORT_BASE", "18300"))
# Prefer lxdbr0 so guacamole (on lxdbr0) can proxy; override per host.
# This must remain a real connectable address (used in local probe URLs).
# Do NOT set to 0.0.0.0 — that is a bind wildcard, not a connect target.
LAB_PROXY_LISTEN = os.getenv("LAB_PROXY_LISTEN", "10.115.77.1")
# Public host students open in the browser. Empty default is intentional:
# hosts MUST set LAB_PUBLIC_HOST in .env (staging .111 sets 192.168.1.111).
# Fail-closed if unset — never silently advertise another host's IP.
LAB_PUBLIC_HOST = os.getenv("LAB_PUBLIC_HOST", "").strip()
# If the LAB_PROXY_LISTEN bind fails, the code below used to fall back to
# 0.0.0.0, exposing DVWA (default creds returned in lab-urls) on every host
# interface including any public NIC (branch-review Issue 12). Default is
# fail-closed: the fallback only engages when explicitly opted into.
LAB_PROXY_ALLOW_WILDCARD_FALLBACK = os.getenv(
    "LAB_PROXY_ALLOW_WILDCARD_FALLBACK", "false"
).strip().lower() in ("1", "true", "yes")
LAB_PUBLIC_SCHEME = os.getenv("LAB_PUBLIC_SCHEME", "http")
# Optional shared SIEM dashboard (session-gated path or absolute URL).
WAZUH_DASHBOARD_PUBLIC_URL = os.getenv("WAZUH_DASHBOARD_PUBLIC_URL", "").strip()


def dvwa_proxy_port(pod_id: int) -> int:
    if pod_id < 1 or pod_id > 6:
        raise ValueError(f"pod_id must be 1-6, got {pod_id}")
    return LAB_PROXY_PORT_BASE + pod_id


def dvwa_public_url(pod_id: int, path: str = "/dvwa/") -> str:
    """Build student-facing DVWA URL, or empty string if LAB_PUBLIC_HOST unset (fail-closed)."""
    if not LAB_PUBLIC_HOST:
        logger.warning(
            "LAB_PUBLIC_HOST is empty — cannot build public DVWA URL "
            "(set LAB_PUBLIC_HOST in Phase 5 .env; fail-closed, no silent default)"
        )
        return ""
    port = dvwa_proxy_port(pod_id)
    if not path.startswith("/"):
        path = "/" + path
    return f"{LAB_PUBLIC_SCHEME}://{LAB_PUBLIC_HOST}:{port}{path}"


def _lxc(*args: str, check: bool = False) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["lxc", *args],
        capture_output=True,
        text=True,
        timeout=30,
        check=check,
    )


def add_dvwa_http_proxy(dvwa_container: str, pod_id: int) -> int:
    """Attach LXD proxy device(s) on dvwa container. Returns listen port.

    Primary device (lab-dvwa-http) binds LAB_PROXY_LISTEN (lxdbr0 by default).
    When that specific bind succeeds AND LAB_PUBLIC_HOST differs, a second
    device (lab-dvwa-http-pub) also binds LAB_PUBLIC_HOST so the student-facing
    URL works on the LAN NIC. Skipped if the 0.0.0.0 fallback already engaged
    (wildcard covers the public interface) or the two addresses are identical.

    Idempotent: removes existing device names first.
    Connect target is container loopback :80 (Apache/nginx in golden).
    Secondary-device failure is logged, not fatal — primary reachability stays.
    """
    port = dvwa_proxy_port(pod_id)
    listen = f"tcp:{LAB_PROXY_LISTEN}:{port}"
    connect = "tcp:127.0.0.1:80"

    # Remove stale devices if present (re-provision / retry).
    _lxc("config", "device", "remove", dvwa_container, DEVICE_DVWA_HTTP)
    _lxc("config", "device", "remove", dvwa_container, DEVICE_DVWA_HTTP_PUB)

    bound_on_specific = False
    result = _lxc(
        "config",
        "device",
        "add",
        dvwa_container,
        DEVICE_DVWA_HTTP,
        "proxy",
        f"listen={listen}",
        f"connect={connect}",
    )
    if result.returncode != 0:
        if not LAB_PROXY_ALLOW_WILDCARD_FALLBACK:
            logger.error(
                "Failed to add DVWA proxy on %s bound to LAB_PROXY_LISTEN=%s: %s %s "
                "(wildcard 0.0.0.0 fallback is disabled by default -- would expose "
                "DVWA, including its default credentials, on every host interface; "
                "set LAB_PROXY_ALLOW_WILDCARD_FALLBACK=true to opt in)",
                dvwa_container,
                LAB_PROXY_LISTEN,
                result.stderr.strip(),
                result.stdout.strip(),
            )
            raise RuntimeError(
                f"lxc proxy device add failed on {LAB_PROXY_LISTEN}: "
                f"{result.stderr.strip() or result.stdout.strip()}"
            )
        # Opt-in fallback: some hosts prefer bind on all interfaces.
        # 0.0.0.0 already covers LAB_PUBLIC_HOST — do not add a second device.
        listen_any = f"tcp:0.0.0.0:{port}"
        result = _lxc(
            "config",
            "device",
            "add",
            dvwa_container,
            DEVICE_DVWA_HTTP,
            "proxy",
            f"listen={listen_any}",
            f"connect={connect}",
        )
        if result.returncode != 0:
            logger.error(
                "Failed to add DVWA proxy on %s: %s %s",
                dvwa_container,
                result.stderr.strip(),
                result.stdout.strip(),
            )
            raise RuntimeError(
                f"lxc proxy device add failed: {result.stderr.strip() or result.stdout.strip()}"
            )
        logger.warning(
            "DVWA proxy bound on 0.0.0.0:%s (LAB_PROXY_LISTEN=%s failed, "
            "LAB_PROXY_ALLOW_WILDCARD_FALLBACK=true); "
            "skipping public second device (wildcard already covers it)",
            port,
            LAB_PROXY_LISTEN,
        )
    else:
        bound_on_specific = True
        logger.info("DVWA proxy %s -> %s:%s", dvwa_container, LAB_PROXY_LISTEN, port)

    # Second device: LAN-facing public host (student browser URL).
    if bound_on_specific and not LAB_PUBLIC_HOST:
        logger.warning(
            "LAB_PUBLIC_HOST is empty — skipping public second proxy device on %s "
            "(fail-closed; set LAB_PUBLIC_HOST in Phase 5 .env to attach lab-dvwa-http-pub)",
            dvwa_container,
        )
    elif bound_on_specific and LAB_PUBLIC_HOST != LAB_PROXY_LISTEN:
        listen_pub = f"tcp:{LAB_PUBLIC_HOST}:{port}"
        result_pub = _lxc(
            "config",
            "device",
            "add",
            dvwa_container,
            DEVICE_DVWA_HTTP_PUB,
            "proxy",
            f"listen={listen_pub}",
            f"connect={connect}",
        )
        if result_pub.returncode != 0:
            logger.warning(
                "DVWA public proxy %s on %s:%s failed (primary still OK): %s %s",
                dvwa_container,
                LAB_PUBLIC_HOST,
                port,
                result_pub.stderr.strip(),
                result_pub.stdout.strip(),
            )
        else:
            logger.info(
                "DVWA public proxy %s -> %s:%s (LAN-trust, no data-plane auth)",
                dvwa_container,
                LAB_PUBLIC_HOST,
                port,
            )
    elif bound_on_specific and LAB_PUBLIC_HOST == LAB_PROXY_LISTEN:
        logger.info(
            "DVWA public second device skipped: LAB_PUBLIC_HOST == LAB_PROXY_LISTEN (%s)",
            LAB_PUBLIC_HOST,
        )

    return port


def remove_dvwa_http_proxy(dvwa_container: str) -> None:
    """Remove primary and public DVWA proxy devices if present."""
    for device in (DEVICE_DVWA_HTTP, DEVICE_DVWA_HTTP_PUB):
        result = _lxc("config", "device", "remove", dvwa_container, device)
        if result.returncode != 0 and "not found" not in (result.stderr or "").lower():
            logger.warning(
                "remove DVWA proxy device %s on %s: %s",
                device,
                dvwa_container,
                result.stderr.strip() or result.stdout.strip(),
            )


def lab_urls_payload(pod_id: int, student_id: str) -> Dict[str, Any]:
    """JSON for GET /pods/{id}/lab-urls (owner-gated by caller)."""
    port = dvwa_proxy_port(pod_id)
    dvwa_url = dvwa_public_url(pod_id)
    siem: Dict[str, Any]
    if WAZUH_DASHBOARD_PUBLIC_URL:
        siem = {
            "ready": True,
            "url": WAZUH_DASHBOARD_PUBLIC_URL,
            "hint": f"Filter agents to pod-{student_id}-meta / pod-{student_id}-dvwa",
        }
    else:
        siem = {
            "ready": False,
            "url": None,
            "hint": (
                "Wazuh manager 10.0.40.10 — set WAZUH_DASHBOARD_PUBLIC_URL when the "
                "dashboard is published through the portal. Generate noise from Kali; "
                "write triage files on meta."
            ),
            "manager": "10.0.40.10",
        }

    if LAB_PUBLIC_HOST and dvwa_url:
        dvwa: Dict[str, Any] = {
            "ready": True,
            "url": dvwa_url,
            "proxy_port": port,
            "listen": LAB_PROXY_LISTEN,
            "login": "admin / password",
            "security": "Low",
            "note": (
                "Open in your browser (new tab). SQLMap still runs on Kali for scoring. "
                "LAN-trust host TCP only — no data-plane session auth on this URL. "
                "If the page does not load, the pod may predate lab-proxy provision or "
                "the host firewall is blocking the proxy port."
            ),
        }
    else:
        dvwa = {
            "ready": False,
            "url": None,
            "proxy_port": port,
            "listen": LAB_PROXY_LISTEN,
            "login": "admin / password",
            "security": "Low",
            "note": (
                "LAB_PUBLIC_HOST is not set — public DVWA URL withheld (fail-closed). "
                "Set LAB_PUBLIC_HOST in Phase 5 .env and re-provision. Primary proxy on "
                f"LAB_PROXY_LISTEN ({LAB_PROXY_LISTEN}) may still be attached for host probes."
            ),
        }

    return {
        "pod_id": pod_id,
        "student_id": student_id,
        "dvwa": dvwa,
        "siem": siem,
    }


def probe_dvwa_proxy(pod_id: int, timeout: float = 3.0) -> Optional[int]:
    """Return HTTP status from host→proxy if reachable, else None."""
    import urllib.error
    import urllib.request

    # Prefer URL that hits the listen address directly from the API host
    port = dvwa_proxy_port(pod_id)
    local = f"http://{LAB_PROXY_LISTEN}:{port}/"
    try:
        req = urllib.request.Request(local, method="GET")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return int(resp.status)
    except Exception:
        url = dvwa_public_url(pod_id, "/")
        if not url:
            logger.debug(
                "probe_dvwa_proxy pod %s: listen probe failed and LAB_PUBLIC_HOST empty",
                pod_id,
            )
            return None
        try:
            req = urllib.request.Request(url, method="GET")
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return int(resp.status)
        except Exception as e:
            logger.debug("probe_dvwa_proxy pod %s failed: %s", pod_id, e)
            return None
