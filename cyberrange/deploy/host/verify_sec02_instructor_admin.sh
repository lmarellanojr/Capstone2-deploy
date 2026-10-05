#!/bin/bash
# SEC-02 (#54): live check that an Instructor cannot perform Admin-only
# operations and that no protected side effect happens when denied.
# Companion to src/provisioning/test_sec02_instructor_admin_denial.py.
#
# Run on the LXD host after the provision API is running this branch, with
# ADM-USER's setup_user_admin_client.sh already applied:
#   bash ~/cyberrange/deploy/host/verify_sec02_instructor_admin.sh | tee ~/sec02-evidence.txt
#
# Default mode is read-only for everyone except the denied Instructor calls
# themselves:
#   - user/role: verify_instructor tries to list users, create an Admin, disable
#     verify_admin, promote itself and demote verify_admin, against the REAL ids.
#     verify_admin takes a read-only snapshot of the realm (GET /admin/users)
#     before and after; the two must be identical.
#   - force-destroy: tried on a pod id that does not exist. The role check runs
#     before the pod lookup, so 403 (not 404) proves the role gate.
#   - reset: PR #50 shipped no reset API; reset-shaped URLs must be unrouted.
#     The Student score wipe (DELETE /progress/{id}) is never used as a reset.
#
# --with-disposable-pod adds the controlled negative test on a real pod: it
# provisions a pod OWNED BY verify_instructor (never a student's), waits for
# ACTIVE, has verify_instructor call force-destroy on it (must be 403, pod must
# stay ACTIVE), then tears it down with verify_instructor's own
# DELETE /pods/{id}/destroy and polls /status until DESTROYED. If
# verify_instructor already has a live pod, that pod is used and left running.
#
# Signs in as the SEC-03 verify accounts (verify_instructor, verify_admin,
# verify_student from setup_verify_accounts.sh) through the cyberrange-verify
# client, so it keeps working after the demo accounts enrol MFA.
#
# Prints status codes and pod states only -- never tokens, passwords or secrets.
set -uo pipefail
REPO=/home/llms_admin/cyberrange
VERIFY_ENV=/home/llms_admin/cyberrange-data/verify-accounts.env
[[ -f "$VERIFY_ENV" ]] || { echo "missing $VERIFY_ENV -- run setup_verify_accounts.sh first"; exit 1; }
set -a; . "$REPO/env/.env"; . "$VERIFY_ENV"; set +a
API="http://${API_BIND_HOST}:${API_BIND_PORT}"
TOKEN_URL="${KEYCLOAK_INTROSPECT_URL%/introspect}"
NOPOD=999999
FAILS=0
WITH_POD=0
[ "${1:-}" = "--with-disposable-pod" ] && WITH_POD=1

token() {  # token <user> <password> -> access token, or "ERR:<reason>"
  # cyberrange-verify client: password grant for the verify_* accounts only,
  # so this still works after they or the demo accounts enrol MFA.
  curl -sS -X POST "$TOKEN_URL" -d grant_type=password \
    -d "client_id=$VERIFY_CLIENT_ID" --data-urlencode "client_secret=$VERIFY_CLIENT_SECRET" \
    -d "username=$1" --data-urlencode "password=$2" -d scope=openid \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("access_token") or "ERR:"+d.get("error_description", d.get("error","?")))'
}

status() {  # status <METHOD> <path> <token> [json] [extra curl args...]
  local method=$1 path=$2 tok=$3 body=${4:-}; shift 4 2>/dev/null || shift $#
  local args=(-sS -o /dev/null -w '%{http_code}' -X "$method" "$API$path" -H "Authorization: Bearer $tok")
  [ -n "$body" ] && args+=(-H 'Content-Type: application/json' -d "$body")
  curl "${args[@]}" "$@"
}

chk() {  # chk <label> <got> <want: code or a|b alternatives>
  if [[ "$2" =~ ^($3)$ ]]; then echo "PASS  $1 -> $2"; else echo "FAIL  $1 -> $2 (want $3)"; FAILS=$((FAILS+1)); fi
}

realm_snapshot() {  # sorted username/enabled/role lines, via verify_admin (read-only)
  curl -sS -H "Authorization: Bearer $ADMIN" "$API/admin/users?max=200" \
  | python3 -c 'import json,sys; [print(u["username"], u["enabled"], ",".join(u["roles"])) for u in sorted(json.load(sys.stdin)["users"], key=lambda u: u["username"])]'
}

user_id() {  # user_id <username>
  curl -sS -H "Authorization: Bearer $ADMIN" "$API/admin/users?search=$1" \
  | python3 -c "import json,sys; print(next((u['id'] for u in json.load(sys.stdin)['users'] if u['username']=='$1'), ''))"
}

