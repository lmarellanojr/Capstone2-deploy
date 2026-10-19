"""Scenario 3 (scorer id 9) diagnostics, run against scoring_checks.sh itself.

Each failing condition must print its allowlisted reason on the DIAG line while
the final PASS/FAIL token stays what the old single && chain produced. Artifacts
live under S9_ARTIFACT_ROOT (a tmp_path test seam) so nothing touches the
machine's real /tmp or /home, and the location policy can be exercised.
"""
from __future__ import annotations

import os
import re
import subprocess
import uuid
from pathlib import Path

import pytest

import scoring_diagnostics
from ssh_verifier import SCORING_SCRIPT_PATH
from test_score_verify_behavioral import _find_bash

BASH = _find_bash()
pytestmark = pytest.mark.skipif(BASH is None, reason="bash not available")
SCRIPT = str(Path(SCORING_SCRIPT_PATH).resolve())

DIAG_LINE = re.compile(r"^DIAG reason=[A-Z_]+ location=[A-Z_]+ copies=[0-3]$")

AGENT = "pod-student-meta"
# One real invalid-user SSH event at 14:32:05 UTC (Wazuh rule 5710).
AUTHLOG = "Oct  1 14:32:05 meta sshd[1337]: Invalid user oracle from 10.0.51.10 port 50122 ssh2\n"
NOW = "2026-10-01T14:33:05Z"

TRIAGE_OK = (
    '{"alert_id":"case-1","severity":"medium","rule":"5710",'
    '"description":"sshd: attempt to login using a non-existent user",'
    f'"agent":"{AGENT}","classification":"true_positive",'
    '"notes":"2026-10-01T14:32:05Z invalid-user SSH"}\n'
)
TIMELINE_OK = "1. phase: initial_access_attempt, rule: 5710, timestamp: 2026-10-01T14:33:05Z, true_positive\n"
REPORT_OK = (
    f"The system raised alert rule 5710 on {AGENT} for a failed SSH login attack. "
    "Evidence: auth.log and the Wazuh timeline. Recommend blocking the source, "
    "rotating credentials and tuning the detection rules for this host.\n"
)

FILES = {1: "alert_triage.json", 2: "incident_timeline.md", 3: "incident_report.txt"}
LOCATIONS = {"HOME_MSFADMIN": "home/msfadmin", "HOME_STUDENT": "home/student", "TMP": "tmp"}


def _write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, newline="\n", encoding="utf-8")


def _place(root: Path, milestone: int, content: str, location: str = "HOME_MSFADMIN") -> Path:
    p = root / LOCATIONS[location] / FILES[milestone]
    _write(p, content)
    return p


def _env(tmp_path: Path, root: Path, *, authlog: str | None = AUTHLOG, **extra) -> dict:
    home = tmp_path / "home-user"
    home.mkdir(exist_ok=True)
    env = {
        **os.environ,
        "HOME": home.as_posix(),
        "LOG_FILE": (tmp_path / "scoring.log").as_posix(),
        "S9_ARTIFACT_ROOT": root.as_posix(),
        "SCORING_S9_EXPECTED_AGENT": AGENT,
        "S9_NOW": NOW,
    }
    if authlog is None:
        env["S9_AUTHLOG"] = (tmp_path / "no-such-auth.log").as_posix()
    else:
        log = tmp_path / f"auth-{uuid.uuid4().hex}.log"
        _write(log, authlog)
        env["S9_AUTHLOG"] = log.as_posix()
    env.update(extra)
    return env


def run(tmp_path: Path, milestone: int, *, scenario: int = 9, **env_kw) -> tuple[str, dict | None, list[str]]:
    root = env_kw.pop("root", tmp_path / "root")
    res = subprocess.run(
        [BASH, SCRIPT, str(scenario), str(milestone)],
        capture_output=True, text=True, env=_env(tmp_path, root, **env_kw),
    )
    assert res.returncode == 0, res.stderr
    lines = [ln.strip() for ln in res.stdout.splitlines() if ln.strip()]
    return (lines[-1] if lines else ""), scoring_diagnostics.parse_diag(res.stdout, scenario), lines


def check(tmp_path, milestone, content, *, token, reason, **kw):
    if content is not None:
        _place(tmp_path / "root", milestone, content)
    got_token, diag, lines = run(tmp_path, milestone, **kw)
    assert got_token == token
    assert diag is not None and diag["reason"] == reason, lines
    # Only the DIAG line and the token: no artifact text, paths or command output.
    assert len(lines) == 2 and DIAG_LINE.match(lines[0]), lines
    return diag


# ── Valid submissions still pass ────────────────────────────────────────────

