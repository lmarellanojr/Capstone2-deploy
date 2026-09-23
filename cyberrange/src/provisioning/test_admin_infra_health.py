"""ADM-SYS-01 (#37) and ADM-SYS-02 (#55) infra health. Temp DB via conftest;
never live LXD, Keycloak or Wazuh."""
import pytest
import requests
from fastapi.testclient import TestClient

from auth import verify_token
from provision_api_fastapi import app
import infra_health as ih

# Captured before the autouse stub replaces them on the module.
real_check_keycloak = ih.check_keycloak
real_check_wazuh = ih.check_wazuh


@pytest.fixture(autouse=True)
def stub_identity_siem(monkeypatch):
    """Endpoint tests must not reach a real Keycloak or Wazuh."""
    monkeypatch.setattr(ih, "check_keycloak", lambda: ih._row("Keycloak", "Healthy", "stub"))
    monkeypatch.setattr(ih, "check_wazuh", lambda: ih._row("Wazuh", "Healthy", "stub"))
    ih._keycloak_flight.reset()
    ih._wazuh_flight.reset()
    yield
    ih._keycloak_flight.reset()
    ih._wazuh_flight.reset()


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
    assert names == ["API", "LXD", "Keycloak", "Wazuh"]
    assert {s["name"]: s["status"] for s in body["services"]} == {
        "API": "Healthy",
        "LXD": "Healthy",
        "Keycloak": "Healthy",
        "Wazuh": "Healthy",
    }
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



# --- ADM-SYS-02 (#55): Keycloak -------------------------------------------

STATUSES = {"Healthy", "Degraded", "Unavailable"}
SECRET = "s3cr3t-client-secret"


class _Resp:
    def __init__(self, status_code, body=None, json_error=False):
        self.status_code = status_code
        self._body = body
        self._json_error = json_error

    def json(self):
        if self._json_error:
            raise ValueError("not json")
        return self._body


@pytest.fixture
def keycloak_configured(monkeypatch):
    monkeypatch.setattr("auth.AUTH_ENABLED", True)
    monkeypatch.setattr("auth.KEYCLOAK_INTROSPECT", "https://kc.internal/realms/cyber-range/protocol/openid-connect/token/introspect")
    monkeypatch.setattr("auth.KEYCLOAK_CLIENT_SECRET", SECRET)


def _kc_answers(monkeypatch, resp=None, exc=None):
    def _probe(timeout):
        assert timeout <= ih.SERVICE_PROBE_TIMEOUT_S
        if exc is not None:
            raise exc
        return resp

    monkeypatch.setattr("auth.probe_introspection", _probe)


def test_keycloak_healthy_on_inactive_introspection(monkeypatch, keycloak_configured):
    _kc_answers(monkeypatch, _Resp(200, {"active": False}))
    row = real_check_keycloak()
    assert row == {"name": "Keycloak", "status": "Healthy", "detail": "token introspection responding"}


@pytest.mark.parametrize(
    "exc,detail",
    [
        (requests.ConnectTimeout("t"), "timed out"),
        (requests.ReadTimeout("t"), "timed out"),
        (requests.ConnectionError("refused"), "unreachable"),
    ],
)
def test_keycloak_network_failure_is_unavailable(monkeypatch, keycloak_configured, exc, detail):
    _kc_answers(monkeypatch, exc=exc)
    row = real_check_keycloak()
    assert row["status"] == "Unavailable"
    assert detail in row["detail"]


@pytest.mark.parametrize("code", [502, 503, 504])
def test_keycloak_proxy_down_is_unavailable(monkeypatch, keycloak_configured, code):
    _kc_answers(monkeypatch, _Resp(code, json_error=True))
    assert real_check_keycloak()["status"] == "Unavailable"


@pytest.mark.parametrize(
    "resp",
    [
        _Resp(401, {"error": "invalid_client"}),
        _Resp(500, json_error=True),
        _Resp(200, json_error=True),
        _Resp(200, {"unexpected": True}),
        _Resp(200, {"active": True}),
    ],
)
def test_keycloak_reachable_but_wrong_is_degraded(monkeypatch, keycloak_configured, resp):
    _kc_answers(monkeypatch, resp)
    assert real_check_keycloak()["status"] == "Degraded"


@pytest.mark.parametrize(
    "attr,value",
    [
        ("auth.AUTH_ENABLED", False),
        ("auth.KEYCLOAK_INTROSPECT", None),
        ("auth.KEYCLOAK_CLIENT_SECRET", None),
    ],
)
def test_keycloak_unconfigured_is_unavailable_and_not_called(monkeypatch, keycloak_configured, attr, value):
    monkeypatch.setattr(attr, value)
    _kc_answers(monkeypatch, exc=AssertionError("must not call Keycloak"))
    assert real_check_keycloak()["status"] == "Unavailable"


