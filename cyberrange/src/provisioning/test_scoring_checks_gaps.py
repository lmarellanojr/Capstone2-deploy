"""Real-script tests for scoring milestones that had none: S1 M2/M3, S6 M4 (Kali
path), S9 M3, S11 M2/M3. Each runs scoring_checks.sh itself with a fake HOME,
seeded history/files, and stub commands on PATH -- same harness shape as
TestScoringChecksDirectBashExecution in test_score_verify_behavioral.py.

Portable to Windows Git Bash: same bash lookup as that harness, the stub dir is
prepended inside bash (not joined with os.pathsep), files are written with LF
endings, and /tmp fixtures are written by bash, whose /tmp isn't Python's there.
"""
from __future__ import annotations

import os
import subprocess
import uuid
from pathlib import Path

import pytest

from ssh_verifier import SCORING_SCRIPT_PATH
from test_score_verify_behavioral import _find_bash  # Git Bash first on Windows

BASH = _find_bash()
pytestmark = pytest.mark.skipif(BASH is None, reason="bash not available")
SCRIPT = str(Path(SCORING_SCRIPT_PATH).resolve())

# $1 = stub dir (a native path on Windows, so cygpath it when Git Bash has cygpath),
# the rest is the command to run with that dir first on PATH.
_WITH_STUBS = (
    'd=$1; shift; if command -v cygpath >/dev/null 2>&1; then d=$(cygpath -u "$d"); fi; '
    'export PATH="$d:$PATH"; exec "$BASH" "$@"'
)


def _write(path: Path, text: str) -> None:
    # LF only: Windows' default CRLF breaks "#!/bin/bash" stubs and history lines.
    path.write_text(text, newline="\n")


def _bash_tmp_file(name: str, content: str) -> str:
    """Write a fixture where the script reads it: bash's /tmp."""
    path = f"/tmp/{name}"
    subprocess.run([BASH, "-c", 'mkdir -p /tmp && cat > "$1"', "write", path], input=content.encode(), check=True)
    return path


def _bash_rm(path: str) -> None:
    subprocess.run([BASH, "-c", 'rm -f "$1"', "rm", path], check=False)

IP_STUB = (
    "#!/bin/bash\n"
    'if [[ "$*" == *"addr show"* ]]; then\n'
    '  echo "2: eth0    inet 10.0.51.100/24 brd 10.0.51.255 scope global eth0"\n'
    'elif [[ "$*" == *"route"* ]]; then\n'
    '  echo "10.0.51.0/24 dev eth0 proto kernel scope link src 10.0.51.100"\n'
    "fi\n"
)


def _stub(bin_dir: Path, name: str, body: str) -> None:
    p = bin_dir / name
    _write(p, body)
    p.chmod(0o755)


def run(tmp_path: Path, scenario: int, milestone: int, *, history: str = "", stubs=None, extra_env=None) -> str:
    home = tmp_path / "home"
    home.mkdir(exist_ok=True)
    _write(home / ".bash_history", history)
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    for name, body in (stubs or {}).items():
        _stub(bin_dir, name, body)
    env = {
        **os.environ,
        "HOME": home.as_posix(),
        "LOG_FILE": (tmp_path / "scoring.log").as_posix(),
        **(extra_env or {}),
    }
    res = subprocess.run(
        [BASH, "-c", _WITH_STUBS, "stubs", str(bin_dir), SCRIPT, str(scenario), str(milestone)],
        capture_output=True, text=True, env=env,
    )
    assert res.returncode == 0, res.stderr
    lines = [ln.strip() for ln in res.stdout.splitlines() if ln.strip()]
    return lines[-1] if lines else ""


# ── Scenario 1 (id 1): M2 port enumeration, M3 service versions ─────────────

@pytest.mark.parametrize("line", ["nmap -p 21,22,80,8180 10.0.51.20", "nmap 10.0.51.20 -F"])
def test_s1_m2_port_scan_of_this_pods_target_passes(tmp_path, line):
    assert run(tmp_path, 1, 2, history=line + "\n", stubs={"ip": IP_STUB}) == "PASS"


@pytest.mark.parametrize("line", [
    "nmap -p 80 10.0.55.20",   # another pod's subnet
    "nmap -p 80 10.0.51.19",   # wrong host in this pod
    "nmap 10.0.51.20",          # no port selection
])
def test_s1_m2_wrong_target_or_no_ports_fails(tmp_path, line):
    assert run(tmp_path, 1, 2, history=line + "\n", stubs={"ip": IP_STUB}) == "FAIL"


