#!/bin/bash
# enable_history_flush.sh
#
# Manual-scoring support. The web terminal (bridge.py) drops the student into a
# *persistent* tmux session; an interactive bash only writes ~/.bash_history on
# clean exit, which never happens (closing the browser merely detaches tmux).
# The agentless behavioral verifier (scoring_checks.sh) greps ~/.bash_history,
# so without a flush every history-based milestone returns FAIL.
#
# This forces every interactive bash to append each finished command to
# ~/.bash_history via:
#   1) PROMPT_COMMAND (history -a on prompt return)
#   2) DEBUG trap (history -a after every simple command) — belt + suspenders
#      when something later overwrites PROMPT_COMMAND (kali themes, etc.)
#   3) Explicit HISTFILE / histappend / set -o history
#
# Single source of truth: wired into golden build scripts AND used to hotpatch
# live goldens/pods. Idempotent.
#
# Run INSIDE the target container:
#   lxc exec <container> -- bash -s < enable_history_flush.sh
#
# NOTE (timing): a long-running command is recorded when it completes (or when
# the DEBUG trap fires after the next statement). Students must let nmap finish
# before requesting verification.

set -euo pipefail

HISTORY_BLOCK_BEGIN='# === cyberrange history flush (scoring) BEGIN ==='
HISTORY_BLOCK_END='# === cyberrange history flush (scoring) END ==='

HISTORY_BLOCK=$(cat <<'EOF'
# === cyberrange history flush (scoring) BEGIN ===
# Required so portal "Manual Check" can see commands run in the tmux lab shell.
export HISTFILE="${HISTFILE:-$HOME/.bash_history}"
export HISTSIZE="${HISTSIZE:-10000}"
export HISTFILESIZE="${HISTFILESIZE:-20000}"
shopt -s histappend 2>/dev/null || true
set -o history 2>/dev/null || true
# Avoid losing history -a if something else reassigns PROMPT_COMMAND later.
case "${PROMPT_COMMAND:-}" in
  *history\ -a*) ;;
  *) PROMPT_COMMAND="${PROMPT_COMMAND:+$PROMPT_COMMAND; }history -a" ;;
esac
export PROMPT_COMMAND
# DEBUG trap: flush after every command (tmux-safe; idempotent install below).
case "${SHELLOPTS:-}${BASHOPTS:-}" in
  *) ;;
esac
if [[ -z "${CYBERRANGE_HIST_TRAP:-}" ]]; then
  trap 'history -a' DEBUG
  export CYBERRANGE_HIST_TRAP=1
fi
# === cyberrange history flush (scoring) END ===
EOF
)

patch_file() {
  local f="$1"
  [ -f "$f" ] || return 0
  if grep -q 'cyberrange history flush (scoring) BEGIN' "$f" 2>/dev/null; then
    # Replace existing block so upgrades pick up DEBUG trap.
    local tmp
    tmp=$(mktemp)
    awk -v begin="$HISTORY_BLOCK_BEGIN" -v end="$HISTORY_BLOCK_END" '
      $0 == begin {skip=1; next}
      $0 == end {skip=0; next}
      !skip {print}
    ' "$f" > "$tmp"
    cat "$tmp" > "$f"
    rm -f "$tmp"
    printf '%s\n' "$HISTORY_BLOCK" >> "$f"
    echo "[+] refreshed: $f"
  elif grep -q 'history -a' "$f" 2>/dev/null; then
    # Old one-liner style — append full block (DEBUG trap is the important add).
    printf '\n%s\n' "$HISTORY_BLOCK" >> "$f"
    echo "[+] upgraded (kept prior history -a): $f"
  else
    printf '\n%s\n' "$HISTORY_BLOCK" >> "$f"
    echo "[+] patched: $f"
  fi
}

# Patch root, every /home user, and /etc/skel (future users).
for f in /root/.bashrc /home/*/.bashrc /etc/skel/.bashrc /etc/bash.bashrc; do
  # shellcheck disable=SC2086
  for g in $f; do
    [ -e "$g" ] || continue
    patch_file "$g"
  done
done

# Ensure history files exist and are owned correctly so the first command can append.
for home in /root /home/*; do
  [ -d "$home" ] || continue
  user=$(basename "$home")
  [ "$home" = "/root" ] && user=root
  hist="$home/.bash_history"
  if [ ! -f "$hist" ]; then
    touch "$hist"
    echo "[+] created: $hist"
  fi
  if id "$user" >/dev/null 2>&1; then
    chown "$user:$user" "$hist" 2>/dev/null || true
    chmod 600 "$hist" 2>/dev/null || true
  fi
done

echo "[*] enable_history_flush: done"
