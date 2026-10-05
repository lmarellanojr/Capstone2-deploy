"""SEC-03 (#144): the live verify_* scripts must keep working once MFA is on.

They sign in with the password grant, which needs a TOTP code for any account
that has enrolled an authenticator. setup_verify_accounts.sh gives them a
separate client and dedicated accounts instead. These static checks stop a
script from drifting back to the demo accounts, and stop the setup script from
losing the guards that keep the verify client from being an MFA bypass.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
PASSWORD_GRANT_SCRIPTS = [
    "verify_sec01_rbac.sh",
    "verify_sec02_instructor_admin.sh",
    "verify_adm_user.sh",
    "verify_demo_accounts.sh",
    "verify_role_refresh.sh",
]
SETUP = (HERE / "setup_verify_accounts.sh").read_text()


@pytest.mark.parametrize("name", PASSWORD_GRANT_SCRIPTS)
def test_script_uses_the_verify_accounts_not_the_demo_accounts(name):
    text = (HERE / name).read_text()
    assert "verify-accounts.env" in text
    assert "demo-accounts.env" not in text
    assert not re.search(r"\b(STUDENT|INSTRUCTOR|ADMIN)_DEMO_PASSWORD\b", text)
    assert "VERIFY_CLIENT_ID" in text


@pytest.mark.parametrize("name", PASSWORD_GRANT_SCRIPTS)
def test_script_never_signs_a_demo_account_in(name):
    text = (HERE / name).read_text()
    assert not re.search(r"\b(?:token|check_login)\s+\"?(student|instructor|admin)_demo\b", text)
    assert not re.search(r"username=(student|instructor|admin)_demo\b", text)


def test_verify_client_has_no_browser_login_and_starts_locked():
    harden = re.search(r"HARDEN=\(\n(.*?)\n\)", SETUP, re.S).group(1)
    for setting in (
        "publicClient=false",
        "standardFlowEnabled=false",
        "implicitFlowEnabled=false",
        "serviceAccountsEnabled=false",
        "directAccessGrantsEnabled=false",  # only switched on after the gate is proven
        "'redirectUris=[]'",
        "'webOrigins=[]'",
    ):
        assert setting in harden
    assert '\\"direct_grant\\":\\"$FLOW_ID\\"' in harden


def test_flow_denies_everyone_without_the_marker_role_and_has_no_otp_step():
    assert "provider=direct-grant-validate-username" in SETUP
    assert "provider=direct-grant-validate-password" in SETUP
    assert "provider=conditional-user-role" in SETUP
    assert "provider=deny-access-authenticator" in SETUP
    assert '"config.condUserRole=$MARKER"' in SETUP
    assert "'config.negate=\"true\"'" in SETUP
    assert 'set_requirement "$SUB" CONDITIONAL' in SETUP
    assert "set_requirement deny-access-authenticator REQUIRED" in SETUP
    assert "auth-otp" not in SETUP and "direct-grant-validate-otp" not in SETUP


def test_setup_fails_closed_when_an_unmarked_account_gets_a_token():
    assert "VERIFY_GATE_OPEN" in SETUP
    assert 'try_token "$PROBE"' in SETUP
    # Any exit before the gate is proven switches the password grant off.
    assert re.search(r"trap 'grant_off;", SETUP)
    assert SETUP.index("VERIFY_GATE_OPEN") < SETUP.index("echo VERIFY_GATE_OK")

