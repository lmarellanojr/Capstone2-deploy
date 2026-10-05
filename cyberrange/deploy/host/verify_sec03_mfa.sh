#!/bin/bash
# SEC-03: live evidence that Keycloak demands a second factor from every user.
# Companion to enable_keycloak_mfa.sh and test_enable_keycloak_mfa.py.
#
#   bash ~/cyberrange/deploy/host/verify_sec03_mfa.sh | tee ~/sec03-evidence.txt
#
# Checks, in the cyber-range realm:
#   1. OTP policy is TOTP / HmacSHA1 / 6 digits / 30 s.
#   2. CONFIGURE_TOTP (the QR enrolment page) is enabled.
#   3. The bound browser flow has the OTP Form and its sub-flow REQUIRED.
#   4. For student_demo, instructor_demo and admin_demo: a real browser-style
#      login (authorization-code flow, username + password POSTed to the
#      Keycloak login form) does NOT end in a redirect carrying an auth code.
#      Keycloak must answer with either the OTP prompt (user already
#      enrolled) or the authenticator enrolment page (not enrolled yet).
#   5. If setup_verify_accounts.sh has run: the cyberrange-verify client has
#      no browser login and is bound to its gated direct-grant flow,
#      verify_student gets a token through it, and student_demo is REFUSED
#      through it even with the correct password and the client secret (so the
#      verify path can't be used to skip MFA for a real user).
#
# Read-only for the realm: step 4 opens login sessions but never completes
# enrolment or a login. Prints PASS/FAIL lines only -- never a password, a
# client secret, or the TOTP secret shown on the enrolment page.
set -uo pipefail
export PATH="/snap/bin:/usr/sbin:/usr/bin:/bin"
REPO=/home/llms_admin/cyberrange
CREDS_FILE=/home/llms_admin/cyberrange-data/demo-accounts.env
VERIFY_FILE=/home/llms_admin/cyberrange-data/verify-accounts.env
ADMIN_ENV="$REPO/deploy/keycloak/admin.env"

[[ -f "$CREDS_FILE" ]] || { echo "missing $CREDS_FILE -- run create_demo_accounts.sh first"; exit 1; }
[[ -f "$ADMIN_ENV" ]] || { echo "missing $ADMIN_ENV"; exit 1; }

lxc exec guacamole -- rm -f /tmp/kc-mfa-creds.env /tmp/kc-mfa-admin.env /tmp/kc-mfa-verify.env
lxc file push "$CREDS_FILE" guacamole/tmp/kc-mfa-creds.env </dev/null
lxc file push "$ADMIN_ENV" guacamole/tmp/kc-mfa-admin.env </dev/null
lxc exec guacamole -- chmod 600 /tmp/kc-mfa-creds.env /tmp/kc-mfa-admin.env
if [[ -f "$VERIFY_FILE" ]]; then
  lxc file push "$VERIFY_FILE" guacamole/tmp/kc-mfa-verify.env </dev/null
  lxc exec guacamole -- chmod 600 /tmp/kc-mfa-verify.env
fi

lxc exec guacamole -- bash -s <<'INNER'
set -uo pipefail
set -a
. /tmp/kc-mfa-creds.env
. /tmp/kc-mfa-admin.env
[ -f /tmp/kc-mfa-verify.env ] && . /tmp/kc-mfa-verify.env
set +a
rm -f /tmp/kc-mfa-creds.env /tmp/kc-mfa-admin.env /tmp/kc-mfa-verify.env
export PATH=/opt/keycloak/bin:/usr/bin:/bin
REALM=cyber-range
KC=http://127.0.0.1:8083/auth
FAILS=0
chk() {  # chk <label> <ok:0|1> [detail]
  if [ "$2" = 0 ]; then echo "PASS  $1${3:+ -> $3}"; else echo "FAIL  $1${3:+ -> $3}"; FAILS=$((FAILS+1)); fi
}

kcadm.sh config credentials --server "$KC" --realm master --user "$KEYCLOAK_ADMIN" --password "$KEYCLOAK_ADMIN_PASSWORD" >/dev/null

# --- 1. OTP policy ---
POLICY=$(kcadm.sh get "realms/$REALM" --fields otpPolicyType,otpPolicyAlgorithm,otpPolicyDigits,otpPolicyPeriod --format csv --noquotes | tail -1)
[ "$POLICY" = "totp,HmacSHA1,6,30" ]; chk "otp policy totp/HmacSHA1/6/30" $? "$POLICY"

# --- 2. enrolment page ---
TOTP_RA=$(kcadm.sh get authentication/required-actions/CONFIGURE_TOTP -r "$REALM" --fields enabled --format csv --noquotes | tail -1)
[ "$TOTP_RA" = "true" ]; chk "CONFIGURE_TOTP enabled" $? "$TOTP_RA"

