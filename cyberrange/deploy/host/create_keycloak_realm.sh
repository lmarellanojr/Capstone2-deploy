#!/bin/bash
# Create the cyber-range realm + portal client + student user. Secrets stay in
# 600 files and are never echoed. Idempotent for the realm and the user; note
# that RE-RUNNING MINTS A NEW CLIENT SECRET and rewrites env/.env with it, so the
# portal .env.local must be updated to match (Manual 04 Step 1e).
#
# Run on the LXD host, after install_keycloak_unit.sh, as the provision-api user.
# Moved here from the plans tree (it was ampere-task8-realm.sh) because Manual
# 04 depends on it and operational scripts live under deploy/.
set -euo pipefail
export PATH="/snap/bin:/usr/sbin:/usr/bin:/bin"
REPO=/home/llms_admin/cyberrange
ADMIN_ENV="$REPO/deploy/keycloak/admin.env"
CLIENT_SECRET=$(openssl rand -hex 24)
STUDENT_PW="St0d!$(openssl rand -hex 8)"

# Push secrets into guest without echoing them
umask 077
install -m 600 /dev/null /tmp/kc-seed.env
{
  echo "CLIENT_SECRET=${CLIENT_SECRET}"
  echo "STUDENT_PW=${STUDENT_PW}"
} > /tmp/kc-seed.env
lxc file push "$ADMIN_ENV" guacamole/tmp/admin.env </dev/null
lxc file push /tmp/kc-seed.env guacamole/tmp/kc-seed.env </dev/null
lxc exec guacamole -- chmod 600 /tmp/admin.env /tmp/kc-seed.env
rm -f /tmp/kc-seed.env

lxc exec guacamole -- bash -s <<'INNER'
set -euo pipefail
set -a
. /tmp/admin.env
. /tmp/kc-seed.env
set +a
export PATH=/opt/keycloak/bin:/usr/bin:/bin
kcadm.sh config credentials --server http://127.0.0.1:8083/auth --realm master --user "$KEYCLOAK_ADMIN" --password "$KEYCLOAK_ADMIN_PASSWORD"
kcadm.sh get realms/cyber-range >/dev/null 2>&1 || \
  kcadm.sh create realms -s realm=cyber-range -s enabled=true
# client
CID=$(kcadm.sh get clients -r cyber-range -q clientId=portal --fields id --format csv --noquotes 2>/dev/null | tail -1 || true)
if [ -z "$CID" ] || [ "$CID" = "id" ]; then
  kcadm.sh create clients -r cyber-range \
    -s clientId=portal \
    -s enabled=true \
    -s publicClient=false \
    -s secret="$CLIENT_SECRET" \
    -s protocol=openid-connect \
    -s standardFlowEnabled=true \
    -s directAccessGrantsEnabled=true \
    -s serviceAccountsEnabled=true \
    -s 'redirectUris=["http://10.115.77.1:3000/*"]' \
    -s 'webOrigins=["http://10.115.77.1:3000"]'
  echo CLIENT_CREATED
else
  kcadm.sh update "clients/$CID" -r cyber-range -s secret="$CLIENT_SECRET"
  echo CLIENT_UPDATED
fi
# student
if kcadm.sh get users -r cyber-range -q username=student --fields id --format csv --noquotes 2>/dev/null | grep -qv '^id$'; then
  echo STUDENT_EXISTS
else
  kcadm.sh create users -r cyber-range -s username=student -s enabled=true -s email=student@local \
    -s emailVerified=true -s firstName=Student -s lastName=User
fi
kcadm.sh set-password -r cyber-range --username student --new-password "$STUDENT_PW" --temporary false
kcadm.sh update authentication/required-actions/VERIFY_PROFILE -r cyber-range -s enabled=false -s defaultAction=false || true
rm -f /tmp/admin.env /tmp/kc-seed.env
echo REALM_OK
INNER

# persist secrets on host
python3 - "$REPO/env/.env" "$CLIENT_SECRET" <<'PY'
import pathlib, re, sys
path, secret = sys.argv[1], sys.argv[2]
text = pathlib.Path(path).read_text()
updates = {
    "KEYCLOAK_CLIENT_ID": "portal",
    "KEYCLOAK_CLIENT_SECRET": secret,
    "KEYCLOAK_INTROSPECT_URL": "http://10.115.77.12/auth/realms/cyber-range/protocol/openid-connect/token/introspect",
}
for key, value in updates.items():
    if re.search(rf"^{re.escape(key)}=", text, re.M):
        text = re.sub(rf"^{re.escape(key)}=.*$", f"{key}={value}", text, count=1, flags=re.M)
    else:
        text = text.rstrip() + f"\n{key}={value}\n"
pathlib.Path(path).write_text(text)
print("env client secret updated (not printed)")
PY
chmod 600 "$REPO/env/.env"
umask 077
printf 'STUDENT_USER=student\nSTUDENT_PASSWORD=%s\n' "$STUDENT_PW" > /home/llms_admin/cyberrange-data/student.env
chmod 600 /home/llms_admin/cyberrange-data/student.env
echo "student.env written (password not printed)"

echo "=== well-known ==="
curl -sS -o /tmp/oidc.json -w "HTTP %{http_code}\n" \
  http://10.115.77.12/auth/realms/cyber-range/.well-known/openid-configuration
python3 -c "import json; d=json.load(open('/tmp/oidc.json')); print('issuer', d.get('issuer'))" 2>/dev/null || head -c 200 /tmp/oidc.json; echo

echo "=== introspect smoke ==="
export KEYCLOAK_INTROSPECT_URL="http://10.115.77.12/auth/realms/cyber-range/protocol/openid-connect/token/introspect"
bash "$REPO/deploy/host/smoke_keycloak_introspect_host.sh"

echo "=== nginx listen / portal location (502 expected if portal down) ==="
lxc exec guacamole -- ss -ltn | grep 80 || true
curl -sS -o /dev/null -w "GET / HTTP %{http_code}\n" http://10.115.77.12/ || true
curl -sS -o /dev/null -w "GET /auth/ HTTP %{http_code}\n" http://10.115.77.12/auth/ || true
echo TASK8_REALM_DONE
