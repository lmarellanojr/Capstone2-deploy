#!/usr/bin/env bash
# ARM64 golden image builder for OCI Ampere A1.
# Uses `lxc publish` to turn each builder container into a local image.
#
# Originally used `lxc export --optimized-storage` + `lxc image import`
# instead, specifically to avoid `lxc publish`'s storage-pool bloat on the
# 200 GiB block volume. Switched back to `lxc publish` (Phase 5, ARM64
# hardware bring-up) after finding `lxc export` on LXD 5.21 LTS now always
# produces an instance-backup archive (`backup/index.yaml`,
# `backup/container.bin`) rather than the classic image-format tarball
# `lxc image import` expects -- every export+import attempt failed with
# "Metadata tarball is missing metadata.yaml". `lxc publish` uses the
# storage driver's native image-creation path (CoW on btrfs) and doesn't
# round-trip through a tarball at all, so it isn't just a workaround for
# the missing 200 GiB volume -- it sidesteps a real LXD version
# incompatibility in the old approach.
#
# Run on an aarch64 staging host (>=16 GiB RAM, recommended) or directly on
# the OCI A1 instance -- on the 12 GiB baseline, only bake on-host BEFORE
# guacamole/wazuh-manager are up, or `lxc stop` them first (see Manual 03 / Phase-3).
#
# Builders: meta-base, kali-base, dvwa-base only (no gateway golden).
# Fixes (2026-07-28 TRB): in-container DVWA manifest check; empty machine-id at
# bake time; timeout on install steps.
set -euo pipefail

# Default is the unified layout. The previous default used the hyphenated
# pre-unification name, so this script exited immediately on any host that
# had followed the Manual and cloned to ~/cyberrange.
REPO="${REPO:-$HOME/cyberrange}"
# Unified checkout: deploy/golden/phase3. Legacy nested path is fallback only.
_default_phase3="${REPO}/deploy/golden/phase3"
if [ ! -d "$_default_phase3" ]; then
  _default_phase3="${REPO}/Development Phase/Phase 3/scripts"
fi
PHASE3="${PHASE3:-$_default_phase3}"

arch="$(uname -m)"
if [ "$arch" != "aarch64" ]; then
  echo "[!] Expected aarch64, got ${arch} -- aborting."
  exit 1
fi

if [ ! -d "$PHASE3" ]; then
  echo "[!] Missing ${PHASE3}"
  exit 1
fi

