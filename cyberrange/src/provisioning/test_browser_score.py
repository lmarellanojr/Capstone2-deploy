"""Browser scoring API (#109): secret auth, ownership, idempotency, no Manual Check downgrade."""
from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient

from auth import verify_token
from db import get_db_connection
from provision_api_fastapi import app
from scoring import verify_milestone


SECRET = "test-secret"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("BROWSER_SCORE_SECRET", SECRET)
    return TestClient(app)


def _insert_pod(
    pod_id: int = 10,
    student_id: str = "student_demo",
    status: str = "ACTIVE",
    scenario_id: str = "06",
) -> dict:
    conn = get_db_connection()
    conn.execute(
        "INSERT INTO pods (pod_id, student_id, scenario_id, status, vmid_kali, vmid_meta, vmid_dvwa) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            pod_id,
            student_id,
            scenario_id,
            status,
            f"pod-{student_id}-kali",
            f"pod-{student_id}-meta",
            f"pod-{student_id}-dvwa",
        ),
    )
    conn.commit()
    conn.close()
    return {
        "pod_id": pod_id,
        "student_id": student_id,
        "status": status,
        "scenario_id": scenario_id,
        "wazuh_agent_id": None,
    }


def _headers(secret: str = SECRET) -> dict:
    return {"X-Browser-Score-Secret": secret}


def _body(**over):
    base = {
        "student_id": "student_demo",
        "pod_id": 10,
        "scenario_id": 6,
        "milestone_id": 1,
        "label": "browser:sqli-m1",
    }
    base.update(over)
    return base


def _pass_count(pod_id: int, milestone_id: int, student_id: str | None = None) -> int:
    conn = get_db_connection()
    if student_id is None:
        n = conn.execute(
            "SELECT COUNT(*) FROM milestone_verification "
            "WHERE pod_id=? AND scenario_id=6 AND milestone_id=? AND status='PASS' "
            "AND detection_data LIKE 'browser:%'",
            (pod_id, milestone_id),
        ).fetchone()[0]
    else:
        n = conn.execute(
            "SELECT COUNT(*) FROM milestone_verification "
            "WHERE pod_id=? AND student_id=? AND scenario_id=6 AND milestone_id=? "
            "AND status='PASS' AND detection_data LIKE 'browser:%'",
            (pod_id, student_id, milestone_id),
        ).fetchone()[0]
    conn.close()
    return n


