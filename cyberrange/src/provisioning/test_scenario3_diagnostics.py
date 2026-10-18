"""Scenario 3 (scorer id 9) diagnostics: persistence, retention, scoring
isolation and instructor-only access. Script-level reason codes are covered in
test_scenario3_diagnostics_checks.py; this file uses fake verifiers.
"""
from __future__ import annotations

import sqlite3

import pytest
from fastapi.testclient import TestClient

import migrate
import scoring_diagnostics as sd
from auth import verify_token
from db import get_db_connection
from provision_api_fastapi import app
from scoring import verify_milestone


def _claims(username, *roles):
    return {"preferred_username": username, "realm_access": {"roles": list(roles)}}


STUDENT = _claims("alice", "student")
OTHER_STUDENT = _claims("bob", "student")
INSTRUCTOR = _claims("teach", "instructor")
ADMIN = _claims("root_admin", "admin")


class FakeVerifier:
    """Detailed verifier returning a fixed (status, message, diag)."""
    result = ("FAIL", "Check completed: FAIL", {"reason": "AGENT_MISMATCH", "location": "HOME_MSFADMIN", "copies": 1})

    async def verify_milestone(self, student_id, scenario_id, milestone_id):
        status, message, _ = self.result
        return status, message

    async def verify_milestone_detailed(self, student_id, scenario_id, milestone_id):
        return self.result


def _verifier(status, reason=None, location="HOME_MSFADMIN", copies=1, message=None):
    diag = None if status == "ERROR" else {"reason": reason, "location": location, "copies": copies}
    return type("V", (FakeVerifier,), {"result": (status, message or f"Check completed: {status}", diag)})


class PlainVerifier:
    """Old-style verifier with no detailed method (e.g. other test doubles)."""
    async def verify_milestone(self, student_id, scenario_id, milestone_id):
        return "FAIL", "Check completed: FAIL"


@pytest.fixture
def enabled(monkeypatch):
    monkeypatch.setenv("S3_DIAGNOSTICS_ENABLED", "1")


def _pod(student_id="alice", pod_id=3, scenario_id="09", created_at="2026-10-01 14:00:00"):
    conn = get_db_connection()
    with conn:
        conn.execute("DELETE FROM pods WHERE pod_id=?", (pod_id,))
        conn.execute(
            "INSERT INTO pods (student_id, pod_id, status, scenario_id, created_at) VALUES (?,?,?,?,?)",
            (student_id, pod_id, "ACTIVE", scenario_id, created_at),
        )
        conn.execute(
            "UPDATE lab_sessions SET ended_at=CURRENT_TIMESTAMP WHERE pod_id=? AND ended_at IS NULL", (pod_id,)
        )
        conn.execute(
            "INSERT INTO lab_sessions (pod_id, student_id, scenario_id, started_at) VALUES (?,?,?,?)",
            (pod_id, student_id, scenario_id, created_at),
        )
    pod = dict(conn.execute("SELECT * FROM pods WHERE pod_id=?", (pod_id,)).fetchone())
    conn.close()
    return pod


async def _verify(pod, verifier, scenario_id=9, milestone_id=1):
    return await verify_milestone(
        pod, scenario_id, milestone_id,
        scoring_enabled=True, ssh_verifier_cls=verifier,
        detection_enabled=False, detection_for=None, verify_siem_alert=None,
    )


def _rows(table, **where):
    conn = get_db_connection()
    clause = " AND ".join(f"{k}=?" for k in where) or "1=1"
    rows = [dict(r) for r in conn.execute(f"SELECT * FROM {table} WHERE {clause} ORDER BY id", tuple(where.values()))]
    conn.close()
    return rows


def _get(claims, path):
    app.dependency_overrides[verify_token] = lambda: claims
    return TestClient(app).get(path)


# ── parse_diag allowlist ────────────────────────────────────────────────────

def test_parse_diag_reads_the_last_diag_line():
    out = "noise\nDIAG reason=RULE_MISSING location=TMP copies=2\nFAIL\n"
    assert sd.parse_diag(out) == {"reason": "RULE_MISSING", "location": "TMP", "copies": 2}
    assert sd.parse_diag("DIAG reason=NONE location=HOME_STUDENT copies=1\nPASS") == {
        "reason": None, "location": "HOME_STUDENT", "copies": 1}


