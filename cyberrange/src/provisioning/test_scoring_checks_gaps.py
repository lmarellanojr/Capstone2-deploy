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
    body = ("The system raised alert rule 5710 on pod-alice-meta for a failed SSH login attack. "
            "Evidence: auth.log and the Wazuh timeline. Recommend blocking the source, "
            "rotating credentials and tuning the detection rules for this host.\n")
    assert len(body) > 200
    f = _report(body)
    try:
        assert run(tmp_path, 9, 3, extra_env={"SCORING_S9_EXPECTED_AGENT": "pod-alice-meta"}) == "PASS"
    finally:
        _bash_rm(f)


def test_s9_m3_wrong_agent_fails(tmp_path):
    """Correct rule 5710 but another pod's agent must FAIL the agent gate."""
    body = (
        "Summary: Rule 5710 on pod-bob-meta at 2026-10-01T14:32:05Z recorded a failed SSH.\n"
        "Affected system: pod-bob-meta\n"
        "Evidence: Open SIEM rule 5710 event matching auth.log Invalid user.\n"
        "Interpretation: True positive failed login; no successful access observed.\n"
        "Recommended response: Monitor for repetition; do not isolate after one lab failure.\n"
    )
    assert len(body) > 200
    f = _report(body)
    try:
        assert run(tmp_path, 9, 3, extra_env={"SCORING_S9_EXPECTED_AGENT": "pod-alice-meta"}) == "FAIL"
    finally:
        _bash_rm(f)


def test_s9_m3_wrong_rule_fails(tmp_path):
    """Correct agent but only rule 5503 (no 5710) must FAIL the rule gate."""
    body = (
        "Summary: Rule 5503 CIS finding on pod-alice-meta at 2026-10-01T00:00:00Z.\n"
        "Affected system: pod-alice-meta\n"
        "Evidence: copied a CIS SIEM row, not our failed SSH attempt.\n"
        "Interpretation: This is the wrong alert for Scenario 3 Task 0.\n"
        "Recommended response: ignore this CIS row and reopen the SIEM for authentication events.\n"
    )
    assert len(body) > 200
    assert "5710" not in body
    f = _report(body)
    try:
        assert run(tmp_path, 9, 3, extra_env={"SCORING_S9_EXPECTED_AGENT": "pod-alice-meta"}) == "FAIL"
    finally:
        _bash_rm(f)


def test_s9_m3_short_report_fails(tmp_path):
    f = _report("attack seen, recommend fix\n")
    try:
        assert run(tmp_path, 9, 3) == "FAIL"
    finally:
        _bash_rm(f)


def test_s9_m3_empty_heading_skeleton_fails(tmp_path):
    body = (
        "Summary:\n"
        "Affected system:\n"
        "Evidence:\n"
        "Interpretation:\n"
        "Recommended response:\n"
    )
    f = _report(body)
    try:
        assert run(tmp_path, 9, 3) == "FAIL"
    finally:
        _bash_rm(f)


def test_s9_m3_guide_example_report_fails(tmp_path):
    body = (
        "At 06:32 UTC on 10 October 2026, rule 5710 on system pod-example-meta recorded a "
        "nonexistent-user SSH attempt. This supports failed authentication; these records do "
        "not establish successful access. I recommend checking adjacent authentication events "
        "for repetition before choosing containment.\n"
    )
    assert len(body) > 200
    f = _report(body)
    try:
        assert run(tmp_path, 9, 3) == "FAIL"
    finally:
        _bash_rm(f)


def test_s9_m3_example_date_and_phrase_without_agent_fails(tmp_path):
    body = (
        "Summary: On 10 October 2026 the SIEM recorded a nonexistent-user SSH attempt against "
        "our lab host. Affected system: pod-student-meta. Evidence: rule 5710. Interpretation: "
        "failed authentication only. Recommended response: monitor for repetition; do not isolate "
        "after a single intentional lab failure.\n"
    )
    assert len(body) > 200
    f = _report(body)
    try:
        assert run(tmp_path, 9, 3) == "FAIL"
    finally:
        _bash_rm(f)


def _triage(content: str) -> str:
    return _bash_tmp_file("alert_triage.json", content)


