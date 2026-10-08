#!/bin/bash
# Password policy + brute-force protection for the cyber-range realm.
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
# password per line, no comments.
#
# Brute force: temporary lockout per account after 10 failures, growing from
# 1 min up to 15 min, never permanent (an Admin isn't needed to unlock).
#
# Idempotent. Prints settings only -- never a secret or a password.
#
# Run on the LXD host as the provision-api operator, after
# create_keycloak_realm.sh. Then re-export the realm JSON (Manual 04 §5) so a
# container recreate + push_keycloak_realm.sh does not restore a realm
# without the policy. The blocklist file lives outside the realm JSON: re-run
# this script after a container recreate too.
set -euo pipefail
export PATH="/snap/bin:/usr/sbin:/usr/bin:/bin"
REPO=/home/llms_admin/cyberrange
ADMIN_ENV="$REPO/deploy/keycloak/admin.env"
BLOCKLIST_NAME=cyberrange-common-passwords.txt
BLOCKLIST_SRC="$REPO/deploy/keycloak/password-blacklists/$BLOCKLIST_NAME"
BLOCKLIST_DIR=/opt/keycloak/data/password-blacklists

[[ -f "$ADMIN_ENV" ]] || { echo "missing $ADMIN_ENV"; exit 1; }
[[ -f "$BLOCKLIST_SRC" ]] || { echo "missing $BLOCKLIST_SRC"; exit 1; }
lxc info guacamole &>/dev/null || { echo "guacamole container not found"; exit 1; }
lxc exec guacamole -- id keycloak &>/dev/null || {
  echo "in-container 'keycloak' user missing -- run install_keycloak_unit.sh first"
  exit 1
}

# --- 1. blocklist file (Keycloak checks it exists when the policy is saved) ---
lxc exec guacamole -- mkdir -p "$BLOCKLIST_DIR"
lxc file push "$BLOCKLIST_SRC" "guacamole${BLOCKLIST_DIR}/${BLOCKLIST_NAME}" </dev/null
lxc exec guacamole -- chown -R keycloak:keycloak "$BLOCKLIST_DIR"
lxc exec guacamole -- chmod 644 "${BLOCKLIST_DIR}/${BLOCKLIST_NAME}"
lxc exec guacamole -- sudo -u keycloak test -r "${BLOCKLIST_DIR}/${BLOCKLIST_NAME}" \
  && echo "blocklist readable by keycloak: OK ($(wc -l <"$BLOCKLIST_SRC") entries)" \
  || { echo "ERROR: keycloak cannot read ${BLOCKLIST_DIR}/${BLOCKLIST_NAME}"; exit 1; }

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
kcadm.sh config credentials --server http://127.0.0.1:8083/auth --realm master --user "$KEYCLOAK_ADMIN" --password "$KEYCLOAK_ADMIN_PASSWORD"

# --- 2. password policy + brute-force protection ---
kcadm.sh update "realms/$REALM" \
  -s "passwordPolicy=$POLICY" \
  -s bruteForceProtected=true \
  -s permanentLockout=false \
  -s failureFactor=10 \
  -s waitIncrementSeconds=60 \
  -s maxFailureWaitSeconds=900 \
  -s maxDeltaTimeSeconds=43200 \
  -s quickLoginCheckMilliSeconds=1000 \
  -s minimumQuickLoginWaitSeconds=60

# --- verify: re-read; fail loudly unless every clause and the lockout stuck ---
kcadm.sh get "realms/$REALM" \
  --fields passwordPolicy,bruteForceProtected,permanentLockout,failureFactor,waitIncrementSeconds,maxFailureWaitSeconds \
| python3 -c '
import json, re, sys
realm = json.load(sys.stdin)
policy = realm.get("passwordPolicy") or ""
print("passwordPolicy: " + (policy or "<none>"))
for k in ("bruteForceProtected", "permanentLockout", "failureFactor", "waitIncrementSeconds", "maxFailureWaitSeconds"):
    print(f"{k}: {realm.get(k)}")
clauses = dict(re.findall(r"(\w+)\(([^)]*)\)", policy))
problems = []
try:
    if int(clauses.get("length", 0)) < 8:
        problems.append("length(>=8) missing")
except ValueError:
    problems.append("length() not a number")
try:
    if int(clauses.get("maxLength", 0)) < 64:
        problems.append("maxLength(>=64) missing")
except ValueError:
    problems.append("maxLength() not a number")
for name in ("notUsername", "notEmail", "passwordHistory", "passwordBlacklist"):
    if name not in clauses:
        problems.append(f"{name} missing")
# NIST 800-63B-4 / ASVS: no composition rules, no forced expiry.
for name in ("upperCase", "lowerCase", "digits", "specialChars", "forceExpiredPasswordChange"):
    if name in clauses:
        problems.append(f"{name} present (composition/expiry rules are discouraged)")
if realm.get("bruteForceProtected") is not True:
    problems.append("bruteForceProtected is not true")
if realm.get("permanentLockout") is not False:
    problems.append("permanentLockout is not false")
if problems:
    sys.exit("PASSWORD_POLICY_NOT_ENFORCED: " + "; ".join(problems))
print("PASSWORD_POLICY_ENFORCED")
'
echo PASSWORD_POLICY_SETUP_OK
INNER

echo "Next: run verify_password_policy.sh, then re-export the cyber-range realm JSON (Manual 04 §5)."
