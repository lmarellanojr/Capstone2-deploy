"""ADM-USER (issue #32): Admin-only Keycloak user & role management.

Router tests run against FakeKeycloak (in-memory, same interface as
keycloak_admin.KeycloakAdminClient) wired in via dependency_overrides, so no
Keycloak is needed. The HTTP client itself is covered at the bottom against a
fake requests session. Every test gets a temporary SQLite DB from conftest.py's
temp_db fixture -- never the shared pod_mgmt.db.
"""
import uuid

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import db
import introspect_cache
import keycloak_admin
import users_router
from auth import verify_token
from keycloak_admin import (
    APP_ROLES,
    KeycloakAdminClient,
    KeycloakAdminError,
    KeycloakConflict,
    KeycloakNotConfigured,
    KeycloakNotFound,
    KeycloakRejected,
)
from provision_api_fastapi import app

NOISE_ROLES = ["offline_access", "uma_authorization", "default-roles-cyber-range"]


def claims(username, *roles):
    return {"preferred_username": username, "realm_access": {"roles": list(roles) + NOISE_ROLES}}


ADMIN = claims("admin_demo", "admin")
INSTRUCTOR = claims("instructor_demo", "instructor")
STUDENT = claims("student_demo", "student")
NO_ROLE = claims("no_app_role_user")


class FakeKeycloak:
    """In-memory stand-in for KeycloakAdminClient."""

    def __init__(self):
        self.users: dict[str, dict] = {}
        self.roles: dict[str, set] = {}
        self.passwords: dict[str, tuple] = {}
        self.logged_out: list[str] = []
        self.fail_on: set = set()
        self.reject_password = False

    def add(self, username, *roles, enabled=True):
        uid = str(uuid.uuid4())
        self.users[uid] = {
            "id": uid,
            "username": username,
            "enabled": enabled,
            "createdTimestamp": 1790000000000,
        }
        self.roles[uid] = set(roles) | {"default-roles-cyber-range"}
        return uid

    def _maybe_fail(self, op):
        if op in self.fail_on:
            raise KeycloakAdminError(f"{op} failed")

    def get_user(self, user_id):
        self._maybe_fail("get_user")
        user = self.users.get(user_id)
        if not user or user["username"].startswith("service-account-"):
            raise KeycloakNotFound(user_id)
        return dict(user)

    def list_users(self, *, search, first, max_results):
        self._maybe_fail("list_users")
        users = [u for u in self.users.values() if not u["username"].startswith("service-account-")]
        if search:
            users = [u for u in users if search in u["username"]]
        return [dict(u) for u in users[first : first + max_results]]

    def enabled_admins(self):
        self._maybe_fail("enabled_admins")
        return [
            dict(self.users[uid]) for uid, rs in self.roles.items()
            if "admin" in rs and self.users[uid]["enabled"]
            and not self.users[uid]["username"].startswith("service-account-")
        ]

    def usernames(self):
        return {u["username"] for u in self.users.values()}

    def app_role_members(self):
        return {uid: [r for r in APP_ROLES if r in rs] for uid, rs in self.roles.items()}

    def user_app_roles(self, user_id):
        return [r for r in APP_ROLES if r in self.roles[user_id]]

    def create_user(self, *, username, email, first_name, last_name):
        self._maybe_fail("create_user")
        if any(u["username"] == username for u in self.users.values()):
            raise KeycloakConflict(username)
        uid = self.add(username)
        self.users[uid].update({"email": email, "firstName": first_name, "lastName": last_name})
        return uid

    def set_password(self, user_id, password, temporary):
        if self.reject_password:
            raise KeycloakRejected("policy")
        self._maybe_fail("set_password")
        self.passwords[user_id] = (password, temporary)

    def delete_user(self, user_id):
        self._maybe_fail("delete_user")
        self.users.pop(user_id, None)
        self.roles.pop(user_id, None)

    def set_enabled(self, user_id, enabled):
        self._maybe_fail("set_enabled")
        self.users[user_id]["enabled"] = enabled

    def logout_user(self, user_id):
        self.logged_out.append(user_id)

    def set_app_role(self, user_id, role):
        self._maybe_fail("set_app_role")
        self.roles[user_id] = (self.roles[user_id] - set(APP_ROLES)) | {role}


