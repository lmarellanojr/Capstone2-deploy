"""Lab agent cleanup: teardown must actually remove agents (the read-only
scoring user got 403), remove them by name as well as stored id, purge so the
name is free, never touch agent 000, and never raise into teardown."""
from __future__ import annotations

import pytest

import wazuh_client as wc


class _Resp:
    def __init__(self, status=200, payload=None):
        self.status_code = status
        self._payload = payload or {}

    def json(self):
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise wc.requests.HTTPError(f"{self.status_code} error")


@pytest.fixture
def api(monkeypatch):
    """Fake Wazuh API recording calls; agents keyed by id -> name."""
    state = {"agents": {"000": "wazuh-manager", "008": "pod-alice-meta", "011": "pod-alice-meta", "012": "pod-alice-dvwa",
                        "020": "pod-bob-meta"},
             "auth_users": [], "deleted": [], "delete_params": []}

    def post(url, auth=None, **kw):
        state["auth_users"].append(auth[0])
        return _Resp(200, {"data": {"token": f"tok-{auth[0]}"}})

    def get(url, headers=None, params=None, **kw):
        if state.get("scoring_get_timeout") and (headers or {}).get("Authorization") == "Bearer tok-scoring":
            raise wc.requests.Timeout("scoring read timed out")
        name = (params or {}).get("q", "").removeprefix("name=")
        items = [{"id": i, "name": n} for i, n in state["agents"].items() if n == name]
        return _Resp(200, {"data": {"affected_items": items}})

    def delete(url, headers=None, params=None, **kw):
        if headers["Authorization"] != "Bearer tok-provisioner":
            return _Resp(403)
        state["delete_params"].append(params)
        for aid in params["agents_list"].split(","):
            state["agents"].pop(aid, None)
            state["deleted"].append(aid)
        return _Resp(200)

    monkeypatch.setattr(wc.requests, "post", post)
    monkeypatch.setattr(wc.requests, "get", get)
    monkeypatch.setattr(wc.requests, "delete", delete)
    monkeypatch.setattr(wc, "WAZUH_USER", "scoring")
    monkeypatch.setattr(wc, "WAZUH_PASS", "x")
    monkeypatch.setattr(wc, "WAZUH_PROVISION_USER", "provisioner")
    monkeypatch.setattr(wc, "WAZUH_PROVISION_PASS", "y")
    return state


def test_teardown_uses_the_provisioner_and_purges(api):
    wc.deregister_agents('{"meta": "008"}', "alice")

    assert "provisioner" in api["auth_users"] and "scoring" not in api["auth_users"]
    assert all(p["purge"] == "true" for p in api["delete_params"])
    # stored id + every other agent still under alice's names (incl. a duplicate)
    assert sorted(api["deleted"]) == ["008", "011", "012"]
    assert "020" in api["agents"]  # another student's agent untouched


def test_remove_by_name_frees_the_names_for_the_next_lab(api):
    removed = wc.remove_agents_named("alice")
    assert sorted(removed) == ["008", "011", "012"]
    assert not any(n.startswith("pod-alice-") for n in api["agents"].values())


def test_manager_agent_000_is_never_deleted(api):
    api["agents"]["000"] = "pod-alice-meta"  # even if a query somehow matched it
    wc.remove_agents_named("alice")
    wc.deregister_agents('{"meta": "000"}', None)
    assert "000" not in api["deleted"]


@pytest.mark.parametrize("bad", [None, "", "  ", "000", "0", "all", "001,000", "008,011", "abc", "-1", "٠٠٨"])
def test_delete_refuses_anything_but_a_single_lab_agent_id(api, bad, caplog):
    # The guard sits next to purge=true, so no future caller or bad stored id can
    # delete the manager or widen the delete into a list / `all`.
    assert wc.delete_wazuh_agent("tok-provisioner", bad) is False
    assert api["delete_params"] == []  # the API was never called
    assert "refusing to delete" in caplog.text


def test_delete_sends_exactly_one_id(api):
    assert wc.delete_wazuh_agent("tok-provisioner", " 008 ") is True
    assert api["delete_params"] == [{"agents_list": "008", "older_than": "0s", "status": "all", "purge": "true"}]


