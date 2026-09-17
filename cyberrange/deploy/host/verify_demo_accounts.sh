#!/bin/bash
# AUTH-03: verify the three demo accounts can log in and that their
# authenticated JWT carries exactly the intended realm role. Uses the
# resource-owner password grant (directAccessGrantsEnabled=true on the
# "portal" client, see create_keycloak_realm.sh) purely as a verification
# probe -- this is not the browser's actual login path (that's PKCE/auth-code
# via NextAuth), but it exercises the same token issuance and role-mapping
# Keycloak does for any grant type, which is what AUTH-03 needs to confirm.
#
# Prints ONLY non-secret claims (username, realm roles). Never echoes the
# demo account passwords or the portal client secret. Read-only: issues
# tokens but makes no writes to Keycloak.
set -euo pipefail
export PATH="/snap/bin:/usr/sbin:/usr/bin:/bin"
REPO=/home/llms_admin/cyberrange
ENV_FILE="$REPO/env/.env"
CREDS_FILE=/home/llms_admin/cyberrange-data/demo-accounts.env

[[ -f "$ENV_FILE" ]] || { echo "missing $ENV_FILE"; exit 1; }
[[ -f "$CREDS_FILE" ]] || { echo "missing $CREDS_FILE -- run create_demo_accounts.sh first"; exit 1; }

lxc exec guacamole -- rm -f /tmp/kc-verify-env.env /tmp/kc-verify-creds.env
lxc file push "$ENV_FILE" guacamole/tmp/kc-verify-env.env </dev/null
lxc file push "$CREDS_FILE" guacamole/tmp/kc-verify-creds.env </dev/null
lxc exec guacamole -- chmod 600 /tmp/kc-verify-env.env /tmp/kc-verify-creds.env

lxc exec guacamole -- bash -s <<'INNER'
set -euo pipefail
set -a
. /tmp/kc-verify-env.env
. /tmp/kc-verify-creds.env
set +a
rm -f /tmp/kc-verify-env.env /tmp/kc-verify-creds.env

TOKEN_URL="http://127.0.0.1:8083/auth/realms/cyber-range/protocol/openid-connect/token"

b64url_decode() {
  # JWT payload is base64url, no padding
  local s="$1"
  local pad=$(( (4 - ${#s} % 4) % 4 ))
  s="${s}$(printf '=%.0s' $(seq 1 $pad) 2>/dev/null || true)"
  # printf, not echo: echo's trailing newline makes GNU base64 -d exit 1
  # ("invalid input") even though the decode itself is correct, which under
  # set -e silently killed the whole script before any check_login printed.
  printf '%s' "$s" | tr '_-' '/+' | base64 -d 2>/dev/null || true
}

check_login() {
  local username="$1" password="$2" expected_role="$3"
  local resp access_token payload username_claim roles

  resp=$(curl -sS -X POST "$TOKEN_URL" \
    -d "grant_type=password" \
    -d "client_id=${KEYCLOAK_CLIENT_ID}" \
    -d "client_secret=${KEYCLOAK_CLIENT_SECRET}" \
    -d "username=${username}" \
    -d "password=${password}" \
    -d "scope=openid")

  access_token=$(echo "$resp" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("access_token",""))' 2>/dev/null || true)

  if [ -z "$access_token" ]; then
    local err
    err=$(echo "$resp" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("error_description", d.get("error","unknown")))' 2>/dev/null || echo "unparseable response")
    printf '%-16s LOGIN_FAILED: %s\n' "$username" "$err"
    return 1
  fi

  payload=$(b64url_decode "$(echo "$access_token" | cut -d. -f2)")
  username_claim=$(echo "$payload" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("preferred_username",""))')
  roles=$(echo "$payload" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(",".join(sorted(d.get("realm_access",{}).get("roles",[]))))')

  local has_expected="NO"
  # `grep -qx ... && x=y` as a bare statement exits nonzero (and kills the
  # script under set -e) whenever the grep doesn't match -- guard with `|| true`.
  if echo "$roles" | tr ',' '\n' | grep -qx "$expected_role"; then has_expected="YES"; fi
  local app_roles
  app_roles=$(echo "$roles" | tr ',' '\n' | grep -E '^(student|instructor|admin)$' | tr '\n' '/' || true)

  printf '%-16s LOGIN_OK username_claim=%-16s expected_role=%-10s present=%-3s app_roles=%s\n' \
    "$username" "$username_claim" "$expected_role" "$has_expected" "$app_roles"
}

echo "=== AUTH-03 login + JWT role verification ==="
check_login student_demo    "$STUDENT_DEMO_PASSWORD"    student
check_login instructor_demo "$INSTRUCTOR_DEMO_PASSWORD" instructor
check_login admin_demo      "$ADMIN_DEMO_PASSWORD"      admin
echo VERIFY_DONE
INNER