def test_s9_m1_unedited_paste_skeleton_fails(tmp_path):
    body = (
        '{\n'
        '  "alert_id": "case-1",\n'
        '  "severity": "medium",\n'
        '  "rule": "5710",\n'
        '  "description": "PASTE SIEM DESCRIPTION",\n'
        '  "agent": "PASTE YOUR pod-…-meta NAME",\n'
        '  "classification": "true_positive",\n'
        '  "notes": "PASTE FULL SIEM TIMESTAMP ENDING IN Z — invalid-user SSH"\n'
        '}\n'
    )
    f = _triage(body)
    try:
        assert run(tmp_path, 9, 1) == "FAIL"
    finally:
        _bash_rm(f)


def test_s9_m1_filled_real_values_pass(tmp_path):
    body = (
        '{"alert_id":"case-1","severity":"medium","rule":"5710",'
        '"description":"sshd: attempt to login using a non-existent user",'
        '"agent":"pod-student-meta","classification":"true_positive",'
        '"notes":"2026-10-01T14:32:05Z invalid-user SSH; I pasted the SIEM time"}\n'
    )
    f = _triage(body)
    env = _authlog(tmp_path, _AUTHLOG_5710)
    env["SCORING_S9_EXPECTED_AGENT"] = "pod-student-meta"
    try:
        assert run(tmp_path, 9, 1, extra_env=env) == "PASS"
    finally:
        _bash_rm(f)


def test_s9_m1_wrong_rule_fails(tmp_path):
    body = (
        '{"alert_id":"case-1","severity":"medium","rule":"5503",'
        '"description":"sshd: attempt to login using a non-existent user",'
        '"agent":"pod-alice-meta","classification":"true_positive",'
        '"notes":"2026-10-01T14:32:05Z invalid-user SSH"}\n'
    )
    f = _triage(body)
    env = _authlog(tmp_path, _AUTHLOG_5710)
    env["SCORING_S9_EXPECTED_AGENT"] = "pod-alice-meta"
    try:
        assert run(tmp_path, 9, 1, extra_env=env) == "FAIL"
    finally:
        _bash_rm(f)


def test_s9_m1_fabricated_time_fails(tmp_path):
    body = (
        '{"alert_id":"case-1","severity":"medium","rule":"5710",'
        '"description":"sshd: attempt to login using a non-existent user",'
        '"agent":"pod-alice-meta","classification":"true_positive",'
        '"notes":"2026-10-01T00:00:00Z invalid-user SSH"}\n'
    )
    f = _triage(body)
    env = _authlog(tmp_path, _AUTHLOG_5710)
    env["SCORING_S9_EXPECTED_AGENT"] = "pod-alice-meta"
    try:
        assert run(tmp_path, 9, 1, extra_env=env) == "FAIL"
    finally:
        _bash_rm(f)


def test_s9_m1_example_agent_fails(tmp_path):
    body = (
        '{"alert_id":"case-1","severity":"medium","rule":"5710",'
        '"description":"sshd non-existent user","agent":"pod-example-meta",'
        '"classification":"true_positive","notes":"2026-10-01T14:32:05Z lab attempt"}\n'
    )
    f = _triage(body)
    try:
        assert run(tmp_path, 9, 1, extra_env={"SCORING_S9_EXPECTED_AGENT": "pod-alice-meta"}) == "FAIL"
    finally:
        _bash_rm(f)


def test_s9_m1_junk_agent_without_substance_fails(tmp_path):
    body = (
        '{"alert_id":"case-1","severity":"medium","rule":"5710",'
        '"description":"x","agent":"pod-adversary-meta",'
        '"classification":"true_positive","notes":"short"}\n'
    )
    f = _triage(body)
    try:
        assert run(tmp_path, 9, 1, extra_env={"SCORING_S9_EXPECTED_AGENT": "pod-alice-meta"}) == "FAIL"
    finally:
        _bash_rm(f)