def test_scoring_token_cannot_delete(api):
    # The read-only user is what teardown used to use: it gets 403.
    with pytest.raises(wc.requests.HTTPError):
        wc.delete_wazuh_agent("tok-scoring", "008")


def test_unconfigured_provisioner_logs_and_never_raises(api, monkeypatch, caplog):
    monkeypatch.setattr(wc, "WAZUH_PROVISION_USER", "")
    wc.deregister_agents('{"meta": "008"}', "alice")  # must not raise
    assert wc.remove_agents_named("alice") == []
    assert "not configured" in caplog.text
    assert api["deleted"] == []


@pytest.fixture
def audited(monkeypatch):
    events = []
    monkeypatch.setattr(wc, "log_event", lambda *args, **kwargs: events.append((args, kwargs)))
    return events


def test_skipped_cleanup_is_audited_once_per_teardown(api, audited, monkeypatch):
    monkeypatch.setattr(wc, "WAZUH_PROVISION_USER", "")
    wc.deregister_agents('{"meta": "008"}', "alice")  # ids and a student name: still one event
    assert audited == [
        (("WAZUH_CLEANUP_SKIPPED",), {"student_id": "alice", "detail": "source=teardown reason=provisioner_not_configured"})
    ]
    assert api["deleted"] == []


def test_skipped_remove_by_name_is_audited(api, audited, monkeypatch):
    monkeypatch.setattr(wc, "WAZUH_PROVISION_PASS", "")
    assert wc.remove_agents_named("alice") == []
    assert audited == [
        (("WAZUH_CLEANUP_SKIPPED",), {"student_id": "alice", "detail": "source=remove_by_name reason=provisioner_not_configured"})
    ]


def test_nothing_to_clean_is_not_audited(api, audited, monkeypatch):
    monkeypatch.setattr(wc, "WAZUH_PROVISION_USER", "")
    wc.deregister_agents(None, None)
    assert wc.remove_agents_named("") == []
    assert audited == []


def test_configured_provisioner_writes_no_skip_event(api, audited):
    wc.deregister_agents('{"meta": "008"}', "alice")
    assert audited == []


def test_host_without_wazuh_scoring_is_not_audited(api, audited, monkeypatch):
    monkeypatch.setattr(wc, "WAZUH_PROVISION_USER", "")
    monkeypatch.setattr(wc, "WAZUH_USER", "")
    wc.deregister_agents('{"meta": "008"}', "alice")
    assert audited == []


def test_audit_failure_never_reaches_teardown(api, monkeypatch, caplog):
    monkeypatch.setattr(wc, "WAZUH_PROVISION_USER", "")

    def boom(*args, **kwargs):
        raise RuntimeError("database is locked")

    monkeypatch.setattr(wc, "log_event", boom)
    wc.deregister_agents('{"meta": "008"}', "alice")  # must not raise
    assert wc.remove_agents_named("alice") == []
    assert "could not audit skipped agent cleanup" in caplog.text


def test_unsafe_names_are_skipped(api):
    assert wc.find_agent_ids_by_name("tok", "pod-x; rm -rf /") == []


def test_unset_provisioner_with_a_visible_name_refuses_the_lab(api, monkeypatch):
    monkeypatch.setattr(wc, "WAZUH_PROVISION_USER", "")
    with pytest.raises(wc.StaleWazuhAgent) as caught:
        wc.abort_if_names_remain("alice")
    assert caught.value.ids == ["008", "011", "012"]
    assert str(caught.value) == "alice ['008', '011', '012']"
    assert api["deleted"] == []


def test_successful_purge_returns_the_removed_ids(api):
    assert wc.abort_if_names_remain("alice") == ["008", "011", "012"]
    assert not any(n.startswith("pod-alice-") for n in api["agents"].values())


def test_a_name_held_only_by_agent_000_does_not_abort(api):
    api["agents"].clear()
    api["agents"]["000"] = "pod-carol-meta"
    assert wc.abort_if_names_remain("carol") == []
    assert api["deleted"] == []


def test_scoring_auth_failure_is_not_a_stale_agent(api, monkeypatch, caplog):
    monkeypatch.setattr(wc, "WAZUH_USER", "")
    assert wc.abort_if_names_remain("alice") == ["008", "011", "012"]
    assert "WAZUH_STALE_CHECK_SKIPPED" in caplog.text
    assert "alice" in caplog.text


