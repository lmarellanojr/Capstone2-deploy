"""Unit tests for ADM-POD Admin list/inspect/force-destroy (Issue #29)."""
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import db
import auth
from auth import verify_token
from provision_api_fastapi import app

# pylxd stub and the temp_db autouse fixture (fresh SQLite per test, default
# student claim on verify_token) now live in conftest.py -- shared with
# test_reviews.py and test_role_guard_matrix.py, which had byte-identical
# copies of both.


def student_claims(username="student1"):
    return {
        "preferred_username": username,
        "realm_access": {"roles": ["student"]},
    }


def instructor_claims(username="instructor1"):
    return {
        "preferred_username": username,
        "realm_access": {"roles": ["instructor"]},
    }


def admin_claims(username="admin1"):
    return {
        "preferred_username": username,
        "realm_access": {"roles": ["admin"]},
    }


def _insert_pod(
    pod_id,
    student_id,
    status="ACTIVE",
    scenario_id="01",
    vmid_kali=None,
    vmid_meta=None,
    vmid_dvwa=None,
):
    conn = db.get_db_connection()
    try:
        conn.execute(
            "INSERT INTO pods ("
            "  pod_id, student_id, scenario_id, status, "
            "  vmid_kali, vmid_meta, vmid_dvwa"
            ") VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                pod_id,
                student_id,
                scenario_id,
                status,
                vmid_kali or f"pod-{student_id}-kali",
                vmid_meta or f"pod-{student_id}-meta",
                vmid_dvwa or f"pod-{student_id}-dvwa",
            ),
        )
        conn.commit()
    finally:
        conn.close()


# --- Task 1: require_owner_or_admin ---


def test_require_owner_or_admin_allows_admin_non_owner():
    pod = {"student_id": "student1", "pod_id": 1}
    auth.require_owner_or_admin(pod, admin_claims())


def test_require_owner_or_admin_allows_owner():
    pod = {"student_id": "student1", "pod_id": 1}
    auth.require_owner_or_admin(pod, student_claims("student1"))


def test_require_owner_or_admin_denies_student_non_owner():
    pod = {"student_id": "student1", "pod_id": 1}
    with pytest.raises(HTTPException) as ei:
        auth.require_owner_or_admin(pod, student_claims("other"))
    assert ei.value.status_code == 404


def test_require_owner_or_admin_denies_instructor_non_owner():
    pod = {"student_id": "student1", "pod_id": 1}
    with pytest.raises(HTTPException) as ei:
        auth.require_owner_or_admin(pod, instructor_claims())
    assert ei.value.status_code == 404


# --- Task 2: Admin GET /pods list-all ---


def test_admin_list_pods_returns_all_live_pods():
    _insert_pod(1, "student1", status="ACTIVE")
    _insert_pod(2, "student2", status="ACTIVE")
    app.dependency_overrides[verify_token] = lambda: admin_claims()
    client = TestClient(app)
    res = client.get("/pods", headers={"Authorization": "Bearer mock"})
    assert res.status_code == 200
    body = res.json()
    assert "count" not in body
    pods = body["pods"]
    assert len(pods) == 2
    owners = {p["student_id"] for p in pods}
    assert owners == {"student1", "student2"}
    assert all("vmid_kali" in p for p in pods)


def test_admin_list_pods_honors_student_id_query():
    _insert_pod(1, "student1", status="ACTIVE")
    _insert_pod(2, "student2", status="ACTIVE")
    app.dependency_overrides[verify_token] = lambda: admin_claims()
    client = TestClient(app)
    res = client.get(
        "/pods",
        params={"student_id": "student2"},
        headers={"Authorization": "Bearer mock"},
    )
    assert res.status_code == 200
    pods = res.json()["pods"]
    assert len(pods) == 1
    assert pods[0]["student_id"] == "student2"
    assert "vmid_kali" in pods[0]


def test_student_list_pods_self_scoped():
    _insert_pod(1, "student1", status="ACTIVE")
    _insert_pod(2, "student2", status="ACTIVE")
    app.dependency_overrides[verify_token] = lambda: student_claims("student1")
    client = TestClient(app)
    res = client.get("/pods", headers={"Authorization": "Bearer mock"})
    assert res.status_code == 200
    pods = res.json()["pods"]
    assert len(pods) == 1
    assert pods[0]["student_id"] == "student1"
    assert "vmid_kali" in pods[0]


def test_instructor_list_pods_not_host_wide():
    _insert_pod(1, "student1", status="ACTIVE")
    _insert_pod(2, "student2", status="ACTIVE")
    app.dependency_overrides[verify_token] = lambda: instructor_claims("instructor1")
    client = TestClient(app)
    res = client.get("/pods", headers={"Authorization": "Bearer mock"})
    assert res.status_code == 200
    assert res.json()["pods"] == []


def test_list_pods_unauthenticated_401():
    app.dependency_overrides.clear()
    client = TestClient(app)
    res = client.get("/pods")
    assert res.status_code == 401


# --- Task 3: Admin GET /pods/{pod_id}/status ---


