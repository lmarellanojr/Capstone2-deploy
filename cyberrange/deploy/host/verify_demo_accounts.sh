#!/bin/bash
# AUTH-03: verify the three demo accounts hold EXACTLY their intended realm
# role, no more, and that a signed-in JWT carries exactly that role.
#
# SEC-03 changed how this is checked. The demo accounts now need a TOTP code
# once they enrol MFA, so the script no longer signs in as them:
#   1. Demo accounts: their realm role mappings are read with kcadm (the same
#      mappings Keycloak puts in the token). No sign-in needed.
#   2. Token issuance: the SEC-03 verify accounts (verify_student,
#      verify_instructor, verify_admin from setup_verify_accounts.sh) sign in
#      with the password grant through the cyberrange-verify client, and their
#      JWT must carry exactly one application role. This is not the browser's
#      login path (that's PKCE/auth-code via NextAuth), but it exercises the
#      same token issuance and role mapping.
#
# Prints ONLY non-secret claims (username, realm roles). Never echoes a
# password or a client secret.
#
# NOT read-only: the login checks themselves are, but the script ends with a
# self-test that proves the exact-match check itself catches a multi-role
# account. It does this by temporarily granting verify_student a second role
# in Keycloak, confirming check_login reports ROLE_MISMATCH for it, then
# reverting and confirming the revert via a direct query. Without this
# self-test, a checker that always reports success regardless of extra roles
# would pass silently (see git history of this file -- that was exactly the
# bug this self-test exists to catch).
set -euo pipefail
export PATH="/snap/bin:/usr/sbin:/usr/bin:/bin"
REPO=/home/llms_admin/cyberrange
ENV_FILE="$REPO/env/.env"
CREDS_FILE=/home/llms_admin/cyberrange-data/verify-accounts.env
ADMIN_ENV="$REPO/deploy/keycloak/admin.env"

[[ -f "$ENV_FILE" ]] || { echo "missing $ENV_FILE"; exit 1; }
[[ -f "$CREDS_FILE" ]] || { echo "missing $CREDS_FILE -- run setup_verify_accounts.sh first"; exit 1; }
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
    -d "client_id=${VERIFY_CLIENT_ID}" \
    --data-urlencode "client_secret=${VERIFY_CLIENT_SECRET}" \
    -d "username=${username}" \
    --data-urlencode "password=${password}" \
    -d "scope=openid")

  access_token=$(echo "$resp" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("access_token",""))' 2>/dev/null || true)

  if [ -z "$access_token" ]; then
    local err
    err=$(echo "$resp" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("error_description", d.get("error","unknown")))' 2>/dev/null || echo "unparseable response")
    printf '%-18s LOGIN_FAILED: %s\n' "$username" "$err"
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
    printf '%-18s LOGIN_OK  username_claim=%-18s app_roles=%s (exactly the intended role)\n' \
      "$username" "$username_claim" "$app_roles"
    return 0
  else
    printf '%-18s ROLE_MISMATCH: expected exactly [%s], got [%s]\n' \
      "$username" "$expected_role" "$app_roles"
    return 1
  fi
}

kcadm.sh config credentials --server http://127.0.0.1:8083/auth --realm master --user "$KEYCLOAK_ADMIN" --password "$KEYCLOAK_ADMIN_PASSWORD"

# Same exact-match rule as check_login, on the realm role mapping itself.
check_mapping() {
  local username="$1" expected_role="$2" app_roles
  app_roles=$(kcadm.sh get-roles -r cyber-range --uusername "$username" --fields name --format csv --noquotes 2>/dev/null \
    | grep -E '^(student|instructor|admin)$' | sort | tr '\n' '/' || true)
  if [ "$app_roles" = "${expected_role}/" ]; then
    printf '%-18s MAPPING_OK  app_roles=%s (exactly the intended role)\n' "$username" "$app_roles"
    return 0
  fi
  printf '%-18s ROLE_MISMATCH: expected exactly [%s], got [%s]\n' "$username" "$expected_role" "$app_roles"
  return 1
}

overall_status=0
echo "=== AUTH-03 demo account role mappings ==="
check_mapping student_demo    student    || overall_status=1
check_mapping instructor_demo instructor || overall_status=1
check_mapping admin_demo      admin      || overall_status=1

echo "=== AUTH-03 login + JWT role verification (SEC-03 verify accounts) ==="
check_login verify_student    "$VERIFY_STUDENT_PASSWORD"    student    || overall_status=1
check_login verify_instructor "$VERIFY_INSTRUCTOR_PASSWORD" instructor || overall_status=1
check_login verify_admin      "$VERIFY_ADMIN_PASSWORD"      admin      || overall_status=1

echo "=== regression: exact-match check must reject a multi-role account ==="
echo "NOTE: this self-test temporarily mutates verify_student's Keycloak roles (grants"
echo "'instructor', then reverts) to prove the exact-match check works. Not read-only."

attempt_revert_regression() {
  kcadm.sh remove-roles -r cyber-range --uusername verify_student --rolename instructor 2>/dev/null || true
}
student_app_roles_regression() {
  kcadm.sh get-roles -r cyber-range --uusername verify_student --fields name --format csv --noquotes \
    | grep -E '^(student|instructor|admin)$' | sort | tr '\n' '/' || true
}
# Same confirm-in-trap fix as verify_role_refresh.sh: an early abort must not
# leave this only "attempted", it must confirm or explicitly log failure.
regression_reverted=0
finalize_regression_revert() {
  [ "$regression_reverted" -eq 1 ] && return 0
  attempt_revert_regression
  if [ "$(student_app_roles_regression)" != "student/" ]; then
    attempt_revert_regression
  fi
  local final_roles
  final_roles="$(student_app_roles_regression)"
  if [ "$final_roles" = "student/" ]; then
    regression_reverted=1
    echo "cleanup confirmed: verify_student app roles = $final_roles"
    return 0
  fi
  echo "CLEANUP_FAILED: verify_student app roles are [$final_roles] after two revert attempts, expected exactly [student/]"
  return 1
}
trap 'finalize_regression_revert || echo "EXIT_TRAP: cleanup could not be confirmed on exit -- MANUAL INTERVENTION REQUIRED for verify_student (expected app roles: student/)"' EXIT

kcadm.sh add-roles -r cyber-range --uusername verify_student --rolename instructor
check_login verify_student "$VERIFY_STUDENT_PASSWORD" student >/tmp/regression-out.txt 2>&1 || true
# A non-zero exit from check_login is NOT proof the exact-match logic caught
# the multi-role case -- it's equally what a network blip or bad credentials
# would produce (LOGIN_FAILED), which proves nothing about the check under
# test. Only an explicit ROLE_MISMATCH in the output counts as the self-test
# actually exercising and confirming the exact-match rejection.
if grep -q "ROLE_MISMATCH" /tmp/regression-out.txt; then
  echo "SELF_TEST_OK: checker correctly rejected the multi-role account:"
  cat /tmp/regression-out.txt
else
  echo "SELF_TEST_FAIL: expected ROLE_MISMATCH in output, got:"
  cat /tmp/regression-out.txt
  overall_status=1
fi
rm -f /tmp/regression-out.txt

finalize_regression_revert || overall_status=1
trap - EXIT

if [ "$overall_status" -eq 0 ]; then
  echo VERIFY_DONE
else
  echo "VERIFY_FAILED"
fi
exit "$overall_status"
INNER
