"""Scenario 2 (scorer id 6) diagnostics: the portal DVWA proxy posts a near-miss
code to /internal/browser-diagnostic. Classification is covered by the portal's
dvwaScoreSignals.test.ts; this file covers the endpoint, the switch, and how
browser and Kali-fallback results interact with the stored reason.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import scoring_diagnostics as sd
from provision_api_fastapi import app
from test_scenario3_diagnostics import INSTRUCTOR, _get, _pod, _rows, _verifier, _verify

SECRET = "test-secret"
DVWA_SIGNALS = Path(__file__).resolve().parents[2] / "portal" / "src" / "lib" / "dvwaScoreSignals.ts"


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    for name in ("SCORING_DIAGNOSTICS_SCENARIOS", "S3_DIAGNOSTICS_ENABLED", "SCORING_DIAGNOSTICS_RETENTION_DAYS"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("BROWSER_SCORE_SECRET", SECRET)


@pytest.fixture
def on(monkeypatch):
    monkeypatch.setenv("SCORING_DIAGNOSTICS_SCENARIOS", "6")


@pytest.fixture
def pod():
    return _pod(scenario_id="06")


def _post(path="/internal/browser-diagnostic", secret=SECRET, **over):
    body = {"student_id": "alice", "pod_id": 3, "scenario_id": 6, "milestone_id": 1, "reason": "PAYLOAD_NO_ROWS"}
    if path == "/internal/browser-score":
        body = {"student_id": "alice", "pod_id": 3, "scenario_id": 6, "milestone_id": 1, "label": "browser:sqli-m1"}
    body.update(over)
    headers = {"X-Browser-Score-Secret": secret} if secret is not None else {}
    return TestClient(app).post(path, json=body, headers=headers)


def _diag_rows():
    return _rows("scoring_diagnostics")


# ── Endpoint guards ─────────────────────────────────────────────────────────

@pytest.mark.parametrize("secret,status", [(None, 401), ("wrong", 401)])
def test_secret_is_required(on, pod, secret, status):
    assert _post(secret=secret).status_code == status
    assert _diag_rows() == []


def test_unset_secret_is_503(on, pod, monkeypatch):
    monkeypatch.delenv("BROWSER_SCORE_SECRET")
    assert _post().status_code == 503


@pytest.mark.parametrize("over", [
    {"reason": "RULE_MISSING"},          # a valid code, but another scenario's
    {"reason": "anything else"},
    {"scenario_id": 9},
    {"milestone_id": 5},                 # the flag milestone has no browser check
])
def test_only_scenario_6_codes_and_milestones(on, pod, over):
    assert _post(**over).status_code == 400
    assert _diag_rows() == []


@pytest.mark.parametrize("over,status", [
    ({"student_id": "bob"}, 403),
    ({"pod_id": 99}, 404),
])
def test_pod_must_be_the_students(on, pod, over, status):
    assert _post(**over).status_code == status
    assert _diag_rows() == []


@pytest.mark.parametrize("scenario_id,status", [("09", "ACTIVE"), ("06", "DESTROYED")])
def test_pod_must_be_an_active_scenario_2_lab(on, scenario_id, status):
    _pod(scenario_id=scenario_id)
    if status != "ACTIVE":
        from db import get_db_connection
        conn = get_db_connection()
        with conn:
            conn.execute("UPDATE pods SET status=? WHERE pod_id=3", (status,))
        conn.close()
    assert _post().status_code == 409
    assert _diag_rows() == []


# ── Switch ──────────────────────────────────────────────────────────────────

def test_off_by_default_stores_nothing(pod):
    r = _post()
    assert r.status_code == 200 and r.json() == {"recorded": False}
    assert _diag_rows() == []


def test_other_scenarios_switches_do_not_turn_on_6(pod, monkeypatch):
    monkeypatch.setenv("SCORING_DIAGNOSTICS_SCENARIOS", "1,9,11")
    monkeypatch.setenv("S3_DIAGNOSTICS_ENABLED", "1")
    assert _post().json() == {"recorded": False}
    assert _diag_rows() == []


@pytest.mark.anyio
async def test_6_alone_records_nothing_for_scenario_9(on):
    await _verify(_pod(), _verifier("FAIL", "RULE_MISSING"))
    assert _diag_rows() == []


# ── Recording ───────────────────────────────────────────────────────────────

def test_near_miss_is_recorded_with_only_the_code(on, pod):
    r = _post(milestone_id=3, reason="UNION_NO_HASH")
    assert r.status_code == 200 and r.json() == {"recorded": True}
    (row,) = _diag_rows()
    assert (row["scenario_id"], row["milestone_id"], row["status"]) == (6, 3, "FAIL")
    assert (row["reason_code"], row["location"], row["copies"]) == ("UNION_NO_HASH", "NONE", 0)
    assert row["pod_created_at"] == pod["created_at"]
    # Never a score: a near-miss writes no milestone_verification row.
    assert _rows("milestone_verification") == []


def test_repeated_near_misses_keep_one_row_with_the_latest_code(on, pod):
    _post(reason="PAYLOAD_NO_ROWS")
    _post(reason="SECURITY_NOT_LOW")
    (row,) = _diag_rows()
    assert (row["reason_code"], row["check_count"]) == ("SECURITY_NOT_LOW", 2)


def test_browser_pass_replaces_the_reason(on, pod):
    _post(reason="QUOTE_NO_ERROR")
    assert _post("/internal/browser-score").status_code == 200
    (row,) = _diag_rows()
    assert (row["status"], row["reason_code"]) == ("PASS", None)


def test_browser_pass_records_nothing_when_off(pod):
    assert _post("/internal/browser-score").status_code == 200
    assert _diag_rows() == []
    assert len(_rows("milestone_verification")) == 1


def test_near_miss_after_a_pass_keeps_the_pass(on, pod):
    _post("/internal/browser-score")
    assert _post(reason="PAYLOAD_NO_ROWS").json() == {"recorded": False}
    (row,) = _diag_rows()
    assert (row["status"], row["reason_code"]) == ("PASS", None)


def test_near_miss_racing_a_pass_keeps_the_pass(on, pod, monkeypatch):
    # The proxy doesn't await the near-miss POST, so a pass can be recorded
    # between the endpoint's "already passed?" read and its write.
    import pods_router

    real = pods_router._milestone_passed_on_pod

    def pass_lands_in_between(conn, pod_row, milestone_id):
        passed = real(conn, pod_row, milestone_id)
        assert _post("/internal/browser-score").status_code == 200
        return passed

    monkeypatch.setattr(pods_router, "_milestone_passed_on_pod", pass_lands_in_between)
    _post(reason="QUOTE_NO_ERROR")
    (row,) = _diag_rows()
    assert (row["status"], row["reason_code"]) == ("PASS", None)


def test_each_milestone_has_its_own_row(on, pod):
    _post(milestone_id=1, reason="QUOTE_NO_ERROR")
    _post(milestone_id=4, reason="XSS_NOT_REFLECTED")
    assert sorted((r["milestone_id"], r["reason_code"]) for r in _diag_rows()) == [
        (1, "QUOTE_NO_ERROR"), (4, "XSS_NOT_REFLECTED")]


# ── Kali fallback (verify_milestone / poller) ───────────────────────────────

@pytest.mark.anyio
async def test_kali_fallback_fail_does_not_overwrite_the_proxy_reason(on, pod):
    _post(milestone_id=2, reason="UNION_NO_METADATA")
    res = await _verify(pod, _verifier("FAIL", None, location="NONE", copies=0), scenario_id=6, milestone_id=2)
    assert res.status == "FAIL"
    (row,) = _diag_rows()
    assert (row["reason_code"], row["check_count"]) == ("UNION_NO_METADATA", 1)


@pytest.mark.anyio
async def test_kali_fallback_fail_alone_stores_no_check_error(on, pod):
    await _verify(pod, _verifier("FAIL", None, location="NONE", copies=0), scenario_id=6, milestone_id=1)
    assert _diag_rows() == []


@pytest.mark.anyio
async def test_kali_fallback_pass_clears_the_reason(on, pod):
    _post(milestone_id=2, reason="UNION_NO_METADATA")
    await _verify(pod, _verifier("PASS", None, location="NONE", copies=0), scenario_id=6, milestone_id=2)
    (row,) = _diag_rows()
    assert (row["status"], row["reason_code"]) == ("PASS", None)
    assert _post(milestone_id=2, reason="UNION_NO_METADATA").json() == {"recorded": False}


# ── Instructor read ─────────────────────────────────────────────────────────

def test_instructor_sees_scenario_2_reason(on, pod):
    _post(milestone_id=4, reason="XSS_NOT_REFLECTED")
    body = _get(INSTRUCTOR, "/instructor/students/alice/diagnostics").json()
    assert body["enabled_scenarios"] == [6]
    assert [(d["scenario_id"], d["reason_code"]) for d in body["diagnostics"]] == [(6, "XSS_NOT_REFLECTED")]


# ── Portal and API agree on the codes ───────────────────────────────────────

def test_portal_near_miss_codes_match_the_allowlist():
    src = DVWA_SIGNALS.read_text(encoding="utf-8")
    union = re.search(r"export type NearMissReason =(.*?)\n\n", src, re.S)
    assert union, "NearMissReason union not found in dvwaScoreSignals.ts"
    portal = set(re.findall(r"'([A-Z_]+)'", union.group(1)))
    assert portal == sd.REASON_CODES_BY_SCENARIO[6] - {"CHECK_ERROR"}


def test_scenario_2_is_a_browser_scenario():
    assert sd.BROWSER_SCENARIO_IDS <= sd.DIAGNOSTIC_SCENARIO_IDS
    assert 6 in sd.BROWSER_SCENARIO_IDS