def test_s9_m1_ascii_dots_agent_fails(tmp_path):
    body = (
        '{"alert_id":"case-1","severity":"medium","rule":"5710",'
        '"description":"sshd non-existent user","agent":"pod-...-meta",'
        '"classification":"true_positive","notes":"2026-10-01T14:32:05Z lab attempt"}\n'
    )
    f = _triage(body)
    try:
        assert run(tmp_path, 9, 1, extra_env={"SCORING_S9_EXPECTED_AGENT": "pod-alice-meta"}) == "FAIL"
    finally:
        _bash_rm(f)


def test_s9_m1_other_pod_agent_fails(tmp_path):
    """Rule 5710 + matching auth.log time, but another pod's agent, must FAIL."""
    body = (
        '{"alert_id":"case-1","severity":"medium","rule":"5710",'
        '"description":"sshd non-existent user","agent":"pod-bob-meta",'
        '"classification":"true_positive","notes":"2026-10-01T14:32:05Z lab attempt"}\n'
    )
    f = _triage(body)
    env = _authlog(tmp_path, _AUTHLOG_5710)
    env["SCORING_S9_EXPECTED_AGENT"] = "pod-alice-meta"
    try:
        assert run(tmp_path, 9, 1, extra_env=env) == "FAIL"
    finally:
        _bash_rm(f)


def test_s9_m1_fqdn_expected_agent_still_passes(tmp_path):
    """If hostname is an FQDN, strip the suffix before comparing."""
    body = (
        '{"alert_id":"case-1","severity":"medium","rule":"5710",'
        '"description":"sshd: attempt to login using a non-existent user",'
        '"agent":"pod-alice-meta","classification":"true_positive",'
        '"notes":"2026-10-01T14:32:05Z invalid-user SSH; I pasted the SIEM time"}\n'
    )
    f = _triage(body)
    env = _authlog(tmp_path, _AUTHLOG_5710)
    env["SCORING_S9_EXPECTED_AGENT"] = "pod-alice-meta.lxd"
    try:
        assert run(tmp_path, 9, 1, extra_env=env) == "PASS"
    finally:
        _bash_rm(f)


# ── Scenario 3 (id 9): M2 timeline must match a REAL rule-5710 event time ────
# SCORE-FIX: the claimed HH:MM is validated against auth.log, so a fabricated or
# placeholder time fails while a time near a real "Invalid user" event passes.

def _timeline(content: str) -> str:
    return _bash_tmp_file("incident_timeline.md", content)


def _authlog(tmp_path: Path, content: str) -> dict:
    p = tmp_path / f"auth-{uuid.uuid4().hex}.log"
    _write(p, content)
    return {"S9_AUTHLOG": p.as_posix(), "S9_NOW": "2026-10-01T14:33:05Z"}


# One real failed/invalid-user SSH event at 14:32 (Wazuh rule 5710).
_AUTHLOG_5710 = "Oct  1 14:32:05 meta sshd[1337]: Invalid user oracle from 10.0.51.10 port 50122 ssh2\n"


def test_s9_m2_correct_time_passes(tmp_path):
    env = _authlog(tmp_path, _AUTHLOG_5710)
    f = _timeline("1. phase: initial_access_attempt, rule: 5710, timestamp: 2026-10-01T14:33:05Z, true_positive\n")
    try:
        assert run(tmp_path, 9, 2, extra_env=env) == "PASS"
    finally:
        _bash_rm(f)


def test_s9_m2_same_time_on_wrong_date_fails(tmp_path):
    env = _authlog(tmp_path, _AUTHLOG_5710)
    f = _timeline("1. phase: initial_access_attempt, rule: 5710, timestamp: 2026-10-02T14:32:05Z, true_positive\n")
    try:
        assert run(tmp_path, 9, 2, extra_env=env) == "FAIL"
    finally:
        _bash_rm(f)


def test_s9_m2_planted_flag_m1_line_does_not_count(tmp_path):
    # The provision-time planted "Invalid user flag-m1-<flag> ..." line is NOT a real
    # sshd event; copying its timestamp must not pass M2 (reviewer finding, PR #141).
    planted = "Oct  1 09:15:00 meta sshd[1]: Invalid user flag-m1-ABCDEF0 from 10.0.50.10 port 1 ssh2\n"
    env = _authlog(tmp_path, planted)
    f = _timeline("1. phase: initial_access_attempt, rule: 5710, timestamp: 2026-10-01T09:15:00Z, true_positive\n")
    try:
        assert run(tmp_path, 9, 2, extra_env=env) == "FAIL"
    finally:
        _bash_rm(f)


