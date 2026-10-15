#!/usr/bin/env bash
# #210: create the least-privilege Wazuh `provisioner` API user that the provision API
# uses to remove a lab's agents (src/provisioning/wazuh_client.py: get_provision_token).
# The read-only `scoring` user gets 403 on DELETE /agents, so without this user End
# Session leaves agents registered and the same student's next lab is refused with
# WAZUH_STALE_AGENT.
#
# The role holds exactly two actions on agent:id:* (agent:read, agent:delete) plus a deny
# of agent:delete on agent:id:000 (the manager). It is NOT agents_all_agents.
#
# Idempotent. A re-run reuses the policies, role and user it finds. It keeps the
# password already in env/.env; it only sets a new one if the user exists but the
# .env has none. Nothing here prints a password.
#
# Run on the LXD host as the provision-api operator, after Manual 06 Step 2 rotated the
# built-in `wazuh` password. Supply that stored admin password without putting it on
# the command line:
#     read -rs WAZUH_ADMIN_PW; export WAZUH_ADMIN_PW
#     ~/cyberrange/deploy/host/setup_wazuh_provisioner.sh
# Then restart the API: systemctl --user restart cyberrange-provision-api.service
#
# Do not set WAZUH_TLS_VERIFY=false. Use https://localhost:55000 and the pinned CA.
set -euo pipefail
umask 077

ROOT="${CYBERRANGE_ROOT:-/home/llms_admin/cyberrange}"
API_ENV="${ROOT}/env/.env"
WZ="${WAZUH_API_URL:-https://localhost:55000}"
CA="${WAZUH_CA_BUNDLE:-${ROOT}/certs/wazuh-api.crt}"
ADMIN_USER="${WAZUH_ADMIN_USER:-wazuh}"
PROV_USER=provisioner
ALLOW_POLICY=provisioner_agents
DENY_POLICY=provisioner_deny_000
ROLE=provisioner

die() { echo "setup_wazuh_provisioner: $*" >&2; exit 1; }

[ -f "$API_ENV" ] || die "missing ${API_ENV}"
[ -f "$CA" ] || die "missing CA bundle ${CA} (see Manual 06, TLS)"
command -v curl >/dev/null || die "curl is required"
if command -v python3 >/dev/null 2>&1; then PY=python3; else PY=python; fi

ADMIN_PW="${WAZUH_ADMIN_PW:-}"
if [ -z "$ADMIN_PW" ] && [ -t 0 ]; then
  read -rsp "Wazuh admin password (not echoed): " ADMIN_PW; echo
fi
[ -n "$ADMIN_PW" ] || die "set WAZUH_ADMIN_PW (the stored Manual 06 Step 2 password)"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Credentials and tokens go through curl config files, never argv, so they do not show
# up in `ps`.
cfg_escape() { local v="${1//\\/\\\\}"; printf '%s' "${v//\"/\\\"}"; }
write_user_cfg() { printf 'user = "%s:%s"\n' "$(cfg_escape "$1")" "$(cfg_escape "$2")" > "$WORK/$3"; }
write_token_cfg() { printf 'header = "Authorization: Bearer %s"\n' "$1" > "$WORK/$2"; }

json_get() { "$PY" -c 'import json,sys; d=json.load(sys.stdin); '"$1"; }

authenticate() {  # $1 user  $2 password  -> token on stdout
  write_user_cfg "$1" "$2" auth.cfg
  curl -sS --cacert "$CA" -K "$WORK/auth.cfg" "$WZ/security/user/authenticate" \
    | json_get 'print(d["data"]["token"])' 2>/dev/null || true
}

# api <cfg> <METHOD> <path> [json-body]  -> body on stdout, status in $WORK/status
api() {
  local cfg="$1" method="$2" path="$3" body="${4:-}" args=()
  if [ -n "$body" ]; then
    printf '%s' "$body" > "$WORK/body.json"
    args=(-H 'Content-Type: application/json' --data-binary "@$WORK/body.json")
  fi
  curl -sS --cacert "$CA" -K "$WORK/$cfg" -X "$method" ${args[@]+"${args[@]}"} \
    -o "$WORK/resp.json" -w '%{http_code}' "$WZ$path" > "$WORK/status" || echo 000 > "$WORK/status"
  cat "$WORK/resp.json"
}
status() { cat "$WORK/status"; }

