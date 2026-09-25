#!/bin/bash
# SEC-01 (#36): live RBAC matrix against the real provision API + Keycloak.
# Companion to src/provisioning/test_sec01_rbac_matrix.py (same policy table).
#
# Run on the LXD host after the provision API is running this branch:
#   bash ~/cyberrange/deploy/host/verify_sec01_rbac.sh | tee ~/sec01-backend-evidence.txt
#
# Callers: unauthenticated, student_demo, instructor_demo, admin_demo. (The
# "authenticated but no application role" row is covered by the unit matrix;
# there is no role-less demo account to sign in as.)
#
# No pods, users, reviews or progress change: owner routes use a pod id that
# does not exist, allowed writes get an invalid body (422) or a missing target
# (404), and progress reset targets a scenario id with no rows (that one call
# still adds an audit_log row per signed-in caller). A denied caller always
# gets a valid body, so its 403 is the role check, not validation.
#
# Needs ADM-USER's setup_user_admin_client.sh to have run on this host, or the
# Admin rows for /admin/users* come back 503 and are reported as FAIL.
# Prints status codes only -- never tokens, passwords or secrets.
set -uo pipefail
REPO=/home/llms_admin/cyberrange
set -a; . "$REPO/env/.env"; . /home/llms_admin/cyberrange-data/demo-accounts.env; set +a
API="http://${API_BIND_HOST}:${API_BIND_PORT}"
TOKEN_URL="${KEYCLOAK_INTROSPECT_URL%/introspect}"
NOPOD=999999
NOSCEN=999999
NOUSER=00000000-0000-0000-0000-000000000000
FAILS=0

token() {  # token <user> <password> -> access token, or "ERR:<reason>"
  curl -sS -X POST "$TOKEN_URL" -d grant_type=password \
    -d "client_id=$KEYCLOAK_CLIENT_ID" -d "client_secret=$KEYCLOAK_CLIENT_SECRET" \
    -d "username=$1" -d "password=$2" -d scope=openid \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("access_token") or "ERR:"+d.get("error_description", d.get("error","?")))'
}

status() {  # status <METHOD> <path> <token|""> [json]
  local args=(-sS -o /dev/null -w '%{http_code}' -X "$1" "$API$2")
  [ -n "$3" ] && args+=(-H "Authorization: Bearer $3")
  [ -n "${4:-}" ] && args+=(-H 'Content-Type: application/json' -d "$4")
  curl "${args[@]}"
}

echo "=== SEC-01 backend RBAC evidence  $(date -u +%FT%TZ)  api=$API"
declare -A TOK=([unauthenticated]="")
for pair in student:student_demo:STUDENT_DEMO_PASSWORD instructor:instructor_demo:INSTRUCTOR_DEMO_PASSWORD admin:admin_demo:ADMIN_DEMO_PASSWORD; do
  IFS=: read -r role user pwvar <<<"$pair"
  t=$(token "$user" "${!pwvar}")
  [[ $t == ERR:* ]] && { echo "cannot sign in as $user: $t"; exit 1; }
  TOK[$role]=$t
done
CALLERS=(unauthenticated student instructor admin)

# policy -> expected per caller ("ok" = got past authorization: not 401/403, not 5xx)
declare -A EXP
EXP[public]="ok ok ok ok"
EXP[app_role]="401 ok ok ok"
EXP[instructor]="401 403 ok ok"
EXP[admin]="401 403 403 ok"

VALID_USER='{"username":"sec01_probe","role":"student","password":"Probe!12345"}'
BAD_USER='{"username":"","role":"student","password":"x"}'
# METHOD|path|policy|body for denied callers|body for allowed callers
ROUTES=(
  "GET|/health|public||"
  "GET|/capacity|public||"
  "POST|/pods/provision|app_role|{\"scenario_id\":\"01\",\"student_id\":\"x\"}|{\"student_id\":\"!!\"}"
  "GET|/pods|app_role||"
  "GET|/pods/$NOPOD/status|app_role||"
  "GET|/pods/$NOPOD/guac-token|app_role||"
  "GET|/pods/$NOPOD/lab-urls|app_role||"
  "DELETE|/pods/$NOPOD/destroy|app_role||"
  "POST|/pods/$NOPOD/verify/1/1|app_role||"
  "GET|/pods/$NOPOD/milestones|app_role||"
  "GET|/pods/$NOPOD/alerts|app_role||"
  "GET|/progress|app_role||"
  "DELETE|/progress/$NOSCEN|app_role||"
  "POST|/progress/$NOSCEN/flag|app_role|{\"milestone_id\":1,\"flag\":\"x\"}|{\"flag\":\"missing\"}"
  "GET|/progress/$NOSCEN/rubrics|app_role||"
  "POST|/reviews/submit|app_role|{\"scenario_id\":1,\"report_text\":\"x\"}|{\"report_text\":\"missing scenario\"}"
  "GET|/reviews/$NOPOD|app_role||"
  "POST|/reviews/$NOPOD/resubmit|app_role|{\"report_text\":\"x\"}|{\"report_text\":\"x\"}"
  "GET|/instructor/pods|instructor||"
  "GET|/instructor/students|instructor||"
  "GET|/instructor/students/student_demo|instructor||"
  "GET|/instructor/reviews|instructor||"
  "GET|/instructor/reviews/$NOPOD|instructor||"
  "POST|/instructor/reviews/$NOPOD/resolve|instructor|{\"status\":\"APPROVED\"}|{\"status\":\"APPROVED\"}"
  "DELETE|/admin/pods/$NOPOD/force-destroy|admin||"
  "GET|/admin/users|admin||"
  "POST|/admin/users|admin|$VALID_USER|$BAD_USER"
  "PATCH|/admin/users/$NOUSER/enabled|admin|{\"enabled\":true}|{\"enabled\":true}"
  "PUT|/admin/users/$NOUSER/role|admin|{\"role\":\"student\"}|{\"role\":\"student\"}"
)