@pytest.mark.parametrize("line", [
    "DIAG reason=Agent pod-alice-meta location=TMP copies=1",   # free text
    "DIAG reason=RULE_MISSING location=/home/msfadmin copies=1",  # a path
    "DIAG reason=RULE_MISSING location=TMP copies=99",
    "DIAG reason=RULE_MISSING location=TMP copies=1 extra=stuff",
    "PASS",
])
def test_parse_diag_rejects_anything_off_format(line):
    assert sd.parse_diag(line + "\nFAIL") is None


def test_parse_diag_unknown_codes_are_coerced():
    assert sd.parse_diag("DIAG reason=SOMETHING_NEW location=ELSEWHERE copies=1") == {
        "reason": "CHECK_ERROR", "location": "NONE", "copies": 1}


# ── Feature switch and scoring isolation ────────────────────────────────────

@pytest.mark.anyio
async def test_disabled_by_default_records_nothing(monkeypatch):
    monkeypatch.delenv("S3_DIAGNOSTICS_ENABLED", raising=False)
    res = await _verify(_pod(), _verifier("FAIL", "AGENT_MISMATCH"))
    assert res.status == "FAIL"
    assert _rows("scoring_diagnostics") == []


@pytest.mark.anyio
async def test_fail_records_reason_but_response_stays_generic(enabled):
    res = await _verify(_pod(), _verifier("FAIL", "AGENT_MISMATCH"))
    assert res.status == "FAIL"
    assert res.message == "Check completed: FAIL"
    assert "AGENT" not in res.model_dump_json()
    (row,) = _rows("scoring_diagnostics")
    assert (row["student_id"], row["pod_id"], row["scenario_id"], row["milestone_id"]) == ("alice", 3, 9, 1)
    assert (row["status"], row["reason_code"], row["location"], row["copies"]) == ("FAIL", "AGENT_MISMATCH", "HOME_MSFADMIN", 1)
    assert row["pod_created_at"] == "2026-10-01 14:00:00"
    assert row["lab_session_id"] == _rows("lab_sessions", pod_id=3)[-1]["id"]
    # The score row is exactly what it was before diagnostics existed.
    (mv,) = _rows("milestone_verification", student_id="alice")
    assert (mv["status"], mv["detection_score"], mv["detection_data"]) == ("FAIL", 0, None)


@pytest.mark.anyio
async def test_repeated_polls_stay_one_row_and_pass_replaces(enabled):
    pod = _pod()
    for reason in ("ARTIFACT_MISSING", "RULE_MISSING", "RULE_MISSING", "TIMESTAMP_NOT_MATCHED"):
        await _verify(pod, _verifier("FAIL", reason))
    (row,) = _rows("scoring_diagnostics")
    assert row["reason_code"] == "TIMESTAMP_NOT_MATCHED" and row["check_count"] == 4
    await _verify(pod, _verifier("PASS"))
    (row,) = _rows("scoring_diagnostics")
    assert (row["status"], row["reason_code"], row["check_count"]) == ("PASS", None, 5)
    # Score history is untouched: every poll still has its own verification row.
    assert [r["status"] for r in _rows("milestone_verification")] == ["FAIL"] * 4 + ["PASS"]


@pytest.mark.anyio
async def test_each_milestone_has_its_own_row(enabled):
    pod = _pod()
    for m in (1, 2, 3):
        await _verify(pod, _verifier("FAIL", "ARTIFACT_MISSING"), milestone_id=m)
        await _verify(pod, _verifier("FAIL", "ARTIFACT_MISSING"), milestone_id=m)
    assert sorted(r["milestone_id"] for r in _rows("scoring_diagnostics")) == [1, 2, 3]


@pytest.mark.anyio
async def test_verifier_error_is_check_error_without_its_text(enabled):
    v = _verifier("ERROR", message="lxc exec pod-alice-meta failed (rc=1): secret stderr")
    res = await _verify(_pod(), v)
    assert res.status == "ERROR"
    (row,) = _rows("scoring_diagnostics")
    assert (row["status"], row["reason_code"], row["location"]) == ("ERROR", "CHECK_ERROR", None)
    assert "secret" not in str(row)


@pytest.mark.anyio
async def test_verifier_without_detailed_method_still_scores(enabled):
    res = await _verify(_pod(), PlainVerifier)
    assert res.status == "FAIL"
    (row,) = _rows("scoring_diagnostics")
    assert row["reason_code"] == "CHECK_ERROR"


