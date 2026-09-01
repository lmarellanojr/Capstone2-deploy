#!/usr/bin/env bash
# Install restricted passwordless-sudo wrapper for LXD OVN network peer create/delete.
#
# Why: on some hosts, `lxc network peer create|delete` hangs or times out (120s)
# for non-root LXD unix clients while the same ops succeed as root. The provision
# API runs as the operator user (e.g. llms_admin), so peer create must go through
# this wrapper. Eng pod_net.py already calls:
#   sudo -n /usr/local/sbin/cyberrange-lxc-peer create|delete ...
#
# Safe scope: only create|delete on "network peer". No other lxc verbs.
#
# Usage (on LXD host, as root or via sudo):
#   sudo bash deploy/host/install_cyberrange_lxc_peer.sh
#   sudo bash deploy/host/install_cyberrange_lxc_peer.sh llms_admin   # explicit user
#
# Related: deploy/host/fix_ovn_peer.sh (OVN remote/chassis repair — different
# problem). Original evidence lived in the OCI staging notes, which were not
# packed into this repo.
set -euo pipefail

PEER_USER="${1:-${SUDO_USER:-${USER:-llms_admin}}}"
if [[ "$PEER_USER" == "root" ]]; then
  echo "Refuse to install for root; pass the provision-api user (e.g. llms_admin)." >&2
  exit 2
fi

WRAPPER=/usr/local/sbin/cyberrange-lxc-peer
SUDOERS=/etc/sudoers.d/cyberrange-ovn-peer

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo bash $0 ${PEER_USER}" >&2
  exit 1
fi

install -d -m 755 /usr/local/sbin

cat >"$WRAPPER" <<'WRAP'
#!/usr/bin/env bash
set -euo pipefail
export PATH="/snap/bin:/usr/sbin:/usr/bin:/bin"
LXC=$(command -v lxc)
if [[ $# -lt 2 ]]; then
  echo "usage: cyberrange-lxc-peer create|delete <args...>" >&2
  exit 2
fi
action=$1
shift
case "$action" in
  create|delete) ;;
  *) echo "denied: $action" >&2; exit 2 ;;
esac
# stdin closed: avoid hung peer CLI waiting on TTY
exec "$LXC" --project default network peer "$action" "$@" </dev/null
WRAP
chmod 755 "$WRAPPER"

# Write sudoers via temp file then install — never feed password + body on same stdin
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT
# shellcheck disable=SC2028
printf '%s ALL=(root) NOPASSWD: %s\n' "$PEER_USER" "$WRAPPER" >"$TMP"
chmod 440 "$TMP"
if ! visudo -cf "$TMP"; then
  echo "sudoers syntax check failed" >&2
  exit 1
fi
install -m 440 "$TMP" "$SUDOERS"
visudo -cf "$SUDOERS"

echo "Installed:"
echo "  $WRAPPER"
echo "  $SUDOERS  (user=$PEER_USER)"
echo "Verify (as $PEER_USER):"
echo "  sudo -n $WRAPPER 2>&1 | head -2"
echo "  # expect usage line, not a password prompt"
echo "Then: sudo systemctl restart cyberrange-provision-api"
