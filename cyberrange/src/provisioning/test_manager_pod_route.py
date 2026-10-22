"""Manager return route for each pod subnet. No live LXD."""
import subprocess

import pytest

import pod_net


def _completed(args, rc=0):
    return subprocess.CompletedProcess(args, rc, "", "")


def test_pod_routes():
    assert pod_net.manager_pod_route(1) == "10.0.51.0/24"
    assert pod_net.manager_pod_route(2) == "10.0.52.0/24"


def test_ensure_exec_targets_manager_in_default_project(monkeypatch):
    seen = {}

    def fake_run(cmd, capture_output, text, timeout):
        seen["cmd"] = cmd
        return _completed(cmd)

    monkeypatch.setattr(pod_net, "LXD_PROJECT", "default")
    monkeypatch.delenv("WAZUH_MANAGER_INSTANCE", raising=False)
    monkeypatch.setattr(pod_net.subprocess, "run", fake_run)

    pod_net.ensure_manager_pod_route(1)

    cmd = seen["cmd"]
    assert cmd == [
        "lxc",
        "--project",
        "default",
        "exec",
        "wazuh-manager",
        "--",
        "ip",
        "route",
        "replace",
        "10.0.51.0/24",
        "via",
        "10.0.40.1",
        "dev",
        "eth0",
    ]
    assert not any(part.endswith("-net") for part in cmd)


def test_create_calls_ensure_once_after_both_peers(monkeypatch):
    order = []

    def fake_lxc(*args, check=False, timeout=120):
        order.append(args)
        return _completed(args)

    def fake_peer(action, *args, check=False, timeout=120):
        order.append((action, args))
        return _completed(args)

    monkeypatch.setattr(pod_net, "_lxc", fake_lxc)
    monkeypatch.setattr(pod_net, "_lxc_peer", fake_peer)
    monkeypatch.setenv("UPLINK_DNS_IP", "10.93.10.1")

    pod_net.create_pod_network(1)

    execs = [args for args in order if isinstance(args, tuple) and args and args[0] == "exec"]
    peers = [item for item in order if isinstance(item, tuple) and item and item[0] == "create"]
    assert len(execs) == 1
    assert execs[0][1] == "wazuh-manager"
    assert "10.0.51.0/24" in execs[0]
    assert len(peers) == 2
    assert order[-1][0] == "exec"


def test_create_does_not_retry_a_route_error(monkeypatch):
    peers = []

    def fake_lxc(*args, check=False, timeout=120):
        if args and args[0] == "exec":
            raise RuntimeError("route down")
        return _completed(args)

    def fake_peer(action, *args, check=False, timeout=120):
        peers.append((action, args))
        return _completed(args)

    monkeypatch.setattr(pod_net, "_lxc", fake_lxc)
    monkeypatch.setattr(pod_net, "_lxc_peer", fake_peer)
    monkeypatch.setenv("UPLINK_DNS_IP", "10.93.10.1")

    with pytest.raises(RuntimeError, match="route down"):
        pod_net.create_pod_network(1)
    assert len(peers) == 2


def test_delete_still_removes_peers_when_route_delete_returns_nonzero(monkeypatch):
    peers = []

    def fake_lxc(*args, check=False, timeout=120):
        return _completed(args, rc=2)

    def fake_peer(action, *args, check=False, timeout=120):
        peers.append((action, args))
        return _completed(args)

    monkeypatch.setattr(pod_net, "_lxc", fake_lxc)
    monkeypatch.setattr(pod_net, "_lxc_peer", fake_peer)

    pod_net.delete_pod_network(1)
    assert ("delete", ("pod-1-net", "to-mon")) in peers
    assert ("delete", ("mon-net", "from-pod-1")) in peers