def test_s1_m3_version_scan_of_this_pods_target_passes(tmp_path):
    assert run(tmp_path, 1, 3, history="nmap -sV 10.0.51.20\n", stubs={"ip": IP_STUB}) == "PASS"


def test_s1_m3_version_scan_of_a_missing_host_fails(tmp_path):
    assert run(tmp_path, 1, 3, history="nmap -sV 10.0.51.99\n", stubs={"ip": IP_STUB}) == "FAIL"


# ── Scenario 2 (id 6): M4 reflected XSS, Kali/artifact path ─────────────────

def _xss_artifact(content: str) -> str:
    return _bash_tmp_file("xss_reflected.txt", content)


def test_s6_m4_raw_reflection_artifact_passes(tmp_path):
    f = _xss_artifact("<pre>Hello <script>alert(1)</script></pre>")
    try:
        assert run(tmp_path, 6, 4) == "PASS"
    finally:
        _bash_rm(f)


def test_s6_m4_escaped_reflection_artifact_fails(tmp_path):
    f = _xss_artifact("<pre>Hello &lt;script&gt;alert(1)&lt;/script&gt;</pre>")
    try:
        assert run(tmp_path, 6, 4) == "FAIL"
    finally:
        _bash_rm(f)


# ── Scenario 3 (id 9): M3 incident report ───────────────────────────────────

def _report(content: str) -> str:
    return _bash_tmp_file("incident_report.txt", content)


def test_s9_m3_real_report_passes(tmp_path):
    body = ("The system raised alert rule 5710 for a failed SSH login attack. "
            "Evidence: auth.log and the Wazuh timeline. Recommend blocking the source, "
            "rotating credentials and tuning the detection rules for this host.\n")
    assert len(body) > 200
    f = _report(body)
    try:
        assert run(tmp_path, 9, 3) == "PASS"
    finally:
        _bash_rm(f)


def test_s9_m3_short_report_fails(tmp_path):
    f = _report("attack seen, recommend fix\n")
    try:
        assert run(tmp_path, 9, 3) == "FAIL"
    finally:
        _bash_rm(f)


# ── Scenario 4 (id 11): M2 remediation state, M3 exploit path closed ────────

def _users(tmp_path: Path, xml: str) -> dict:
    f = tmp_path / f"tomcat-users-{uuid.uuid4().hex}.xml"
    _write(f, xml)
    return {"TOMCAT_USERS_FILE": f.as_posix()}


def test_s11_m2_default_password_still_there_fails(tmp_path):
    env = _users(tmp_path, '<user username="tomcat" password="tomcat" roles="manager-script"/>')
    assert run(tmp_path, 11, 2, extra_env=env) == "FAIL"


def test_s11_m2_password_changed_passes(tmp_path):
    env = _users(tmp_path, '<user username="tomcat" password="N3w-Str0ng!" roles="manager-script"/>')
    assert run(tmp_path, 11, 2, extra_env=env) == "PASS"


def test_s11_m2_swapping_quote_style_is_not_a_fix(tmp_path):
    env = _users(tmp_path, "<user username='tomcat' password='tomcat' roles='manager-script'/>")
    assert run(tmp_path, 11, 2, extra_env=env) == "FAIL"


def test_s11_m2_a_sed_that_leaves_the_password_does_not_pass(tmp_path):
    # Regression: any `sed -i` on the file used to pass even when the default
    # credential was still in it.
    env = _users(tmp_path, '<user username="tomcat" password="tomcat" roles="manager-script"/>')
    hist = "sudo sed -i 's/manager-gui/manager-script/' /etc/tomcat9/tomcat-users.xml\n"
    assert run(tmp_path, 11, 2, history=hist, extra_env=env) == "FAIL"


@pytest.mark.parametrize("code,expected", [("401", "PASS"), ("403", "PASS"), ("200", "FAIL"), ("000", "FAIL")])
def test_s11_m3_uses_the_http_status(tmp_path, code, expected):
    curl = f"#!/bin/bash\nprintf '{code}'\n"
    assert run(tmp_path, 11, 3, stubs={"curl": curl}) == expected
