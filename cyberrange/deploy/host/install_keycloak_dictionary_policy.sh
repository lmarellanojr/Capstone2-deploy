#!/usr/bin/env bash
# Install the prebuilt Keycloak 25.0.6 dictionary provider; Maven is not needed.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${DICTIONARY_POLICY_JAR:-$ROOT/keycloak/providers/cyberrange-dictionary-policy-1.0.0.jar}"
DST=/opt/keycloak/providers/cyberrange-dictionary-policy-1.0.0.jar
[[ -s "$SRC" ]] || { echo "missing dictionary provider artifact: $SRC (build with Maven first)"; exit 1; }
# Refuse malformed archives and jars without their SPI registration/data.
python3 - "$SRC" <<'PY'
import hashlib, sys, zipfile
try:
    with zipfile.ZipFile(sys.argv[1]) as jar:
        if jar.testzip() is not None:
            raise ValueError("corrupt archive")
        registration = jar.read("META-INF/services/org.keycloak.policy.PasswordPolicyProviderFactory").decode()
        if "edu.mmdc.cyberrange.policy.DictionaryPasswordPolicyProviderFactory" not in registration.split():
            raise ValueError("dictionary provider registration missing")
        dictionary = jar.read("dictionary/scowl-en-v1.txt")
        if hashlib.sha256(dictionary).hexdigest() != "981da5c06d01da21cdf6f37def0661ffb028266d21ce8f572510a5022e0a238d":
            raise ValueError("embedded dictionary checksum mismatch")
        metadata = dict(line.split("=", 1) for line in jar.read("META-INF/cyberrange-dictionary-policy.properties").decode().splitlines() if "=" in line and not line.startswith("#"))
        for key, value in {"keycloak.version": "25.0.6", "policy.id": "dictionaryWords", "dictionary.id": "scowl-en-v1"}.items():
            if metadata.get(key) != value:
                raise ValueError("incompatible provider metadata: " + key)
except (ValueError, KeyError, OSError, zipfile.BadZipFile) as error:
    sys.exit("invalid dictionary provider artifact: " + str(error))
PY
lxc info guacamole >/dev/null 2>&1 || { echo "guacamole not found"; exit 1; }
version=$(lxc exec guacamole -- /opt/keycloak/bin/kc.sh --version)
[[ "$version" =~ ^Keycloak[[:space:]]25\.0\.6([[:space:]]|$) ]] || {
  echo "unsupported Keycloak version; dictionary provider requires 25.0.6"; exit 1;
}
new_sum=$(sha256sum "$SRC" | cut -d' ' -f1)
old_sum=$(lxc exec guacamole -- sh -c "sha256sum '$DST' 2>/dev/null | cut -d' ' -f1" || true)
if [[ "$new_sum" == "$old_sum" ]]; then
  # Repair metadata after install_keycloak_unit.sh ownership setup too.
  lxc exec guacamole -- chown root:root "$DST"
  lxc exec guacamole -- chmod 0644 "$DST"
  echo DICTIONARY_POLICY_UNCHANGED
  exit 0
fi
lxc exec guacamole -- mkdir -p /opt/keycloak/providers
stage="${DST}.stage-$$"
trap 'lxc exec guacamole -- rm -f "$stage" >/dev/null 2>&1 || true' EXIT
lxc file push "$SRC" "guacamole${stage}" </dev/null
lxc exec guacamole -- chown root:root "$stage"
lxc exec guacamole -- chmod 0644 "$stage"
staged_sum=$(lxc exec guacamole -- sha256sum "$stage" | cut -d' ' -f1)
[[ "$staged_sum" == "$new_sum" ]] || { echo "dictionary provider checksum mismatch"; exit 1; }
lxc exec guacamole -- mv -f "$stage" "$DST"
if lxc exec guacamole -- systemctl is-active --quiet keycloak.service; then
  lxc exec guacamole -- systemctl restart keycloak.service
  deadline=$((SECONDS + ${DICTIONARY_POLICY_READY_TIMEOUT:-120}))
  until lxc exec guacamole -- curl -fsS --max-time 3 http://127.0.0.1:8083/auth/realms/master/.well-known/openid-configuration >/dev/null 2>&1; do
    if (( SECONDS >= deadline )); then echo "ERROR: keycloak not ready after dictionary provider restart"; exit 1; fi
    sleep 5
  done
fi
echo DICTIONARY_POLICY_INSTALLED
