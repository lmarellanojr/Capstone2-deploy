#!/bin/bash
# ADM-USER (#32): live verification of Admin user & role management against
# the real Keycloak + provision API. Companion to verify_demo_accounts.sh.
#
# Run on the LXD host after setup_user_admin_client.sh and a provision API
# restart:
#   bash ~/cyberrange/deploy/host/verify_adm_user.sh | tee ~/adm-user-evidence.txt
#
# Prints HTTP codes and non-secret fields only -- never tokens, passwords or
# client secrets; Keycloak user ids are masked as <id>. Tokens are fetched
# through the same Keycloak URL the API introspects against
# (KEYCLOAK_INTROSPECT_URL), so issuer/introspection behaviour matches prod.
#
# NOT read-only: creates one throwaway user per run (adm_user_test_<HHMMSS>),
# changes its role, disables/enables it, and leaves it DISABLED. It never
# modifies the demo accounts. Takes ~2.5 min: two 61s waits let the API's
# 60s introspection cache expire before checking that revoked tokens fail.
set -uo pipefail
REPO=/home/llms_admin/cyberrange
set -a; . "$REPO/env/.env"; . /home/llms_admin/cyberrange-data/demo-accounts.env; set +a
API="http://${API_BIND_HOST}:${API_BIND_PORT}"
TOKEN_URL="${KEYCLOAK_INTROSPECT_URL%/introspect}"
RESP=$(mktemp); chmod 600 "$RESP"; trap 'rm -f "$RESP"' EXIT
TEST_USER="adm_user_test_$(date +%H%M%S)"
TEST_PW="Adm!$(openssl rand -hex 8)"
NOBODY=00000000-0000-0000-0000-000000000000
FAILS=0

token() {  # token <user> <password> -> access token, or "ERR:<reason>"
  curl -sS -X POST "$TOKEN_URL" -d grant_type=password \
    -d "client_id=$KEYCLOAK_CLIENT_ID" -d "client_secret=$KEYCLOAK_CLIENT_SECRET" \
    -d "username=$1" -d "password=$2" -d scope=openid \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("access_token") or "ERR:"+d.get("error_description", d.get("error","?")))'
}

roles_of() {  # app roles in a JWT, decoded locally
  python3 -c 'import base64,json,sys
p=sys.argv[1].split(".")[1]; p+="="*(-len(p)%4)
r=json.loads(base64.urlsafe_b64decode(p))["realm_access"]["roles"]
print(",".join(x for x in r if x in ("student","instructor","admin")) or "none")' "$1"
}

summarize() {
  python3 - "$RESP" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    sys.exit()
u = lambda x: f'{x.get("username")}:{x.get("role")}:{"enabled" if x.get("enabled") else "disabled"}'
if isinstance(d, dict) and "users" in d:
    print("users=" + " ".join(u(x) for x in d["users"]))
elif isinstance(d, dict) and "username" in d:
    print(u(d))
elif isinstance(d, dict) and "detail" in d:
    print("detail=" + (d["detail"] if isinstance(d["detail"], str) else "validation error"))
PY
}

check() {  # check <PASS-condition 0/1> <label> <observed>
  if [ "$1" = 0 ]; then echo "PASS  $2  ($3)"; else echo "FAIL  $2  ($3)"; FAILS=$((FAILS+1)); fi
}

call() {  # call <want> <label> <METHOD> <path> [token] [json]
  local want=$1 label=$2 method=$3 path=$4 tok=${5:-} body=${6:-} code
  local args=(-sS -o "$RESP" -w '%{http_code}' -X "$method" "$API$path")
  [ -n "$tok" ] && args+=(-H "Authorization: Bearer $tok")
  [ -n "$body" ] && args+=(-H 'Content-Type: application/json' -d "$body")
  code=$(curl "${args[@]}")
  [ "$code" = "$want" ]; check $? "$label" "$method ${path/$TEST_ID_MASK/<id>} -> $code, want $want $(summarize)"
}
TEST_ID_MASK=__none__

echo "=== ADM-USER #32 evidence  $(date -u +%FT%TZ)  api=$API  branch=$(git -C "$REPO" rev-parse --abbrev-ref HEAD 2>/dev/null)@$(git -C "$REPO" rev-parse --short HEAD 2>/dev/null)"

echo; echo "=== 1. Demo account tokens"
ADMIN_TOK=$(token admin_demo "$ADMIN_DEMO_PASSWORD")
STU_TOK=$(token student_demo "$STUDENT_DEMO_PASSWORD")
INS_TOK=$(token instructor_demo "$INSTRUCTOR_DEMO_PASSWORD")
for pair in "admin_demo:$ADMIN_TOK:admin" "student_demo:$STU_TOK:student" "instructor_demo:$INS_TOK:instructor"; do
  IFS=: read -r name tok want <<<"$pair"
  if [[ $tok == ERR:* ]]; then check 1 "$name login" "$tok"; continue; fi
  got=$(roles_of "$tok"); [ "$got" = "$want" ]; check $? "$name login" "roles=$got"
done
[[ $ADMIN_TOK == ERR:* ]] && { echo "cannot continue without an admin token"; exit 1; }

