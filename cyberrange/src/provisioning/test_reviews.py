"""Unit tests for v4 review_cases schema and review APIs."""
import os
import tempfile
import pytest
from fastapi.testclient import TestClient

import migrate
import db
import config
import auth
from auth import verify_token
from provision_api_fastapi import app


@pytest.fixture(autouse=True)
def temp_db(monkeypatch):
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tf:
        db_path = tf.name
    tf.close()
    monkeypatch.setattr("config.DB_PATH", db_path)
    monkeypatch.setattr("db.DB_PATH", db_path)
    monkeypatch.setattr("auth.AUTH_ENABLED", True)

    app.dependency_overrides[verify_token] = lambda: {
        "preferred_username": "student1",
        "realm_access": {"roles": ["student", "instructor", "admin"]}
    }

    migrate.apply(db_path)
    yield db_path
    app.dependency_overrides.clear()
    if os.path.exists(db_path):
        try:
            os.unlink(db_path)
        except OSError:
            pass


def test_v4_migration_creates_review_cases():
    conn = db.get_db_connection()
    tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
    assert "review_cases" in tables
    assert migrate.latest_version() >= 4

    indexes = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='index'").fetchall()]
    assert "idx_review_cases_student" in indexes
    assert "idx_review_cases_status" in indexes
    assert "idx_review_cases_case_type" in indexes

    cols = {r[1] for r in conn.execute("PRAGMA table_info(review_cases)").fetchall()}
    assert "case_type" in cols
    assert "conflict_reason" in cols
    assert "evidence_data" in cols
    assert "report_text" in cols
    conn.close()


