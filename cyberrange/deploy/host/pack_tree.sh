#!/usr/bin/env bash
# Pack the current directory (must be cyberrange/) into $1 or ./tree.tgz
set -euo pipefail
OUT="${1:-tree.tgz}"
tar --exclude='.git' \
    --exclude='.mypy_cache' \
    --exclude='.pytest_cache' \
    --exclude='.superpowers' \
    --exclude='__pycache__' \
    --exclude='node_modules' \
    --exclude='.next' \
    --exclude='.venv' \
    --exclude='.env' \
    --exclude='.env.local' \
    --exclude='.env.bridge' \
    -czf "$OUT" .
echo "packed $OUT"
