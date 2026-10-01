"""SEC-02 (#54): an Instructor cannot perform Admin-only operations.

SEC-01 (#36, test_sec01_rbac_matrix.py) proves the role boundary: every
Admin-only route answers 403 to an Instructor. This file proves the deeper
half: when an Instructor is denied, **nothing happened**. For every
Admin-only operation, run with realistic targets (a live pod, the Instructor's
own account, the only Admin), it checks that:

  * the answer is 403 with the standard "Insufficient privileges" detail,
  * no database row changed (pods, audit_log, review_cases,
    milestone_verification, ...), compared as a full before/after snapshot,
  * no pod teardown was scheduled (perform_destruction never called),
  * Keycloak was never touched: zero Admin API calls, not even reads, and the
    fake realm's users, roles, passwords and sessions are unchanged,
  * no cached token was revoked.

Each denied request is also replayed as the Admin to prove those detectors
work: the same request as Admin must change something, or the "no side
effect" assertion above could be passing vacuously.

Unlike SEC-01, callers here go through the REAL verify_token with a fake
Keycloak introspection endpoint, so forged headers, query parameters and
cookies take the same path as they would in production. The Instructor is
tried with a realm role, a portal client role, and a token loaded with
admin-looking roles that must not count (another client's "admin",
realm-management's "realm-admin", "Admin"/"ADMIN").

Reset: PR #50 did not implement a pod reset API. test_no_pod_reset_route_is_served
records that, and the reset-shaped URLs an Instructor might try are unrouted.
DELETE /progress/{scenario_id} is the Student score wipe and is deliberately
NOT treated as a reset.

Force-destroy acceptance means *scheduled*, not completed: the Admin control
asserts status DESTROYING plus one scheduled teardown. Completed teardown is
checked live through /pods/{id}/status (deploy/host/verify_sec02_instructor_admin.sh).

Set SEC02_EVIDENCE_OUT=<path.md> to also write the observed denials as
Markdown evidence. Uses conftest.py's temporary SQLite DB, never the shared
pod_mgmt.db. No LXD, Guacamole, Wazuh or Keycloak is reached.
"""
import copy
import os

import pytest
from fastapi.testclient import TestClient

import auth
import db
import introspect_cache
import keycloak_admin
from auth import verify_token
from keycloak_admin import KeycloakAdminClient
from provision_api_fastapi import app
from test_admin_users import FakeKeycloak
from test_sec01_rbac_matrix import ADMIN as SEC01_ADMIN_POLICY
from test_sec01_rbac_matrix import ROUTE_POLICY as SEC01_ROUTE_POLICY

NOISE = ["offline_access", "uma_authorization", "default-roles-cyber-range"]
FORBIDDEN = "Forbidden: Insufficient privileges"


def _claims(username, realm_roles=(), client_roles=None):
    c = {
        "active": True,
        "preferred_username": username,
        "sub": f"sub-{username}",
        "realm_access": {"roles": list(realm_roles) + NOISE},
    }
    if client_roles:
        c["resource_access"] = client_roles
    return c


# Bearer token -> introspection result. Every token is distinct so the
# introspection cache can never hand one caller's claims to another.
TOKENS = {
    "tok-instructor-realm": _claims("instructor_demo", ["instructor"]),
    # AUTH-01: portal client roles count the same as realm roles.
    "tok-instructor-client": _claims(
        "instructor_demo", client_roles={auth.KEYCLOAK_CLIENT_ID: {"roles": ["instructor"]}}
    ),
    # Admin-looking roles that must NOT grant Admin: wrong case, a similar
    # name, Keycloak's own realm-management roles, and "admin" on a client
    # other than the portal.
    "tok-instructor-lookalike": _claims(
        "instructor_demo",
        ["instructor", "Admin", "ADMIN", "administrator", "realm-admin"],
        client_roles={
            "realm-management": {"roles": ["realm-admin", "manage-users", "manage-realm"]},
            "account": {"roles": ["admin", "manage-account"]},
            "admin-cli": {"roles": ["admin"]},
        },
    ),
    "tok-admin": _claims("admin_demo", ["admin"]),
}
INSTRUCTOR_TOKENS = ["tok-instructor-realm", "tok-instructor-client", "tok-instructor-lookalike"]

