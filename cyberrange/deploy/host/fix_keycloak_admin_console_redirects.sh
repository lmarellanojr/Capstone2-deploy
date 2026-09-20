#!/bin/bash
# Ensure master realm client security-admin-console accepts admin-console
# redirect URIs when the browser is on https://<TUNNEL_HOST>/auth/admin/...
# (Issue #84). Idempotent. Does NOT rotate the portal client secret.
#
# Usage (on Ampere host):
#   bash deploy/host/fix_keycloak_admin_console_redirects.sh cyberrange.hanzi-super.pw
#   TUNNEL_HOST=cyberrange.example.com bash deploy/host/fix_keycloak_admin_console_redirects.sh
#
# Run after install_keycloak_unit.sh + hostname drop-in. Safe to re-run.
set -euo pipefail
export PATH="/snap/bin:/usr/sbin:/usr/bin:/bin:/opt/keycloak/bin"

REPO="${REPO:-$HOME/cyberrange}"
ADMIN_ENV="${ADMIN_ENV:-$REPO/deploy/keycloak/admin.env}"
TUNNEL_HOST="${1:-${TUNNEL_HOST:-}}"

if [[ -z "$TUNNEL_HOST" ]]; then
  echo "Usage: $0 <TUNNEL_HOST>" >&2
  echo "  Example: $0 cyberrange.hanzi-super.pw" >&2
  exit 2
fi

# Strip scheme if someone pasted a full URL
TUNNEL_HOST="${TUNNEL_HOST#https://}"
TUNNEL_HOST="${TUNNEL_HOST#http://}"
TUNNEL_HOST="${TUNNEL_HOST%%/*}"

if [[ ! -f "$ADMIN_ENV" ]]; then
  echo "missing $ADMIN_ENV" >&2
  exit 1
fi

lxc file push "$ADMIN_ENV" guacamole/tmp/admin.env </dev/null
lxc exec guacamole -- chmod 600 /tmp/admin.env

lxc exec guacamole -- env TUNNEL_HOST="$TUNNEL_HOST" bash -s <<'INNER'
set -euo pipefail
set -a
. /tmp/admin.env
set +a
rm -f /tmp/admin.env
export PATH=/opt/keycloak/bin:$PATH

kcadm.sh config credentials \
  --server http://127.0.0.1:8083/auth \
  --realm master \
  --user "$KEYCLOAK_ADMIN" \
  --password "$KEYCLOAK_ADMIN_PASSWORD" >/dev/null

CID=$(kcadm.sh get clients -r master -q clientId=security-admin-console \
  --fields id --format csv --noquotes | tail -1)
if [[ -z "$CID" || "$CID" == "id" ]]; then
  echo "security-admin-console client not found in master realm" >&2
  exit 1
fi

# Relative + absolute forms cover authAdminUrl with/without /auth in the path.
kcadm.sh update "clients/$CID" -r master \
  -s "redirectUris=[\"/admin/master/console/*\",\"https://${TUNNEL_HOST}/admin/master/console/*\",\"https://${TUNNEL_HOST}/auth/admin/master/console/*\"]" \
  -s 'webOrigins=["+"]'

echo "security-admin-console redirectUris updated for host: ${TUNNEL_HOST}"
kcadm.sh get "clients/$CID" -r master --fields clientId,redirectUris,webOrigins
INNER