pod_status() {  # pod_status <pod_id> -> status via verify_admin's inspect
  curl -sS -H "Authorization: Bearer $ADMIN" "$API/pods/$1/status" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin).get("status","?"))' 2>/dev/null || echo "?"
}

echo "=== SEC-02 Instructor -> Admin denial evidence  $(date -u +%FT%TZ)  api=$API"
INSTR=$(token verify_instructor "$VERIFY_INSTRUCTOR_PASSWORD")
ADMIN=$(token verify_admin "$VERIFY_ADMIN_PASSWORD")
for t in "$INSTR" "$ADMIN"; do [[ $t == ERR:* ]] && { echo "cannot sign in: $t"; exit 1; }; done

IID=$(user_id verify_instructor); AID=$(user_id verify_admin); SID=$(user_id verify_student)
[ -n "$IID" ] && [ -n "$AID" ] && [ -n "$SID" ] || { echo "cannot resolve verify account ids (is ADM-USER set up?)"; exit 1; }

echo; echo "=== 1. User / role management (real targets)"
BEFORE=$(realm_snapshot)
chk "instructor GET /admin/users"                       "$(status GET /admin/users "$INSTR")" 403
chk "instructor GET /admin/users?search=admin"          "$(status GET '/admin/users?search=admin' "$INSTR")" 403
chk "instructor POST /admin/users (new Admin account)"  "$(status POST /admin/users "$INSTR" '{"username":"sec02_backdoor","role":"admin","password":"Probe!12345","temporary_password":false}')" 403
chk "instructor PATCH verify_admin enabled=false"       "$(status PATCH "/admin/users/$AID/enabled" "$INSTR" '{"enabled":false}')" 403
chk "instructor PATCH verify_student enabled=false"     "$(status PATCH "/admin/users/$SID/enabled" "$INSTR" '{"enabled":false}')" 403
chk "instructor PUT own role -> admin"                  "$(status PUT "/admin/users/$IID/role" "$INSTR" '{"role":"admin"}')" 403
chk "instructor PUT verify_admin role -> student"       "$(status PUT "/admin/users/$AID/role" "$INSTR" '{"role":"student"}')" 403
chk "instructor PUT verify_student role -> instructor"  "$(status PUT "/admin/users/$SID/role" "$INSTR" '{"role":"instructor"}')" 403
chk "  + forged X-Roles/X-Forwarded-User headers"       "$(status PUT "/admin/users/$IID/role" "$INSTR" '{"role":"admin"}' -H 'X-Roles: admin' -H 'X-Forwarded-User: verify_admin')" 403
chk "  + ?role=admin query"                             "$(status PUT "/admin/users/$IID/role?role=admin" "$INSTR" '{"role":"admin"}')" 403
chk "instructor PUT verify_admin password (takeover)"   "$(status PUT "/admin/users/$AID/password" "$INSTR" '{"password":"Probe!12345","temporary":false}')" 403
chk "instructor PUT verify_student password"            "$(status PUT "/admin/users/$SID/password" "$INSTR" '{"password":"Probe!12345"}')" 403
AFTER=$(realm_snapshot)
if [ "$BEFORE" = "$AFTER" ] && [ -n "$BEFORE" ]; then
  echo "PASS  realm unchanged ($(echo "$AFTER" | wc -l | tr -d ' ') accounts; usernames, enabled flags and roles identical)"
else
  echo "FAIL  realm changed after denied Instructor calls"; diff <(echo "$BEFORE") <(echo "$AFTER"); FAILS=$((FAILS+1))
fi
echo "$AFTER" | grep -q '^sec02_backdoor ' && { echo "FAIL  sec02_backdoor account exists"; FAILS=$((FAILS+1)); } || echo "PASS  no sec02_backdoor account"
# A fresh sign-in proves the Instructor's role did not change server-side.
INSTR2=$(token verify_instructor "$VERIFY_INSTRUCTOR_PASSWORD")
chk "fresh instructor token still denied GET /admin/users" "$(status GET /admin/users "$INSTR2")" 403
chk "fresh instructor token still allowed /instructor/students" "$(status GET /instructor/students "$INSTR2")" 200
# Passwords aren't in realm_snapshot: prove the denied resets changed nothing by
# signing verify_admin in again with its original password.
case "$(token verify_admin "$VERIFY_ADMIN_PASSWORD")" in
  ERR:*) echo "FAIL  verify_admin can no longer sign in with its original password"; FAILS=$((FAILS+1)) ;;
  *)     echo "PASS  verify_admin password unchanged (fresh sign-in succeeded)" ;;
esac