@pytest.mark.parametrize("milestone,content", [(1, TRIAGE_OK), (2, TIMELINE_OK), (3, REPORT_OK)])
def test_valid_artifact_passes_with_no_reason(tmp_path, milestone, content):
    diag = check(tmp_path, milestone, content, token="PASS", reason=None)
    assert diag == {"reason": None, "location": "HOME_MSFADMIN", "copies": 1}


# ── M1 alert_triage.json ────────────────────────────────────────────────────

@pytest.mark.parametrize("content,reason", [
    (None, "ARTIFACT_MISSING"),
    ("just some notes about ssh\n", "ARTIFACT_INVALID"),
    (TRIAGE_OK.replace("sshd: attempt to login using a non-existent user", "PASTE SIEM DESCRIPTION"),
     "PLACEHOLDER_OR_EXAMPLE"),
    (TRIAGE_OK.replace(AGENT, "pod-example-meta"), "PLACEHOLDER_OR_EXAMPLE"),
    (TRIAGE_OK.replace(f'"agent":"{AGENT}",', ""), "AGENT_MISSING"),
    (TRIAGE_OK.replace(AGENT, "pod-bob-meta"), "AGENT_MISMATCH"),
    (TRIAGE_OK.replace('"rule":"5710"', '"rule":"see notes"'), "RULE_MISSING"),
    (TRIAGE_OK.replace('"rule":"5710"', '"rule":"5715"'), "RULE_MISMATCH"),
    (TRIAGE_OK.replace("2026-10-01T14:32:05Z ", ""), "TIMESTAMP_MISSING"),
    (TRIAGE_OK.replace("14:32:05Z", "14:50:00Z"), "TIMESTAMP_NOT_MATCHED"),
])
def test_m1_failure_reasons(tmp_path, content, reason):
    check(tmp_path, 1, content, token="FAIL", reason=reason)


def test_m1_no_auth_log_is_check_error(tmp_path):
    check(tmp_path, 1, TRIAGE_OK, token="FAIL", reason="CHECK_ERROR", authlog=None)


def test_m1_malformed_json_keeps_current_result(tmp_path):
    # JSON syntax was never a scoring predicate; diagnostics must not add one.
    check(tmp_path, 1, TRIAGE_OK.rstrip().rstrip("}") + "\n", token="PASS", reason=None)


# ── Timestamp boundaries, date changes, time zones (M1 shares M2's clock) ───

@pytest.mark.parametrize("stamp,token,reason", [
    ("2026-10-01T14:37:05Z", "PASS", None),                  # +5 min edge
    ("2026-10-01T14:27:05Z", "PASS", None),                  # -5 min edge
    ("2026-10-01T14:37:06Z", "FAIL", "TIMESTAMP_NOT_MATCHED"),
    ("2026-10-02T14:32:05Z", "FAIL", "TIMESTAMP_NOT_MATCHED"),  # right clock, next day
    ("2025-10-01T14:32:05Z", "FAIL", "TIMESTAMP_NOT_MATCHED"),  # wrong year
    ("2026-10-01T22:32:05Z", "PASS", None),                  # local UTC+8 read labeled Z
    ("2026-10-01T09:32:05Z", "PASS", None),                  # local UTC-5 read labeled Z
    ("2026-10-02T04:32:05Z", "PASS", None),                  # +14h, the widest real offset
    ("2026-10-02T05:32:05Z", "FAIL", "TIMESTAMP_NOT_MATCHED"),  # +15h is not a real zone
    ("2026-10-01T02:32:05Z", "PASS", None),                  # -12h
    ("2026-10-01T01:32:05Z", "FAIL", "TIMESTAMP_NOT_MATCHED"),  # -13h
    ("2026-10-01T14:32:05", "FAIL", "TIMESTAMP_MISSING"),    # no Z designator
])
def test_m1_timestamp_rules(tmp_path, stamp, token, reason):
    content = TRIAGE_OK.replace("2026-10-01T14:32:05Z", stamp)
    check(tmp_path, 1, content, token=token, reason=reason)


def test_m2_new_year_rollover_passes(tmp_path):
    authlog = "Dec 31 23:59:30 meta sshd[1]: Invalid user x from 10.0.51.10 port 1 ssh2\n"
    content = "rule 5710 at 2026-12-31T23:59:30Z\n"
    check(tmp_path, 2, content, token="PASS", reason=None, authlog=authlog, S9_NOW="2027-01-01T00:02:00Z")


# ── M2 incident_timeline.md ─────────────────────────────────────────────────

