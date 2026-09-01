#!/usr/bin/env bash
# Repair OVN ↔ LXD integration after OVN service restart (peer create hang).
set -euo pipefail

echo "=== kill stuck lxc peer processes ==="
ps aux | awk '/bin\/lxc network peer/ && !/awk/ {print $2}' | xargs -r kill 2>/dev/null || true
sleep 1

echo "=== cleanup test network ==="
lxc network peer delete pod-test-net to-mon 2>/dev/null || true
lxc network peer delete mon-net from-pod-test 2>/dev/null || true
lxc network delete pod-test-net 2>/dev/null || true

echo "=== configure OVS OVN external_ids ==="
ovs-vsctl set open_vswitch . \
  external_ids:ovn-remote=unix:/var/run/ovn/ovnsb_db.sock \
  external_ids:ovn-encap-type=geneve \
  external_ids:ovn-encap-ip=127.0.0.1
echo "ovn-remote=$(ovs-vsctl get open_vswitch . external_ids:ovn-remote)"

echo "=== restart OVN stack ==="
systemctl restart openvswitch-switch ovn-central ovn-host
sleep 5

echo "=== restart LXD ==="
snap restart lxd
sleep 10

echo "=== OVN services ==="
systemctl is-active openvswitch-switch ovn-central ovn-host ovn-northd

echo "=== peer smoke ==="
lxc network create pod-test-net --type=ovn network=vmbr1 ipv4.address=10.0.59.1/24 ipv4.nat=true ipv6.address=none
time lxc network peer create pod-test-net to-mon mon-net
time lxc network peer create mon-net from-pod-test pod-test-net
lxc network peer list mon-net
lxc network peer delete pod-test-net to-mon
lxc network peer delete mon-net from-pod-test
lxc network delete pod-test-net
echo "fix_ovn_peer=PASS"