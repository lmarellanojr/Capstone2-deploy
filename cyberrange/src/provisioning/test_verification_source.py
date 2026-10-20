"""#266: milestone_verification.source tagging and instructor API exposure."""
from __future__ import annotations

import sqlite3

import pytest
from fastapi.testclient import TestClient

import db
from auth import verify_token
from models import VerificationResponse
from provision_api_fastapi import app
from scoring import (
    SOURCE_AUTO,
    SOURCE_BROWSER,
    SOURCE_FLAG,
    SOURCE_MANUAL,
    SOURCE_REVIEW,
    insert_verification_row,
    record_browser_milestone,
    validate_source,
    verify_milestone,
)


def _instructor_claims(username: str = "instructor1") -> dict:
    return {
        "preferred_username": username,
        "realm_access": {"roles": ["instructor"]},
    }


def _student_claims(username: str = "student1") -> dict:
    return {
        "preferred_username": username,
        "realm_access": {"roles": ["student"]},
    }


class _PassVerifier:
    async def verify_milestone(self, student_id, scenario_id, milestone_id):
        return "PASS", "ok"


class _FailVerifier:
    async def verify_milestone(self, student_id, scenario_id, milestone_id):
        return "FAIL", "not yet"


def _make_pod(student_id="student1", pod_id=1, scenario_id="01"):
    conn = db.get_db_connection()
    with conn:
        conn.execute(
            "INSERT INTO pods (student_id, pod_id, status, scenario_id) VALUES (?,?,?,?)",
            (student_id, pod_id, "ACTIVE", scenario_id),
        )
    conn.close()
    return {
        "pod_id": pod_id,
        "student_id": student_id,
        "status": "ACTIVE",
        "scenario_id": scenario_id,
        "wazuh_agent_id": None,
        "created_at": None,
    }


def _source_for(student_id: str, scenario_id: int, milestone_id: int) -> str | None:
    conn = db.get_db_connection()
    row = conn.execute(
        "SELECT source FROM milestone_verification "
        "WHERE student_id=? AND scenario_id=? AND milestone_id=? "
        "ORDER BY id DESC LIMIT 1",
        (student_id, scenario_id, milestone_id),
    ).fetchone()
    conn.close()
    return None if row is None else row["source"]


def test_validate_source_allowlist():
    assert validate_source(None) is None
    assert validate_source(SOURCE_AUTO) == SOURCE_AUTO
    with pytest.raises(ValueError):
        validate_source("AUTO")
    with pytest.raises(ValueError):
        validate_source("")


@pytest.mark.anyio
async def test_verify_milestone_writes_auto_source():
    pod = _make_pod(student_id="src_auto", pod_id=11)
    await verify_milestone(
        pod=pod,
        scenario_id=1,
        milestone_id=1,
        scoring_enabled=True,
        ssh_verifier_cls=_FailVerifier,
        detection_enabled=False,
        detection_for=None,
        verify_siem_alert=None,
        source=SOURCE_AUTO,
    )
    assert _source_for("src_auto", 1, 1) == "auto"


@pytest.mark.anyio
async def test_verify_milestone_rejects_invalid_source():
    pod = _make_pod(student_id="src_bad", pod_id=12)
    with pytest.raises(Exception):
        await verify_milestone(
            pod=pod,
            scenario_id=1,
            milestone_id=1,
            scoring_enabled=True,
            ssh_verifier_cls=_PassVerifier,
            detection_enabled=False,
            detection_for=None,
            verify_siem_alert=None,
            source="AUTO",
        )


def test_manual_check_route_passes_source_manual(monkeypatch):
    _make_pod(student_id="src_manual", pod_id=13)
    captured = {}

    async def fake(pod, scenario_id, milestone_id, **kw):
        captured["source"] = kw.get("source")
        return VerificationResponse(
            status="FAIL",
            message="stub",
            pod_id=pod["pod_id"],
            scenario_id=scenario_id,
            milestone_id=milestone_id,
            detection_score=0,
            verified_at="2026-10-20T00:00:00+00:00",
        )

    import pods_router

    monkeypatch.setattr(pods_router, "verify_milestone", fake)
    app.dependency_overrides[verify_token] = lambda: _student_claims("src_manual")
    client = TestClient(app)
    res = client.post("/pods/13/verify/1/2")
    assert res.status_code == 200
    assert captured["source"] == SOURCE_MANUAL


