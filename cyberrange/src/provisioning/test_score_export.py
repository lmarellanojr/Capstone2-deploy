"""Tests for Section D.5 / PAPER-16 scoring export and knowledge-gain telemetry."""
from __future__ import annotations

import csv
import json
import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import auth
import db
from auth import verify_token
from export_knowledge_gain import export_knowledge_gain_cli
from knowledge_gain import (
    anonymize_student_id,
    compute_knowledge_gain_summary,
    extract_knowledge_gain_records,
    format_records_csv,
    parse_timestamp,
    sanitize_csv_cell,
)
from provision_api_fastapi import app


def _instructor_claims(username: str = "instructor1") -> dict:
    return {
        "preferred_username": username,
        "realm_access": {"roles": ["instructor"]},
    }


def _admin_claims(username: str = "admin1") -> dict:
    return {
        "preferred_username": username,
        "realm_access": {"roles": ["admin"]},
    }


def _student_claims(username: str = "student1") -> dict:
    return {
        "preferred_username": username,
        "realm_access": {"roles": ["student"]},
    }


def _insert_pod(
    student_id: str,
    pod_id: int,
    scenario_id: str | int = "01",
    created_at: str = "2026-09-24 00:00:00",
    status: str = "ACTIVE",
) -> None:
    conn = db.get_db_connection()
    with conn:
        conn.execute(
            "INSERT INTO pods (student_id, pod_id, scenario_id, created_at, status) VALUES (?,?,?,?,?)",
            (student_id, pod_id, str(scenario_id), created_at, status),
        )
    conn.close()


def _insert_verification(
    student_id: str,
    pod_id: int,
    scenario_id: int,
    milestone_id: int,
    status: str = "PASS",
    verified_at: str = "2026-09-24 00:02:00",
    detection_score: int = 1,
    detection_data: str = "rule 100001",
) -> None:
    conn = db.get_db_connection()
    with conn:
        conn.execute(
            "INSERT INTO milestone_verification "
            "(student_id, pod_id, scenario_id, milestone_id, status, verified_at, detection_score, detection_data) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (
                student_id,
                pod_id,
                scenario_id,
                milestone_id,
                status,
                verified_at,
                detection_score,
                detection_data,
            ),
        )
    conn.close()


def _insert_review_case(
    student_id: str,
    scenario_id: int,
    milestone_id: int | None,
    score: int | None = 95,
    status: str = "APPROVED",
    feedback: str = "Great job",
    updated_at: str = "2026-09-24 00:10:00",
) -> None:
    conn = db.get_db_connection()
    with conn:
        conn.execute(
            "INSERT INTO review_cases "
            "(student_id, scenario_id, milestone_id, score, status, feedback, updated_at) "
            "VALUES (?,?,?,?,?,?,?)",
            (student_id, scenario_id, milestone_id, score, status, feedback, updated_at),
        )
    conn.close()


def test_time_to_milestone_basic():
    """Verify time-to-milestone calculates elapsed seconds from pod created_at to first PASS."""
    _insert_pod("alice", 1, scenario_id="01", created_at="2026-09-24 00:00:00")
    _insert_verification(
        "alice",
        1,
        scenario_id=1,
        milestone_id=1,
        status="PASS",
        verified_at="2026-09-24 00:02:00",
    )

    conn = db.get_db_connection()
    records = extract_knowledge_gain_records(conn)
    conn.close()

    assert len(records) == 1
    assert records[0]["student_id"] == "alice"
    assert records[0]["scenario_id"] == 1
    assert records[0]["milestone_id"] == 1
    assert records[0]["status"] == "PASS"
    assert records[0]["time_to_milestone_seconds"] == 120.0


