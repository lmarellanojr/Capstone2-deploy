#!/bin/bash
# Password policy + brute-force protection for the cyber-range realm (SEC-04).
# Companion to verify_password_policy.sh and test_enable_keycloak_password_policy.py.
#
#   bash ~/cyberrange/deploy/host/enable_keycloak_password_policy.sh
#
# Why: without a realm passwordPolicy Keycloak accepts ANY password on its own
# pages -- including the forced change after an Admin hands out a temporary
# password (UPDATE_PASSWORD), where a student could pick "a" or their username.
# The portal/API only enforce 8-128 characters on passwords an Admin types.
#
# The policy follows NIST SP 800-63B-4 and OWASP ASVS: length, a blocklist of
# common passwords, no reuse of the username/email or recent passwords, and NO
# composition rules (upper/digit/symbol) or periodic expiry, which both
# standards advise against. 8 is the floor because SEC-03 makes TOTP mandatory
# (NIST allows 8 when the password is one factor of MFA; 15 otherwise).
#
# Blocklist: deploy/keycloak/password-blacklists/cyberrange-common-passwords.txt,
# the SecLists 10k-most-common list (MIT) lower-cased, entries shorter than 8
# dropped (length() already rejects them), plus a few project words
# (cyberrange123, capstone2026, ...). Keycloak compares lower-cased, one
# password per line, no comments. install_keycloak_blocklist.sh puts it in the
# container. Keycloak caches a blocklist in the JVM, so when the file CHANGED
# this script restarts Keycloak (and waits for it) before touching the realm.
#
# Brute force: temporary lockout per account after 10 failures, growing from
# 1 min up to 15 min, never permanent (an Admin isn't needed to unlock).
#
# Idempotent. Prints settings only -- never a secret or a password.
#
# Run on the LXD host as the provision-api operator, after
# create_keycloak_realm.sh. Then re-export the realm JSON (Manual 04 §5) so a
# container recreate does not restore a realm without the policy. Recreate
# order is safe: push_keycloak_realm.sh installs the blocklist next to the
# realm JSON, so it is already there when --import-realm parses the policy at
# startup.
set -euo pipefail
export PATH="/snap/bin:/usr/sbin:/usr/bin:/bin"
REPO=/home/llms_admin/cyberrange
ADMIN_ENV="$REPO/deploy/keycloak/admin.env"
BLOCKLIST_NAME=cyberrange-common-passwords.txt

[[ -f "$ADMIN_ENV" ]] || { echo "missing $ADMIN_ENV"; exit 1; }
lxc info guacamole &>/dev/null || { echo "guacamole container not found"; exit 1; }

# --- 1. blocklist file (Keycloak checks it exists when the policy is saved) ---
BLOCKLIST_STATE=$(bash "$(dirname "$0")/install_keycloak_blocklist.sh" | tee /dev/stderr | tail -1)
if [[ "$BLOCKLIST_STATE" == BLOCKLIST_CHANGED ]] && lxc exec guacamole -- systemctl is-active --quiet keycloak.service; then
  echo "blocklist changed: restarting keycloak so it reloads the cached list"
  lxc exec guacamole -- systemctl restart keycloak.service
  deadline=$((SECONDS + 120))
  until lxc exec guacamole -- curl -fsS --max-time 3 \
          http://127.0.0.1:8083/auth/realms/master/.well-known/openid-configuration \
          >/dev/null 2>&1; do
    if (( SECONDS >= deadline )); then
      echo "ERROR: keycloak not ready after 120s"
      lxc exec guacamole -- journalctl -u keycloak.service -n 50 --no-pager
      exit 1
    fi
    sleep 5
  done
fi

# Defensive: an interrupted earlier run can leave this owned by the
# exec-mapped uid, which makes `lxc file push` fail with "Error: Forbidden".
lxc exec guacamole -- rm -f /tmp/admin.env
lxc file push "$ADMIN_ENV" guacamole/tmp/admin.env </dev/null
lxc exec guacamole -- chmod 600 /tmp/admin.env

