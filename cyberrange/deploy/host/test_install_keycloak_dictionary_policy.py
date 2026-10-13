"""Installer fail-closed and restart/order contracts without a live container."""
from pathlib import Path
import os
import re
import subprocess
import zipfile
import sys
import hashlib
import pytest

HERE = Path(__file__).resolve().parent
SCRIPT = HERE / "install_keycloak_dictionary_policy.sh"

def run(tmp_path, *, version="25.0.6", old="", active=True, ready=True, valid=True, dictionary_valid=True, extra_spi=False):
    jar = tmp_path / "policy.jar"
    with zipfile.ZipFile(jar, "w") as z:
        z.writestr("META-INF/services/org.keycloak.policy.PasswordPolicyProviderFactory", "edu.mmdc.cyberrange.policy.DictionaryPasswordPolicyProviderFactory")
        if extra_spi:
            z.writestr("META-INF/services/org.keycloak.services.resource.RealmResourceProviderFactory", "edu.mmdc.cyberrange.policy.EvilFactory")
        z.writestr("dictionary/scowl-en-v1.txt", (HERE.parent / "keycloak/dictionary-policy/src/main/resources/dictionary/scowl-en-v1.txt").read_bytes() if dictionary_valid else b"a\ni\n")
        z.writestr("META-INF/cyberrange-dictionary-policy.properties", "keycloak.version=" + ("25.0.6" if valid else "26.0.0") + "\npolicy.id=dictionaryWords\ndictionary.id=scowl-en-v1\n")
    if old == "same":
        old = hashlib.sha256(jar.read_bytes()).hexdigest()
    # Functions survive sourcing, so all container operations are recorded.
    shell = r'''
python3() { "$TEST_PYTHON" "$@"; }
dirname() { "$TEST_PYTHON" -c 'import os,sys; print(os.path.dirname(sys.argv[1]))' "$1"; }
sha256sum() { "$TEST_PYTHON" -c 'import hashlib,sys; p=sys.argv[1]; print(hashlib.sha256(open(p,"rb").read()).hexdigest(), p)' "$1"; }
cut() { local checksum; IFS=' ' read -r checksum _; printf '%s\n' "$checksum"; }
lxc() {
  printf "%s\n" "$*" >> "$CALLS"
  case "$*" in
    *"kc.sh --version") echo "Keycloak $VERSION";;
    *"sh -c sha256sum"*) echo "$OLD";;
    *"sha256sum "*) sha256sum "$DICTIONARY_POLICY_JAR";;
    *"is-active --quiet"*) [[ "$ACTIVE" == 1 ]];;
    *"curl -fsS"*) [[ "$READY" == 1 ]];;
  esac
}
source "$1"
'''
    calls = tmp_path / "calls"
    env = dict(os.environ, TEST_PYTHON=Path(sys.executable).as_posix(), DICTIONARY_POLICY_JAR=jar.as_posix(), DICTIONARY_POLICY_JAR_SHA256=hashlib.sha256(jar.read_bytes()).hexdigest(), CALLS=calls.as_posix(), VERSION=version, OLD=old, ACTIVE=str(int(active)), READY=str(int(ready)), DICTIONARY_POLICY_READY_TIMEOUT="0")
    result = subprocess.run(["bash", "-c", shell, "bash", SCRIPT.as_posix()], env=env, capture_output=True, text=True)
    return result, calls.read_text() if calls.exists() else ""

def test_installer_valid_bash():
    subprocess.run(["bash", "-n", str(SCRIPT)], check=True)


def test_committed_provider_jar_exists_and_matches_installer_checksum():
    text = SCRIPT.read_text()
    assert "keycloak/providers/cyberrange-dictionary-policy-1.0.0.jar" in text
    jar = HERE.parent / "keycloak/providers/cyberrange-dictionary-policy-1.0.0.jar"
    assert jar.is_file() and jar.stat().st_size > 0
    pinned = re.search(r"^PINNED_JAR_SHA256=([0-9a-f]{64})$", text, re.M).group(1)
    assert hashlib.sha256(jar.read_bytes()).hexdigest() == pinned
    # Keep one fixed destination so replacing v1 cannot leave a second SPI provider installed.
    assert "/opt/keycloak/providers/cyberrange-dictionary-policy-1.0.0.jar" in text


def test_extra_spi_registration_is_refused(tmp_path):
    result, calls = run(tmp_path, extra_spi=True)
    assert result.returncode != 0
    assert "unexpected SPI" in result.stdout + result.stderr
    assert "file push" not in calls

@pytest.mark.parametrize("version,valid", [("26.0.0", True), ("25.0.6", False)])
def test_incompatible_version_or_artifact_never_installed(tmp_path, version, valid):
    result, calls = run(tmp_path, version=version, valid=valid)
    assert result.returncode != 0
    assert "file push" not in calls

def test_install_atomic_root_owned_and_restarts_first_active_install(tmp_path):
    result, calls = run(tmp_path)
    assert result.returncode == 0, result.stderr
    assert "chown root:root" in calls and "chmod 0644" in calls
    assert "chown root:root /opt/keycloak/providers" in calls and "chmod 0755 /opt/keycloak/providers" in calls
    assert calls.index("file push") < calls.index("chown root:root") < calls.index("mv -f") < calls.index("systemctl restart")
    assert "curl -fsS" in calls