echo; echo "=== 1b. Read-only Admin routes (disclosure)"
chk "instructor GET /admin/audit-log"                   "$(status GET /admin/audit-log "$INSTR")" 403
chk "instructor GET /admin/audit-log?event_type=..."    "$(status GET '/admin/audit-log?event_type=ADMIN_USER_ROLE_SET' "$INSTR")" 403
chk "instructor GET /admin/infra-health"                "$(status GET /admin/infra-health "$INSTR")" 403
chk "admin control: GET /admin/audit-log"               "$(status GET /admin/audit-log "$ADMIN")" 200

echo; echo "=== 2. Force-destroy"
chk "instructor DELETE /admin/pods/$NOPOD/force-destroy (403 before lookup)" "$(status DELETE "/admin/pods/$NOPOD/force-destroy" "$INSTR")" 403
chk "  + forged X-Roles header"                          "$(status DELETE "/admin/pods/$NOPOD/force-destroy" "$INSTR" '' -H 'X-Roles: admin')" 403
chk "  POST instead of DELETE"                           "$(status POST "/admin/pods/$NOPOD/force-destroy" "$INSTR")" 405
chk "admin control: same URL reaches the pod lookup"     "$(status DELETE "/admin/pods/$NOPOD/force-destroy" "$ADMIN")" 404

if [ $WITH_POD = 1 ]; then
  echo; echo "=== 2b. Disposable pod (owned by verify_instructor)"
  PID=$(curl -sS -H "Authorization: Bearer $INSTR" "$API/pods" \
    | python3 -c 'import json,sys; p=[x for x in json.load(sys.stdin).get("pods",[]) if x.get("student_id")=="verify_instructor" and x.get("status") not in ("DESTROYED","FAILED_ROLLBACK_COMPLETE")]; print(p[0]["pod_id"] if p else "")')
  CREATED=0
  if [ -z "$PID" ]; then
    PID=$(curl -sS -X POST -H "Authorization: Bearer $INSTR" -H 'Content-Type: application/json' \
      -d '{"student_id":"verify_instructor","scenario_id":"01"}' "$API/pods/provision" \
      | python3 -c 'import json,sys; print(json.load(sys.stdin).get("pod_id",""))')
    [ -z "$PID" ] && { echo "FAIL  could not provision a disposable pod"; FAILS=$((FAILS+1)); }
    CREATED=1
  fi
  if [ -n "$PID" ]; then
    echo "pod $PID (created by this run: $CREATED)"
    for _ in $(seq 1 90); do s=$(pod_status "$PID"); [ "$s" = ACTIVE ] || [ "$s" = FAILED_ROLLBACK_COMPLETE ] && break; sleep 10; done
    s=$(pod_status "$PID"); echo "state before: $s"
    if [ "$s" = ACTIVE ] || [ "$s" = FAILED_ROLLBACK_COMPLETE ]; then
      chk "instructor force-destroy on own $s pod" "$(status DELETE "/admin/pods/$PID/force-destroy" "$INSTR")" 403
      sleep 3
      after=$(pod_status "$PID")
      chk "pod state unchanged after denial ($s)" "$after" "$s"
    else
      echo "FAIL  pod never reached a force-destroyable state (last: $s)"; FAILS=$((FAILS+1))
    fi
    if [ $CREATED = 1 ]; then
      # Clean-up through the owner route, then verify teardown via status
      # (accepted means scheduled, not completed).
      code=$(status DELETE "/pods/$PID/destroy" "$INSTR")
      echo "cleanup: owner destroy -> $code"
      for _ in $(seq 1 60); do s=$(pod_status "$PID"); [ "$s" = DESTROYED ] && break; sleep 5; done
      chk "disposable pod torn down (status)" "$(pod_status "$PID")" DESTROYED
    fi
  fi
else
  echo "(disposable-pod test skipped; rerun with --with-disposable-pod)"
fi

echo; echo "=== 3. Reset (not implemented in PR #50 -> must be unrouted)"
for m_p in "POST /admin/pods/$NOPOD/reset" "PUT /admin/pods/$NOPOD/reset" "POST /pods/$NOPOD/reset" "POST /admin/pods/$NOPOD/restart"; do
  read -r m p <<<"$m_p"
  chk "instructor $m $p" "$(status "$m" "$p" "$INSTR")" "404|405"
done
curl -sS "$API/openapi.json" | python3 -c 'import json,sys; r=[p for p in json.load(sys.stdin)["paths"] if "reset" in p.lower() or "restart" in p.lower()]; print("PASS  no reset route in /openapi.json" if not r else "INFO  reset-like routes now exist: %s -- extend SEC-02" % r)' 2>/dev/null \
  || echo "INFO  /openapi.json unavailable; reset route inventory is covered by the unit test"

echo; echo "=== RESULT: $FAILS failure(s)"
