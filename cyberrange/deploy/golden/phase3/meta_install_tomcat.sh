#!/bin/bash
# meta_install_tomcat.sh — Tomcat Manager on port 8180 for Scenario 03 (B-min).
# Idempotent. Run INSIDE the meta container. Lab-by-design creds: tomcat/tomcat.
set -euo pipefail

TOMCAT_PKG="${TOMCAT_PKG:-tomcat9}"
TOMCAT_ETC="/etc/${TOMCAT_PKG}"
TOMCAT_USERS="${TOMCAT_ETC}/tomcat-users.xml"
SERVER_XML="${TOMCAT_ETC}/server.xml"

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq "${TOMCAT_PKG}" tomcat9-admin curl

# Connector on 8180 (Scenario 03 / tomcat_mgr_deploy default in portal).
if ! grep -q 'port="8180"' "$SERVER_XML" 2>/dev/null; then
  sed -i 's/port="8080" protocol="HTTP\/1.1"/port="8180" protocol="HTTP\/1.1"/' "$SERVER_XML"
fi

# Manager app credentials (intentionally weak lab target).
cat > "$TOMCAT_USERS" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<tomcat-users xmlns="http://tomcat.apache.org/xml"
              xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
              xsi:schemaLocation="http://tomcat.apache.org/xml tomcat-users.xsd"
              version="1.0">
  <role rolename="manager-gui"/>
  <role rolename="manager-script"/>
  <role rolename="manager-jmx"/>
  <role rolename="manager-status"/>
  <user username="tomcat" password="tomcat" roles="manager-gui,manager-script,manager-jmx,manager-status"/>
</tomcat-users>
EOF

# Debian tomcat9: admin contexts live under /etc; link into catalina.base.
mkdir -p /var/lib/tomcat9/conf/Catalina/localhost
for ctx in manager host-manager; do
  src="/etc/tomcat9/Catalina/localhost/${ctx}.xml"
  dst="/var/lib/tomcat9/conf/Catalina/localhost/${ctx}.xml"
  if [[ -f "$src" && ! -e "$dst" ]]; then
    ln -sf "$src" "$dst"
  fi
done

systemctl enable "${TOMCAT_PKG}"
systemctl restart "${TOMCAT_PKG}"

# Gate before golden publish.
sleep 4
ss -lntp | grep -q ':8180 ' || { echo "FAIL: Tomcat not listening on 8180"; exit 1; }
code=$(curl -s -o /dev/null -w '%{http_code}' -u tomcat:tomcat http://127.0.0.1:8180/manager/html || true)
case "$code" in
  200|401|403) echo "RESULT: tomcat8180=ok http_code=${code}" ;;
  *) echo "FAIL: manager/html unreachable (http_code=${code})"; exit 1 ;;
esac