@pytest.fixture
def kc():
    introspect_cache.reset_for_tests()
    fake = FakeKeycloak()
    # The acting Admin must really be an enabled admin in Keycloak: writes
    # re-check the caller there rather than trusting cached token claims.
    fake.admin_id = fake.add("admin_demo", "admin")
    app.dependency_overrides[keycloak_admin.get_client] = lambda: fake
    return fake


@pytest.fixture
def client():
    return TestClient(app)


def as_caller(c):
    app.dependency_overrides[verify_token] = lambda: c


def audit_rows(event=None):
    conn = db.get_db_connection()
    try:
        q = "SELECT event_type, student_id, result, detail FROM audit_log"
        rows = conn.execute(q + (" WHERE event_type=?" if event else ""), (event,) if event else ()).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


NEW_USER = {
    "username": "test_student1",
    "email": "test_student1@local",
    "first_name": "Test",
    "last_name": "Student",
    "role": "student",
    "password": "Tmp!pass-1234",
}

PLACEHOLDER_ID = "00000000-0000-0000-0000-000000000000"
ROUTES = [
    ("get", "/admin/users", None),
    ("post", "/admin/users", NEW_USER),
    ("patch", f"/admin/users/{PLACEHOLDER_ID}/enabled", {"enabled": False}),
    ("put", f"/admin/users/{PLACEHOLDER_ID}/role", {"role": "student"}),
    ("put", f"/admin/users/{PLACEHOLDER_ID}/password", {"password": "New!pass-5678"}),
]


# --- authorization boundary -------------------------------------------------


@pytest.mark.parametrize("method,path,body", ROUTES)
def test_unauthenticated_gets_401(client, kc, method, path, body):
    app.dependency_overrides.pop(verify_token, None)
    r = getattr(client, method)(path, **({"json": body} if body else {}))
    assert r.status_code == 401
    assert kc.usernames() == {"admin_demo"}


@pytest.mark.parametrize("caller", [STUDENT, INSTRUCTOR, NO_ROLE], ids=["student", "instructor", "no_role"])
@pytest.mark.parametrize("method,path,body", ROUTES)
def test_non_admin_gets_403(client, kc, caller, method, path, body):
    as_caller(caller)
    r = getattr(client, method)(path, **({"json": body} if body else {}))
    assert r.status_code == 403
    assert kc.usernames() == {"admin_demo"}


# --- list -------------------------------------------------------------------


def test_list_users_returns_app_role_and_hides_service_accounts(client, kc):
    as_caller(ADMIN)
    kc.add("student_demo", "student")
    kc.add("service-account-cyberrange-user-admin")
    kc.add("norole_user")
    r = client.get("/admin/users")
    assert r.status_code == 200
    by_name = {u["username"]: u for u in r.json()["users"]}
    assert set(by_name) == {"student_demo", "admin_demo", "norole_user"}
    assert by_name["student_demo"]["role"] == "student"
    assert by_name["student_demo"]["roles"] == ["student"]
    assert by_name["student_demo"]["enabled"] is True
    assert by_name["student_demo"]["created_at"].endswith("Z")
    assert by_name["norole_user"]["role"] is None
    # Keycloak-internal roles are never reported as application roles.
    assert all("default-roles-cyber-range" not in u["roles"] for u in by_name.values())


def test_list_rejects_oversized_page(client, kc):
    as_caller(ADMIN)
    assert client.get("/admin/users?max=500").status_code == 422


# --- create -----------------------------------------------------------------


def test_create_user_happy_path(client, kc):
    as_caller(ADMIN)
    r = client.post("/admin/users", json=NEW_USER)
    assert r.status_code == 201
    body = r.json()
    assert body["username"] == "test_student1"
    assert body["role"] == "student"
    assert body["enabled"] is True
    assert "password" not in body
    uid = body["id"]
    assert kc.user_app_roles(uid) == ["student"]
    assert kc.passwords[uid] == ("Tmp!pass-1234", True)  # temporary by default


def test_create_user_can_set_permanent_password(client, kc):
    as_caller(ADMIN)
    r = client.post("/admin/users", json={**NEW_USER, "temporary_password": False})
    assert r.status_code == 201
    assert kc.passwords[r.json()["id"]][1] is False