def test_admin_status_inspects_other_student_pod():
    _insert_pod(1, "student1", status="ACTIVE", scenario_id="01")
    app.dependency_overrides[verify_token] = lambda: admin_claims()
    client = TestClient(app)
    res = client.get("/pods/1/status", headers={"Authorization": "Bearer mock"})
    assert res.status_code == 200
    body = res.json()
    assert body["student_id"] == "student1"
    assert body["status"] == "ACTIVE"
    assert body["scenario_id"] == "01"
    assert "vmid_kali" in body
    assert "id" not in body


def test_student_status_other_pod_404():
    _insert_pod(1, "student1", status="ACTIVE")
    app.dependency_overrides[verify_token] = lambda: student_claims("other")
    client = TestClient(app)
    res = client.get("/pods/1/status", headers={"Authorization": "Bearer mock"})
    assert res.status_code == 404


def test_instructor_status_other_pod_404():
    _insert_pod(1, "student1", status="ACTIVE")
    app.dependency_overrides[verify_token] = lambda: instructor_claims()
    client = TestClient(app)
    res = client.get("/pods/1/status", headers={"Authorization": "Bearer mock"})
    assert res.status_code == 404


def test_status_missing_pod_404():
    app.dependency_overrides[verify_token] = lambda: admin_claims()
    client = TestClient(app)
    res = client.get("/pods/99/status", headers={"Authorization": "Bearer mock"})
    assert res.status_code == 404


def test_status_unauthenticated_401():
    app.dependency_overrides.clear()
    client = TestClient(app)
    res = client.get("/pods/1/status")
    assert res.status_code == 401


# --- Task 4: Admin force-destroy ---


def test_admin_force_destroy_active(monkeypatch):
    destroyed = []
    monkeypatch.setattr(
        "pods_router.perform_destruction",
        lambda pod: destroyed.append(pod["pod_id"]),
    )
    _insert_pod(1, "student1", status="ACTIVE")
    app.dependency_overrides[verify_token] = lambda: admin_claims()
    client = TestClient(app)
    res = client.delete("/admin/pods/1/force-destroy", headers={"Authorization": "Bearer mock"})
    assert res.status_code == 200
    assert res.json() == {"status": "destroying", "pod_id": 1}
    conn = db.get_db_connection()
    row = conn.execute("SELECT status FROM pods WHERE pod_id=1").fetchone()
    conn.close()
    assert row["status"] == "DESTROYING"
    assert destroyed == [1]


def test_admin_force_destroy_destroying_409(monkeypatch):
    """Already-DESTROYING: no re-dispatch (avoids concurrent LXD); reaper owns stuck retry."""
    destroyed = []
    monkeypatch.setattr(
        "pods_router.perform_destruction",
        lambda pod: destroyed.append(pod["pod_id"]),
    )
    _insert_pod(1, "student1", status="DESTROYING")
    app.dependency_overrides[verify_token] = lambda: admin_claims()
    client = TestClient(app)
    res = client.delete("/admin/pods/1/force-destroy", headers={"Authorization": "Bearer mock"})
    assert res.status_code == 409
    assert destroyed == []


def test_admin_force_destroy_provisioning_409(monkeypatch):
    destroyed = []
    monkeypatch.setattr(
        "pods_router.perform_destruction",
        lambda pod: destroyed.append(pod["pod_id"]),
    )
    _insert_pod(1, "student1", status="PROVISIONING")
    app.dependency_overrides[verify_token] = lambda: admin_claims()
    client = TestClient(app)
    res = client.delete("/admin/pods/1/force-destroy", headers={"Authorization": "Bearer mock"})
    assert res.status_code == 409
    assert destroyed == []


def test_force_destroy_student_403(monkeypatch):
    monkeypatch.setattr("pods_router.perform_destruction", lambda pod: None)
    _insert_pod(1, "student1", status="ACTIVE")
    app.dependency_overrides[verify_token] = lambda: student_claims("student1")
    client = TestClient(app)
    res = client.delete("/admin/pods/1/force-destroy", headers={"Authorization": "Bearer mock"})
    assert res.status_code == 403


def test_force_destroy_instructor_403(monkeypatch):
    monkeypatch.setattr("pods_router.perform_destruction", lambda pod: None)
    _insert_pod(1, "student1", status="ACTIVE")
    app.dependency_overrides[verify_token] = lambda: instructor_claims()
    client = TestClient(app)
    res = client.delete("/admin/pods/1/force-destroy", headers={"Authorization": "Bearer mock"})
    assert res.status_code == 403


def test_force_destroy_unauthenticated_401():
    app.dependency_overrides.clear()
    client = TestClient(app)
    res = client.delete("/admin/pods/1/force-destroy")
    assert res.status_code == 401


def test_force_destroy_missing_pod_404(monkeypatch):
    monkeypatch.setattr("pods_router.perform_destruction", lambda pod: None)
    app.dependency_overrides[verify_token] = lambda: admin_claims()
    client = TestClient(app)
    res = client.delete("/admin/pods/99/force-destroy", headers={"Authorization": "Bearer mock"})
    assert res.status_code == 404


