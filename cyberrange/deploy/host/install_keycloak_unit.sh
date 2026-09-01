#!/usr/bin/env bash
# deploy/host/install_keycloak_unit.sh -- install native Keycloak inside guacamole,
# replacing the Docker-based Keycloak container. Run AFTER Task 3's package
# install steps (openjdk-21-jre-headless + the Keycloak distribution at
# /opt/keycloak) have already happened inside guacamole.
set -euo pipefail
# ROOT computation: from deploy/host/, parent (..) is deploy/
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UNIT_SRC="$ROOT/keycloak/keycloak.service"
ADMIN_ENV_SRC="$ROOT/keycloak/admin.env"

[[ -f "$UNIT_SRC" ]] || { echo "missing $UNIT_SRC"; exit 1; }
[[ -f "$ADMIN_ENV_SRC" ]] || {
  echo "missing $ADMIN_ENV_SRC -- copy $ROOT/keycloak/admin.env.example to admin.env and fill in KEYCLOAK_ADMIN_PASSWORD"
  exit 1
}
lxc info guacamole &>/dev/null || { echo "guacamole container not found"; exit 1; }
lxc exec guacamole -- test -x /opt/keycloak/bin/kc.sh || {
  echo "Keycloak not installed at /opt/keycloak -- run Task 4's install step first"
  exit 1
}

# Dedicated unprivileged user (TRB Round 2 condition) -- idempotent
lxc exec guacamole -- id keycloak &>/dev/null || \
  lxc exec guacamole -- useradd --system --home /opt/keycloak --shell /usr/sbin/nologin keycloak

# --- C4: free 127.0.0.1:8083 before the native unit tries to bind -------------
# Path B only (Docker present from an earlier doc-04 revision). The docker.io
# PACKAGE stays installed as the fallback until after the regression gate --
# only the CONTAINER is removed here. The keycloak image remains cached, so
# rollback is just `docker run ...` again.
lxc exec guacamole -- bash -c '
  if command -v docker >/dev/null 2>&1; then
    docker stop keycloak 2>/dev/null || true
    docker rm keycloak 2>/dev/null || true
  fi
  if command -v ss >/dev/null 2>&1 && ss -ltn | grep -q ":8083 "; then
    echo "ERROR: 127.0.0.1:8083 still bound -- native keycloak cannot start."
    echo "Find the holder: ss -ltnp | grep :8083"
    exit 1
  fi
'

lxc exec guacamole -- mkdir -p /etc/keycloak /opt/keycloak/data/import

# Secrets: EnvironmentFile only, root:root 0600 -- never Environment= inline (TRB Round 2)
lxc file push "$ADMIN_ENV_SRC" guacamole/etc/keycloak/admin.env
lxc exec guacamole -- chown root:root /etc/keycloak/admin.env
lxc exec guacamole -- chmod 600 /etc/keycloak/admin.env

lxc file push "$UNIT_SRC" guacamole/etc/systemd/system/keycloak.service
lxc exec guacamole -- chown -R keycloak:keycloak /opt/keycloak

# --- C2-alt: seed the realm import file if a host-canonical copy exists -------
# No LXD disk device, no idmap arithmetic (the previous `chown 100000:100000`
# was wrong: useradd --system gives `keycloak` a non-zero UID, so the host-side
# mapped owner is NOT the container-root base). See deploy/host/push_keycloak_realm.sh.
if [[ -f "$HOME/cyberrange/keycloak-import/cyber-range-realm.json" ]]; then
  bash "$ROOT/host/push_keycloak_realm.sh"
else
  echo "NOTE: no host-canonical realm JSON yet -- expected on a first deploy."
  echo "      Create the realm (doc 05 §4), export it (doc 04 §5), then re-run"
  echo "      deploy/host/push_keycloak_realm.sh before any future container recreate."
fi

# --- Hostname resolution for H2 / JVM (2026-08-03 mini staging) --------------
# Keycloak can fail or loop if the container hostname (often "guacamole") does
# not resolve inside the guest. Seed /etc/hosts before first start (idempotent).
lxc exec guacamole -- bash -c '
  set -e
  hn=$(hostname 2>/dev/null || echo guacamole)
  if ! grep -qE "[[:space:]]guacamole($|[[:space:]])" /etc/hosts; then
    echo "127.0.0.1 guacamole" >> /etc/hosts
  fi
  if [[ -n "$hn" ]] && ! grep -qE "[[:space:]]${hn}($|[[:space:]])" /etc/hosts; then
    echo "127.0.0.1 ${hn}" >> /etc/hosts
  fi
'

lxc exec guacamole -- systemctl daemon-reload
lxc exec guacamole -- systemctl enable --now keycloak.service

# --- M3: poll for readiness instead of a fixed sleep -------------------------
# A cold JVM start under MemoryMax=1G can exceed 5s; a fixed sleep produces
# false failures. Poll the OIDC discovery endpoint (master realm always exists).
deadline=$((SECONDS + 120))
until lxc exec guacamole -- curl -fsS --max-time 3 \
        http://127.0.0.1:8083/auth/realms/master/.well-known/openid-configuration \
        >/dev/null 2>&1; do
  if (( SECONDS >= deadline )); then
    echo "ERROR: keycloak not ready after 120s"
    lxc exec guacamole -- systemctl is-active keycloak.service || true
    lxc exec guacamole -- journalctl -u keycloak.service -n 50 --no-pager
    exit 1
  fi
  sleep 5
done

lxc exec guacamole -- systemctl is-active keycloak.service
lxc exec guacamole -- systemctl is-enabled keycloak.service
lxc exec guacamole -- journalctl -u keycloak.service -n 30 --no-pager
echo "keycloak native install: OK"