STUDENT_POD = 1   # student_demo, ACTIVE
FAILED_POD = 2    # student_demo2, FAILED_ROLLBACK_COMPLETE (also force-destroyable)
OWN_POD = 3       # instructor_demo's own ACTIVE pod: ownership must not unlock Admin routes

# Every Admin-only route, each tried with the targets an Instructor would
# actually want. url/body may be callables taking the fake realm's user ids.
ADMIN_CASES = {
    ("DELETE", "/admin/pods/{pod_id}/force-destroy"): [
        ("force-destroy a student's ACTIVE pod", f"/admin/pods/{STUDENT_POD}/force-destroy", None),
        ("force-destroy a FAILED_ROLLBACK_COMPLETE pod", f"/admin/pods/{FAILED_POD}/force-destroy", None),
        ("force-destroy the Instructor's own pod", f"/admin/pods/{OWN_POD}/force-destroy", None),
    ],
    ("GET", "/admin/users"): [
        ("list all accounts", "/admin/users", None),
        ("search for Admin accounts", "/admin/users?search=admin", None),
    ],
    ("POST", "/admin/users"): [
        ("create a new Admin account", "/admin/users",
         {"username": "sec02_backdoor", "role": "admin", "password": "Probe!12345", "temporary_password": False}),
        ("create a Student account", "/admin/users",
         {"username": "sec02_student", "role": "student", "password": "Probe!12345"}),
    ],
    ("PATCH", "/admin/users/{user_id}/enabled"): [
        ("disable the only Admin", lambda ids: f"/admin/users/{ids['admin_demo']}/enabled", {"enabled": False}),
        ("disable a Student", lambda ids: f"/admin/users/{ids['student_demo']}/enabled", {"enabled": False}),
        ("re-enable a disabled account", lambda ids: f"/admin/users/{ids['disabled_user']}/enabled", {"enabled": True}),
    ],
    ("PUT", "/admin/users/{user_id}/role"): [
        ("promote self to Admin", lambda ids: f"/admin/users/{ids['instructor_demo']}/role", {"role": "admin"}),
        ("demote the only Admin", lambda ids: f"/admin/users/{ids['admin_demo']}/role", {"role": "student"}),
        ("promote a Student to Instructor", lambda ids: f"/admin/users/{ids['student_demo']}/role", {"role": "instructor"}),
    ],
    # Previously missing: ADM-SYS-02 served this route without SEC-02 coverage.
    ("GET", "/admin/infra-health"): [
        ("read host infrastructure health", "/admin/infra-health", None),
    ],
    ("PUT", "/admin/users/{user_id}/password"): [
        ("take over the only Admin by resetting its password",
         lambda ids: f"/admin/users/{ids['admin_demo']}/password", {"password": "Probe!12345", "temporary": False}),
        ("reset a Student's password", lambda ids: f"/admin/users/{ids['student_demo']}/password", {"password": "Probe!12345"}),
    ],
    ("GET", "/admin/audit-log"): [
        ("read the full audit trail", "/admin/audit-log", None),
        ("read Admin user-management events", "/admin/audit-log?event_type=ADMIN_USER_ROLE_SET", None),
    ],
}
CASES = [(route, *case) for route, cases in ADMIN_CASES.items() for case in cases]
CASE_IDS = [label for _, label, _, _ in CASES]

# Every KeycloakAdminClient operation, read or write. A denied Instructor
# request must not reach any of them.
KC_API = sorted(
    n for n, v in vars(KeycloakAdminClient).items() if callable(v) and not n.startswith("_")
)

# Tables whose rows are compared before/after every denied request.
SNAPSHOT_TABLES = ("pods", "audit_log", "review_cases", "milestone_verification")

_observed: list = []


class RecordingKeycloak(FakeKeycloak):
    """FakeKeycloak that records every Admin API call, reads included."""

    def __init__(self):
        super().__init__()
        self.calls: list = []

    def __getattribute__(self, name):
        attr = super().__getattribute__(name)
        if name in KC_API:
            calls = super().__getattribute__("calls")

            def recorded(*a, **k):
                calls.append(name)
                return attr(*a, **k)

            return recorded
        return attr

    def state(self):
        return copy.deepcopy((self.users, self.roles, self.passwords, self.logged_out))


class _Introspection:
    def __init__(self, claims):
        self._claims = claims

    def raise_for_status(self):
        pass

    def json(self):
        return self._claims


