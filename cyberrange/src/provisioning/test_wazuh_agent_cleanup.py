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


def test_unsafe_names_are_skipped(api):
    assert wc.find_agent_ids_by_name("tok", "pod-x; rm -rf /") == []
