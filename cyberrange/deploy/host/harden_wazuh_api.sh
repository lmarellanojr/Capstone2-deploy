#!/usr/bin/env bash
# #286: bind the Wazuh manager API to loopback inside the container and rotate the two
# built-in API accounts (`wazuh` and `wazuh-wui`).
#
# The host side is already loopback-only: Manual 02 Step 4d publishes the API with an LXD
# proxy device `listen=tcp:127.0.0.1:55000 connect=tcp:127.0.0.1:55000`. But nothing in the
# repo ever set the API's *own* listen address, so apid still binds 0.0.0.0:55000 inside the
# container by default and a pod peered to mon-net can reach 10.0.40.10:55000 directly. This
# script sets `host: 127.0.0.1` in api.yaml, restarts the manager, and refuses to continue
# unless the only listener left on :55000 is loopback.
#
# It then rotates both built-in accounts, looking each one up BY USERNAME (not by the
# hard-coded id 1/2 that Manual 06 Step 2 assumed), and proves the new password gets a token
# while an old/default password is rejected. The rotated passwords are written to a mode-600
# file OUTSIDE the repo (default ~/cyberrange/secrets/wazuh-builtin-credentials.env); nothing
# at runtime uses them -- scoring uses the dedicated read-only `scoring` user and agent
# cleanup uses `provisioner`. Copy them into your secret store and delete the file if you
# prefer. Nothing here ever prints a password.
#
# Idempotent. A re-run leaves api.yaml with a single `host:` line, restarts only when the
# config or the live listener still needs it, and rotates again (fresh random passwords).
#
# Run on the LXD host as the deployment operator, after the API is up (Manual 02 Step 4) and
# the pinned CA is in place. Supply the CURRENT `wazuh` admin password without putting it on
# the command line:
#     read -rs WAZUH_ADMIN_PW; export WAZUH_ADMIN_PW
#     ~/cyberrange/deploy/host/harden_wazuh_api.sh
#     unset WAZUH_ADMIN_PW
#
# The pod-to-API denial check needs a live disposable pod and is a manual evidence step, not
# part of this script. Do not set WAZUH_TLS_VERIFY=false; use https://localhost:55000 and the
# pinned CA.
set -euo pipefail
umask 077

ROOT="${CYBERRANGE_ROOT:-/home/llms_admin/cyberrange}"
WZ="${WAZUH_API_URL:-https://localhost:55000}"
CA="${WAZUH_CA_BUNDLE:-${ROOT}/certs/wazuh-api.crt}"
CONTAINER="${WAZUH_CONTAINER:-wazuh-manager}"
API_YAML="${WAZUH_API_YAML:-/var/ossec/api/configuration/api.yaml}"
SECRETS_FILE="${WAZUH_BUILTIN_SECRETS_FILE:-${ROOT}/secrets/wazuh-builtin-credentials.env}"
ADMIN_USER="${WAZUH_ADMIN_USER:-wazuh}"
WUI_USER="${WAZUH_WUI_USER:-wazuh-wui}"
# The published default for wazuh-wui is "wazuh-wui"; override if yours was already changed.
WUI_OLD_PW="${WAZUH_WUI_OLD_PW:-wazuh-wui}"

die() { echo "harden_wazuh_api: $*" >&2; exit 1; }

[ -f "$CA" ] || die "missing CA bundle ${CA} (see Manual 02 Step 4e)"
command -v curl >/dev/null || die "curl is required"
command -v lxc  >/dev/null || die "lxc is required (run this on the LXD host)"
if command -v python3 >/dev/null 2>&1; then PY=python3; else PY=python; fi

ADMIN_PW="${WAZUH_ADMIN_PW:-}"
if [ -z "$ADMIN_PW" ] && [ -t 0 ]; then
  read -rsp "Wazuh admin (${ADMIN_USER}) password (not echoed): " ADMIN_PW; echo
fi
[ -n "$ADMIN_PW" ] || die "set WAZUH_ADMIN_PW (the current ${ADMIN_USER} password)"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

in_ctr() { lxc exec "$CONTAINER" -- "$@"; }

