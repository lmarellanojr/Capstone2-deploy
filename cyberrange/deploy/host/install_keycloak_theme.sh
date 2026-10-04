#!/bin/bash
# SEC-03 UI: install the MMDC Cyber Range login theme into Keycloak and make it
# the cyber-range realm's login theme. Styles the sign-in page, the
# authenticator setup page (QR code) and the one-time code page to match the
# portal.
#
#   bash ~/cyberrange/deploy/host/install_keycloak_theme.sh            # install + activate
#   bash ~/cyberrange/deploy/host/install_keycloak_theme.sh --revert   # back to Keycloak's default look
#
# The theme lives in deploy/keycloak/themes/cyberrange/ and is copied to
# /opt/keycloak/themes/cyberrange in the guacamole container. It extends the
# built-in "keycloak" login theme (the realm's previous theme), so only the
# page frame, the two MFA pages and the styling change; form field names are
# untouched. Keycloak runs `start-dev`, which disables theme caching, so no
# restart is needed. Idempotent. Prints settings only -- never a secret.
#
# Run on the LXD host as the provision-api operator. Like the MFA settings,
# the realm's loginTheme lives in Keycloak; re-export the realm afterwards if
# you keep an export (Manual 04 §5).
set -euo pipefail
export PATH="/snap/bin:/usr/sbin:/usr/bin:/bin"
REPO=/home/llms_admin/cyberrange
ADMIN_ENV="$REPO/deploy/keycloak/admin.env"
THEME_SRC="$REPO/deploy/keycloak/themes/cyberrange"
THEME=cyberrange
MODE=install
[ "${1:-}" = "--revert" ] && MODE=revert

[[ -f "$ADMIN_ENV" ]] || { echo "missing $ADMIN_ENV"; exit 1; }
lxc info guacamole &>/dev/null || { echo "guacamole container not found"; exit 1; }

if [ "$MODE" = install ]; then
  [[ -f "$THEME_SRC/login/theme.properties" ]] || { echo "missing theme at $THEME_SRC"; exit 1; }
  # Copy as a tarball so the whole tree lands atomically, then hand it to the
  # unprivileged keycloak user (it must be able to read every file).
  tar czf /tmp/kc-theme.tgz -C "$THEME_SRC/.." "$THEME"
  lxc exec guacamole -- rm -f /tmp/kc-theme.tgz </dev/null
  lxc file push /tmp/kc-theme.tgz guacamole/tmp/kc-theme.tgz </dev/null
  rm -f /tmp/kc-theme.tgz
  lxc exec guacamole -- bash -c "
    set -e
    rm -rf /opt/keycloak/themes/$THEME.new
    mkdir -p /opt/keycloak/themes/$THEME.new
    tar xzf /tmp/kc-theme.tgz -C /opt/keycloak/themes/$THEME.new --strip-components=1
    rm -f /tmp/kc-theme.tgz
    rm -rf /opt/keycloak/themes/$THEME.prev
    [ -d /opt/keycloak/themes/$THEME ] && mv /opt/keycloak/themes/$THEME /opt/keycloak/themes/$THEME.prev || true
    mv /opt/keycloak/themes/$THEME.new /opt/keycloak/themes/$THEME
    chown -R keycloak:keycloak /opt/keycloak/themes/$THEME
    find /opt/keycloak/themes/$THEME -type d -exec chmod 755 {} +
    find /opt/keycloak/themes/$THEME -type f -exec chmod 644 {} +
    sudo -u keycloak test -r /opt/keycloak/themes/$THEME/login/template.ftl
  " </dev/null
  echo "theme files installed: /opt/keycloak/themes/$THEME (previous copy, if any, in $THEME.prev)"
fi

lxc exec guacamole -- rm -f /tmp/admin.env </dev/null
lxc file push "$ADMIN_ENV" guacamole/tmp/admin.env </dev/null
lxc exec guacamole -- chmod 600 /tmp/admin.env </dev/null

lxc exec guacamole -- env MODE="$MODE" THEME="$THEME" bash -s <<'INNER'
set -euo pipefail
set -a
. /tmp/admin.env
set +a
export PATH=/opt/keycloak/bin:/usr/bin:/bin
trap 'rm -f /tmp/admin.env /tmp/kc-login-page.html' EXIT
REALM=cyber-range
kcadm.sh config credentials --server http://127.0.0.1:8083/auth --realm master --user "$KEYCLOAK_ADMIN" --password "$KEYCLOAK_ADMIN_PASSWORD" >/dev/null

if [ "$MODE" = install ]; then
  kcadm.sh update "realms/$REALM" -s "loginTheme=$THEME" -s "displayName=MMDC Cyber Range"
else
  # "keycloak" is the built-in theme the realm used before this change.
  kcadm.sh update "realms/$REALM" -s loginTheme=keycloak
fi
echo "realm: $(kcadm.sh get "realms/$REALM" --fields loginTheme,displayName --format csv --noquotes | tail -1)"

# Prove the real sign-in page (not an error page) is served with the expected theme.
PORTAL_CID=$(kcadm.sh get clients -r "$REALM" -q clientId=portal --fields id --format csv --noquotes | tail -1)
REDIRECT=$(kcadm.sh get "clients/$PORTAL_CID" -r "$REALM" --fields redirectUris | python3 -c '
import json, sys
uris = [u for u in json.load(sys.stdin).get("redirectUris", []) if u.startswith("http")]
print(uris[0].rstrip("*").rstrip("/") + "/api/auth/callback/keycloak" if uris else "")')
curl -sS -o /tmp/kc-login-page.html -G "http://127.0.0.1:8083/auth/realms/$REALM/protocol/openid-connect/auth" \
  --data-urlencode client_id=portal --data-urlencode response_type=code \
  --data-urlencode scope=openid --data-urlencode "redirect_uri=$REDIRECT"
grep -q 'id="kc-form-login"' /tmp/kc-login-page.html || { echo "SIGN_IN_PAGE_NOT_RENDERED"; exit 1; }
if grep -q "/login/$THEME/css/cyberrange.css" /tmp/kc-login-page.html; then
  echo "sign-in page: served with the $THEME theme"
  [ "$MODE" = install ] && echo THEME_OK || { echo "THEME_STILL_ACTIVE"; exit 1; }
else
  echo "sign-in page: served with Keycloak's default theme"
  [ "$MODE" = revert ] && echo THEME_REVERTED || { echo "THEME_NOT_ACTIVE"; exit 1; }
fi
INNER