@pytest.mark.parametrize("role", ["student", "instructor", "admin"])
def test_create_user_each_app_role(client, kc, role):
    as_caller(ADMIN)
    r = client.post("/admin/users", json={**NEW_USER, "role": role})
    assert r.status_code == 201
    assert kc.user_app_roles(r.json()["id"]) == [role]


@pytest.mark.parametrize(
    "override",
    [
        {"role": "superadmin"},
        {"role": "default-roles-cyber-range"},
        {"role": "offline_access"},
        {"username": "Upper_Case"},
        {"username": "bad name"},
        {"username": "-leadingdash"},
        {"username": "x" * 33},
        {"password": "short"},
        {"email": "not-an-email"},
        {"realmRoles": ["admin"]},
        {"enabled": False},
        {"credentials": [{"type": "password", "value": "x"}]},
    ],
)
def test_create_user_rejects_invalid_or_smuggled_fields(client, kc, override):
    as_caller(ADMIN)
    r = client.post("/admin/users", json={**NEW_USER, **override})
    assert r.status_code == 422
    assert kc.usernames() == {"admin_demo"}


def test_create_duplicate_username_409(client, kc):
    as_caller(ADMIN)
    kc.add("test_student1", "student")
    r = client.post("/admin/users", json=NEW_USER)
    assert r.status_code == 409
    rows = audit_rows("ADMIN_USER_CREATE")
    assert rows[-1]["result"] == "FAILED" and "reason=exists" in rows[-1]["detail"]


def test_create_rolls_back_when_role_assignment_fails(client, kc):
    as_caller(ADMIN)
    kc.fail_on.add("set_app_role")
    r = client.post("/admin/users", json=NEW_USER)
    assert r.status_code == 503
    assert not any(u["username"] == "test_student1" for u in kc.users.values())
    assert "rolled_back" in audit_rows("ADMIN_USER_CREATE")[-1]["detail"]


def test_create_password_policy_rejection_is_422_and_rolled_back(client, kc):
    as_caller(ADMIN)
    kc.reject_password = True
    r = client.post("/admin/users", json=NEW_USER)
    assert r.status_code == 422
    assert kc.usernames() == {"admin_demo"}
    assert "reason=password_policy rolled_back" in audit_rows("ADMIN_USER_CREATE")[-1]["detail"]


def test_create_is_audited_without_password(client, kc):
    as_caller(ADMIN)
    client.post("/admin/users", json=NEW_USER)
    rows = audit_rows("ADMIN_USER_CREATE")
    assert rows == [
        {
            "event_type": "ADMIN_USER_CREATE",
            "student_id": "test_student1",
            "result": "OK",
            "detail": "actor=admin_demo role=student temporary_password=True",
        }
    ]
    assert all(NEW_USER["password"] not in str(r) for r in audit_rows())


# --- enable / disable ---------------------------------------------------------


def test_disable_then_enable_user(client, kc):
    as_caller(ADMIN)
    uid = kc.add("student_demo", "student")
    r = client.patch(f"/admin/users/{uid}/enabled", json={"enabled": False})
    assert r.status_code == 200
    assert r.json()["enabled"] is False
    assert kc.users[uid]["enabled"] is False
    # Disabling ends sessions so refresh tokens / introspection stop working.
    assert kc.logged_out == [uid]

    r = client.patch(f"/admin/users/{uid}/enabled", json={"enabled": True})
    assert r.status_code == 200
    assert r.json()["enabled"] is True
    assert kc.logged_out == [uid]  # enabling does not log anyone out

    events = [(r["event_type"], r["result"]) for r in audit_rows()]
    assert events == [("ADMIN_USER_DISABLE", "OK"), ("ADMIN_USER_ENABLE", "OK")]


def test_admin_cannot_disable_self(client, kc):
    as_caller(ADMIN)
    uid = kc.admin_id
    r = client.patch(f"/admin/users/{uid}/enabled", json={"enabled": False})
    assert r.status_code == 409
    assert kc.users[uid]["enabled"] is True
    assert audit_rows("ADMIN_USER_DISABLE")[-1]["result"] == "DENIED"