def test_time_to_milestone_multiple_attempts():
    """Verify that multiple attempts correlate only the first PASS timestamp."""
    _insert_pod("bob", 2, scenario_id=1, created_at="2026-09-24 00:00:00")
    # FAIL at +30s
    _insert_verification("bob", 2, scenario_id=1, milestone_id=1, status="FAIL", verified_at="2026-09-24 00:00:30")
    # First PASS at +150s
    _insert_verification("bob", 2, scenario_id=1, milestone_id=1, status="PASS", verified_at="2026-09-24 00:02:30")
    # Second PASS at +300s (repeated check)
    _insert_verification("bob", 2, scenario_id=1, milestone_id=1, status="PASS", verified_at="2026-09-24 00:05:00")

    conn = db.get_db_connection()
    records = extract_knowledge_gain_records(conn)
    conn.close()

    assert len(records) == 3
    # First verification was FAIL -> time_to_milestone is None
    assert records[0]["status"] == "FAIL"
    assert records[0]["time_to_milestone_seconds"] is None

    # Both subsequent PASS records reference the first PASS timestamp (150s)
    assert records[1]["status"] == "PASS"
    assert records[1]["time_to_milestone_seconds"] == 150.0

    assert records[2]["status"] == "PASS"
    assert records[2]["time_to_milestone_seconds"] == 150.0


def test_time_to_milestone_non_pass():
    """Verify that non-PASS verifications return time_to_milestone_seconds = None."""
    _insert_pod("charlie", 3, scenario_id=1, created_at="2026-09-24 00:00:00")
    _insert_verification("charlie", 3, scenario_id=1, milestone_id=1, status="FAIL", verified_at="2026-09-24 00:01:00")

    conn = db.get_db_connection()
    records = extract_knowledge_gain_records(conn)
    conn.close()

    assert len(records) == 1
    assert records[0]["status"] == "FAIL"
    assert records[0]["time_to_milestone_seconds"] is None


def test_time_to_milestone_clock_skew_clamped():
    """Verify negative duration resulting from clock skew or synthetic data clamps to 0.0."""
    _insert_pod("dave", 4, scenario_id=1, created_at="2026-09-24 00:05:00")
    _insert_verification("dave", 4, scenario_id=1, milestone_id=1, status="PASS", verified_at="2026-09-24 00:01:00")

    conn = db.get_db_connection()
    records = extract_knowledge_gain_records(conn)
    conn.close()

    assert len(records) == 1
    assert records[0]["time_to_milestone_seconds"] == 0.0


def test_cross_tenant_slot_reuse_isolation():
    """Verify that slot reallocation (destroying Alice's pod 1 and giving pod 1 to Bob) does not bleed timestamps."""
    # Alice had pod 1 for scenario 1 at 01:00:00, passed at 01:05:00 (300s)
    # Alice also has a preserved historical record of her scenario 1 session
    _insert_pod("alice", 2, scenario_id=1, created_at="2026-09-24 01:00:00", status="DESTROYED")
    _insert_verification("alice", 1, scenario_id=1, milestone_id=1, status="PASS", verified_at="2026-09-24 01:05:00")

    # Bob later takes slot 1 at 03:00:00, passes at 03:10:00 (600s)
    _insert_pod("bob", 1, scenario_id=1, created_at="2026-09-24 03:00:00", status="ACTIVE")
    _insert_verification("bob", 1, scenario_id=1, milestone_id=1, status="PASS", verified_at="2026-09-24 03:10:00")

    conn = db.get_db_connection()
    records = extract_knowledge_gain_records(conn)
    conn.close()

    alice_rec = next(r for r in records if r["student_id"] == "alice")
    bob_rec = next(r for r in records if r["student_id"] == "bob")

    # Bob's pod created at 03:00 must NOT be used for Alice (which would cause negative time or wrong baseline)
    # Alice's time is strictly calculated against Alice's scenario pod (300s)
    assert alice_rec["time_to_milestone_seconds"] == 300.0
    assert bob_rec["time_to_milestone_seconds"] == 600.0


def test_slot_reuse_without_any_prior_pod_returns_none():
    """Verify that if a student has no pod rows remaining, slot occupant's timestamp is never leaked."""
    # Charlie had verification on pod 1, but has NO pod in pods table
    _insert_verification("charlie", 1, scenario_id=1, milestone_id=1, status="PASS", verified_at="2026-09-24 01:05:00")
    # Dave occupies pod 1 at 03:00:00
    _insert_pod("dave", 1, scenario_id=1, created_at="2026-09-24 03:00:00", status="ACTIVE")

    conn = db.get_db_connection()
    records = extract_knowledge_gain_records(conn)
    conn.close()

    charlie_rec = next(r for r in records if r["student_id"] == "charlie")
    # Dave's 03:00:00 timestamp must NEVER be leaked to Charlie
    assert charlie_rec["time_to_milestone_seconds"] is None



