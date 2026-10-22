#!/usr/bin/env bash
# Apply GitHub Release ampere-live into ~/cyberrange. No self-hosted runner.
set -euo pipefail
umask 077

# User units ship PATH=/usr/bin:/bin. lxc is /usr/sbin/lxc (snap builds use
# /snap/bin). Caller entries stay first so tests can stub curl and systemctl.
# Without the append, cert sync raises FileNotFoundError and the CA smoke
# logs "lxc is not installed", and a stale certs/wazuh-api.crt stays in place.
export PATH="${PATH:-/usr/bin:/bin}:/usr/sbin:/snap/bin"

ROOT="${HOME}/cyberrange"
DATA="${HOME}/cyberrange-data"
SYNC="${ROOT}/deploy/host/release_sync.py"

if command -v python3 >/dev/null 2>&1; then
  PY=python3
else
  PY=python
fi

restart_units() {
  systemctl --user daemon-reload
  systemctl --user restart cyberrange-provision-api.service \
    cyberrange-portal.service cyberrange-ssh-bridge.service
}

# Refresh certs/wazuh-api.crt from live wazuh-manager when fingerprints match.
# Best-effort: never fails the pull (manager stopped / proxy down → skip).
# Fixes Admin Wazuh TLS-Degraded on every Ampere domain after Promote apply
# (#154); complements #152 preserve-if-exists for tarball extracts.
# When certs/wazuh-api-ca.crt exists (#168), a live cert that does not chain
# to that CA fails this release. Hosts without the CA file stay on the leaf pin.
sync_wazuh_api_cert() {
  local helper="${ROOT}/deploy/host/sync_wazuh_api_cert.py" rc=0
  if [ ! -f "$helper" ]; then
    return 0
  fi
  set +e
  "$PY" "$helper" --root "$ROOT" --data "$DATA"
  rc=$?
  set -e
  CERT_SYNC_RC=$rc
  # Helper: 0 ok/skipped/unchanged/installed; 2 = failed after validation (loud).
  # Never abort the pull — only surface the failure so operators notice.
  if [ "$rc" -eq 2 ]; then
    echo "pull-release: wazuh-api.crt sync FAILED (non-fatal; host may stay TLS-Degraded)" >&2
  elif [ "$rc" -ne 0 ]; then
    echo "pull-release: wazuh-api.crt sync exited $rc (non-fatal)" >&2
  fi
  return 0
}

