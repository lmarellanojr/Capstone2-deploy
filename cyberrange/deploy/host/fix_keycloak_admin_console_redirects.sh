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

TUNNEL_HOST="${1:-${TUNNEL_HOST:-}}"

if [[ -z "$TUNNEL_HOST" ]]; then
  echo "Usage: $0 <TUNNEL_HOST>" >&2
  echo "  Example: $0 cyberrange.hanzi-super.pw" >&2
  echo "  TUNNEL_HOST must be a hostname only (no scheme, path, port, or wildcards)." >&2
  exit 2
fi

# Strip scheme/path if someone pasted a URL, then validate hostname-only.
TUNNEL_HOST="${TUNNEL_HOST#https://}"
TUNNEL_HOST="${TUNNEL_HOST#http://}"
TUNNEL_HOST="${TUNNEL_HOST%%/*}"
TUNNEL_HOST="${TUNNEL_HOST%%:*}"

# Hostname labels: alnum/hyphen, dots between labels; no spaces or wildcards.
if [[ ! "$TUNNEL_HOST" =~ ^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$ ]]; then
  echo "invalid TUNNEL_HOST='$TUNNEL_HOST' (hostname only, e.g. cyberrange.hanzi-super.pw)" >&2
  exit 2
fi

# Use the guest admin.env that keycloak.service already loads (not a host copy that may drift).
lxc exec guacamole -- test -f /etc/keycloak/admin.env

lxc exec guacamole -- env TUNNEL_HOST="$TUNNEL_HOST" bash -s <<'INNER'
set -euo pipefail
set -a
. /etc/keycloak/admin.env
set +a
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

# Absolute https URIs only (no relative /admin/... — Host can be anything via server_name _).
# Keep both /auth/admin/... (browser URL) and /admin/... (SPA authServerUrl without /auth).
kcadm.sh update "clients/$CID" -r master \
  -s "redirectUris=[\"https://${TUNNEL_HOST}/auth/admin/master/console/*\",\"https://${TUNNEL_HOST}/admin/master/console/*\"]" \
  -s "webOrigins=[\"https://${TUNNEL_HOST}\"]"

echo "security-admin-console redirectUris/webOrigins updated for host: ${TUNNEL_HOST}"
kcadm.sh get "clients/$CID" -r master --fields clientId,redirectUris,webOrigins
INNER