def test_delete_still_removes_peers_when_route_delete_times_out(monkeypatch):
    peers = []

    def fake_lxc(*args, check=False, timeout=120):
        if args and args[0] == "exec":
            raise subprocess.TimeoutExpired(cmd=args, timeout=timeout)
        return _completed(args)

    def fake_peer(action, *args, check=False, timeout=120):
        peers.append((action, args))
        return _completed(args)

    monkeypatch.setattr(pod_net, "_lxc", fake_lxc)
    monkeypatch.setattr(pod_net, "_lxc_peer", fake_peer)

    pod_net.delete_pod_network(1)
    assert ("delete", ("pod-1-net", "to-mon")) in peers
    assert ("delete", ("mon-net", "from-pod-1")) in peers


def _json_for(peers):
    def fake_json(*args):
        if args[:3] == ("network", "peer", "list"):
            return peers
        return []

    return fake_json


def test_reconcile_ensures_only_while_peer_exists(monkeypatch):
    ensured = []
    pod_net._orphan_seen_last_sweep = set()
    monkeypatch.setattr(pod_net, "_live_pod_ids", lambda: {1})
    monkeypatch.setattr(pod_net, "_lxc_json", _json_for([{"name": "from-pod-1"}]))
    monkeypatch.setattr(pod_net, "_lxc", lambda *a, **k: _completed(a))
    monkeypatch.setattr(pod_net, "_lxc_peer", lambda *a, **k: _completed(a))
    monkeypatch.setattr(pod_net, "ensure_manager_pod_route", lambda pid: ensured.append(pid))

    pod_net.reconcile_pod_networks()
    assert ensured == [1]


def test_reconcile_ignores_a_live_row_with_no_peer(monkeypatch):
    ensured = []
    pod_net._orphan_seen_last_sweep = set()
    monkeypatch.setattr(pod_net, "_live_pod_ids", lambda: {1})
    monkeypatch.setattr(pod_net, "_lxc_json", _json_for([]))
    monkeypatch.setattr(pod_net, "_lxc", lambda *a, **k: _completed(a))
    monkeypatch.setattr(pod_net, "_lxc_peer", lambda *a, **k: _completed(a))
    monkeypatch.setattr(pod_net, "ensure_manager_pod_route", lambda pid: ensured.append(pid))

    pod_net.reconcile_pod_networks()
    assert ensured == []


def test_reconcile_deletes_route_for_orphan_peer(monkeypatch):
    deleted = []
    peers = []
    pod_net._orphan_seen_last_sweep = set()
    monkeypatch.setattr(pod_net, "_live_pod_ids", lambda: set())
    monkeypatch.setattr(pod_net, "_lxc_json", _json_for([{"name": "from-pod-1"}]))
    monkeypatch.setattr(pod_net, "_lxc", lambda *a, **k: _completed(a))

    def fake_peer(action, *args, check=False, timeout=120):
        peers.append((action, args))
        return _completed(args)

    monkeypatch.setattr(pod_net, "_lxc_peer", fake_peer)
    monkeypatch.setattr(pod_net, "delete_manager_pod_route", lambda pid: deleted.append(pid))
    monkeypatch.setattr(
        pod_net,
        "ensure_manager_pod_route",
        lambda pid: (_ for _ in ()).throw(AssertionError(f"ensured orphan {pid}")),
    )

    pod_net.reconcile_pod_networks()
    assert deleted == [1]
    assert ("delete", ("mon-net", "from-pod-1")) in peers


def test_reconcile_swallows_ensure_errors(monkeypatch):
    pod_net._orphan_seen_last_sweep = set()
    monkeypatch.setattr(pod_net, "_live_pod_ids", lambda: {1})
    monkeypatch.setattr(pod_net, "_lxc_json", _json_for([{"name": "from-pod-1"}]))
    monkeypatch.setattr(pod_net, "_lxc", lambda *a, **k: _completed(a))
    monkeypatch.setattr(pod_net, "_lxc_peer", lambda *a, **k: _completed(a))

    def boom(pid):
        raise RuntimeError("manager down")

    monkeypatch.setattr(pod_net, "ensure_manager_pod_route", boom)
    pod_net.reconcile_pod_networks()