def test_type_mismatch_resilience():
    """Verify that pods.scenario_id as TEXT '01' properly correlates with milestone_verification INTEGER 1."""
    _insert_pod("eve", 1, scenario_id="01", created_at="2026-09-24 00:00:00")
    _insert_verification("eve", 1, scenario_id=1, milestone_id=1, status="PASS", verified_at="2026-09-24 00:04:00")

    conn = db.get_db_connection()
    records = extract_knowledge_gain_records(conn, scenario_id=1)
    conn.close()

    assert len(records) == 1
    assert records[0]["scenario_id"] == 1
    assert records[0]["time_to_milestone_seconds"] == 240.0


def test_review_cases_deduplication_and_rubric():
    """Verify multiple review cases for a student/milestone do not duplicate records and pick latest approved score."""
    _insert_pod("frank", 1, scenario_id=1, created_at="2026-09-24 00:00:00")
    _insert_verification("frank", 1, scenario_id=1, milestone_id=1, status="PASS", verified_at="2026-09-24 00:02:00")

    # First submission: RETRY
    _insert_review_case("frank", scenario_id=1, milestone_id=1, score=None, status="RETRY", updated_at="2026-09-24 00:05:00")
    # Second submission: APPROVED with score 88
    _insert_review_case("frank", scenario_id=1, milestone_id=1, score=88, status="APPROVED", updated_at="2026-09-24 00:10:00")

    conn = db.get_db_connection()
    records = extract_knowledge_gain_records(conn)
    conn.close()

    assert len(records) == 1
    assert records[0]["rubric_score"] == 88


def test_unreviewed_pending_rubric_is_none():
    """Verify unreviewed review cases do not export as 0."""
    _insert_pod("grace", 1, scenario_id=1, created_at="2026-09-24 00:00:00")
    _insert_verification("grace", 1, scenario_id=1, milestone_id=1, status="PASS", verified_at="2026-09-24 00:02:00")
    _insert_review_case("grace", scenario_id=1, milestone_id=1, score=None, status="PENDING", updated_at="2026-09-24 00:05:00")

    conn = db.get_db_connection()
    records = extract_knowledge_gain_records(conn)
    conn.close()

    assert len(records) == 1
    assert records[0]["rubric_score"] is None


def test_empty_database_export_json_and_csv():
    """Verify empty database exports clean empty summary and valid CSV headers."""
    conn = db.get_db_connection()
    records = extract_knowledge_gain_records(conn)
    summary = compute_knowledge_gain_summary(records)
    csv_text = format_records_csv(records)
    conn.close()

    assert records == []
    assert summary["total_records"] == 0
    assert summary["total_passes"] == 0
    assert summary["completion_rate"] == 0.0
    assert summary["avg_time_to_milestone_seconds"] is None
    assert summary["avg_detection_score"] is None

    lines = csv_text.strip().splitlines()
    assert len(lines) == 1
    assert "student_id,scenario_id,milestone_id,status" in lines[0]


def test_sanitization_and_field_minimization():
    """Verify internal infrastructure identifiers and raw logs are excluded from records."""
    _insert_pod("heidi", 1, scenario_id=1, created_at="2026-09-24 00:00:00")
    _insert_verification(
        "heidi",
        1,
        scenario_id=1,
        milestone_id=1,
        status="PASS",
        verified_at="2026-09-24 00:02:00",
        detection_data="internal-ip-10.0.3.5-agent-007",
    )

    conn = db.get_db_connection()
    records = extract_knowledge_gain_records(conn)
    conn.close()

    rec = records[0]
    forbidden_keys = {"pod_id", "detection_data", "id", "vmid_kali", "vmid_meta", "vmid_dvwa", "connection_id", "wazuh_agent_id"}
    for k in forbidden_keys:
        assert k not in rec, f"Sensitive field {k} leaked in record"