def test_force_destroy_destroyed_409(monkeypatch):
    destroyed = []
    monkeypatch.setattr(
        "pods_router.perform_destruction",
        lambda pod: destroyed.append(pod["pod_id"]),
    )
    _insert_pod(1, "student1", status="DESTROYED")
    app.dependency_overrides[verify_token] = lambda: admin_claims()
    client = TestClient(app)
    res = client.delete("/admin/pods/1/force-destroy", headers={"Authorization": "Bearer mock"})
    assert res.status_code == 409
    assert destroyed == []


def test_student_destroy_own_active_still_works(monkeypatch):
    destroyed = []
    monkeypatch.setattr(
        "pods_router.perform_destruction",
        lambda pod: destroyed.append(pod["pod_id"]),
    )
    _insert_pod(1, "student1", status="ACTIVE")
    app.dependency_overrides[verify_token] = lambda: student_claims("student1")
    client = TestClient(app)
    res = client.delete("/pods/1/destroy", headers={"Authorization": "Bearer mock"})
    assert res.status_code == 200
    assert destroyed == [1]


def test_student_destroy_other_pod_404(monkeypatch):
    monkeypatch.setattr("pods_router.perform_destruction", lambda pod: None)
    _insert_pod(1, "student1", status="ACTIVE")
    app.dependency_overrides[verify_token] = lambda: student_claims("other")
    client = TestClient(app)
    res = client.delete("/pods/1/destroy", headers={"Authorization": "Bearer mock"})
    assert res.status_code == 404


# --- Task 5: capacity reuse smoke ---


def test_capacity_still_unauthenticated_200():
    app.dependency_overrides.clear()
    client = TestClient(app)
    res = client.get("/capacity")
    assert res.status_code == 200
    body = res.json()
    for key in ("active_pods", "max_pods", "can_provision", "available_mb"):
        assert key in body


# --- force-destroy audit trail (admin gaps item 2) ---


def _audit(event="ADMIN_POD_FORCE_DESTROY"):
    conn = db.get_db_connection()
    try:
        rows = conn.execute(
            "SELECT student_id, pod_id, result, detail FROM audit_log WHERE event_type=? ORDER BY id",
            (event,),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def test_force_destroy_records_which_admin_destroyed_whose_pod(monkeypatch):
    monkeypatch.setattr("pods_router.perform_destruction", lambda pod: None)
    _insert_pod(1, "student1", status="ACTIVE")
    app.dependency_overrides[verify_token] = lambda: admin_claims("admin_demo")
    assert TestClient(app).delete("/admin/pods/1/force-destroy").status_code == 200
    [row] = _audit()
    assert row["student_id"] == "student1"
    assert row["pod_id"] == 1
    assert row["result"] == "OK"
    assert "actor=admin_demo" in row["detail"]
    assert "previous_status=ACTIVE" in row["detail"]


def test_force_destroy_refused_by_state_is_audited_as_failed(monkeypatch):
    monkeypatch.setattr("pods_router.perform_destruction", lambda pod: None)
    _insert_pod(1, "student1", status="PROVISIONING")
    app.dependency_overrides[verify_token] = lambda: admin_claims("admin_demo")
    assert TestClient(app).delete("/admin/pods/1/force-destroy").status_code == 409
    [row] = _audit()
    assert row["result"] == "FAILED"
    assert "reason=state" in row["detail"] and "status=PROVISIONING" in row["detail"]


def test_force_destroy_missing_pod_is_audited_as_failed(monkeypatch):
    monkeypatch.setattr("pods_router.perform_destruction", lambda pod: None)
    app.dependency_overrides[verify_token] = lambda: admin_claims("admin_demo")
    assert TestClient(app).delete("/admin/pods/99/force-destroy").status_code == 404
    [row] = _audit()
    assert (row["pod_id"], row["result"]) == (99, "FAILED")
    assert "reason=not_found" in row["detail"]


@pytest.mark.parametrize("claims_fn", [student_claims, instructor_claims])
def test_force_destroy_denied_by_role_writes_no_audit_row(monkeypatch, claims_fn):
    # SEC-02 relies on this: a denied non-Admin request leaves audit_log untouched.
    monkeypatch.setattr("pods_router.perform_destruction", lambda pod: None)
    _insert_pod(1, "student1", status="ACTIVE")
    app.dependency_overrides[verify_token] = lambda: claims_fn()
    assert TestClient(app).delete("/admin/pods/1/force-destroy").status_code == 403
    assert _audit() == []


def test_force_destroy_still_succeeds_if_audit_write_fails(monkeypatch):
    destroyed = []
    monkeypatch.setattr("pods_router.perform_destruction", lambda pod: destroyed.append(pod["pod_id"]))

    def broken_log_event(*a, **k):
        raise RuntimeError("audit db locked")

    monkeypatch.setattr("pods_router.log_event", broken_log_event)
    _insert_pod(1, "student1", status="ACTIVE")
    app.dependency_overrides[verify_token] = lambda: admin_claims("admin_demo")
    assert TestClient(app).delete("/admin/pods/1/force-destroy").status_code == 200
    assert destroyed == [1]
