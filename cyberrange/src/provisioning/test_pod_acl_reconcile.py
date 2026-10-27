"""Reconcile re-attaches and refreshes live pod egress ACLs (#285 follow-up). No live LXD."""
import pytest

import pod_net
from test_pod_egress_acl import _record

MGR = "10.0.40.10"
DNS = "10.93.10.1"
GOOD_CFG = {
    "security.acls": "pod-1-egress",
    "security.acls.default.egress.action": "reject",
    "security.acls.default.ingress.action": "allow",
    "dns.nameservers": "10.0.51.1",
}


def _rules(pid, ip=MGR, dns=DNS):
    return [dict(kv.split("=", 1) for kv in r) | {"state": "enabled", "description": ""}
            for r in pod_net.pod_acl_rules(pid, ip, dns)]


def _setup(monkeypatch, live, nets, acls, fail_on=None, active=None):
    calls = _record(monkeypatch, fail_on=fail_on)
    monkeypatch.delenv("UPLINK_DNS_IP", raising=False)
    pod_net._orphan_seen_last_sweep = set()
    monkeypatch.setattr(pod_net, "_live_pod_ids", lambda: set(live))
    monkeypatch.setattr(pod_net, "_active_pod_ids", lambda: set(live if active is None else active))

    def fake_json(*args):
        if args[:2] == ("network", "list"):
            return list(nets)
        if args[:3] == ("network", "acl", "list"):
            return list(acls)
        return []

    monkeypatch.setattr(pod_net, "_lxc_json", fake_json)
    return calls


def _writes(calls, pid=None):
    out = [c for c in calls if c[:2] == ("network", "set") or c[:3] in (
        ("network", "acl", "create"), ("network", "acl", "rule"), ("network", "acl", "delete"))]
    if pid is not None:
        out = [c for c in out if f"pod-{pid}-" in " ".join(c)]
    return out


def test_missing_acl_is_created_and_attached(monkeypatch):
    calls = _setup(monkeypatch, {1}, [{"name": "pod-1-net", "config": {}}], [])
    pod_net.reconcile_pod_networks(manager_ip=MGR)
    assert ("network", "acl", "create", "pod-1-egress") in calls
    adds = [c[6:] for c in calls if c[:4] == ("network", "acl", "rule", "add")]
    assert adds == [tuple(r) for r in pod_net.pod_acl_rules(1, MGR, DNS)]
    assert ("network", "set", "pod-1-net", "security.acls=pod-1-egress") in calls
    assert ("network", "set", "pod-1-net", "security.acls.default.egress.action=reject") in calls
    assert ("network", "set", "pod-1-net", "security.acls.default.ingress.action=allow") in calls
    assert ("network", "set", "pod-1-net", "dns.nameservers=10.0.51.1") in calls
    assert calls.index(("network", "acl", "create", "pod-1-egress")) < calls.index(
        ("network", "set", "pod-1-net", "security.acls=pod-1-egress"))


def test_stale_manager_rule_is_rewritten(monkeypatch):
    acl = {"name": "pod-1-egress", "egress": _rules(1, "10.0.40.2")}
    calls = _setup(monkeypatch, {1}, [{"name": "pod-1-net", "config": GOOD_CFG}], [acl])
    pod_net.reconcile_pod_networks(manager_ip=MGR)
    assert _writes(calls) == [
        ("network", "acl", "rule", "remove", "pod-1-egress", "egress", "action=allow", "source=",
         "destination=10.0.40.2/32", "protocol=tcp", "source_port=", "destination_port=1514,1515",
         "icmp_type=", "icmp_code=", "state=enabled", "description="),
        ("network", "acl", "rule", "add", "pod-1-egress", "egress", "action=allow",
         "destination=10.0.40.10/32", "protocol=tcp", "destination_port=1514,1515"),
    ]


def test_existing_unattached_acl_gets_attached(monkeypatch):
    acl = {"name": "pod-1-egress", "egress": _rules(1)}
    cfg = {"security.acls.default.ingress.action": "allow"}
    calls = _setup(monkeypatch, {1}, [{"name": "pod-1-net", "config": cfg}], [acl])
    pod_net.reconcile_pod_networks(manager_ip=MGR)
    assert _writes(calls) == [
        ("network", "set", "pod-1-net", "security.acls=pod-1-egress"),
        ("network", "set", "pod-1-net", "security.acls.default.egress.action=reject"),
        ("network", "set", "pod-1-net", "dns.nameservers=10.0.51.1"),
    ]