def test_s9_m2_wrong_time_fails(tmp_path):
    env = _authlog(tmp_path, _AUTHLOG_5710)
    f = _timeline("1. phase: initial_access_attempt, rule: 5710, timestamp: 2026-10-01T00:00:00Z, true_positive\n")
    try:
        assert run(tmp_path, 9, 2, extra_env=env) == "FAIL"
    finally:
        _bash_rm(f)


def test_s9_m2_wrong_year_fails(tmp_path):
    env = _authlog(tmp_path, _AUTHLOG_5710)
    f = _timeline("1. phase: initial_access_attempt, rule: 5710, timestamp: 2025-10-01T14:32:05Z, true_positive\n")
    try:
        assert run(tmp_path, 9, 2, extra_env=env) == "FAIL"
    finally:
        _bash_rm(f)


def test_s9_m2_invalid_calendar_date_fails(tmp_path):
    env = _authlog(tmp_path, _AUTHLOG_5710)
    f = _timeline("1. phase: initial_access_attempt, rule: 5710, timestamp: 2026-02-30T14:32:05Z, true_positive\n")
    try:
        assert run(tmp_path, 9, 2, extra_env=env) == "FAIL"
    finally:
        _bash_rm(f)


def test_s9_m2_timestamp_without_utc_designator_fails(tmp_path):
    env = _authlog(tmp_path, _AUTHLOG_5710)
    f = _timeline("1. phase: initial_access_attempt, rule: 5710, timestamp: 2026-10-01T14:32:05, true_positive\n")
    try:
        assert run(tmp_path, 9, 2, extra_env=env) == "FAIL"
    finally:
        _bash_rm(f)


def test_s9_m2_longer_rule_id_does_not_match_5710(tmp_path):
    env = _authlog(tmp_path, _AUTHLOG_5710)
    f = _timeline("1. phase: initial_access_attempt, rule: 57100, timestamp: 2026-10-01T14:32:05Z, true_positive\n")
    try:
        assert run(tmp_path, 9, 2, extra_env=env) == "FAIL"
    finally:
        _bash_rm(f)


def test_s9_m2_new_year_rollover_passes(tmp_path):
    env = _authlog(tmp_path, "Dec 31 23:59:00 meta sshd[1337]: Invalid user oracle from 10.0.51.10 port 50122 ssh2\n")
    env["S9_NOW"] = "2027-01-01T00:02:00Z"
    f = _timeline("1. phase: initial_access_attempt, rule: 5710, timestamp: 2026-12-31T23:59:30Z, true_positive\n")
    try:
        assert run(tmp_path, 9, 2, extra_env=env) == "PASS"
    finally:
        _bash_rm(f)


def test_s9_m2_placeholder_time_fails(tmp_path):
    env = _authlog(tmp_path, _AUTHLOG_5710)
    f = _timeline("1. phase: initial_access_attempt, rule: 5710, timestamp: <actual timestamp>, true_positive\n")
    try:
        assert run(tmp_path, 9, 2, extra_env=env) == "FAIL"
    finally:
        _bash_rm(f)


def test_s9_m2_paste_timestamp_token_fails(tmp_path):
    env = _authlog(tmp_path, _AUTHLOG_5710)
    f = _timeline(
        "1. phase: initial_access_attempt, rule: 5710, timestamp: PASTE_SIEM_TIMESTAMP_Z, true_positive\n"
    )
    try:
        assert run(tmp_path, 9, 2, extra_env=env) == "FAIL"
    finally:
        _bash_rm(f)


def test_s9_m2_guide_example_timestamp_fails(tmp_path):
    env = _authlog(tmp_path, _AUTHLOG_5710)
    f = _timeline(
        "1. phase: initial_access_attempt, rule: 5710, timestamp: 2026-10-10T06:32:00Z, true_positive\n"
    )
    try:
        assert run(tmp_path, 9, 2, extra_env=env) == "FAIL"
    finally:
        _bash_rm(f)