def test_salted_hmac_anonymization():
    """Verify deterministic salted HMAC pseudonymization across records."""
    _insert_pod("ivan", 1, scenario_id=1, created_at="2026-09-24 00:00:00")
    _insert_verification("ivan", 1, scenario_id=1, milestone_id=1, status="PASS", verified_at="2026-09-24 00:01:00")
    _insert_verification("ivan", 1, scenario_id=1, milestone_id=2, status="PASS", verified_at="2026-09-24 00:03:00")

    conn = db.get_db_connection()
    records = extract_knowledge_gain_records(conn, anonymize=True)
    conn.close()

    assert len(records) == 2
    anon_id_1 = records[0]["student_id"]
    anon_id_2 = records[1]["student_id"]

    assert anon_id_1.startswith("student_")
    assert "ivan" not in anon_id_1
    assert anon_id_1 == anon_id_2

    # Different student produces different pseudonym
    other_anon = anonymize_student_id("judy")
    assert other_anon != anon_id_1


def test_csv_formula_injection_defense():
    """Verify that potential formula injection prefixes (=, +, -, @, \\t, \\r) are sanitized."""
    assert sanitize_csv_cell("=1+1") == "'=1+1"
    assert sanitize_csv_cell("+cmd") == "'+cmd"
    assert sanitize_csv_cell("-calc") == "'-calc"
    assert sanitize_csv_cell("@eval") == "'@eval"
    assert sanitize_csv_cell("student1") == "student1"
    assert sanitize_csv_cell(123) == 123


def test_api_endpoint_json_and_csv():
    """Verify GET /instructor/export/knowledge-gain serves both JSON and RFC 4180 CSV."""
    app.dependency_overrides[verify_token] = lambda: _instructor_claims()

    _insert_pod("karen", 1, scenario_id=1, created_at="2026-09-24 00:00:00")
    _insert_verification("karen", 1, scenario_id=1, milestone_id=1, status="PASS", verified_at="2026-09-24 00:02:00")

    client = TestClient(app)

    # 1. JSON Export
    res_json = client.get("/instructor/export/knowledge-gain?format=json")
    assert res_json.status_code == 200
    data = res_json.json()
    assert "summary" in data
    assert "records" in data
    assert data["summary"]["total_records"] == 1
    assert data["summary"]["total_passes"] == 1
    assert data["summary"]["completion_rate"] == 1.0
    assert data["records"][0]["student_id"] == "karen"

    # 2. CSV Export
    res_csv = client.get("/instructor/export/knowledge-gain?format=csv")
    assert res_csv.status_code == 200
    assert "text/csv" in res_csv.headers["content-type"]
    assert "attachment" in res_csv.headers["content-disposition"]
    reader = list(csv.reader(res_csv.text.splitlines()))
    assert len(reader) == 2
    assert reader[0][0] == "student_id"
    assert reader[1][0] == "karen"


def test_api_case_insensitivity_and_invalid_filters():
    """Verify case insensitivity for format and status_filter, plus HTTP 400 validation."""
    app.dependency_overrides[verify_token] = lambda: _instructor_claims()

    _insert_pod("leo", 1, scenario_id=1, created_at="2026-09-24 00:00:00")
    _insert_verification("leo", 1, scenario_id=1, milestone_id=1, status="PASS", verified_at="2026-09-24 00:02:00")

    client = TestClient(app)

    # Case insensitive format (CSV)
    r_csv = client.get("/instructor/export/knowledge-gain?format=CSV")
    assert r_csv.status_code == 200
    assert "text/csv" in r_csv.headers["content-type"]

    # Case insensitive status_filter (pass)
    r_pass = client.get("/instructor/export/knowledge-gain?status_filter=pass")
    assert r_pass.status_code == 200
    assert r_pass.json()["summary"]["total_records"] == 1

    # Invalid format -> 400
    r_bad_fmt = client.get("/instructor/export/knowledge-gain?format=xml")
    assert r_bad_fmt.status_code == 400

    # Invalid status -> 400
    r_bad_st = client.get("/instructor/export/knowledge-gain?status_filter=BOGUS")
    assert r_bad_st.status_code == 400


