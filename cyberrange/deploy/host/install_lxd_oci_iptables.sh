#!/usr/bin/env bash
# OCI Ubuntu images ship nft/iptables INPUT+FORWARD reject-all (oracle-cloud-agent).
# LXD DHCP (UDP 67 on lxdbr0) never reaches dnsmasq; guests get no IPv4.
# Insert ACCEPT for LXD bridges. Do not open TCP 22/80 on the public NIC.
set -euo pipefail

IFACES=(lxdbr0 vmbr1 lxdovn1 lxdovn2 br-int)

for iface in "${IFACES[@]}"; do
  sudo iptables -C INPUT -i "$iface" -j ACCEPT 2>/dev/null || \
    sudo iptables -I INPUT -i "$iface" -j ACCEPT
  sudo iptables -C FORWARD -i "$iface" -j ACCEPT 2>/dev/null || \
    sudo iptables -I FORWARD -i "$iface" -j ACCEPT
  sudo iptables -C FORWARD -o "$iface" -j ACCEPT 2>/dev/null || \
    sudo iptables -I FORWARD -o "$iface" -j ACCEPT
done

sudo mkdir -p /etc/iptables
sudo iptables-save | sudo tee /etc/iptables/rules.v4 >/dev/null

sudo tee /etc/systemd/system/cyberrange-lxd-iptables.service >/dev/null <<'UNIT'
[Unit]
Description=Allow LXD bridge DHCP/forward on OCI reject-all filter
After=network-online.target
Before=snap.lxd.daemon.service

[Service]
Type=oneshot
ExecStart=/usr/sbin/iptables-restore /etc/iptables/rules.v4
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable --now cyberrange-lxd-iptables.service
echo "lxd_oci_iptables=PASS"
sudo iptables -L INPUT -n | head -12
sudo iptables -L FORWARD -n | head -12
