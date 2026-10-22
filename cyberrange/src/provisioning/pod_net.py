"""Per-pod OVN network helpers (LXD CLI)."""
import ipaddress
import json
import logging
import os
import re
import subprocess
from typing import List

logger = logging.getLogger("provision_api")

LXD_PROJECT = os.getenv("LXD_PROJECT", "default")

# Peer create/delete can hang for non-root LXD unix clients on some hosts (120s
# timeout) while the same ops succeed as root. Route peer create/delete through
# a restricted passwordless sudo wrapper installed on the host:
#   /usr/local/sbin/cyberrange-lxc-peer
#   /etc/sudoers.d/cyberrange-ovn-peer
_PEER_WRAPPER = os.getenv("CYBERRANGE_PEER_WRAPPER", "/usr/local/sbin/cyberrange-lxc-peer")

_orphan_seen_last_sweep: set = set()


def pod_net_name(pod_id: int) -> str:
    assert 1 <= pod_id <= 6, f"pod_id must be 1-6, got {pod_id}"
    return f"pod-{pod_id}-net"


def pod_subnet(pod_id: int) -> str:
    return f"10.0.{50 + pod_id}"


def pod_acl_name(pod_id: int) -> str:
    assert 1 <= pod_id <= 6, f"pod_id must be 1-6, got {pod_id}"
    return f"pod-{pod_id}-egress"


# Agent enrolment (1515) and event delivery (1514). Everything else leaving a
# pod that is not inside its own subnet is rejected: internet, host SSH, and
# the Wazuh API on 55000 (#285).
WAZUH_AGENT_PORTS = "1514,1515"
DEFAULT_WAZUH_MANAGER_IP = "10.0.40.10"


def pod_acl_rules(pod_id: int, manager_ip: str) -> List[List[str]]:
    """Egress allow rules; the network's default egress action rejects the rest."""
    return [
        ["action=allow", f"destination={manager_pod_route(pod_id)}"],
        [
            "action=allow",
            f"destination={manager_ip}/32",
            "protocol=tcp",
            f"destination_port={WAZUH_AGENT_PORTS}",
        ],
    ]


# mon-net gateway. Manual 02 sets ipv4.address=10.0.40.1/24 and pins the
# manager's own eth0 address at 10.0.40.10. The manager's default route is
# lxdbr0 (eth1), so a pod packet arrives on eth0 and the reply is lost unless
# this route exists inside the manager. wazuh_manager_ip() reads the .10
# address; it is not this gateway.
MON_NET_GATEWAY = "10.0.40.1"
MON_NET_DEV = "eth0"


def _manager_instance() -> str:
    return os.getenv("WAZUH_MANAGER_INSTANCE", "wazuh-manager")


def manager_pod_route(pod_id: int) -> str:
    assert 1 <= pod_id <= 6, f"pod_id must be 1-6, got {pod_id}"
    return f"{pod_subnet(pod_id)}.0/24"


def ensure_manager_pod_route(pod_id: int):
    """Install the return route. Raises on failure so provision can roll back."""
    cidr = manager_pod_route(pod_id)
    _lxc(
        "exec",
        _manager_instance(),
        "--",
        "ip",
        "route",
        "replace",
        cidr,
        "via",
        MON_NET_GATEWAY,
        "dev",
        MON_NET_DEV,
        check=True,
    )


def delete_manager_pod_route(pod_id: int):
    """Drop the return route. A missing route or a timeout must not block teardown."""
    try:
        cidr = manager_pod_route(pod_id)
        _lxc(
            "exec",
            _manager_instance(),
            "--",
            "ip",
            "route",
            "del",
            cidr,
            check=False,
        )
    except Exception as e:
        logger.warning(f"manager route delete for pod {pod_id} ignored: {e}")