# Fail the release when the internal CA is installed and the live manager
# certificate does not chain to it for localhost, or the scoring user cannot
# authenticate. No CA file means the transitional leaf pin is still in use.
# Every skip is logged. The caller after extract must use
# `smoke_wazuh_ca || fail_apply ...` so a failure rolls the release back.
smoke_wazuh_ca() {
  local ca="${ROOT}/certs/wazuh-api-ca.crt" out auth_py
  if [ ! -f "$ca" ]; then
    echo "pull-release: wazuh CA smoke skipped: ${ca} is absent"
    return 0
  fi
  if ! command -v lxc >/dev/null 2>&1; then
    # Not silent (#304): with the CA installed this host expects lxc, so a miss
    # means the unit PATH is wrong, not that Wazuh is absent.
    echo "pull-release: ERROR: wazuh CA smoke cannot run: lxc not found on PATH=${PATH}" >&2
    return 0
  fi
  if ! lxc info wazuh-manager >/dev/null 2>&1; then
    echo "pull-release: wazuh CA smoke skipped: wazuh-manager guest not found"
    return 0
  fi
  out=$(openssl s_client -connect localhost:55000 -servername localhost \
    -verify_hostname localhost -CAfile "$ca" </dev/null 2>&1 || true)
  if ! printf '%s\n' "$out" | grep -q "Verify return code: 0"; then
    echo "pull-release: Wazuh TLS-Degraded: manager cert failed chain or hostname check against $ca" >&2
    return 1
  fi
  auth_py="$PY"
  if [ -x "${ROOT}/.venv/bin/python" ]; then
    auth_py="${ROOT}/.venv/bin/python"
  fi
  "$auth_py" - "$ROOT" "$ca" <<'PY'
import sys
from pathlib import Path

root, ca = Path(sys.argv[1]), sys.argv[2]
vals = {}
env_path = root / "env" / ".env"
if env_path.is_file():
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        vals[key.strip()] = value.strip().strip('"').strip("'")
user = vals.get("WAZUH_SCORING_USER", "")
password = vals.get("WAZUH_SCORING_PW", "")
url = vals.get("WAZUH_API_URL", "https://localhost:55000").rstrip("/")
if not user or not password:
    print("pull-release: wazuh CA smoke skipped: scoring credentials are not set")
    raise SystemExit(0)
try:
    import requests
except ImportError:
    print("pull-release: wazuh CA smoke failed: python requests is not installed", file=sys.stderr)
    raise SystemExit(1)
try:
    response = requests.post(
        f"{url}/security/user/authenticate",
        auth=(user, password),
        verify=ca,
        timeout=15,
    )
except requests.exceptions.SSLError as exc:
    print(f"pull-release: Wazuh TLS-Degraded: authenticate failed: {exc}", file=sys.stderr)
    raise SystemExit(1)
except requests.RequestException as exc:
    print(f"pull-release: wazuh API authenticate failed: {exc}", file=sys.stderr)
    raise SystemExit(1)
if response.status_code != 200:
    print(f"pull-release: wazuh API authenticate HTTP {response.status_code}", file=sys.stderr)
    raise SystemExit(1)
print("pull-release: wazuh CA smoke authenticated")
PY
  # The apply path calls this as `smoke_wazuh_ca || fail_apply`. In that
  # context bash ignores set -e inside the function, so a failed authenticate
  # would otherwise fall through and look like success.
  [ $? -eq 0 ] || return 1
}

restore_snapshot() {
  # Same destinations as apply: tree -> $ROOT, portal-build -> $ROOT/portal
  if [ -f "${DATA}/rollback/tree.tgz" ]; then
    "$PY" "$SYNC" --extract "${DATA}/rollback/tree.tgz" "$ROOT"
  fi
  if [ -f "${DATA}/rollback/portal-build.tgz" ]; then
    "$PY" "$SYNC" --extract "${DATA}/rollback/portal-build.tgz" "${ROOT}/portal"
  fi
}

if [[ "${1:-}" == "--rollback" ]]; then
  restore_snapshot
  restart_units
  echo "pull-release rollback done"
  exit 0
fi

# --retry-bad: operator-confirmed retry of a release SHA that previously failed to
# apply. Use it only after fixing the cause recorded in rollback/last-failure.log;
# re-promoting the same commit cannot clear the bad-sha gate on its own.
RETRY_BAD=0
if [[ "${1:-}" == "--retry-bad" ]]; then
  RETRY_BAD=1
fi
STUCK_FILE="${DATA}/rollback/STUCK"
FAILURE_LOG="${DATA}/rollback/last-failure.log"

if [ ! -f "${DATA}/github-release.env" ] || [ ! -f "${DATA}/github-release.token" ]; then
  echo "pull skipped: token/env missing"
  exit 0
fi

WORK="$(mktemp -d /tmp/cr-pull-XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

set -a
# shellcheck disable=SC1091
. "${DATA}/github-release.env"
set +a

TOKEN_FILE="${GITHUB_TOKEN_FILE:-${DATA}/github-release.token}"
TOKEN="$(tr -d '\r\n' < "$TOKEN_FILE")"
TAG="${RELEASE_TAG:-ampere-live}"
API="https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}"

curl -fsSL \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Accept: application/vnd.github+json" \
  "${API}/releases/tags/${TAG}" > "${WORK}/release.json"

asset_id() {
  local name="$1"
  "$PY" - "$name" "${WORK}/release.json" <<'PY'
import json, sys
want, path = sys.argv[1], sys.argv[2]
rel = json.load(open(path, encoding="utf-8"))
for a in rel.get("assets") or []:
    if a.get("name") == want:
        print(a["id"])
        raise SystemExit(0)
raise SystemExit("missing asset %s" % want)
PY
}