# find_id <cfg> <list-path> <name-field> <name>  -> id (empty when absent)
find_id() {
  api "$1" GET "$2?limit=500" | NAME="$4" FIELD="$3" "$PY" -c '
import json, os, sys
for it in json.load(sys.stdin).get("data", {}).get("affected_items", []):
    if it.get(os.environ["FIELD"]) == os.environ["NAME"]:
        print(it["id"]); break'
}

ADMIN_TOKEN="$(authenticate "$ADMIN_USER" "$ADMIN_PW")"
[ -n "$ADMIN_TOKEN" ] || die "could not authenticate as ${ADMIN_USER} against ${WZ} (wrong password, or CA/URL problem)"
write_token_cfg "$ADMIN_TOKEN" admin.cfg
unset ADMIN_PW

# --- policies (allow read+delete on agents, deny delete on the manager) ---
ensure_policy() {  # name json-body -> id. An existing same-named policy is corrected, not trusted.
  local found id state
  found="$(api admin.cfg GET "/security/policies?limit=500" | NAME="$1" WANT="$2" "$PY" -c '
import json, os, sys
want = json.loads(os.environ["WANT"])["policy"]
for it in json.load(sys.stdin).get("data", {}).get("affected_items", []):
    if it.get("name") == os.environ["NAME"]:
        print(it["id"], "same" if it.get("policy") == want else "differs"); break')"
  id="${found%% *}"; state="${found##* }"
  if [ -z "$found" ]; then
    api admin.cfg POST /security/policies "$2" | json_get 'print(d["data"]["affected_items"][0]["id"])' > "$WORK/id"       || die "could not create policy $1 (HTTP $(status))"
    id="$(cat "$WORK/id")"
  elif [ "$state" = differs ]; then
    echo "setup_wazuh_provisioner: policy $1 (id ${id}) differs from the intended one; correcting it" >&2
    api admin.cfg PUT "/security/policies/${id}" "$2" >/dev/null
    [ "$(status)" = 200 ] || die "could not correct policy $1 (HTTP $(status))"
  fi
  echo "$id"
}
ALLOW_ID="$(ensure_policy "$ALLOW_POLICY" \
  '{"name":"'"$ALLOW_POLICY"'","policy":{"actions":["agent:read","agent:delete"],"resources":["agent:id:*"],"effect":"allow"}}')"
DENY_ID="$(ensure_policy "$DENY_POLICY" \
  '{"name":"'"$DENY_POLICY"'","policy":{"actions":["agent:delete"],"resources":["agent:id:000"],"effect":"deny"}}')"

# --- role ---
ROLE_ID="$(find_id admin.cfg /security/roles name "$ROLE")"
if [ -z "$ROLE_ID" ]; then
  api admin.cfg POST /security/roles '{"name":"'"$ROLE"'"}' \
    | json_get 'print(d["data"]["affected_items"][0]["id"])' > "$WORK/id" || die "could not create role ${ROLE} (HTTP $(status))"
  ROLE_ID="$(cat "$WORK/id")"
fi
api admin.cfg POST "/security/roles/${ROLE_ID}/policies?policy_ids=${ALLOW_ID},${DENY_ID}" >/dev/null

# --- user ---
env_value() { sed -n "s/^[[:space:]]*$1=[\"']\{0,1\}\(.*[^\"']\)[\"']\{0,1\}[[:space:]]*$/\1/p" "$API_ENV" | tail -1; }
EXISTING_PW="$(env_value WAZUH_PROVISION_PW)"
USER_ID="$(find_id admin.cfg /security/users username "$PROV_USER")"
if [ -n "$EXISTING_PW" ] && [ -n "$USER_ID" ]; then
  PROV_PW="$EXISTING_PW"
