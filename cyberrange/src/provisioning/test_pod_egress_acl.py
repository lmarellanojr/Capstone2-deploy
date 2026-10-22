"""Pod egress ACL (#285): created, attached, cleaned up, reconciled. No live LXD."""
import subprocess

import pytest

import pod_net


def _completed(args, rc=0):
    return subprocess.CompletedProcess(args, rc, "", "")


def _record(monkeypatch, fail_on=None):
    """Patch _lxc/_lxc_peer/route helpers; return the ordered call log."""
    calls = []

    def fake_lxc(*args, check=False, timeout=120):
        calls.append(args)
        if fail_on and args[: len(fail_on)] == fail_on:
            raise RuntimeError(f"lxc {' '.join(args)} failed")
        return _completed(args)

    def fake_peer(action, *args, check=False, timeout=120):
        calls.append(("peer", action, *args))
        return _completed(args)

    monkeypatch.setattr(pod_net, "_lxc", fake_lxc)
    monkeypatch.setattr(pod_net, "_lxc_peer", fake_peer)
    monkeypatch.setattr(pod_net, "ensure_manager_pod_route", lambda pid: calls.append(("route", pid)))
    monkeypatch.setattr(pod_net, "delete_manager_pod_route", lambda pid: calls.append(("unroute", pid)))
    return calls


def _net_create(calls):
    return next(c for c in calls if c[:2] == ("network", "create"))


def test_acl_name():
    assert pod_net.pod_acl_name(1) == "pod-1-egress"
    with pytest.raises(AssertionError):
        pod_net.pod_acl_name(7)


def test_rules_allow_only_own_subnet_and_agent_ports():
    rules = pod_net.pod_acl_rules(2, "10.0.40.10")
    assert rules == [
        ["action=allow", "destination=10.0.52.0/24"],
        [
            "action=allow",
            "destination=10.0.40.10/32",
            "protocol=tcp",
            "destination_port=1514,1515",
        ],
    ]
    flat = " ".join(" ".join(r) for r in rules)
    for blocked in ("55000", "port=22", "0.0.0.0/0", "action=reject", "action=drop"):
        assert blocked not in flat


def test_create_makes_acl_before_network_and_attaches_it(monkeypatch):
    calls = _record(monkeypatch)

    pod_net.create_pod_network(1, manager_ip="10.0.40.10")

    acl_create = calls.index(("network", "acl", "create", "pod-1-egress"))
    net_create = calls.index(_net_create(calls))
    rule_adds = [i for i, c in enumerate(calls) if c[:3] == ("network", "acl", "rule")]
    assert len(rule_adds) == 2
    assert acl_create < min(rule_adds) and max(rule_adds) < net_create
    assert all(calls[i][3:6] == ("add", "pod-1-egress", "egress") for i in rule_adds)

    net = _net_create(calls)
    assert "security.acls=pod-1-egress" in net
    assert "security.acls.default.egress.action=reject" in net
    assert "security.acls.default.ingress.action=allow" in net


def test_create_uses_the_resolved_manager_ip(monkeypatch):
    calls = _record(monkeypatch)

    pod_net.create_pod_network(1, manager_ip="10.0.40.2")

    rules = [c for c in calls if c[:3] == ("network", "acl", "rule")]
    assert "destination=10.0.40.2/32" in rules[1]


def test_create_falls_back_to_env_then_default(monkeypatch):
    calls = _record(monkeypatch)
    monkeypatch.setenv("WAZUH_MANAGER_IP", "10.0.40.7")
    pod_net.create_pod_network(1)
    assert "destination=10.0.40.7/32" in [c for c in calls if c[:3] == ("network", "acl", "rule")][1]

    calls = _record(monkeypatch)
    monkeypatch.delenv("WAZUH_MANAGER_IP")
    pod_net.create_pod_network(1)
    assert "destination=10.0.40.10/32" in [c for c in calls if c[:3] == ("network", "acl", "rule")][1]


@pytest.mark.parametrize(
    "fail_on",
    [("network", "acl", "create"), ("network", "acl", "rule"), ("network", "create")],
)
def test_partial_create_raises_and_delete_leaves_no_acl(monkeypatch, fail_on):
    calls = _record(monkeypatch, fail_on=fail_on)

    with pytest.raises(RuntimeError):
        pod_net.create_pod_network(1, manager_ip="10.0.40.10")
    # A failed create never peers or routes an unprotected network.
    assert not any(c[0] in ("peer", "route") for c in calls)

    # provision.cleanup_after_failure calls delete_pod_network next.
    calls = _record(monkeypatch)
    pod_net.delete_pod_network(1)
    assert ("network", "acl", "delete", "pod-1-egress") in calls


def test_delete_removes_network_before_acl(monkeypatch):
    calls = _record(monkeypatch)

    pod_net.delete_pod_network(1)

    net_del = calls.index(("network", "delete", "pod-1-net"))
    acl_del = calls.index(("network", "acl", "delete", "pod-1-egress"))
    assert net_del < acl_del


def _json_for(nets=(), acls=()):
    def fake_json(*args):
        if args[:2] == ("network", "list"):
            return list(nets)
        if args[:3] == ("network", "acl", "list"):
            return list(acls)
        return []

    return fake_json


def test_reconcile_keeps_acl_for_live_pod(monkeypatch):
    calls = _record(monkeypatch)
    pod_net._orphan_seen_last_sweep = set()
    monkeypatch.setattr(pod_net, "_live_pod_ids", lambda: {1})
    monkeypatch.setattr(pod_net, "_lxc_json", _json_for(acls=[{"name": "pod-1-egress"}]))

    pod_net.reconcile_pod_networks()

    assert ("network", "acl", "delete", "pod-1-egress") not in calls


def test_reconcile_deletes_orphan_acl(monkeypatch):
    calls = _record(monkeypatch)
    pod_net._orphan_seen_last_sweep = set()
    monkeypatch.setattr(pod_net, "_live_pod_ids", lambda: {1})
    monkeypatch.setattr(
        pod_net,
        "_lxc_json",
        _json_for(acls=[{"name": "pod-1-egress"}, {"name": "pod-2-egress"}, {"name": "other"}]),
    )

    pod_net.reconcile_pod_networks()

    deletes = [c for c in calls if c[:3] == ("network", "acl", "delete")]
    assert deletes == [("network", "acl", "delete", "pod-2-egress")]


def test_reconcile_orphan_network_removes_its_acl_after_two_sweeps(monkeypatch):
    calls = _record(monkeypatch)
    pod_net._orphan_seen_last_sweep = set()
    monkeypatch.setattr(pod_net, "_live_pod_ids", lambda: set())
    monkeypatch.setattr(pod_net, "_lxc_json", _json_for(nets=[{"name": "pod-3-net"}]))

    pod_net.reconcile_pod_networks()
    assert ("network", "acl", "delete", "pod-3-egress") not in calls

    pod_net.reconcile_pod_networks()
    assert calls.index(("network", "delete", "pod-3-net")) < calls.index(
        ("network", "acl", "delete", "pod-3-egress")
    )
