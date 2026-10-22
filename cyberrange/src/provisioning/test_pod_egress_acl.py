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
        if args == ("network", "get", "vmbr1", "ipv4.address"):
            return subprocess.CompletedProcess(args, 0, "10.93.10.1/24\n", "")
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
    rules = pod_net.pod_acl_rules(2, "10.0.40.10", "10.93.10.1")
    assert rules == [
        ["action=allow", "destination=10.0.52.0/24"],
        [
            "action=allow",
            "destination=10.0.40.10/32",
            "protocol=tcp",
            "destination_port=1514,1515",
        ],
        ["action=reject", "destination=10.93.10.1/32", "protocol=udp", "destination_port=53"],
        ["action=reject", "destination=10.93.10.1/32", "protocol=tcp", "destination_port=53"],
        ["action=reject", "destination=10.0.52.1/32"],
    ]
    allows = " ".join(" ".join(r) for r in rules if r[0] == "action=allow")
    for blocked in ("55000", "port=22", "port=53", "0.0.0.0/0", "action=drop"):
        assert blocked not in allows
    # The DNS rejects hit only the uplink resolver, never meta's port 53.
    dns_rejects = [r for r in rules if r[0] == "action=reject" and "destination_port=53" in r]
    assert len(dns_rejects) == 2
    assert all(r[1] == "destination=10.93.10.1/32" for r in dns_rejects)


@pytest.mark.parametrize("pod_id", range(1, 7))
def test_gateway_reject_is_scoped_to_the_pod_gateway(pod_id):
    sub = f"10.0.{50 + pod_id}"
    rules = pod_net.pod_acl_rules(pod_id, "10.0.40.10", "10.93.10.1")
    gw = ["action=reject", f"destination={sub}.1/32"]
    assert gw in rules
    # After the allows; the manager rule keeps index 1.
    assert rules.index(gw) > max(i for i, r in enumerate(rules) if r[0] == "action=allow")
    assert "destination=10.0.40.10/32" in rules[1]
    # Only the /32 gateway is rejected: meta's DNS (.20:53) is still allowed.
    assert [r for r in rules if r[0] == "action=reject" and f"{sub}." in r[1]] == [gw]
    assert _allow_matches(rules[0], f"{sub}.20", 53)
    assert not any(r[0] == "action=reject" and f"{sub}.20" in r[1] for r in rules)


def test_create_makes_acl_before_network_and_attaches_it(monkeypatch):
    calls = _record(monkeypatch)

    pod_net.create_pod_network(1, manager_ip="10.0.40.10")

    acl_create = calls.index(("network", "acl", "create", "pod-1-egress"))
    net_create = calls.index(_net_create(calls))
    rule_adds = [i for i, c in enumerate(calls) if c[:3] == ("network", "acl", "rule")]
    assert len(rule_adds) == 5
    assert acl_create < min(rule_adds) and max(rule_adds) < net_create
    assert all(calls[i][3:6] == ("add", "pod-1-egress", "egress") for i in rule_adds)

    net = _net_create(calls)
    assert "security.acls=pod-1-egress" in net
    assert "security.acls.default.egress.action=reject" in net
    assert "security.acls.default.ingress.action=allow" in net
    # No NAT: the only allowed egress goes to the manager over the peer route.
    assert "ipv4.nat=false" in net
    assert "ipv4.nat=true" not in net


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


def test_create_accepts_default_manager_ip(monkeypatch):
    calls = _record(monkeypatch)
    pod_net.create_pod_network(1, manager_ip="10.0.40.10")
    assert any(c[:2] == ("network", "create") for c in calls)


@pytest.mark.parametrize(
    "bad",
    ["not-an-ip", "10.0.40.10/32", "10.0.41.10", "192.168.1.10", "10.0.40.1", "10.0.40.0", "10.0.40.255", "::1"],
)
def test_create_rejects_bad_manager_ip_before_any_lxc_call(monkeypatch, bad):
    calls = _record(monkeypatch)
    with pytest.raises(ValueError):
        pod_net.create_pod_network(1, manager_ip=bad)
    assert calls == []


def test_uplink_dns_read_from_vmbr1(monkeypatch):
    calls = _record(monkeypatch)
    monkeypatch.delenv("UPLINK_DNS_IP", raising=False)
    assert pod_net.uplink_dns_ip() == "10.93.10.1"
    assert calls == [("network", "get", "vmbr1", "ipv4.address")]


def test_uplink_dns_override_skips_lookup(monkeypatch):
    calls = _record(monkeypatch)
    monkeypatch.setenv("UPLINK_DNS_IP", "10.93.10.254")
    assert pod_net.uplink_dns_ip() == "10.93.10.254"
    assert pod_net.uplink_dns_ip("10.93.10.2") == "10.93.10.2"
    assert calls == []


def test_create_rejects_dns_to_the_uplink(monkeypatch):
    calls = _record(monkeypatch)
    monkeypatch.delenv("UPLINK_DNS_IP", raising=False)
    pod_net.create_pod_network(1, manager_ip="10.0.40.10")
    rules = [c for c in calls if c[:3] == ("network", "acl", "rule")]
    for proto in ("udp", "tcp"):
        assert ("network", "acl", "rule", "add", "pod-1-egress", "egress", "action=reject",
                "destination=10.93.10.1/32", f"protocol={proto}", "destination_port=53") in rules


@pytest.mark.parametrize("stdout", ["", "garbage", "10.93.10/24", "fd42::1/64"])
def test_create_fails_closed_without_a_valid_uplink(monkeypatch, stdout):
    calls = []

    def fake_lxc(*args, check=False, timeout=120):
        calls.append(args)
        return subprocess.CompletedProcess(args, 0, stdout, "")

    monkeypatch.setattr(pod_net, "_lxc", fake_lxc)
    monkeypatch.delenv("UPLINK_DNS_IP", raising=False)
    with pytest.raises(ValueError):
        pod_net.create_pod_network(1, manager_ip="10.0.40.10")
    assert calls == [("network", "get", "vmbr1", "ipv4.address")]


def test_create_fails_closed_when_uplink_lookup_errors(monkeypatch):
    calls = _record(monkeypatch, fail_on=("network", "get"))
    monkeypatch.delenv("UPLINK_DNS_IP", raising=False)
    with pytest.raises(RuntimeError):
        pod_net.create_pod_network(1, manager_ip="10.0.40.10")
    assert calls == [("network", "get", "vmbr1", "ipv4.address")]


# R-2 targets from the risk assessment: portal, provisioning API, Keycloak,
# the SSH bridge, and the manager's SSH and API ports. No pod may reach them.
R2_TARGETS = [
    ("10.115.77.1", 5000),
    ("10.115.77.1", 3000),
    ("10.115.77.1", 8765),
    ("10.115.77.12", 80),
    ("10.0.40.10", 22),
    ("10.0.40.10", 55000),
]


def _allow_matches(rule, ip, port):
    import ipaddress

    r = dict(kv.split("=", 1) for kv in rule)
    if r.get("action") != "allow":
        return False
    if "destination" in r and ipaddress.ip_address(ip) not in ipaddress.ip_network(r["destination"]):
        return False
    if "destination_port" in r and str(port) not in r["destination_port"].split(","):
        return False
    return True


@pytest.mark.parametrize("pod_id", range(1, 7))
@pytest.mark.parametrize("ip,port", R2_TARGETS)
def test_no_allow_rule_reaches_r2_targets(pod_id, ip, port):
    rules = pod_net.pod_acl_rules(pod_id, "10.0.40.10", "10.93.10.1")
    assert [r for r in rules if _allow_matches(r, ip, port)] == []
