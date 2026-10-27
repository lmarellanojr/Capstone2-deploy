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


def pod_dns_nameservers(pod_id: int) -> str:
    """Resolver advertised to the pod via DHCP.

    Defaults to the pod's own gateway (<sub>.1). The egress ACL rejects .1/32
    and that reject fails fast, so a lookup errors immediately instead of
    stalling the way it does against the uplink resolver LXD would otherwise
    hand out (10.93.10.1), which silently drops DNS and makes nmap's reverse-DNS
    hang for minutes (#318). POD_DNS_NAMESERVERS overrides it for every pod if a
    reachable internal resolver is ever introduced -- keep it off anything that
    answers DNS, or #285's deny-by-design (R-1) reopens.
    """
    return os.getenv("POD_DNS_NAMESERVERS", "").strip() or f"{pod_subnet(pod_id)}.1"


# Agent enrolment (1515) and event delivery (1514). Everything else leaving a
# pod that is not inside its own subnet is rejected: internet, host SSH, and
# the Wazuh API on 55000 (#285).
WAZUH_AGENT_PORTS = "1514,1515"
DEFAULT_WAZUH_MANAGER_IP = "10.0.40.10"


def pod_acl_rules(pod_id: int, manager_ip: str, uplink_dns: str) -> List[List[str]]:
    """Egress rules; the network's default egress action rejects the rest.

    LXD adds its own priority-200 allow for udp/tcp 53 to the uplink resolver,
    which outranks the default reject. The explicit rejects below (priority
    400) close that DNS path out of the pod. They target only the uplink /32,
    so DNS to meta inside the pod subnet still works.

    The last reject closes the pod's own gateway (.1/32), which the own-/24
    allow would otherwise cover. A reject rule (priority 400) outranks the
    allow (300). It comes last so the manager rule keeps index 1.
    """
    return [
        ["action=allow", f"destination={manager_pod_route(pod_id)}"],
        [
            "action=allow",
            f"destination={manager_ip}/32",
            "protocol=tcp",
            f"destination_port={WAZUH_AGENT_PORTS}",
        ],
        ["action=reject", f"destination={uplink_dns}/32", "protocol=udp", "destination_port=53"],
        ["action=reject", f"destination={uplink_dns}/32", "protocol=tcp", "destination_port=53"],
        ["action=reject", f"destination={pod_subnet(pod_id)}.1/32"],
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
_MON_GATEWAY = ipaddress.ip_address(MON_NET_GATEWAY)
UPLINK_NETWORK = "vmbr1"


def uplink_dns_ip(override: str = None) -> str:
    """The uplink resolver pods are handed by LXD: vmbr1's ipv4.address.

    An explicit override, then UPLINK_DNS_IP, replace the lookup. Raises if neither gives a single IPv4
    address, so the DNS reject is never silently dropped.
    """
    raw = (override or os.getenv("UPLINK_DNS_IP", "")).strip()
    if not raw:
        r = _lxc("network", "get", UPLINK_NETWORK, "ipv4.address", check=True)
        raw = (r.stdout or "").strip().split("/")[0]
    try:
        addr = ipaddress.ip_address(raw)
    except ValueError:
        raise ValueError(f"uplink DNS address {raw!r} is not a valid IPv4 address")
    if addr.version != 4:
        raise ValueError(f"uplink DNS address {raw} is not IPv4")
    return str(addr)


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


def create_pod_network(pod_id: int, manager_ip: str = None, uplink_dns: str = None):
    net = pod_net_name(pod_id)
    sub = pod_subnet(pod_id)
    acl = pod_acl_name(pod_id)
    manager_ip = manager_ip or os.getenv("WAZUH_MANAGER_IP", "").strip() or DEFAULT_WAZUH_MANAGER_IP
    manager_ip = _check_manager_ip(manager_ip)
    uplink_dns = uplink_dns_ip(uplink_dns)

    # ACL first, then the network created with it attached, so the network is
    # never up without it. A failure here raises; delete_pod_network removes
    # whatever was made.
    _lxc("network", "acl", "create", acl, check=True)
    for rule in pod_acl_rules(pod_id, manager_ip, uplink_dns):
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
        # NAT stays on. With ipv4.nat=false LXD 5.21 requires the pod subnet in
        # vmbr1's ipv4.routes, which our hosts don't set, so the create fails.
        # The default egress reject already blocks internet egress.
        "ipv4.nat=true",
        "ipv6.address=none",
        # Resolver for the pod. Not the uplink LXD would otherwise advertise
        # (10.93.10.1), which blackholes DNS and hangs nmap's reverse-DNS (#318).
        f"dns.nameservers={pod_dns_nameservers(pod_id)}",
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


def _sweep_manager_ip(manager_ip: str = None):
    """Manager address the sweep is sure of, or None.

    Only an explicit argument, an operator pin (WAZUH_MANAGER_IP), or a
    successful live read counts. No silent default: a guessed address would
    rewrite every live pod's 1514/1515 rule and stop alerts.
    """
    if not manager_ip:
        manager_ip = os.getenv("WAZUH_MANAGER_IP", "").strip()
    if not manager_ip:
        try:
            import pylxd
            from provision import wazuh_manager_ip

            manager_ip = wazuh_manager_ip(pylxd.Client(project=LXD_PROJECT), strict=True)
        except Exception as e:
            logger.warning(f"[reconciler] manager address unknown, skipping ACL refresh: {e}")
            return None
    return _check_manager_ip(manager_ip)


# Every LXD rule field except description. Two rules that differ in any of
# these (for example state=disabled or a narrowed source) are different rules.
_RULE_KEYS = (
    "action",
    "source",
    "destination",
    "protocol",
    "source_port",
    "destination_port",
    "icmp_type",
    "icmp_code",
    "state",
)
_RULE_DEFAULTS = {"state": "enabled"}  # lxc network acl rule add's default


def _rule_key(rule: dict) -> tuple:
    return tuple((k, str(rule.get(k) or _RULE_DEFAULTS.get(k, ""))) for k in _RULE_KEYS)


def _remove_filter(rule: dict) -> List[str]:
    """Every field of the rule as LXD returned it, empty ones as `key=`.

    LXD's rule remove compares only the keys it is given and refuses when more
    than one rule matches, so a partial filter can match several rules.
    """
    fields = [f"{k}={rule.get(k) or ''}" for k in _RULE_KEYS]
    fields.append(f"description={rule.get('description') or ''}")
    return fields


def ensure_pod_acl(
    pod_id: int, manager_ip: str, uplink_dns: str, acl_obj: dict = None, net_config: dict = None
):
    """Bring a live pod's egress ACL and its network attachment in line.

    acl_obj is the ACL from `network acl list` (None when missing); net_config is
    the network's config from `network list`. Writes only what differs. Rules
    are compared on every field but description, and `security.acls` is set to
    the pod ACL alone.
    """
    acl = pod_acl_name(pod_id)
    net = pod_net_name(pod_id)
    wanted = [dict(kv.split("=", 1) for kv in r) for r in pod_acl_rules(pod_id, manager_ip, uplink_dns)]

    if acl_obj is None:
        logger.info(f"[reconciler] missing egress ACL {acl} — creating")
        _lxc("network", "acl", "create", acl, check=True)
        current = []
    else:
        current = acl_obj.get("egress") or []

    wanted_keys = {_rule_key(r) for r in wanted}
    current_keys = {_rule_key(r) for r in current}
    removals = {}
    for rule in current:
        if _rule_key(rule) not in wanted_keys:
            fields = tuple(_remove_filter(rule))
            removals[fields] = removals.get(fields, 0) + 1
    for fields, count in removals.items():
        # Only exact duplicates share a full filter; they are all stale.
        force = ("--force",) if count > 1 else ()
        logger.info(f"[reconciler] removing stale egress rule from {acl}: {' '.join(fields)}")
        _lxc("network", "acl", "rule", "remove", *force, acl, "egress", *fields, check=True)
    for rule in wanted:
        if _rule_key(rule) not in current_keys:
            fields = [f"{k}={v}" for k, v in rule.items()]
            logger.info(f"[reconciler] adding egress rule to {acl}: {' '.join(fields)}")
            _lxc("network", "acl", "rule", "add", acl, "egress", *fields, check=True)

    config = net_config or {}
    attached = [a.strip() for a in (config.get("security.acls") or "").split(",") if a.strip()]
    # Only the pod's own ACL. LXD merges every attached ACL, so a foreign allow
    # would outrank the default reject and the pod would not be default-deny.
    dropped = [a for a in attached if a != acl]
    if dropped:
        logger.warning(f"[reconciler] {net}: detaching foreign ACLs {','.join(dropped)}")
    wanted_cfg = {
        "security.acls": acl,
        "security.acls.default.egress.action": "reject",
        "security.acls.default.ingress.action": "allow",
        # Correct pods created before #318: replace the blackholing uplink
        # resolver with the gateway the ACL rejects fast. Last so security.acls
        # stays the first write.
        "dns.nameservers": pod_dns_nameservers(pod_id),
    }
    for key, value in wanted_cfg.items():
        if config.get(key, "") != value:
            logger.info(f"[reconciler] {net}: setting {key}={value}")
            _lxc("network", "set", net, f"{key}={value}", check=True)


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


def _active_pod_ids() -> set:
    """Pods safe to refresh. PROVISIONING and DESTROYING pods are mid-change,
    and a refresh then could recreate an ACL that teardown just removed."""
    from db import get_db_connection

    conn = get_db_connection()
    try:
        rows = conn.execute("SELECT pod_id FROM pods WHERE status='ACTIVE'").fetchall()
    finally:
        conn.close()
    return {r["pod_id"] for r in rows}


def reconcile_pod_networks(manager_ip: str = None, uplink_dns: str = None):
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

        try:
            sweep_ip = _sweep_manager_ip(manager_ip)
        except Exception as e:
            logger.error(f"[reconciler] sweep error: skipping egress ACL refresh: {e}")
            sweep_ip = None
        sweep_dns = None
        if sweep_ip:
            # Resolved once per sweep. Without it the DNS rejects can't be
            # written, so skip the refresh rather than drop them.
            try:
                sweep_dns = uplink_dns_ip(uplink_dns)
            except Exception as e:
                logger.error(f"[reconciler] sweep error: uplink DNS lookup failed, skipping egress ACL refresh: {e}")
        active = set()
        if sweep_ip and sweep_dns:
            try:
                active = _active_pod_ids()
            except Exception as e:
                logger.error(f"[reconciler] sweep error: active pod lookup failed, skipping egress ACL refresh: {e}")
        if active:
            acl_by_name = {a.get("name", ""): a for a in acls}
            net_by_name = {n.get("name", ""): n for n in nets}
            for pid, name in pod_nets:
                if pid not in active or not 1 <= pid <= 6:
                    continue
                try:
                    ensure_pod_acl(
                        pid,
                        sweep_ip,
                        sweep_dns,
                        acl_by_name.get(pod_acl_name(pid)),
                        net_by_name.get(name, {}).get("config") or {},
                    )
                except Exception as e:
                    logger.error(f"[reconciler] sweep error: egress ACL for pod {pid}: {e}")
    except Exception as e:
        logger.error(f"[reconciler] sweep error: {e}")