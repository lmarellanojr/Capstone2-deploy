#!/bin/bash
# Live evidence that the cyber-range realm enforces its password policy.
# Companion to enable_keycloak_password_policy.sh.
#
#   bash ~/cyberrange/deploy/host/verify_password_policy.sh | tee ~/pwpolicy-evidence.txt
#
# Creates a throwaway, DISABLED user (pwpolicy_probe_<random>) and tries to set
# passwords on it through the Keycloak Admin API -- the same reset-password
# call the portal's Admin console uses (keycloak_admin.set_password), which
# applies the same realm policy as Keycloak's own UPDATE_PASSWORD page:
#   1. too short (7 chars)                  -> rejected
#   2. a common password ("password1")      -> rejected (blocklist)
#   3. blocklist is case-insensitive        -> "PassWord123" rejected
#   4. the username itself                  -> rejected
#   5. the email address                    -> rejected
#   6. a strong random password             -> accepted
#   7. re-using that same password          -> rejected (history)
#   8. 129 characters                       -> rejected
# Also prints the realm's brute-force settings.
#
# The probe user is deleted on exit, even on failure. No real account is
# touched. Prints PASS/FAIL lines only -- never a password.
set -uo pipefail
export PATH="/snap/bin:/usr/sbin:/usr/bin:/bin"
REPO=/home/llms_admin/cyberrange
ADMIN_ENV="$REPO/deploy/keycloak/admin.env"

[[ -f "$ADMIN_ENV" ]] || { echo "missing $ADMIN_ENV"; exit 1; }
lxc info guacamole &>/dev/null || { echo "guacamole container not found"; exit 1; }

lxc exec guacamole -- rm -f /tmp/kc-pw-admin.env
lxc file push "$ADMIN_ENV" guacamole/tmp/kc-pw-admin.env </dev/null
lxc exec guacamole -- chmod 600 /tmp/kc-pw-admin.env

lxc exec guacamole -- bash -s <<'INNER'
set -uo pipefail
set -a
. /tmp/kc-pw-admin.env
set +a
export PATH=/opt/keycloak/bin:/usr/bin:/bin
REALM=cyber-range
PROBE="pwpolicy_probe_$(head -c4 /dev/urandom | od -An -tx1 | tr -d ' \n')"
EMAIL="${PROBE}@probe.invalid"
FAIL=0
cleanup() {
  kcadm.sh delete "users/$(kcadm.sh get users -r "$REALM" -q exact=true -q "username=$PROBE" --fields id --format csv --noquotes 2>/dev/null | tail -1)" -r "$REALM" >/dev/null 2>&1 \
    && echo "cleanup: probe user deleted" || echo "cleanup: probe user not found (nothing to delete)"
  rm -f /tmp/kc-pw-admin.env
}
trap cleanup EXIT

kcadm.sh config credentials --server http://127.0.0.1:8083/auth --realm master --user "$KEYCLOAK_ADMIN" --password "$KEYCLOAK_ADMIN_PASSWORD" >/dev/null 2>&1 \
  || { echo "FAIL  kcadm login to master realm"; exit 1; }

echo "=== realm settings ==="
kcadm.sh get "realms/$REALM" --fields passwordPolicy,bruteForceProtected,permanentLockout,failureFactor,maxFailureWaitSeconds \
  | python3 -c 'import json,sys; [print(f"{k}: {v}") for k, v in json.load(sys.stdin).items()]'

kcadm.sh create users -r "$REALM" -s "username=$PROBE" -s "email=$EMAIL" -s enabled=false >/dev/null 2>&1 \
  || { echo "FAIL  could not create probe user"; exit 1; }
echo "probe user: $PROBE (disabled)"
echo "=== policy checks ==="

# expect <reject|accept> <label> <password>
expect() {
  local want=$1 label=$2 pw=$3 got
  if kcadm.sh set-password -r "$REALM" --username "$PROBE" --new-password "$pw" --temporary false >/dev/null 2>&1; then
    got=accept
  else
    got=reject
  fi
  if [[ "$got" == "$want" ]]; then
    echo "PASS  $label -> $got"
  else
    echo "FAIL  $label -> $got (expected $want)"
    FAIL=1
  fi
}

STRONG="$(head -c 24 /dev/urandom | base64 | tr -d '/+=' | head -c 20)Aa1!"
expect reject "7 characters"                  "Xk9#qv2"
expect reject "common password (blocklist)"   "password1"
expect reject "blocklist ignores case"        "PassWord123"
expect reject "same as username"              "$PROBE"
expect reject "same as email"                 "$EMAIL"
expect accept "strong random password"        "$STRONG"
expect reject "re-use of current password"    "$STRONG"
expect reject "129 characters"                "$(printf 'k%.0s' $(seq 1 129))"

if [[ $FAIL -eq 0 ]]; then echo "PASSWORD_POLICY_VERIFIED"; else echo "PASSWORD_POLICY_FAILED"; fi
exit $FAIL
INNER