download_asset() {
  local name="$1"
  local id
  id="$(asset_id "$name")"
  curl -fsSL -L \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Accept: application/octet-stream" \
    "${API}/releases/assets/${id}" \
    -o "${WORK}/${name}"
}

download_asset manifest.json
download_asset tree.tgz
download_asset portal-build.tgz

set +e
APPLY_OUT="$("$PY" "$SYNC" --check-apply "${WORK}/manifest.json" "${ROOT}/DEPLOYED_SHA")"
APPLY_RC=$?
set -e
if [ "$APPLY_RC" -eq 2 ]; then
  echo "pull-release skip: $APPLY_OUT"
  # Still heal a mismatched host pin when the release SHA is unchanged, so a
  # failed sync is retried by the next timer run instead of waiting for a new
  # release (#304). A failed smoke exits 1 so the unit shows failed.
  CERT_SYNC_RC=0
  sync_wazuh_api_cert
  if smoke_wazuh_ca; then
    if [ "$CERT_SYNC_RC" -eq 0 ]; then
      echo "pull-release: wazuh cert recheck OK on unchanged release"
    else
      echo "pull-release: wazuh cert recheck incomplete on unchanged release (sync exited ${CERT_SYNC_RC}); the next pull retries" >&2
    fi
  else
    echo "pull-release: wazuh cert recheck FAILED on unchanged release; the next pull retries" >&2
    exit 1
  fi
  exit 0
fi
if [ "$APPLY_RC" -ne 0 ]; then
  echo "pull-release check-apply failed rc=$APPLY_RC" >&2
  echo "$APPLY_OUT" >&2
  exit 1
fi
NEW_SHA="$APPLY_OUT"

if [ -f "${DATA}/rollback/bad-sha" ] && [ "$(tr -d '\r\n' < "${DATA}/rollback/bad-sha")" = "$NEW_SHA" ]; then
  if [ "$RETRY_BAD" = "1" ]; then
    echo "pull-release: --retry-bad given; retrying previously failed $NEW_SHA" >&2
    rm -f "${DATA}/rollback/bad-sha" "$STUCK_FILE"
  else
    # Loud, not silent: a skipped release means the live site is frozen on an older
    # build while the GitHub Action and Release both look green.
    LIVE_SHA="$(tr -d '\r\n' < "${ROOT}/DEPLOYED_SHA" 2>/dev/null || echo unknown)"
    MSG="pull-release STUCK: release ${NEW_SHA} failed to apply earlier; live site stays on ${LIVE_SHA}."
    MSG="${MSG} Cause: ${FAILURE_LOG}. Fix it, then run: pull_release.sh --retry-bad"
    echo "$MSG" >&2
    printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$MSG" > "$STUCK_FILE"
    exit 0
  fi
fi

# Everything an operator needs to see why an apply failed, written to the journal
# (stderr) and kept in rollback/last-failure.log so it survives log rotation.
# Never fails: it runs on the error path under `set -euo pipefail`.
dump_failure_context() {
  local reason="$1" u
  echo "==== pull-release FAILED for ${NEW_SHA}: ${reason} ($(date -u +%Y-%m-%dT%H:%M:%SZ)) ===="
  for u in cyberrange-provision-api cyberrange-portal cyberrange-ssh-bridge; do
    echo "-- ${u}: $(systemctl --user is-active "$u" 2>/dev/null || true)," \
      "restarts=$(systemctl --user show -p NRestarts --value "$u" 2>/dev/null || true)"
  done
  echo "-- provision-api journal (last 30 lines)"
  journalctl --user -u cyberrange-provision-api -n 30 --no-pager 2>/dev/null || true
  if [ -f /tmp/provision-api.log ]; then
    echo "-- /tmp/provision-api.log (last 60 lines; Python tracebacks land here)"
    tail -n 60 /tmp/provision-api.log 2>/dev/null || true
  fi
}

fail_apply() {
  local reason="${1:-unknown}"
  mkdir -p "${DATA}/rollback"
  dump_failure_context "$reason" 2>&1 | tee "$FAILURE_LOG" >&2 || true
  echo "$NEW_SHA" > "${DATA}/rollback/bad-sha"
  restore_snapshot
  restart_units
  exit 1
}

