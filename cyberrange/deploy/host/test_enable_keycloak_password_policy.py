"""enable_keycloak_password_policy.sh: the policy string, verifier and blocklist.

The script embeds a `python3 -c '...'` verifier that reads the realm JSON on
stdin. These tests run that exact program against realm fixtures, so a change
to the policy or the verifier is caught without a live Keycloak.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
SCRIPT = HERE / "enable_keycloak_password_policy.sh"
VERIFY = HERE / "verify_password_policy.sh"
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


def verify(r: dict) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, "-c", _BLOCKS[0]], input=json.dumps(r),
                          capture_output=True, text=True)


def test_script_embeds_one_verifier():
    assert len(_BLOCKS) == 1


@pytest.mark.parametrize("path", [SCRIPT, VERIFY])
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
     "passwordBlacklist missing"),
    ("length(8) and maxLength(128) and notUsername(undefined) and notEmail(undefined) and passwordHistory(3) and passwordBlacklist(x.txt) and specialChars(1)",
     "specialChars present"),
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