echo; echo "=== 2. Authorization boundary (Admin-only, no public signup)"
SIGNUP='{"username":"signup_probe","role":"student","password":"Probe!12345"}'
call 401 "no token: list"                          GET   /admin/users
call 401 "no token: create (no public signup)"     POST  /admin/users "" "$SIGNUP"
call 403 "student: list"                           GET   /admin/users "$STU_TOK"
call 403 "student: create"                         POST  /admin/users "$STU_TOK" "$SIGNUP"
call 403 "student: disable"                        PATCH /admin/users/$NOBODY/enabled "$STU_TOK" '{"enabled":false}'
call 403 "instructor: list"                        GET   /admin/users "$INS_TOK"
call 403 "instructor: create"                      POST  /admin/users "$INS_TOK" "$SIGNUP"
call 403 "instructor: set role"                    PUT   /admin/users/$NOBODY/role "$INS_TOK" '{"role":"admin"}'
paths=$(curl -sS "$API/openapi.json" | python3 -c 'import json,sys; print(" ".join(p for p in json.load(sys.stdin)["paths"] if any(k in p.lower() for k in ("signup","sign-up","register"))) or "none")')
[ "$paths" = none ]; check $? "no signup/register route in API" "matching paths: $paths"

echo; echo "=== 3. List"
call 200 "admin: list users"                       GET   /admin/users "$ADMIN_TOK"

echo; echo "=== 4. Create user"
CREATE=$(printf '{"username":"%s","email":"%s@local","first_name":"ADM","last_name":"Test","role":"student","password":"%s","temporary_password":false}' "$TEST_USER" "$TEST_USER" "$TEST_PW")
call 201 "admin: create $TEST_USER as student"     POST  /admin/users "$ADMIN_TOK" "$CREATE"
TEST_ID=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("id",""))' "$RESP" 2>/dev/null)
[ -n "$TEST_ID" ] || { echo "create failed; stopping"; exit 1; }
TEST_ID_MASK=$TEST_ID
call 409 "admin: duplicate username"               POST  /admin/users "$ADMIN_TOK" "$CREATE"
call 422 "admin: non-app role rejected"            POST  /admin/users "$ADMIN_TOK" "${CREATE/\"role\":\"student\"/\"role\":\"realm-admin\"}"
call 422 "admin: smuggled realmRoles rejected"     POST  /admin/users "$ADMIN_TOK" "${CREATE%\}},\"realmRoles\":[\"admin\"]}"
T1=$(token "$TEST_USER" "$TEST_PW")
[[ $T1 != ERR:* ]] && [ "$(roles_of "$T1")" = student ]; check $? "new user can sign in as student" "${T1:0:4}... roles=$( [[ $T1 == ERR:* ]] && echo "$T1" || roles_of "$T1")"

echo; echo "=== 5. Role assignment + role refresh"
call 200 "new user's student token works"         GET   /pods "$T1"
call 200 "admin: set role -> instructor"           PUT   "/admin/users/$TEST_ID/role" "$ADMIN_TOK" '{"role":"instructor"}'
echo "      waiting 61s for the API's introspection cache (max 60s) ..."; sleep 61
call 401 "old student token rejected after change" GET   /pods "$T1"
T2=$(token "$TEST_USER" "$TEST_PW")
[ "$(roles_of "$T2")" = instructor ]; check $? "fresh sign-in carries new role" "roles=$(roles_of "$T2")"
call 200 "instructor endpoint now allowed"         GET   /instructor/pods "$T2"
call 403 "still no admin access"                   GET   /admin/users "$T2"

echo; echo "=== 6. Disable / enable"
call 200 "admin: disable user"                     PATCH "/admin/users/$TEST_ID/enabled" "$ADMIN_TOK" '{"enabled":false}'
R=$(token "$TEST_USER" "$TEST_PW")
[[ $R == ERR:* ]]; check $? "disabled user cannot sign in" "${R:0:60}"
echo "      waiting 61s for the API's introspection cache (max 60s) ..."; sleep 61
call 401 "disabled user's existing token rejected" GET   /pods "$T2"
call 200 "admin: enable user"                      PATCH "/admin/users/$TEST_ID/enabled" "$ADMIN_TOK" '{"enabled":true}'
T3=$(token "$TEST_USER" "$TEST_PW")
[[ $T3 != ERR:* ]]; check $? "re-enabled user can sign in" "roles=$( [[ $T3 == ERR:* ]] && echo "$T3" || roles_of "$T3")"

echo; echo "=== 7. Admin self-protection"
ADMIN_ID=$(curl -sS -H "Authorization: Bearer $ADMIN_TOK" "$API/admin/users?search=admin_demo" \
  | python3 -c 'import json,sys; print(next((u["id"] for u in json.load(sys.stdin)["users"] if u["username"]=="admin_demo"),""))')
TEST_ID_MASK=$ADMIN_ID
call 409 "admin cannot disable self"               PATCH "/admin/users/$ADMIN_ID/enabled" "$ADMIN_TOK" '{"enabled":false}'
call 409 "admin cannot change own role"            PUT   "/admin/users/$ADMIN_ID/role" "$ADMIN_TOK" '{"role":"student"}'
TEST_ID_MASK=$TEST_ID

echo; echo "=== 8. Audit trail (audit_log, newest first)"
python3 - "$DB_PATH" <<'PY'
import sqlite3, sys
conn = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
for r in conn.execute("SELECT timestamp, event_type, student_id, result, detail FROM audit_log "
                      "WHERE event_type LIKE 'ADMIN_USER_%' ORDER BY id DESC LIMIT 12"):
    print("      " + " | ".join(str(x) for x in r))
PY

echo; echo "=== 9. Cleanup"
call 200 "admin: leave test user disabled"         PATCH "/admin/users/$TEST_ID/enabled" "$ADMIN_TOK" '{"enabled":false}'

echo; echo "=== RESULT: $FAILS failure(s)  test_user=$TEST_USER (left disabled)"
