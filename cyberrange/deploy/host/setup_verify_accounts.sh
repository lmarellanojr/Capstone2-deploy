#!/bin/bash
# SEC-03 (#144): an MFA-compatible path for the live verify_* scripts.
#
# Once SEC-03 is on, a demo account that has enrolled an authenticator needs a
# `totp` code for the password grant too, so the scripts that sign in with the
# password grant (verify_sec01_rbac.sh, verify_sec02_instructor_admin.sh,
# verify_adm_user.sh, verify_demo_accounts.sh, verify_role_refresh.sh) stop
# before checking anything. Exempting the demo accounts from MFA would weaken
# it for accounts real people sign in to, so this sets up a SEPARATE path:
#
#   - realm role `cyberrange-verify`: a marker. It is not an application role,
#     so the portal and the API ignore it (it grants nothing).
#   - three dedicated accounts, verify_student / verify_instructor /
#     verify_admin, each with exactly one application role plus the marker.
#   - confidential client `cyberrange-verify`: password grant only (no
#     browser login, no redirects, no service account). Its direct-grant flow
#     is overridden with the flow below.
#   - flow `cyberrange verify direct grant`: username, password, then a
#     CONDITIONAL sub-flow "User lacks role cyberrange-verify -> Deny access".
#     It has no OTP step, and it refuses every account WITHOUT the marker
#     role, so it cannot be used to skip MFA for a real user, even with a
#     correct password and the client secret.
#
# Nothing else changes: the browser flow (OTP REQUIRED for everyone) and the
# `portal` client's own direct-grant flow are left as they are. The verify
# accounts still get the OTP page if someone signs in to the portal with them
# in a browser.
#
# Idempotent. The flow is rebuilt on every run with the client's password
# grant switched off in the meantime. The client secret is not rotated, but
# the verify account passwords are regenerated on every run. Credentials go
# to a 600 file on the host and are never printed.
#
# Fails closed: before writing anything, it signs in with each verify account
# through the new client, then makes sure a throwaway account WITHOUT the
# marker role is refused. If that refusal does not happen, the client's
# password grant is switched off and the script exits non-zero.
#
# Run on the LXD host as the provision-api operator, after
# create_keycloak_realm.sh and enable_keycloak_mfa.sh. Then re-export the realm
# JSON (Manual 04 §5).
set -euo pipefail
export PATH="/snap/bin:/usr/sbin:/usr/bin:/bin"
REPO=/home/llms_admin/cyberrange
ADMIN_ENV="$REPO/deploy/keycloak/admin.env"
OUT_FILE=/home/llms_admin/cyberrange-data/verify-accounts.env
CLIENT_ID=cyberrange-verify

[[ -f "$ADMIN_ENV" ]] || { echo "missing $ADMIN_ENV"; exit 1; }
lxc info guacamole &>/dev/null || { echo "guacamole container not found"; exit 1; }

umask 077
trap 'rm -f /tmp/verify-seed.env /tmp/kc-verify-out.env' EXIT
install -m 600 /dev/null /tmp/verify-seed.env
{
  echo "VERIFY_STUDENT_PASSWORD=Vstu!$(openssl rand -hex 12)"
  echo "VERIFY_INSTRUCTOR_PASSWORD=Vins!$(openssl rand -hex 12)"
  echo "VERIFY_ADMIN_PASSWORD=Vadm!$(openssl rand -hex 12)"
  echo "PROBE_PASSWORD=Vprb!$(openssl rand -hex 12)"
} > /tmp/verify-seed.env
# Defensive: an interrupted earlier run can leave these owned by the
# exec-mapped uid, which makes `lxc file push` fail with "Error: Forbidden".
lxc exec guacamole -- rm -f /tmp/admin.env /tmp/verify-seed.env /tmp/kc-verify-out.env
lxc file push "$ADMIN_ENV" guacamole/tmp/admin.env </dev/null
lxc file push /tmp/verify-seed.env guacamole/tmp/verify-seed.env </dev/null
lxc exec guacamole -- chmod 600 /tmp/admin.env /tmp/verify-seed.env

lxc exec guacamole -- env CLIENT_ID="$CLIENT_ID" bash -s <<'INNER'
set -euo pipefail
set -a
. /tmp/admin.env
. /tmp/verify-seed.env
set +a
export PATH=/opt/keycloak/bin:/usr/bin:/bin
trap 'rm -f /tmp/admin.env /tmp/verify-seed.env /tmp/kc-exec.json' EXIT
REALM=cyber-range
KC=http://127.0.0.1:8083/auth
TOKEN_URL="$KC/realms/$REALM/protocol/openid-connect/token"
MARKER=cyberrange-verify
FLOW="cyberrange verify direct grant"
SUB="cyberrange verify - accounts only"
PROBE=verify_gate_probe
kcadm.sh config credentials --server "$KC" --realm master --user "$KEYCLOAK_ADMIN" --password "$KEYCLOAK_ADMIN_PASSWORD"