@pytest.mark.anyio
@pytest.mark.parametrize("scenario_id", [1, 6, 11])
async def test_other_scenarios_record_nothing(enabled, scenario_id):
    pod = _pod(scenario_id=f"{scenario_id:02d}")
    res = await _verify(pod, _verifier("FAIL", "RULE_MISSING"), scenario_id=scenario_id)
    assert res.status == "FAIL"
    assert _rows("scoring_diagnostics") == []
    assert len(_rows("milestone_verification")) == 1


@pytest.mark.anyio
async def test_missing_table_never_breaks_scoring(enabled):
    conn = get_db_connection()
    with conn:
        conn.execute("DROP TABLE scoring_diagnostics")
    conn.close()
    res = await _verify(_pod(), _verifier("FAIL", "RULE_MISSING"))
    assert res.status == "FAIL"
    assert len(_rows("milestone_verification")) == 1


# ── Lab-session association and pod-slot reuse ──────────────────────────────

@pytest.mark.anyio
async def test_reused_pod_slot_keeps_students_and_labs_apart(enabled):
    await _verify(_pod("alice", 3, created_at="2026-10-01 09:00:00"), _verifier("FAIL", "RULE_MISSING"))
    # Same slot, next student.
    await _verify(_pod("bob", 3, created_at="2026-10-01 11:00:00"), _verifier("FAIL", "AGENT_MISSING"))
    # Same slot, alice again in a new lab.
    await _verify(_pod("alice", 3, created_at="2026-10-01 13:00:00"), _verifier("FAIL", "TIMESTAMP_MISSING"))
    rows = _rows("scoring_diagnostics")
    assert [(r["student_id"], r["pod_created_at"], r["reason_code"]) for r in rows] == [
        ("alice", "2026-10-01 09:00:00", "RULE_MISSING"),
        ("bob", "2026-10-01 11:00:00", "AGENT_MISSING"),
        ("alice", "2026-10-01 13:00:00", "TIMESTAMP_MISSING"),
    ]
    assert len({r["lab_session_id"] for r in rows}) == 3


# ── Retention ───────────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_purge_removes_only_expired_rows(enabled):
    await _verify(_pod("alice", 3), _verifier("FAIL", "RULE_MISSING"))
    await _verify(_pod("bob", 4), _verifier("FAIL", "RULE_MISSING"))
    conn = get_db_connection()
    with conn:
        conn.execute("UPDATE scoring_diagnostics SET last_seen_at=datetime('now','-15 days') WHERE student_id='alice'")
        assert sd.purge_expired(conn) == 1
    conn.close()
    assert [r["student_id"] for r in _rows("scoring_diagnostics")] == ["bob"]
    assert len(_rows("milestone_verification")) == 2


@pytest.mark.parametrize("raw,days", [(None, 14), ("7", 7), ("0", 14), ("junk", 14)])
def test_retention_days(monkeypatch, raw, days):
    if raw is None:
        monkeypatch.delenv("S3_DIAGNOSTICS_RETENTION_DAYS", raising=False)
    else:
        monkeypatch.setenv("S3_DIAGNOSTICS_RETENTION_DAYS", raw)
    assert sd.retention_days() == days


@pytest.mark.anyio
async def test_poller_purges_even_when_disabled(monkeypatch, enabled):
    import score_poller

    await _verify(_pod(), _verifier("FAIL", "RULE_MISSING"))
    conn = get_db_connection()
    with conn:
        conn.execute("UPDATE scoring_diagnostics SET last_seen_at=datetime('now','-30 days')")
    conn.close()
    monkeypatch.delenv("S3_DIAGNOSTICS_ENABLED")
    monkeypatch.setattr(score_poller, "_last_diagnostics_purge", 0.0)
    monkeypatch.setattr(score_poller.scoring_state, "SCORING_ENABLED", False)
    await score_poller.score_poll_once()
    assert _rows("scoring_diagnostics") == []


# ── Instructor-only API ─────────────────────────────────────────────────────

async def _seed_two_students():
    await _verify(_pod("alice", 3, created_at="2026-10-01 09:00:00"), _verifier("FAIL", "AGENT_MISMATCH"))
    await _verify(_pod("alice", 3, created_at="2026-10-01 13:00:00"), _verifier("FAIL", "RULE_MISSING"), milestone_id=2)
    await _verify(_pod("bob", 4), _verifier("FAIL", "TIMESTAMP_MISSING"))


