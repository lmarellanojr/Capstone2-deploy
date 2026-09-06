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
  exit 0
fi
if [ "$APPLY_RC" -ne 0 ]; then
  echo "pull-release check-apply failed rc=$APPLY_RC" >&2
  echo "$APPLY_OUT" >&2
  exit 1
fi
NEW_SHA="$APPLY_OUT"

if [ -f "${DATA}/rollback/bad-sha" ] && [ "$(tr -d '\r\n' < "${DATA}/rollback/bad-sha")" = "$NEW_SHA" ]; then
  echo "pull-release skip: $NEW_SHA already failed; waiting for a newer Release"
  exit 0
fi

fail_apply() {
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

GOT="$("$PY" "$SYNC" --lock-hash "${ROOT}/portal/package-lock.json")"
WANT="$("$PY" - "${WORK}/manifest.json" <<'PY'
import json, sys
m = json.load(open(sys.argv[1], encoding="utf-8"))
print(m["lockfile_sha256"])
PY
)"
if [ "$GOT" != "$WANT" ]; then
  echo "pull-release lockfile integrity mismatch" >&2
  fail_apply
fi

LAST=""
if [ -f "${DATA}/rollback/last-lock.sha" ]; then
  LAST="$(tr -d '\r\n' < "${DATA}/rollback/last-lock.sha")"
fi
if [ "$GOT" != "$LAST" ]; then
  (
    cd "${ROOT}/portal"
    npm ci --omit=dev
  ) || fail_apply
fi

restart_units
sleep 10

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

if ! health; then
  echo "pull-release health check failed" >&2
  fail_apply
fi

echo "$NEW_SHA" > "${ROOT}/DEPLOYED_SHA"
echo "$GOT" > "${DATA}/rollback/last-lock.sha"
rm -f "${DATA}/rollback/bad-sha"
echo "pull-release OK ${NEW_SHA}"
