#!/bin/bash
# SEC-03: require TOTP multi-factor authentication for EVERY cyber-range user
# (student, instructor, admin) at browser sign-in.
#
# What it changes in the cyber-range realm:
#   1. OTP policy: TOTP, HmacSHA1, 6 digits, 30 s period, look-ahead 1 --
#      the combination Google Authenticator / Microsoft Authenticator /
#      FreeOTP all accept.
#   2. CONFIGURE_TOTP required action: enabled (it is what renders the
#      QR-code enrolment page).
#   3. Browser flow: the "Conditional OTP" sub-flow goes CONDITIONAL ->
#      REQUIRED and its OTP Form -> REQUIRED; its "user configured" condition
#      is DISABLED (Keycloak ignores conditions outside a CONDITIONAL flow
#      anyway -- disabling it just makes the console show the real behaviour).
#
# Why the flow and not just a default required action: a REQUIRED OTP Form
# makes Keycloak itself send any user without an OTP credential through
# CONFIGURE_TOTP on their next browser login -- existing users, demo
# accounts, users created by the Admin console (keycloak_admin.py) and users
# created by kcadm all included, with no per-user backfill. It also means a
# user who deletes their authenticator in the account console is made to
# enrol again instead of silently dropping back to password-only.
#
# Deliberately NOT changed: the direct-grant (password grant) flow. Only the
# confidential `portal` client allows that grant, so it needs the client
# secret that lives on the server; the live verify_* scripts use it. A user
# who has NOT enrolled yet still gets a password-grant token there; once a
# user enrols, Keycloak's own "Direct Grant - Conditional OTP" asks for a
# `totp` code on that path too.
#
# Idempotent. Prints settings only -- never a secret.
#
# Run on the LXD host as the provision-api operator, after
# create_keycloak_realm.sh. Then re-export the realm JSON (Manual 04 §5) so a
# container recreate + push_keycloak_realm.sh does not restore a realm
# without MFA.
set -euo pipefail
export PATH="/snap/bin:/usr/sbin:/usr/bin:/bin"
REPO=/home/llms_admin/cyberrange
ADMIN_ENV="$REPO/deploy/keycloak/admin.env"

[[ -f "$ADMIN_ENV" ]] || { echo "missing $ADMIN_ENV"; exit 1; }
lxc info guacamole &>/dev/null || { echo "guacamole container not found"; exit 1; }

# Defensive: an interrupted earlier run can leave this owned by the
# exec-mapped uid, which makes `lxc file push` fail with "Error: Forbidden".
lxc exec guacamole -- rm -f /tmp/admin.env
lxc file push "$ADMIN_ENV" guacamole/tmp/admin.env </dev/null
lxc exec guacamole -- chmod 600 /tmp/admin.env

lxc exec guacamole -- bash -s <<'INNER'
set -euo pipefail
set -a
. /tmp/admin.env
set +a
export PATH=/opt/keycloak/bin:/usr/bin:/bin
trap 'rm -f /tmp/admin.env /tmp/kc-exec-*.json' EXIT
REALM=cyber-range
kcadm.sh config credentials --server http://127.0.0.1:8083/auth --realm master --user "$KEYCLOAK_ADMIN" --password "$KEYCLOAK_ADMIN_PASSWORD"

# --- 1. OTP policy ---
kcadm.sh update "realms/$REALM" \
  -s otpPolicyType=totp \
  -s otpPolicyAlgorithm=HmacSHA1 \
  -s otpPolicyDigits=6 \
  -s otpPolicyPeriod=30 \
  -s otpPolicyLookAheadWindow=1
echo "otp policy: $(kcadm.sh get "realms/$REALM" --fields otpPolicyType,otpPolicyAlgorithm,otpPolicyDigits,otpPolicyPeriod,otpPolicyLookAheadWindow --format csv --noquotes | tail -1)"

# --- 2. enrolment page ---
kcadm.sh update authentication/required-actions/CONFIGURE_TOTP -r "$REALM" -s enabled=true
echo "CONFIGURE_TOTP: $(kcadm.sh get authentication/required-actions/CONFIGURE_TOTP -r "$REALM" --fields enabled,defaultAction --format csv --noquotes | tail -1)"

# --- 3. browser flow: OTP required for everyone ---
# Use whatever flow the realm has bound for browser login, not a hard-coded
# "browser" -- a console-made copy may be bound instead.
FLOW=$(kcadm.sh get "realms/$REALM" --fields browserFlow --format csv --noquotes | tail -1)
FLOW_URL=$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$FLOW")
echo "browser flow: $FLOW"

# Plan the edits from the flat execution list (level + order give the tree).
# Each update is the FULL execution representation with only `requirement`
# changed: a partial body can reset fields such as priority on newer
# Keycloak releases.
kcadm.sh get "authentication/flows/$FLOW_URL/executions" -r "$REALM" \
| python3 -c '
import json, sys
execs = json.load(sys.stdin)
otp = [i for i, e in enumerate(execs) if e.get("providerId") == "auth-otp-form"]
if len(otp) != 1:
    sys.exit(f"MFA_PLAN_FAILED: expected exactly 1 OTP Form in the browser flow, found {len(otp)}")
i = otp[0]
lvl = execs[i]["level"]
parent = next((j for j in range(i - 1, -1, -1) if execs[j]["level"] < lvl), None)
if parent is None or not execs[parent].get("authenticationFlow"):
    sys.exit("MFA_PLAN_FAILED: OTP Form is not inside a sub-flow")
want = {parent: "REQUIRED", i: "REQUIRED"}
# Sibling conditions of the OTP Form inside that sub-flow.
for j in range(parent + 1, len(execs)):
    if execs[j]["level"] <= execs[parent]["level"]:
        break
    if execs[j]["level"] == lvl and str(execs[j].get("providerId", "")).startswith("conditional-"):
        want[j] = "DISABLED"
n = 0
for j, req in sorted(want.items()):
    e = execs[j]
    name = e.get("displayName")
    if e.get("requirement") == req:
        print(f"unchanged  {name}: {req}", file=sys.stderr)
        continue
    e["requirement"] = req
    n += 1
    with open(f"/tmp/kc-exec-{n}.json", "w") as f:
        json.dump(e, f)
    print(f"update     {name}: -> {req}", file=sys.stderr)
'
for body in /tmp/kc-exec-*.json; do
  [ -e "$body" ] || continue
  kcadm.sh update "authentication/flows/$FLOW_URL/executions" -r "$REALM" -f "$body"
  rm -f "$body"
done

# --- verify: re-read; fail loudly unless the OTP Form and its sub-flow are REQUIRED ---
kcadm.sh get "authentication/flows/$FLOW_URL/executions" -r "$REALM" \
| python3 -c '
import json, sys
execs = json.load(sys.stdin)
print("=== browser flow after change ===")
for e in execs:
    print("  " * e["level"] + "- " + str(e.get("displayName")) + " [" + str(e.get("requirement")) + "]")
i = next(i for i, e in enumerate(execs) if e.get("providerId") == "auth-otp-form")
parent = next(j for j in range(i - 1, -1, -1) if execs[j]["level"] < execs[i]["level"])
if execs[i]["requirement"] != "REQUIRED" or execs[parent]["requirement"] != "REQUIRED":
    sys.exit("MFA_NOT_ENFORCED: OTP Form or its sub-flow is not REQUIRED")
print("MFA_ENFORCED")
'
echo MFA_SETUP_OK
INNER

echo "Next: re-export the cyber-range realm JSON (Manual 04 §5) so a container recreate keeps MFA."
