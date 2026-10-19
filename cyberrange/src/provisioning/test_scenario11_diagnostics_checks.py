"""Scenario 11 (scorer id 11, catalog Scenario 4) diagnostics, run against
scoring_checks.sh itself.

Each failing condition must print its allowlisted reason on the DIAG line while
the PASS/FAIL token stays what the scorer decided. Same stub-on-PATH harness as
test_scoring_checks_gaps.py (curl is stubbed; TOMCAT_USERS_FILE is the
existing test hook).
"""
from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path

import pytest

import scoring_diagnostics
from ssh_verifier import SCORING_SCRIPT_PATH
from test_score_verify_behavioral import _find_bash

BASH = _find_bash()
pytestmark = pytest.mark.skipif(BASH is None, reason="bash not available")
SCRIPT = str(Path(SCORING_SCRIPT_PATH).resolve())

DIAG_LINE = re.compile(r"^DIAG reason=[A-Z_]+ location=NONE copies=0$")

_WITH_STUBS = (
    'd=$1; shift; if command -v cygpath >/dev/null 2>&1; then d=$(cygpath -u "$d"); fi; '
    'export PATH="$d:$PATH"; exec "$BASH" "$@"'
)

DEFAULT_XML = '<user username="tomcat" password="tomcat" roles="manager-script"/>'
FIXED_XML = '<user username="tomcat" password="N3w-Str0ng!" roles="manager-script"/>'
VERIFY_CURL = "curl -s -o /dev/null -w '%{http_code}\\n' -u tomcat:tomcat http://127.0.0.1:8180/manager/text/list\n"


def _write(path: Path, text: str) -> None:
    path.write_text(text, newline="\n")


def run(tmp_path: Path, milestone: int, *, history: str = "", xml=None, curl_code=None,
        script: str = SCRIPT) -> tuple[str, dict | None, list[str]]:
    """xml=None: no users file. curl_code: what the curl stub prints (None = no stub)."""
    home = tmp_path / "home"
    home.mkdir(exist_ok=True)
    _write(home / ".bash_history", history)
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    if curl_code is not None:
        stub = bin_dir / "curl"
        # A failed connection: curl prints 000 and exits non-zero, like the real one.
        exit_code = 7 if curl_code.startswith("000") else 0
        _write(stub, f"#!/bin/bash\nprintf '{curl_code}'\nexit {exit_code}\n")
        stub.chmod(0o755)
    users = tmp_path / "tomcat-users.xml"
    if xml is not None:
        _write(users, xml)
    env = {
        **os.environ,
        "HOME": home.as_posix(),
        "LOG_FILE": (tmp_path / "scoring.log").as_posix(),
        "TOMCAT_USERS_FILE": users.as_posix(),
    }
    res = subprocess.run(
        [BASH, "-c", _WITH_STUBS, "stubs", str(bin_dir), script, "11", str(milestone)],
        capture_output=True, text=True, env=env,
    )
    assert res.returncode == 0, res.stderr
    lines = [ln.strip() for ln in res.stdout.splitlines() if ln.strip()]
    return (lines[-1] if lines else ""), scoring_diagnostics.parse_diag(res.stdout, 11), lines


# (id, milestone, run kwargs, expected reason or None for a pass)
CASES = [
    # M1: sudo … tomcat-users in history
    ("m1-pass", 1, dict(history="sudo cat /etc/tomcat9/tomcat-users.xml\n"), None),
    ("m1-pass-grep", 1, dict(history="sudo grep password /etc/tomcat9/tomcat-users.xml\n"), None),
    ("m1-no-history", 1, dict(), "COMMAND_NOT_FOUND"),
    ("m1-unrelated", 1, dict(history="ls /etc/tomcat9\n"), "COMMAND_NOT_FOUND"),
    ("m1-no-sudo", 1, dict(history="cat /etc/tomcat9/tomcat-users.xml\n"), "COMMAND_NOT_MATCHED"),
    ("m1-sudo-after-pipe", 1, dict(history="cat /etc/tomcat9/tomcat-users.xml | sudo tee /dev/null\n"),
     "COMMAND_NOT_MATCHED"),
    # M2: the file's state decides; history only when the file is gone
    ("m2-pass", 2, dict(xml=FIXED_XML), None),
    ("m2-default", 2, dict(xml=DEFAULT_XML), "DEFAULT_PASSWORD_PRESENT"),
    ("m2-default-single-quotes", 2, dict(xml=DEFAULT_XML.replace('"', "'")), "DEFAULT_PASSWORD_PRESENT"),
    ("m2-sed-but-default", 2, dict(xml=DEFAULT_XML, history="sudo sed -i 's/a/b/' /etc/tomcat9/tomcat-users.xml\n"),
     "DEFAULT_PASSWORD_PRESENT"),
    ("m2-no-file-sed", 2, dict(history="sudo sed -i 's/tomcat/x/' /etc/tomcat9/tomcat-users.xml\n"), None),
    ("m2-no-file-no-sed", 2, dict(), "CONFIG_MISSING"),
    # M3: manager rejects old creds (401/403), then the verification curl in history
    ("m3-pass-401", 3, dict(history=VERIFY_CURL, curl_code="401"), None),
    ("m3-pass-403", 3, dict(history=VERIFY_CURL, curl_code="403"), None),
    ("m3-still-open", 3, dict(history=VERIFY_CURL, curl_code="200"), "OLD_CREDS_ACCEPTED"),
    ("m3-down", 3, dict(history=VERIFY_CURL, curl_code="000"), "MANAGER_UNREACHABLE"),
    ("m3-404", 3, dict(history=VERIFY_CURL, curl_code="404"), "MANAGER_UNEXPECTED_STATUS"),
    ("m3-500", 3, dict(history=VERIFY_CURL, curl_code="500"), "MANAGER_UNEXPECTED_STATUS"),
    # State is checked first: still open and never verified reports the state.
    ("m3-open-not-verified", 3, dict(curl_code="200"), "OLD_CREDS_ACCEPTED"),
    ("m3-closed-not-verified", 3, dict(history="sudo systemctl restart tomcat9\n", curl_code="401"),
     "COMMAND_NOT_FOUND"),
    ("m3-closed-other-creds", 3, dict(history="curl -u admin:x http://127.0.0.1:8180/manager/text/list\n",
                                      curl_code="401"), "COMMAND_NOT_MATCHED"),
]