urlq() { python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$1"; }
client_uuid() {
  local id
  id=$(kcadm.sh get clients -r "$REALM" -q "clientId=$CLIENT_ID" --fields id --format csv --noquotes 2>/dev/null | tail -1 || true)
  [ "$id" = "id" ] && id=""
  echo "$id"
}
user_uuid() {
  local id
  id=$(kcadm.sh get users -r "$REALM" -q "username=$1" -q exact=true --fields id --format csv --noquotes 2>/dev/null | tail -1 || true)
  [ "$id" = "id" ] && id=""
  echo "$id"
}
grant_off() {  # switch the client's password grant off (no-op if the client does not exist)
  local cid; cid=$(client_uuid)
  [ -n "$cid" ] && kcadm.sh update "clients/$cid" -r "$REALM" -s directAccessGrantsEnabled=false
  return 0
}

# --- 1. marker role ---
kcadm.sh get "roles/$MARKER" -r "$REALM" >/dev/null 2>&1 || \
  kcadm.sh create roles -r "$REALM" -s "name=$MARKER" \
    -s "description=SEC-03 verify scripts only: may use the cyberrange-verify client. Grants no application access."

# --- 2. flow, rebuilt from scratch with the client's password grant off ---
grant_off
CID=$(client_uuid)
if [ -n "$CID" ]; then
  kcadm.sh update "clients/$CID" -r "$REALM" -s 'authenticationFlowBindingOverrides={}'
fi
OLD=$(kcadm.sh get authentication/flows -r "$REALM" | python3 -c '
import json, sys
print(next((f["id"] for f in json.load(sys.stdin) if f["alias"] == sys.argv[1]), ""))' "$FLOW")
[ -n "$OLD" ] && kcadm.sh delete "authentication/flows/$OLD" -r "$REALM"
kcadm.sh create authentication/flows -r "$REALM" -s "alias=$FLOW" -s providerId=basic-flow \
  -s topLevel=true -s builtIn=false \
  -s "description=SEC-03: password grant for cyberrange-verify accounts only; no OTP"
FLOW_URL=$(urlq "$FLOW"); SUB_URL=$(urlq "$SUB")
kcadm.sh create "authentication/flows/$FLOW_URL/executions/execution" -r "$REALM" -s provider=direct-grant-validate-username
kcadm.sh create "authentication/flows/$FLOW_URL/executions/execution" -r "$REALM" -s provider=direct-grant-validate-password
kcadm.sh create "authentication/flows/$FLOW_URL/executions/flow" -r "$REALM" \
  -s "alias=$SUB" -s type=basic-flow -s provider=registration-page-form
kcadm.sh create "authentication/flows/$SUB_URL/executions/execution" -r "$REALM" -s provider=conditional-user-role
kcadm.sh create "authentication/flows/$SUB_URL/executions/execution" -r "$REALM" -s provider=deny-access-authenticator

# Requirements: everything REQUIRED except the sub-flow, which is CONDITIONAL.
# Each update sends the FULL execution representation with only `requirement`
# changed (same as enable_keycloak_mfa.sh).
set_requirement() {  # set_requirement <displayName or providerId> <REQUIREMENT>
  kcadm.sh get "authentication/flows/$FLOW_URL/executions" -r "$REALM" | python3 -c '
import json, sys
key, req = sys.argv[1], sys.argv[2]
hits = [e for e in json.load(sys.stdin) if key in (e.get("displayName"), e.get("providerId"))]
if len(hits) != 1:
    sys.exit(f"VERIFY_FLOW_FAILED: expected 1 execution {key!r}, found {len(hits)}")
e = hits[0]
e["requirement"] = req
json.dump(e, open("/tmp/kc-exec.json", "w"))' "$1" "$2"
  kcadm.sh update "authentication/flows/$FLOW_URL/executions" -r "$REALM" -f /tmp/kc-exec.json
  rm -f /tmp/kc-exec.json
}
set_requirement direct-grant-validate-username REQUIRED
set_requirement direct-grant-validate-password REQUIRED
set_requirement "$SUB" CONDITIONAL
set_requirement conditional-user-role REQUIRED
set_requirement deny-access-authenticator REQUIRED

COND_ID=$(kcadm.sh get "authentication/flows/$FLOW_URL/executions" -r "$REALM" | python3 -c '
import json, sys
print(next(e["id"] for e in json.load(sys.stdin) if e.get("providerId") == "conditional-user-role"))')
kcadm.sh create "authentication/executions/$COND_ID/config" -r "$REALM" \
  -s alias=cyberrange-verify-lacks-marker -s "config.condUserRole=$MARKER" -s 'config.negate="true"'

FLOW_ID=$(kcadm.sh get authentication/flows -r "$REALM" | python3 -c '
import json, sys
print(next(f["id"] for f in json.load(sys.stdin) if f["alias"] == sys.argv[1]))' "$FLOW")
echo "=== $FLOW"
kcadm.sh get "authentication/flows/$FLOW_URL/executions" -r "$REALM" | python3 -c '
import json, sys
for e in json.load(sys.stdin):
    print("  " * e["level"] + "- " + str(e.get("displayName")) + " [" + str(e.get("requirement")) + "]")'

# --- 3. client: password grant only, bound to the flow above ---
# Same hardened list on create and update, so a re-run re-locks a client
# someone widened in the console. directAccessGrantsEnabled stays false until
# the gate is proven below.
HARDEN=(
  -s enabled=true
  -s publicClient=false
  -s protocol=openid-connect
  -s serviceAccountsEnabled=false
  -s standardFlowEnabled=false
  -s implicitFlowEnabled=false
  -s directAccessGrantsEnabled=false
  -s 'redirectUris=[]'
  -s 'webOrigins=[]'
  -s "authenticationFlowBindingOverrides={\"direct_grant\":\"$FLOW_ID\"}"
)
if [ -z "$CID" ]; then
  kcadm.sh create clients -r "$REALM" -s "clientId=$CLIENT_ID" "${HARDEN[@]}"
  CID=$(client_uuid)
  echo VERIFY_CLIENT_CREATED
else
  kcadm.sh update "clients/$CID" -r "$REALM" "${HARDEN[@]}"
  echo VERIFY_CLIENT_EXISTS_RELOCKED
fi
SECRET=$(kcadm.sh get "clients/$CID/client-secret" -r "$REALM" --fields value --format csv --noquotes | tail -1)
[ -n "$SECRET" ] && [ "$SECRET" != "value" ] || { echo "could not read client secret"; exit 1; }

# --- 4. verify accounts: exactly one application role + the marker ---
create_or_update_user() {  # <username> <role> <password>
  local username="$1" role="$2" pw="$3" current existing
  if [ -z "$(user_uuid "$username")" ]; then
    kcadm.sh create users -r "$REALM" -s "username=$username" -s enabled=true \
      -s "email=$username@local" -s emailVerified=true -s firstName=Verify -s "lastName=${role^}"
    echo "${username^^}_CREATED"
  else
    kcadm.sh update "users/$(user_uuid "$username")" -r "$REALM" -s enabled=true
    echo "${username^^}_EXISTS"
  fi
  kcadm.sh set-password -r "$REALM" --username "$username" --new-password "$pw"
  current=$(kcadm.sh get-roles -r "$REALM" --uusername "$username" --fields name --format csv --noquotes 2>/dev/null || true)
  for existing in student instructor admin; do
    if [ "$existing" != "$role" ] && echo "$current" | grep -qx "$existing"; then
      kcadm.sh remove-roles -r "$REALM" --uusername "$username" --rolename "$existing"
    fi
  done
  echo "$current" | grep -qx "$role" || kcadm.sh add-roles -r "$REALM" --uusername "$username" --rolename "$role"
  echo "$current" | grep -qx "$MARKER" || kcadm.sh add-roles -r "$REALM" --uusername "$username" --rolename "$MARKER"
}
create_or_update_user verify_student    student    "$VERIFY_STUDENT_PASSWORD"
create_or_update_user verify_instructor instructor "$VERIFY_INSTRUCTOR_PASSWORD"
create_or_update_user verify_admin      admin      "$VERIFY_ADMIN_PASSWORD"

# --- 5. prove the gate before switching the password grant on ---
# Probe the flow with the grant briefly on; any failure below switches it off.
trap 'grant_off; rm -f /tmp/admin.env /tmp/verify-seed.env /tmp/kc-exec.json; [ -n "$(user_uuid "$PROBE")" ] && kcadm.sh delete "users/$(user_uuid "$PROBE")" -r "$REALM"' EXIT
kcadm.sh update "clients/$CID" -r "$REALM" -s directAccessGrantsEnabled=true

try_token() {  # try_token <user> <password> -> "OK:<app roles>" or "ERR:<reason>"
  # Deny access answers the password grant with HTTP 401 and an HTML error
  # page, not JSON, so the status code is passed along and parsed separately.
  curl -sS -w '\n%{http_code}' -X POST "$TOKEN_URL" -d grant_type=password -d "client_id=$CLIENT_ID" \
    --data-urlencode "client_secret=$SECRET" -d "username=$1" --data-urlencode "password=$2" -d scope=openid \
  | python3 -c '
import base64, json, sys
body, _, status = sys.stdin.read().rpartition("\n")
try:
    d = json.loads(body)
except ValueError:
    print("ERR:HTTP " + status + " " + ("Access denied" if "Access denied" in body else "non-JSON response")); sys.exit()
t = d.get("access_token")
if not t:
    print("ERR:HTTP " + status + " " + str(d.get("error_description", d.get("error", "?")))); sys.exit()
p = t.split(".")[1]; p += "=" * (-len(p) % 4)
roles = json.loads(base64.urlsafe_b64decode(p)).get("realm_access", {}).get("roles", [])
print("OK:" + ",".join(sorted(r for r in roles if r in ("student", "instructor", "admin"))))'
}

FAILED=0
for pair in verify_student:student:VERIFY_STUDENT_PASSWORD verify_instructor:instructor:VERIFY_INSTRUCTOR_PASSWORD verify_admin:admin:VERIFY_ADMIN_PASSWORD; do
  IFS=: read -r u role pwvar <<<"$pair"
  got=$(try_token "$u" "${!pwvar}")
  if [ "$got" = "OK:$role" ]; then echo "PASS  $u signs in without a code -> app roles=$role"
  else echo "FAIL  $u -> $got (want OK:$role)"; FAILED=1; fi
done

# A real-looking account WITHOUT the marker must be refused even with the right
# password and the client secret. Throwaway user, deleted on exit.
[ -n "$(user_uuid "$PROBE")" ] && kcadm.sh delete "users/$(user_uuid "$PROBE")" -r "$REALM"
kcadm.sh create users -r "$REALM" -s "username=$PROBE" -s enabled=true
kcadm.sh set-password -r "$REALM" --username "$PROBE" --new-password "$PROBE_PASSWORD"
kcadm.sh add-roles -r "$REALM" --uusername "$PROBE" --rolename student
got=$(try_token "$PROBE" "$PROBE_PASSWORD")
if [[ $got == ERR:* ]]; then echo "PASS  account without $MARKER refused -> ${got#ERR:}"
else echo "FAIL  account without $MARKER got a token ($got): VERIFY_GATE_OPEN"; FAILED=1; fi

if [ "$FAILED" != 0 ]; then
  echo "VERIFY_SETUP_FAILED: password grant on $CLIENT_ID switched off"
  exit 1
fi
kcadm.sh delete "users/$(user_uuid "$PROBE")" -r "$REALM"
trap 'rm -f /tmp/admin.env /tmp/verify-seed.env /tmp/kc-exec.json' EXIT
echo "client: $(kcadm.sh get "clients/$CID" -r "$REALM" --fields publicClient,standardFlowEnabled,implicitFlowEnabled,directAccessGrantsEnabled,serviceAccountsEnabled --format csv --noquotes | tail -1)"

umask 077
printf 'SECRET=%s\n' "$SECRET" > /tmp/kc-verify-out.env
echo VERIFY_GATE_OK
INNER

umask 077
lxc file pull guacamole/tmp/kc-verify-out.env /tmp/kc-verify-out.env
lxc exec guacamole -- rm -f /tmp/kc-verify-out.env
. /tmp/verify-seed.env
SECRET=$(sed -n 's/^SECRET=//p' /tmp/kc-verify-out.env)
rm -f /tmp/kc-verify-out.env /tmp/verify-seed.env
{
  echo "VERIFY_CLIENT_ID=$CLIENT_ID"
  echo "VERIFY_CLIENT_SECRET=$SECRET"
  echo "VERIFY_STUDENT=verify_student"
  echo "VERIFY_STUDENT_PASSWORD=$VERIFY_STUDENT_PASSWORD"
  echo "VERIFY_INSTRUCTOR=verify_instructor"
  echo "VERIFY_INSTRUCTOR_PASSWORD=$VERIFY_INSTRUCTOR_PASSWORD"
  echo "VERIFY_ADMIN=verify_admin"
  echo "VERIFY_ADMIN_PASSWORD=$VERIFY_ADMIN_PASSWORD"
} > "$OUT_FILE"
chmod 600 "$OUT_FILE"
echo "credentials written to $OUT_FILE (not printed)"
echo TASK_SEC03_VERIFY_ACCOUNTS_DONE