def test_record_browser_milestone_source_and_idempotency():
    pod = _make_pod(student_id="src_browser", pod_id=14, scenario_id="06")
    conn = db.get_db_connection()
    with conn:
        record_browser_milestone(conn, pod, 1, "browser:sqli-m1")
        record_browser_milestone(conn, pod, 1, "browser:sqli-m1")
    rows = conn.execute(
        "SELECT source, status FROM milestone_verification "
        "WHERE student_id='src_browser' AND scenario_id=6 AND milestone_id=1"
    ).fetchall()
    conn.close()
    assert len(rows) == 1
    assert rows[0]["status"] == "PASS"
    assert rows[0]["source"] == SOURCE_BROWSER


def test_record_browser_milestone_without_source_column():
    """Pre-v15 table: insert still succeeds and stays idempotent."""
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute(
        """
        CREATE TABLE milestone_verification (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pod_id INTEGER,
            student_id TEXT,
            scenario_id INTEGER,
            milestone_id INTEGER,
            status TEXT,
            detection_score INTEGER,
            detection_data TEXT
        )
        """
    )
    pod = {
        "pod_id": 1,
        "student_id": "legacy",
        "scenario_id": "06",
    }
    record_browser_milestone(conn, pod, 2, "browser:sqli-m2")
    record_browser_milestone(conn, pod, 2, "browser:sqli-m2")
    n = conn.execute(
        "SELECT COUNT(*) FROM milestone_verification WHERE student_id='legacy'"
    ).fetchone()[0]
    cols = {r[1] for r in conn.execute("PRAGMA table_info(milestone_verification)")}
    conn.close()
    assert n == 1
    assert "source" not in cols


def test_insert_helper_omits_source_when_absent():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute(
        """
        CREATE TABLE milestone_verification (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pod_id INTEGER,
            student_id TEXT,
            scenario_id INTEGER,
            milestone_id INTEGER,
            status TEXT,
            detection_score INTEGER,
            detection_data TEXT
        )
        """
    )
    insert_verification_row(
        conn,
        pod_id=1,
        student_id="x",
        scenario_id=1,
        milestone_id=1,
        status="PASS",
        source=SOURCE_FLAG,
    )
    row = conn.execute("SELECT * FROM milestone_verification").fetchone()
    conn.close()
    assert row["status"] == "PASS"
    assert "source" not in row.keys()


@pytest.mark.anyio
async def test_hybrid_pure_flag_writes_source_flag(monkeypatch):
    monkeypatch.setenv("COHORT_FLAG_SECRET", "test-cohort-secret-source")
    from flag_planting import generate_milestone_flag, save_pod_flags
    from hybrid_scoring import evaluate_hybrid_submission

    student = "src_flag"
    _make_pod(student_id=student, pod_id=15, scenario_id="01")
    conn = db.get_db_connection()
    flag = generate_milestone_flag(student, 1, 5)
    save_pod_flags(conn, 15, student, 1, {5: flag})
    result = await evaluate_hybrid_submission(conn, student, 1, 5, flag)
    assert result.status == "PASS"
    row = conn.execute(
        "SELECT source FROM milestone_verification "
        "WHERE student_id=? AND scenario_id=1 AND milestone_id=5 AND status='PASS'",
        (student,),
    ).fetchone()
    conn.close()
    assert row["source"] == SOURCE_FLAG


def test_instructor_approve_writes_source_review():
    client = TestClient(app)
    app.dependency_overrides[verify_token] = lambda: _student_claims("src_review")
    res_sub = client.post(
        "/reviews/submit",
        json={
            "scenario_id": 1,
            "milestone_id": 3,
            "report_text": "Please verify my recon steps.",
        },
    )
    assert res_sub.status_code == 200
    rev_id = res_sub.json()["review_id"]

    app.dependency_overrides[verify_token] = lambda: _instructor_claims()
    res = client.post(
        f"/instructor/reviews/{rev_id}/resolve",
        json={"status": "APPROVED", "feedback": "Looks good."},
    )
    assert res.status_code == 200
    assert _source_for("src_review", 1, 3) == SOURCE_REVIEW