# --- ADM-SYS-02 (#55): Wazuh ----------------------------------------------


def _http_error(code):
    resp = requests.Response()
    resp.status_code = code
    return requests.HTTPError(response=resp)


@pytest.fixture
def wazuh_configured(monkeypatch):
    monkeypatch.setattr("wazuh_client.WAZUH_USER", "scoring")
    monkeypatch.setattr("wazuh_client.WAZUH_PASS", SECRET)


def _wazuh_answers(monkeypatch, token=None, token_exc=None, status=None, status_exc=None):
    def _token(timeout):
        assert timeout <= ih.SERVICE_PROBE_TIMEOUT_S
        if token_exc is not None:
            raise token_exc
        return token

    def _status(tok, timeout):
        assert tok == token
        assert timeout <= ih.SERVICE_PROBE_TIMEOUT_S
        if status_exc is not None:
            raise status_exc
        return status

    monkeypatch.setattr("wazuh_client.get_wazuh_token", _token)
    monkeypatch.setattr("wazuh_client.get_manager_agent_status", _status)


def test_wazuh_healthy_when_manager_active(monkeypatch, wazuh_configured):
    _wazuh_answers(monkeypatch, token="tok", status="active")
    row = real_check_wazuh()
    assert row["name"] == "Wazuh"
    assert row["status"] == "Healthy"


@pytest.mark.parametrize("status", ["disconnected", "never_connected", "pending", None, "weird"])
def test_wazuh_manager_not_active_is_degraded(monkeypatch, wazuh_configured, status):
    _wazuh_answers(monkeypatch, token="tok", status=status)
    row = real_check_wazuh()
    assert row["status"] == "Degraded"
    assert "weird" not in row["detail"]


@pytest.mark.parametrize(
    "kwargs,expected",
    [
        ({"token_exc": requests.ConnectTimeout("t")}, "Unavailable"),
        ({"token": "tok", "status_exc": requests.ReadTimeout("t")}, "Unavailable"),
        ({"token_exc": requests.ConnectionError("refused")}, "Unavailable"),
        ({"token_exc": requests.exceptions.SSLError("bad cert")}, "Degraded"),
        ({"token_exc": _http_error(401)}, "Degraded"),
        ({"token_exc": _http_error(500)}, "Degraded"),
        ({"token_exc": _http_error(503)}, "Unavailable"),
        ({"token": "tok", "status_exc": _http_error(403)}, "Degraded"),
        ({"token": "tok", "status_exc": _http_error(502)}, "Unavailable"),
    ],
)
def test_wazuh_failures_are_never_healthy(monkeypatch, wazuh_configured, kwargs, expected):
    _wazuh_answers(monkeypatch, **kwargs)
    assert real_check_wazuh()["status"] == expected


@pytest.mark.parametrize("attr", ["wazuh_client.WAZUH_USER", "wazuh_client.WAZUH_PASS"])
@pytest.mark.parametrize(
    "ping,expected",
    [
        (401, "Degraded"),
        (requests.exceptions.SSLError("self-signed"), "Degraded"),
        (requests.ConnectionError("refused"), "Unavailable"),
        (requests.ConnectTimeout("t"), "Unavailable"),
    ],
)
def test_wazuh_unconfigured_never_logs_in_and_is_never_healthy(
    monkeypatch, wazuh_configured, attr, ping, expected
):
    """Live host finding: manager up, API has no scoring creds. That is
    Degraded (reachable, not wired), not Unavailable -- and never Healthy."""
    monkeypatch.setattr(attr, "")
    _wazuh_answers(monkeypatch, token_exc=AssertionError("must not log in to Wazuh"))

    def _ping(timeout):
        assert timeout <= ih.SERVICE_PROBE_TIMEOUT_S
        if isinstance(ping, Exception):
            raise ping
        return ping

    monkeypatch.setattr("wazuh_client.ping_manager_api", _ping)
    row = real_check_wazuh()
    assert row["status"] == expected
    assert "not configured" in row["detail"]


# --- ADM-SYS-02 (#55): endpoint wiring --------------------------------------


def _admin_get():
    app.dependency_overrides[verify_token] = lambda: admin_claims()
    client = TestClient(app)
    res = client.get("/admin/infra-health", headers={"Authorization": "Bearer mock"})
    assert res.status_code == 200
    return {s["name"]: s for s in res.json()["services"]}