lxc exec guacamole --env BLOCKLIST_NAME="$BLOCKLIST_NAME" -- bash -s <<'INNER'
set -euo pipefail
set -a
. /tmp/admin.env
set +a
export PATH=/opt/keycloak/bin:/usr/bin:/bin
trap 'rm -f /tmp/admin.env' EXIT
REALM=cyber-range
POLICY="length(8) and maxLength(128) and notUsername(undefined) and notEmail(undefined) and passwordHistory(3) and passwordBlacklist(${BLOCKLIST_NAME})"
# Exported so the verifier below checks exactly what was set.
export FAILURE_FACTOR=10 WAIT_INCREMENT_SECONDS=60 MAX_FAILURE_WAIT_SECONDS=900
kcadm.sh config credentials --server http://127.0.0.1:8083/auth --realm master --user "$KEYCLOAK_ADMIN" --password "$KEYCLOAK_ADMIN_PASSWORD"

# --- 2. password policy + brute-force protection ---
kcadm.sh update "realms/$REALM" \
  -s "passwordPolicy=$POLICY" \
  -s bruteForceProtected=true \
  -s permanentLockout=false \
  -s "failureFactor=$FAILURE_FACTOR" \
  -s "waitIncrementSeconds=$WAIT_INCREMENT_SECONDS" \
  -s "maxFailureWaitSeconds=$MAX_FAILURE_WAIT_SECONDS" \
  -s maxDeltaTimeSeconds=43200 \
  -s quickLoginCheckMilliSeconds=1000 \
  -s minimumQuickLoginWaitSeconds=60

# --- verify: re-read; fail loudly unless every clause and the lockout stuck ---
kcadm.sh get "realms/$REALM" \
  --fields passwordPolicy,bruteForceProtected,permanentLockout,failureFactor,waitIncrementSeconds,maxFailureWaitSeconds \
| python3 -c '
import json, os, re, sys
realm = json.load(sys.stdin)
policy = realm.get("passwordPolicy") or ""
print("passwordPolicy: " + (policy or "<none>"))
for k in ("bruteForceProtected", "permanentLockout", "failureFactor", "waitIncrementSeconds", "maxFailureWaitSeconds"):
    print(f"{k}: {realm.get(k)}")
clauses = dict(re.findall(r"(\w+)\(([^)]*)\)", policy))
problems = []

def at_least(name, floor):
    try:
        if int(clauses.get(name, 0)) < floor:
            problems.append(f"{name}(>={floor}) missing")
    except ValueError:
        problems.append(f"{name}() not a number")

at_least("length", 8)
at_least("maxLength", 64)
at_least("passwordHistory", 1)
for name in ("notUsername", "notEmail"):
    if name not in clauses:
        problems.append(f"{name} missing")
blocklist = os.environ["BLOCKLIST_NAME"]
if clauses.get("passwordBlacklist") != blocklist:
    problems.append(f"passwordBlacklist is not {blocklist}")
# NIST 800-63B-4 / ASVS: no composition rules, no forced expiry.
for name in ("upperCase", "lowerCase", "digits", "specialChars", "forceExpiredPasswordChange"):
    if name in clauses:
        problems.append(f"{name} present (composition/expiry rules are discouraged)")
if realm.get("bruteForceProtected") is not True:
    problems.append("bruteForceProtected is not true")
if realm.get("permanentLockout") is not False:
    problems.append("permanentLockout is not false")
for field, env in (("failureFactor", "FAILURE_FACTOR"),
                   ("waitIncrementSeconds", "WAIT_INCREMENT_SECONDS"),
                   ("maxFailureWaitSeconds", "MAX_FAILURE_WAIT_SECONDS")):
    if realm.get(field) != int(os.environ[env]):
        problems.append(f"{field} is {realm.get(field)}, expected {os.environ[env]}")
if problems:
    sys.exit("PASSWORD_POLICY_NOT_ENFORCED: " + "; ".join(problems))
print("PASSWORD_POLICY_ENFORCED")
'
echo PASSWORD_POLICY_SETUP_OK
INNER

echo "Next: run verify_password_policy.sh, then re-export the cyber-range realm JSON (Manual 04 §5)."
