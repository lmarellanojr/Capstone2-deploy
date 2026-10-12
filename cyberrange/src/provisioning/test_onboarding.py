import sqlite3

from fastapi.testclient import TestClient

from auth import verify_token
from provision_api_fastapi import app


client = TestClient(app)


def set_claims(subject: str, username: str = "student1"):
    app.dependency_overrides[verify_token] = lambda: {
        "sub": subject,
        "preferred_username": username,
        "realm_access": {"roles": ["student"]},
    }


def test_new_user_has_not_completed_orientation():
    set_claims("subject-new")

    response = client.get("/users/me/orientation")

    assert response.status_code == 200
    assert response.json() == {"completed": False}


def test_completion_is_persistent_and_idempotent():
    set_claims("subject-complete")

    assert client.post("/users/me/orientation").json() == {"completed": True}
    assert client.get("/users/me/orientation").json() == {"completed": True}
    assert client.post("/users/me/orientation").json() == {"completed": True}


def test_completion_timestamp_is_preserved_on_repeated_post(monkeypatch):
    set_claims("subject-timestamp")
    class FixedTimestamp:
        def __init__(self, value):
            self.value = value

        def isoformat(self):
            return self.value

    timestamps = iter([
        FixedTimestamp("2026-10-12T01:02:03+00:00"),
        FixedTimestamp("2026-10-12T04:05:06+00:00"),
    ])
    monkeypatch.setattr("onboarding_router.datetime", type("FixedDateTime", (), {
        "now": staticmethod(lambda _tz: next(timestamps)),
    }))

    assert client.post("/users/me/orientation").status_code == 200
    assert client.post("/users/me/orientation").status_code == 200

    import config
    conn = sqlite3.connect(config.DB_PATH)
    timestamp = conn.execute(
        "SELECT orientation_completed_at FROM user_onboarding WHERE subject = ?",
        ("subject-timestamp",),
    ).fetchone()[0]
    conn.close()
    assert timestamp == "2026-10-12T01:02:03Z"


def test_orientation_state_is_isolated_by_keycloak_subject():
    set_claims("subject-a")
    assert client.post("/users/me/orientation").status_code == 200

    set_claims("subject-b")
    assert client.get("/users/me/orientation").json() == {"completed": False}


def test_orientation_requires_a_subject_claim():
    app.dependency_overrides[verify_token] = lambda: {
        "preferred_username": "student1",
        "realm_access": {"roles": ["student"]},
    }

    response = client.get("/users/me/orientation")

    assert response.status_code == 401