def test_correct_setup_makes_no_writes(monkeypatch):
    acl = {"name": "pod-1-egress", "egress": _rules(1)}
    calls = _setup(monkeypatch, {1}, [{"name": "pod-1-net", "config": GOOD_CFG}], [acl])
    pod_net.reconcile_pod_networks(manager_ip=MGR)
    assert _writes(calls) == []


def test_non_live_pod_is_untouched(monkeypatch):
    calls = _setup(monkeypatch, {1}, [
        {"name": "pod-1-net", "config": GOOD_CFG},
        {"name": "pod-2-net", "config": {}},
    ], [{"name": "pod-1-egress", "egress": _rules(1)}])
    pod_net.reconcile_pod_networks(manager_ip=MGR)
    assert _writes(calls, 2) == []


def test_error_on_one_pod_does_not_stop_others(monkeypatch):
    calls = _setup(monkeypatch, {1, 2}, [
        {"name": "pod-1-net", "config": {}},
        {"name": "pod-2-net", "config": {}},
    ], [], fail_on=("network", "acl", "create", "pod-1-egress"))
    pod_net.reconcile_pod_networks(manager_ip=MGR)
    assert ("network", "acl", "create", "pod-2-egress") in calls
    assert ("network", "set", "pod-2-net", "security.acls=pod-2-egress") in calls
    assert _writes(calls, 1) == [("network", "acl", "create", "pod-1-egress")]


@pytest.mark.parametrize("bad", ["10.0.40.1", "8.8.8.8", "not-an-ip"])
def test_bad_manager_ip_skips_refresh(monkeypatch, bad):
    calls = _setup(monkeypatch, {1}, [{"name": "pod-1-net", "config": {}}],
                   [{"name": "pod-1-egress", "egress": _rules(1)}, {"name": "pod-3-egress"}])
    pod_net.reconcile_pod_networks(manager_ip=bad)
    # orphan cleanup still runs; no refresh writes for the live pod
    assert _writes(calls) == [("network", "acl", "delete", "pod-3-egress")]


def test_missing_dns_reject_is_restored(monkeypatch):
    rules = [r for r in _rules(1) if not (r["action"] == "reject" and r.get("destination_port") == "53"
                                          and r.get("protocol") == "udp")]
    acl = {"name": "pod-1-egress", "egress": rules}
    calls = _setup(monkeypatch, {1}, [{"name": "pod-1-net", "config": GOOD_CFG}], [acl])
    pod_net.reconcile_pod_networks(manager_ip=MGR)
    assert ("network", "get", "vmbr1", "ipv4.address") in calls
    assert _writes(calls) == [
        ("network", "acl", "rule", "add", "pod-1-egress", "egress", "action=reject",
         "destination=10.93.10.1/32", "protocol=udp", "destination_port=53"),
    ]


def test_uplink_dns_failure_skips_refresh_keeps_cleanup(monkeypatch):
    calls = _setup(monkeypatch, {1}, [{"name": "pod-1-net", "config": {}}],
                   [{"name": "pod-1-egress", "egress": _rules(1)}, {"name": "pod-3-egress"}],
                   fail_on=("network", "get", "vmbr1"))
    pod_net.reconcile_pod_networks(manager_ip=MGR)
    assert _writes(calls) == [("network", "acl", "delete", "pod-3-egress")]


def test_missing_gateway_reject_is_restored(monkeypatch):
    # A rule with no protocol or port compares cleanly against LXD's output.
    rules = [r for r in _rules(1) if r["destination"] != "10.0.51.1/32"]
    for r in rules:
        r.setdefault("protocol", "")
        r.setdefault("destination_port", "")
    calls = _setup(monkeypatch, {1}, [{"name": "pod-1-net", "config": GOOD_CFG}],
                   [{"name": "pod-1-egress", "egress": rules}])
    pod_net.reconcile_pod_networks(manager_ip=MGR)
    assert _writes(calls) == [
        ("network", "acl", "rule", "add", "pod-1-egress", "egress", "action=reject",
         "destination=10.0.51.1/32"),
    ]


def _live_read(monkeypatch, fn):
    import provision
    monkeypatch.setattr(provision, "wazuh_manager_ip", fn)
    monkeypatch.setattr(pod_net, "LXD_PROJECT", "default", raising=False)
    import pylxd
    monkeypatch.setattr(pylxd, "Client", lambda **kw: object())


