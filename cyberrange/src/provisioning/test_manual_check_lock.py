"""G1: the one-shot Manual Check lock.

A student-initiated Manual Check is allowed once per milestone. A failed check
locks the task to instructor review (status REVIEW) and must not re-run the
verifier or award points. The background auto-detect poller calls
verify_milestone() directly (not this route), so it never consumes the attempt.
"""
import pytest
from fastapi.testclient import TestClient

import db
import pods_router
from auth import verify_token
from models import VerificationResponse
from provision_api_fastapi import app


def _student_claims(username="student1"):
    return {"preferred_username": username, "realm_access": {"roles": ["student"]}}


def _make_pod(student_id="student1", pod_id=1, scenario_id="1"):
    conn = db.get_db_connection()
    with conn:
        conn.execute(
            "INSERT INTO pods (student_id, pod_id, status, scenario_id) VALUES (?,?,?,?)",
            (student_id, pod_id, "ACTIVE", scenario_id),
        )
    conn.close()


def _stub_verify(monkeypatch, status):
    async def fake(pod, scenario_id, milestone_id, **kw):
        # Mirror the real verifier: a PASS writes a milestone_verification row.
        if status == "PASS":
            conn = db.get_db_connection()
            with conn:
                conn.execute(
                    "INSERT INTO milestone_verification "
                    "(pod_id, student_id, scenario_id, milestone_id, status, detection_score, detection_data) "
                    "VALUES (?,?,?,?,'PASS',0,'stub')",
                    (pod["pod_id"], pod["student_id"], scenario_id, milestone_id),
                )
            conn.close()
        return VerificationResponse(
            status=status,
            message=f"stub {status}",
            pod_id=pod["pod_id"],
            scenario_id=scenario_id,
            milestone_id=milestone_id,
            detection_score=0,
            verified_at="2026-10-01T00:00:00",
        )
    monkeypatch.setattr(pods_router, "verify_milestone", fake)


def test_manual_check_fail_then_locks_to_review(monkeypatch):
    _make_pod()
    app.dependency_overrides[verify_token] = lambda: _student_claims()
    client = TestClient(app)

    _stub_verify(monkeypatch, "FAIL")
    first = client.post("/pods/1/verify/1/2")
    assert first.status_code == 200
    assert first.json()["status"] == "FAIL"

    # Second click must NOT re-run the verifier; it is locked to review.
    def boom(*a, **k):
        raise AssertionError("verifier must not run after the one attempt is used")
    monkeypatch.setattr(pods_router, "verify_milestone", boom)
    second = client.post("/pods/1/verify/1/2")
    assert second.status_code == 200
    assert second.json()["status"] == "REVIEW"

    # And the milestones endpoint reports the lock so the UI can render it.
    ms = client.get("/pods/1/milestones").json()
    assert 2 in ms["manual_check_locked"]


def test_manual_check_pass_does_not_lock(monkeypatch):
    _make_pod()
    app.dependency_overrides[verify_token] = lambda: _student_claims()
    client = TestClient(app)

    _stub_verify(monkeypatch, "PASS")
    r = client.post("/pods/1/verify/1/1")
    assert r.json()["status"] == "PASS"

    # A passed milestone is never "locked to review".
    ms = client.get("/pods/1/milestones").json()
    assert 1 not in ms["manual_check_locked"]

    # Re-checking a passed milestone is idempotent PASS (no verifier run).
    def boom(*a, **k):
        raise AssertionError("verifier must not run for an already-passed milestone")
    monkeypatch.setattr(pods_router, "verify_milestone", boom)
    again = client.post("/pods/1/verify/1/1")
    assert again.json()["status"] == "PASS"


def test_manual_check_error_does_not_consume_attempt(monkeypatch):
    _make_pod()
    app.dependency_overrides[verify_token] = lambda: _student_claims()
    client = TestClient(app)

    _stub_verify(monkeypatch, "ERROR")
    r = client.post("/pods/1/verify/1/3")
    assert r.json()["status"] == "ERROR"

    # An infra error must leave the attempt unused, so a retry still runs.
    ran = {"count": 0}

    async def fake_pass(pod, scenario_id, milestone_id, **kw):
        ran["count"] += 1
        return VerificationResponse(
            status="PASS", message="ok", pod_id=pod["pod_id"],
            scenario_id=scenario_id, milestone_id=milestone_id,
            detection_score=0, verified_at="2026-10-01T00:00:00",
        )
    monkeypatch.setattr(pods_router, "verify_milestone", fake_pass)
    retry = client.post("/pods/1/verify/1/3")
    assert retry.json()["status"] == "PASS"
    assert ran["count"] == 1


def test_reset_clears_manual_check_lock(monkeypatch):
    """Reviewer finding (PR #141): 'Try Again' reset must also clear
    manual_check_attempts; otherwise the PASS row is gone but the attempt row keeps
    the task locked to instructor review and the verifier can never re-run."""
    _make_pod()
    app.dependency_overrides[verify_token] = lambda: _student_claims()
    client = TestClient(app)

    _stub_verify(monkeypatch, "FAIL")
    assert client.post("/pods/1/verify/1/2").json()["status"] == "FAIL"
    assert 2 in client.get("/pods/1/milestones").json()["manual_check_locked"]

    # Reset this scenario's progress (DELETE /progress/{scenario_id}).
    assert client.delete("/progress/1").status_code == 200

    # The lock is gone...
    assert 2 not in client.get("/pods/1/milestones").json()["manual_check_locked"]

    # ...and a fresh Manual Check runs the verifier again instead of REVIEW.
    ran = {"count": 0}

    async def fake_fail(pod, scenario_id, milestone_id, **kw):
        ran["count"] += 1
        return VerificationResponse(
            status="FAIL", message="again", pod_id=pod["pod_id"],
            scenario_id=scenario_id, milestone_id=milestone_id,
            detection_score=0, verified_at="2026-10-01T00:00:00",
        )
    monkeypatch.setattr(pods_router, "verify_milestone", fake_fail)
    after = client.post("/pods/1/verify/1/2")
    assert after.json()["status"] == "FAIL"
    assert ran["count"] == 1
