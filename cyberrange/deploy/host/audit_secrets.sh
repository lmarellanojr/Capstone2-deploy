#!/usr/bin/env bash
# Wrapper: the scanner is audit_secrets.py (works on Windows and Ampere).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PY="$SCRIPT_DIR/audit_secrets.py"
if command -v python3 >/dev/null 2>&1; then
  exec python3 "$PY"
fi
if command -v python >/dev/null 2>&1; then
  exec python "$PY"
fi
echo "audit_secrets FAIL: python3/python not found" >&2
exit 1