def test_enabled_unknown_user_404(client, kc):
    as_caller(ADMIN)
    assert client.patch(f"/admin/users/{PLACEHOLDER_ID}/enabled", json={"enabled": False}).status_code == 404


def test_service_account_is_not_manageable(client, kc):
    as_caller(ADMIN)
    uid = kc.add("service-account-cyberrange-user-admin")
    assert client.patch(f"/admin/users/{uid}/enabled", json={"enabled": False}).status_code == 404
    assert kc.users[uid]["enabled"] is True


def test_malformed_user_id_422(client, kc):
    as_caller(ADMIN)
    assert client.patch("/admin/users/..%2Fclients/enabled", json={"enabled": False}).status_code in (404, 422)
    assert client.patch("/admin/users/not-a-uuid/enabled", json={"enabled": False}).status_code == 422


# --- role assignment ------------------------------------------------------------


def test_role_change_replaces_app_role_and_keeps_internal_roles(client, kc):
    as_caller(ADMIN)
    uid = kc.add("student_demo", "student")
    r = client.put(f"/admin/users/{uid}/role", json={"role": "instructor"})
    assert r.status_code == 200
    assert r.json()["role"] == "instructor"
    assert r.json()["roles"] == ["instructor"]
    assert kc.roles[uid] == {"instructor", "default-roles-cyber-range"}
    assert kc.logged_out == [uid]
    row = audit_rows("ADMIN_USER_ROLE_SET")[-1]
    assert row["result"] == "OK"
    assert row["detail"] == "actor=admin_demo role=instructor previous=student"


def test_role_unchanged_does_not_log_user_out(client, kc):
    as_caller(ADMIN)
    uid = kc.add("student_demo", "student")
    assert client.put(f"/admin/users/{uid}/role", json={"role": "student"}).status_code == 200
    assert kc.logged_out == []


def test_role_change_collapses_multi_role_user_to_one(client, kc):
    as_caller(ADMIN)
    uid = kc.add("odd_user", "student", "instructor")
    r = client.put(f"/admin/users/{uid}/role", json={"role": "student"})
    assert r.json()["roles"] == ["student"]


def test_role_rejects_non_app_role(client, kc):
    as_caller(ADMIN)
    uid = kc.add("student_demo", "student")
    for bad in ["realm-admin", "manage-users", "default-roles-cyber-range", "Admin"]:
        assert client.put(f"/admin/users/{uid}/role", json={"role": bad}).status_code == 422
    assert kc.user_app_roles(uid) == ["student"]


def test_admin_cannot_change_own_role(client, kc):
    as_caller(ADMIN)
    uid = kc.admin_id
    r = client.put(f"/admin/users/{uid}/role", json={"role": "student"})
    assert r.status_code == 409
    assert kc.user_app_roles(uid) == ["admin"]
    assert audit_rows("ADMIN_USER_ROLE_SET")[-1]["result"] == "DENIED"


def test_admin_can_demote_another_admin(client, kc):
    as_caller(ADMIN)
    uid = kc.add("other_admin", "admin")
    assert client.put(f"/admin/users/{uid}/role", json={"role": "student"}).status_code == 200
    assert kc.user_app_roles(uid) == ["student"]


# --- PR #88 review: revoked Admins, cached tokens, last Admin -------------------


def test_demoted_admin_with_cached_admin_claims_cannot_write(client, kc):
    """Token claims still say admin (introspection cache), Keycloak says student."""
    as_caller(ADMIN)
    kc.set_app_role(kc.admin_id, "student")
    victim = kc.add("other_admin", "admin")
    assert client.post("/admin/users", json={**NEW_USER, "role": "admin"}).status_code == 403
    assert client.patch(f"/admin/users/{victim}/enabled", json={"enabled": False}).status_code == 403
    assert client.put(f"/admin/users/{victim}/role", json={"role": "student"}).status_code == 403
    assert kc.usernames() == {"admin_demo", "other_admin"}
    assert kc.users[victim]["enabled"] is True and kc.user_app_roles(victim) == ["admin"]
    assert {r["detail"].split("reason=")[-1] for r in audit_rows()} == {"actor_not_admin"}


