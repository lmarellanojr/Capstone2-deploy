"""ADM-SYS-01 infra health (Issue #37). Temp DB via conftest; never live LXD."""
import pytest
from fastapi.testclient import TestClient

from auth import verify_token
from provision_api_fastapi import app
import infra_health as ih


def admin_claims(username="admin1"):
    return {
        "preferred_username": username,
        "realm_access": {"roles": ["admin"]},
    }


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


def test_classify_api_healthy():
    row = ih.classify_api(db_ok=True, available_mb=4096)
    assert row == {
        "name": "API",
        "status": "Healthy",
        "detail": "provisioning API responding",
    }


def test_classify_api_degraded_when_meminfo_unreadable():
    row = ih.classify_api(db_ok=True, available_mb=None)
    assert row["status"] == "Degraded"
    assert row["status"] != "Healthy"


def test_classify_api_unavailable_when_db_fails():
    row = ih.classify_api(db_ok=False, available_mb=4096)
    assert row["status"] == "Unavailable"


def test_classify_lxd_healthy():
    row = ih.classify_lxd(free_mb=20000.0, timed_out=False, pod_storage_mb=7168)
    assert row["name"] == "LXD"
    assert row["status"] == "Healthy"
    assert "20000" in row["detail"]


def test_classify_lxd_degraded_below_pod_storage():
    row = ih.classify_lxd(free_mb=100.0, timed_out=False, pod_storage_mb=7168)
    assert row["status"] == "Degraded"


def test_classify_lxd_unavailable_on_none():
    row = ih.classify_lxd(free_mb=None, timed_out=False, pod_storage_mb=7168)
    assert row["status"] == "Unavailable"


def test_classify_lxd_unavailable_on_timeout():
    row = ih.classify_lxd(free_mb=99999.0, timed_out=True, pod_storage_mb=7168)
    assert row["status"] == "Unavailable"
    assert "timed out" in row["detail"].lower()


def test_timeout_wins_over_a_numeric_reading():
    """A timed-out probe must not be Healthy even if a stale number is present."""
    row = ih.classify_lxd(free_mb=99999.0, timed_out=True, pod_storage_mb=7168)
    assert row["status"] != "Healthy"
