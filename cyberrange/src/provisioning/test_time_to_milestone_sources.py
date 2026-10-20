"""PAPER-16 / D.5: time-to-milestone for every scoring path.

Browser (Scenario 2) and flag PASSes used to be written without pod_created_at,
and the export's pods-table fallback loses the lab start once the slot's pods
row is replaced. These tests pin the write side and the lab_sessions fallback.
"""
from __future__ import annotations

import pytest

import db
from knowledge_gain import (
    extract_knowledge_gain_records,
    format_records_csv,
    format_utc,
)
from scoring import pod_created_at_for, record_browser_milestone

START = "2026-10-15 01:00:00"


def _pod(student_id: str, pod_id: int, scenario_id: str, created_at: str = START,
         status: str = "ACTIVE") -> dict:
    conn = db.get_db_connection()
    with conn:
        conn.execute(
            "INSERT INTO pods (student_id, pod_id, status, scenario_id, created_at) "
            "VALUES (?,?,?,?,?)",
            (student_id, pod_id, status, scenario_id, created_at),
        )
    row = dict(conn.execute("SELECT * FROM pods WHERE pod_id=?", (pod_id,)).fetchone())
    conn.close()
    return row


def _pass_row(student_id: str, scenario_id: int, milestone_id: int) -> dict:
    conn = db.get_db_connection()
    row = conn.execute(
        "SELECT pod_created_at, detection_data FROM milestone_verification "
        "WHERE student_id=? AND scenario_id=? AND milestone_id=? AND status='PASS'",
        (student_id, scenario_id, milestone_id),
    ).fetchone()
    conn.close()
    return dict(row)


def _mv(student_id, pod_id, scenario_id, milestone_id, verified_at, *, pod_created_at=None,
        detection_data="browser:sqli-m1", status="PASS"):
    conn = db.get_db_connection()
    with conn:
        conn.execute(
            "INSERT INTO milestone_verification (student_id, pod_id, scenario_id, milestone_id, "
            "status, verified_at, detection_score, detection_data, pod_created_at) "
            "VALUES (?,?,?,?,?,?,0,?,?)",
            (student_id, pod_id, scenario_id, milestone_id, status, verified_at,
             detection_data, pod_created_at),
        )
    conn.close()


def _session(student_id, pod_id, scenario_id, started_at, ended_at):
    conn = db.get_db_connection()
    with conn:
        conn.execute(
            "INSERT INTO lab_sessions (pod_id, student_id, scenario_id, started_at, ended_at) "
            "VALUES (?,?,?,?,?)",
            (pod_id, student_id, scenario_id, started_at, ended_at),
        )
    conn.close()


def _records(**kw):
    conn = db.get_db_connection()
    try:
        return extract_knowledge_gain_records(conn, **kw)
    finally:
        conn.close()


# --- write side ------------------------------------------------------------

def test_browser_pass_records_pod_created_at():
    pod = _pod("ttm_browser", 21, "06")
    conn = db.get_db_connection()
    with conn:
        record_browser_milestone(conn, pod, 1, "browser:sqli-m1")
    conn.close()
    assert _pass_row("ttm_browser", 6, 1)["pod_created_at"] == START


@pytest.mark.anyio
async def test_pure_flag_pass_records_pod_created_at(monkeypatch):
    monkeypatch.setenv("COHORT_FLAG_SECRET", "test-cohort-secret-ttm")
    from flag_planting import generate_milestone_flag, save_pod_flags
    from hybrid_scoring import evaluate_hybrid_submission

    _pod("ttm_flag", 22, "01")
    conn = db.get_db_connection()
    flag = generate_milestone_flag("ttm_flag", 1, 5)
    save_pod_flags(conn, 22, "ttm_flag", 1, {5: flag})
    result = await evaluate_hybrid_submission(conn, "ttm_flag", 1, 5, flag)
    conn.close()
    assert result.status == "PASS"
    assert _pass_row("ttm_flag", 1, 5)["pod_created_at"] == START


@pytest.mark.anyio
async def test_corroborated_flag_pass_records_pod_created_at(monkeypatch):
    monkeypatch.setenv("COHORT_FLAG_SECRET", "test-cohort-secret-ttm2")
    from flag_planting import generate_milestone_flag, save_pod_flags
    from hybrid_scoring import evaluate_hybrid_submission
    import hybrid_scoring

    pod = _pod("ttm_flag2", 23, "01")
    conn = db.get_db_connection()
    flag = generate_milestone_flag("ttm_flag2", 1, 1)
    save_pod_flags(conn, 23, "ttm_flag2", 1, {1: flag})

    async def fake_state(*a, **k):
        return True, 23

    monkeypatch.setattr(hybrid_scoring, "_check_container_state", fake_state)
    result = await evaluate_hybrid_submission(conn, "ttm_flag2", 1, 1, flag, active_pod=pod)
    conn.close()
    assert result.status == "PASS"
    assert _pass_row("ttm_flag2", 1, 1)["pod_created_at"] == START


