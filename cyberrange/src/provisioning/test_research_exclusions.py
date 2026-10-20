"""PAPER-16 / D.5: leave test and staff accounts out of the knowledge-gain export.

Admins mark test accounts in Admin -> Users (PUT /admin/users/{id}/research-exclusion);
staff roles are read from Keycloak at export time. Nothing is deleted.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import db
import introspect_cache
import keycloak_admin
from auth import verify_token
from provision_api_fastapi import app
from test_admin_users import FakeKeycloak

SALT = "unit-test-research-exclusion-salt"


@pytest.fixture
def kc(monkeypatch):
    monkeypatch.setenv("TELEMETRY_ANONYMIZATION_SALT", SALT)
    introspect_cache.reset_for_tests()
    fake = FakeKeycloak()
    fake.admin_id = fake.add("admin_demo", "admin")
    fake.inst_id = fake.add("teacher", "instructor")
    fake.real_id = fake.add("real_student", "student")
    fake.test_id = fake.add("owner_test", "student")
    app.dependency_overrides[keycloak_admin.get_client] = lambda: fake
    yield fake
    app.dependency_overrides.pop(keycloak_admin.get_client, None)


def _as(username, *roles):
    app.dependency_overrides[verify_token] = lambda: {
        "preferred_username": username,
        "realm_access": {"roles": list(roles)},
    }


def _pass(student_id, scenario_id=1, milestone_id=1):
    conn = db.get_db_connection()
    with conn:
        conn.execute(
            "INSERT INTO milestone_verification (student_id, pod_id, scenario_id, milestone_id, "
            "status, verified_at, detection_score, detection_data) "
            "VALUES (?,1,?,?,'PASS','2026-10-15 01:00:00',0,'state')",
            (student_id, scenario_id, milestone_id),
        )
    conn.close()


def _audit(event):
    conn = db.get_db_connection()
    rows = [
        dict(r)
        for r in conn.execute(
            "SELECT student_id, result, detail FROM audit_log WHERE event_type=? ORDER BY id",
            (event,),
        ).fetchall()
    ]
    conn.close()
    return rows


def _export(client, query="format=json&anonymize=false"):
    return client.get(f"/instructor/export/knowledge-gain?{query}")


# --- Admin -> Users --------------------------------------------------------

def test_admin_marks_and_unmarks_a_test_account(kc):
    client = TestClient(app)
    _as("admin_demo", "admin")

    r = client.put(
        f"/admin/users/{kc.test_id}/research-exclusion",
        json={"excluded": True, "reason": "test_account"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["research_excluded"] is True
    assert r.json()["research_exclusion_reason"] == "test_account"

    listed = {u["username"]: u for u in client.get("/admin/users").json()["users"]}
    assert listed["owner_test"]["research_excluded"] is True
    assert listed["real_student"]["research_excluded"] is False

    r = client.put(f"/admin/users/{kc.test_id}/research-exclusion", json={"excluded": False})
    assert r.status_code == 200
    assert r.json()["research_excluded"] is False

    rows = _audit("ADMIN_USER_RESEARCH_EXCLUDE") + _audit("ADMIN_USER_RESEARCH_INCLUDE")
    assert [(r["student_id"], r["result"]) for r in rows] == [("owner_test", "OK"), ("owner_test", "OK")]
    assert rows[0]["detail"] == "actor=admin_demo reason=test_account"


def test_excluding_needs_a_reason(kc):
    _as("admin_demo", "admin")
    r = TestClient(app).put(f"/admin/users/{kc.test_id}/research-exclusion", json={"excluded": True})
    assert r.status_code == 422


def test_other_writes_keep_the_research_fields(kc):
    """Every user payload carries the flag, so the table never loses it after another action."""
    client = TestClient(app)
    _as("admin_demo", "admin")
    client.put(
        f"/admin/users/{kc.test_id}/research-exclusion",
        json={"excluded": True, "reason": "team_member"},
    )
    r = client.patch(f"/admin/users/{kc.test_id}/enabled", json={"enabled": False})
    assert r.status_code == 200
    assert r.json()["research_excluded"] is True
    assert r.json()["research_exclusion_reason"] == "team_member"


@pytest.mark.parametrize("roles", [("instructor",), ("student",)])
def test_only_admins_can_mark_accounts(kc, roles):
    _as("teacher", *roles)
    r = TestClient(app).put(
        f"/admin/users/{kc.test_id}/research-exclusion",
        json={"excluded": True, "reason": "test_account"},
    )
    assert r.status_code == 403


# --- export ----------------------------------------------------------------

def test_export_leaves_out_marked_and_staff_accounts(kc):
    for sid in ("real_student", "owner_test", "teacher", "admin_demo"):
        _pass(sid)
    client = TestClient(app)
    _as("admin_demo", "admin")
    client.put(
        f"/admin/users/{kc.test_id}/research-exclusion",
        json={"excluded": True, "reason": "test_account"},
    )

    data = _export(client).json()
    assert {r["student_id"] for r in data["records"]} == {"real_student"}
    assert data["summary"]["total_passes"] == 1
    assert data["summary"]["excluded_accounts"] == 3
    assert data["summary"]["staff_exclusion"] == "applied"


def test_instructor_export_is_filtered_too(kc):
    _pass("real_student")
    _pass("teacher")
    _as("teacher", "instructor")
    data = _export(TestClient(app), "format=json").json()
    assert len(data["records"]) == 1
    assert data["summary"]["excluded_accounts"] == 1


def test_csv_reports_exclusions_in_headers(kc):
    _pass("real_student")
    _pass("teacher")
    _as("admin_demo", "admin")
    r = _export(TestClient(app), "format=csv")
    assert r.status_code == 200
    assert r.headers["x-excluded-accounts"] == "1"
    assert r.headers["x-staff-exclusion"] == "applied"
    assert len(r.text.strip().splitlines()) == 2  # header + real_student


def test_admin_can_include_excluded_for_checking(kc):
    _pass("real_student")
    _pass("teacher")
    _as("admin_demo", "admin")
    r = _export(TestClient(app), "format=json&anonymize=false&include_excluded=true")
    assert r.headers["x-staff-exclusion"] == "off"
    data = r.json()
    assert {r["student_id"] for r in data["records"]} == {"real_student", "teacher"}
    assert data["summary"]["excluded_accounts"] == 0
    assert data["summary"]["staff_exclusion"] == "off"


def test_instructor_cannot_include_excluded(kc):
    _as("teacher", "instructor")
    r = _export(TestClient(app), "format=json&include_excluded=true")
    assert r.status_code == 403
    rows = _audit("KNOWLEDGE_GAIN_EXPORTED")
    assert rows[-1]["result"] == "DENIED"
    assert "include_excluded=yes reason=actor_not_admin" in rows[-1]["detail"]


def test_export_says_when_staff_roles_are_unavailable(kc):
    """Keycloak down: marked accounts still apply, staff can't be resolved, and the export says so."""
    _pass("real_student")
    _pass("teacher")
    _pass("owner_test")
    _as("admin_demo", "admin")
    client = TestClient(app)
    r = client.put(
        f"/admin/users/{kc.test_id}/research-exclusion",
        json={"excluded": True, "reason": "test_account"},
    )
    assert r.status_code == 200, r.text
    kc.fail_on.add("staff_usernames")
    data = _export(client).json()
    assert data["summary"]["staff_exclusion"] == "unavailable"
    assert {r["student_id"] for r in data["records"]} == {"real_student", "teacher"}
    assert data["summary"]["excluded_accounts"] == 1


