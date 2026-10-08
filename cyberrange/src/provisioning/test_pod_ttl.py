"""Issue 10 + per-scenario limits: lab TTL remaining, reaper uses the same clock."""
from __future__ import annotations

import asyncio
import inspect
import sys
from datetime import datetime, timezone
from pathlib import Path
from types import ModuleType, SimpleNamespace

import pytest

if "pylxd" not in sys.modules:
    _pylxd = ModuleType("pylxd")
    _exc = ModuleType("pylxd.exceptions")
    _exc.NotFound = type("NotFound", (Exception,), {})
    _pylxd.exceptions = _exc
    _pylxd.Client = object
    sys.modules["pylxd"] = _pylxd
    sys.modules["pylxd.exceptions"] = _exc

from ttl import (
    is_ttl_expired,
    parse_created_at_utc,
    ttl_minutes_for,
    ttl_payload,
    ttl_seconds_remaining,
)


def test_parse_sqlite_naive_is_utc():
    dt = parse_created_at_utc("2026-09-07 12:00:00")
    assert dt.tzinfo is not None
    assert dt.utcoffset().total_seconds() == 0
    assert dt.hour == 12


@pytest.mark.parametrize(
    "scenario_id, minutes",
    [("01", 30), ("1", 30), (1, 30), ("06", 45), ("09", 45), ("11", 60)],
)
def test_limit_follows_scenario_difficulty(scenario_id, minutes):
    assert ttl_minutes_for(scenario_id) == minutes


@pytest.mark.parametrize("scenario_id", [None, "", "abc", "99"])
def test_unknown_scenario_gets_default_limit(scenario_id):
    assert ttl_minutes_for(scenario_id) == 60


def test_remaining_fresh_scenario_01():
    created = "2026-09-07 00:00:00"
    now = datetime(2026, 9, 7, 0, 0, 0, tzinfo=timezone.utc)
    assert ttl_seconds_remaining(created, 30, now) == 30 * 60
    assert is_ttl_expired(created, 30, now) is False
    payload = ttl_payload(created, "01", now)
    assert payload["ttl_minutes"] == 30
    assert payload["remaining_seconds"] == 30 * 60
    assert payload["expires_at"] == "2026-09-07T00:30:00Z"
    assert payload["ttl_expired"] is False


def test_payload_uses_scenario_limit():
    created = "2026-09-07 00:00:00"
    now = datetime(2026, 9, 7, 0, 40, 0, tzinfo=timezone.utc)
    assert ttl_payload(created, "01", now)["ttl_expired"] is True
    p11 = ttl_payload(created, "11", now)
    assert p11["ttl_expired"] is False
    assert p11["remaining_seconds"] == 20 * 60
    assert p11["expires_at"] == "2026-09-07T01:00:00Z"


def test_remaining_clamps_at_zero():
    created = "2026-09-07 00:00:00"
    now = datetime(2026, 9, 7, 1, 0, 0, tzinfo=timezone.utc)
    assert ttl_seconds_remaining(created, 45, now) == 0
    assert is_ttl_expired(created, 45, now) is True
    assert ttl_payload(created, "06", now)["ttl_expired"] is True


def test_missing_created_at_is_not_expired():
    assert ttl_seconds_remaining(None, 30) == 0
    assert ttl_seconds_remaining("", 30) == 0
    assert is_ttl_expired(None, 30) is False
    p = ttl_payload(None, "01")
    assert p["expires_at"] is None
    assert p["ttl_expired"] is False
    assert p["remaining_seconds"] == 0


def test_junk_created_at_does_not_raise():
    assert is_ttl_expired("not-a-date", 30) is False
    p = ttl_payload("not-a-date", "01")
    assert p["ttl_expired"] is False
    assert p["expires_at"] is None


import db
import migrate
from db import get_db_connection
from provision import finalize_destroyed_pod
import reaper
from reaper import reap_ttl_once


@pytest.fixture
def ttl_db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    db_path = tmp_path / "pod_mgmt.db"
    migrate.apply(str(db_path))
    monkeypatch.setattr(db, "DB_PATH", str(db_path))
    return db_path


def _insert_active(
    created_sql: str, student_id: str = "alice", pod_id: int = 1, scenario_id: str = "01"
) -> None:
    # created_sql is a test-only SQL literal, never student input.
    conn = get_db_connection()
    with conn:
        conn.execute(
            "INSERT INTO pods (student_id, pod_id, status, scenario_id, created_at) "
            "VALUES (?,?, 'ACTIVE', ?, " + created_sql + ")",
            (student_id, pod_id, scenario_id),
        )
        conn.execute(
            "INSERT INTO milestone_verification "
            "(pod_id, student_id, scenario_id, milestone_id, status) "
            "VALUES (?,?,1,1,'PASS')",
            (pod_id, student_id),
        )
    conn.close()