def _lxc(*args, check=False, timeout=120):
    r = subprocess.run(
        ["lxc", "--project", LXD_PROJECT, *args],
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    if r.returncode != 0:
        err_msg = r.stderr.strip()[:200]
        if check:
            raise RuntimeError(f"lxc {' '.join(args)} failed: {err_msg}")
        logger.warning(f"lxc {' '.join(args)} rc={r.returncode}: {err_msg}")
    return r


def _lxc_peer(action: str, *args, check=False, timeout=120):
    """network peer create|delete via root wrapper (passwordless sudo)."""
    cmd = ["sudo", "-n", _PEER_WRAPPER, action, *args]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if r.returncode != 0:
        err_msg = (r.stderr or r.stdout or "").strip()[:300]
        if check:
            raise RuntimeError(f"lxc peer {action} {' '.join(args)} failed: {err_msg}")
        logger.warning(f"lxc peer {action} {' '.join(args)} rc={r.returncode}: {err_msg}")
    return r


def _lxc_json(*args) -> List:
    r = _lxc(*args, "--format", "json")
    if not r.stdout:
        return []
    try:
        data = json.loads(r.stdout)
        return data if isinstance(data, list) else []
    except json.JSONDecodeError:
        logger.warning(f"reconciler: could not parse JSON from lxc {' '.join(args)}")
        return []


_MON_SUBNET = ipaddress.ip_network("10.0.40.0/24")
_MON_GATEWAY = ipaddress.ip_address("10.0.40.1")


def _check_manager_ip(manager_ip: str) -> str:
    """The 1514/1515 rule must target one host inside the monitoring subnet."""
    try:
        addr = ipaddress.ip_address(manager_ip)
    except ValueError:
        raise ValueError(f"manager address {manager_ip!r} is not a valid IPv4 address")
    if addr.version != 4 or addr not in _MON_SUBNET:
        raise ValueError(f"manager address {manager_ip} is outside {_MON_SUBNET}")
    if addr in (_MON_GATEWAY, _MON_SUBNET.network_address, _MON_SUBNET.broadcast_address):
        raise ValueError(f"manager address {manager_ip} is the gateway, network or broadcast address")
    return str(addr)


def create_pod_network(pod_id: int, manager_ip: str = None):
    net = pod_net_name(pod_id)
    sub = pod_subnet(pod_id)
    acl = pod_acl_name(pod_id)
    manager_ip = manager_ip or os.getenv("WAZUH_MANAGER_IP", "").strip() or DEFAULT_WAZUH_MANAGER_IP
    manager_ip = _check_manager_ip(manager_ip)

    # ACL first, then the network created with it attached, so the network is
    # never up without it. A failure here raises; delete_pod_network removes
    # whatever was made.
    _lxc("network", "acl", "create", acl, check=True)
    for rule in pod_acl_rules(pod_id, manager_ip):
        _lxc("network", "acl", "rule", "add", acl, "egress", *rule, check=True)

    # Ingress stays open: consoles, the DVWA proxy and scoring reach in from
    # the host, and replies to allowed egress are tracked by OVN.
    _lxc(
        "network",
        "create",
        net,
        "--type=ovn",
        "network=vmbr1",
        f"ipv4.address={sub}.1/24",
        "ipv4.nat=true",
        "ipv6.address=none",
        f"security.acls={acl}",
        "security.acls.default.egress.action=reject",
        "security.acls.default.ingress.action=allow",
        check=True,
    )

    for attempt in range(3):
        try:
            _lxc_peer("create", net, "to-mon", "mon-net", check=True)
            _lxc_peer("create", "mon-net", f"from-pod-{pod_id}", net, check=True)
            break
        except (RuntimeError, subprocess.TimeoutExpired) as e:
            if attempt == 2:
                raise
            logger.warning(f"Peer create attempt {attempt + 1} failed, retrying: {e}")
            import time

            time.sleep(5)

    # After the retry loop, not inside it. A route error must reach
    # cleanup_after_failure rather than being retried as a peer failure.
    ensure_manager_pod_route(pod_id)
    logger.info(f"Pod network {net} created with {acl} and peered to mon-net")


def delete_pod_network(pod_id: int):
    net = pod_net_name(pod_id)
    acl = pod_acl_name(pod_id)

    delete_manager_pod_route(pod_id)
    _lxc_peer("delete", net, "to-mon")
    _lxc_peer("delete", "mon-net", f"from-pod-{pod_id}")
    # Network before ACL: LXD refuses to delete an ACL a network still uses.
    _lxc("network", "delete", net)
    _lxc("network", "acl", "delete", acl)

    logger.info(f"Pod network {net}, {acl} and peers deleted")


def _live_pod_ids() -> set:
    from db import get_db_connection

    conn = get_db_connection()
    try:
        rows = conn.execute(
            "SELECT pod_id FROM pods WHERE status NOT IN ('DESTROYED','FAILED_ROLLBACK_COMPLETE')"
        ).fetchall()
    finally:
        conn.close()
    return {r["pod_id"] for r in rows}


def reconcile_pod_networks():
    global _orphan_seen_last_sweep
    try:
        live = _live_pod_ids()

        nets = _lxc_json("network", "list")
        pod_nets = [
            (int(m.group(1)), n.get("name", ""))
            for n in nets
            for m in [re.fullmatch(r"pod-(\d+)-net", n.get("name", ""))]
            if m
        ]
        logger.info(f"[reconciler] enumerated {len(pod_nets)} pod-*-net of {len(nets)} networks")

        orphan_now = {pid for pid, _ in pod_nets if pid not in live}
        confirmed = orphan_now & _orphan_seen_last_sweep
        _orphan_seen_last_sweep = orphan_now

        for pid in confirmed:
            if 1 <= pid <= 6:
                logger.info(f"[reconciler] confirmed-orphan network pod-{pid}-net (2 sweeps) — deleting")
                delete_pod_network(pid)
            else:
                logger.warning(f"[reconciler] out-of-range network pod-{pid}-net — raw deleting")
                _lxc("network", "delete", f"pod-{pid}-net")

        peers = _lxc_json("network", "peer", "list", "mon-net")
        pod_peers = [
            (int(m.group(1)), p.get("name", ""))
            for p in peers
            for m in [re.fullmatch(r"from-pod-(\d+)", p.get("name", ""))]
            if m
        ]
        logger.info(f"[reconciler] enumerated {len(pod_peers)} from-pod-* of {len(peers)} mon-net peers")
        for pid, _ in pod_peers:
            if pid not in live:
                logger.info(f"[reconciler] orphaned mon-net peer from-pod-{pid} — deleting")
                delete_manager_pod_route(pid)
                _lxc_peer("delete", "mon-net", f"from-pod-{pid}")
                continue
            if not 1 <= pid <= 6:
                continue
            try:
                ensure_manager_pod_route(pid)
            except Exception as e:
                logger.error(f"[reconciler] sweep error: manager route for pod {pid}: {e}")

        acls = _lxc_json("network", "acl", "list")
        pod_acls = [
            (int(m.group(1)), a.get("name", ""))
            for a in acls
            for m in [re.fullmatch(r"pod-(\d+)-egress", a.get("name", ""))]
            if m
        ]
        logger.info(f"[reconciler] enumerated {len(pod_acls)} pod-*-egress of {len(acls)} ACLs")
        for pid, _ in pod_acls:
            if pid not in live:
                logger.info(f"[reconciler] orphaned egress ACL pod-{pid}-egress — deleting")
                _lxc("network", "acl", "delete", f"pod-{pid}-egress")
    except Exception as e:
        logger.error(f"[reconciler] sweep error: {e}")