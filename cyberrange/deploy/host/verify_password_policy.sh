#!/bin/bash
# Live evidence that the cyber-range realm enforces its password policy (SEC-04).
# Companion to enable_keycloak_password_policy.sh.
#
#   bash ~/cyberrange/deploy/host/verify_password_policy.sh | tee ~/pwpolicy-evidence.txt
#
# Creates a throwaway, DISABLED user (pwpolicy_probe_<random>) and tries to set
# passwords on it through the Keycloak Admin API -- the same reset-password
# call the portal's Admin console uses (keycloak_admin.set_password), which
# applies the same realm policy as Keycloak's own UPDATE_PASSWORD page:
#   1. too short (7 chars)                  -> rejected: minimum length
#   2. a common password ("password1")      -> rejected: blacklisted
#   3. blocklist is case-insensitive        -> "PassWord123" rejected: blacklisted
#   4. the username itself                  -> rejected: equal to the username
#   5. the email address                    -> rejected: equal to the email
#   6. a strong random password             -> accepted
#   7. re-using that same password          -> rejected: recent passwords
#   8. 129 characters                       -> rejected: maximum length
# A rejection only counts when Keycloak names THAT policy rule in its error;
# any other failure (expired kcadm token, missing user, bad flag) is a FAIL.
# Also prints the realm's brute-force settings. The lockout itself is checked
# by hand (see the PR's How to test), since probing it would lock an account.
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

# expect accept <label> <password>
# expect reject <label> <password> <regex Keycloak's error must match>
# The regexes accept both the message key (invalidPasswordMinLengthMessage)
# and its English text (Invalid password: minimum length 8.), whichever
# this kcadm version prints. -t/--temporary is a no-value flag on this kcadm
# (see create_demo_accounts.sh); leaving it out means "not temporary".
expect() {
  local want=$1 label=$2 pw=$3 reason=${4:-} out got
  if out=$(kcadm.sh set-password -r "$REALM" --username "$PROBE" --new-password "$pw" 2>&1); then
    got=accept
  else
    got=reject
  fi
  out=${out//"$pw"/<redacted>}
  if [[ "$want" == accept && "$got" == accept ]]; then
    echo "PASS  $label -> accepted"
  elif [[ "$want" == reject && "$got" == reject ]] && grep -Eqi -- "$reason" <<<"$out"; then
    echo "PASS  $label -> rejected ($(grep -Eoi -- "$reason" <<<"$out" | head -1))"
  else
    echo "FAIL  $label -> $got (expected $want${reason:+: /$reason/}); kcadm said: $(head -c 200 <<<"$out" | tr '\n' ' ')"
    FAIL=1
  fi
}

STRONG="$(head -c 24 /dev/urandom | base64 | tr -d '/+=' | head -c 20)Aa1!"
expect reject "7 characters"                  "Xk9#qv2"           'MinLength|minimum length'
expect reject "common password (blocklist)"   "password1"         'Blacklist'
expect reject "blocklist ignores case"        "PassWord123"       'Blacklist'
expect reject "same as username"              "$PROBE"            'NotUsername|equal to the username'
expect reject "same as email"                 "$EMAIL"            'NotEmail|equal to the email'
expect accept "strong random password"        "$STRONG"
expect reject "re-use of current password"    "$STRONG"           'History|last [0-9]+ passwords'
expect reject "129 characters"                "$(printf 'k%.0s' $(seq 1 129))" 'MaxLength|maximum length'

if [[ $FAIL -eq 0 ]]; then echo "PASSWORD_POLICY_VERIFIED"; else echo "PASSWORD_POLICY_FAILED"; fi
exit $FAIL
INNER
