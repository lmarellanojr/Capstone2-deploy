"""get_lxd_free_mb reads the pool named by LXD_STORAGE_POOL (default "default").

The live host's pool is "cyberrange"; the old hard-coded "default" raised
NotFound on every call, so the admin LXD row showed Unavailable and the
STORAGE_FULL gate silently fell back to coarse DB accounting instead of the
real free space. The fallback now logs a warning.
"""
import logging

from fastapi.testclient import TestClient

from auth import verify_token
from provision_api_fastapi import app
from types import SimpleNamespace

import provision


class _FakeClient:
    pools_asked: list = []

    def __init__(self, project=None):
        pass

    class storage_pools:  # noqa: N801 - mirrors pylxd's attribute name
        @staticmethod
        def get(name):
            _FakeClient.pools_asked.append(name)
            if name != "cyberrange":
                raise LookupError("Storage pool not found")
            space = {"total": 10 * 1024 * 1024 * 1024, "used": 4 * 1024 * 1024 * 1024}
            return SimpleNamespace(resources=SimpleNamespace(get=lambda: SimpleNamespace(space=space)))


def test_uses_configured_pool(monkeypatch):
    _FakeClient.pools_asked = []
    monkeypatch.setattr(provision.pylxd, "Client", _FakeClient)
    monkeypatch.setenv("LXD_STORAGE_POOL", "cyberrange")

    assert provision.get_lxd_free_mb() == 6 * 1024
    assert _FakeClient.pools_asked == ["cyberrange"]


def test_defaults_to_default_pool_and_returns_none_when_missing(monkeypatch):
    _FakeClient.pools_asked = []
    monkeypatch.setattr(provision.pylxd, "Client", _FakeClient)
    monkeypatch.delenv("LXD_STORAGE_POOL", raising=False)

    assert provision.get_lxd_free_mb() is None
    assert _FakeClient.pools_asked == ["default"]


def test_storage_gate_warns_when_it_falls_back(monkeypatch, caplog):
    monkeypatch.setattr("pods_router.available_ram_mb", lambda: 10**6)
    monkeypatch.setattr("pods_router.get_lxd_free_mb", lambda: None)
    monkeypatch.setattr("pods_router.perform_provisioning", lambda *a, **k: None)
    claims = {"preferred_username": "student_demo", "realm_access": {"roles": ["student"]}}
    app.dependency_overrides[verify_token] = lambda: claims

    with caplog.at_level(logging.WARNING, logger="pods_router"):
        res = TestClient(app).post("/pods/provision", json={"student_id": "ignored", "scenario_id": "01"})

    assert res.status_code not in (401, 403, 500)
    assert any("falling back to DB accounting" in r.getMessage() for r in caplog.records)