# --- curl plumbing: credentials and tokens go through config files, never argv (`ps`). ---
cfg_escape() { local v="${1//\\/\\\\}"; printf '%s' "${v//\"/\\\"}"; }
write_user_cfg()  { printf 'user = "%s:%s"\n' "$(cfg_escape "$1")" "$(cfg_escape "$2")" > "$WORK/$3"; }
write_token_cfg() { printf 'header = "Authorization: Bearer %s"\n' "$1" > "$WORK/$2"; }
json_get() { "$PY" -c 'import json,sys; d=json.load(sys.stdin); '"$1"; }

authenticate() {  # $1 user  $2 password  -> token on stdout (empty when rejected)
  write_user_cfg "$1" "$2" auth.cfg
  curl -sS --cacert "$CA" -K "$WORK/auth.cfg" "$WZ/security/user/authenticate" \
    | json_get 'print(d["data"]["token"])' 2>/dev/null || true
}

# api <cfg> <METHOD> <path> [json-body] -> body on stdout, status in $WORK/status
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

# find_id <list-path> <name-field> <name> -> id (empty when absent)
find_id() {
  api admin.cfg GET "$1?limit=500" | NAME="$3" FIELD="$2" "$PY" -c '
import json, os, sys
for it in json.load(sys.stdin).get("data", {}).get("affected_items", []):
    if it.get(os.environ["FIELD"]) == os.environ["NAME"]:
        print(it["id"]); break'
}

# listener lines on :55000 from inside the container (no header, numeric)
listener_lines() { in_ctr ss -H -ltn 2>/dev/null | grep ':55000' || true; }

# loopback_only <ss-lines>: exit 0 if >=1 listener on :55000 and every one is loopback;
# exit 1 if any is non-loopback; exit 2 if none is present at all.
loopback_only() {
  SS_LINES="$1" "$PY" - <<'PYEOF'
import os, sys
lines = [l for l in os.environ["SS_LINES"].splitlines() if ":55000" in l]
if not lines:
    sys.exit(2)
for l in lines:
    cols = l.split()
    laddr = cols[3] if len(cols) >= 4 else l
    host = laddr.rsplit(":", 1)[0].strip("[]")
    if not (host == "127.0.0.1" or host == "::1" or host.startswith("127.")):
        sys.exit(1)
sys.exit(0)
PYEOF
}

# --- 1. make the API listen on loopback -------------------------------------------------
BEFORE="$(listener_lines)"
echo "harden_wazuh_api: listener on :55000 before change:"
printf '%s\n' "${BEFORE:-  (none / API not responding)}" | sed 's/^/  /'

CUR_YAML="$(in_ctr cat "$API_YAML" 2>/dev/null || true)"
NEW_YAML="$(CUR_YAML="$CUR_YAML" "$PY" - <<'PYEOF'
import os, re, sys
lines = os.environ["CUR_YAML"].splitlines()
# drop any existing top-level host: key (commented or not); other keys are left untouched
pat = re.compile(r"^#?\s*host\s*:")
kept = [ln for ln in lines if not ((len(ln) - len(ln.lstrip())) == 0 and pat.match(ln))]
sys.stdout.write("\n".join(["host: 127.0.0.1"] + kept) + "\n")
PYEOF
)"

CHANGED=0; [ "$NEW_YAML" != "$CUR_YAML" ] && CHANGED=1
if [ "$CHANGED" = 1 ]; then
  if in_ctr test -f "$API_YAML"; then
    BACKUP="${API_YAML}.bak.$(date -u +%Y%m%d%H%M%S)"
    in_ctr cp "$API_YAML" "$BACKUP"
    echo "harden_wazuh_api: backed up api.yaml -> ${BACKUP} (in container)"
  fi
  printf '%s' "$NEW_YAML" | in_ctr tee "$API_YAML" >/dev/null
  echo "harden_wazuh_api: set host: 127.0.0.1 in ${API_YAML}"
fi

# Restart when the config changed or the live listener is not already loopback-only.
if [ "$CHANGED" = 1 ] || ! loopback_only "$BEFORE"; then
  echo "harden_wazuh_api: restarting ${CONTAINER} to apply the listener change"
  in_ctr systemctl restart wazuh-manager
  for _ in $(seq 1 "${WAZUH_API_WAIT_TRIES:-30}"); do
    [ -n "$(authenticate "$ADMIN_USER" "$ADMIN_PW")" ] && break
    sleep "${WAZUH_API_WAIT_SLEEP:-2}"
  done
fi