def test_s9_m2_whole_hour_timezone_offset_passes(tmp_path):
    # Event 14:32:05Z recorded on a UTC+8 clock as 22:32 with a Z (#218).
    env = _authlog(tmp_path, _AUTHLOG_5710)
    f = _timeline("1. phase: initial_access_attempt, rule: 5710, timestamp: 2026-10-01T22:33:00Z, true_positive\n")
    try:
        assert run(tmp_path, 9, 2, extra_env=env) == "PASS"
    finally:
        _bash_rm(f)


def test_s9_m2_whole_hour_offset_plus_drift_fails(tmp_path):
    # 8 h + 10 min off: not within +/- 5 min of any whole-hour shift.
    env = _authlog(tmp_path, _AUTHLOG_5710)
    f = _timeline("1. phase: initial_access_attempt, rule: 5710, timestamp: 2026-10-01T22:42:05Z, true_positive\n")
    try:
        assert run(tmp_path, 9, 2, extra_env=env) == "FAIL"
    finally:
        _bash_rm(f)


def test_s9_m2_offset_beyond_fourteen_hours_fails(tmp_path):
    # 15 h is outside every real UTC offset, so the hour tolerance stops there.
    env = _authlog(tmp_path, "Oct  1 08:32:05 meta sshd[1337]: Invalid user oracle from 10.0.51.10 port 50122 ssh2\n")
    f = _timeline("1. phase: initial_access_attempt, rule: 5710, timestamp: 2026-10-01T23:32:05Z, true_positive\n")
    try:
        assert run(tmp_path, 9, 2, extra_env=env) == "FAIL"
    finally:
        _bash_rm(f)


_AUTHLOG_NEAR_HOUR = "Oct  1 10:02:11 meta sshd[1337]: Invalid user oracle from 10.0.51.10 port 50122 ssh2\n"


@pytest.mark.parametrize("claim", ["2026-10-01T00:00:00Z", "2026-10-01T18:00:00Z"])
def test_s9_m2_round_hour_guess_near_event_fails(tmp_path, claim):
    # Event at 10:02:11: a round HH:00:00Z is within 5 min of a whole-hour shift but
    # a real local-clock copy keeps minutes/seconds, so the shifted window is 60 s.
    env = _authlog(tmp_path, _AUTHLOG_NEAR_HOUR)
    f = _timeline(f"1. phase: initial_access_attempt, rule: 5710, timestamp: {claim}, true_positive\n")
    try:
        assert run(tmp_path, 9, 2, extra_env=env) == "FAIL"
    finally:
        _bash_rm(f)


_SIX_GUESSES = [f"2026-10-01T10:{m}0:00Z" for m in range(6)]


def test_s9_m2_minute_enumeration_on_one_line_fails(tmp_path):
    # Six stamps 10 min apart cover every minute-of-hour; only the first stamp may
    # use the hour shift, so the list can't hit 14:32:05 without reading the SIEM.
    env = _authlog(tmp_path, _AUTHLOG_5710)
    f = _timeline(f"1. phase: initial_access_attempt, rule: 5710, timestamps: {', '.join(_SIX_GUESSES)}\n")
    try:
        assert run(tmp_path, 9, 2, extra_env=env) == "FAIL"
    finally:
        _bash_rm(f)


def test_s9_m2_minute_enumeration_across_lines_fails(tmp_path):
    env = _authlog(tmp_path, _AUTHLOG_5710)
    f = _timeline("".join(f"{i}. rule: 5710, timestamp: {s}\n" for i, s in enumerate(_SIX_GUESSES, 1)))
    try:
        assert run(tmp_path, 9, 2, extra_env=env) == "FAIL"
    finally:
        _bash_rm(f)


def test_s9_m1_minute_enumeration_fails(tmp_path):
    body = (
        '{"alert_id":"case-1","severity":"medium","rule":"5710",'
        '"description":"sshd: attempt to login using a non-existent user",'
        '"agent":"pod-student-meta","classification":"true_positive",'
        f'"notes":"{" ".join(_SIX_GUESSES)}"}}\n'
    )
    f = _triage(body)
    env = _authlog(tmp_path, _AUTHLOG_5710)
    env["SCORING_S9_EXPECTED_AGENT"] = "pod-student-meta"
    try:
        assert run(tmp_path, 9, 1, extra_env=env) == "FAIL"
    finally:
        _bash_rm(f)


