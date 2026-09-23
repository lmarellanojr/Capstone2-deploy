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


from capacity import build_capacity_payload, can_provision_ram, ram_required_mb


def test_build_capacity_payload_keys_match_public_capacity():
    body = build_capacity_payload(
        active_pods=0, avail_mb=8192, max_pods=1, profile_name="oci_12gib"
    )
    assert set(body) == {
        "available_mb",
        "active_pods",
        "max_pods",
        "pod_ram_mb",
        "ram_buffer_mb",
        "profile",
        "ram_required_mb",
        "can_provision",
    }
    assert body["can_provision"] is True
    assert body["ram_required_mb"] == ram_required_mb()


def test_build_capacity_payload_fail_closed_null_meminfo():
    body = build_capacity_payload(
        active_pods=0, avail_mb=None, max_pods=1, profile_name="oci_12gib"
    )
    assert body["available_mb"] is None
    assert body["can_provision"] is False
    assert can_provision_ram(None) is False


CAPACITY_KEYS = {
    "available_mb",
    "active_pods",
    "max_pods",
    "pod_ram_mb",
    "ram_buffer_mb",
    "profile",
    "ram_required_mb",
    "can_provision",
}


def test_infra_health_admin_200_lxd_healthy(monkeypatch):
    monkeypatch.setattr(ih, "available_ram_mb", lambda: 8192)
    monkeypatch.setattr(ih, "probe_lxd_free_mb", lambda: (20000.0, False))
    app.dependency_overrides[verify_token] = lambda: admin_claims()
    client = TestClient(app)
    res = client.get("/admin/infra-health", headers={"Authorization": "Bearer mock"})
    assert res.status_code == 200
    body = res.json()
    assert set(body["capacity"]) == CAPACITY_KEYS
    names = [s["name"] for s in body["services"]]
    assert names == ["API", "LXD"]
    assert {s["name"]: s["status"] for s in body["services"]} == {
        "API": "Healthy",
        "LXD": "Healthy",
    }
    assert "Keycloak" not in names
    assert "Wazuh" not in names
    assert "OVN" not in names


def test_infra_health_lxd_none_is_unavailable_not_healthy(monkeypatch):
    monkeypatch.setattr(ih, "available_ram_mb", lambda: 8192)
    monkeypatch.setattr(ih, "probe_lxd_free_mb", lambda: (None, False))
    app.dependency_overrides[verify_token] = lambda: admin_claims()
    client = TestClient(app)
    body = client.get("/admin/infra-health", headers={"Authorization": "Bearer mock"}).json()
    lxd = next(s for s in body["services"] if s["name"] == "LXD")
    assert lxd["status"] == "Unavailable"


def test_infra_health_lxd_timeout_is_unavailable(monkeypatch):
    monkeypatch.setattr(ih, "available_ram_mb", lambda: 8192)
    monkeypatch.setattr(ih, "probe_lxd_free_mb", lambda: (20000.0, True))
    app.dependency_overrides[verify_token] = lambda: admin_claims()
    client = TestClient(app)
    body = client.get("/admin/infra-health", headers={"Authorization": "Bearer mock"}).json()
    lxd = next(s for s in body["services"] if s["name"] == "LXD")
    assert lxd["status"] == "Unavailable"


def test_infra_health_student_403(monkeypatch):
    monkeypatch.setattr(ih, "probe_lxd_free_mb", lambda: (20000.0, False))
    app.dependency_overrides[verify_token] = lambda: student_claims()
    client = TestClient(app)
    res = client.get("/admin/infra-health", headers={"Authorization": "Bearer mock"})
    assert res.status_code == 403


def test_infra_health_instructor_403(monkeypatch):
    monkeypatch.setattr(ih, "probe_lxd_free_mb", lambda: (20000.0, False))
    app.dependency_overrides[verify_token] = lambda: instructor_claims()
    client = TestClient(app)
    res = client.get("/admin/infra-health", headers={"Authorization": "Bearer mock"})
    assert res.status_code == 403


