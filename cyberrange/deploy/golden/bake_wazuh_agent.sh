#!/bin/bash
# bake_wazuh_agent.sh <golden_alias>
# Rebakes an Ubuntu 22.04 target golden with wazuh-agent (== manager version,
# 4.7.5) + a templated ossec.conf for authd auto-enroll (MANAGER_IP placeholder).
# Run on the LXD host with NO student pods running. Leaves a dated,
# fingerprint-anchored rollback alias <alias>-prewazuh-YYYYMMDD.
#
# Design notes (TRB-reviewed, see Phase 7/s2_golden_agent_plan.md):
#  - Clones on `-p default` (lxdbr0 NAT egress) because pod-target-base has
#    ipv4_filtering + no egress and apt would fail there.
#  - Manager has <use_password>no</use_password>, so empty client.keys + the
#    <enrollment> defaults auto-enroll on first start (no shared secret).
#  - No device-scrub loop: goldens carry no instance-local devices, and publish
#    bakes only local devices (profile root/eth0 are inherited, not baked).
set -euo pipefail
ALIAS="${1:?usage: bake_wazuh_agent.sh <golden_alias>}"
WORK="bake-${ALIAS}-$$"
STAMP="$(date +%Y%m%d)"
trap 'lxc delete "$WORK" --force >/dev/null 2>&1 || true' EXIT

# Preflight: this republishes $ALIAS, so any pod already cloned from it is
# orphaned mid-class. The header has always said "no student pods running";
# enforce it the same way bake_dvwa_ready.sh does instead of trusting the reader.
echo "[*] preflight"
if lxc list --format csv -c n | grep -q '^pod-student-'; then
  echo "[!] student pods exist -- destroy them before rebaking ${ALIAS}:"
  lxc list --format csv -c n | grep '^pod-student-' | sed 's/^/      /'
  exit 1
fi

echo "[*] Cloning $ALIAS -> $WORK on default profile (apt egress; init+start)"
timeout 10m lxc init "$ALIAS" "$WORK" -p default </dev/null \
  || { echo "[!] Timeout creating $WORK"; exit 1; }
timeout 5m lxc start "$WORK" || { echo "[!] Timeout starting $WORK"; exit 1; }
for i in $(seq 1 30); do
  lxc exec "$WORK" -- getent hosts packages.wazuh.com >/dev/null 2>&1 && break
  [ "$i" = 30 ] && { echo "[!] no apt egress from $WORK"; exit 1; }
  sleep 2
done

echo "[*] Installing wazuh-agent (pinned to manager 4.7.5)"
lxc exec "$WORK" -- bash -c '
  set -e; export DEBIAN_FRONTEND=noninteractive
  curl -s https://packages.wazuh.com/key/GPG-KEY-WAZUH | gpg --no-default-keyring \
    --keyring gnupg-ring:/usr/share/keyrings/wazuh.gpg --import
  chmod 644 /usr/share/keyrings/wazuh.gpg
  echo "deb [signed-by=/usr/share/keyrings/wazuh.gpg] https://packages.wazuh.com/4.x/apt/ stable main" \
    > /etc/apt/sources.list.d/wazuh.list
  apt-get update
  VER=$(apt-cache madison wazuh-agent | grep -m1 -E "4\.7\.5-" | awk "{print \$3}")
  [ -n "$VER" ] || { echo "no 4.7.5 candidate"; exit 1; }
  apt-get install -y wazuh-agent="$VER"
  apt-mark hold wazuh-agent
  apt-get clean; rm -rf /var/lib/apt/lists/*
'

echo "[*] Templating ossec.conf (MANAGER_IP placeholder, authd auto-enroll) + scrub"
lxc exec "$WORK" -- bash -c '
  set -e
  sed -i "s#<address>.*</address>#<address>MANAGER_IP</address>#" /var/ossec/etc/ossec.conf
  : > /var/ossec/etc/client.keys
  chown root:wazuh /var/ossec/etc/client.keys; chmod 640 /var/ossec/etc/client.keys
  systemctl disable wazuh-agent || true
  systemctl stop wazuh-agent || true
  rm -f /var/ossec/queue/rids/* /var/ossec/queue/agent-info/* 2>/dev/null || true
  : > /var/ossec/logs/ossec.log || true
  rm -f /etc/machine-id /var/lib/dbus/machine-id || true
  systemd-machine-id-setup || true
'

echo "[*] Fingerprint-anchored rollback alias, then publish"
# Exact alias match. `lxc image list "$ALIAS"` is a prefix filter, so with
# dvwa-base-predvwaready-* present it returned that image's fingerprint and the
# rollback alias pointed at the wrong (older) image.
OLD_FP="$(lxc image alias list --format csv | awk -F, -v a="$ALIAS" '$1==a {print $2; exit}')"
if [ -n "$OLD_FP" ] && ! lxc image alias list | grep -q "${ALIAS}-prewazuh-${STAMP}"; then
  lxc image alias create "${ALIAS}-prewazuh-${STAMP}" "$OLD_FP"
fi
lxc image alias delete "$ALIAS" 2>/dev/null || true
lxc stop "$WORK" </dev/null
lxc publish "$WORK" --alias "$ALIAS" --compression zstd \
  description="${ALIAS} + wazuh-agent 4.7.5 authd auto-enroll (S2 $STAMP)" </dev/null
echo "[+] Rebaked $ALIAS ; rollback alias = ${ALIAS}-prewazuh-${STAMP} (fp ${OLD_FP:0:12})"
lxc image alias list --format csv | awk -F, -v a="$ALIAS" '$1==a || $1 ~ "^"a"-prewazuh-"'
