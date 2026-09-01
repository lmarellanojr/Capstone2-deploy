#!/usr/bin/env bash
# Host-side Keycloak introspect reachability (2026-08-05 auth-target drift prevention).
# TRB C-R2: fail closed — only 401/400 count as pass. No WARN+exit 0.
#
# 401 Unauthorized without client credentials = endpoint up.
# Connection refused / timeout / 000 = FAIL (the 2026-07-24 outage class).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
P5_ENV="${P5_ENV:-$ROOT/Development Phase/Phase 5/scripts/.env}"
URL="${KEYCLOAK_INTROSPECT_URL:-}"
if [[ -z "$URL" && -f "$P5_ENV" ]]; then
  URL="$(grep -E '^KEYCLOAK_INTROSPECT_URL=' "$P5_ENV" | cut -d= -f2- | tr -d '\r' | head -1)"
fi
if [[ -z "$URL" ]]; then
  echo "FAIL: KEYCLOAK_INTROSPECT_URL unset and not found in $P5_ENV"
  exit 2
fi
case "$URL" in
  *10.115.77.152*) echo "FAIL: dead IP 10.115.77.152 in URL"; exit 2 ;;
  *guacamole.lxd*) echo "FAIL: guacamole.lxd is not host-resolvable"; exit 2 ;;
  *GATEWAY_CONTAINER_IP*|*GATEWAY_LXDBR0_IP*|*GATEWAY_*) echo "FAIL: unresolved placeholder in URL: $URL"; exit 2 ;;
  https://*) echo "FAIL: public/tunnel HTTPS URL must not be used for introspect"; exit 2 ;;
esac
code="$(curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 3 --max-time 8 \
  -X POST "$URL" -d 'token=smoke' 2>/dev/null || echo 000)"
if [[ "$code" == "000" ]]; then
  echo "FAIL: no HTTP response from $URL (connect/timeout) — host cannot reach introspect target"
  exit 1
fi
if [[ "$code" == "401" || "$code" == "400" ]]; then
  echo "ok: introspect reachable code=$code url=$URL"
  exit 0
fi
echo "FAIL: unexpected HTTP $code from $URL (want 401 or 400; reject 404/5xx/other)"
exit 1