@pytest.fixture
def world(monkeypatch):
    """Realistic targets, a recording Keycloak, and spies on every side effect."""
    # Real verify_token, fake Keycloak introspection behind it.
    app.dependency_overrides.pop(verify_token, None)
    introspect_cache.reset_for_tests()
    monkeypatch.setattr(
        "auth.requests.post",
        lambda url, auth=None, data=None, timeout=None: _Introspection(TOKENS.get(data["token"], {"active": False})),
    )

    effects = {"destroy": [], "provision": [], "revoke": []}
    monkeypatch.setattr("pods_router.perform_destruction", lambda pod, *a, **k: effects["destroy"].append(pod["pod_id"]))
    monkeypatch.setattr("pods_router.perform_provisioning", lambda *a, **k: effects["provision"].append(a))
    monkeypatch.setattr("users_router._revoke_cached_tokens", lambda uid, name: effects["revoke"].append(name))

    kc = RecordingKeycloak()
    ids = {
        "admin_demo": kc.add("admin_demo", "admin"),
        "instructor_demo": kc.add("instructor_demo", "instructor"),
        "student_demo": kc.add("student_demo", "student"),
        "disabled_user": kc.add("disabled_user", "student", enabled=False),
    }
    app.dependency_overrides[keycloak_admin.get_client] = lambda: kc

    conn = db.get_db_connection()
    for pod_id, owner, status in (
        (STUDENT_POD, "student_demo", "ACTIVE"),
        (FAILED_POD, "student_demo2", "FAILED_ROLLBACK_COMPLETE"),
        (OWN_POD, "instructor_demo", "ACTIVE"),
    ):
        conn.execute(
            "INSERT INTO pods (pod_id, student_id, scenario_id, status, vmid_kali, vmid_meta, vmid_dvwa) "
            "VALUES (?, ?, '01', ?, ?, ?, ?)",
            (pod_id, owner, status, f"pod-{owner}-kali", f"pod-{owner}-meta", f"pod-{owner}-dvwa"),
        )
    conn.execute(
        "INSERT INTO milestone_verification (pod_id, student_id, scenario_id, milestone_id, status) VALUES (1, 'student_demo', 1, 1, 'PASS')"
    )
    conn.commit()
    conn.close()

    kc.calls.clear()  # setup reads are not the request's side effects
    return {"client": TestClient(app), "kc": kc, "ids": ids, "effects": effects}


def db_snapshot():
    conn = db.get_db_connection()
    try:
        return {t: [tuple(r) for r in conn.execute(f"SELECT * FROM {t} ORDER BY rowid")] for t in SNAPSHOT_TABLES}
    finally:
        conn.close()


def call(world, method, url, body, token, headers=None, cookies=None):
    h = {"Authorization": f"Bearer {token}", **(headers or {})}
    kwargs = {"json": body} if body is not None else {}
    if cookies:
        world["client"].cookies.update(cookies)
    try:
        return world["client"].request(method, url, headers=h, **kwargs)
    finally:
        world["client"].cookies.clear()


def resolve(world, url, body):
    return (url(world["ids"]) if callable(url) else url), body


def assert_no_side_effect(world, before_db, before_kc, context):
    kc, effects = world["kc"], world["effects"]
    assert db_snapshot() == before_db, f"{context}: database changed"
    assert kc.calls == [], f"{context}: Keycloak Admin API was called: {kc.calls}"
    assert kc.state() == before_kc, f"{context}: Keycloak realm changed"
    assert effects["destroy"] == [], f"{context}: pod teardown was scheduled for {effects['destroy']}"
    assert effects["provision"] == [], f"{context}: a pod was provisioned"
    assert effects["revoke"] == [], f"{context}: cached tokens were revoked for {effects['revoke']}"


# --- inventory --------------------------------------------------------------


def test_every_admin_only_route_is_covered():
    """A new Admin-only route must get SEC-02 side-effect coverage too."""
    served = {(m.upper(), p) for p, ops in app.openapi()["paths"].items() for m in ops}
    admin_prefixed = {r for r in served if r[1].startswith("/admin")}
    sec01_admin = {r for r, (policy, _, _) in SEC01_ROUTE_POLICY.items() if policy == SEC01_ADMIN_POLICY}
    assert admin_prefixed, "no /admin routes found -- the inventory would pass vacuously"
    assert admin_prefixed == set(ADMIN_CASES), "an /admin route is missing from ADMIN_CASES (or no longer served)"
    assert sec01_admin == set(ADMIN_CASES), "SEC-01's Admin-only policy set and SEC-02's coverage have drifted"


