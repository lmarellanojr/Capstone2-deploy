#!/usr/bin/env bash
# deploy/host/install_keycloak_blocklist.sh -- SEC-04. Put the password
# blocklist where Keycloak resolves passwordBlacklist(<name>), readable by the
# unprivileged `keycloak` user. Idempotent; safe to re-run.
#
# Called by push_keycloak_realm.sh (so a re-exported realm that references the
# blocklist finds it during the startup --import-realm, before Keycloak is
# reachable) and by enable_keycloak_password_policy.sh.
#
# Keycloak loads a blocklist once per name and caches it in the JVM, so a
# CHANGED file only takes effect after `systemctl restart keycloak`. This
# script prints one of:
#   BLOCKLIST_INSTALLED  -- file was missing; nothing had loaded it yet
#   BLOCKLIST_UNCHANGED  -- same checksum as the installed copy
#   BLOCKLIST_CHANGED    -- contents differ; a running Keycloak needs a restart
set -euo pipefail
export PATH="/snap/bin:/usr/sbin:/usr/bin:/bin"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NAME=cyberrange-common-passwords.txt
SRC="${BLOCKLIST_SRC:-$ROOT/keycloak/password-blacklists/$NAME}"
DIR=/opt/keycloak/data/password-blacklists
DST="$DIR/$NAME"

[[ -f "$SRC" ]] || { echo "missing blocklist: $SRC"; exit 1; }
lxc info guacamole &>/dev/null || { echo "guacamole not found"; exit 1; }
lxc exec guacamole -- id keycloak &>/dev/null || {
  echo "in-container 'keycloak' user missing -- run install_keycloak_unit.sh first"
  exit 1
}

new_sum=$(sha256sum "$SRC" | cut -d' ' -f1)
old_sum=$(lxc exec guacamole -- sh -c "sha256sum '$DST' 2>/dev/null | cut -d' ' -f1" || true)

lxc exec guacamole -- mkdir -p "$DIR"
lxc file push "$SRC" "guacamole${DST}" </dev/null
lxc exec guacamole -- chown -R keycloak:keycloak "$DIR"
lxc exec guacamole -- chmod 644 "$DST"

lxc exec guacamole -- sudo -u keycloak test -r "$DST" \
  && echo "blocklist readable by keycloak: OK ($(wc -l <"$SRC") entries)" \
  || { echo "ERROR: keycloak cannot read $DST"; exit 1; }

if [[ -z "$old_sum" ]]; then
  echo BLOCKLIST_INSTALLED
elif [[ "$old_sum" == "$new_sum" ]]; then
  echo BLOCKLIST_UNCHANGED
else
  echo BLOCKLIST_CHANGED
fi
