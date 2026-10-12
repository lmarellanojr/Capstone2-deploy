"""Booking provisioning endpoint regression tests; Keycloak and SMTP are faked."""
import uuid

from fastapi.testclient import TestClient

import booking_router
import credential_email
from keycloak_admin import KeycloakAdminClient, get_client
from provision_api_fastapi import app


class FakeKeycloak:
    def __init__(self):
        self.users = {}
        self.roles = {}
        self.passwords = {}
        self.fail_password = False
        self.fail_role = False
        self.create_then_fail = False

    def find_users_by_email(self, email):
        return [dict(u) for u in self.users.values() if u.get("email", "").lower() == email]

    def create_user(self, *, username, email, first_name, last_name):
        uid = str(uuid.uuid4())
        self.users[uid] = {"id": uid, "username": username, "email": email, "enabled": True}
        self.roles[uid] = []
        if self.create_then_fail:
            from keycloak_admin import KeycloakAdminError
            raise KeycloakAdminError("create response timed out after commit")
        return uid

    def set_password(self, uid, password, temporary):
        if self.fail_password:
            from keycloak_admin import KeycloakRejected
            raise KeycloakRejected("policy")
        self.passwords[uid] = (password, temporary)

    def set_app_role(self, uid, role):
        if self.fail_role:
            from keycloak_admin import KeycloakAdminError
            raise KeycloakAdminError("role assignment failed")
        self.roles[uid] = [role]

    def get_user(self, uid):
        return dict(self.users[uid])

    def user_app_roles(self, uid):
        return list(self.roles[uid])

    def delete_user(self, uid):
        self.users.pop(uid, None)
        self.roles.pop(uid, None)
        self.passwords.pop(uid, None)


def client_for(monkeypatch, kc):
    monkeypatch.setenv("BOOKING_PROVISION_SECRET", "test-secret")
    app.dependency_overrides[get_client] = lambda: kc
    return TestClient(app)


def test_creates_student_and_never_returns_credentials(temp_db, monkeypatch):
    kc = FakeKeycloak()
    delivered = []
    monkeypatch.setattr(credential_email, "send_temporary_credentials", lambda **kwargs: delivered.append(kwargs))
    client = client_for(monkeypatch, kc)
    response = client.post("/internal/booking/user", headers={"X-Booking-Provision-Secret": "test-secret"}, json={"email": "tester@mmdc.mcl.edu.ph"})

    assert response.status_code == 200
    assert response.json() == {"status": "created", "credential_email_status": "sent"}
    assert len(kc.users) == 1
    user = next(iter(kc.users.values()))
    assert user["enabled"] is True
    assert kc.roles[user["id"]] == ["student"]
    assert kc.passwords[user["id"]][1] is True
    assert delivered[0]["recipient"] == "tester@mmdc.mcl.edu.ph"
    assert delivered[0]["password"] == kc.passwords[user["id"]][0]
    assert "password" not in response.text.lower()
    assert "username" not in response.text.lower()
    repeat = client.post("/internal/booking/user", headers={"X-Booking-Provision-Secret": "test-secret"}, json={"email": "tester@mmdc.mcl.edu.ph"})
    assert repeat.json() == {"status": "existing", "credential_email_status": "skipped"}
    assert len(delivered) == 1


def test_repeat_booking_reuses_without_reset_or_resending(temp_db, monkeypatch):
    kc = FakeKeycloak()
    uid = str(uuid.uuid4())
    kc.users[uid] = {"id": uid, "username": "tester", "email": "tester@mmdc.mcl.edu.ph", "enabled": True}
    kc.roles[uid] = ["student"]
    kc.passwords[uid] = ("existing-password", False)
    monkeypatch.setattr(credential_email, "send_temporary_credentials", lambda **kwargs: (_ for _ in ()).throw(AssertionError("must not email")))
    client = client_for(monkeypatch, kc)

    for _ in range(2):
        response = client.post("/internal/booking/user", headers={"X-Booking-Provision-Secret": "test-secret"}, json={"email": "TESTER@mmdc.mcl.edu.ph"})
        assert response.json() == {"status": "existing", "credential_email_status": "skipped"}
    assert kc.passwords[uid] == ("existing-password", False)


def test_rejects_wrong_secret_and_non_mmdc_email(temp_db, monkeypatch):
    kc = FakeKeycloak()
    client = client_for(monkeypatch, kc)
    denied = client.post("/internal/booking/user", headers={"X-Booking-Provision-Secret": "wrong"}, json={"email": "a@mmdc.mcl.edu.ph"})
    invalid = client.post("/internal/booking/user", headers={"X-Booking-Provision-Secret": "test-secret"}, json={"email": "a@example.com"})
    assert denied.status_code == 401
    assert invalid.status_code == 422
    assert kc.users == {}


def test_existing_non_student_requires_review_without_mutation(temp_db, monkeypatch):
    kc = FakeKeycloak()
    uid = str(uuid.uuid4())
    kc.users[uid] = {"id": uid, "username": "adminuser", "email": "tester@mmdc.mcl.edu.ph", "enabled": True}
    kc.roles[uid] = ["admin"]
    kc.passwords[uid] = ("unchanged", False)
    client = client_for(monkeypatch, kc)
    response = client.post("/internal/booking/user", headers={"X-Booking-Provision-Secret": "test-secret"}, json={"email": "tester@mmdc.mcl.edu.ph"})
    assert response.json() == {"status": "needs_review", "credential_email_status": "skipped"}
    assert kc.roles[uid] == ["admin"]
    assert kc.passwords[uid] == ("unchanged", False)


