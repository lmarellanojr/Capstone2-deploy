#!/bin/bash
# AUTH-03: verify the three demo accounts can log in and that their
# authenticated JWT carries EXACTLY the intended realm role, no more. Uses
# the resource-owner password grant (directAccessGrantsEnabled=true on the
# "portal" client, see create_keycloak_realm.sh) purely as a verification
# probe -- this is not the browser's actual login path (that's PKCE/auth-code
# via NextAuth), but it exercises the same token issuance and role-mapping
# Keycloak does for any grant type, which is what AUTH-03 needs to confirm.
#
# Prints ONLY non-secret claims (username, realm roles). Never echoes the
# demo account passwords or the portal client secret.
#
# Ends with a self-test that proves the exact-match check itself catches a
# multi-role account: it temporarily grants student_demo a second role,
# confirms check_login reports FAIL for it, then reverts. Without this, a
# checker that always reports success regardless of extra roles would pass
# silently (see git history of this file -- that was exactly the bug).
set -euo pipefail
export PATH="/snap/bin:/usr/sbin:/usr/bin:/bin"
REPO=/home/llms_admin/cyberrange
ENV_FILE="$REPO/env/.env"
CREDS_FILE=/home/llms_admin/cyberrange-data/demo-accounts.env
ADMIN_ENV="$REPO/deploy/keycloak/admin.env"

[[ -f "$ENV_FILE" ]] || { echo "missing $ENV_FILE"; exit 1; }
[[ -f "$CREDS_FILE" ]] || { echo "missing $CREDS_FILE -- run create_demo_accounts.sh first"; exit 1; }
[[ -f "$ADMIN_ENV" ]] || { echo "missing $ADMIN_ENV"; exit 1; }

lxc exec guacamole -- rm -f /tmp/kc-verify-env.env /tmp/kc-verify-creds.env /tmp/kc-verify-admin.env
lxc file push "$ENV_FILE" guacamole/tmp/kc-verify-env.env </dev/null
lxc file push "$CREDS_FILE" guacamole/tmp/kc-verify-creds.env </dev/null
lxc file push "$ADMIN_ENV" guacamole/tmp/kc-verify-admin.env </dev/null
lxc exec guacamole -- chmod 600 /tmp/kc-verify-env.env /tmp/kc-verify-creds.env /tmp/kc-verify-admin.env

lxc exec guacamole -- bash -s <<'INNER'
set -euo pipefail
set -a
. /tmp/kc-verify-env.env
. /tmp/kc-verify-creds.env
. /tmp/kc-verify-admin.env
set +a
rm -f /tmp/kc-verify-env.env /tmp/kc-verify-creds.env /tmp/kc-verify-admin.env

TOKEN_URL="http://127.0.0.1:8083/auth/realms/cyber-range/protocol/openid-connect/token"
export PATH=/opt/keycloak/bin:$PATH

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

# Returns 0 and prints LOGIN_OK only if the account's application roles are
# EXACTLY {expected_role} -- not merely "expected_role is present among
# possibly several". Returns 1 and prints LOGIN_FAILED/ROLE_MISMATCH otherwise.
check_login() {
  local username="$1" password="$2" expected_role="$3"
  local resp access_token payload username_claim roles app_roles

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
  app_roles=$(echo "$roles" | tr ',' '\n' | grep -E '^(student|instructor|admin)$' | sort | tr '\n' '/' || true)

  # Exact-match check: the app_roles set must be exactly {expected_role}, not
  # merely contain it. "student/" (trailing slash from the join) is the only
  # passing shape for expected_role=student.
  if [ "$app_roles" = "${expected_role}/" ]; then
    printf '%-16s LOGIN_OK  username_claim=%-16s app_roles=%s (exactly the intended role)\n' \
      "$username" "$username_claim" "$app_roles"
    return 0
  else
    printf '%-16s ROLE_MISMATCH: expected exactly [%s], got [%s]\n' \
      "$username" "$expected_role" "$app_roles"
    return 1
  fi
}

echo "=== AUTH-03 login + JWT role verification ==="
overall_status=0
check_login student_demo    "$STUDENT_DEMO_PASSWORD"    student    || overall_status=1
check_login instructor_demo "$INSTRUCTOR_DEMO_PASSWORD" instructor || overall_status=1
check_login admin_demo      "$ADMIN_DEMO_PASSWORD"      admin      || overall_status=1

echo "=== regression: exact-match check must reject a multi-role account ==="
kcadm.sh config credentials --server http://127.0.0.1:8083/auth --realm master --user "$KEYCLOAK_ADMIN" --password "$KEYCLOAK_ADMIN_PASSWORD"
cleanup_done=0
revert_regression_role() {
  if [ "$cleanup_done" -eq 0 ]; then
    kcadm.sh remove-roles -r cyber-range --uusername student_demo --rolename instructor 2>/dev/null || true
    cleanup_done=1
  fi
}
trap revert_regression_role EXIT

kcadm.sh add-roles -r cyber-range --uusername student_demo --rolename instructor
if check_login student_demo "$STUDENT_DEMO_PASSWORD" student >/tmp/regression-out.txt 2>&1; then
  echo "SELF_TEST_FAIL: checker reported LOGIN_OK for a multi-role account -- exact-match logic is broken"
  cat /tmp/regression-out.txt
  rm -f /tmp/regression-out.txt
  overall_status=1
else
  echo "SELF_TEST_OK: checker correctly rejected the multi-role account:"
  cat /tmp/regression-out.txt
  rm -f /tmp/regression-out.txt
fi

revert_regression_role
# Direct final-state check -- don't just trust that remove-roles succeeded.
final_roles=$(kcadm.sh get-roles -r cyber-range --uusername student_demo --fields name --format csv --noquotes | grep -E '^(student|instructor|admin)$' | sort | tr '\n' '/' || true)
if [ "$final_roles" != "student/" ]; then
  echo "CLEANUP_FAILED: student_demo now has app roles [$final_roles], expected exactly [student/]"
  overall_status=1
else
  echo "cleanup confirmed: student_demo app roles = $final_roles"
fi
trap - EXIT

if [ "$overall_status" -eq 0 ]; then
  echo VERIFY_DONE
else
  echo "VERIFY_FAILED"
fi
exit "$overall_status"
INNER