@pytest.mark.parametrize("milestone,kwargs,reason", [c[1:] for c in CASES], ids=[c[0] for c in CASES])
def test_reason_and_token(tmp_path, milestone, kwargs, reason):
    token, diag, lines = run(tmp_path, milestone, **kwargs)
    assert token == ("PASS" if reason is None else "FAIL"), lines
    assert diag == {"reason": reason, "location": "NONE", "copies": 0}, lines
    # Only the DIAG line and the token: no commands, passwords or file text.
    assert len(lines) == 2 and DIAG_LINE.match(lines[0]), lines


def test_unknown_milestone_prints_nothing(tmp_path):
    _, diag, lines = run(tmp_path, 9, xml=FIXED_XML)
    assert lines == [] and diag is None


# ── Contract and isolation ──────────────────────────────────────────────────

@pytest.mark.parametrize("milestone,kwargs", [
    (1, dict(history="cat /etc/tomcat9/tomcat-users.xml\n")),
    (2, dict(xml=DEFAULT_XML)),
    (3, dict(history=VERIFY_CURL, curl_code="200")),
])
def test_reason_is_never_written_to_the_container_log(tmp_path, milestone, kwargs):
    # The script runs on the student's meta container, where the student has
    # sudo; the reason may only leave on stdout to the host-side store.
    _, diag, _ = run(tmp_path, milestone, **kwargs)
    assert diag is not None and diag["reason"] is not None
    log = tmp_path / "scoring.log"
    text = log.read_text(encoding="utf-8") if log.exists() else ""
    assert diag["reason"] not in text and "reason=" not in text and "DIAG" not in text


def test_every_reason_the_script_can_print_is_allowlisted():
    script = Path(SCRIPT).read_text(encoding="utf-8")
    checks = script[script.index("# Scenario 11: Vulnerability Hardening"):script.index("# Default fallback")]
    emitted = set(re.findall(r"echo ([A-Z][A-Z_]+[A-Z])\b", checks))
    emitted |= set(re.findall(r"reason=([A-Z][A-Z_]+[A-Z])\b", checks))
    emitted.discard("NONE")
    assert emitted == scoring_diagnostics.REASON_CODES_BY_SCENARIO[11]
    # And every code except the missing-curl CHECK_ERROR has a case above.
    assert {c[3] for c in CASES} - {None} == scoring_diagnostics.REASON_CODES_BY_SCENARIO[11] - {"CHECK_ERROR"}


# ── Switch and storage (shared framework, scenario 11 rows) ────────────────

@pytest.mark.anyio
@pytest.mark.parametrize("switch,recorded", [("11", True), ("9,1", False), ("", False)])
async def test_scenario_11_has_its_own_switch(monkeypatch, switch, recorded):
    from test_scenario3_diagnostics import INSTRUCTOR, _get, _pod, _rows, _verifier, _verify

    monkeypatch.delenv("S3_DIAGNOSTICS_ENABLED", raising=False)
    monkeypatch.setenv("SCORING_DIAGNOSTICS_SCENARIOS", switch)
    verifier = _verifier("FAIL", "OLD_CREDS_ACCEPTED", location="NONE", copies=0)
    res = await _verify(_pod(scenario_id="11"), verifier, scenario_id=11, milestone_id=3)
    assert res.status == "FAIL" and "OLD_CREDS_ACCEPTED" not in res.message
    rows = _rows("scoring_diagnostics")
    assert [(r["scenario_id"], r["milestone_id"], r["reason_code"]) for r in rows] == (
        [(11, 3, "OLD_CREDS_ACCEPTED")] if recorded else [])
    if recorded:
        (d,) = _get(INSTRUCTOR, "/instructor/students/alice/diagnostics").json()["diagnostics"]
        assert (d["scenario_id"], d["reason_code"]) == (11, "OLD_CREDS_ACCEPTED")