mkdir -p "${DATA}/rollback"
"$PY" "$SYNC" --snapshot "$ROOT" "${DATA}/rollback/tree.tgz"
if [ -d "${ROOT}/portal/.next" ]; then
  tar czf "${DATA}/rollback/portal-build.tgz" -C "${ROOT}/portal" \
    --exclude='.next/cache' .next public next.config.mjs package.json package-lock.json \
    || true
fi
if [ -f "${ROOT}/DEPLOYED_SHA" ]; then
  cp -f "${ROOT}/DEPLOYED_SHA" "${DATA}/rollback/DEPLOYED_SHA"
fi

"$PY" "$SYNC" --extract "${WORK}/tree.tgz" "$ROOT"
"$PY" "$SYNC" --extract "${WORK}/portal-build.tgz" "${ROOT}/portal"

# After extract (preserve keeps a wrong pin too): align pin to live manager.
# A failed smoke must roll back. A bare call would exit under set -e and
# leave the new tree in place with no bad-sha.
sync_wazuh_api_cert
smoke_wazuh_ca || fail_apply "Wazuh CA smoke failed"

GOT="$("$PY" "$SYNC" --lock-hash "${ROOT}/portal/package-lock.json")"
WANT="$("$PY" - "${WORK}/manifest.json" <<'PY'
import json, sys
m = json.load(open(sys.argv[1], encoding="utf-8"))
print(m["lockfile_sha256"])
PY
)"
if [ "$GOT" != "$WANT" ]; then
  echo "pull-release lockfile integrity mismatch" >&2
  fail_apply "portal lockfile integrity mismatch"
fi

LAST=""
if [ -f "${DATA}/rollback/last-lock.sha" ]; then
  LAST="$(tr -d '\r\n' < "${DATA}/rollback/last-lock.sha")"
fi
if [ "$GOT" != "$LAST" ]; then
  (
    cd "${ROOT}/portal"
    npm ci --omit=dev
  ) || fail_apply "npm ci failed"
fi

# Python API deps: `npm ci` above only covers the portal. The provision-api's
# own dependencies live in pyproject.toml, and a release can add new ones (e.g.
# PR #139 added python-multipart + pillow for evidence uploads). Without this
# step the API crash-loops on import, the health check fails, and the apply
# rolls back + marks the SHA bad -- freezing the host on the old build. Install
# the declared runtime deps into the venv whenever pyproject.toml changes.
VENV_PY="${ROOT}/.venv/bin/python"
PYPROJECT="${ROOT}/pyproject.toml"
PYHASH=""
if [ -x "$VENV_PY" ] && [ -f "$PYPROJECT" ]; then
  PYHASH="$("$VENV_PY" - "$PYPROJECT" <<'PY'
import hashlib, sys
print(hashlib.sha256(open(sys.argv[1], "rb").read()).hexdigest())
PY
)"
  PYLAST=""
  if [ -f "${DATA}/rollback/last-pyproject.sha" ]; then
    PYLAST="$(tr -d '\r\n' < "${DATA}/rollback/last-pyproject.sha")"
  fi
  if [ "$PYHASH" != "$PYLAST" ]; then
    DEPS="$("$VENV_PY" - "$PYPROJECT" <<'PY'
import sys, tomllib
with open(sys.argv[1], "rb") as f:
    data = tomllib.load(f)
print("\n".join(data.get("project", {}).get("dependencies", [])))
PY
)"
    if [ -n "$DEPS" ]; then
      printf '%s\n' "$DEPS" | "$VENV_PY" -m pip install -r /dev/stdin || fail_apply "pip install of pyproject dependencies failed"
    fi
  fi
fi

# The dependencies above go into ${ROOT}/.venv. If provision-api is started with a
# different interpreter (the repo unit used /usr/bin/python3; live hosts relied on a
# hand-made drop-in), new packages land where the API never looks -- say so loudly.
API_EXEC="$(systemctl --user show -p ExecStart --value cyberrange-provision-api 2>/dev/null || true)"
case "$API_EXEC" in
  *"${ROOT}/.venv/bin/python"*) ;;
  *) echo "pull-release WARNING: cyberrange-provision-api does not run ${VENV_PY};" \
       "Python dependencies installed there are not used. Re-run deploy/systemd/install-user-units.sh." >&2 ;;