def test_infra_health_unauthenticated_401(monkeypatch):
    monkeypatch.setattr(ih, "probe_lxd_free_mb", lambda: (20000.0, False))
    app.dependency_overrides.pop(verify_token, None)
    client = TestClient(app)
    res = client.get("/admin/infra-health")
    assert res.status_code in (401, 403)


def test_infra_health_db_failure_api_unavailable_capacity_null(monkeypatch):
    monkeypatch.setattr(ih, "available_ram_mb", lambda: 8192)
    monkeypatch.setattr(ih, "probe_lxd_free_mb", lambda: (20000.0, False))

    def _boom():
        raise RuntimeError("db down")

    monkeypatch.setattr(ih, "get_db_connection", _boom)
    app.dependency_overrides[verify_token] = lambda: admin_claims()
    client = TestClient(app)
    res = client.get("/admin/infra-health", headers={"Authorization": "Bearer mock"})
    assert res.status_code == 200
    body = res.json()
    assert body["capacity"] is None
    api = next(s for s in body["services"] if s["name"] == "API")
    assert api["status"] == "Unavailable"


def test_health_liveness_unchanged_and_does_not_call_lxd(monkeypatch):
    called = {"n": 0}

    def _nope():
        called["n"] += 1
        raise AssertionError("GET /health must not probe LXD")

    # Patch the real I/O entrypoint — /health never imports infra_health.
    monkeypatch.setattr("provision.get_lxd_free_mb", _nope)
    app.dependency_overrides.clear()
    client = TestClient(app)
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}
    assert called["n"] == 0


def test_probe_lxd_caps_in_flight_at_one(monkeypatch):
    """A hung LXD probe must not stack a second worker; waiters share it."""
    import threading
    import time

    started = threading.Event()
    release = threading.Event()
    calls = {"n": 0}

    def _blocking():
        calls["n"] += 1
        started.set()
        release.wait(timeout=5)
        return 20000.0

    monkeypatch.setattr("provision.get_lxd_free_mb", _blocking)
    with ih._lxd_lock:
        ih._lxd_inflight = None

    free1, timed1 = ih.probe_lxd_free_mb(timeout_s=0.15)
    assert timed1 is True
    assert free1 is None
    assert started.wait(1.0)

    # Second caller waits on the same future and also times out (no re-submit).
    free2, timed2 = ih.probe_lxd_free_mb(timeout_s=0.15)
    assert timed2 is True
    assert free2 is None
    assert calls["n"] == 1

    release.set()
    # Let the hung worker finish so later tests start clean.
    deadline = time.time() + 2.0
    while ih._lxd_inflight is not None and not ih._lxd_inflight.done():
        if time.time() > deadline:
            break
        time.sleep(0.05)
    with ih._lxd_lock:
        ih._lxd_inflight = None


def test_probe_lxd_concurrent_waiters_share_result(monkeypatch):
    """Two concurrent probes wait on one job and both get the real result."""
    import threading
    import time

    calls = {"n": 0}
    barrier = threading.Barrier(2)
    results = {}

    def _slow():
        calls["n"] += 1
        time.sleep(0.3)
        return 20000.0

    monkeypatch.setattr("provision.get_lxd_free_mb", _slow)
    with ih._lxd_lock:
        ih._lxd_inflight = None

    def _worker(idx):
        barrier.wait(timeout=2.0)
        results[idx] = ih.probe_lxd_free_mb(timeout_s=2.0)

    threads = [
        threading.Thread(target=_worker, args=(0,)),
        threading.Thread(target=_worker, args=(1,)),
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=5.0)
        assert not t.is_alive()

    assert results[0] == (20000.0, False)
    assert results[1] == (20000.0, False)
    assert calls["n"] == 1

    with ih._lxd_lock:
        ih._lxd_inflight = None


def test_capacity_still_unauthenticated_after_infra_health():
    app.dependency_overrides.clear()
    client = TestClient(app)
    res = client.get("/capacity")
    assert res.status_code == 200
    assert set(res.json()) == CAPACITY_KEYS