def test_keycloak_spy_covers_the_admin_client_api():
    # Guards the "zero Keycloak calls" assertion against a vacuous pass.
    assert {"list_users", "create_user", "set_enabled", "set_app_role", "delete_user", "logout_user"} <= set(KC_API)


# --- core: Instructor denied, nothing happened --------------------------------


@pytest.mark.parametrize("token", INSTRUCTOR_TOKENS)
@pytest.mark.parametrize("route,label,url,body", CASES, ids=CASE_IDS)
def test_instructor_denied_with_no_side_effect(world, token, route, label, url, body):
    url, body = resolve(world, url, body)
    before_db, before_kc = db_snapshot(), world["kc"].state()

    r = call(world, route[0], url, body, token)

    _observed.append((token.removeprefix("tok-"), label, route[0], url, r.status_code))
    assert r.status_code == 403, f"{token} {label}: got {r.status_code} {r.text[:200]}"
    assert r.json() == {"detail": FORBIDDEN}
    assert_no_side_effect(world, before_db, before_kc, f"{token} {label}")


# Read-only Admin routes have no side effect to detect; what they grant is
# disclosure. Their control proves the Admin response really carries data, so
# the Instructor test's exact-FORBIDDEN-body assertion is what shows nothing
# leaked. Each entry says what "data" means for that route.
READ_ONLY_DISCLOSURE = {
    ("GET", "/admin/infra-health"): lambda body: isinstance(body, dict) and len(body) > 0,
    ("GET", "/admin/audit-log"): lambda body: len(body.get("events", [])) > 0,
}


@pytest.mark.parametrize("route,label,url,body", CASES, ids=CASE_IDS)
def test_same_request_as_admin_has_an_effect(world, route, label, url, body):
    """Control: proves the detectors above would catch a successful action."""
    url, body = resolve(world, url, body)
    if route == ("GET", "/admin/audit-log"):
        # Something to disclose, so an empty table can't make this pass vacuously.
        db.log_event("ADMIN_USER_ROLE_SET", student_id="student_demo", result="OK", detail="actor=admin_demo")
    before_db, before_kc = db_snapshot(), world["kc"].state()

    r = call(world, route[0], url, body, "tok-admin")

    assert r.status_code not in (401, 403) and r.status_code < 500, f"admin {label}: {r.status_code} {r.text[:200]}"
    if route in READ_ONLY_DISCLOSURE:
        assert r.status_code == 200 and READ_ONLY_DISCLOSURE[route](r.json()), (
            f"admin {label}: returned no data -- the Instructor no-disclosure check would be vacuous"
        )
        return
    kc, effects = world["kc"], world["effects"]
    changed = db_snapshot() != before_db or kc.state() != before_kc or kc.calls or effects["destroy"]
    assert changed, f"admin {label}: no detectable effect -- the Instructor no-side-effect check would be vacuous"


def test_read_only_disclosure_list_only_names_get_routes():
    # The disclosure control must never become a way to skip effect checks on a write.
    assert all(method == "GET" for method, _ in READ_ONLY_DISCLOSURE)
    assert set(READ_ONLY_DISCLOSURE) <= set(ADMIN_CASES)


@pytest.mark.parametrize("pod_id", [STUDENT_POD, FAILED_POD, OWN_POD])
def test_admin_force_destroy_is_scheduled_not_completed(world, pod_id):
    """Positive control for force-destroy: accepted means DESTROYING plus one
    scheduled teardown, not a finished one (issue #54 lifecycle constraint)."""
    r = call(world, "DELETE", f"/admin/pods/{pod_id}/force-destroy", None, "tok-admin")
    assert r.status_code == 200 and r.json() == {"status": "destroying", "pod_id": pod_id}
    assert world["effects"]["destroy"] == [pod_id]
    conn = db.get_db_connection()
    assert conn.execute("SELECT status FROM pods WHERE pod_id=?", (pod_id,)).fetchone()[0] == "DESTROYING"
    conn.close()