def test_inactive_service_is_not_restarted(tmp_path):
    result, calls = run(tmp_path, active=False)
    assert result.returncode == 0, result.stderr
    assert "systemctl restart" not in calls

def test_restart_readiness_failure_is_nonzero(tmp_path):
    result, calls = run(tmp_path, ready=False)
    assert result.returncode != 0
    assert "systemctl restart" in calls and "not ready" in result.stdout

def test_restore_installs_provider_before_copy_and_unit_start():
    realm = (HERE / "push_keycloak_realm.sh").read_text()
    unit = (HERE / "install_keycloak_unit.sh").read_text()
    assert realm.index("install_keycloak_dictionary_policy.sh") < realm.index('lxc file push "$SRC"')
    assert unit.index("install_keycloak_dictionary_policy.sh") < unit.index("systemctl enable --now")


def test_unchanged_artifact_does_not_push_or_restart(tmp_path):
    result, calls = run(tmp_path, old="same")
    assert result.returncode == 0, result.stderr
    assert "DICTIONARY_POLICY_UNCHANGED" in result.stdout
    assert "file push" not in calls and "systemctl restart" not in calls
    assert "chown root:root" in calls and "chmod 0644" in calls
    assert "chown root:root /opt/keycloak/providers" in calls and "chmod 0755 /opt/keycloak/providers" in calls

def test_missing_artifact_refused_before_container_mutation(tmp_path):
    env = dict(os.environ, DICTIONARY_POLICY_JAR=(tmp_path / "missing.jar").as_posix())
    result = subprocess.run(["bash", str(SCRIPT)], env=env, capture_output=True, text=True)
    assert result.returncode != 0
    assert "missing dictionary provider artifact" in result.stdout


def test_truncated_dictionary_refused_before_container_mutation(tmp_path):
    result, calls = run(tmp_path, dictionary_valid=False)
    assert result.returncode != 0
    assert "checksum mismatch" in result.stdout + result.stderr
    assert calls == ""


def test_override_jar_requires_matching_explicit_checksum(tmp_path):
    jar = tmp_path / "provider.jar"
    jar.write_bytes(b"test artifact")
    env = dict(os.environ, DICTIONARY_POLICY_JAR=jar.as_posix(), DICTIONARY_POLICY_JAR_SHA256="0" * 64)
    wrong = subprocess.run(["bash", str(SCRIPT)], env=env, capture_output=True, text=True)
    assert wrong.returncode != 0 and "checksum mismatch" in wrong.stdout
    env["DICTIONARY_POLICY_JAR_SHA256"] = hashlib.sha256(jar.read_bytes()).hexdigest()
    right = subprocess.run(["bash", str(SCRIPT)], env=env, capture_output=True, text=True)
    assert right.returncode != 0
    assert "missing dictionary provider artifact" not in right.stdout


@pytest.mark.parametrize("name", ["setup_verify_accounts.sh", "create_demo_accounts.sh", "create_keycloak_realm.sh", "verify_adm_user.sh"])
def test_existing_account_generators_create_long_dictionary_free_passwords(name):
    text = (HERE / name).read_text()
    function = re.search(r"generate_dictionary_free_password\(\) \{\n(.*?)\n\}", text, re.S)
    assert function, f"{name} has no dictionary-free password generator"
    command = "generate_dictionary_free_password() {\n" + function.group(1) + "\n}\nfor _ in $(seq 1 8); do generate_dictionary_free_password; echo; done"
    result = subprocess.run(["bash", "-lc", command], capture_output=True, text=True, check=True)
    passwords = [password for password in result.stdout.splitlines() if password]
    assert len(passwords) == 8
    assert all(re.fullmatch(r"[0-9!@#%^_]{48}", password) for password in passwords)
    assert all("$" not in password for password in passwords)


def test_generated_passwords_survive_env_file_round_trip(tmp_path):
    text = (HERE / "setup_verify_accounts.sh").read_text()
    function = re.search(r"generate_dictionary_free_password\(\) \{\n(.*?)\n\}", text, re.S)
    assert function
    seed = tmp_path / "seed.env"
    py = Path(sys.executable).as_posix()
    command = (
        "generate_dictionary_free_password() {\n"
        + function.group(1)
        + "\n}\n"
        + "for name in VERIFY_STUDENT_PASSWORD VERIFY_INSTRUCTOR_PASSWORD VERIFY_ADMIN_PASSWORD PROBE_PASSWORD; do\n"
        + "  printf '%s=%q\\n' \"$name\" \"$(generate_dictionary_free_password)\"\n"
        + "done > \"$SEED\"\n"
        + "set -a\n. \"$SEED\"\nset +a\n"
        + "export VERIFY_STUDENT_PASSWORD VERIFY_INSTRUCTOR_PASSWORD VERIFY_ADMIN_PASSWORD PROBE_PASSWORD\n"
        + f"\"{py}\" -c \"import os,re; names=['VERIFY_STUDENT_PASSWORD','VERIFY_INSTRUCTOR_PASSWORD','VERIFY_ADMIN_PASSWORD','PROBE_PASSWORD'];\n"
        + "[print(n+'_OK') for n in names if re.fullmatch(r'[0-9!@#%^_]{48}', os.environ[n]) and '$' not in os.environ[n]]\""
    )
    result = subprocess.run(
        ["bash", "-c", command],
        env=dict(os.environ, SEED=seed.as_posix()),
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr + result.stdout
    assert result.stdout.count("_OK") == 4
