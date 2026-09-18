#!/bin/bash
# AUTH-03: validate that a role change is reflected on token refresh, not just
# on next login. This is the exact behavior portal/src/lib/auth.ts relies on
# (doRefresh() re-decodes roles from the freshly-issued token rather than
# carrying forward the roles captured at initial sign-in).
#
# Method: get an initial token pair for student_demo, decode its roles
# (expect only "student"), temporarily grant it "instructor" too, use the
# REFRESH token (not a fresh login) to mint a new access token, decode again
# (expect "student" AND "instructor" now present), then revoke "instructor"
# again so the account is restored to the single-role state the frozen
# contract (docs/AUTH-03-role-contract.md) requires. Read/write against a
# demo account's role assignment only; no other user or config touched.
# Prints usernames/roles/pass-fail only -- never passwords.
set -euo pipefail
export PATH="/snap/bin:/usr/sbin:/usr/bin:/bin"
REPO=/home/llms_admin/cyberrange
ENV_FILE="$REPO/env/.env"
CREDS_FILE=/home/llms_admin/cyberrange-data/demo-accounts.env
ADMIN_ENV="$REPO/deploy/keycloak/admin.env"

[[ -f "$ENV_FILE" ]] || { echo "missing $ENV_FILE"; exit 1; }
[[ -f "$CREDS_FILE" ]] || { echo "missing $CREDS_FILE -- run create_demo_accounts.sh first"; exit 1; }
[[ -f "$ADMIN_ENV" ]] || { echo "missing $ADMIN_ENV"; exit 1; }

lxc exec guacamole -- rm -f /tmp/rr-env.env /tmp/rr-creds.env /tmp/rr-admin.env
lxc file push "$ENV_FILE" guacamole/tmp/rr-env.env </dev/null
lxc file push "$CREDS_FILE" guacamole/tmp/rr-creds.env </dev/null
lxc file push "$ADMIN_ENV" guacamole/tmp/rr-admin.env </dev/null
lxc exec guacamole -- chmod 600 /tmp/rr-env.env /tmp/rr-creds.env /tmp/rr-admin.env

lxc exec guacamole -- bash -s <<'INNER'
set -euo pipefail
set -a
. /tmp/rr-env.env
. /tmp/rr-creds.env
. /tmp/rr-admin.env
set +a
rm -f /tmp/rr-env.env /tmp/rr-creds.env /tmp/rr-admin.env

TOKEN_URL="http://127.0.0.1:8083/auth/realms/cyber-range/protocol/openid-connect/token"
export PATH=/opt/keycloak/bin:$PATH

decode_roles() {
  local access_token="$1" seg pad padded
  seg=$(echo "$access_token" | cut -d. -f2)
  pad=$(( (4 - ${#seg} % 4) % 4 ))
  padded="${seg}$(printf '=%.0s' $(seq 1 $pad) 2>/dev/null || true)"
  # base64 -d can exit nonzero on this input even when its output is fine
  # (same quirk hit in verify_demo_accounts.sh) -- with pipefail that would
  # otherwise kill the whole pipeline despite python3 succeeding, so guard it.
  printf '%s' "$padded" | tr '_-' '/+' | base64 -d 2>/dev/null \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); print(",".join(sorted(d.get("realm_access",{}).get("roles",[]))))' \
    || true
}

echo "=== AUTH-03 role refresh validation (student_demo) ==="

resp=$(curl -sS -X POST "$TOKEN_URL" \
  -d grant_type=password -d client_id="$KEYCLOAK_CLIENT_ID" -d client_secret="$KEYCLOAK_CLIENT_SECRET" \
  -d username=student_demo -d password="$STUDENT_DEMO_PASSWORD" -d scope=openid)
access_token=$(echo "$resp" | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')
refresh_token=$(echo "$resp" | python3 -c 'import json,sys; print(json.load(sys.stdin)["refresh_token"])')
before_roles=$(decode_roles "$access_token")
echo "before refresh: roles=$before_roles"

kcadm.sh config credentials --server http://127.0.0.1:8083/auth --realm master --user "$KEYCLOAK_ADMIN" --password "$KEYCLOAK_ADMIN_PASSWORD"

# Best-effort revocation attempt only -- NOT proof of success on its own.
attempt_revert() {
  kcadm.sh remove-roles -r cyber-range --uusername student_demo --rolename instructor 2>/dev/null || true
}

# Direct final-state check via a fresh admin query -- not an assumption from
# the removal command's own exit code.
student_app_roles() {
  kcadm.sh get-roles -r cyber-range --uusername student_demo --fields name --format csv --noquotes \
    | grep -E '^(student|instructor|admin)$' | sort | tr '\n' '/' || true
}

# Confirm-and-revert, callable from BOTH the normal flow and the EXIT trap.
# (Shekinah re-review: the previous trap only called attempt_revert blindly on
# an early abort -- e.g. curl failing under set -e while requesting the
# refreshed token -- with no confirmation and no failure logged. This is now
# the single path either one uses, so an early abort gets the same
# retry-then-verify treatment as the normal path, and always ends by either
# confirming success or explicitly logging CLEANUP_FAILED.)
confirmed_reverted=0
finalize_revert() {
  [ "$confirmed_reverted" -eq 1 ] && return 0
  attempt_revert
  if [ "$(student_app_roles)" != "student/" ]; then
    attempt_revert
  fi
  local final_check
  final_check="$(student_app_roles)"
  if [ "$final_check" = "student/" ]; then
    confirmed_reverted=1
    echo "reverted: confirmed student_demo app roles = $final_check"
    return 0
  fi
  echo "CLEANUP_FAILED: student_demo app roles are [$final_check] after two revert attempts, expected exactly [student/]"
  return 1
}
trap 'finalize_revert || echo "EXIT_TRAP: cleanup could not be confirmed on exit -- MANUAL INTERVENTION REQUIRED for student_demo (expected app roles: student/)"' EXIT

kcadm.sh add-roles -r cyber-range --uusername student_demo --rolename instructor
echo "granted: temporary extra role 'instructor' on student_demo"

resp2=$(curl -sS -X POST "$TOKEN_URL" \
  -d grant_type=refresh_token -d client_id="$KEYCLOAK_CLIENT_ID" -d client_secret="$KEYCLOAK_CLIENT_SECRET" \
  -d refresh_token="$refresh_token")
new_access_token=$(echo "$resp2" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("access_token",""))')

if ! finalize_revert; then
  echo "RESULT: FAIL -- role-refresh test cannot be considered passed while cleanup is unconfirmed"
  exit 1
fi

if [ -z "$new_access_token" ]; then
  echo "REFRESH_FAILED: $(echo "$resp2" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("error_description", d.get("error","unknown")))' 2>/dev/null || echo "unparseable response")"
  exit 1
fi
after_roles=$(decode_roles "$new_access_token")
echo "after refresh:  roles=$after_roles"

if echo "$after_roles" | tr ',' '\n' | grep -qx instructor; then
  echo "RESULT: PASS -- refreshed token reflects the role change without re-login"
else
  echo "RESULT: FAIL -- refreshed token did NOT pick up the role change"
  exit 1
fi

echo ROLE_REFRESH_VERIFY_DONE
INNER
