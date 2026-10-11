#!/bin/bash
# Rebake a target golden with the manager-pinned Wazuh agent and auth.log input.
# Requires no provisioned lab pods. Preserves the original image under a fingerprint-
# anchored rollback alias and restores the primary alias if publishing fails.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ALIAS="${1:?usage: bake_wazuh_agent.sh <golden_alias>}"
WORK="bake-${ALIAS}-$$"
STAMP="$(date +%Y%m%d%H%M%S)-$$"
ROLLBACK_ALIAS="${ALIAS}-prewazuh-${STAMP}"
CANDIDATE_ALIAS="${ALIAS}-wazuh-candidate-${STAMP}"
ROLLBACK_KEEP=2
OLD_FP=""
NEW_FP=""
PRIMARY_MUTATION_STARTED=0
PRIMARY_UPDATED=0

alias_fingerprint() {
  lxc image alias list --format csv | awk -F, -v a="$1" '$1==a {print $2; exit}'
}

cleanup() {
  local result=$?
  if [ "$PRIMARY_MUTATION_STARTED" -eq 1 ] && [ "$PRIMARY_UPDATED" -eq 0 ]; then
    echo "[!] Publish failed; restoring ${ALIAS} -> ${OLD_FP:0:12}" >&2
    lxc image alias delete "$ALIAS" >/dev/null 2>&1 || true
    if ! lxc image alias create "$ALIAS" "$OLD_FP" >/dev/null 2>&1; then
      echo "[!] Restore failed; recover ${ALIAS} from ${ROLLBACK_ALIAS}" >&2
      result=1
    fi
  fi
  lxc image alias delete "$CANDIDATE_ALIAS" >/dev/null 2>&1 || true
  if [ "$PRIMARY_UPDATED" -eq 0 ] && [ -n "${NEW_FP:-}" ]; then
    lxc image delete "$NEW_FP" >/dev/null 2>&1 || true
  fi
  lxc delete "$WORK" --force >/dev/null 2>&1 || true
  return "$result"
}

prune_prewazuh_rollbacks() {
  local prefix="${ALIAS}-prewazuh-"
  local i=0 a fp
  while IFS= read -r a; do
    [ -n "$a" ] || continue
    i=$((i + 1))
    [ "$i" -le "$ROLLBACK_KEEP" ] && continue
    fp="$(alias_fingerprint "$a")"
    lxc image alias delete "$a" >/dev/null 2>&1 || true
    if [ -n "$fp" ] && ! lxc image alias list --format csv | awk -F, -v f="$fp" '$2==f {found=1} END {exit !found}'; then
      lxc image delete "$fp" >/dev/null 2>&1 || true
    fi
  done < <(lxc image alias list --format csv | awk -F, -v p="$prefix" 'index($1, p)==1 {print $1}' | sort -r)
}
trap cleanup EXIT

OLD_FP="$(alias_fingerprint "$ALIAS")"
[ -n "$OLD_FP" ] || { echo "[!] No exact image alias found for ${ALIAS}" >&2; exit 1; }

echo "[*] preflight"
if lxc list --format csv -c n | grep -Eq '^pod-.*-(kali|meta|dvwa)$'; then
  echo "[!] lab pods exist -- destroy them before rebaking ${ALIAS}:" >&2
  lxc list --format csv -c n | grep -E '^pod-.*-(kali|meta|dvwa)$' | sed 's/^/      /' >&2
  exit 1
fi

echo "[*] Cloning ${ALIAS} -> ${WORK} on default profile (apt egress)"
timeout 10m lxc init "$ALIAS" "$WORK" -p default </dev/null \
  || { echo "[!] Timeout creating ${WORK}" >&2; exit 1; }
timeout 5m lxc start "$WORK" </dev/null \
  || { echo "[!] Timeout starting ${WORK}" >&2; exit 1; }
for i in $(seq 1 30); do
  lxc exec "$WORK" -- getent hosts packages.wazuh.com >/dev/null 2>&1 && break
  [ "$i" = 30 ] && { echo "[!] no apt egress from ${WORK}" >&2; exit 1; }
  sleep 2
done

echo "[*] Installing Wazuh agent 4.7.5 and rsyslog"
lxc exec "$WORK" -- bash -s <<'INSTALL'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y curl gnupg ca-certificates rsyslog
key_file="$(mktemp)"
trap 'rm -f "$key_file"' EXIT
curl -fsSL https://packages.wazuh.com/key/GPG-KEY-WAZUH -o "$key_file"
expected_fingerprint="0DCFCA5547B19D2A6099506096B3EE5F29111145"
actual_fingerprint="$(gpg --batch --show-keys --with-colons "$key_file" \
  | awk -F: '$1 == "fpr" { print toupper($10); exit }')"
[ "$actual_fingerprint" = "$expected_fingerprint" ] || {
  echo "unexpected Wazuh signing key fingerprint: ${actual_fingerprint}" >&2; exit 1;
}
gpg --batch --no-default-keyring --keyring gnupg-ring:/usr/share/keyrings/wazuh.gpg --import "$key_file"
chmod 644 /usr/share/keyrings/wazuh.gpg
echo "deb [signed-by=/usr/share/keyrings/wazuh.gpg] https://packages.wazuh.com/4.x/apt/ stable main" \
  > /etc/apt/sources.list.d/wazuh.list
