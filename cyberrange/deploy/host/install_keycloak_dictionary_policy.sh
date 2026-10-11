#!/usr/bin/env bash
# Install the prebuilt Keycloak 25.0.6 dictionary provider; Maven is not needed.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${DICTIONARY_POLICY_JAR:-$ROOT/keycloak/providers/cyberrange-dictionary-policy-1.0.0.jar}"
DST=/opt/keycloak/providers/cyberrange-dictionary-policy-1.0.0.jar
PINNED_JAR_SHA256=7cdc29ef4fa8a8ded203ed60e1643ebbd4c12016369b0c307cdea4df65636ad4
[[ -s "$SRC" ]] || { echo "missing dictionary provider artifact: $SRC (build with Maven first)"; exit 1; }
if [[ -z "${DICTIONARY_POLICY_JAR:-}" ]]; then
  expected_sum=$PINNED_JAR_SHA256
else
  [[ "${DICTIONARY_POLICY_JAR_SHA256:-}" =~ ^[a-fA-F0-9]{64}$ ]] || {
    echo "DICTIONARY_POLICY_JAR_SHA256 is required when overriding the pinned provider JAR"; exit 1;
  }
  expected_sum=${DICTIONARY_POLICY_JAR_SHA256,,}
fi
actual=$(sha256sum "$SRC" | cut -d' ' -f1)
[[ "$actual" == "$expected_sum" ]] || { echo "dictionary provider JAR checksum mismatch"; exit 1; }
# Refuse malformed archives, extra SPIs/classes, and jars without their SPI registration/data.
python3 - "$SRC" <<'PY'
import hashlib, sys, zipfile
ALLOWED_CLASSES = {
    "edu/mmdc/cyberrange/policy/DictionaryMatcher.class",
    "edu/mmdc/cyberrange/policy/DictionaryPasswordPolicyProvider.class",
    "edu/mmdc/cyberrange/policy/DictionaryPasswordPolicyProviderFactory.class",
}
SPI = "META-INF/services/org.keycloak.policy.PasswordPolicyProviderFactory"
try:
    with zipfile.ZipFile(sys.argv[1]) as jar:
        if jar.testzip() is not None:
            raise ValueError("corrupt archive")
        for name in jar.namelist():
            if name.startswith("META-INF/services/") and not name.endswith("/") and name != SPI:
                raise ValueError("unexpected SPI registration: " + name)
            if name.endswith(".class") and name not in ALLOWED_CLASSES:
                raise ValueError("unexpected class: " + name)
        registration = jar.read(SPI).decode()
        if "edu.mmdc.cyberrange.policy.DictionaryPasswordPolicyProviderFactory" not in registration.split():
            raise ValueError("dictionary provider registration missing")
        dictionary = jar.read("dictionary/scowl-en-v1.txt")
        if hashlib.sha256(dictionary).hexdigest() != "85bdeb119fa7f3a13853300147624e58de150cfbffd213d02bbc669ac2db9887":
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
  lxc exec guacamole -- chown root:root /opt/keycloak/providers
  lxc exec guacamole -- chmod 0755 /opt/keycloak/providers
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
lxc exec guacamole -- chown root:root /opt/keycloak/providers
lxc exec guacamole -- chmod 0755 /opt/keycloak/providers
if lxc exec guacamole -- systemctl is-active --quiet keycloak.service; then
  lxc exec guacamole -- systemctl restart keycloak.service
  deadline=$((SECONDS + ${DICTIONARY_POLICY_READY_TIMEOUT:-120}))
  until lxc exec guacamole -- curl -fsS --max-time 3 http://127.0.0.1:8083/auth/realms/master/.well-known/openid-configuration >/dev/null 2>&1; do
    if (( SECONDS >= deadline )); then echo "ERROR: keycloak not ready after dictionary provider restart"; exit 1; fi
    sleep 5
  done
fi
echo DICTIONARY_POLICY_INSTALLED
