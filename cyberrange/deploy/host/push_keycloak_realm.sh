#!/usr/bin/env bash
# deploy/host/push_keycloak_realm.sh -- C2-alt. Seed the host-canonical realm JSON
# into guacamole so --import-realm can read it as the unprivileged `keycloak`
# user. Idempotent; safe to re-run. MUST run before `systemctl start keycloak`
# after any container recreate, or the realm will not be restored.
set -euo pipefail
SRC="${SRC:-$HOME/cyberrange/keycloak-import/cyber-range-realm.json}"
DST=/opt/keycloak/data/import/cyber-range-realm.json

[[ -f "$SRC" ]] || { echo "missing host-canonical realm JSON: $SRC"; exit 1; }
lxc info guacamole &>/dev/null || { echo "guacamole not found"; exit 1; }
lxc exec guacamole -- id keycloak &>/dev/null || {
  echo "in-container 'keycloak' user missing -- run install_keycloak_unit.sh first"
  exit 1
}

lxc exec guacamole -- mkdir -p /opt/keycloak/data/import
lxc file push "$SRC" "guacamole${DST}"
lxc exec guacamole -- chown keycloak:keycloak "$DST"
lxc exec guacamole -- chmod 600 "$DST"

# TRB condition 7 -- prove the service user can actually read it, don't assume
lxc exec guacamole -- sudo -u keycloak test -r "$DST" \
  && echo "realm import file readable by keycloak: OK" \
  || { echo "ERROR: keycloak cannot read $DST"; exit 1; }