def test_instructor_student_detail_includes_source():
    conn = db.get_db_connection()
    with conn:
        insert_verification_row(
            conn,
            pod_id=0,
            student_id="src_detail",
            scenario_id=1,
            milestone_id=1,
            status="FAIL",
            source=SOURCE_AUTO,
        )
        insert_verification_row(
            conn,
            pod_id=0,
            student_id="src_detail",
            scenario_id=1,
            milestone_id=1,
            status="PASS",
            source=SOURCE_MANUAL,
        )
        # Legacy-style NULL source
        insert_verification_row(
            conn,
            pod_id=0,
            student_id="src_detail",
            scenario_id=6,
            milestone_id=1,
            status="PASS",
            source=None,
        )
    conn.close()

    app.dependency_overrides[verify_token] = lambda: _instructor_claims()
    client = TestClient(app)
    res = client.get("/instructor/students/src_detail")
    assert res.status_code == 200
    body = res.json()
    assert "source" in body["milestones"][0]
    by_status = {(m["status"], m["source"]) for m in body["milestones"]}
    assert ("FAIL", "auto") in by_status
    assert ("PASS", "manual") in by_status
    assert ("PASS", None) in by_status


def test_student_progress_omits_source():
    conn = db.get_db_connection()
    with conn:
        insert_verification_row(
            conn,
            pod_id=0,
            student_id="src_progress",
            scenario_id=1,
            milestone_id=1,
            status="PASS",
            source=SOURCE_MANUAL,
        )
    conn.close()

    app.dependency_overrides[verify_token] = lambda: _student_claims("src_progress")
    client = TestClient(app)
    res = client.get("/progress")
    assert res.status_code == 200
    for m in res.json()["milestones"]:
        assert "source" not in m


def test_instructor_detail_source_null_when_column_absent(monkeypatch):
    """Pre-v15 shape: instructor JSON still includes source: null per row."""
    import pods_router

    class _FakeConn:
        def execute(self, sql, params=()):
            sql_l = " ".join(sql.lower().split())
            if "pragma table_info(milestone_verification)" in sql_l:
                # No source column
                return _Rows([{"name": "pod_id"}, {"name": "scenario_id"}, {"name": "milestone_id"},
                              {"name": "status"}, {"name": "detection_score"},
                              {"name": "detection_data"}, {"name": "verified_at"}])
            if "select 1 from" in sql_l and "union" in sql_l:
                return _Rows([{"1": 1}])
            if "from pods where student_id" in sql_l and "status not in" in sql_l:
                return _Rows([])
            if "from milestone_verification" in sql_l:
                return _Rows([
                    {
                        "pod_id": 0,
                        "scenario_id": 1,
                        "milestone_id": 1,
                        "status": "PASS",
                        "detection_score": 0,
                        "detection_data": None,
                        "verified_at": "2026-10-20",
                    }
                ])
            if "from review_cases" in sql_l:
                return _Rows([])
            return _Rows([])

        def close(self):
            return None

    class _Rows:
        def __init__(self, rows):
            self._rows = rows

        def fetchone(self):
            return self._rows[0] if self._rows else None

        def fetchall(self):
            return self._rows

    monkeypatch.setattr(pods_router, "get_db_connection", lambda: _FakeConn())
    monkeypatch.setattr(pods_router, "mv_column_names", lambda conn: set())
    app.dependency_overrides[verify_token] = lambda: _instructor_claims()
    client = TestClient(app)
    res = client.get("/instructor/students/legacy_student")
    assert res.status_code == 200
    assert res.json()["milestones"][0]["source"] is None


@pytest.mark.anyio
async def test_hybrid_corroborated_writes_source_flag(monkeypatch):
    """Case 1 flag+state PASS also tags source=flag."""
    monkeypatch.setenv("COHORT_FLAG_SECRET", "test-cohort-secret-source2")
    from flag_planting import generate_milestone_flag, save_pod_flags
    from hybrid_scoring import evaluate_hybrid_submission
    import hybrid_scoring

    student = "src_flag2"
    pod = _make_pod(student_id=student, pod_id=16, scenario_id="01")
    conn = db.get_db_connection()
    flag = generate_milestone_flag(student, 1, 1)
    save_pod_flags(conn, 16, student, 1, {1: flag})

    async def fake_state(*a, **k):
        return True, 16

    monkeypatch.setattr(hybrid_scoring, "_check_container_state", fake_state)
    result = await evaluate_hybrid_submission(
        conn, student, 1, 1, flag, active_pod=pod
    )
    assert result.status == "PASS"
    row = conn.execute(
        "SELECT source, detection_data FROM milestone_verification "
        "WHERE student_id=? AND scenario_id=1 AND milestone_id=1 AND status='PASS'",
        (student,),
    ).fetchone()
    conn.close()
    assert row["detection_data"] == "corroborated_hybrid_flag_state"
    assert row["source"] == SOURCE_FLAG
