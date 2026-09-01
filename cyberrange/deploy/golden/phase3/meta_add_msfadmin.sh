#!/bin/bash
# meta_add_msfadmin.sh — create the by-design vulnerable lab account on a meta target.
# Idempotent. Run INSIDE the container (e.g. `lxc file push` then `lxc exec <ctr> -- bash /tmp/...`).
# msfadmin/msfadmin are FIXED LAB CREDS by design (intentionally vulnerable box), not secrets.
# NOT added to sudo on the golden by design. Served S4 (Vulnerability Hardening,
# portal id 11) needs root on the ephemeral meta pod to edit tomcat-users.xml —
# that grant is applied at provision time in Phase 5 provision.py (msfadmin
# NOPASSWD), not baked into the golden. Do not "fix" the golden by adding sudo.
set -e
if id msfadmin >/dev/null 2>&1; then
  echo "msfadmin exists; ensuring password + shell"
  usermod -s /bin/bash msfadmin
else
  useradd -m -s /bin/bash msfadmin
fi
echo 'msfadmin:msfadmin' | chpasswd
# Scenario 02 M3 lab flag (msfadmin-scope; not /root).
echo 'CYBERRANGE_META_BMIN_FLAG' > /home/msfadmin/flag.txt
chown msfadmin:msfadmin /home/msfadmin/flag.txt
chmod 644 /home/msfadmin/flag.txt
echo "RESULT: $(getent passwd msfadmin) | groups=$(id -nG msfadmin | tr ' ' ',') | flag=/home/msfadmin/flag.txt"