def test_scenario_scope_counts_only_accounts_with_rows_in_scope(kc):
    _pass("real_student", scenario_id=1)
    _pass("teacher", scenario_id=6)
    _as("admin_demo", "admin")
    data = _export(TestClient(app), "format=json&anonymize=false&scenario_id=1").json()
    assert data["summary"]["excluded_accounts"] == 0
    assert {r["student_id"] for r in data["records"]} == {"real_student"}


def test_audit_records_exclusion_counts(kc):
    _pass("real_student")
    _pass("teacher")
    _as("admin_demo", "admin")
    _export(TestClient(app), "format=csv")
    detail = _audit("KNOWLEDGE_GAIN_EXPORTED")[-1]["detail"]
    assert detail.endswith("records=1 excluded_accounts=1 staff_exclusion=applied")
    assert "teacher" not in detail and "real_student" not in detail


def test_exclusion_db_failure_is_audited_and_returns_503(kc, monkeypatch):
    import research_exclusions
    import sqlite3

    def boom(*a, **k):
        raise sqlite3.OperationalError("database is locked")

    monkeypatch.setattr(research_exclusions, "set_exclusion", boom)
    _as("admin_demo", "admin")
    r = TestClient(app).put(
        f"/admin/users/{kc.test_id}/research-exclusion",
        json={"excluded": True, "reason": "test_account"},
    )
    assert r.status_code == 503
    rows = _audit("ADMIN_USER_RESEARCH_EXCLUDE")
    assert [(r["student_id"], r["result"]) for r in rows] == [("owner_test", "FAILED")]
    assert rows[0]["detail"].endswith("reason=test_account reason=db")
