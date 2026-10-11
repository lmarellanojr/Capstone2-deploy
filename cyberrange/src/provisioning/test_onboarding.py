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
