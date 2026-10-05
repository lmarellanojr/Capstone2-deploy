"""enable_keycloak_mfa.sh (SEC-03): the browser-flow planner and verifier.

The script embeds two `python3 -c '...'` programs that read Keycloak's flat
execution list on stdin. These tests run those exact programs against
fixtures shaped like real Keycloak output, so a change to the planning logic
is caught without a live Keycloak.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parent / "enable_keycloak_mfa.sh"
_BLOCKS = re.findall(r"\| python3 -c '\n(.*?)\n'\n", SCRIPT.read_text(), re.S)


def _ex(name, level, req, provider=None, flow=False):
    e = {"id": name.lower().replace(" ", "-"), "displayName": name, "level": level,
         "index": 0, "requirement": req, "authenticationFlow": flow, "priority": 10}
    if provider:
        e["providerId"] = provider
    return e


def default_browser_flow():
    # Keycloak's stock "browser" flow, as GET .../flows/browser/executions returns it.
    return [
        _ex("Cookie", 0, "ALTERNATIVE", "auth-cookie"),
        _ex("Kerberos", 0, "DISABLED", "auth-spnego"),
        _ex("Identity Provider Redirector", 0, "ALTERNATIVE", "identity-provider-redirector"),
        _ex("forms", 0, "ALTERNATIVE", flow=True),
        _ex("Username Password Form", 1, "REQUIRED", "auth-username-password-form"),
        _ex("Browser - Conditional OTP", 1, "CONDITIONAL", flow=True),
        _ex("Condition - user configured", 2, "REQUIRED", "conditional-user-configured"),
        _ex("OTP Form", 2, "REQUIRED", "auth-otp-form"),
    ]


def run_block(code: str, execs: list[dict], tmp_path: Path) -> subprocess.CompletedProcess:
    code = code.replace("/tmp/kc-exec-", f"{tmp_path}/kc-exec-")
    return subprocess.run([sys.executable, "-c", code], input=json.dumps(execs),
                          capture_output=True, text=True)


def planned(tmp_path: Path) -> dict[str, dict]:
    return {json.loads(p.read_text())["displayName"]: json.loads(p.read_text())
            for p in sorted(tmp_path.glob("kc-exec-*.json"))}


def test_script_embeds_planner_and_verifier():
    assert len(_BLOCKS) == 2


def test_script_is_valid_bash():
    subprocess.run(["bash", "-n", str(SCRIPT)], check=True)


def test_plan_makes_otp_required_for_everyone(tmp_path):
    r = run_block(_BLOCKS[0], default_browser_flow(), tmp_path)
    assert r.returncode == 0, r.stderr
    plan = planned(tmp_path)
    assert plan["Browser - Conditional OTP"]["requirement"] == "REQUIRED"
    assert plan["Condition - user configured"]["requirement"] == "DISABLED"
    # OTP Form is already REQUIRED in the stock flow, so it is left alone.
    assert "OTP Form" not in plan
    # Only the requirement changes: the rest of the representation is sent back intact.
    sub = plan["Browser - Conditional OTP"]
    assert sub["id"] == "browser---conditional-otp" and sub["priority"] == 10 and sub["level"] == 1


def test_plan_never_touches_cookie_or_password_steps(tmp_path):
    run_block(_BLOCKS[0], default_browser_flow(), tmp_path)
    assert set(planned(tmp_path)) == {"Browser - Conditional OTP", "Condition - user configured"}


def test_plan_is_idempotent_on_an_already_enforced_flow(tmp_path):
    flow = default_browser_flow()
    flow[5]["requirement"] = "REQUIRED"
    flow[6]["requirement"] = "DISABLED"
    r = run_block(_BLOCKS[0], flow, tmp_path)
    assert r.returncode == 0, r.stderr
    assert planned(tmp_path) == {}


def test_plan_also_raises_a_disabled_otp_form(tmp_path):
    flow = default_browser_flow()
    flow[7]["requirement"] = "DISABLED"
    run_block(_BLOCKS[0], flow, tmp_path)
    assert planned(tmp_path)["OTP Form"]["requirement"] == "REQUIRED"


@pytest.mark.parametrize("otp_forms", [0, 2])
def test_plan_fails_closed_without_exactly_one_otp_form(tmp_path, otp_forms):
    flow = [e for e in default_browser_flow() if e.get("providerId") != "auth-otp-form"]
    for _ in range(otp_forms):
        flow.append(_ex("OTP Form", 2, "REQUIRED", "auth-otp-form"))
    r = run_block(_BLOCKS[0], flow, tmp_path)
    assert r.returncode != 0 and "MFA_PLAN_FAILED" in r.stderr
    assert planned(tmp_path) == {}


def test_verifier_passes_only_when_enforced(tmp_path):
    flow = default_browser_flow()
    r = run_block(_BLOCKS[1], flow, tmp_path)
    assert r.returncode != 0 and "MFA_NOT_ENFORCED" in r.stderr

    flow[5]["requirement"] = "REQUIRED"
    flow[6]["requirement"] = "DISABLED"
    r = run_block(_BLOCKS[1], flow, tmp_path)
    assert r.returncode == 0 and "MFA_ENFORCED" in r.stdout