apt-get update
version="$(apt-cache madison wazuh-agent | awk '$3 ~ /^4\.7\.5-/ { print $3; exit }')"
[ -n "$version" ] || { echo "no wazuh-agent 4.7.5 candidate" >&2; exit 1; }
apt-get install -y "wazuh-agent=${version}"
apt-mark hold wazuh-agent
apt-get clean
rm -rf /var/lib/apt/lists/*
INSTALL

echo "[*] Configuring auth.log routing and Wazuh collection"
lxc exec "$WORK" -- bash -s <<'CONFIGURE'
set -euo pipefail
if ! grep -REq '^[[:space:]]*auth,authpriv\.\*[[:space:]]+/var/log/auth\.log([[:space:]]|$)' \
  /etc/rsyslog.conf /etc/rsyslog.d --include='*.conf' 2>/dev/null; then
  printf '%s\n' 'auth,authpriv.*    /var/log/auth.log' > /etc/rsyslog.d/99-cyberrange-auth.conf
fi
systemctl enable rsyslog
systemctl restart rsyslog
sed -i 's#<address>.*</address>#<address>MANAGER_IP</address>#' /var/ossec/etc/ossec.conf
python3 - <<'PY'
from pathlib import Path
import re

path = Path('/var/ossec/etc/ossec.conf')
text = path.read_text()
pattern = re.compile(r'<localfile\b[^>]*>.*?</localfile>', re.DOTALL)
blocks = list(pattern.finditer(text))
auth = [m for m in blocks if re.search(r'<location>\s*/var/log/auth\.log\s*</location>', m.group())]
valid = [m for m in auth if re.search(r'<log_format>\s*syslog\s*</log_format>', m.group())]
if valid:
    keep = valid[0]
    for match in reversed(auth):
        if match is not keep:
            text = text[:match.start()] + text[match.end():]
else:
    for match in reversed(auth):
        text = text[:match.start()] + text[match.end():]
    entry = '  <localfile>\n    <log_format>syslog</log_format>\n    <location>/var/log/auth.log</location>\n  </localfile>\n'
    end = text.rfind('</ossec_config>')
    if end < 0:
        raise SystemExit('ossec.conf has no closing </ossec_config>')
    text = text[:end] + entry + text[end:]
path.write_text(text)
PY
: > /var/ossec/etc/client.keys
chown root:wazuh /var/ossec/etc/client.keys
chmod 640 /var/ossec/etc/client.keys
systemctl disable wazuh-agent || true
systemctl stop wazuh-agent || true
rm -f /var/ossec/queue/rids/* /var/ossec/queue/agent-info/* 2>/dev/null || true
: > /var/ossec/logs/ossec.log
rm -f /var/lib/dbus/machine-id
: > /etc/machine-id
CONFIGURE

echo "[*] Validating staging image while services are running"
lxc file push "${SCRIPT_DIR}/ossec_localfile.py" "${WORK}/tmp/ossec_localfile.py" </dev/null
lxc exec "$WORK" -- bash -s <<'VALIDATE'
set -euo pipefail
test "$(dpkg --print-architecture)" = arm64
dpkg-query -W -f='${Version}\n' wazuh-agent | grep -q '^4\.7\.5-'
grep -q '<address>MANAGER_IP</address>' /var/ossec/etc/ossec.conf
PYTHONPATH=/tmp python3 - <<'PY'
from pathlib import Path
from ossec_localfile import authlog_syslog_entries
entries = authlog_syslog_entries(Path('/var/ossec/etc/ossec.conf').read_text())
assert len(entries) == 1, f'expected one auth.log syslog entry; got {len(entries)}'
PY
grep -REq '^[[:space:]]*auth,authpriv\.\*[[:space:]]+/var/log/auth\.log([[:space:]]|$)' \
  /etc/rsyslog.conf /etc/rsyslog.d --include='*.conf'
systemctl is-enabled --quiet rsyslog
systemctl is-active --quiet rsyslog
probe="cyberrange-authlog-bake-$$"
logger -p authpriv.notice -t cyberrange-bake "$probe"
for i in $(seq 1 10); do
  grep -Fq "$probe" /var/log/auth.log && break
  [ "$i" = 10 ] && { echo "authpriv probe did not reach /var/log/auth.log" >&2; exit 1; }
  sleep 1
done
: > /var/log/auth.log
: > /var/log/syslog 2>/dev/null || true
: > /var/log/dpkg.log 2>/dev/null || true
test -f /var/log/auth.log
test ! -s /var/log/auth.log
test ! -s /etc/machine-id
test "$(systemctl is-active wazuh-agent 2>/dev/null || true)" != active
VALIDATE

echo "[*] Stopping validated staging image"
lxc stop "$WORK" </dev/null
lxc image alias create "$ROLLBACK_ALIAS" "$OLD_FP"
echo "[*] Publishing validated candidate image"
lxc publish "$WORK" --alias "$CANDIDATE_ALIAS" --compression zstd \
  description="${ALIAS} + wazuh-agent 4.7.5 auth.log collection (S2 ${STAMP})" </dev/null
NEW_FP="$(alias_fingerprint "$CANDIDATE_ALIAS")"
[ -n "$NEW_FP" ] || { echo "[!] candidate alias missing after publish" >&2; exit 1; }

echo "[*] Updating primary alias; rollback is ${ROLLBACK_ALIAS} (${OLD_FP:0:12})"
PRIMARY_MUTATION_STARTED=1
lxc image alias delete "$ALIAS"
lxc image alias create "$ALIAS" "$NEW_FP"
[ "$(alias_fingerprint "$ALIAS")" = "$NEW_FP" ] || {
  echo "[!] primary alias does not resolve to validated image" >&2; exit 1;
}
PRIMARY_UPDATED=1
lxc image alias delete "$CANDIDATE_ALIAS"
prune_prewazuh_rollbacks
echo "[+] Rebaked ${ALIAS}; rollback alias = ${ROLLBACK_ALIAS} (fp ${OLD_FP:0:12})"
