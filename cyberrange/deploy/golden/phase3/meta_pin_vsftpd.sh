#!/bin/bash
# meta_pin_vsftpd.sh — attempt vsftpd 2.3.4 pin for B-min FTP pedagogy.
# Idempotent. On failure prints VSFTPD_PIN=SKIP and exits 0 (stock vsftpd kept).
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

if vsftpd -v 0>&2 2>&1 | grep -q '2\.3\.4'; then
  echo "RESULT: VSFTPD_PIN=already-2.3.4"
  systemctl enable vsftpd 2>/dev/null || true
  systemctl restart vsftpd 2>/dev/null || true
  exit 0
fi

apt-get update -qq
apt-get install -y -qq vsftpd build-essential wget

PIN_DIR=/tmp/vsftpd-2.3.4-build
rm -rf "$PIN_DIR"
mkdir -p "$PIN_DIR"
cd "$PIN_DIR"

if ! wget -q -O vsftpd-2.3.4.tar.gz https://security.appspot.com/downloads/vsftpd-2.3.4.tar.gz; then
  echo "RESULT: VSFTPD_PIN=SKIP (download failed; using stock $(vsftpd -v 0>&2 2>&1 | head -1))"
  systemctl enable vsftpd 2>/dev/null || true
  systemctl restart vsftpd 2>/dev/null || true
  exit 0
fi

tar xzf vsftpd-2.3.4.tar.gz
cd vsftpd-2.3.4
make >/dev/null 2>&1 || {
  echo "RESULT: VSFTPD_PIN=SKIP (compile failed; using stock $(vsftpd -v 0>&2 2>&1 | head -1))"
  systemctl enable vsftpd 2>/dev/null || true
  systemctl restart vsftpd 2>/dev/null || true
  exit 0
}

systemctl stop vsftpd 2>/dev/null || true
cp -f vsftpd /usr/local/sbin/vsftpd
chmod 755 /usr/local/sbin/vsftpd

if grep -q '^#listen=YES' /etc/vsftpd.conf 2>/dev/null; then
  sed -i 's/^#listen=YES/listen=YES/' /etc/vsftpd.conf
fi
if ! grep -q '^listen=YES' /etc/vsftpd.conf 2>/dev/null; then
  echo 'listen=YES' >> /etc/vsftpd.conf
fi

cat > /etc/systemd/system/vsftpd.service <<'EOF'
[Unit]
Description=vsftpd FTP server (pinned 2.3.4)
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/sbin/vsftpd /etc/vsftpd.conf
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable vsftpd
systemctl restart vsftpd

if /usr/local/sbin/vsftpd -v 0>&2 2>&1 | grep -q '2\.3\.4'; then
  echo "RESULT: VSFTPD_PIN=2.3.4"
else
  echo "RESULT: VSFTPD_PIN=SKIP (post-install version mismatch)"
fi