def test_endpoint_hung_probes_are_unavailable_and_bounded(monkeypatch):
    import threading
    import time

    release = threading.Event()

    def _hang():
        release.wait(timeout=5)
        return ih._row("x", "Healthy", "late")

    monkeypatch.setattr(ih, "available_ram_mb", lambda: 8192)
    monkeypatch.setattr(ih, "probe_lxd_free_mb", lambda: (20000.0, False))
    monkeypatch.setattr(ih, "SERVICE_PROBE_TIMEOUT_S", 0.2)
    monkeypatch.setattr(ih, "check_keycloak", _hang)
    monkeypatch.setattr(ih, "check_wazuh", _hang)
    try:
        started = time.monotonic()
        rows = _admin_get()
        elapsed = time.monotonic() - started
        # Shared deadline: two hung probes cost one timeout, not two.
        assert elapsed < 0.2 * 2
        assert rows["Keycloak"]["status"] == "Unavailable"
        assert rows["Wazuh"]["status"] == "Unavailable"
        assert "timed out" in rows["Keycloak"]["detail"]
        assert rows["LXD"]["status"] == "Healthy"
    finally:
        release.set()


def test_endpoint_probe_crash_is_unavailable(monkeypatch):
    def _boom():
        raise RuntimeError(SECRET)

    monkeypatch.setattr(ih, "available_ram_mb", lambda: 8192)
    monkeypatch.setattr(ih, "probe_lxd_free_mb", lambda: (20000.0, False))
    monkeypatch.setattr(ih, "check_keycloak", _boom)
    monkeypatch.setattr(ih, "check_wazuh", _boom)
    rows = _admin_get()
    assert rows["Keycloak"]["status"] == "Unavailable"
    assert rows["Wazuh"]["status"] == "Unavailable"


def test_endpoint_real_checks_never_leak_secrets(monkeypatch, keycloak_configured, wazuh_configured):
    """Real check_* functions end to end with failing dependencies: no secret,
    URL or exception text may reach the response."""
    monkeypatch.setattr(ih, "available_ram_mb", lambda: 8192)
    monkeypatch.setattr(ih, "probe_lxd_free_mb", lambda: (20000.0, False))
    monkeypatch.setattr(ih, "check_keycloak", real_check_keycloak)
    monkeypatch.setattr(ih, "check_wazuh", real_check_wazuh)
    _kc_answers(monkeypatch, exc=requests.ConnectionError(f"https://kc.internal {SECRET}"))
    _wazuh_answers(monkeypatch, token_exc=requests.ConnectionError(f"https://scoring:{SECRET}@wazuh.internal"))

    app.dependency_overrides[verify_token] = lambda: admin_claims()
    res = TestClient(app).get("/admin/infra-health", headers={"Authorization": "Bearer mock"})
    assert res.status_code == 200
    assert SECRET not in res.text
    assert ".internal" not in res.text
    rows = {s["name"]: s for s in res.json()["services"]}
    assert rows["Keycloak"]["status"] == "Unavailable"
    assert rows["Wazuh"]["status"] == "Unavailable"
    assert {s["status"] for s in rows.values()} <= STATUSES


def test_endpoint_still_admin_only_with_new_rows(monkeypatch):
    calls = {"n": 0}

    def _count():
        calls["n"] += 1
        return ih._row("Keycloak", "Healthy", "stub")

    monkeypatch.setattr(ih, "check_keycloak", _count)
    monkeypatch.setattr(ih, "check_wazuh", _count)
    for claims in (student_claims(), instructor_claims()):
        app.dependency_overrides[verify_token] = lambda c=claims: c
        res = TestClient(app).get("/admin/infra-health", headers={"Authorization": "Bearer mock"})
        assert res.status_code == 403
    # Forbidden callers must not trigger outbound Keycloak/Wazuh probes.
    assert calls["n"] == 0


def test_single_flight_shares_a_hung_probe():
    import threading

    release = threading.Event()
    calls = {"n": 0}

    def _hang():
        calls["n"] += 1
        release.wait(timeout=5)
        return {}

    flight = ih._SingleFlight()
    f1 = flight.start(_hang)
    f2 = flight.start(_hang)
    assert f1 is f2
    release.set()
    f1.result(timeout=2)
    assert calls["n"] == 1
    f3 = flight.start(lambda: {})
    assert f3 is not f1


def test_keycloak_down_returns_the_503_the_admin_ui_recognizes(monkeypatch):
    """portal/src/lib/infraHealth.ts matches this exact detail to show Keycloak
    (not the API) as Unavailable when Keycloak is down. Keep them in sync."""
    import auth as auth_mod

    def _down(*a, **kw):
        raise requests.ConnectionError("keycloak down")

    monkeypatch.setattr(auth_mod.requests, "post", _down)
    monkeypatch.setattr(auth_mod, "KEYCLOAK_INTROSPECT", "https://kc.internal/introspect")
    app.dependency_overrides.pop(verify_token, None)
    res = TestClient(app).get(
        "/admin/infra-health", headers={"Authorization": "Bearer not-in-cache-55"}
    )
    assert res.status_code == 503
    assert res.json() == {"detail": "Auth service unavailable"}