# Leave /etc/machine-id EMPTY at bake time (do NOT run systemd-machine-id-setup).
# Empty file → each clone gets a unique ID on first boot.
reset_identity() {
  local c="$1"
  lxc exec "$c" -- bash -c '
    rm -f /etc/machine-id /var/lib/dbus/machine-id
    touch /etc/machine-id
    truncate -s 0 /var/log/*.log 2>/dev/null || true
  '
}

export_image() {
  local builder="$1" alias="$2"
  echo "[*] Publishing ${alias} from ${builder}..."
  lxc stop "$builder" </dev/null
  lxc publish "$builder" --alias "$alias" </dev/null
  lxc delete -f "$builder" </dev/null
  echo "[+] ${alias} published."
}

build_kali() {
  if lxc image info kali-base &>/dev/null; then
    echo "[=] kali-base already exists, skipping"
    return
  fi
  local c=kali-builder
  lxc delete -f "$c" &>/dev/null || true
  echo "[*] Creating Kali ARM64 builder (init+start)..."
  # images:kali/current/arm64 was retired upstream; images:kali/arm64 is
  # the current stable alias (verified against the live image server
  # during Phase 5 ARM64 bring-up -- images:kali/current/arm64 404s with
  # "requested image couldn't be found").
  timeout 20m lxc init images:kali/arm64 "$c" \
    -c limits.cpu=2 -c limits.memory=4GB </dev/null \
    || { echo "[!] Timeout creating $c"; return 1; }
  timeout 5m lxc start "$c" </dev/null || { echo "[!] Timeout starting $c"; return 1; }
  sleep 20
  timeout 30m lxc exec "$c" -- bash -c '
    apt-get update &&
    DEBIAN_FRONTEND=noninteractive apt-get install -y \
      kali-linux-headless openssh-server sudo &&
    systemctl enable ssh &&
    # kali-linux-headless pulls in NetworkManager, which races legacy
    # ifupdown (both enabled by default) for control of eth0. ifupdown
    # already brings eth0 up correctly via DHCP at boot; NetworkManager
    # starts later (~15-20s in, often coinciding with other slow boot
    # units under host load) and its device-discovery of eth0 knocks the
    # link back down even though NetworkManager.conf marks ifupdown
    # interfaces "unmanaged" -- the disruption happens during initial
    # device claiming, before that unmanaged status is settled. Disabling
    # it outright is correct here: this is a headless CLI-only lab
    # container with no GUI network switching need, so NetworkManager
    # serves no purpose and ifupdown alone is sufficient.
    systemctl disable --now NetworkManager 2>/dev/null || true
  '
  # Must run before history flush so /home/student exists (see kali_add_student.sh).
  lxc file push "${PHASE3}/kali_add_student.sh" "$c/tmp/kali_add_student.sh" </dev/null
  lxc exec "$c" -- bash /tmp/kali_add_student.sh
  lxc exec "$c" -- bash -s < "${PHASE3}/enable_history_flush.sh"
  reset_identity "$c"
  export_image "$c" kali-base
}

build_meta() {
  if lxc image info meta-base &>/dev/null; then
    echo "[=] meta-base already exists, skipping"
    return
  fi
  local c=meta-build
  lxc delete -f "$c" &>/dev/null || true
  echo "[*] Creating meta ARM64 builder (init+start)..."
  timeout 20m lxc init ubuntu:22.04 "$c" </dev/null || { echo "[!] Timeout creating $c"; return 1; }
  timeout 5m lxc start "$c" </dev/null || { echo "[!] Timeout starting $c"; return 1; }
  sleep 15
  timeout 30m lxc exec "$c" -- bash -c '
    apt-get update && apt-get install -y vsftpd apache2
  '
  for script in meta_pin_vsftpd.sh meta_install_tomcat.sh \
                meta_add_msfadmin.sh meta_enable_password_ssh.sh \
                enable_history_flush.sh; do
    lxc exec "$c" -- bash -s < "${PHASE3}/${script}"
  done
  reset_identity "$c"
  export_image "$c" meta-base
}

build_dvwa() {
  if lxc image info dvwa-base &>/dev/null; then
    echo "[=] dvwa-base already exists, skipping"
    return
  fi
  local c=dvwa-build
  lxc delete -f "$c" &>/dev/null || true
  echo "[*] Creating DVWA ARM64 builder (init+start)..."
  timeout 20m lxc init ubuntu:22.04 "$c" -c security.nesting=true </dev/null \
    || { echo "[!] Timeout creating $c"; return 1; }
  timeout 5m lxc start "$c" </dev/null || { echo "[!] Timeout starting $c"; return 1; }
  sleep 15
  timeout 30m lxc exec "$c" -- bash -c '
    apt-get update &&
    apt-get install -y docker.io docker-compose fuse-overlayfs
  '
  lxc exec "$c" -- bash -c '
    mkdir -p /etc/docker
    echo "{\"storage-driver\": \"fuse-overlayfs\"}" > /etc/docker/daemon.json
    systemctl restart docker
  '

  local dvwa_image="ghcr.io/digininja/dvwa"

  # Manifest check INSIDE the container (Docker lives there), fatal + cleanup.
  if ! lxc exec "$c" -- bash -c "
    docker manifest inspect '${dvwa_image}' 2>/dev/null | grep -qE 'arm64|aarch64'
  "; then
    echo "[!] ${dvwa_image} lacks an arm64 manifest -- aborting dvwa-base build."
    echo "    Fallback: native PHP/MariaDB DVWA install (see Manual 03 / Phase-3-OCI-TARGETS.md)."
    lxc delete -f "$c"
    exit 1
  fi

  lxc exec "$c" -- bash -c "
    mkdir -p /opt/vulnerable-apps
    cat > /opt/vulnerable-apps/docker-compose.yml <<'EOF'
version: \"3\"
services:
  dvwa:
    image: ${dvwa_image}
    restart: always
    ports: [\"80:80\"]
    environment:
      - DB_SERVER=db
    depends_on:
      - db
  db:
    image: docker.io/library/mariadb:10
    restart: always
    environment:
      - MYSQL_ROOT_PASSWORD=dvwa
      - MYSQL_DATABASE=dvwa
      - MYSQL_USER=dvwa
      - MYSQL_PASSWORD=p@ssw0rd
EOF
    cd /opt/vulnerable-apps && docker-compose up -d
  "
  # Seed schema and default security Low before publish (issue #124 review).
  # Provision ensure remains the repair path for already-baked hosts.
  lxc exec "$c" -- bash -s <<'SEED'
set -euo pipefail
cd /opt/vulnerable-apps
for i in $(seq 1 24); do
  docker exec "$(docker ps -qf name=vulnerable-apps_db)" mysqladmin ping -udvwa -pp@ssw0rd --silent && break
  sleep 5
  [ "$i" = 24 ] && { echo "[!] mariadb did not become ready"; exit 1; }
done
HTML=$(curl -fsS -c /tmp/c -b /tmp/c -m 20 http://127.0.0.1/setup.php)
TOKEN=$(printf '%s' "$HTML" | grep -oE "value=['\"][a-f0-9]{8,}['\"]" | head -1 | tr -d "\"'" | sed 's/^value=//')
[ -n "$TOKEN" ]
curl -fsS -c /tmp/c -b /tmp/c -m 90 -X POST \
  --data-urlencode "create_db=Create / Reset Database" \
  --data-urlencode "user_token=${TOKEN}" \
  http://127.0.0.1/setup.php >/dev/null
docker exec "$(docker ps -qf name=vulnerable-apps_db)" \
  mysql -udvwa -pp@ssw0rd -N -e "SHOW TABLES FROM dvwa" | grep -qx users
docker exec "$(docker ps -qf name=vulnerable-apps_db)" \
  mysqldump -udvwa -pp@ssw0rd dvwa > /opt/vulnerable-apps/dvwa-init.sql
test -s /opt/vulnerable-apps/dvwa-init.sql
DVWA=$(docker ps --format '{{.Names}}' | grep vulnerable-apps_dvwa | head -1)
[ -n "$DVWA" ]
CONF=$(docker exec "$DVWA" sh -c 'ls /var/www/html/config/config.inc.php /var/www/html/dvwa/config/config.inc.php 2>/dev/null | head -1')
[ -n "$CONF" ]
docker exec "$DVWA" sh -c "grep -q \"default_security_level' ] = 'low'\" \"\$CONF\" || sed -i \"s/default_security_level.*/default_security_level' ] = 'low';/\" \"\$CONF\""
docker exec "$DVWA" grep -q "default_security_level' ] = 'low'" "$CONF"
SEED
  reset_identity "$c"
  export_image "$c" dvwa-base
}

echo "=== OCI ARM64 golden build (repo: ${REPO}) ==="
build_meta
build_kali
build_dvwa
echo "=== Done ==="
lxc image list | grep -E 'kali-base|meta-base|dvwa-base'
echo "Goldens baked. Continue Manual chapter 04 (optional extra: python3 deploy/host/provision_verify_smoke_direct.py)."
