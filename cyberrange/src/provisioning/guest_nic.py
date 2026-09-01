"""Guest NIC helpers for post-clone link-up (R7e)."""
from __future__ import annotations

import logging
import time
from typing import Any, Callable

logger = logging.getLogger(__name__)

LINK_UP_ARGV = ["ip", "link", "set", "eth0", "up"]
DHCLIENT_ARGV = ["dhclient", "-1", "eth0"]


def parse_ip_br_link(text: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in text.splitlines():
        parts = line.split()
        if len(parts) < 2:
            continue
        name = parts[0].split("@", 1)[0]
        out[name] = parts[1]
    return out


def nic_is_up(link_map: dict[str, str], name: str = "eth0") -> bool:
    return link_map.get(name) == "UP"


def has_subnet_route(route_text: str, prefix: str) -> bool:
    return prefix in (route_text or "")


def has_default_route(route_text: str) -> bool:
    for line in (route_text or "").splitlines():
        if line.split()[:1] == ["default"]:
            return True
    return False


def gateway_for_prefix(prefix: str) -> str:
    """LXD OVN dhcp gateway is the .1 of the pod /24 (e.g. 10.0.51.0/24 → 10.0.51.1)."""
    network = prefix.split("/", 1)[0]
    parts = network.split(".")
    return f"{parts[0]}.{parts[1]}.{parts[2]}.1"


def _exec_out(inst: Any, argv: list[str]) -> tuple[int, str]:
    raw = inst.execute(argv)
    if isinstance(raw, tuple) and len(raw) >= 2:
        code, out = raw[0], raw[1]
        if isinstance(out, bytes):
            out = out.decode("utf-8", "replace")
        return int(code), str(out)
    code = int(getattr(raw, "exit_code", 1))
    out = getattr(raw, "stdout", "") or ""
    if isinstance(out, bytes):
        out = out.decode("utf-8", "replace")
    return code, out


def ensure_guest_nic_up(
    inst: Any,
    *,
    subnet_prefix: str,
    timeout_s: float = 20.0,
    sleep_fn: Callable[[float], None] = time.sleep,
) -> bool:
    """Bring eth0 up and ensure subnet_prefix appears in guest routes.

    Fail-open: returns False on timeout rather than raising.
    """
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        try:
            _, link_out = _exec_out(inst, ["ip", "-br", "link"])
            if not nic_is_up(parse_ip_br_link(link_out)):
                inst.execute(LINK_UP_ARGV)
                sleep_fn(1.0)
                continue

            _, route_out = _exec_out(inst, ["ip", "-4", "route"])
            if not has_subnet_route(route_out, subnet_prefix):
                inst.execute(DHCLIENT_ARGV)
                sleep_fn(1.0)
                continue

            if not has_default_route(route_out):
                gw = gateway_for_prefix(subnet_prefix)
                inst.execute(["ip", "route", "replace", "default", "via", gw])
                sleep_fn(0.2)
                continue

            return True
        except Exception as exc:
            # Fail-open: guest execute errors do not raise; retry until timeout.
            logger.warning("guest nic execute failed: %s", exc, exc_info=True)
            sleep_fn(1.0)
            continue
    return False
