#!/bin/bash
# bake_dvwa_ready.sh [dvwa-base]
# Requires: no student pods. Leaves rollback alias dvwa-base-predvwaready-YYYYMMDD.
set -euo pipefail
ALIAS="${1:-dvwa-base}"
WORK="bake-${ALIAS}-$$"
STAMP="$(date +%Y%m%d)"
trap 'lxc delete "$WORK" --force >/dev/null 2>&1 || true' EXIT

echo "[*] preflight"
lxc list --format csv -c n | grep -q '^pod-student-' && {
  echo "[!] student pods exist — destroy first"; exit 1
}

echo "[*] clone $ALIAS -> $WORK on default (nesting required for Docker)"
timeout 10m lxc init "$ALIAS" "$WORK" -p default </dev/null
lxc config set "$WORK" security.nesting true
lxc config set "$WORK" security.syscalls.intercept.mknod true || true
lxc config set "$WORK" security.syscalls.intercept.setxattr true || true
timeout 5m lxc start "$WORK"

# Wait for docker
for i in $(seq 1 30); do
  lxc exec "$WORK" -- docker info >/dev/null 2>&1 && break
  [ "$i" = 30 ] && { echo "[!] docker not up"; exit 1; }
  sleep 2
done

echo "[*] write official compose"
lxc exec "$WORK" -- mkdir -p /opt/vulnerable-apps
COMPOSE_HOST="/tmp/dvwa-compose-$$.yml"
cat > "$COMPOSE_HOST" <<'YAML'
version: "3"
services:
  dvwa:
    image: ghcr.io/digininja/dvwa
    restart: always
    ports: ["80:80"]
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
YAML
lxc file push "$COMPOSE_HOST" "$WORK/opt/vulnerable-apps/docker-compose.yml"
rm -f "$COMPOSE_HOST"

lxc exec "$WORK" -- bash -c '
  set -euo pipefail
  cd /opt/vulnerable-apps
  docker-compose up -d || docker compose up -d || true
  if ! ss -ltn | grep -q ":80 "; then
    docker rm -f vulnerable-apps_dvwa_1 2>/dev/null || true
    docker network create vulnerable-apps_default 2>/dev/null || true
    docker run -d --name vulnerable-apps_dvwa_1 --network vulnerable-apps_default \
      --restart unless-stopped -p 80:80 -e DB_SERVER=db ghcr.io/digininja/dvwa
  fi
  for i in $(seq 1 24); do
    docker exec "$(docker ps -qf name=vulnerable-apps_db)" mysqladmin ping -udvwa -pp@ssw0rd --silent && break
    sleep 5
  done
  # Create schema via setup.php (token)
  HTML=$(curl -sS -c /tmp/c -b /tmp/c -m 15 http://127.0.0.1/setup.php)
  TOKEN=$(printf "%s" "$HTML" | sed -n "s/.*name=[\"'\'']user_token[\"'\''][^>]*value=[\"'\'']\\([^\"'\'']*\\).*/\\1/p" | head -1)
  curl -sS -c /tmp/c -b /tmp/c -m 60 -X POST \
    --data-urlencode "create_db=Create / Reset Database" \
    --data-urlencode "user_token=${TOKEN}" \
    http://127.0.0.1/setup.php >/dev/null
  docker exec "$(docker ps -qf name=vulnerable-apps_db)" \
    mysql -udvwa -pp@ssw0rd -N -e "SHOW TABLES FROM dvwa" | grep -qx users
  docker exec "$(docker ps -qf name=vulnerable-apps_db)" \
    mysqldump -udvwa -pp@ssw0rd dvwa > /opt/vulnerable-apps/dvwa-init.sql
  # default security Low inside the app container
  CONF=$(docker exec vulnerable-apps_dvwa_1 sh -c "ls /var/www/html/config/config.inc.php /var/www/html/dvwa/config/config.inc.php 2>/dev/null | head -1")
  [ -n "$CONF" ]
  docker exec vulnerable-apps_dvwa_1 sh -c "sed -i \"s/default_security_level.*/default_security_level'\'' ] = '\''low'\'';/\" \"$CONF\""
'

OLD_FP="$(lxc image list "$ALIAS" --format csv -c f | head -n1)"
if [ -n "$OLD_FP" ] && ! lxc image alias list | grep -q "${ALIAS}-predvwaready-${STAMP}"; then
  lxc image alias create "${ALIAS}-predvwaready-${STAMP}" "$OLD_FP"
fi
lxc image alias delete "$ALIAS" 2>/dev/null || true
lxc stop "$WORK" </dev/null
lxc publish "$WORK" --alias "$ALIAS" --compression zstd \
  description="${ALIAS} + DVWA db ready, security low ($STAMP)" </dev/null
echo "[+] Rebaked $ALIAS ; rollback = ${ALIAS}-predvwaready-${STAMP}"