def test_pod_created_at_for_ignores_other_occupant():
    _pod("occupant", 24, "01")
    conn = db.get_db_connection()
    assert pod_created_at_for(conn, 24, "occupant") == START
    assert pod_created_at_for(conn, 24, "someone_else") is None
    assert pod_created_at_for(conn, 0, "occupant") is None
    conn.close()


@pytest.mark.anyio
async def test_flag_after_lab_ended_is_not_timed(monkeypatch):
    """A DESTROYED pod is not a running lab: no start, and the PASS stores NULL."""
    monkeypatch.setenv("COHORT_FLAG_SECRET", "test-cohort-secret-ttm3")
    from flag_planting import generate_milestone_flag, save_pod_flags
    from hybrid_scoring import evaluate_hybrid_submission

    _pod("ttm_ended", 25, "01", status="DESTROYED")
    conn = db.get_db_connection()
    assert pod_created_at_for(conn, 25, "ttm_ended") is None
    flag = generate_milestone_flag("ttm_ended", 1, 5)
    save_pod_flags(conn, 25, "ttm_ended", 1, {5: flag})
    result = await evaluate_hybrid_submission(conn, "ttm_ended", 1, 5, flag)
    conn.close()
    assert result.status == "PASS"
    assert _pass_row("ttm_ended", 1, 5)["pod_created_at"] is None


# --- export side -----------------------------------------------------------

def test_lab_sessions_recover_time_after_slot_reuse():
    """No pod_created_at on the row and the slot now holds another student's lab."""
    _mv("ttm_old", 5, 6, 1, "2026-10-15 01:12:30")
    _session("ttm_old", 5, "06", START, "2026-10-15 01:45:00")
    _pod("next_student", 5, "09", created_at="2026-10-15 02:00:00")

    rec = [r for r in _records() if r["student_id"] == "ttm_old"]
    assert len(rec) == 1
    assert rec[0]["time_to_milestone_seconds"] == 750.0


def test_lab_sessions_pick_the_window_containing_the_pass():
    _session("ttm_two", 6, "06", "2026-10-15 01:00:00", "2026-10-15 01:30:00")
    _session("ttm_two", 6, "06", "2026-10-16 03:00:00", None)
    _mv("ttm_two", 6, 6, 2, "2026-10-16 03:05:00")

    rec = [r for r in _records() if r["student_id"] == "ttm_two"]
    assert rec[0]["time_to_milestone_seconds"] == 300.0


def test_pass_outside_every_session_stays_untimed():
    _session("ttm_gap", 7, "06", "2026-10-15 01:00:00", "2026-10-15 01:30:00")
    # A leftover pods row on the same slot must not re-time it via the fallbacks.
    _pod("ttm_gap", 7, "06", created_at="2026-10-15 01:00:00", status="DESTROYED")
    _mv("ttm_gap", 7, 6, 1, "2026-10-15 02:00:00")

    rec = [r for r in _records() if r["student_id"] == "ttm_gap"]
    assert rec[0]["time_to_milestone_seconds"] is None


def test_instructor_approved_pass_has_no_time():
    """Approval time is the instructor's, not the student's (D.5 measures the student)."""
    _mv("ttm_review", 8, 1, 3, "2026-10-15 03:00:00", pod_created_at=START,
        detection_data="instructor_approved_review")

    rec = [r for r in _records() if r["student_id"] == "ttm_review"]
    assert rec[0]["status"] == "PASS"
    assert rec[0]["time_to_milestone_seconds"] is None


def test_scenario_number_and_utc_timestamp_in_records_and_csv():
    _mv("ttm_label", 9, 11, 1, "2026-10-15 01:02:03", pod_created_at=START,
        detection_data="state")

    rec = [r for r in _records() if r["student_id"] == "ttm_label"][0]
    assert rec["scenario_id"] == 11
    assert rec["scenario_number"] == 4
    assert rec["verified_at"] == "2026-10-15T01:02:03Z"

    header = format_records_csv([rec]).splitlines()[0]
    assert header.startswith("student_id,scenario_id,milestone_id,status,verified_at")
    assert header.endswith(",scenario_rubric_score,scenario_number")


def test_format_utc():
    assert format_utc("2026-10-15 01:02:03") == "2026-10-15T01:02:03Z"
    assert format_utc("2026-10-15T09:02:03+08:00") == "2026-10-15T01:02:03Z"
    assert format_utc("not a time") == "not a time"
    assert format_utc(None) == ""