echo
printf '%-7s %-40s %-11s %-17s %-17s %-17s %-17s\n' METHOD ROUTE POLICY "${CALLERS[@]}"
for row in "${ROUTES[@]}"; do
  IFS='|' read -r method path policy deny_body allow_body <<<"$row"
  read -r -a want <<<"${EXP[$policy]}"
  cells=()
  for i in "${!CALLERS[@]}"; do
    c=${CALLERS[$i]} w=${want[$i]}
    body=$([ "$w" = ok ] && echo "$allow_body" || echo "$deny_body")
    code=$(status "$method" "$path" "${TOK[$c]}" "$body")
    if [ "$w" = ok ]; then [[ $code =~ ^[234][0-9][0-9]$ && $code != 401 && $code != 403 ]]; else [ "$code" = "$w" ]; fi
    if [ $? = 0 ]; then mark=PASS; else mark=FAIL; FAILS=$((FAILS+1)); fi
    cells+=("$code/$w $mark")
  done
  printf '%-7s %-40s %-11s %-17s %-17s %-17s %-17s\n' "$method" "$path" "$policy" "${cells[@]}"
done

echo; echo "=== Manual URL/API bypass attempts (student_demo)"
chk() {  # chk <label> <got> <want: code or a|b alternatives>
  if [[ "$2" =~ ^($3)$ ]]; then echo "PASS  $1 -> $2"; else echo "FAIL  $1 -> $2 (want $3)"; FAILS=$((FAILS+1)); fi
}
chk "forged X-Roles/X-Forwarded-User headers on GET /admin/users" \
  "$(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer ${TOK[student]}" -H 'X-Roles: admin' -H 'X-Forwarded-User: admin_demo' "$API/admin/users")" 403
chk "?role=admin on GET /instructor/students" "$(status GET '/instructor/students?role=admin' "${TOK[student]}")" 403
# Starlette does not normalize dot segments, so this is unrouted (404) rather
# than reaching /admin/users; either way it must not be 200.
chk "path traversal /instructor/../admin/users" "$(curl -sS -o /dev/null -w '%{http_code}' --path-as-is -H "Authorization: Bearer ${TOK[student]}" "$API/instructor/../admin/users")" "403|404"
chk "garbage bearer token on GET /pods" "$(status GET /pods 'not-a-real-token')" 401
chk "token with its signature stripped on GET /pods" "$(status GET /pods "${TOK[admin]%.*}.")" 401

# IDOR on a real pod, read-only routes only, if one exists.
VICTIM=$(curl -sS -H "Authorization: Bearer ${TOK[admin]}" "$API/pods" \
  | python3 -c 'import json,sys; p=[x for x in json.load(sys.stdin).get("pods",[]) if x.get("student_id") not in ("student_demo","instructor_demo","admin_demo")]; print(p[0]["pod_id"] if p else "")')
if [ -n "$VICTIM" ]; then
  echo; echo "=== IDOR: another user's live pod ($VICTIM), read-only routes"
  for c in student instructor; do
    for r in status guac-token lab-urls milestones alerts; do
      chk "$c GET /pods/<victim>/$r" "$(status GET "/pods/$VICTIM/$r" "${TOK[$c]}")" 404
    done
  done
  chk "admin GET /pods/<victim>/status (admin inspect)" "$(status GET "/pods/$VICTIM/status" "${TOK[admin]}")" 200
else
  echo; echo "=== IDOR: skipped (no live pod owned by a non-demo user); covered by the unit matrix"
fi

echo; echo "=== RESULT: $FAILS failure(s)"
