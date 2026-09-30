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


def _match_lines(
    raw: bytes,
    want: set,
    names: set,
    start: datetime,
    end: Optional[datetime],
    rid: Optional[str],
    skip: set,
) -> list[dict]:
    """Allowlisted rows from alerts.json-format bytes for these agents within
    [start, end] (end=None means open-ended). Shared by the live tail and the
    daily-archive reader so both apply the same agent scoping and fields."""
    matched: list[dict] = []
    for line in raw.split(b"\n"):
        if b'"rule"' not in line:
            continue
        try:
            ev = json.loads(line)
            if not isinstance(ev, dict):
                continue
            ts = _parse_wazuh_ts(ev.get("timestamp", ""))
            if ts < start or (end is not None and ts > end):
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
    return matched


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

    matched = _match_lines(raw, want, names, cutoff, None, rid, skip)

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


# ── Daily archives (instructor history) ──────────────────────────────────────
#
# Wazuh rotates alerts.json at the manager's midnight (the container runs UTC)
# into /var/ossec/logs/alerts/<YYYY>/<Mon>/ossec-alerts-<DD>.json.gz; the
# current day is the uncompressed ossec-alerts-<DD>.json (a hard link to
# alerts.json). Month names are English abbreviations regardless of locale.

ARCHIVE_DIR = "/var/ossec/logs/alerts"
ARCHIVE_MAX_DAYS = 10  # a lab is capped at POD_TTL_HOURS; this is slack
ARCHIVE_FILE_MAX_BYTES = 64 * 1024 * 1024
_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def archive_paths(day) -> tuple[str, str]:
    """(.json.gz, .json) paths for one UTC date."""
    base = f"{ARCHIVE_DIR}/{day.year}/{_MONTHS[day.month - 1]}/ossec-alerts-{day.day:02d}"
    return f"{base}.json.gz", f"{base}.json"


def _archive_days(start: datetime, end: datetime) -> list:
    # One day of slack either side absorbs rotation timing and clock skew.
    first = (start - timedelta(days=1)).date()
    last = (end + timedelta(days=1)).date()
    days = []
    d = first
    while d <= last and len(days) < ARCHIVE_MAX_DAYS:
        days.append(d)
        d += timedelta(days=1)
    return days


def list_siem_alerts_between(
    agent_ids: list[str],
    *,
    agent_names: Optional[list[str]] = None,
    start: datetime,
    end: datetime,
    exclude_rule_ids: Optional[list[str]] = None,
    limit: int = 200,
    read_file=None,
) -> AlertList:
    """Alerts for these agents between start and end (inclusive), newest first,
    read from the manager's daily archives -- so a lab that has already ended
    still has its evidence. read_file(path) -> bytes | None is injectable for
    tests; production reads over the LXD control plane."""
    want = {str(a).zfill(3) for a in agent_ids if a}
    names = {str(n) for n in (agent_names or []) if n}
    if (not want and not names) or end < start:
        return AlertList([], 0, False)
    skip = {str(x) for x in (exclude_rule_ids or []) if x}
    reader = read_file or _read_manager_file

    matched: list[dict] = []
    truncated = False
    for day in _archive_days(start, end):
        gz_path, plain_path = archive_paths(day)
        data = reader(gz_path)
        if data is not None:
            try:
                data = _gunzip_capped(data)
            except OSError:
                logger.warning("unreadable alerts archive %s", gz_path)
                data = None
        else:
            data = reader(plain_path)
        if not data:
            continue
        if len(data) > ARCHIVE_FILE_MAX_BYTES:
            data = data[-ARCHIVE_FILE_MAX_BYTES:]
            truncated = True
        matched.extend(_match_lines(data, want, names, start, end, None, skip))

    matched.sort(key=lambda r: r["timestamp"], reverse=True)
    return AlertList(matched[: max(0, limit)], len(matched), truncated)


def _gunzip_capped(data: bytes) -> bytes:
    import gzip
    import io

    with gzip.GzipFile(fileobj=io.BytesIO(data)) as g:
        return g.read(ARCHIVE_FILE_MAX_BYTES + 1)


def _read_manager_file(path: str) -> Optional[bytes]:
    """Whole file from the manager container; None if it doesn't exist.
    Raises ManagerUnavailable when LXD itself can't be reached."""
    import os

    import pylxd
    from pylxd.exceptions import NotFound

    try:
        name = os.getenv("WAZUH_MANAGER_INSTANCE", WAZUH_MANAGER_INSTANCE)
        client = pylxd.Client(project=os.getenv("LXD_PROJECT", "default"))
        res = client.api.instances[name].files.get(params={"path": path})
    except NotFound:
        # pylxd raises (not returns) on a missing file: no archive that day.
        return None
    except Exception as e:
        raise ManagerUnavailable(str(e)) from e
    return res.content