@pytest.mark.parametrize("content,reason", [
    (None, "ARTIFACT_MISSING"),
    ("rule: 5710, timestamp: PASTE_SIEM_TIMESTAMP_Z\n", "PLACEHOLDER_OR_EXAMPLE"),
    ("rule: 5710 at HH:MM\n", "PLACEHOLDER_OR_EXAMPLE"),
    ("rule 5710 at 2026-10-10T06:32:00Z on pod-example-meta\n", "PLACEHOLDER_OR_EXAMPLE"),
    ("timestamp: 2026-10-01T14:33:05Z, true_positive\n", "RULE_MISSING"),
    ("rule: 5715, timestamp: 2026-10-01T14:33:05Z\n", "RULE_MISMATCH"),
    ("rule: 57100, timestamp: 2026-10-01T14:33:05Z\n", "RULE_MISMATCH"),
    ("rule: 5710\nnext line 2026-10-01T14:33:05Z\n", "TIMESTAMP_MISSING"),
    ("rule: 5710, timestamp: 2026-10-01T15:00:00Z\n", "TIMESTAMP_NOT_MATCHED"),
])
def test_m2_failure_reasons(tmp_path, content, reason):
    check(tmp_path, 2, content, token="FAIL", reason=reason)


def test_m2_uppercase_rule_line_is_not_read_by_the_scorer(tmp_path):
    # The scorer only reads "rule"/"Rule" lines, so a correct time on a "RULE 5710"
    # line is never checked; the reason must not blame the timestamp.
    check(tmp_path, 2, TIMELINE_OK.replace("rule:", "RULE:"), token="FAIL", reason="RULE_MISSING")


# The scorer's `while read` loops (M1 agent, M2 timeline) skip a last line with no
# trailing newline; the reason must match what the scorer saw, not the file.
@pytest.mark.parametrize("milestone,content,reason", [
    (1, TRIAGE_OK, "AGENT_MISSING"),
    (2, TIMELINE_OK, "RULE_MISSING"),
])
def test_last_line_without_newline_reports_what_the_scorer_saw(tmp_path, milestone, content, reason):
    check(tmp_path, milestone, content.rstrip("\n"), token="FAIL", reason=reason)


# Far bigger than a pipe buffer: a grep -q that stops at the first match must not
# turn into "no match" (SIGPIPE + pipefail) on a long file.
PADDING = "padding line for a long student file\n" * 6000


@pytest.mark.parametrize("milestone,content,reason", [
    (1, TRIAGE_OK.replace(AGENT, "pod-bob-meta") + PADDING, "AGENT_MISMATCH"),
    (2, "rule: 5710, timestamp: 2026-10-01T15:00:00Z\n" + PADDING, "TIMESTAMP_NOT_MATCHED"),
    (2, "rule: 5715, timestamp: 2026-10-01T14:33:05Z\n" + PADDING, "RULE_MISMATCH"),
], ids=["m1-agent-mismatch", "m2-timestamp-not-matched", "m2-rule-mismatch"])
def test_large_file_keeps_the_right_reason(tmp_path, milestone, content, reason):
    check(tmp_path, milestone, content, token="FAIL", reason=reason)


def test_m2_no_auth_log_is_check_error(tmp_path):
    check(tmp_path, 2, TIMELINE_OK, token="FAIL", reason="CHECK_ERROR", authlog=None)


def test_m2_planted_flag_event_does_not_count(tmp_path):
    authlog = "Oct  1 14:32:05 meta sshd[1]: Invalid user flag-m1-abc from 10.0.51.10 port 1 ssh2\n"
    check(tmp_path, 2, TIMELINE_OK, token="FAIL", reason="TIMESTAMP_NOT_MATCHED", authlog=authlog)


# ── M3 incident_report.txt ──────────────────────────────────────────────────

@pytest.mark.parametrize("content,reason", [
    (None, "ARTIFACT_MISSING"),
    ("short system alert 5710 pod-student-meta\n", "REPORT_TOO_SHORT"),
    ("x" * 260 + "\n", "ARTIFACT_INVALID"),
    (REPORT_OK.replace(AGENT, "pod-example-meta"), "PLACEHOLDER_OR_EXAMPLE"),
    ("On 10 October 2026 a nonexistent-user SSH attempt hit the system; recommend review. "
     + "z" * 150 + "\n", "PLACEHOLDER_OR_EXAMPLE"),
    ("Summary:\nsystem alert\n" + " " * 250 + "\n", "REPORT_BODY_TOO_SHORT"),
    (REPORT_OK.replace("rule 5710", "a rule"), "RULE_MISSING"),
    (REPORT_OK.replace("rule 5710", "rule 5715"), "RULE_MISMATCH"),
    (REPORT_OK.replace(f" on {AGENT}", " on the lab host"), "AGENT_MISSING"),
    (REPORT_OK.replace(AGENT, "pod-bob-meta"), "AGENT_MISMATCH"),
])
def test_m3_failure_reasons(tmp_path, content, reason):
    check(tmp_path, 3, content, token="FAIL", reason=reason)


# ── Artifact selection ──────────────────────────────────────────────────────

