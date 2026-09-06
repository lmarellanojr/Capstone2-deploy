#!/usr/bin/env bash
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
mkdir -p "$DEST"
cp -f "$SRC/cyberrange-pull-release.service" "$SRC/cyberrange-pull-release.timer" "$DEST/"
systemctl --user daemon-reload
if [[ "${1:-}" == "--enable" ]]; then
  systemctl --user enable --now cyberrange-pull-release.timer
  echo "pull-release timer enabled"
else
  echo "units installed; timer not enabled (pass --enable)"
fi