def test_reap_skips_fresh_pod(ttl_db: Path, monkeypatch: pytest.MonkeyPatch):
    _insert_active("datetime('now')")
    called = []
    monkeypatch.setattr(reaper, "perform_destruction", lambda pod: called.append(pod["pod_id"]))
    asyncio.run(reap_ttl_once())
    assert called == []
    conn = get_db_connection()
    assert conn.execute("SELECT status FROM pods WHERE pod_id=1").fetchone()[0] == "ACTIVE"
    conn.close()


def test_reap_destroys_expired_pod_and_keeps_score(ttl_db: Path, monkeypatch: pytest.MonkeyPatch):
    _insert_active("datetime('now', '-31 minutes')")

    def fake_destroy(pod):
        finalize_destroyed_pod(pod["pod_id"], "DESTROYED")

    monkeypatch.setattr(reaper, "perform_destruction", fake_destroy)
    asyncio.run(reap_ttl_once())
    conn = get_db_connection()
    status = conn.execute("SELECT status FROM pods WHERE pod_id=1").fetchone()[0]
    n = conn.execute(
        "SELECT COUNT(*) FROM milestone_verification WHERE student_id='alice' AND status='PASS'"
    ).fetchone()[0]
    conn.close()
    assert status == "DESTROYED"
    assert n == 1


def test_reap_cas_leaves_destroying_if_destruction_noop(ttl_db: Path, monkeypatch: pytest.MonkeyPatch):
    _insert_active("datetime('now', '-31 minutes')")
    monkeypatch.setattr(reaper, "perform_destruction", lambda pod: None)
    asyncio.run(reap_ttl_once())
    conn = get_db_connection()
    assert conn.execute("SELECT status FROM pods WHERE pod_id=1").fetchone()[0] == "DESTROYING"
    conn.close()


def test_reap_uses_each_scenarios_limit(ttl_db: Path, monkeypatch: pytest.MonkeyPatch):
    # 40 min in: past scenario 01's 30, under scenario 11's 60.
    _insert_active("datetime('now', '-40 minutes')", "alice", 1, "01")
    _insert_active("datetime('now', '-40 minutes')", "bob", 2, "11")
    called = []
    monkeypatch.setattr(reaper, "perform_destruction", lambda pod: called.append(pod["pod_id"]))
    asyncio.run(reap_ttl_once())
    assert called == [1]


def test_reap_ttl_once_source_has_no_milestone_sql():
    src = inspect.getsource(reaper.reap_ttl_once)
    assert "milestone_verification" not in src


import auth
from models import PodResponse
from pods_router import get_pod_status, list_pods


