#!/usr/bin/env bash
# Apply GitHub Release ampere-live into ~/cyberrange. No self-hosted runner.
set -euo pipefail
umask 077

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
sync_wazuh_api_cert() {
  local helper="${ROOT}/deploy/host/sync_wazuh_api_cert.py"
  if [ ! -f "$helper" ]; then
    return 0
  fi
  "$PY" "$helper" --root "$ROOT" --data "$DATA" || \
    echo "pull-release: wazuh-api.crt sync non-fatal failure" >&2
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
  # Still heal a mismatched host pin when the release SHA is unchanged.
  sync_wazuh_api_cert
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
sync_wazuh_api_cert

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