def test_disabled_admin_with_cached_claims_cannot_write(client, kc):
    as_caller(ADMIN)
    kc.users[kc.admin_id]["enabled"] = False
    assert client.post("/admin/users", json=NEW_USER).status_code == 403
    assert kc.usernames() == {"admin_demo"}


def test_revoked_admin_cannot_retaliate(client, kc):
    """Admin A demotes Admin B; B's still-cached admin token then tries to demote A."""
    b_id = kc.add("admin_b", "admin")
    as_caller(ADMIN)
    assert client.put(f"/admin/users/{b_id}/role", json={"role": "student"}).status_code == 200
    as_caller(claims("admin_b", "admin"))  # stale claims
    assert client.put(f"/admin/users/{kc.admin_id}/role", json={"role": "student"}).status_code == 403
    assert client.patch(f"/admin/users/{kc.admin_id}/enabled", json={"enabled": False}).status_code == 403
    assert kc.user_app_roles(kc.admin_id) == ["admin"] and kc.users[kc.admin_id]["enabled"] is True
    assert [u["username"] for u in kc.enabled_admins()] == ["admin_demo"]


def _cache_token_for(uid, username):
    import time

    token = f"token-of-{username}"
    introspect_cache.store(
        token,
        {"active": True, "sub": uid, "preferred_username": username, "exp": time.time() + 300,
         "realm_access": {"roles": ["admin"]}},
    )
    return token


def test_disable_evicts_target_tokens_from_introspection_cache(client, kc):
    as_caller(ADMIN)
    uid = kc.add("other_admin", "admin")
    token = _cache_token_for(uid, "other_admin")
    bystander = _cache_token_for(kc.admin_id, "admin_demo")
    assert client.patch(f"/admin/users/{uid}/enabled", json={"enabled": False}).status_code == 200
    assert introspect_cache.get_cached(token) is None
    assert introspect_cache.get_cached(bystander) is not None  # nobody else is logged out


def test_role_change_evicts_target_tokens_from_introspection_cache(client, kc):
    as_caller(ADMIN)
    uid = kc.add("other_admin", "admin")
    token = _cache_token_for(uid, "other_admin")
    assert client.put(f"/admin/users/{uid}/role", json={"role": "student"}).status_code == 200
    assert introspect_cache.get_cached(token) is None


def test_unchanged_role_keeps_cached_token(client, kc):
    as_caller(ADMIN)
    uid = kc.add("other_admin", "admin")
    token = _cache_token_for(uid, "other_admin")
    assert client.put(f"/admin/users/{uid}/role", json={"role": "admin"}).status_code == 200
    assert introspect_cache.get_cached(token) is not None


def test_enable_does_not_evict_tokens(client, kc):
    as_caller(ADMIN)
    uid = kc.add("student_x", "student")
    token = _cache_token_for(uid, "student_x")
    assert client.patch(f"/admin/users/{uid}/enabled", json={"enabled": True}).status_code == 200
    assert introspect_cache.get_cached(token) is not None


def test_last_admin_backstop():
    target = {"id": "a1", "username": "only_admin"}
    with pytest.raises(HTTPException) as e:
        users_router._reject_last_admin([{"id": "a1", "username": "only_admin"}], target, "x", "ADMIN_USER_DISABLE", "")
    assert e.value.status_code == 409
    assert audit_rows("ADMIN_USER_DISABLE")[-1]["detail"] == "actor=x reason=last_admin"
    # Another enabled Admin remains -> allowed.
    users_router._reject_last_admin(
        [{"id": "a1"}, {"id": "a2"}], target, "x", "ADMIN_USER_DISABLE", ""
    )


def test_keycloak_down_during_admin_recheck_is_503(client, kc):
    as_caller(ADMIN)
    kc.fail_on.add("enabled_admins")
    assert client.post("/admin/users", json=NEW_USER).status_code == 503
    assert kc.usernames() == {"admin_demo"}


def test_introspect_cache_invalidate_user_only_removes_that_user():
    introspect_cache.reset_for_tests()
    t1 = _cache_token_for("u1", "alice")
    t2 = _cache_token_for("u2", "bob")
    assert introspect_cache.invalidate_user(sub="u1") == 1
    assert introspect_cache.get_cached(t1) is None and introspect_cache.get_cached(t2) is not None
    assert introspect_cache.invalidate_user(username="bob") == 1
    assert introspect_cache.get_cached(t2) is None