AFTER="$(listener_lines)"
echo "harden_wazuh_api: listener on :55000 after change:"
printf '%s\n' "${AFTER:-  (none)}" | sed 's/^/  /'
if loopback_only "$AFTER"; then :; else
  rc=$?
  [ "$rc" = 2 ] && die "no listener on :55000 after restart; the API did not come back up"
  die "the API still listens on a non-loopback address on :55000; not rotating credentials"
fi

# --- 2. rotate both built-in accounts ---------------------------------------------------
ADMIN_TOKEN="$(authenticate "$ADMIN_USER" "$ADMIN_PW")"
[ -n "$ADMIN_TOKEN" ] || die "could not authenticate as ${ADMIN_USER} against ${WZ} (wrong password, or CA/URL problem)"
write_token_cfg "$ADMIN_TOKEN" admin.cfg

ADMIN_ID="$(find_id /security/users username "$ADMIN_USER")"
WUI_ID="$(find_id /security/users username "$WUI_USER")"
[ -n "$ADMIN_ID" ] || die "built-in account ${ADMIN_USER} not found by username"
[ -n "$WUI_ID" ]   || die "built-in account ${WUI_USER} not found by username; the ticket requires rotating it"

new_password() { printf '%sAa1!' "$(openssl rand -base64 24 | tr -d '\r\n')"; }
set_password() {  # $1 user-id  $2 password (via stdin, never argv)
  api admin.cfg PUT "/security/users/$1" \
    "$("$PY" -c 'import json,sys; print(json.dumps({"password": sys.stdin.read().rstrip(chr(10))}))' <<<"$2")" >/dev/null
  [ "$(status)" = 200 ] || die "could not set the password for user id $1 (HTTP $(status))"
}

NEW_WUI_PW="$(new_password)"
NEW_ADMIN_PW="$(new_password)"
# Rotate wazuh-wui first and the admin (our token's user) last; the JWT stays valid either way.
set_password "$WUI_ID" "$NEW_WUI_PW"
set_password "$ADMIN_ID" "$NEW_ADMIN_PW"

# --- 3. prove new credentials work and old/default ones are rejected --------------------
check_rotation() {  # $1 user  $2 new-pw  $3 old-pw
  [ -n "$(authenticate "$1" "$2")" ] || die "rotation failed: ${1} is rejected with its new password"
  [ -z "$(authenticate "$1" "$3")" ] || die "rotation failed: ${1} still accepts the old password"
}
check_rotation "$WUI_USER"   "$NEW_WUI_PW"   "$WUI_OLD_PW"
check_rotation "$ADMIN_USER" "$NEW_ADMIN_PW" "$ADMIN_PW"
unset ADMIN_PW

# --- 4. record the new passwords outside the repo, mode 600 (never printed) -------------
mkdir -p "$(dirname "$SECRETS_FILE")"
NEW_ADMIN_PW="$NEW_ADMIN_PW" NEW_WUI_PW="$NEW_WUI_PW" ADMIN_USER="$ADMIN_USER" WUI_USER="$WUI_USER" \
SECRETS_FILE="$SECRETS_FILE" "$PY" - <<'PYEOF'
import os, time
path = os.environ["SECRETS_FILE"]
body = (
    "# Wazuh built-in API account passwords rotated by harden_wazuh_api.sh (#286).\n"
    "# Not used at runtime (scoring=`scoring`, cleanup=`provisioner`). Copy into your\n"
    "# secret store and delete this file if you prefer. Rotated %s UTC.\n"
    % time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
)
body += "WAZUH_ADMIN_USER=%s\n" % os.environ["ADMIN_USER"]
body += "WAZUH_ADMIN_PW=%s\n" % os.environ["NEW_ADMIN_PW"]
body += "WAZUH_WUI_USER=%s\n" % os.environ["WUI_USER"]
body += "WAZUH_WUI_PW=%s\n" % os.environ["NEW_WUI_PW"]
tmp = path + ".tmp"
fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w", encoding="utf-8") as f:
    f.write(body)
os.replace(tmp, path)
os.chmod(path, 0o600)
PYEOF

echo "harden_wazuh_api: done. The API listens on loopback only, and ${ADMIN_USER} and ${WUI_USER}"
echo "were rotated (new password accepted, old/default rejected)."
echo "New passwords are in ${SECRETS_FILE} (mode 600). Move them to your secret store."
echo "setup_wazuh_provisioner.sh now needs the new ${ADMIN_USER} password as WAZUH_ADMIN_PW."