def test_submit_and_resolve_review():
    client = TestClient(app)
    headers = {"Authorization": "Bearer mock_token"}

    # 1. Submit review
    res = client.post("/reviews/submit", json={
        "scenario_id": 1,
        "milestone_id": 2,
        "report_text": "Discovered SQL injection vulnerability on login portal."
    }, headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "submitted"
    review_id = data["review_id"]

    # 2. List reviews as instructor
    res_list = client.get("/instructor/reviews", headers=headers)
    assert res_list.status_code == 200
    reviews = res_list.json()["reviews"]
    assert len(reviews) == 1
    assert reviews[0]["review_id"] == review_id
    assert reviews[0]["status"] == "PENDING"
    assert reviews[0]["student_id"] == "student1"

    # 3. Resolve review (Approve with score 100)
    res_resolve = client.post(f"/instructor/reviews/{review_id}/resolve", json={
        "status": "APPROVED",
        "score": 100,
        "feedback": "Great work on identifying the SQLi vulnerability!"
    }, headers=headers)
    assert res_resolve.status_code == 200
    assert res_resolve.json()["decision"] == "APPROVED"

    # 4. Verify updated state in DB
    res_list_after = client.get("/instructor/reviews?status_filter=APPROVED", headers=headers)
    assert res_list_after.status_code == 200
    approved_reviews = res_list_after.json()["reviews"]
    assert len(approved_reviews) == 1
    assert approved_reviews[0]["score"] == 100
    assert approved_reviews[0]["feedback"] == "Great work on identifying the SQLi vulnerability!"
    assert approved_reviews[0]["graded_by"] is not None
    assert approved_reviews[0]["updated_at"] is not None


def test_submit_scoring_conflict_without_report_text():
    client = TestClient(app)
    headers = {"Authorization": "Bearer mock_token"}

    res = client.post("/reviews/submit", json={
        "scenario_id": 2,
        "milestone_id": 1,
        "case_type": "SCORING_CONFLICT",
        "conflict_reason": "Flag submitted correctly but automated verifier failed.",
        "evidence_data": {"command": "cat /flag.txt", "output": "flag{pwned_123}"}
    }, headers=headers)
    assert res.status_code == 200
    review_id = res.json()["review_id"]

    # Verify via detail endpoint
    res_detail = client.get(f"/instructor/reviews/{review_id}", headers=headers)
    assert res_detail.status_code == 200
    detail = res_detail.json()
    assert detail["case_type"] == "SCORING_CONFLICT"
    assert detail["report_text"] is None
    assert detail["conflict_reason"] == "Flag submitted correctly but automated verifier failed."
    assert "flag{pwned_123}" in detail["evidence_data"]


def test_submit_invalid_case_type():
    client = TestClient(app)
    headers = {"Authorization": "Bearer mock_token"}
    res = client.post("/reviews/submit", json={
        "scenario_id": 1,
        "case_type": "UNSUPPORTED_TYPE",
        "report_text": "Some text"
    }, headers=headers)
    assert res.status_code == 400
    assert "Invalid case_type" in res.json()["detail"]


def test_submit_scoring_conflict_missing_reason_and_report():
    client = TestClient(app)
    headers = {"Authorization": "Bearer mock_token"}
    res = client.post("/reviews/submit", json={
        "scenario_id": 1,
        "case_type": "SCORING_CONFLICT"
    }, headers=headers)
    assert res.status_code == 400
    assert "Either conflict_reason or report_text is required" in res.json()["detail"]


def test_submit_empty_report_text():
    client = TestClient(app)
    headers = {"Authorization": "Bearer mock_token"}
    res = client.post("/reviews/submit", json={
        "scenario_id": 1,
        "report_text": "   "
    }, headers=headers)
    assert res.status_code == 400
    assert "report_text cannot be empty" in res.json()["detail"]


def test_submit_unauthenticated(monkeypatch):
    monkeypatch.setattr("auth.AUTH_ENABLED", True)
    app.dependency_overrides.clear()
    client = TestClient(app)
    res = client.post("/reviews/submit", json={
        "scenario_id": 1,
        "report_text": "Valid report content"
    })
    assert res.status_code == 401


def test_get_review_detail():
    client = TestClient(app)
    headers = {"Authorization": "Bearer mock_token"}

    res_sub = client.post("/reviews/submit", json={
        "scenario_id": 3,
        "report_text": "Detail test report."
    }, headers=headers)
    review_id = res_sub.json()["review_id"]

    res = client.get(f"/instructor/reviews/{review_id}", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["review_id"] == review_id
    assert data["report_text"] == "Detail test report."
    assert data["student_id"] == "student1"


def test_get_review_detail_not_found():
    client = TestClient(app)
    headers = {"Authorization": "Bearer mock_token"}
    res = client.get("/instructor/reviews/9999", headers=headers)
    assert res.status_code == 404
    assert "Review case not found" in res.json()["detail"]


def test_get_review_detail_rbac_forbidden(monkeypatch):
    monkeypatch.setattr("auth.AUTH_ENABLED", True)
    app.dependency_overrides[verify_token] = lambda: {
        "preferred_username": "plain_student",
        "realm_access": {"roles": ["student"]}
    }
    client = TestClient(app)
    headers = {"Authorization": "Bearer mock_token"}
    res = client.get("/instructor/reviews/1", headers=headers)
    assert res.status_code == 403


def test_resolve_nonexistent_review():
    client = TestClient(app)
    headers = {"Authorization": "Bearer mock_token"}
    res = client.post("/instructor/reviews/9999/resolve", json={
        "status": "APPROVED",
        "score": 50,
        "feedback": "Nonexistent"
    }, headers=headers)
    assert res.status_code == 404
    assert "Review case not found" in res.json()["detail"]


def test_resolve_invalid_status():
    client = TestClient(app)
    headers = {"Authorization": "Bearer mock_token"}

    # Submit valid review first
    res_sub = client.post("/reviews/submit", json={
        "scenario_id": 1,
        "report_text": "Report to test invalid resolution status"
    }, headers=headers)
    review_id = res_sub.json()["review_id"]

    # Try resolving with invalid status
    res = client.post(f"/instructor/reviews/{review_id}/resolve", json={
        "status": "PASSED_WITH_FLYING_COLORS",
        "score": 100
    }, headers=headers)
    assert res.status_code == 400
    assert "Invalid status" in res.json()["detail"]


def test_resolve_score_out_of_bounds():
    client = TestClient(app)
    headers = {"Authorization": "Bearer mock_token"}

    res_sub = client.post("/reviews/submit", json={
        "scenario_id": 1,
        "report_text": "Report for score bound testing"
    }, headers=headers)
    review_id = res_sub.json()["review_id"]

    # Below 0
    res_low = client.post(f"/instructor/reviews/{review_id}/resolve", json={
        "status": "APPROVED",
        "score": -1
    }, headers=headers)
    assert res_low.status_code == 400
    assert "Score must be between 0 and 100" in res_low.json()["detail"]

    # Above 100
    res_high = client.post(f"/instructor/reviews/{review_id}/resolve", json={
        "status": "APPROVED",
        "score": 101
    }, headers=headers)
    assert res_high.status_code == 400
    assert "Score must be between 0 and 100" in res_high.json()["detail"]

    # Edge cases: 0 and 100 should succeed
    res_0 = client.post(f"/instructor/reviews/{review_id}/resolve", json={
        "status": "REJECTED",
        "score": 0
    }, headers=headers)
    assert res_0.status_code == 200

    res_100 = client.post(f"/instructor/reviews/{review_id}/resolve", json={
        "status": "APPROVED",
        "score": 100
    }, headers=headers)
    assert res_100.status_code == 200


def test_instructor_pods_payload_minimization():
    conn = db.get_db_connection()
    try:
        conn.execute(
            "INSERT INTO pods ("
            "  pod_id, student_id, scenario_id, status, "
            "  vmid_kali, vmid_meta, connection_id, wazuh_agent_id"
            ") VALUES (10, 'student_test', '1', 'READY', '100', '101', 1234, 'wazuh_001')"
        )
        conn.commit()
    finally:
        conn.close()

    client = TestClient(app)
    headers = {"Authorization": "Bearer mock_token"}
    res = client.get("/instructor/pods", headers=headers)
    assert res.status_code == 200
    pods = res.json()["pods"]
    assert len(pods) >= 1
    test_pod = next(p for p in pods if p["pod_id"] == 10)

    # Assert infrastructure secrets are stripped
    assert "vmid_kali" not in test_pod
    assert "vmid_meta" not in test_pod
    assert "connection_id" not in test_pod
    assert "wazuh_agent_id" not in test_pod
    assert not any(k.startswith("vmid_") for k in test_pod)

    # Assert necessary instructor monitoring fields remain
    assert test_pod["pod_id"] == 10
    assert test_pod["student_id"] == "student_test"
    assert test_pod["status"] == "READY"
    assert "milestones" in test_pod


def test_instructor_student_progress_without_active_pod():
    conn = db.get_db_connection()
    try:
        # Student 1 has historical milestone verifications and a destroyed pod
        conn.execute(
            "INSERT INTO pods (pod_id, student_id, scenario_id, status) "
            "VALUES (20, 'historical_student', '1', 'DESTROYED')"
        )
        conn.execute(
            "INSERT INTO milestone_verification (pod_id, scenario_id, milestone_id, student_id, status, detection_score) "
            "VALUES (20, 1, 1, 'historical_student', 'PASS', 10)"
        )
        conn.execute(
            "INSERT INTO milestone_verification (pod_id, scenario_id, milestone_id, student_id, status, detection_score) "
            "VALUES (20, 1, 2, 'historical_student', 'PASS', 20)"
        )

        # Student 2 has an active pod
        conn.execute(
            "INSERT INTO pods (pod_id, student_id, scenario_id, status, vmid_kali) "
            "VALUES (21, 'active_student', '2', 'READY', '200')"
        )
        conn.commit()
    finally:
        conn.close()

    client = TestClient(app)
    headers = {"Authorization": "Bearer mock_token"}

    # 1. List all students
    res_list = client.get("/instructor/students", headers=headers)
    assert res_list.status_code == 200
    students = res_list.json()["students"]
    s_hist = next(s for s in students if s["student_id"] == "historical_student")
    assert s_hist["active_pod"] is None
    assert len(s_hist["milestones"]) == 2

    s_act = next(s for s in students if s["student_id"] == "active_student")
    assert s_act["active_pod"] is not None
    assert s_act["active_pod"]["pod_id"] == 21
    assert "vmid_kali" not in s_act["active_pod"]

    # 2. Get historical student progress by student_id
    res_single = client.get("/instructor/students/historical_student", headers=headers)
    assert res_single.status_code == 200
    single_data = res_single.json()
    assert single_data["student_id"] == "historical_student"
    assert single_data["active_pod"] is None
    assert len(single_data["milestones"]) == 2


def test_instructor_student_progress_not_found():
    client = TestClient(app)
    headers = {"Authorization": "Bearer mock_token"}
    res = client.get("/instructor/students/unknown_student_xyz", headers=headers)
    assert res.status_code == 404
    assert "Student not found" in res.json()["detail"]


def test_instructor_students_rbac_forbidden(monkeypatch):
    monkeypatch.setattr("auth.AUTH_ENABLED", True)
    app.dependency_overrides[verify_token] = lambda: {
        "preferred_username": "plain_student",
        "realm_access": {"roles": ["student"]}
    }
    client = TestClient(app)
    headers = {"Authorization": "Bearer mock_token"}

    res_list = client.get("/instructor/students", headers=headers)
    assert res_list.status_code == 403

    res_single = client.get("/instructor/students/any_student", headers=headers)
    assert res_single.status_code == 403


def test_instructor_rbac_forbidden_for_student(monkeypatch):
    monkeypatch.setattr("auth.AUTH_ENABLED", True)
    app.dependency_overrides[verify_token] = lambda: {
        "preferred_username": "plain_student",
        "realm_access": {"roles": ["student"]}
    }

    client = TestClient(app)
    headers = {"Authorization": "Bearer mock_token"}

    res_list = client.get("/instructor/reviews", headers=headers)
    assert res_list.status_code == 403

    res_resolve = client.post("/instructor/reviews/1/resolve", json={
        "status": "APPROVED",
        "score": 100
    }, headers=headers)
    assert res_resolve.status_code == 403