def test_instructor_cannot_promote_self_even_after_repeated_attempts(world):
    """Retrying does not wear the check down, and the Instructor's roles stay put."""
    iid = world["ids"]["instructor_demo"]
    for _ in range(5):
        assert call(world, "PUT", f"/admin/users/{iid}/role", {"role": "admin"}, "tok-instructor-realm").status_code == 403
    assert world["kc"].user_app_roles(iid) == ["instructor"]
    assert world["kc"].calls == ["user_app_roles"]  # only the assertion above


# --- bypass attempts: hidden or disabled controls do not matter ---------------

FORGED_HEADERS = {
    "X-Roles": "admin",
    "X-User-Roles": "admin",
    "X-Forwarded-User": "admin_demo",
    "X-Forwarded-Groups": "admin",
    "X-Auth-Request-Groups": "admin",
    "X-Original-URL": "/pods",
    "X-Rewrite-URL": "/pods",
    "X-HTTP-Method-Override": "GET",
}
PROBES = [
    ("force-destroy", "DELETE", f"/admin/pods/{STUDENT_POD}/force-destroy", None),
    ("promote self", "PUT", lambda ids: f"/admin/users/{ids['instructor_demo']}/role", {"role": "admin"}),
    ("create admin", "POST", "/admin/users", {"username": "sec02_forged", "role": "admin", "password": "Probe!12345"}),
]


@pytest.mark.parametrize("label,method,url,body", PROBES, ids=[p[0] for p in PROBES])
@pytest.mark.parametrize(
    "attempt",
    ["forged role/identity headers", "?role=admin query", "role=admin cookie", "second Authorization header"],
)
def test_forged_elevation_is_ignored(world, attempt, label, method, url, body):
    url, body = resolve(world, url, body)
    before_db, before_kc = db_snapshot(), world["kc"].state()
    headers, cookies = {}, None
    if attempt == "forged role/identity headers":
        headers = FORGED_HEADERS
    elif attempt == "?role=admin query":
        url += "?role=admin&as=admin_demo&student_id=admin_demo"
    elif attempt == "role=admin cookie":
        cookies = {"role": "admin", "roles": "admin"}
    else:
        # The Instructor's token first; a client cannot append the Admin's.
        headers = {"Authorization": "Bearer tok-instructor-realm, Bearer tok-admin"}

    r = call(world, method, url, body, "tok-instructor-realm", headers=headers, cookies=cookies)

    _observed.append(("instructor-realm", f"{label} ({attempt})", method, url, r.status_code))
    # A malformed double Authorization is rejected as an invalid token (401);
    # everything else must be the role check (403). Never success.
    assert r.status_code in ((401, 403) if attempt == "second Authorization header" else (403,)), r.text[:200]
    assert_no_side_effect(world, before_db, before_kc, f"{attempt} {label}")


def test_role_smuggled_in_the_request_body_is_rejected(world):
    """Extra fields (realmRoles, roles, ...) cannot ride along on a user write."""
    iid = world["ids"]["instructor_demo"]
    before_db, before_kc = db_snapshot(), world["kc"].state()
    attempts = [
        ("PUT", f"/admin/users/{iid}/role", {"role": "admin", "realmRoles": ["admin"]}),
        ("PATCH", f"/admin/users/{iid}/enabled", {"enabled": True, "roles": ["admin"]}),
        ("POST", "/admin/users", {"username": "sec02_smuggle", "role": "student", "password": "Probe!12345",
                                  "realmRoles": ["admin"], "clientRoles": {"portal": ["admin"]}}),
    ]
    for method, url, body in attempts:
        r = call(world, method, url, body, "tok-instructor-realm")
        _observed.append(("instructor-realm", "role smuggled in body", method, url, r.status_code))
        # 422 (extra="forbid") can come before the role check (SEC-01 §3,
        # informational); both mean nothing was done.
        assert r.status_code in (403, 422), r.text[:200]
    assert_no_side_effect(world, before_db, before_kc, "body smuggling")


