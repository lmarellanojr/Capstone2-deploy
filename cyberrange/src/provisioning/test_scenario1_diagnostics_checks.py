"""Scenario 1 (scorer id 1) diagnostics, run against scoring_checks.sh itself.

Each failing condition must print its allowlisted reason on the DIAG line while
the PASS/FAIL token stays what the scorer decided. Same stub-on-PATH harness as
test_scoring_checks_gaps.py; M4 uses the SCORING_TEST_MODE fixtures from
test_score_verify_behavioral.py.
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

ADDR = 'echo "2: eth0    inet 10.0.51.100/24 brd 10.0.51.255 scope global eth0"'
ROUTE = 'echo "10.0.51.0/24 dev eth0 proto kernel scope link src 10.0.51.100"'


def _ip_stub(addr: bool = True, route: bool = True) -> str:
    return (
        "#!/bin/bash\n"
        f'if [[ "$*" == *"addr show"* ]]; then {ADDR if addr else ":"}\n'
        f'elif [[ "$*" == *"route"* ]]; then {ROUTE if route else ":"}\n'
        "fi\n"
    )


def _write(path: Path, text: str) -> None:
    path.write_text(text, newline="\n")


# A live tomcat_mgr_deploy session to this pod's meta, as tmux shows it.
PANE_OK = (
    "msf6 exploit(multi/http/tomcat_mgr_deploy) > run\n"
    "[*] Meterpreter session 1 opened (10.0.51.10:4444 -> 10.0.51.20:49152)\n"
)
SOCKET_OK = 'ESTAB 0 0 10.0.51.10:4444 10.0.51.20:49152 users:(("ruby",pid=4242,fd=12))\n'


def run(tmp_path: Path, milestone: int, *, history: str = "", addr=True, route=True,
        m4=None, script: str = SCRIPT) -> tuple[str, dict | None, list[str]]:
    """Run scenario 1. m4 = dict(pane_info=, pane=, sockets=) for the M4 fixtures."""
    home = tmp_path / "home"
    home.mkdir(exist_ok=True)
    _write(home / ".bash_history", history)
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    ip = bin_dir / "ip"
    _write(ip, _ip_stub(addr, route))
    ip.chmod(0o755)
    env = {
        **os.environ,
        "HOME": home.as_posix(),
        "LOG_FILE": (tmp_path / "scoring.log").as_posix(),
    }
    if m4 is not None:
        files = {}
        for key, name in (("pane_info", "pane-info"), ("pane", "pane-output"), ("sockets", "socket-output")):
            if m4.get(key) is None:
                continue
            f = tmp_path / f"{name}.txt"
            _write(f, m4[key])
            files[key] = f.as_posix()
        env.update({
            "SCORING_TEST_MODE": "1",
            "SCORING_TEST_PANE_INFO_FILE": files.get("pane_info", ""),
            "SCORING_TEST_PANE_OUTPUT_FILE": files.get("pane", ""),
            "SCORING_TEST_SOCKET_OUTPUT_FILE": files.get("sockets", ""),
            "SCORING_TEST_MSF_PID": "4242",
            "SCORING_TEST_MSF_CMDLINE": "/usr/bin/ruby /usr/bin/msfconsole -q",
        })
    res = subprocess.run(
        [BASH, "-c", _WITH_STUBS, "stubs", str(bin_dir), script, "1", str(milestone)],
        capture_output=True, text=True, env=env,
    )
    assert res.returncode == 0, res.stderr
    lines = [ln.strip() for ln in res.stdout.splitlines() if ln.strip()]
    return (lines[-1] if lines else ""), scoring_diagnostics.parse_diag(res.stdout, 1), lines


def _m4(pane_info="4100|ruby", pane=PANE_OK, sockets=SOCKET_OK):
    return {"pane_info": pane_info, "pane": pane, "sockets": sockets}


# (id, milestone, run kwargs, expected reason or None for a pass)
CASES = [
    # M1 host discovery: [[ prefix ]] && nmap …0/24 && route
    ("m1-pass", 1, dict(history="nmap -sn 10.0.51.0/24\n"), None),
    ("m1-no-address", 1, dict(history="nmap -sn 10.0.51.0/24\n", addr=False), "NO_POD_ADDRESS"),
    ("m1-no-history", 1, dict(), "COMMAND_NOT_FOUND"),
    ("m1-not-nmap", 1, dict(history="ping -c1 10.0.51.20\n"), "COMMAND_NOT_FOUND"),
    ("m1-other-pod", 1, dict(history="nmap -sn 10.0.55.0/24\n"), "COMMAND_NOT_MATCHED"),
    ("m1-wrong-prefix-len", 1, dict(history="nmap -sn 10.0.51.1/20\n"), "COMMAND_NOT_MATCHED"),
    ("m1-no-route", 1, dict(history="nmap -sn 10.0.51.0/24\n", route=False), "NO_SUBNET_ROUTE"),
    # Command is checked before the route, so a missing command wins.
    ("m1-no-route-no-cmd", 1, dict(route=False), "COMMAND_NOT_FOUND"),
    # M2 port enumeration: address and route first, then nmap -p/-F on .20/.30
    ("m2-pass-p", 2, dict(history="nmap -p 21,22,80,8180 10.0.51.20\n"), None),
    ("m2-pass-F", 2, dict(history="nmap 10.0.51.30 -F\n"), None),
    ("m2-no-address", 2, dict(history="nmap -p 22 10.0.51.20\n", addr=False), "NO_POD_ADDRESS"),
    ("m2-no-route", 2, dict(history="nmap -p 22 10.0.51.20\n", route=False), "NO_SUBNET_ROUTE"),
    ("m2-no-route-no-cmd", 2, dict(route=False), "NO_SUBNET_ROUTE"),
    ("m2-no-flag", 2, dict(history="nmap 10.0.51.20\n"), "COMMAND_NOT_MATCHED"),
    ("m2-wrong-host", 2, dict(history="nmap -p 22 10.0.51.19\n"), "COMMAND_NOT_MATCHED"),
    ("m2-no-history", 2, dict(), "COMMAND_NOT_FOUND"),
    # M3 service versions: [[ prefix ]] && nmap -sV .20/.30 && route
    ("m3-pass", 3, dict(history="nmap -sV 10.0.51.20\n"), None),
    ("m3-pass-order", 3, dict(history="nmap 10.0.51.30 -sV -p 80\n"), None),
    ("m3-no-sV", 3, dict(history="nmap -p 80 10.0.51.20\n"), "COMMAND_NOT_MATCHED"),
    ("m3-other-pod", 3, dict(history="nmap -sV 10.0.52.20\n"), "COMMAND_NOT_MATCHED"),
    ("m3-no-history", 3, dict(), "COMMAND_NOT_FOUND"),
    ("m3-no-route", 3, dict(history="nmap -sV 10.0.51.20\n", route=False), "NO_SUBNET_ROUTE"),
    ("m3-no-address", 3, dict(history="nmap -sV 10.0.51.20\n", addr=False), "NO_POD_ADDRESS"),
    # M4 live Tomcat-manager Metasploit session
    ("m4-pass", 4, dict(m4=_m4()), None),
    ("m4-no-address", 4, dict(m4=_m4(), addr=False), "NO_POD_ADDRESS"),
    ("m4-fixture-missing", 4, dict(m4={"pane_info": "4100|ruby", "pane": PANE_OK}), "CHECK_ERROR"),
    ("m4-no-pane", 4, dict(m4=_m4(pane_info="")), "MSF_NOT_RUNNING"),
    ("m4-two-panes", 4, dict(m4=_m4(pane_info="4100|ruby\n4200|bash\n")), "MSF_NOT_RUNNING"),
    ("m4-pane-is-shell", 4, dict(m4=_m4(pane_info="4100|bash")), "MSF_NOT_RUNNING"),
    ("m4-bad-pane-pid", 4, dict(m4=_m4(pane_info="abc|ruby")), "CHECK_ERROR"),
    ("m4-no-session", 4, dict(m4=_m4(pane="msf6 exploit(multi/http/tomcat_mgr_deploy) > run\n"
                                         "Exploit completed, but no session was created.\n")), "SESSION_NOT_OPENED"),
    ("m4-other-module", 4, dict(m4=_m4(pane="msf6 exploit/multi/handler > run\n"
                                            "[*] Meterpreter session 2 opened (10.0.51.10:4444 -> 10.0.51.20:49152)\n")),
     "SESSION_NOT_OPENED"),
    ("m4-other-target", 4, dict(m4=_m4(pane=PANE_OK.replace("10.0.51.20", "10.0.52.20"))), "SESSION_NOT_OPENED"),
    ("m4-echo-forged", 4, dict(m4=_m4(pane='msf6 exploit(multi/http/tomcat_mgr_deploy) > echo "Command shell '
                                           'session 1 opened (10.0.51.10:4444 -> 10.0.51.20:49152)"\n'
                                           "Command shell session 1 opened (10.0.51.10:4444 -> 10.0.51.20:49152)\n")),
     "SESSION_NOT_OPENED"),
    ("m4-socket-closed", 4, dict(m4=_m4(sockets="")), "SESSION_NOT_LIVE"),
    ("m4-socket-other-port", 4, dict(m4=_m4(sockets=SOCKET_OK.replace(":49152", ":8180"))), "SESSION_NOT_LIVE"),
    ("m4-socket-other-process", 4, dict(m4=_m4(sockets=SOCKET_OK.replace('"ruby",pid=4242', '"nc",pid=9999'))),
     "SESSION_NOT_LIVE"),
    # History alone never passes M4.
    ("m4-history-only", 4, dict(history="use exploit/multi/http/tomcat_mgr_deploy\nrun\n",
                                m4=_m4(pane="", sockets="")), "SESSION_NOT_OPENED"),
]


@pytest.mark.parametrize("milestone,kwargs,reason", [c[1:] for c in CASES], ids=[c[0] for c in CASES])
def test_reason_and_token(tmp_path, milestone, kwargs, reason):
    token, diag, lines = run(tmp_path, milestone, **kwargs)
    assert token == ("PASS" if reason is None else "FAIL"), lines
    assert diag == {"reason": reason, "location": "NONE", "copies": 0}, lines
    # Only the DIAG line and the token: no commands, addresses or pane text.
    assert len(lines) == 2 and DIAG_LINE.match(lines[0]), lines


def test_unknown_milestone_prints_nothing(tmp_path):
    _, diag, lines = run(tmp_path, 9, history="nmap -sn 10.0.51.0/24\n")
    assert lines == [] and diag is None


# ── Contract and isolation ──────────────────────────────────────────────────

@pytest.mark.parametrize("milestone,kwargs", [
    (1, dict(history="nmap -sn 10.0.55.0/24\n")),
    (4, dict(m4=_m4(sockets=""))),
])
def test_reason_is_never_written_to_the_container_log(tmp_path, milestone, kwargs):
    # The script runs on the student's Kali container, where the student has
    # sudo; the reason may only leave on stdout to the host-side store.
    _, diag, _ = run(tmp_path, milestone, **kwargs)
    assert diag is not None and diag["reason"] is not None
    log = tmp_path / "scoring.log"
    text = log.read_text(encoding="utf-8") if log.exists() else ""
    assert diag["reason"] not in text and "reason=" not in text and "DIAG" not in text


def test_every_reason_the_script_can_print_is_allowlisted():
    script = Path(SCRIPT).read_text(encoding="utf-8")
    m4 = script[script.index("check_live_tomcat_msf_session() {"):script.index("# === VALIDATION ===")]
    checks = script[script.index("# Scenario 1: Network Reconnaissance"):script.index("# Scenario 2:")]
    emitted = set(re.findall(r"S1_SESSION_REASON=([A-Z_]+)", m4))
    emitted |= set(re.findall(r"echo ([A-Z][A-Z_]+[A-Z])\b", checks))
    emitted |= set(re.findall(r"reason=([A-Z][A-Z_]+[A-Z])\b", checks))
    emitted.discard("NONE")
    assert emitted == scoring_diagnostics.REASON_CODES_BY_SCENARIO[1]
    # And every code has at least one case above.
    assert {c[3] for c in CASES} - {None} == scoring_diagnostics.REASON_CODES_BY_SCENARIO[1]


# ── Switch and storage (shared framework, scenario 1 rows) ─────────────────

@pytest.mark.anyio
@pytest.mark.parametrize("switch,recorded", [("1", True), ("9", False), ("", False)])
async def test_scenario_1_has_its_own_switch(monkeypatch, switch, recorded):
    from test_scenario3_diagnostics import INSTRUCTOR, _get, _pod, _rows, _verifier, _verify

    monkeypatch.delenv("S3_DIAGNOSTICS_ENABLED", raising=False)
    monkeypatch.setenv("SCORING_DIAGNOSTICS_SCENARIOS", switch)
    verifier = _verifier("FAIL", "SESSION_NOT_LIVE", location="NONE", copies=0)
    res = await _verify(_pod(scenario_id="01"), verifier, scenario_id=1, milestone_id=4)
    assert res.status == "FAIL" and "SESSION_NOT_LIVE" not in res.message
    rows = _rows("scoring_diagnostics")
    assert [(r["scenario_id"], r["milestone_id"], r["reason_code"]) for r in rows] == (
        [(1, 4, "SESSION_NOT_LIVE")] if recorded else [])
    if recorded:
        (d,) = _get(INSTRUCTOR, "/instructor/students/alice/diagnostics").json()["diagnostics"]
        assert (d["scenario_id"], d["reason_code"], d["location"]) == (1, "SESSION_NOT_LIVE", "NONE")


@pytest.mark.anyio
async def test_a_scenario_9_code_on_a_scenario_1_row_is_not_trusted(monkeypatch):
    from test_scenario3_diagnostics import _pod, _rows, _verifier, _verify

    monkeypatch.setenv("SCORING_DIAGNOSTICS_SCENARIOS", "1")
    await _verify(_pod(scenario_id="01"), _verifier("FAIL", "AGENT_MISMATCH"), scenario_id=1)
    assert [r["reason_code"] for r in _rows("scoring_diagnostics")] == ["CHECK_ERROR"]