def test_list_pods_includes_ttl_fields(ttl_db: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(auth, "AUTH_ENABLED", True)
    conn = get_db_connection()
    with conn:
        conn.execute(
            "INSERT INTO pods (student_id, pod_id, status, scenario_id, created_at) "
            "VALUES ('alice', 1, 'ACTIVE', '01', datetime('now', '-10 minutes'))"
        )
    conn.close()
    data = list_pods(claims={"preferred_username": "alice"})
    pod = data["pods"][0]
    assert not isinstance(pod, PodResponse)
    assert pod["ttl_minutes"] == 30
    assert 0 < pod["remaining_seconds"] <= 20 * 60
    assert pod["expires_at"].endswith("Z")
    assert pod["ttl_expired"] is False


def test_list_pods_null_created_at_not_expired(ttl_db: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(auth, "AUTH_ENABLED", True)
    conn = get_db_connection()
    with conn:
        conn.execute(
            "INSERT INTO pods (student_id, pod_id, status, scenario_id, created_at) "
            "VALUES ('alice', 1, 'ACTIVE', '01', NULL)"
        )
    conn.close()
    pod = list_pods(claims={"preferred_username": "alice"})["pods"][0]
    assert pod["ttl_expired"] is False
    assert pod["expires_at"] is None
    assert pod["remaining_seconds"] == 0


def test_get_pod_status_returns_pod_response(ttl_db: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(auth, "AUTH_ENABLED", True)
    conn = get_db_connection()
    with conn:
        conn.execute(
            "INSERT INTO pods (student_id, pod_id, status, scenario_id, created_at) "
            "VALUES ('alice', 1, 'ACTIVE', '01', datetime('now'))"
        )
    conn.close()
    body = get_pod_status(1, claims={"preferred_username": "alice"})
    assert isinstance(body, PodResponse)
    dumped = body.model_dump() if hasattr(body, "model_dump") else body.dict()
    assert dumped["created_at"]
    assert dumped["scenario_id"] == "01"
    assert dumped["remaining_seconds"] > 0
    assert dumped["ttl_minutes"] == 30
    assert dumped["ttl_expired"] is False


def test_pod_response_keeps_ttl():
    m = PodResponse(
        pod_id=1, student_id="alice", status="ACTIVE",
        vmid_kali=None, vmid_meta=None, vmid_dvwa=None,
        connection_id=None, wazuh_agent_id=None, last_heartbeat=None,
        scenario_id="01", created_at="2026-09-07 00:00:00",
        ttl_minutes=30, remaining_seconds=100,
        expires_at="2026-09-07T00:30:00Z", ttl_expired=False,
    )
    dumped = m.model_dump() if hasattr(m, "model_dump") else m.dict()
    assert dumped["remaining_seconds"] == 100
    assert dumped["ttl_expired"] is False


# ── Backend limits must match what the portal catalog shows ─────────────────

_PORTAL_SRC = Path(__file__).resolve().parents[2] / "portal" / "src"


def _portal_catalog_minutes() -> dict[int, int]:
    """{scenario id: minutes shown} from useScenarios.ts + DifficultyBadge.tsx."""
    import re

    catalog = (_PORTAL_SRC / "hooks" / "useScenarios.ts").read_text(encoding="utf-8")
    badge = (_PORTAL_SRC / "components" / "scenarios" / "DifficultyBadge.tsx").read_text(
        encoding="utf-8"
    )
    fn = badge[badge.index("export function scenarioDuration"):]
    fn = fn[: fn.index("\n}") + 2]
    explicit = {
        int(d): int(m)
        for d, m in re.findall(r'difficulty === (\d+)\) return "(\d+) min"', fn)
    }
    fallthrough = int(re.findall(r'^\s+return "(\d+) min";', fn, re.M)[-1])
    pairs = re.findall(
        r"^    id: '(\d+)',.*?^    difficulty: (\d+),", catalog, re.M | re.S
    )
    assert pairs, "no scenarios parsed from useScenarios.ts"
    return {int(sid): explicit.get(int(d), fallthrough) for sid, d in pairs}


def test_limits_match_portal_catalog_durations():
    from config import SCENARIO_TTL_MINUTES

    shown = _portal_catalog_minutes()
    assert set(shown) == set(SCENARIO_TTL_MINUTES), (
        "catalog scenarios and SCENARIO_TTL_MINUTES differ; add/remove the scenario in config.py"
    )
    for sid, minutes in shown.items():
        assert ttl_minutes_for(sid) == minutes, f"scenario {sid:02d}: portal shows {minutes} min"


def test_siem_window_is_limit_plus_slack():
    from config import SIEM_WINDOW_SLACK_MINUTES
    from ttl import siem_window_minutes

    assert siem_window_minutes("01") == 30 + SIEM_WINDOW_SLACK_MINUTES
    assert siem_window_minutes("11") == 60 + SIEM_WINDOW_SLACK_MINUTES


# ── Reaper cadence: expiry every tick, sweep every REAP_INTERVAL_SECONDS ────

def test_sweep_due():
    from reaper import _sweep_due

    assert _sweep_due(None, 0.0) is True
    assert _sweep_due(0.0, 599.0) is False
    assert _sweep_due(0.0, 600.0) is True


class _StopLoop(BaseException):
    pass


def test_reaper_loop_checks_ttl_every_tick_and_sweeps_every_600s(
    ttl_db: Path, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(reaper, "REAP_INTERVAL_SECONDS", 600)
    monkeypatch.setattr(reaper, "TTL_CHECK_INTERVAL_SECONDS", 60)
    clock = iter(range(0, 10_000, 60))
    monkeypatch.setattr(reaper, "time", SimpleNamespace(monotonic=lambda: float(next(clock))))
    counts = {"ttl": 0, "sweep": 0, "net": 0, "sleep": 0}

    async def fake_reap():
        counts["ttl"] += 1

    async def fake_sleep(seconds):
        assert seconds == 60
        counts["sleep"] += 1
        if counts["sleep"] == 11:
            raise _StopLoop

    monkeypatch.setattr(reaper, "reap_ttl_once", fake_reap)
    monkeypatch.setattr(reaper, "purge_storage_drift", lambda: counts.__setitem__("sweep", counts["sweep"] + 1))
    monkeypatch.setattr(reaper, "reconcile_pod_networks", lambda: counts.__setitem__("net", counts["net"] + 1))
    monkeypatch.setattr(
        reaper, "asyncio", SimpleNamespace(sleep=fake_sleep, to_thread=asyncio.to_thread)
    )

    with pytest.raises(_StopLoop):
        asyncio.run(reaper.pod_ttl_reaper())

    # 11 ticks at t = 0, 60, ..., 600: sweep at t = 0 and t = 600 only.
    assert counts["ttl"] == 11
    assert counts["sweep"] == 2
    assert counts["net"] == 2
