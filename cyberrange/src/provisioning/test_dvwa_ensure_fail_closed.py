"""Scenario 2 DVWA ensure is fail-closed (#317). Other scenarios stay fail-open."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest


def test_s2_compose_fail_raises_and_never_returns_ok(monkeypatch):
    import provision

    events: list[tuple] = []

    def log_event(event_type, student_id=None, pod_id=None, vmid=None, result=None, detail=None):
        events.append((event_type, detail))

    monkeypatch.setattr(provision, "log_event", log_event)
    sleeps: list[float] = []
    monkeypatch.setattr(provision.time, "sleep", lambda s: sleeps.append(s))

    with pytest.raises(RuntimeError, match=provision.DVWA_ENSURE_GENERIC_ERROR):
        provision.ensure_dvwa_during_provision(
            MagicMock(),
            "alice",
            1,
            "6",
            compose_fn=lambda _inst: False,
            ready_fn=lambda _inst: True,
            retries=1,
            retry_delay_s=0,
        )

    assert ("DVWA_COMPOSE_FAIL", "DB_SERVER=db health check failed") in events
    assert not any(e[0] == "DVWA_COMPOSE_OK" for e in events)
    # One retry after the first failure
    assert len(sleeps) == 1


def test_s2_ready_fail_raises(monkeypatch):
    import provision

    events: list[tuple] = []
    monkeypatch.setattr(
        provision,
        "log_event",
        lambda event_type, student_id=None, pod_id=None, vmid=None, result=None, detail=None: events.append(
            (event_type, detail)
        ),
    )
    monkeypatch.setattr(provision.time, "sleep", lambda _s: None)

    with pytest.raises(RuntimeError, match=provision.DVWA_ENSURE_GENERIC_ERROR):
        provision.ensure_dvwa_during_provision(
            MagicMock(),
            "alice",
            2,
            "06",
            compose_fn=lambda _inst: True,
            ready_fn=lambda _inst: False,
            retries=0,
        )

    assert ("DVWA_READY_FAIL", "users table missing after seed") in events
    assert ("DVWA_COMPOSE_OK", None) in events or any(e[0] == "DVWA_COMPOSE_OK" for e in events)


def test_s2_exception_fail_closed_uses_generic_error(monkeypatch):
    import provision

    details: list[str] = []
    monkeypatch.setattr(
        provision,
        "log_event",
        lambda event_type, student_id=None, pod_id=None, vmid=None, result=None, detail=None: details.append(
            detail or ""
        ),
    )
    monkeypatch.setattr(provision.time, "sleep", lambda _s: None)

    def boom(_inst):
        raise RuntimeError("mysqli Connection refused secret=should-not-raise")

    with pytest.raises(RuntimeError, match=provision.DVWA_ENSURE_GENERIC_ERROR) as exc_info:
        provision.ensure_dvwa_during_provision(
            MagicMock(),
            "alice",
            3,
            6,
            compose_fn=boom,
            ready_fn=lambda _inst: True,
            retries=0,
        )

    assert "secret=" not in str(exc_info.value)
    assert any("Connection refused" in d for d in details)


def test_other_scenarios_fail_open_on_compose_and_ready(monkeypatch):
    import provision

    events: list[str] = []
    monkeypatch.setattr(
        provision,
        "log_event",
        lambda event_type, student_id=None, pod_id=None, vmid=None, result=None, detail=None: events.append(
            event_type
        ),
    )

    # Scenario 1 / 3 / 4: log FAIL and return without raising
    for scen in ("1", "09", "11"):
        events.clear()
        provision.ensure_dvwa_during_provision(
            MagicMock(),
            "bob",
            4,
            scen,
            compose_fn=lambda _inst: False,
            ready_fn=lambda _inst: False,
            retries=1,
        )
        assert "DVWA_COMPOSE_FAIL" in events
        assert "DVWA_READY_FAIL" in events


def test_s2_retries_then_succeeds(monkeypatch):
    import provision

    events: list[str] = []
    monkeypatch.setattr(
        provision,
        "log_event",
        lambda event_type, student_id=None, pod_id=None, vmid=None, result=None, detail=None: events.append(
            event_type
        ),
    )
    sleeps: list[float] = []
    monkeypatch.setattr(provision.time, "sleep", lambda s: sleeps.append(s))

    calls = {"compose": 0, "ready": 0}

    def compose(_inst):
        calls["compose"] += 1
        return calls["compose"] >= 2

    def ready(_inst):
        calls["ready"] += 1
        return True

    provision.ensure_dvwa_during_provision(
        MagicMock(),
        "alice",
        5,
        "6",
        compose_fn=compose,
        ready_fn=ready,
        retries=1,
        retry_delay_s=3,
    )

    assert calls["compose"] == 2
    # Ready still runs on the failed compose attempt (same as the old path).
    assert calls["ready"] == 2
    assert sleeps == [3]
    assert events.count("DVWA_COMPOSE_FAIL") == 1
    assert events.count("DVWA_COMPOSE_OK") == 1
    assert events.count("DVWA_READY_OK") == 2


def test_perform_provisioning_s2_cleans_up_when_dvwa_ensure_fails(monkeypatch):
    """INTEGRATION: Scenario 2 never reaches ACTIVE when DVWA ensure fails."""
    import sys
    from unittest.mock import MagicMock

    sys.modules.setdefault("pylxd", MagicMock())
    import provision

    commands: list[list] = []

    class _Result:
        exit_code = 0

    class _Inst:
        def start(self, wait=True):
            return None

        def execute(self, argv):
            commands.append(list(argv))
            return _Result()

    class _Instances:
        def create(self, cfg, wait=True):
            return _Inst()

        def get(self, name):
            return _Inst()

    class _Client:
        def __init__(self, project=None):
            self.instances = _Instances()

    monkeypatch.setattr(provision.pylxd, "Client", _Client)
    monkeypatch.setattr(provision, "delete_pod_network", lambda pod_id: None)
    monkeypatch.setattr(
        provision, "create_pod_network", lambda pod_id, manager_ip=None: None
    )
    # (event_type, detail) — detail pins fail-closed wiring (review finding 1).
    events: list[tuple[str, object]] = []
    monkeypatch.setattr(
        provision,
        "log_event",
        lambda event_type, student_id=None, pod_id=None, vmid=None, result=None, detail=None: events.append(
            (event_type, detail)
        ),
    )
    monkeypatch.setattr(provision, "ensure_guest_nic_up", lambda *args, **kwargs: True)
    monkeypatch.setattr(provision, "ensure_dvwa_compose", lambda inst: False)
    monkeypatch.setattr(provision, "ensure_dvwa_ready", lambda inst: True)
    monkeypatch.setattr(provision, "add_dvwa_http_proxy", lambda name, pod_id: 18301)
    monkeypatch.setattr(provision, "wazuh_manager_ip", lambda client: "10.0.40.10")
    monkeypatch.setattr(provision.os.path, "exists", lambda path: False)
    monkeypatch.setattr(provision.time, "sleep", lambda _s: None)
    monkeypatch.setattr(provision, "abort_if_names_remain", lambda student_id: [])
    monkeypatch.setattr(provision, "finish_enroll", lambda *a, **k: None)
    monkeypatch.setattr(provision, "plant_flags_during_provision", lambda *a, **k: None)

    cleaned: list[tuple] = []
    monkeypatch.setattr(
        provision, "cleanup_after_failure", lambda *args: cleaned.append(args)
    )

    db_calls: list[str] = []

    def track_db():
        db_calls.append("get_db_connection")
        raise AssertionError("pod row must not be updated to ACTIVE")

    monkeypatch.setattr(provision, "get_db_connection", track_db)

    provision.perform_provisioning(
        "alice",
        1,
        {"kali": "pod-alice-kali", "meta": "pod-alice-meta", "dvwa": "pod-alice-dvwa"},
        "6",
    )

    event_types = [e[0] for e in events]
    assert cleaned == [("alice", 1, None, None)]
    assert (
        "PROVISION_FAILED",
        provision.DVWA_ENSURE_GENERIC_ERROR,
    ) in events
    assert "PROVISION_SUCCESS" not in event_types
    assert "DVWA_COMPOSE_FAIL" in event_types
    # Past-DVWA steps must not run — these would still fire on a fail-open path.
    assert "LAB_PROXY_OK" not in event_types
    assert db_calls == []
