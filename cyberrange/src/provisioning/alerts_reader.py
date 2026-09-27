"""List Wazuh alerts from manager alerts.json (no indexer)."""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Iterable, Optional

logger = logging.getLogger("provision_api")

WAZUH_MANAGER_INSTANCE = "wazuh-manager"  # override via env in live helper
ALERTS_JSON_PATH = "/var/ossec/logs/alerts/alerts.json"
ALERTS_MAX_BYTES = 64 * 1024 * 1024
ALLOWED_KEYS = ("timestamp", "agent_id", "agent_name", "rule_id", "rule_description", "rule_level")


class ManagerUnavailable(Exception):
    pass


@dataclass
class AlertList:
    alerts: list[dict]
    total_count: int
    truncated: bool


def _parse_wazuh_ts(ts: str) -> datetime:
    ts = ts.replace("Z", "+00:00")
    return datetime.fromisoformat(re.sub(r"([+-]\d{2})(\d{2})$", r"\1:\2", ts))


def _tail_bytes(chunks: Iterable[bytes], max_bytes: int) -> tuple[bytes, bool]:
    buf = bytearray()
    truncated = False
    for chunk in chunks:
        buf.extend(chunk)
        if len(buf) > max_bytes:
            truncated = True
            buf = buf[-max_bytes:]
    if truncated:
        nl = buf.find(b"\n")
        if nl != -1:
            buf = buf[nl + 1 :]
    return bytes(buf), truncated


def _allowlist(ev: dict) -> dict:
    agent = ev.get("agent") if isinstance(ev.get("agent"), dict) else {}
    rule = ev.get("rule") if isinstance(ev.get("rule"), dict) else {}
    return {
        "timestamp": ev.get("timestamp", ""),
        "agent_id": str(agent.get("id", "")).zfill(3),
        "agent_name": str(agent.get("name") or ""),
        "rule_id": str(rule.get("id") or ""),
        "rule_description": str(rule.get("description") or ""),
        "rule_level": int(rule.get("level") or 0),
    }


def list_siem_alerts(
    agent_ids: list[str],
    *,
    agent_names: Optional[list[str]] = None,
    since_minutes: int = 240,
    rule_id: Optional[str] = None,
    exclude_rule_ids: Optional[list[str]] = None,
    limit: int = 50,
    not_before: Optional[datetime] = None,
    raw: Optional[bytes] = None,
) -> AlertList:
    """Alerts for these agents, newest first.

    not_before is the pod's created_at. Agent names (pod-<student>-meta) are
    reused when a student re-provisions, so without it a fresh pod would show
    the previous pod's alerts for up to since_minutes.
    """
    want = {str(a).zfill(3) for a in agent_ids if a}
    names = {str(n) for n in (agent_names or []) if n}
    if not want and not names:
        return AlertList([], 0, False)
    rid = str(rule_id) if rule_id else None
    skip = {str(x) for x in (exclude_rule_ids or []) if x}
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=since_minutes)
    if not_before is not None and not_before > cutoff:
        cutoff = not_before

    if raw is None:
        raw, truncated = _read_manager_tail()
    else:
        raw, truncated = _tail_bytes([raw], ALERTS_MAX_BYTES)

    matched: list[dict] = []
    for line in raw.split(b"\n"):
        if b'"rule"' not in line:
            continue
        try:
            ev = json.loads(line)
            if not isinstance(ev, dict):
                continue
            ts = _parse_wazuh_ts(ev.get("timestamp", ""))
            if ts < cutoff:
                continue
            row = _allowlist(ev)
            id_ok = bool(want) and row["agent_id"] in want
            name_ok = bool(names) and row["agent_name"] in names
            if not id_ok and not name_ok:
                continue
            if rid and row["rule_id"] != rid:
                continue
            if skip and row["rule_id"] in skip:
                continue
            matched.append(row)
        except (ValueError, TypeError, AttributeError):
            continue

    matched.sort(key=lambda r: r["timestamp"], reverse=True)
    total = len(matched)
    if truncated:
        logger.warning("alerts.json tail truncated; window may be incomplete")
    return AlertList(matched[: max(0, limit)], total, truncated)


def _read_manager_tail() -> tuple[bytes, bool]:
    try:
        import os
        import pylxd

        name = os.getenv("WAZUH_MANAGER_INSTANCE", WAZUH_MANAGER_INSTANCE)
        client = pylxd.Client(project=os.getenv("LXD_PROJECT", "default"))
        res = client.api.instances[name].files.get(
            params={"path": ALERTS_JSON_PATH}, stream=True
        )
        return _tail_bytes(res.iter_content(chunk_size=65536), ALERTS_MAX_BYTES)
    except Exception as e:
        raise ManagerUnavailable(str(e)) from e