# --- 3. browser flow ---
FLOW=$(kcadm.sh get "realms/$REALM" --fields browserFlow --format csv --noquotes | tail -1)
FLOW_URL=$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$FLOW")
FLOW_STATE=$(kcadm.sh get "authentication/flows/$FLOW_URL/executions" -r "$REALM" | python3 -c '
import json, sys
execs = json.load(sys.stdin)
i = next((i for i, e in enumerate(execs) if e.get("providerId") == "auth-otp-form"), None)
if i is None:
    print("no OTP Form"); sys.exit()
p = next(j for j in range(i - 1, -1, -1) if execs[j]["level"] < execs[i]["level"])
print(execs[p]["requirement"] + "/" + execs[i]["requirement"])')
[ "$FLOW_STATE" = "REQUIRED/REQUIRED" ]; chk "browser flow '$FLOW': OTP sub-flow/OTP Form" $? "$FLOW_STATE"

# --- 4. real login attempts stop at the second factor ---
PORTAL_CID=$(kcadm.sh get clients -r "$REALM" -q clientId=portal --fields id --format csv --noquotes | tail -1)
REDIRECT=$(kcadm.sh get "clients/$PORTAL_CID" -r "$REALM" --fields redirectUris | python3 -c '
import json, sys
uris = [u for u in json.load(sys.stdin).get("redirectUris", []) if u.startswith("http")]
print(uris[0].rstrip("*").rstrip("/") + "/api/auth/callback/keycloak" if uris else "")')
[ -n "$REDIRECT" ]; chk "portal client has a redirect URI to test with" $?

# Keycloak issues its login cookies with `Secure` and points the login form at
# its public HTTPS frontend URL, so the browser-style login has to run against
# that public origin end to end -- over the internal plain-HTTP port curl drops
# the Secure cookies and the form POST fails with HTTP 400. Find the public
# origin from the form action of one internal request.
PUBLIC_KC=$(curl -sS -G "$KC/realms/$REALM/protocol/openid-connect/auth" \
  --data-urlencode client_id=portal --data-urlencode response_type=code \
  --data-urlencode scope=openid --data-urlencode "redirect_uri=$REDIRECT" \
  | python3 -c '
import re, sys
m = re.search(r"id=\"kc-form-login\"[^>]*action=\"(https?://[^/\"]+)(/[^\"]*?)/realms/", sys.stdin.read())
print(m.group(1) + m.group(2) if m else "")')
[ -n "$PUBLIC_KC" ]; chk "public Keycloak origin found" $? "$PUBLIC_KC"

login_stage() {  # login_stage <user> <password> -> OTP_PROMPT | OTP_ENROL | LOGGED_IN_WITHOUT_OTP | ERROR:<why>
  local jar page action
  jar=$(mktemp); page=$(mktemp)
  curl -sS -c "$jar" -b "$jar" -o "$page" -G "$PUBLIC_KC/realms/$REALM/protocol/openid-connect/auth" \
    --data-urlencode client_id=portal --data-urlencode response_type=code \
    --data-urlencode scope=openid --data-urlencode "redirect_uri=$REDIRECT" \
    --data-urlencode state=sec03 --data-urlencode nonce=sec03
  action=$(python3 -c '
import html, re, sys
m = re.search(r"<form[^>]*id=\"kc-form-login\"[^>]*action=\"([^\"]+)\"", open(sys.argv[1]).read())
print(html.unescape(m.group(1)) if m else "")' "$page")
  if [ -z "$action" ]; then rm -f "$jar" "$page"; echo "ERROR:no login form"; return; fi
  local code hop
  code=$(curl -sS -c "$jar" -b "$jar" -o "$page" -w '%{http_code} %{redirect_url}' -X POST "$action" \
    --data-urlencode "username=$1" --data-urlencode "password=$2" --data-urlencode credentialId=)
  # Keycloak answers a required action (e.g. CONFIGURE_TOTP) with a 302 to its
  # own login-actions endpoint. Follow redirects that stay inside Keycloak;
  # stop at anything else (a redirect to the portal carrying `code=` is the
  # login completing, which must never happen here).
  for hop in 1 2 3; do
    case "$code" in
      3*" $PUBLIC_KC/"*) code=$(curl -sS -c "$jar" -b "$jar" -o "$page" -w '%{http_code} %{redirect_url}' "${code#* }") ;;
      *) break ;;
    esac
  done
  python3 -c '
import re, sys
status, _, location = sys.argv[1].partition(" ")
body = open(sys.argv[2]).read()
if status.startswith("3") and "code=" in location:
    print("LOGGED_IN_WITHOUT_OTP")
elif re.search(r"id=\"kc-totp-settings\"|name=\"totpSecret\"|kc-totp-secret", body):
    print("OTP_ENROL")
elif re.search(r"id=\"kc-otp-login-form\"|name=\"otp\"", body):
    print("OTP_PROMPT")
elif re.search(r"Invalid username or password", body):
    print("ERROR:bad demo password")
else:
    print("ERROR:unexpected page (HTTP " + status + ")")' "$code" "$page"
  rm -f "$jar" "$page"
}

for pair in "student_demo:${STUDENT_DEMO_PASSWORD:-}" "instructor_demo:${INSTRUCTOR_DEMO_PASSWORD:-}" "admin_demo:${ADMIN_DEMO_PASSWORD:-}"; do
  user=${pair%%:*}; pw=${pair#*:}
  if [ -z "$pw" ]; then chk "$user second factor demanded" 1 "no password in demo-accounts.env"; continue; fi
  stage=$(login_stage "$user" "$pw")
  case "$stage" in OTP_PROMPT|OTP_ENROL) ok=0 ;; *) ok=1 ;; esac
  chk "$user second factor demanded" $ok "$stage"
done

# --- 5. the verify scripts' password-grant path cannot skip MFA for real users ---
if [ -n "${VERIFY_CLIENT_SECRET:-}" ]; then
  verify_token() {  # verify_token <user> <password> -> OK | ERR:<reason>
    # A refusal by Deny access is HTTP 401 with an HTML page, not JSON.
    curl -sS -w '\n%{http_code}' -X POST "$KC/realms/$REALM/protocol/openid-connect/token" -d grant_type=password \
      -d "client_id=$VERIFY_CLIENT_ID" --data-urlencode "client_secret=$VERIFY_CLIENT_SECRET" \
      -d "username=$1" --data-urlencode "password=$2" -d scope=openid \
    | python3 -c '
import json, sys
body, _, status = sys.stdin.read().rpartition("\n")
try:
    d = json.loads(body)
except ValueError:
    print("ERR:HTTP " + status + " " + ("Access denied" if "Access denied" in body else "non-JSON response")); sys.exit()
print("OK" if d.get("access_token") else "ERR:HTTP " + status + " " + str(d.get("error_description", d.get("error", "?"))))'
  }
  VCID=$(kcadm.sh get clients -r "$REALM" -q "clientId=$VERIFY_CLIENT_ID" --fields id --format csv --noquotes | tail -1)
  VSTATE=$(kcadm.sh get "clients/$VCID" -r "$REALM" | python3 -c '
import json, sys
c = json.load(sys.stdin)
print("browser=%s implicit=%s service_account=%s password_grant=%s" % (
    c.get("standardFlowEnabled"), c.get("implicitFlowEnabled"),
    c.get("serviceAccountsEnabled"), c.get("directAccessGrantsEnabled")))
print(c.get("authenticationFlowBindingOverrides", {}).get("direct_grant", ""))')
  VFLOW_ID=$(echo "$VSTATE" | tail -1)
  VFLOW=$(kcadm.sh get authentication/flows -r "$REALM" | python3 -c '
import json, sys
print(next((f["alias"] for f in json.load(sys.stdin) if f["id"] == sys.argv[1]), ""))' "$VFLOW_ID")
  [ "$(echo "$VSTATE" | head -1)" = "browser=False implicit=False service_account=False password_grant=True" ]
  chk "$VERIFY_CLIENT_ID: password grant only" $? "$(echo "$VSTATE" | head -1)"
  [ "$VFLOW" = "cyberrange verify direct grant" ]; chk "$VERIFY_CLIENT_ID: direct grant bound to the gated flow" $? "${VFLOW:-none}"
  got=$(verify_token verify_student "$VERIFY_STUDENT_PASSWORD")
  [ "$got" = OK ]; chk "verify_student token through $VERIFY_CLIENT_ID" $? "$got"
  if [ -n "${STUDENT_DEMO_PASSWORD:-}" ]; then
    got=$(verify_token student_demo "$STUDENT_DEMO_PASSWORD")
    [[ $got == ERR:* ]]; chk "student_demo refused through $VERIFY_CLIENT_ID (right password + secret)" $? "$got"
  fi
else
  echo "SKIP  verify client checks (no verify-accounts.env; run setup_verify_accounts.sh)"
fi

echo "=== $FAILS failure(s) ==="
[ "$FAILS" = 0 ] && echo SEC03_MFA_VERIFIED || exit 1
INNER