def test_api_rbac_authorization():
    """Verify RBAC boundaries: unauthenticated (401), student (403), instructor (200), admin (200)."""
    client = TestClient(app)

    # 1. Unauthenticated -> 401
    app.dependency_overrides.pop(verify_token, None)
    r_unauth = client.get("/instructor/export/knowledge-gain")
    assert r_unauth.status_code == 401

    # 2. Student -> 403 Forbidden
    app.dependency_overrides[verify_token] = lambda: _student_claims()
    r_student = client.get("/instructor/export/knowledge-gain")
    assert r_student.status_code == 403

    # 3. Instructor -> 200 OK
    app.dependency_overrides[verify_token] = lambda: _instructor_claims()
    r_inst = client.get("/instructor/export/knowledge-gain")
    assert r_inst.status_code == 200

    # 4. Admin -> 200 OK
    app.dependency_overrides[verify_token] = lambda: _admin_claims()
    r_admin = client.get("/instructor/export/knowledge-gain")
    assert r_admin.status_code == 200


def test_cli_export_tool(tmp_path: Path):
    """Verify standalone CLI tool exports CSV and JSON to file and filters by status."""
    _insert_pod("mallory", 1, scenario_id=1, created_at="2026-09-24 00:00:00")
    _insert_verification("mallory", 1, scenario_id=1, milestone_id=1, status="PASS", verified_at="2026-09-24 00:02:00")
    _insert_verification("mallory", 1, scenario_id=1, milestone_id=2, status="FAIL", verified_at="2026-09-24 00:03:00")

    csv_file = tmp_path / "export.csv"
    json_file = tmp_path / "export.json"

    # Export CSV with status=PASS filter and anonymize
    rc = export_knowledge_gain_cli(
        db_path=db.DB_PATH,
        export_format="csv",
        output_file=str(csv_file),
        status_filter="PASS",
        anonymize=True,
    )
    assert rc == 0
    assert csv_file.exists()
    csv_content = csv_file.read_text(encoding="utf-8")
    assert "student_" in csv_content
    assert "mallory" not in csv_content
    rows = list(csv.reader(csv_content.strip().splitlines()))
    assert len(rows) == 2  # header + 1 pass row

    # Export JSON
    rc = export_knowledge_gain_cli(
        db_path=db.DB_PATH,
        export_format="json",
        output_file=str(json_file),
    )
    assert rc == 0
    assert json_file.exists()
    data = json.loads(json_file.read_text(encoding="utf-8"))
    assert data["summary"]["total_records"] == 2
    assert data["summary"]["total_passes"] == 1


def test_legacy_schema_without_review_cases(tmp_path: Path):
    """Verify that querying a database lacking review_cases succeeds gracefully with rubric_score=None."""
    legacy_db = tmp_path / "legacy.db"
    conn = sqlite3.connect(legacy_db)
    conn.execute(
        "CREATE TABLE pods ("
        "id INTEGER PRIMARY KEY, student_id TEXT, pod_id INTEGER, "
        "status TEXT, created_at TIMESTAMP, scenario_id TEXT)"
    )
    conn.execute(
        "CREATE TABLE milestone_verification ("
        "id INTEGER PRIMARY KEY, pod_id INTEGER, student_id TEXT, "
        "scenario_id INTEGER, milestone_id INTEGER, status TEXT, "
        "detection_score INTEGER, verified_at TIMESTAMP)"
    )
    conn.execute(
        "INSERT INTO pods (student_id, pod_id, scenario_id, created_at, status) "
        "VALUES ('oscar', 1, '01', '2026-09-24 00:00:00', 'ACTIVE')"
    )
    conn.execute(
        "INSERT INTO milestone_verification "
        "(student_id, pod_id, scenario_id, milestone_id, status, verified_at, detection_score) "
        "VALUES ('oscar', 1, 1, 1, 'PASS', '2026-09-24 00:02:00', 1)"
    )
    conn.commit()

    records = extract_knowledge_gain_records(conn)
    conn.close()

    assert len(records) == 1
    assert records[0]["student_id"] == "oscar"
    assert records[0]["rubric_score"] is None
    assert records[0]["time_to_milestone_seconds"] == 120.0