@pytest.mark.parametrize("location", ["HOME_MSFADMIN", "HOME_STUDENT", "TMP"])
def test_each_supported_location_still_scores(tmp_path, location):
    _place(tmp_path / "root", 1, TRIAGE_OK, location)
    token, diag, _ = run(tmp_path, 1)
    assert token == "PASS"
    assert diag == {"reason": None, "location": location, "copies": 1}


def test_guide_path_wins_over_stale_tmp(tmp_path):
    root = tmp_path / "root"
    _place(root, 1, TRIAGE_OK, "HOME_MSFADMIN")
    _place(root, 1, "stale draft\n", "TMP")
    token, diag, _ = run(tmp_path, 1)
    assert token == "PASS"
    assert diag == {"reason": None, "location": "HOME_MSFADMIN", "copies": 2}


def test_stale_tmp_cannot_pass_for_an_edited_guide_file(tmp_path):
    # Old order checked /tmp first, so a passing leftover there masked the file
    # the student was told to edit. The guide path is now the one scored.
    root = tmp_path / "root"
    _place(root, 1, TRIAGE_OK.replace(AGENT, "pod-bob-meta"), "HOME_MSFADMIN")
    _place(root, 1, TRIAGE_OK, "TMP")
    token, diag, _ = run(tmp_path, 1)
    assert token == "FAIL"
    assert diag == {"reason": "AGENT_MISMATCH", "location": "HOME_MSFADMIN", "copies": 2}


def test_moving_the_file_changes_the_reported_location(tmp_path):
    root = tmp_path / "root"
    p = _place(root, 3, REPORT_OK, "TMP")
    assert run(tmp_path, 3)[1]["location"] == "TMP"
    p.unlink()
    _place(root, 3, REPORT_OK, "HOME_STUDENT")
    assert run(tmp_path, 3)[1] == {"reason": None, "location": "HOME_STUDENT", "copies": 1}


def test_missing_everywhere_reports_no_location(tmp_path):
    _, diag, _ = run(tmp_path, 2)
    assert diag == {"reason": "ARTIFACT_MISSING", "location": "NONE", "copies": 0}


def test_directory_named_like_the_artifact_is_missing(tmp_path):
    (tmp_path / "root" / "home" / "msfadmin" / FILES[1]).mkdir(parents=True)
    check(tmp_path, 1, None, token="FAIL", reason="ARTIFACT_MISSING")


@pytest.mark.skipif(os.name == "nt" or (hasattr(os, "geteuid") and os.geteuid() == 0),
                    reason="needs POSIX permissions and a non-root user")
def test_unreadable_artifact(tmp_path):
    p = _place(tmp_path / "root", 1, TRIAGE_OK)
    p.chmod(0)
    try:
        check(tmp_path, 1, None, token="FAIL", reason="ARTIFACT_UNREADABLE")
    finally:
        p.chmod(0o644)


# ── Contract and isolation ──────────────────────────────────────────────────

def test_diag_line_never_echoes_artifact_text(tmp_path):
    secret = "STUDENT-SECRET-TEXT-9f3a"
    _place(tmp_path / "root", 3, f"system {secret} " + "a" * 250 + "\n")
    _, _, lines = run(tmp_path, 3)
    assert all(secret not in ln and "/home" not in ln and "/tmp" not in ln for ln in lines)


@pytest.mark.parametrize("milestone", [1, 2, 3])
def test_reason_is_never_written_to_the_container_log(tmp_path, milestone):
    # The script runs on the student's meta VM, where the student has sudo; the
    # reason may only leave on stdout to the host-side, role-gated store.
    _place(tmp_path / "root", milestone, "rule: 5715 pod-bob-meta\n")
    _, diag, _ = run(tmp_path, milestone)
    assert diag is not None and diag["reason"] is not None
    log = tmp_path / "scoring.log"
    text = log.read_text(encoding="utf-8") if log.exists() else ""
    assert diag["reason"] not in text and "reason=" not in text and "DIAG" not in text


def test_every_reason_the_script_can_print_is_allowlisted():
    script = Path(SCRIPT).read_text(encoding="utf-8")
    emitted = set(re.findall(r"echo ([A-Z][A-Z_]+[A-Z])\b", script[script.index("_s9_m1_reason()"):script.index("check_scenario_9()")]))
    emitted.discard("NONE")
    assert emitted == scoring_diagnostics.REASON_CODES_BY_SCENARIO[9]


@pytest.mark.parametrize("scenario,milestone", [(1, 1), (6, 1), (11, 2)])
def test_other_scenarios_print_no_diag_line(tmp_path, scenario, milestone):
    token, diag, lines = run(tmp_path, milestone, scenario=scenario)
    assert token in ("PASS", "FAIL")
    assert diag is None and not any(ln.startswith("DIAG") for ln in lines)


def test_unknown_scenario_9_milestone_prints_nothing(tmp_path):
    token, diag, lines = run(tmp_path, 4)
    assert lines == [] and diag is None