def _boom(c, strict=False):
    raise RuntimeError("lxd down")


def test_failed_live_read_no_pin_skips_refresh_keeps_cleanup(monkeypatch):
    _live_read(monkeypatch, _boom)
    monkeypatch.delenv("WAZUH_MANAGER_IP", raising=False)
    acl = {"name": "pod-1-egress", "egress": _rules(1, "10.0.40.2")}
    calls = _setup(monkeypatch, {1}, [{"name": "pod-1-net", "config": {}}],
                   [acl, {"name": "pod-3-egress"}])
    pod_net.reconcile_pod_networks()
    # the correct-for-the-live-manager .2 rule is never rewritten to a guess
    assert _writes(calls) == [("network", "acl", "delete", "pod-3-egress")]
    assert pod_net._sweep_manager_ip() is None


def test_failed_live_read_uses_env_pin(monkeypatch):
    _live_read(monkeypatch, _boom)
    monkeypatch.setenv("WAZUH_MANAGER_IP", "10.0.40.20")
    assert pod_net._sweep_manager_ip() == "10.0.40.20"
    assert pod_net._sweep_manager_ip("10.0.40.30") == "10.0.40.30"


def test_successful_live_read_is_used(monkeypatch):
    seen = {}

    def live(c, strict=False):
        seen["strict"] = strict
        return "10.0.40.2"

    _live_read(monkeypatch, live)
    monkeypatch.delenv("WAZUH_MANAGER_IP", raising=False)
    assert pod_net._sweep_manager_ip() == "10.0.40.2"
    assert seen["strict"] is True


def test_default_fallback_is_never_used(monkeypatch):
    # The real lookup with a failing state() call: non-strict returns .10,
    # strict must raise, so the sweep skips instead of using .10.
    import provision

    class Inst:
        def state(self):
            raise RuntimeError("state failed")

    class Client:
        class instances:
            @staticmethod
            def get(name):
                return Inst()

    monkeypatch.delenv("WAZUH_MANAGER_IP", raising=False)
    assert provision.wazuh_manager_ip(Client()) == MGR  # provisioning unchanged
    with pytest.raises(RuntimeError):
        provision.wazuh_manager_ip(Client(), strict=True)
    import pylxd
    monkeypatch.setattr(pylxd, "Client", lambda **kw: Client())
    assert pod_net._sweep_manager_ip() is None


def _lxd_rule_remove(monkeypatch, calls, egress):
    """Apply LXD 5.21's rule remove: subset match on the keys given, error on
    more than one match unless --force (lxc/network_acl.go isFilterMatch)."""
    import subprocess
    inner = pod_net._lxc

    def fake(*args, check=False, timeout=120):
        if args[:4] != ("network", "acl", "rule", "remove"):
            return inner(*args, check=check, timeout=timeout)
        calls.append(args)
        rest = list(args[4:])
        force = "--force" in rest
        rest = [a for a in rest if a != "--force"]
        filters = dict(kv.split("=", 1) for kv in rest[2:])
        hits = [r for r in egress if all(str(r.get(k) or "") == v for k, v in filters.items())]
        if not hits or (len(hits) > 1 and not force):
            raise RuntimeError("Multiple rules match" if hits else "No matching rule(s) found")
        for r in hits:
            egress.remove(r)
        return subprocess.CompletedProcess(args, 0, "", "")

    monkeypatch.setattr(pod_net, "_lxc", fake)


def test_bare_allow_is_removed_with_a_unique_filter(monkeypatch):
    egress = _rules(1) + [{"action": "allow", "state": "enabled", "description": ""}]
    calls = _setup(monkeypatch, {1}, [{"name": "pod-1-net", "config": {}}],
                   [{"name": "pod-1-egress", "egress": list(egress)}])
    _lxd_rule_remove(monkeypatch, calls, egress)
    pod_net.reconcile_pod_networks(manager_ip=MGR)
    assert egress == _rules(1)  # only the bare allow went
    # the sweep went on to re-attach
    assert ("network", "set", "pod-1-net", "security.acls=pod-1-egress") in calls


def test_partial_filter_would_match_several_rules():
    # Why the full filter: action=allow alone matches all three allows.
    egress = _rules(1) + [{"action": "allow", "state": "enabled"}]
    assert sum(r["action"] == "allow" for r in egress) == 3


