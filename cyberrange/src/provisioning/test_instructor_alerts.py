"""Instructor read-only SIEM view (SIEM audit gap 6).

GET /instructor/pods/{pod_id}/alerts lets Instructors/Admins see any student's
pod alerts with the same allowlisted fields and pod-lifetime cutoff as the
Student route (SIEM-SCOPE #112). Students are refused before the pod lookup,
so they can't probe other pods through it. The five-caller role boundary is
also in test_sec01_rbac_matrix.py.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import alerts_endpoint as ae
import alerts_reader
from auth import verify_token
from provision_api_fastapi import app
from test_siem_scope import _alert, _insert_active_pod


def _as(username: str, *roles: str) -> TestClient:
    claims = {"preferred_username": username, "realm_access": {"roles": list(roles)}}
    app.dependency_overrides[verify_token] = lambda: claims
    app.dependency_overrides[ae.verify_token_dep] = lambda: claims
    return TestClient(app)


@pytest.fixture
def alice_pod(monkeypatch):
    now = datetime.now(timezone.utc)
    _insert_active_pod(1, "alice", now - timedelta(minutes=10), {"meta": "012"})
    raw = b"\n".join([
        _alert(now - timedelta(minutes=45), "007", "pod-alice-meta"),   # previous pod
        _alert(now - timedelta(minutes=2), "012", "pod-alice-meta"),    # this pod
        _alert(now - timedelta(minutes=1), "044", "pod-bob-meta"),      # someone else
    ])
    monkeypatch.setattr(alerts_reader, "_read_manager_tail", lambda: (raw, False))


@pytest.mark.parametrize("roles", [("instructor",), ("admin",)])
def test_staff_see_only_that_pods_alerts(alice_pod, roles):
    res = _as("staff_user", *roles).get("/instructor/pods/1/alerts")

    assert res.status_code == 200
    body = res.json()
    assert body["total_count"] == 1
    assert [(a["agent_id"], a["agent_name"]) for a in body["alerts"]] == [("012", "pod-alice-meta")]


def test_same_safe_fields_as_student_route(alice_pod):
    staff = _as("instructor_demo", "instructor").get("/instructor/pods/1/alerts").json()
    owner = _as("alice", "student").get("/pods/1/alerts").json()

    assert staff == owner
    assert set(staff["alerts"][0]) == set(alerts_reader.ALLOWED_KEYS)


@pytest.mark.parametrize("pod_id", [1, 999])
def test_student_refused_before_pod_lookup(alice_pod, pod_id):
    # Even the pod's owner can't use the staff route, and a missing pod gives
    # the same 403 as an existing one (no pod-id probing).
    res = _as("alice", "student").get(f"/instructor/pods/{pod_id}/alerts")

    assert res.status_code == 403


def test_missing_pod_is_404_for_staff(alice_pod):
    assert _as("instructor_demo", "instructor").get("/instructor/pods/999/alerts").status_code == 404


def test_module_stub_fails_closed():
    # If the production wiring were ever dropped, the default must refuse.
    with pytest.raises(HTTPException) as exc:
        ae._deny_staff({"realm_access": {"roles": ["admin"]}})
    assert exc.value.status_code == 403