def test_s9_m2_invalid_date_does_not_take_shift_slot(tmp_path):
    # An unparseable 2026-02-30 stamp can't match, so it must not use up the one
    # hour-shift slot; the following +8 h local-clock copy still passes.
    env = _authlog(tmp_path, _AUTHLOG_5710)
    f = _timeline(
        "1. rule: 5710, timestamps: 2026-02-30T14:32:05Z, 2026-10-01T22:32:05Z, true_positive\n"
    )
    try:
        assert run(tmp_path, 9, 2, extra_env=env) == "PASS"
    finally:
        _bash_rm(f)


@pytest.mark.parametrize("claim,expected", [
    ("2026-10-01T02:32:05Z", "PASS"),  # UTC-12, the westernmost real offset
    ("2026-10-01T01:32:05Z", "FAIL"),  # -13 h: no such zone
    ("2026-10-01T00:32:05Z", "FAIL"),  # -14 h: no such zone
])
def test_s9_m2_negative_offset_bounded_to_twelve_hours(tmp_path, claim, expected):
    env = _authlog(tmp_path, _AUTHLOG_5710)
    f = _timeline(f"1. phase: initial_access_attempt, rule: 5710, timestamp: {claim}, true_positive\n")
    try:
        assert run(tmp_path, 9, 2, extra_env=env) == expected
    finally:
        _bash_rm(f)


def test_s9_m1_whole_hour_timezone_offset_passes(tmp_path):
    body = (
        '{"alert_id":"case-1","severity":"medium","rule":"5710",'
        '"description":"sshd: attempt to login using a non-existent user",'
        '"agent":"pod-student-meta","classification":"true_positive",'
        '"notes":"2026-10-01T09:32:05Z invalid-user SSH; recorded on a UTC-5 clock"}\n'
    )
    f = _triage(body)
    env = _authlog(tmp_path, _AUTHLOG_5710)
    env["SCORING_S9_EXPECTED_AGENT"] = "pod-student-meta"
    try:
        assert run(tmp_path, 9, 1, extra_env=env) == "PASS"
    finally:
        _bash_rm(f)


def test_s9_m2_correct_time_but_no_real_event_fails(tmp_path):
    env = _authlog(tmp_path, "Oct  1 09:00:00 meta sshd[1]: Accepted password for msfadmin\n")
    f = _timeline("1. phase: initial_access_attempt, rule: 5710, timestamp: 2026-10-01T14:32:05Z, true_positive\n")
    try:
        assert run(tmp_path, 9, 2, extra_env=env) == "FAIL"
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


# The student's verification curl in history (what the guide tells them to run).
_M3_VERIFY_HIST = (
    "curl -s -o /dev/null -w '%{http_code}\\n' -u tomcat:tomcat "
    "http://127.0.0.1:8180/manager/text/list\n"
)


@pytest.mark.parametrize("code,expected", [("401", "PASS"), ("403", "PASS"), ("200", "FAIL"), ("000", "FAIL")])
def test_s11_m3_passes_only_when_closed_and_verified(tmp_path, code, expected):
    # The student ran the verification curl AND the manager rejects old creds.
    curl = f"#!/bin/bash\nprintf '{code}'\n"
    assert run(tmp_path, 11, 3, history=_M3_VERIFY_HIST, stubs={"curl": curl}) == expected


def test_s11_m3_closed_but_not_verified_fails(tmp_path):
    # Regression: after M2 the old creds already fail (401), but if the student
    # never ran the verification curl, the "confirm" task must NOT auto-pass.
    curl = "#!/bin/bash\nprintf '401'\n"
    assert run(tmp_path, 11, 3, history="sudo systemctl restart tomcat9\n", stubs={"curl": curl}) == "FAIL"


def test_s11_m3_verified_but_still_open_fails(tmp_path):
    # Student ran the curl, but the fix isn't really in place (still 200).
    curl = "#!/bin/bash\nprintf '200'\n"
    assert run(tmp_path, 11, 3, history=_M3_VERIFY_HIST, stubs={"curl": curl}) == "FAIL"
