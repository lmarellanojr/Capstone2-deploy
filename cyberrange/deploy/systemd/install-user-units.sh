#!/bin/bash
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
mkdir -p "$DEST"
cp -f "$SRC/cyberrange-provision-api.service" \
      "$SRC/cyberrange-ssh-bridge.service" \
      "$SRC/cyberrange-portal.service" \
      "$DEST/"
systemctl --user daemon-reload
# linger so units survive SSH logout
loginctl enable-linger "$USER" 2>/dev/null || echo "LINGER_FAILED use crontab @reboot"
systemctl --user enable cyberrange-provision-api.service \
  cyberrange-ssh-bridge.service cyberrange-portal.service
