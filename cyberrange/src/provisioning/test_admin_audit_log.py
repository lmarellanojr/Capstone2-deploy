"""Admin read access to audit_log (admin gaps item 3): GET /admin/audit-log."""
import pytest
from fastapi.testclient import TestClient

import db
from auth import verify_token
from provision_api_fastapi import app

# temp_db (fresh SQLite per test) is an autouse fixture in conftest.py.


def claims(username, role):
    return {"preferred_username": username, "realm_access": {"roles": [role]}}


def as_caller(c):
    app.dependency_overrides[verify_token] = lambda: c


def seed(*events):
    for event_type, student_id, result in events:
        db.log_event(event_type, student_id=student_id, result=result, detail=f"actor=admin_demo target={student_id}")


@pytest.fixture
def client():
    return TestClient(app)


def test_admin_reads_newest_first(client):
    seed(("ADMIN_USER_CREATE", "a", "OK"), ("ADMIN_USER_DISABLE", "b", "OK"), ("ADMIN_POD_FORCE_DESTROY", "c", "OK"))
    as_caller(claims("admin_demo", "admin"))
    r = client.get("/admin/audit-log")
    assert r.status_code == 200
    body = r.json()
    assert [e["student_id"] for e in body["events"]] == ["c", "b", "a"]
    assert set(body["events"][0]) == {"id", "event_type", "student_id", "pod_id", "vmid", "result", "detail", "timestamp"}
    assert body["next_before_id"] is None
    assert body["event_types"] == sorted({"ADMIN_USER_CREATE", "ADMIN_USER_DISABLE", "ADMIN_POD_FORCE_DESTROY"})


def test_filters_combine(client):
    seed(("ADMIN_USER_ROLE_SET", "a", "OK"), ("ADMIN_USER_ROLE_SET", "a", "DENIED"), ("ADMIN_USER_ROLE_SET", "b", "OK"))
    as_caller(claims("admin_demo", "admin"))
    body = client.get("/admin/audit-log", params={"event_type": "ADMIN_USER_ROLE_SET", "student_id": "a", "result": "denied"}).json()
    assert [(e["student_id"], e["result"]) for e in body["events"]] == [("a", "DENIED")]


def test_keyset_paging_walks_every_row_once(client):
    seed(*[("EVT", f"s{i}", "OK") for i in range(7)])
    as_caller(claims("admin_demo", "admin"))
    seen, before = [], None
    for _ in range(10):
        params = {"limit": 3, **({"before_id": before} if before else {})}
        body = client.get("/admin/audit-log", params=params).json()
        seen += [e["student_id"] for e in body["events"]]
        before = body["next_before_id"]
        if before is None:
            break
    assert seen == [f"s{i}" for i in range(6, -1, -1)]


@pytest.mark.parametrize("params", [{"limit": 0}, {"limit": 501}, {"before_id": 0}, {"event_type": "x" * 65}])
def test_rejects_bad_query(client, params):
    as_caller(claims("admin_demo", "admin"))
    assert client.get("/admin/audit-log", params=params).status_code == 422


def test_filter_values_are_parameters_not_sql(client):
    seed(("EVT", "a", "OK"))
    as_caller(claims("admin_demo", "admin"))
    r = client.get("/admin/audit-log", params={"student_id": "a' OR '1'='1"})
    assert r.status_code == 200
    assert r.json()["events"] == []


@pytest.mark.parametrize("role", ["student", "instructor"])
def test_non_admin_gets_403(client, role):
    seed(("EVT", "a", "OK"))
    as_caller(claims("someone", role))
    assert client.get("/admin/audit-log").status_code == 403


def test_unauthenticated_gets_401(client):
    app.dependency_overrides.pop(verify_token, None)
    assert client.get("/admin/audit-log").status_code == 401


def test_audit_log_is_read_only():
    # No route may edit or delete audit history.
    paths = app.openapi()["paths"]
    writes = {(p, m) for p, ops in paths.items() for m in ops if "audit" in p and m != "get"}
    assert writes == set()