# --- degraded Keycloak ------------------------------------------------------------


def test_keycloak_failure_is_503_and_audited(client, kc):
    as_caller(ADMIN)
    uid = kc.add("student_demo", "student")
    kc.fail_on.add("set_enabled")
    r = client.patch(f"/admin/users/{uid}/enabled", json={"enabled": False})
    assert r.status_code == 503
    assert audit_rows("ADMIN_USER_DISABLE")[-1]["result"] == "FAILED"


def test_unconfigured_client_is_503_not_crash(client):
    as_caller(ADMIN)
    app.dependency_overrides[keycloak_admin.get_client] = lambda: KeycloakAdminClient(None, None, None, None)
    r = client.get("/admin/users")
    assert r.status_code == 503
    assert r.json()["detail"] == "User management is not configured"


def test_student_flows_unaffected_when_user_management_unconfigured(client):
    # Unconfigured Keycloak admin must not break unrelated endpoints.
    app.dependency_overrides[keycloak_admin.get_client] = lambda: KeycloakAdminClient(None, None, None, None)
    as_caller(STUDENT)
    assert client.get("/pods").status_code == 200
    assert client.get("/health").status_code == 200


# --- no public signup -------------------------------------------------------------


def test_no_unauthenticated_route_can_create_users():
    """Every route that can reach Keycloak user writes is under /admin/users and
    guarded by verify_token -- there is no signup/register route anywhere."""
    # The OpenAPI schema, not app.routes: newer FastAPI nests included routers.
    paths = app.openapi()["paths"]
    assert paths, "no routes found -- this test would pass vacuously"
    assert not any(k in p.lower() for p in paths for k in ("signup", "sign-up", "register"))
    user_write_routes = {
        (path, method.upper())
        for path, ops in paths.items()
        for method in ops
        if path.startswith("/admin/users") and method in {"post", "put", "patch", "delete"}
    }
    assert user_write_routes == {
        ("/admin/users", "POST"),
        ("/admin/users/{user_id}/enabled", "PATCH"),
        ("/admin/users/{user_id}/role", "PUT"),
        ("/admin/users/{user_id}/password", "PUT"),
    }


# --- password reset (audit item 4) ----------------------------------------------


def test_reset_password_sets_it_ends_sessions_and_evicts_tokens(client, kc):
    as_caller(ADMIN)
    uid = kc.add("student_demo", "student")
    token = _cache_token_for(uid, "student_demo")
    r = client.put(f"/admin/users/{uid}/password", json={"password": "New!pass-5678"})
    assert r.status_code == 200
    body = r.json()
    assert body["username"] == "student_demo"
    assert "password" not in body
    # temporary defaults to True: Keycloak forces a change at next sign-in.
    assert kc.passwords[uid] == ("New!pass-5678", True)
    assert kc.logged_out == [uid]
    assert introspect_cache.get_cached(token) is None


def test_reset_password_can_be_permanent(client, kc):
    as_caller(ADMIN)
    uid = kc.add("student_demo", "student")
    assert client.put(f"/admin/users/{uid}/password", json={"password": "New!pass-5678", "temporary": False}).status_code == 200
    assert kc.passwords[uid] == ("New!pass-5678", False)


def test_reset_password_is_audited_without_the_password(client, kc):
    as_caller(ADMIN)
    uid = kc.add("student_demo", "student")
    client.put(f"/admin/users/{uid}/password", json={"password": "New!pass-5678"})
    rows = audit_rows("ADMIN_USER_PASSWORD_RESET")
    assert [(r["student_id"], r["result"]) for r in rows] == [("student_demo", "OK")]
    assert "actor=admin_demo" in rows[0]["detail"]
    assert all("New!pass-5678" not in (r["detail"] or "") for r in audit_rows())


def test_admin_cannot_reset_own_password(client, kc):
    as_caller(ADMIN)
    r = client.put(f"/admin/users/{kc.admin_id}/password", json={"password": "New!pass-5678"})
    assert r.status_code == 409
    assert kc.admin_id not in kc.passwords
    assert kc.logged_out == []
    assert audit_rows("ADMIN_USER_PASSWORD_RESET")[-1]["result"] == "DENIED"


