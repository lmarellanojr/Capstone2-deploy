#!/bin/bash
# ADM-USER (#32): create the confidential `cyberrange-user-admin` client whose
# service account the provision API uses for Admin user management
# (src/provisioning/keycloak_admin.py), and lock public signup off.
#
# The client is service-account-only (no browser login, no password grant) and
# its service account gets exactly these realm-management roles in cyber-range:
#   view-users, query-users, manage-users  -- list/create/enable/disable users,
#                                             map realm roles
#   view-realm                             -- read-only; needed for
#                                             GET /roles/{name} and
#                                             GET /roles/{name}/users
# Nothing else (no manage-realm, no manage-clients, no realm-admin). Keycloak
# refuses to let a manage-users holder grant realm-management admin roles it
# does not itself hold, so this cannot be escalated to realm-admin via the API.
#
# Also enforces registrationAllowed=false on the realm (issue #32: "Do not add
# public signup").
#
# Idempotent. Unlike create_keycloak_realm.sh this does NOT rotate any secret
# on re-run: an existing client's current secret is read back and re-written
# to env/.env. It never touches the `portal` client or any user.
#
# Run on the LXD host as the provision-api operator, after
# create_keycloak_realm.sh and create_demo_accounts.sh. Then restart the
# provision API so it picks up KEYCLOAK_USER_ADMIN_CLIENT_SECRET.
set -euo pipefail
export PATH="/snap/bin:/usr/sbin:/usr/bin:/bin"
REPO=/home/llms_admin/cyberrange
ADMIN_ENV="$REPO/deploy/keycloak/admin.env"
API_ENV="$REPO/env/.env"
CLIENT_ID=cyberrange-user-admin

[[ -f "$ADMIN_ENV" ]] || { echo "missing $ADMIN_ENV"; exit 1; }
[[ -f "$API_ENV" ]] || { echo "missing $API_ENV"; exit 1; }
lxc info guacamole &>/dev/null || { echo "guacamole container not found"; exit 1; }

# Defensive: an interrupted earlier run can leave these owned by the
# exec-mapped uid, which makes `lxc file push` fail with "Error: Forbidden".
lxc exec guacamole -- rm -f /tmp/admin.env /tmp/kc-useradmin.env
lxc file push "$ADMIN_ENV" guacamole/tmp/admin.env </dev/null
lxc exec guacamole -- chmod 600 /tmp/admin.env

lxc exec guacamole -- env CLIENT_ID="$CLIENT_ID" bash -s <<'INNER'
set -euo pipefail
set -a
. /tmp/admin.env
set +a
export PATH=/opt/keycloak/bin:/usr/bin:/bin
trap 'rm -f /tmp/admin.env' EXIT
kcadm.sh config credentials --server http://127.0.0.1:8083/auth --realm master --user "$KEYCLOAK_ADMIN" --password "$KEYCLOAK_ADMIN_PASSWORD"

# --- no public signup ---
kcadm.sh update realms/cyber-range -s registrationAllowed=false
echo "registrationAllowed=$(kcadm.sh get realms/cyber-range --fields registrationAllowed --format csv --noquotes | tail -1)"

# --- service-account-only confidential client ---
CID=$(kcadm.sh get clients -r cyber-range -q "clientId=$CLIENT_ID" --fields id --format csv --noquotes 2>/dev/null | tail -1 || true)
if [ -z "$CID" ] || [ "$CID" = "id" ]; then
  kcadm.sh create clients -r cyber-range \
    -s "clientId=$CLIENT_ID" \
    -s enabled=true \
    -s publicClient=false \
    -s protocol=openid-connect \
    -s serviceAccountsEnabled=true \
    -s standardFlowEnabled=false \
    -s implicitFlowEnabled=false \
    -s directAccessGrantsEnabled=false \
    -s 'redirectUris=[]' \
    -s 'webOrigins=[]'
  CID=$(kcadm.sh get clients -r cyber-range -q "clientId=$CLIENT_ID" --fields id --format csv --noquotes | tail -1)
  echo USER_ADMIN_CLIENT_CREATED
else
  # Re-assert the locked-down flow settings in case someone widened them in the console.
  kcadm.sh update "clients/$CID" -r cyber-range \
    -s serviceAccountsEnabled=true -s standardFlowEnabled=false \
    -s implicitFlowEnabled=false -s directAccessGrantsEnabled=false
  echo USER_ADMIN_CLIENT_EXISTS
fi

SA_USER="service-account-$CLIENT_ID"
kcadm.sh add-roles -r cyber-range --uusername "$SA_USER" --cclientid realm-management \
  --rolename view-users --rolename query-users --rolename manage-users --rolename view-realm

echo "=== $SA_USER realm-management roles ==="
kcadm.sh get-roles -r cyber-range --uusername "$SA_USER" --cclientid realm-management --fields name --format csv --noquotes | tr '\n' ' '
echo

SECRET=$(kcadm.sh get "clients/$CID/client-secret" -r cyber-range --fields value --format csv --noquotes | tail -1)
[ -n "$SECRET" ] && [ "$SECRET" != "value" ] || { echo "could not read client secret"; exit 1; }

# --- smoke: the exact Admin REST calls keycloak_admin.py makes (read-only) ---
TOKEN=$(curl -sS -u "$CLIENT_ID:$SECRET" -d grant_type=client_credentials \
  http://127.0.0.1:8083/auth/realms/cyber-range/protocol/openid-connect/token \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')
for path in "users?max=1" "roles/student" "roles/student/users?max=1" "roles/admin/users?max=1"; do
  code=$(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOKEN" \
    "http://127.0.0.1:8083/auth/admin/realms/cyber-range/$path")
  printf 'GET %-28s HTTP %s\n' "$path" "$code"
  [ "$code" = 200 ] || { echo "SMOKE_FAILED: service account cannot GET $path"; exit 1; }
done

umask 077
printf 'SECRET=%s\n' "$SECRET" > /tmp/kc-useradmin.env
echo USER_ADMIN_SETUP_OK
INNER

umask 077
lxc file pull guacamole/tmp/kc-useradmin.env /tmp/kc-useradmin.env
lxc exec guacamole -- rm -f /tmp/kc-useradmin.env
python3 - "$API_ENV" "$CLIENT_ID" /tmp/kc-useradmin.env <<'PY'
import pathlib, re, sys
path, client_id, secret_file = sys.argv[1], sys.argv[2], sys.argv[3]
secret = pathlib.Path(secret_file).read_text().strip().split("=", 1)[1]
text = pathlib.Path(path).read_text()
updates = {
    "KEYCLOAK_USER_ADMIN_CLIENT_ID": client_id,
    "KEYCLOAK_USER_ADMIN_CLIENT_SECRET": secret,
}
for key, value in updates.items():
    if re.search(rf"^{re.escape(key)}=", text, re.M):
        text = re.sub(rf"^{re.escape(key)}=.*$", f"{key}={value}", text, count=1, flags=re.M)
    else:
        text = text.rstrip() + f"\n{key}={value}\n"
pathlib.Path(path).write_text(text)
print("env user-admin client secret updated (not printed)")
PY
rm -f /tmp/kc-useradmin.env
chmod 600 "$API_ENV"
echo "Restart the provision API to load KEYCLOAK_USER_ADMIN_CLIENT_SECRET."
echo TASK_ADM_USER_CLIENT_DONE
