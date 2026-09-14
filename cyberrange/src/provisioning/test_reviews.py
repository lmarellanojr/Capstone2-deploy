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
        os.unlink(db_path)


def test_v4_migration_creates_review_cases():
    conn = db.get_db_connection()
    tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
    assert "review_cases" in tables
    assert migrate.latest_version() >= 4

    indexes = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='index'").fetchall()]
    assert "idx_review_cases_student" in indexes
    assert "idx_review_cases_status" in indexes
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