def test_scoring_read_timeout_still_returns_removed_ids(api, caplog):
    api["scoring_get_timeout"] = True
    assert wc.abort_if_names_remain("alice") == ["008", "011", "012"]
    assert sorted(api["deleted"]) == ["008", "011", "012"]
    assert "WAZUH_STALE_CHECK_SKIPPED" in caplog.text
    assert "scoring read timed out" in caplog.text


def test_stale_name_does_not_start_the_agent_or_mark_active(monkeypatch):
    import sys
    from unittest.mock import MagicMock

    sys.modules.setdefault("pylxd", MagicMock())
    import provision

    commands = []

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
    monkeypatch.setattr(provision, "create_pod_network", lambda pod_id: None)
    monkeypatch.setattr(provision, "log_event", lambda *args, **kwargs: None)
    monkeypatch.setattr(provision, "ensure_guest_nic_up", lambda *args, **kwargs: True)
    monkeypatch.setattr(provision, "ensure_dvwa_compose", lambda inst: True)
    monkeypatch.setattr(provision, "ensure_dvwa_ready", lambda inst: True)
    monkeypatch.setattr(provision, "add_dvwa_http_proxy", lambda name, pod_id: 8080)
    monkeypatch.setattr(provision, "wazuh_manager_ip", lambda client: "10.0.40.10")
    monkeypatch.setattr(provision.os.path, "exists", lambda path: False)

    def refuse(student_id):
        raise wc.StaleWazuhAgent(student_id, ["008"])

    monkeypatch.setattr(provision, "abort_if_names_remain", refuse)
    cleaned = []
    monkeypatch.setattr(
        provision, "cleanup_after_failure", lambda *args: cleaned.append(args)
    )

    def fail_db():
        raise AssertionError("pod row was updated")

    monkeypatch.setattr(provision, "get_db_connection", fail_db)

    provision.perform_provisioning(
        "alice",
        1,
        {"kali": "pod-alice-kali", "meta": "pod-alice-meta", "dvwa": "pod-alice-dvwa"},
        "09",
    )

    assert not any(cmd[:3] == ["systemctl", "start", "wazuh-agent"] for cmd in commands)
    assert cleaned == [("alice", 1, None, None)]


def test_enroll_handler_reraises_stale_and_swallows_other_errors():
    events = []

    def log_event(event_type, student_id=None, pod_id=None, **kwargs):
        events.append((event_type, student_id, pod_id, kwargs.get("detail")))

    def refuse():
        raise wc.StaleWazuhAgent("alice", ["008"])

    with pytest.raises(wc.StaleWazuhAgent):
        wc.finish_enroll("alice", 1, refuse, log_event, lambda message: None)
    assert events == [("WAZUH_STALE_AGENT", "alice", 1, "['008']")]

    events.clear()

    def other():
        raise RuntimeError("scoring down")

    assert wc.finish_enroll("alice", 1, other, log_event, lambda message: None) is None
    assert events[0][0] == "WAZUH_ENROLL_FAIL"

    events.clear()

    def disconnected():
        raise wc.AgentNotConnected("meta=disconnected")

    with pytest.raises(wc.AgentNotConnected):
        wc.finish_enroll("alice", 1, disconnected, log_event, lambda message: None)
    assert events[0][0] == "WAZUH_ENROLL_FAIL"
    assert "disconnected" in events[0][3]


def test_wait_for_agents_active_times_out_while_disconnected():
    clock = {"now": 0.0}

    def status(_token, agent_id):
        return "disconnected"

    def sleep(_seconds):
        clock["now"] += 5

    with pytest.raises(wc.AgentNotConnected):
        wc.wait_for_agents_active(
            "tok",
            {"meta": "3"},
            timeout_s=10,
            interval_s=5,
            status_fn=status,
            sleep_fn=sleep,
            clock=lambda: clock["now"],
        )


def test_wait_for_agents_active_returns_when_connected():
    seen = {"n": 0}

    def status(_token, _agent_id):
        seen["n"] += 1
        return "pending" if seen["n"] == 1 else "active"

    result = wc.wait_for_agents_active(
        "tok",
        {"meta": "3"},
        timeout_s=30,
        interval_s=5,
        status_fn=status,
        sleep_fn=lambda _s: None,
        clock=lambda: 0.0,
    )
    assert result == {"meta": "active"}