def test_email_failure_is_recorded_and_setup_is_not_retried(temp_db, monkeypatch):
    kc = FakeKeycloak()
    monkeypatch.setattr(credential_email, "send_temporary_credentials", lambda **kwargs: (_ for _ in ()).throw(RuntimeError("smtp")))
    client = client_for(monkeypatch, kc)
    headers = {"X-Booking-Provision-Secret": "test-secret"}
    first = client.post("/internal/booking/user", headers=headers, json={"email": "tester@mmdc.mcl.edu.ph"})
    second = client.post("/internal/booking/user", headers=headers, json={"email": "tester@mmdc.mcl.edu.ph"})
    assert first.json() == {"status": "email_failed", "credential_email_status": "failed"}
    assert second.json() == {"status": "email_failed", "credential_email_status": "failed"}
    assert len(kc.users) == 1


def test_password_policy_rejection_rolls_back_partial_user(temp_db, monkeypatch):
    kc = FakeKeycloak()
    kc.fail_password = True
    client = client_for(monkeypatch, kc)
    response = client.post("/internal/booking/user", headers={"X-Booking-Provision-Secret": "test-secret"}, json={"email": "tester@mmdc.mcl.edu.ph"})
    assert response.json() == {"status": "failed", "credential_email_status": "skipped"}
    assert kc.users == {}


def test_role_assignment_failure_rolls_back_partial_user(temp_db, monkeypatch):
    kc = FakeKeycloak()
    kc.fail_role = True
    client = client_for(monkeypatch, kc)
    response = client.post("/internal/booking/user", headers={"X-Booking-Provision-Secret": "test-secret"}, json={"email": "tester@mmdc.mcl.edu.ph"})
    assert response.json() == {"status": "failed", "credential_email_status": "skipped"}
    assert kc.users == {}


def test_ambiguous_create_result_requires_review_and_is_not_retried(temp_db, monkeypatch):
    kc = FakeKeycloak()
    kc.create_then_fail = True
    client = client_for(monkeypatch, kc)
    headers = {"X-Booking-Provision-Secret": "test-secret"}
    first = client.post("/internal/booking/user", headers=headers, json={"email": "tester@mmdc.mcl.edu.ph"})
    second = client.post("/internal/booking/user", headers=headers, json={"email": "tester@mmdc.mcl.edu.ph"})
    assert first.json() == {"status": "needs_review", "credential_email_status": "skipped"}
    assert second.json() == {"status": "needs_review", "credential_email_status": "skipped"}
    assert len(kc.users) == 1


def test_cached_claim_rechecks_current_account_eligibility(temp_db, monkeypatch):
    kc = FakeKeycloak()
    uid = str(uuid.uuid4())
    kc.users[uid] = {"id": uid, "username": "tester", "email": "tester@mmdc.mcl.edu.ph", "enabled": True}
    kc.roles[uid] = ["student"]
    client = client_for(monkeypatch, kc)
    headers = {"X-Booking-Provision-Secret": "test-secret"}
    first = client.post("/internal/booking/user", headers=headers, json={"email": "tester@mmdc.mcl.edu.ph"})
    assert first.json()["status"] == "existing"
    kc.users[uid]["enabled"] = False
    second = client.post("/internal/booking/user", headers=headers, json={"email": "tester@mmdc.mcl.edu.ph"})
    assert second.json() == {"status": "needs_review", "credential_email_status": "skipped"}
    assert kc.users[uid]["enabled"] is False


def test_claim_is_cross_worker_idempotent_and_owner_guarded(temp_db):
    email = "tester@mmdc.mcl.edu.ph"
    assert booking_router._claim(email, "first-owner") == "owner"
    assert booking_router._claim(email, "second-owner") == "pending"
    assert booking_router._finish(email, "second-owner", "created") is False
    assert booking_router._finish(email, "first-owner", "created") is True
    assert booking_router._claim(email, "third-owner") == "existing_check"


def test_known_failure_can_be_retried_only_by_new_claim_owner(temp_db):
    email = "retry@mmdc.mcl.edu.ph"
    assert booking_router._claim(email, "first-owner") == "owner"
    assert booking_router._finish(email, "first-owner", "failed") is True
    assert booking_router._claim(email, "retry-owner") == "owner"
    assert booking_router._finish(email, "first-owner", "created") is False
    assert booking_router._finish(email, "retry-owner", "needs_review") is True


def test_keycloak_lookup_uses_bounded_exact_email_query(monkeypatch):
    kc = KeycloakAdminClient("https://keycloak.test", "realm", "client", "secret")
    calls = []

    class Response:
        def json(self):
            return [
                {"id": "1", "username": "student", "email": "tester@mmdc.mcl.edu.ph"},
                {"id": "2", "username": "service-account-booking", "email": "tester@mmdc.mcl.edu.ph"},
            ]

    def request(method, path, **kwargs):
        calls.append((method, path, kwargs))
        return Response()

    monkeypatch.setattr(kc, "_request", request)
    assert [u["username"] for u in kc.find_users_by_email("tester@mmdc.mcl.edu.ph")] == ["student"]
    assert calls == [("GET", "/users", {"params": {"email": "tester@mmdc.mcl.edu.ph", "exact": "true", "first": 0, "max": 10, "briefRepresentation": "true"}})]