esac

# Lab-agent cleanup needs the Wazuh `provisioner` user (#210). Without it, End Session
# leaves the lab's agents registered and the same student's next lab is refused with
# WAZUH_STALE_AGENT. Warn only: Wazuh scoring is optional, and a hard failure here
# would block unrelated releases. Only values are checked for presence, never printed.
API_ENV="${ROOT}/env/.env"
env_has() {
  grep -Eq "^[[:space:]]*$1=[\"']?[^\"'[:space:]]" "$API_ENV" 2>/dev/null
}
if [ -f "$API_ENV" ] && env_has WAZUH_SCORING_USER \
   && { ! env_has WAZUH_PROVISION_USER || ! env_has WAZUH_PROVISION_PW; }; then
  echo "pull-release WARNING: Wazuh scoring is configured but WAZUH_PROVISION_USER /" \
       "WAZUH_PROVISION_PW are not set in ${API_ENV}. Lab agents will not be removed" \
       "and a student's next lab can be refused (WAZUH_STALE_AGENT)." \
       "Run deploy/host/setup_wazuh_provisioner.sh (Manual 06 Step 3b)." >&2
fi

restart_units
BASE_RESTARTS="$(systemctl --user show -p NRestarts --value cyberrange-provision-api 2>/dev/null || echo 0)"

health() {
  local code body
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 http://10.115.77.1:5000/health || true)"
  [ "$code" = "200" ] || return 1
  body="$(curl -sS --max-time 20 http://10.115.77.1:5000/health || true)"
  echo "$body" | grep -q ok || return 1
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 http://10.115.77.1:3000/login || true)"
  [ "$code" = "200" ] || return 1
  body="$(curl -sS --max-time 20 http://10.115.77.1:3000/api/auth/providers || true)"
  echo "$body" | grep -q '{' || return 1
  # Kali CLI is nginx -> 10.115.77.1:8765. A crash-looping bridge still
  # leaves /health and /login 200, so this handshake must be part of apply.
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 \
    -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
    -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
    http://10.115.77.1:8765/api/ssh-websocket || true)"
  [ "$code" = "101" ] || return 1
  return 0
}

# Poll instead of one probe after a fixed sleep: slow starters get up to HEALTH_TIMEOUT
# seconds, while a crash-looping provision-api (e.g. a missing Python package) is caught
# after a couple of automatic restarts instead of waiting out the whole timeout.
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-90}"
wait_healthy() {
  local waited=0 delay=5 restarts
  while :; do
    sleep "$delay"
    waited=$((waited + delay))
    if health; then
      return 0
    fi
    restarts="$(systemctl --user show -p NRestarts --value cyberrange-provision-api 2>/dev/null || echo 0)"
    if [ "$(( ${restarts:-0} - ${BASE_RESTARTS:-0} ))" -ge 2 ] 2>/dev/null; then
      echo "pull-release: provision-api is crash-looping (restarted $(( restarts - BASE_RESTARTS )) times since apply)" >&2
      return 1
    fi
    if [ "$waited" -ge "$HEALTH_TIMEOUT" ]; then
      echo "pull-release: services not healthy after ${waited}s" >&2
      return 1
    fi
    if [ "$delay" -lt 15 ]; then
      delay=$((delay + 5))
    fi
  done
}

if ! wait_healthy; then
  echo "pull-release health check failed" >&2
  fail_apply "health check failed after apply"
fi

echo "$NEW_SHA" > "${ROOT}/DEPLOYED_SHA"
echo "$GOT" > "${DATA}/rollback/last-lock.sha"
[ -n "$PYHASH" ] && echo "$PYHASH" > "${DATA}/rollback/last-pyproject.sha"
rm -f "${DATA}/rollback/bad-sha" "$STUCK_FILE"
echo "pull-release OK ${NEW_SHA}"
