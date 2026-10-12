"""Shared pytest bootstrapping for src/provisioning.

pylxd is not installed in the test environment; every test module in this
package needs the same stand-in before any of auth/db/pods_router/etc. get
imported. pytest imports conftest.py before collecting test files in this
directory, so this stub runs first regardless of which test file pytest
happens to collect first.

`temp_db` is the autouse fixture that was copy-pasted verbatim across
test_admin_pods.py, test_reviews.py, and (until this change) this package's
own test_role_guard_matrix.py: a fresh temp SQLite file per test, migrated,
wired into config.DB_PATH/db.DB_PATH, AUTH_ENABLED forced on, and a default
student claim on verify_token so most tests don't have to set one themselves.
Individual tests that need a different caller still do
`app.dependency_overrides[verify_token] = lambda: ...` to override the
default, and tests that need NO caller at all (genuinely unauthenticated)
clear it with `app.dependency_overrides.pop(verify_token, None)`.

Deliberately NOT folded in here: test_pod_ttl.py's `ttl_db` and
test_score_persistence.py's `persist_db`. Those are a different, simpler
shape (non-autouse, tmp_path-based, no default claims override at all) --
unifying them with `temp_db` would mean renaming their fixture parameter in
every test that uses them and deciding whether AUTH_ENABLED/a default claim
should apply to tests that currently don't set either, which is a real
behavior decision, not a mechanical move.
"""
import os
import sys
import tempfile
from types import ModuleType

if "pylxd" not in sys.modules:
    _pylxd = ModuleType("pylxd")
    _exc = ModuleType("pylxd.exceptions")
    _exc.NotFound = type("NotFound", (Exception,), {})
    _pylxd.exceptions = _exc
    _pylxd.Client = object
    sys.modules["pylxd"] = _pylxd
    sys.modules["pylxd.exceptions"] = _exc

import pytest

import migrate
from auth import verify_token
from provision_api_fastapi import app


def _default_student_claims(username: str = "student1") -> dict:
    return {
        "preferred_username": username,
        "realm_access": {"roles": ["student"]},
    }


@pytest.fixture(autouse=True)
def temp_db(monkeypatch):
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tf:
        db_path = tf.name
    tf.close()
    monkeypatch.setattr("config.DB_PATH", db_path)
    monkeypatch.setattr("db.DB_PATH", db_path)
    monkeypatch.setattr("auth.AUTH_ENABLED", True)

    app.dependency_overrides[verify_token] = lambda: _default_student_claims()

    migrate.apply(db_path)
    yield db_path
    app.dependency_overrides.clear()
    if os.path.exists(db_path):
        try:
            os.unlink(db_path)
        except OSError:
            pass