@pytest.mark.parametrize(
    "method,url",
    [
        ("DELETE", f"/admin/pods/{STUDENT_POD}/force-destroy/"),
        ("DELETE", f"//admin/pods/{STUDENT_POD}/force-destroy"),
        ("DELETE", f"/ADMIN/pods/{STUDENT_POD}/force-destroy"),
        ("DELETE", f"/%61dmin/pods/{STUDENT_POD}/force-destroy"),
        ("DELETE", f"/instructor/../admin/pods/{STUDENT_POD}/force-destroy"),
        ("DELETE", f"/pods/../admin/pods/{STUDENT_POD}/force-destroy"),
        ("POST", f"/admin/pods/{STUDENT_POD}/force-destroy"),
        ("GET", f"/admin/pods/{STUDENT_POD}/force-destroy"),
        ("DELETE", f"/admin/pods/{STUDENT_POD}%2Fforce-destroy"),
    ],
)
def test_path_and_method_tricks_never_reach_force_destroy(world, method, url):
    before_db, before_kc = db_snapshot(), world["kc"].state()
    r = call(world, method, url, None, "tok-instructor-realm")
    _observed.append(("instructor-realm", "path/method trick", method, url, r.status_code))
    assert r.status_code in (403, 404, 405, 422), f"{method} {url}: {r.status_code}"
    assert_no_side_effect(world, before_db, before_kc, f"{method} {url}")


def test_instructor_cannot_use_owner_routes_as_a_side_door(world):
    """The Student destroy route and Admin pod inspection must not stand in for
    force-destroy / Admin inspect on someone else's pod."""
    before_db, before_kc = db_snapshot(), world["kc"].state()
    for method, url, want in [
        ("DELETE", f"/pods/{STUDENT_POD}/destroy", 404),
        ("DELETE", f"/pods/{FAILED_POD}/destroy", 404),
        ("GET", f"/pods/{STUDENT_POD}/status", 404),  # Admin inspect is Admin-only
    ]:
        r = call(world, method, url, None, "tok-instructor-realm")
        _observed.append(("instructor-realm", "owner route on a student's pod", method, url, r.status_code))
        assert r.status_code == want, f"{method} {url}: {r.status_code}"
    r = call(world, "GET", "/pods?student_id=student_demo", None, "tok-instructor-realm")
    assert {p["student_id"] for p in r.json()["pods"]} <= {"instructor_demo"}
    assert_no_side_effect(world, before_db, before_kc, "owner-route side door")


# --- reset: not implemented (recorded, not assumed) ---------------------------


def test_no_pod_reset_route_is_served():
    """PR #50 shipped no reset API. If one is added, this fails so SEC-02 can
    add reset denial coverage instead of silently skipping it."""
    paths = app.openapi()["paths"]
    reset_like = {p for p in paths if any(w in p.lower() for w in ("reset", "restart", "rebuild", "reprovision"))}
    assert reset_like == set(), f"a reset-like route now exists: {reset_like} -- add SEC-02 coverage"
    admin_pod_routes = {(m.upper(), p) for p, ops in paths.items() for m in ops if p.startswith("/admin/pods")}
    assert admin_pod_routes == {("DELETE", "/admin/pods/{pod_id}/force-destroy")}
    # The Student score wipe exists but is NOT a pod reset and is not Admin-only.
    assert "delete" in paths["/progress/{scenario_id}"]


@pytest.mark.parametrize(
    "method,url",
    [
        ("POST", f"/admin/pods/{STUDENT_POD}/reset"),
        ("PUT", f"/admin/pods/{STUDENT_POD}/reset"),
        ("POST", f"/pods/{STUDENT_POD}/reset"),
        ("POST", f"/admin/pods/{STUDENT_POD}/restart"),
        ("POST", "/admin/reset"),
    ],
)
def test_reset_attempts_are_unrouted_and_change_nothing(world, method, url):
    before_db, before_kc = db_snapshot(), world["kc"].state()
    r = call(world, method, url, None, "tok-instructor-realm")
    _observed.append(("instructor-realm", "reset (not implemented)", method, url, r.status_code))
    assert r.status_code in (404, 405)
    assert_no_side_effect(world, before_db, before_kc, f"{method} {url}")


def teardown_module(_module):
    out = os.environ.get("SEC02_EVIDENCE_OUT")
    if not out or not _observed:
        return
    lines = [
        "| Instructor token | Attempt | Method | URL | Status | Side effect |",
        "|---|---|---|---|---|---|",
    ]
    for token, label, method, url, code in _observed:
        lines.append(f"| {token} | {label} | {method} | `{url}` | {code} | none |")
    with open(out, "w") as f:
        f.write("\n".join(lines) + "\n")