@pytest.mark.parametrize("body", [
    {"password": "short"},
    {"password": "x" * 129},
    {},
    {"password": "New!pass-5678", "credentials": [{"type": "password"}]},
])
def test_reset_password_validates_body(client, kc, body):
    as_caller(ADMIN)
    uid = kc.add("student_demo", "student")
    assert client.put(f"/admin/users/{uid}/password", json=body).status_code == 422
    assert uid not in kc.passwords


def test_reset_password_policy_rejection_is_422_and_keeps_sessions(client, kc):
    as_caller(ADMIN)
    uid = kc.add("student_demo", "student")
    kc.reject_password = True
    r = client.put(f"/admin/users/{uid}/password", json={"password": "New!pass-5678"})
    assert r.status_code == 422
    assert r.json()["detail"] == "Password does not meet the Keycloak password policy"
    assert kc.logged_out == []  # nothing changed, so nobody is signed out
    assert audit_rows("ADMIN_USER_PASSWORD_RESET")[-1]["result"] == "FAILED"


def test_reset_password_unknown_or_service_account_404(client, kc):
    as_caller(ADMIN)
    assert client.put(f"/admin/users/{PLACEHOLDER_ID}/password", json={"password": "New!pass-5678"}).status_code == 404
    svc = kc.add("service-account-cyberrange-user-admin")
    assert client.put(f"/admin/users/{svc}/password", json={"password": "New!pass-5678"}).status_code == 404
    assert svc not in kc.passwords


def test_demoted_admin_with_cached_claims_cannot_reset_passwords(client, kc):
    # Same re-check as the other writes: a token that still says admin is not enough.
    kc.add("ex_admin", "student")
    as_caller(claims("ex_admin", "admin"))
    uid = kc.add("student_demo", "student")
    assert client.put(f"/admin/users/{uid}/password", json={"password": "New!pass-5678"}).status_code == 403
    assert uid not in kc.passwords


def test_reset_password_keycloak_down_is_503(client, kc):
    as_caller(ADMIN)
    uid = kc.add("student_demo", "student")
    kc.fail_on.add("set_password")
    assert client.put(f"/admin/users/{uid}/password", json={"password": "New!pass-5678"}).status_code == 503
    assert audit_rows("ADMIN_USER_PASSWORD_RESET")[-1]["result"] == "FAILED"


# --- KeycloakAdminClient HTTP behaviour -------------------------------------------


class FakeResponse:
    def __init__(self, status_code, body=None, headers=None):
        self.status_code = status_code
        self._body = body
        self.headers = headers or {}

    def json(self):
        return self._body


class FakeSession:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def post(self, url, **kw):
        self.calls.append(("POST", url, kw))
        return self.responses.pop(0)

    def request(self, method, url, **kw):
        self.calls.append((method, url, kw))
        return self.responses.pop(0)


TOKEN_OK = FakeResponse(200, {"access_token": "svc-token", "expires_in": 300})


def make_client(responses):
    session = FakeSession(responses)
    return KeycloakAdminClient("http://kc/auth", "cyber-range", "cyberrange-user-admin", "s3cret", session=session), session


def test_client_uses_client_credentials_and_caches_token():
    kc, s = make_client([TOKEN_OK, FakeResponse(200, []), FakeResponse(200, [])])
    kc.list_users(search=None, first=0, max_results=10)
    kc.list_users(search=None, first=0, max_results=10)
    token_calls = [c for c in s.calls if c[1].endswith("/protocol/openid-connect/token")]
    assert len(token_calls) == 1
    assert token_calls[0][2]["data"] == {"grant_type": "client_credentials"}
    assert token_calls[0][1] == "http://kc/auth/realms/cyber-range/protocol/openid-connect/token"
    assert s.calls[1][1] == "http://kc/auth/admin/realms/cyber-range/users"
    assert s.calls[1][2]["headers"]["Authorization"] == "Bearer svc-token"