else
  # Wazuh requires upper, lower, digit and symbol; base64 alone does not guarantee that.
  PROV_PW="$(openssl rand -base64 24 | tr -d '\r\n')Aa1!"
  if [ -z "$USER_ID" ]; then
    api admin.cfg POST /security/users \
      "$("$PY" -c 'import json,sys; print(json.dumps({"username": sys.argv[1], "password": sys.stdin.read().rstrip("\n")}))' "$PROV_USER" <<<"$PROV_PW")" \
      | json_get 'print(d["data"]["affected_items"][0]["id"])' > "$WORK/id" || die "could not create user ${PROV_USER} (HTTP $(status))"
    USER_ID="$(cat "$WORK/id")"
  else
    api admin.cfg PUT "/security/users/${USER_ID}" \
      "$("$PY" -c 'import json,sys; print(json.dumps({"password": sys.stdin.read().rstrip("\n")}))' <<<"$PROV_PW")" >/dev/null
    [ "$(status)" = 200 ] || die "could not set the ${PROV_USER} password (HTTP $(status))"
  fi
fi
api admin.cfg POST "/security/users/${USER_ID}/roles?role_ids=${ROLE_ID}" >/dev/null

# --- prove the role before trusting it ---
PROV_TOKEN="$(authenticate "$PROV_USER" "$PROV_PW")"
[ -n "$PROV_TOKEN" ] || die "could not authenticate as ${PROV_USER}"
write_token_cfg "$PROV_TOKEN" prov.cfg

api prov.cfg GET "/agents?limit=1" >/dev/null
[ "$(status)" = 200 ] || die "provisioner cannot read agents (HTTP $(status)); not writing ${API_ENV}"
# A valid body, so Wazuh's authorization (not body validation) decides the answer. If the
# role is too wide this really creates the account, so remove it again before refusing.
api prov.cfg POST /security/users '{"username":"shouldfail","password":"Abcd1234!x"}' >/dev/null
PROBE_STATUS="$(status)"
if [ "$PROBE_STATUS" != 403 ]; then
  PROBE_ID="$(find_id admin.cfg /security/users username shouldfail)"
  [ -z "$PROBE_ID" ] || api admin.cfg DELETE "/security/users?user_ids=${PROBE_ID}" >/dev/null
  die "provisioner can create users (HTTP ${PROBE_STATUS}): role is too wide. The probe account was removed. Remove the role; not writing ${API_ENV}"
fi
api prov.cfg DELETE "/agents?agents_list=000&older_than=0s&status=all&purge=true" >/dev/null
[ "$(status)" = 403 ] || die "provisioner may delete the manager (HTTP $(status)): deny policy missing; not writing ${API_ENV}"

# --- write env/.env (mode 600), replacing only these two keys ---
PROV_USER="$PROV_USER" PROV_PW="$PROV_PW" API_ENV="$API_ENV" "$PY" - <<'PYEOF'
import os, re
path = os.environ["API_ENV"]
vals = {"WAZUH_PROVISION_USER": os.environ["PROV_USER"], "WAZUH_PROVISION_PW": os.environ["PROV_PW"]}
lines = open(path, encoding="utf-8").read().splitlines()
seen = set()
out = []
for line in lines:
    m = re.match(r"^\s*#?\s*(WAZUH_PROVISION_USER|WAZUH_PROVISION_PW)=", line)
    if m and m.group(1) not in seen:
        seen.add(m.group(1))
        out.append(f"{m.group(1)}={vals[m.group(1)]}")
    elif m:
        continue  # drop duplicate lines for the same key
    else:
        out.append(line)
for k in vals:
    if k not in seen:
        out.append(f"{k}={vals[k]}")
tmp = path + ".tmp"
fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w", encoding="utf-8") as f:
    f.write("\n".join(out) + "\n")
os.replace(tmp, path)
os.chmod(path, 0o600)
PYEOF

echo "provisioner user ready: GET /agents 200, POST /security/users 403, DELETE agent 000 403."
echo "WAZUH_PROVISION_USER and WAZUH_PROVISION_PW are set in ${API_ENV} (mode 600)."
echo "Next: systemctl --user restart cyberrange-provision-api.service"
