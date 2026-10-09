"""enable_keycloak_password_policy.sh: the policy string, verifier and blocklist.

The script embeds a `python3 -c '...'` verifier that reads the realm JSON on
stdin. These tests run that exact program against realm fixtures, so a change
to the policy or the verifier is caught without a live Keycloak.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
SCRIPT = HERE / "enable_keycloak_password_policy.sh"
VERIFY = HERE / "verify_password_policy.sh"
INSTALL = HERE / "install_keycloak_blocklist.sh"
PUSH_REALM = HERE / "push_keycloak_realm.sh"
TEXT = SCRIPT.read_text()
_BLOCKS = re.findall(r"\| python3 -c '\n(.*?)\n'\n", TEXT, re.S)
BLOCKLIST = HERE.parent / "keycloak" / "password-blacklists" / "cyberrange-common-passwords.txt"


def script_policy(name: str = "cyberrange-common-passwords.txt") -> str:
    m = re.search(r'^POLICY="(.*)"$', TEXT, re.M)
    assert m, "POLICY= line not found"
    return m.group(1).replace("${BLOCKLIST_NAME}", name)


def realm(policy: str | None = None, **over) -> dict:
    r = {
        "passwordPolicy": script_policy() if policy is None else policy,
        "bruteForceProtected": True,
        "permanentLockout": False,
        "failureFactor": 10,
        "waitIncrementSeconds": 60,
        "maxFailureWaitSeconds": 900,
    }
    r.update(over)
    return r


def script_env() -> dict[str, str]:
    """The env the verifier sees inside the container: BLOCKLIST_NAME from
    `lxc exec --env`, lockout numbers from the `export` line in INNER."""
    env = dict(os.environ, BLOCKLIST_NAME="cyberrange-common-passwords.txt")
    m = re.search(r"^export (FAILURE_FACTOR=.*)$", TEXT, re.M)
    assert m, "lockout export line not found"
    env.update(kv.split("=", 1) for kv in m.group(1).split())
    return env


def verify(r: dict) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, "-c", _BLOCKS[0]], input=json.dumps(r),
                          capture_output=True, text=True, env=script_env())


def test_script_embeds_one_verifier():
    assert len(_BLOCKS) == 1


@pytest.mark.parametrize("path", [SCRIPT, VERIFY, INSTALL, PUSH_REALM])
def test_scripts_are_valid_bash(path):
    subprocess.run(["bash", "-n", str(path)], check=True)


def test_policy_follows_nist_800_63b():
    clauses = dict(re.findall(r"(\w+)\(([^)]*)\)", script_policy()))
    assert int(clauses["length"]) >= 8  # MFA is mandatory (SEC-03); 15 without it
    assert int(clauses["maxLength"]) >= 64
    assert {"notUsername", "notEmail", "passwordHistory", "passwordBlacklist"} <= set(clauses)
    # No composition rules and no forced expiry.
    assert not {"upperCase", "lowerCase", "digits", "specialChars", "forceExpiredPasswordChange"} & set(clauses)


def test_policy_min_length_matches_portal_and_api():
    clauses = dict(re.findall(r"(\w+)\(([^)]*)\)", script_policy()))
    portal = (HERE.parents[1] / "portal" / "src" / "lib" / "adminUserValidation.ts").read_text()
    api = (HERE.parents[1] / "src" / "provisioning" / "users_router.py").read_text()
    assert f"PASSWORD_MIN = {clauses['length']}" in portal
    assert f"PASSWORD_MAX = {clauses['maxLength']}" in portal
    assert f"min_length={clauses['length']}, max_length={clauses['maxLength']}" in api


def test_verifier_passes_on_the_scripted_policy():
    r = verify(realm())
    assert r.returncode == 0, r.stderr
    assert "PASSWORD_POLICY_ENFORCED" in r.stdout


@pytest.mark.parametrize("policy, problem", [
    ("", "length(>=8) missing"),
    ("length(6) and maxLength(128) and notUsername(undefined) and notEmail(undefined) and passwordHistory(3) and passwordBlacklist(x.txt)",
     "length(>=8) missing"),
    ("length(8) and maxLength(32) and notUsername(undefined) and notEmail(undefined) and passwordHistory(3) and passwordBlacklist(x.txt)",
     "maxLength(>=64) missing"),
    ("length(8) and maxLength(128) and notUsername(undefined) and notEmail(undefined) and passwordHistory(3)",
     "passwordBlacklist is not"),
    ("length(8) and maxLength(128) and notUsername(undefined) and notEmail(undefined) and passwordHistory(3) and passwordBlacklist(cyberrange-common-passwords.txt) and specialChars(1)",
     "specialChars present"),
    (script_policy().replace("passwordHistory(3)", "passwordHistory(0)"), "passwordHistory(>=1) missing"),
    (script_policy("x.txt"), "passwordBlacklist is not cyberrange-common-passwords.txt"),
    (script_policy(""), "passwordBlacklist is not"),
])
def test_verifier_fails_closed_on_weak_policy(policy, problem):
    r = verify(realm(policy))
    assert r.returncode != 0
    assert "PASSWORD_POLICY_NOT_ENFORCED" in r.stderr and problem in r.stderr


def test_verifier_requires_temporary_brute_force_lockout():
    r = verify(realm(bruteForceProtected=False))
    assert r.returncode != 0 and "bruteForceProtected" in r.stderr
    r = verify(realm(permanentLockout=True))
    assert r.returncode != 0 and "permanentLockout" in r.stderr


@pytest.mark.parametrize("field, value", [
    ("failureFactor", 1000),
    ("waitIncrementSeconds", 1),
    ("maxFailureWaitSeconds", 0),
])
def test_verifier_checks_the_lockout_numbers_it_set(field, value):
    r = verify(realm(**{field: value}))
    assert r.returncode != 0 and f"{field} is {value}" in r.stderr


def test_blocklist_is_keycloak_ready():
    raw = BLOCKLIST.read_bytes()
    assert b"\r" not in raw, "CRLF would become part of every entry"
    lines = raw.decode("ascii").splitlines()
    assert len(lines) > 1000
    assert lines == sorted(set(lines)), "sorted and de-duplicated"
    assert all(line == line.lower() for line in lines), "Keycloak compares lower-cased"
    assert all(len(line) >= 8 for line in lines), "shorter entries are already rejected by length()"
    for weak in ("password", "password1", "password123", "12345678", "qwertyuiop", "cyberrange123", "capstone2026"):
        assert weak in lines


def test_verify_script_probes_reject_known_weak_passwords():
    # The verify script's "rejected" probes must actually be on the blocklist
    # or below the length floor, otherwise it would test nothing.
    text = VERIFY.read_text()
    lines = set(BLOCKLIST.read_text().splitlines())
    assert re.search(r'expect reject "common password \(blocklist\)"\s+"password1"', text)
    assert "password1" in lines and "password123" in lines  # PassWord123 lower-cased
    assert len("Xk9#qv2") < 8


@pytest.mark.parametrize("path", [SCRIPT, VERIFY])
def test_no_temporary_false(path):
    # -t/--temporary takes no value on our kcadm (create_demo_accounts.sh), so
    # `--temporary false` makes every set-password fail before the policy runs.
    assert not re.search(r"--temporary\s+(false|true)|-t\s+(false|true)", path.read_text())


def test_every_reject_probe_names_the_policy_rule():
    # A bare non-zero exit must never count as "rejected by the policy".
    probes = re.findall(r"^expect (reject|accept) .*$", VERIFY.read_text(), re.M)
    rejects = re.findall(r"^expect reject (.*)$", VERIFY.read_text(), re.M)
    assert len(probes) == 8 and len(rejects) == 7
    for line in rejects:
        assert re.search(r"'[^']+'\s*$", line), f"no expected-error regex: {line}"


# --- the expect() helper, run for real against a fake kcadm.sh --------------

_EXPECT = re.search(r"^expect\(\) \{\n.*?^\}\n", VERIFY.read_text(), re.M | re.S).group(0)


def run_expect(kcadm_body: str, *args: str) -> subprocess.CompletedProcess:
    script = (
        f"kcadm.sh() {{ {kcadm_body}; }}\n"
        'REALM=cyber-range PROBE=probe FAIL=0\n'
        f"{_EXPECT}\n"
        'expect "$@"; echo "FAIL=$FAIL"\n'
    )
    return subprocess.run(["bash", "-c", script, "bash", *args], capture_output=True, text=True)


needs_bash = pytest.mark.skipif(shutil.which("bash") is None, reason="bash not installed")


@needs_bash
@pytest.mark.parametrize("err", [
    "Invalid password: minimum length 8.",
    "[error] invalidPasswordMinLengthMessage",
])
def test_expect_passes_only_on_the_named_policy_error(err):
    r = run_expect(f'echo "{err}" >&2; return 1', "reject", "7 characters", "Xk9#qv2", "MinLength|minimum length")
    assert "PASS  7 characters -> rejected" in r.stdout and "FAIL=0" in r.stdout


@needs_bash
@pytest.mark.parametrize("err", [
    "Unknown option: false",                      # the old --temporary false bug
    "Session has expired. Login again",           # stale kcadm token
    "Invalid password: password is blacklisted.", # rejected, but by a different rule
])
def test_expect_fails_when_rejected_for_another_reason(err):
    r = run_expect(f'echo "{err}" >&2; return 1', "reject", "7 characters", "Xk9#qv2", "MinLength|minimum length")
    assert "FAIL  7 characters -> reject" in r.stdout and "FAIL=1" in r.stdout


@needs_bash
def test_expect_accept_and_never_prints_the_password():
    r = run_expect("return 0", "accept", "strong", "S3cret-Value!")
    assert "PASS  strong -> accepted" in r.stdout
    r = run_expect('echo "rejected S3cret-Value!" >&2; return 1', "accept", "strong", "S3cret-Value!")
    assert "FAIL" in r.stdout and "S3cret-Value!" not in r.stdout and "<redacted>" in r.stdout


@needs_bash
def test_expect_never_passes_temporary_to_kcadm():
    r = run_expect('[[ " $* " == *" --temporary "* || " $* " == *" -t "* ]] && return 1; return 0',
                   "accept", "strong", "S3cret-Value!")
    assert "PASS" in r.stdout


def test_realm_restore_installs_the_blocklist():
    # A re-exported realm references the blocklist; --import-realm resolves it
    # at startup, so push_keycloak_realm.sh must install it too.
    assert "install_keycloak_blocklist.sh" in PUSH_REALM.read_text()
    assert "install_keycloak_blocklist.sh" in TEXT
    install = INSTALL.read_text()
    assert "/opt/keycloak/data/password-blacklists" in install
    assert "sudo -u keycloak test -r" in install


def test_enable_restarts_keycloak_only_when_blocklist_changed():
    assert re.search(r'BLOCKLIST_CHANGED.*\n\s*echo "blocklist changed.*\n\s*lxc exec guacamole -- systemctl restart keycloak', TEXT)