def test_exact_duplicate_stale_rules_are_removed_once_with_force(monkeypatch):
    dup = {"action": "allow", "destination": "0.0.0.0/0", "state": "enabled", "description": ""}
    egress = _rules(1) + [dict(dup), dict(dup)]
    calls = _setup(monkeypatch, {1}, [{"name": "pod-1-net", "config": GOOD_CFG}],
                   [{"name": "pod-1-egress", "egress": list(egress)}])
    _lxd_rule_remove(monkeypatch, calls, egress)
    pod_net.reconcile_pod_networks(manager_ip=MGR)
    removes = [c for c in calls if c[:4] == ("network", "acl", "rule", "remove")]
    assert len(removes) == 1 and "--force" in removes[0]
    assert egress == _rules(1)


def test_disabled_gateway_reject_is_replaced(monkeypatch):
    rules = _rules(1)
    rules[-1]["state"] = "disabled"
    calls = _setup(monkeypatch, {1}, [{"name": "pod-1-net", "config": GOOD_CFG}],
                   [{"name": "pod-1-egress", "egress": rules}])
    pod_net.reconcile_pod_networks(manager_ip=MGR)
    w = _writes(calls)
    assert [c[3] for c in w] == ["remove", "add"]
    assert "state=disabled" in w[0] and "destination=10.0.51.1/32" in w[0]
    assert w[1][6:] == ("action=reject", "destination=10.0.51.1/32")


def test_source_narrowed_dns_reject_is_replaced(monkeypatch):
    rules = _rules(1)
    rules[2]["source"] = "10.0.51.99/32"
    calls = _setup(monkeypatch, {1}, [{"name": "pod-1-net", "config": GOOD_CFG}],
                   [{"name": "pod-1-egress", "egress": rules}])
    pod_net.reconcile_pod_networks(manager_ip=MGR)
    w = _writes(calls)
    assert [c[3] for c in w] == ["remove", "add"]
    assert "source=10.0.51.99/32" in w[0]


def test_foreign_acl_is_detached(monkeypatch, caplog):
    cfg = dict(GOOD_CFG, **{"security.acls": "pod-1-egress,allow-all"})
    calls = _setup(monkeypatch, {1}, [{"name": "pod-1-net", "config": cfg}],
                   [{"name": "pod-1-egress", "egress": _rules(1)}])
    with caplog.at_level("WARNING", logger="provision_api"):
        pod_net.reconcile_pod_networks(manager_ip=MGR)
    assert _writes(calls) == [("network", "set", "pod-1-net", "security.acls=pod-1-egress")]
    assert "allow-all" in caplog.text


@pytest.mark.parametrize("status_active", [set(), {2}])
def test_destroying_or_provisioning_pod_gets_no_writes(monkeypatch, status_active):
    # pod 1 is still live (DESTROYING/PROVISIONING) but not ACTIVE; its ACL is
    # already gone mid-teardown. No recreate, no network set.
    calls = _setup(monkeypatch, {1}, [{"name": "pod-1-net", "config": GOOD_CFG}], [],
                   active=status_active)
    pod_net.reconcile_pod_networks(manager_ip=MGR)
    assert _writes(calls, 1) == []


def test_active_lookup_failure_skips_refresh_keeps_cleanup(monkeypatch):
    calls = _setup(monkeypatch, {1}, [{"name": "pod-1-net", "config": {}}],
                   [{"name": "pod-3-egress"}])

    def boom():
        raise RuntimeError("db locked")

    monkeypatch.setattr(pod_net, "_active_pod_ids", boom)
    pod_net.reconcile_pod_networks(manager_ip=MGR)
    assert _writes(calls) == [("network", "acl", "delete", "pod-3-egress")]


def test_active_pod_ids_reads_only_active(monkeypatch):
    import sqlite3
    import db

    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("CREATE TABLE pods (pod_id INTEGER, status TEXT)")
    conn.executemany("INSERT INTO pods VALUES (?, ?)", [
        (1, "ACTIVE"), (2, "DESTROYING"), (3, "PROVISIONING"), (4, "DESTROYED")])

    class Keep:
        def __getattr__(self, n):
            return getattr(conn, n)

        def close(self):
            pass

    monkeypatch.setattr(db, "get_db_connection", lambda: Keep())
    assert pod_net._active_pod_ids() == {1}
    assert pod_net._live_pod_ids() == {1, 2, 3}