@pytest.mark.anyio
@pytest.mark.parametrize("claims", [INSTRUCTOR, ADMIN])
async def test_staff_read_one_students_reasons(enabled, claims):
    await _seed_two_students()
    r = _get(claims, "/instructor/students/alice/diagnostics")
    assert r.status_code == 200
    body = r.json()
    assert body["enabled"] is True and body["retention_days"] == 14
    assert {d["reason_code"] for d in body["diagnostics"]} == {"AGENT_MISMATCH", "RULE_MISSING"}
    assert all("student_id" not in d for d in body["diagnostics"])  # scoped by path


@pytest.mark.anyio
async def test_staff_can_narrow_to_one_lab(enabled):
    await _seed_two_students()
    r = _get(INSTRUCTOR, "/instructor/students/alice/diagnostics?pod_id=3&pod_created_at=2026-10-01%2009:00:00")
    assert [d["reason_code"] for d in r.json()["diagnostics"]] == ["AGENT_MISMATCH"]


@pytest.mark.anyio
@pytest.mark.parametrize("claims,path", [
    (STUDENT, "/instructor/students/alice/diagnostics"),       # own record
    (OTHER_STUDENT, "/instructor/students/alice/diagnostics"),  # someone else's
    (_claims("norole"), "/instructor/students/alice/diagnostics"),
])
async def test_non_staff_are_refused(enabled, claims, path):
    await _seed_two_students()
    r = _get(claims, path)
    assert r.status_code == 403
    assert "AGENT_MISMATCH" not in r.text


@pytest.mark.anyio
async def test_student_progress_routes_stay_generic(enabled):
    await _seed_two_students()
    for path in ("/progress", "/pods/3/milestones"):
        r = _get(STUDENT, path)
        assert r.status_code == 200, (path, r.text)
        for code in sd.REASON_CODES:
            assert code not in r.text


@pytest.mark.anyio
async def test_read_side_reallowlists_stored_values(enabled):
    await _verify(_pod(), _verifier("FAIL", "RULE_MISSING"))
    conn = get_db_connection()
    with conn:
        conn.execute("UPDATE scoring_diagnostics SET reason_code='<script>x</script>', location='/etc/passwd'")
    conn.close()
    (d,) = _get(INSTRUCTOR, "/instructor/students/alice/diagnostics").json()["diagnostics"]
    assert (d["reason_code"], d["location"]) == ("CHECK_ERROR", None)


def test_unknown_student_is_an_empty_list():
    r = _get(INSTRUCTOR, "/instructor/students/nobody/diagnostics")
    assert r.status_code == 200 and r.json()["diagnostics"] == []


# ── Migration safety ────────────────────────────────────────────────────────

def test_v14_on_a_v13_database_keeps_scores(tmp_path, monkeypatch):
    path = str(tmp_path / "pod_mgmt.db")
    real = migrate._migration_files
    monkeypatch.setattr(migrate, "_migration_files", lambda: [f for f in real() if f[0] <= 13])
    assert migrate.apply(path) == 13
    conn = sqlite3.connect(path)
    with conn:
        conn.execute(
            "INSERT INTO milestone_verification (pod_id, student_id, scenario_id, milestone_id, status, detection_score) "
            "VALUES (3, 'alice', 9, 1, 'PASS', 1)"
        )
    conn.close()

    monkeypatch.setattr(migrate, "_migration_files", real)
    assert migrate.apply(path) == 14
    conn = sqlite3.connect(path)
    assert conn.execute("SELECT student_id, status, detection_score FROM milestone_verification").fetchall() == [
        ("alice", "PASS", 1)]
    assert conn.execute("SELECT COUNT(*) FROM scoring_diagnostics").fetchone() == (0,)
    conn.close()

    # Rollback: older code (latest = v13) re-applies cleanly over a v14 DB.
    monkeypatch.setattr(migrate, "_migration_files", lambda: [f for f in real() if f[0] <= 13])
    assert migrate.apply(path) == 14
    conn = sqlite3.connect(path)
    assert conn.execute("SELECT COUNT(*) FROM milestone_verification").fetchone() == (1,)
    conn.close()
