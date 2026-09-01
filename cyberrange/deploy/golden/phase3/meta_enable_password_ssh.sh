#!/bin/bash
# meta_enable_password_ssh.sh — enable SSH password auth on the meta target.
# Idempotent. Run INSIDE the container. By design: meta is an intentionally-vulnerable,
# network-isolated lab target accessed as msfadmin/msfadmin (ssh_bridge_hardening_design.md).
# Stock Ubuntu cloud images ship sshd_config.d/60-cloudimg-settings.conf = "no"; we override
# with a lower-numbered drop-in (sshd first-match-wins, dirs read before main config).
set -e
DROPIN=/etc/ssh/sshd_config.d/10-cyberrange-meta.conf
cat > "$DROPIN" <<'EOF'
# Cyber-range meta target: intentionally-vulnerable box reached as msfadmin/msfadmin.
# Overrides 60-cloudimg-settings.conf (lower number = read first = wins).
PasswordAuthentication yes
EOF
chmod 644 "$DROPIN"
sshd -t                                   # validate before any restart
systemctl restart ssh 2>/dev/null || systemctl restart sshd
echo "RESULT: effective=$(sshd -T 2>/dev/null | grep -i '^passwordauthentication')"