def test_client_create_parses_location_header():
    loc = "http://kc/auth/admin/realms/cyber-range/users/1234abcd-0000-0000-0000-000000000000"
    kc, s = make_client([TOKEN_OK, FakeResponse(201, None, {"Location": loc})])
    uid = kc.create_user(username="u1", email=None, first_name=None, last_name=None)
    assert uid == "1234abcd-0000-0000-0000-000000000000"
    sent = s.calls[1][2]["json"]
    assert sent["enabled"] is True and "credentials" not in sent and "realmRoles" not in sent


@pytest.mark.parametrize(
    "code,exc",
    [(404, KeycloakNotFound), (409, KeycloakConflict), (400, KeycloakRejected), (403, KeycloakAdminError), (500, KeycloakAdminError)],
)
def test_client_maps_http_errors(code, exc):
    kc, _ = make_client([TOKEN_OK, FakeResponse(code)])
    with pytest.raises(exc):
        kc.set_enabled("u", False)


def test_client_bad_secret_fails_closed():
    kc, _ = make_client([FakeResponse(401)])
    with pytest.raises(KeycloakAdminError):
        kc.list_users(search=None, first=0, max_results=1)


def test_client_unconfigured_raises_not_configured():
    with pytest.raises(KeycloakNotConfigured):
        KeycloakAdminClient(None, "cyber-range", "x", None).list_users(search=None, first=0, max_results=1)


def test_client_set_app_role_adds_before_removing_and_ignores_internal_roles():
    current = [
        {"id": "r-stu", "name": "student"},
        {"id": "r-def", "name": "default-roles-cyber-range"},
    ]
    kc, s = make_client(
        [
            TOKEN_OK,
            FakeResponse(200, current),  # GET role-mappings
            FakeResponse(200, {"id": "r-ins", "name": "instructor"}),  # GET /roles/instructor
            FakeResponse(204),  # POST add
            FakeResponse(204),  # DELETE remove
        ]
    )
    kc.set_app_role("uid-1", "instructor")
    methods = [(m, u.split("/cyber-range")[-1]) for m, u, _ in s.calls[1:]]
    assert methods == [
        ("GET", "/users/uid-1/role-mappings/realm"),
        ("GET", "/roles/instructor"),
        ("POST", "/users/uid-1/role-mappings/realm"),
        ("DELETE", "/users/uid-1/role-mappings/realm"),
    ]
    # Only the old app role is removed; default-roles-cyber-range is untouched.
    assert s.calls[-1][2]["json"] == [{"id": "r-stu", "name": "student"}]


def test_client_set_enabled_is_read_modify_write():
    """Review #88: a bare {"enabled": ...} PUT can clear profile fields on Keycloak 24+."""
    current = {"id": "uid-1", "username": "u1", "email": "u1@local", "firstName": "U", "lastName": "One",
               "enabled": True, "attributes": {"dept": ["sec"]}}
    kc, s = make_client([TOKEN_OK, FakeResponse(200, dict(current)), FakeResponse(204)])
    kc.set_enabled("uid-1", False)
    (m1, u1, _), (m2, u2, kw) = s.calls[1], s.calls[2]
    assert (m1, m2) == ("GET", "PUT") and u1 == u2
    assert kw["json"] == {**current, "enabled": False}


def test_client_enabled_admins_filters_disabled_and_service_accounts():
    kc, _ = make_client([TOKEN_OK, FakeResponse(200, [
        {"id": "1", "username": "a", "enabled": True},
        {"id": "2", "username": "b", "enabled": False},
        {"id": "3", "username": "service-account-x", "enabled": True},
    ])])
    assert [u["username"] for u in kc.enabled_admins()] == ["a"]


def test_client_set_app_role_rejects_non_app_role():
    kc, _ = make_client([])
    with pytest.raises(ValueError):
        kc.set_app_role("uid-1", "realm-admin")


def test_base_and_realm_derived_from_introspect_url(monkeypatch):
    monkeypatch.delenv("KEYCLOAK_BASE_URL", raising=False)
    monkeypatch.delenv("KEYCLOAK_REALM", raising=False)
    monkeypatch.setenv(
        "KEYCLOAK_INTROSPECT_URL",
        "http://10.115.77.12/auth/realms/cyber-range/protocol/openid-connect/token/introspect",
    )
    assert keycloak_admin._derive_base_and_realm() == ("http://10.115.77.12/auth", "cyber-range")