def _reassign_pod(pod_id: int, new_student_id: str) -> dict:
    """Simulate slot reuse: same pod_id, new student owns the ACTIVE row."""
    conn = get_db_connection()
    conn.execute(
        "UPDATE pods SET student_id=?, vmid_kali=?, vmid_meta=?, vmid_dvwa=? WHERE pod_id=?",
        (
            new_student_id,
            f"pod-{new_student_id}-kali",
            f"pod-{new_student_id}-meta",
            f"pod-{new_student_id}-dvwa",
            pod_id,
        ),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM pods WHERE pod_id=?", (pod_id,)).fetchone()
    conn.close()
    return dict(row)


def test_missing_secret_is_401(client):
    _insert_pod()
    r = client.post("/internal/browser-score", json=_body())
    assert r.status_code == 401
    assert _pass_count(10, 1) == 0


def test_wrong_secret_is_401(client):
    _insert_pod()
    r = client.post(
        "/internal/browser-score",
        json=_body(),
        headers=_headers("wrong"),
    )
    assert r.status_code == 401
    assert _pass_count(10, 1) == 0


def test_non_ascii_secret_bytes_compare_does_not_raise():
    """Starlette/httpx reject non-ASCII header values before the route runs.
    The handler compares UTF-8 bytes so a non-ASCII secret never TypeErrors."""
    import hmac

    expected = SECRET
    got = "é" * len(SECRET)
    assert not hmac.compare_digest(got.encode("utf-8"), expected.encode("utf-8"))


def test_unset_secret_is_503(client, monkeypatch):
    monkeypatch.delenv("BROWSER_SCORE_SECRET", raising=False)
    _insert_pod()
    r = client.post(
        "/internal/browser-score",
        json=_body(),
        headers=_headers(SECRET),
    )
    assert r.status_code == 503
    assert _pass_count(10, 1) == 0


def test_inactive_pod_is_409(client):
    _insert_pod(status="DESTROYED")
    r = client.post(
        "/internal/browser-score",
        json=_body(),
        headers=_headers(),
    )
    assert r.status_code == 409
    assert _pass_count(10, 1) == 0


def test_owner_mismatch_is_403(client):
    _insert_pod(student_id="other_student")
    r = client.post(
        "/internal/browser-score",
        json=_body(),
        headers=_headers(),
    )
    assert r.status_code == 403
    assert _pass_count(10, 1) == 0


def test_records_browser_pass(client):
    _insert_pod()
    r = client.post(
        "/internal/browser-score",
        json=_body(),
        headers=_headers(),
    )
    assert r.status_code == 200
    assert r.json()["status"] == "PASS"
    conn = get_db_connection()
    row = conn.execute(
        "SELECT status, detection_score, detection_data FROM milestone_verification "
        "WHERE pod_id=10 AND milestone_id=1"
    ).fetchone()
    conn.close()
    assert row["status"] == "PASS"
    assert row["detection_score"] == 0
    assert row["detection_data"] == "browser:sqli-m1"


def test_repeat_is_idempotent(client):
    _insert_pod()
    h = _headers()
    assert client.post("/internal/browser-score", json=_body(), headers=h).status_code == 200
    assert client.post("/internal/browser-score", json=_body(), headers=h).status_code == 200
    assert _pass_count(10, 1) == 1


def test_label_mismatch_is_400(client):
    _insert_pod()
    r = client.post(
        "/internal/browser-score",
        json=_body(label="browser:sqli-m2"),
        headers=_headers(),
    )
    assert r.status_code == 400
    assert _pass_count(10, 1) == 0


def test_xss_milestone_4_label(client):
    _insert_pod()
    r = client.post(
        "/internal/browser-score",
        json=_body(milestone_id=4, label="browser:xss-m4"),
        headers=_headers(),
    )
    assert r.status_code == 200
    assert _pass_count(10, 4) == 1


def test_xss_wrong_label_is_400(client):
    _insert_pod()
    r = client.post(
        "/internal/browser-score",
        json=_body(milestone_id=4, label="browser:sqli-m4"),
        headers=_headers(),
    )
    assert r.status_code == 400
    assert _pass_count(10, 4) == 0


@pytest.mark.anyio
async def test_verify_does_not_downgrade_browser_pass(monkeypatch):
    pod = _insert_pod()
    conn = get_db_connection()
    with conn:
        conn.execute(
            "INSERT INTO milestone_verification "
            "(pod_id, student_id, scenario_id, milestone_id, status, detection_score, detection_data) "
            "VALUES (?,?,?,?,?,?,?)",
            (10, "student_demo", 6, 1, "PASS", 0, "browser:sqli-m1"),
        )
    conn.close()

    class AlwaysFail:
        async def verify_milestone(self, student_id, scenario_id, milestone_id):
            return "FAIL", "would fail on Kali"

    res = await verify_milestone(
        pod=pod,
        scenario_id=6,
        milestone_id=1,
        scoring_enabled=True,
        ssh_verifier_cls=AlwaysFail,
        detection_enabled=False,
        detection_for=None,
        verify_siem_alert=None,
    )
    assert res.status == "PASS"
    conn = get_db_connection()
    fails = conn.execute(
        "SELECT COUNT(*) FROM milestone_verification "
        "WHERE pod_id=10 AND milestone_id=1 AND status='FAIL'"
    ).fetchone()[0]
    conn.close()
    assert fails == 0


@pytest.mark.anyio
async def test_browser_pass_on_6_does_not_affect_scenario_1():
    pod = _insert_pod(pod_id=11, scenario_id="01")
    conn = get_db_connection()
    with conn:
        conn.execute(
            "INSERT INTO milestone_verification "
            "(pod_id, student_id, scenario_id, milestone_id, status, detection_score, detection_data) "
            "VALUES (?,?,?,?,?,?,?)",
            (11, "student_demo", 6, 1, "PASS", 0, "browser:sqli-m1"),
        )
    conn.close()

    class AlwaysFail:
        async def verify_milestone(self, student_id, scenario_id, milestone_id):
            return "FAIL", "kali fail"

    res = await verify_milestone(
        pod=pod,
        scenario_id=1,
        milestone_id=1,
        scoring_enabled=True,
        ssh_verifier_cls=AlwaysFail,
        detection_enabled=False,
        detection_for=None,
        verify_siem_alert=None,
    )
    assert res.status == "FAIL"


@pytest.mark.anyio
async def test_verify_ignores_other_student_browser_pass_on_reused_pod():
    """Finding 6: student B must not Manual-Check-PASS on student A's leftover row."""
    _insert_pod(pod_id=3, student_id="student_a")
    conn = get_db_connection()
    with conn:
        conn.execute(
            "INSERT INTO milestone_verification "
            "(pod_id, student_id, scenario_id, milestone_id, status, detection_score, detection_data) "
            "VALUES (?,?,?,?,?,?,?)",
            (3, "student_a", 6, 1, "PASS", 0, "browser:sqli-m1"),
        )
    conn.close()
    pod_b = _reassign_pod(3, "student_b")

    class AlwaysFail:
        async def verify_milestone(self, student_id, scenario_id, milestone_id):
            return "FAIL", "would fail on Kali"

    res = await verify_milestone(
        pod=pod_b,
        scenario_id=6,
        milestone_id=1,
        scoring_enabled=True,
        ssh_verifier_cls=AlwaysFail,
        detection_enabled=False,
        detection_for=None,
        verify_siem_alert=None,
    )
    assert res.status == "FAIL"
    assert res.message == "would fail on Kali"


def test_reused_pod_slot_records_browser_pass_per_student(client):
    """Finding 7: two students on the same pod slot each get their own browser PASS."""
    _insert_pod(pod_id=3, student_id="student_a")
    assert (
        client.post(
            "/internal/browser-score",
            json=_body(student_id="student_a", pod_id=3),
            headers=_headers(),
        ).status_code
        == 200
    )
    assert _pass_count(3, 1, student_id="student_a") == 1

    _reassign_pod(3, "student_b")
    r = client.post(
        "/internal/browser-score",
        json=_body(student_id="student_b", pod_id=3),
        headers=_headers(),
    )
    assert r.status_code == 200
    assert r.json()["status"] == "PASS"
    assert _pass_count(3, 1, student_id="student_a") == 1
    assert _pass_count(3, 1, student_id="student_b") == 1
    assert _pass_count(3, 1) == 2
