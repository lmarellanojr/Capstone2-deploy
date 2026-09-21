"""SEC-01 (#36): RBAC bypass & authorization matrix for the provision API.

Every route the API serves is classified once in ROUTE_POLICY, and every route
is exercised as five callers: unauthenticated, an authenticated account with
no application role, Student, Instructor and Admin. test_route_inventory fails
if a route is added or removed without updating ROUTE_POLICY, so a new
endpoint cannot ship unclassified.

"Allowed" means the caller got past authorization: any status except 401/403.
A 404/409/422 on an allowed row is the route's own business logic (e.g. no
such pod), not an authorization decision.

The second half covers manual URL/API bypass attempts: another user's pod id
in the URL (IDOR), identity smuggled through query string or request body,
and path tricks.

Instructor -> Admin side-effect coverage (force-destroy on a disposable pod,
reset) is SEC-02 #54; this file only asserts the role boundary itself.

Set SEC01_MATRIX_OUT=<path.md> to also write the observed matrix as Markdown
evidence. Uses conftest.py's temporary SQLite DB, never the shared pod_mgmt.db.
"""
import os

import pytest
from fastapi.testclient import TestClient

import alerts_endpoint as ae
import db
import keycloak_admin
from auth import verify_token
from provision_api_fastapi import app
from test_admin_users import FakeKeycloak

NOISE = ["offline_access", "uma_authorization", "default-roles-cyber-range"]


def _claims(username, *roles):
    return {"preferred_username": username, "sub": f"sub-{username}", "realm_access": {"roles": list(roles) + NOISE}}


CALLERS = {
    "unauthenticated": None,
    "no_role": _claims("norole_user"),
    "student": _claims("student_demo", "student"),
    "instructor": _claims("instructor_demo", "instructor"),
    "admin": _claims("admin_demo", "admin"),
}

PUBLIC = "public"          # anyone, even unauthenticated
ANY_APP_ROLE = "app_role"  # student / instructor / admin
INSTRUCTOR = "instructor"  # instructor / admin
ADMIN = "admin"            # admin only

EXPECTED = {
    PUBLIC: {"unauthenticated": "allow", "no_role": "allow", "student": "allow", "instructor": "allow", "admin": "allow"},
    ANY_APP_ROLE: {"unauthenticated": 401, "no_role": 403, "student": "allow", "instructor": "allow", "admin": "allow"},
    INSTRUCTOR: {"unauthenticated": 401, "no_role": 403, "student": 403, "instructor": "allow", "admin": "allow"},
    ADMIN: {"unauthenticated": 401, "no_role": 403, "student": 403, "instructor": 403, "admin": "allow"},
}

POD = 1  # re-created per matrix row, owned by the caller; DESTROYED, so no lab side effects
ANY_UUID = "00000000-0000-0000-0000-000000000001"

# (METHOD, OpenAPI path) -> (policy, concrete URL, JSON body)
ROUTE_POLICY = {
    ("GET", "/health"): (PUBLIC, "/health", None),
    ("GET", "/capacity"): (PUBLIC, "/capacity", None),
    ("POST", "/pods/provision"): (ANY_APP_ROLE, "/pods/provision", {"student_id": "ignored", "scenario_id": "01"}),
    ("GET", "/pods"): (ANY_APP_ROLE, "/pods", None),
    ("GET", "/pods/{pod_id}/status"): (ANY_APP_ROLE, f"/pods/{POD}/status", None),
    ("GET", "/pods/{pod_id}/guac-token"): (ANY_APP_ROLE, f"/pods/{POD}/guac-token", None),
    ("GET", "/pods/{pod_id}/lab-urls"): (ANY_APP_ROLE, f"/pods/{POD}/lab-urls", None),
    ("DELETE", "/pods/{pod_id}/destroy"): (ANY_APP_ROLE, f"/pods/{POD}/destroy", None),
    ("POST", "/pods/{pod_id}/verify/{scenario_id}/{milestone_id}"): (ANY_APP_ROLE, f"/pods/{POD}/verify/1/1", None),
    ("GET", "/pods/{pod_id}/milestones"): (ANY_APP_ROLE, f"/pods/{POD}/milestones", None),
    ("GET", "/pods/{pod_id}/alerts"): (ANY_APP_ROLE, f"/pods/{POD}/alerts", None),
    ("GET", "/progress"): (ANY_APP_ROLE, "/progress", None),
    ("DELETE", "/progress/{scenario_id}"): (ANY_APP_ROLE, "/progress/1", None),
    ("POST", "/reviews/submit"): (ANY_APP_ROLE, "/reviews/submit", {"scenario_id": 1, "report_text": "matrix probe"}),
    # INST-03 (#86): owner-or-staff read, owner-only resubmit (see IDOR tests below).
    ("GET", "/reviews/{review_id}"): (ANY_APP_ROLE, "/reviews/1", None),
    ("POST", "/reviews/{review_id}/resubmit"): (ANY_APP_ROLE, "/reviews/1/resubmit", {"report_text": "matrix probe"}),
    ("GET", "/instructor/pods"): (INSTRUCTOR, "/instructor/pods", None),
    ("GET", "/instructor/students"): (INSTRUCTOR, "/instructor/students", None),
    ("GET", "/instructor/students/{student_id}"): (INSTRUCTOR, "/instructor/students/student_demo", None),
    ("GET", "/instructor/reviews"): (INSTRUCTOR, "/instructor/reviews", None),
    ("GET", "/instructor/reviews/{review_id}"): (INSTRUCTOR, "/instructor/reviews/1", None),
    ("POST", "/instructor/reviews/{review_id}/resolve"): (INSTRUCTOR, "/instructor/reviews/1/resolve", {"status": "APPROVED"}),
    ("DELETE", "/admin/pods/{pod_id}/force-destroy"): (ADMIN, f"/admin/pods/{POD}/force-destroy", None),
    ("GET", "/admin/users"): (ADMIN, "/admin/users", None),
    ("POST", "/admin/users"): (ADMIN, "/admin/users", {"username": "matrix_probe", "role": "student", "password": "Probe!12345"}),
    ("PATCH", "/admin/users/{user_id}/enabled"): (ADMIN, f"/admin/users/{ANY_UUID}/enabled", {"enabled": True}),
    ("PUT", "/admin/users/{user_id}/role"): (ADMIN, f"/admin/users/{ANY_UUID}/role", {"role": "student"}),
}

_observed: dict = {}


@pytest.fixture
def client(monkeypatch):
    # Nothing here may reach LXD, Guacamole, Wazuh or Keycloak.
    monkeypatch.setattr("pods_router.available_ram_mb", lambda: 10**6)
    monkeypatch.setattr("pods_router.get_lxd_free_mb", lambda: 10**6)
    monkeypatch.setattr("pods_router.perform_provisioning", lambda *a, **k: None)
    monkeypatch.setattr("pods_router.perform_destruction", lambda *a, **k: None)
    kc = FakeKeycloak()
    kc.add("admin_demo", "admin")
    app.dependency_overrides[keycloak_admin.get_client] = lambda: kc
    return TestClient(app)


def as_caller(name):
    claims = CALLERS[name]
    if claims is None:
        # No override at all: the real verify_token runs and sees no header.
        app.dependency_overrides.pop(verify_token, None)
        # alerts_endpoint authenticates through its own hook; point it at the
        # real verify_token too (conftest clears the app's override per test).
        app.dependency_overrides[ae.verify_token_dep] = verify_token
    else:
        app.dependency_overrides[verify_token] = lambda: claims
        app.dependency_overrides[ae.verify_token_dep] = lambda: claims
    return claims


def _insert_pod(pod_id, owner, status="DESTROYED"):
    conn = db.get_db_connection()
    conn.execute(
        "INSERT INTO pods (pod_id, student_id, scenario_id, status, vmid_kali, vmid_meta, vmid_dvwa) "
        "VALUES (?, ?, '01', ?, ?, ?, ?)",
        (pod_id, owner, status, f"pod-{owner}-kali", f"pod-{owner}-meta", f"pod-{owner}-dvwa"),
    )
    conn.commit()
    conn.close()


def _request(client, method, url, body):
    kwargs = {"json": body} if body is not None else {}
    return client.request(method, url, **kwargs)


# --- inventory --------------------------------------------------------------


def test_route_inventory_is_fully_classified():
    served = {
        (method.upper(), path)
        for path, ops in app.openapi()["paths"].items()
        for method in ops
    }
    assert served, "no routes found -- inventory would pass vacuously"
    assert served - set(ROUTE_POLICY) == set(), "new route(s) without an SEC-01 policy"
    assert set(ROUTE_POLICY) - served == set(), "ROUTE_POLICY lists route(s) the API no longer serves"


# --- the matrix -------------------------------------------------------------


@pytest.mark.parametrize("caller", list(CALLERS))
@pytest.mark.parametrize("route", list(ROUTE_POLICY), ids=lambda r: f"{r[0]} {r[1]}")
def test_role_matrix(client, caller, route):
    policy, url, body = ROUTE_POLICY[route]
    claims = as_caller(caller)
    if claims is not None:
        # The pod in the URL belongs to whoever is calling, so owner-scoped
        # routes test the ROLE boundary, not ownership (covered below).
        _insert_pod(POD, claims["preferred_username"])
    r = _request(client, route[0], url, body)
    _observed[(route, caller)] = r.status_code
    want = EXPECTED[policy][caller]
    if want == "allow":
        assert r.status_code not in (401, 403), f"{caller} wrongly denied {route}: {r.status_code} {r.text[:200]}"
        assert r.status_code < 500, f"{caller} {route} crashed: {r.status_code} {r.text[:200]}"
    else:
        assert r.status_code == want, f"{caller} on {route}: got {r.status_code}, want {want} ({r.text[:200]})"


def test_no_role_account_cannot_provision_or_write(client, monkeypatch):
    """The concrete gap SEC-01 closed: a role-less Keycloak account skipping the
    portal's /no-role page by calling the API directly."""
    calls = []
    monkeypatch.setattr("pods_router.perform_provisioning", lambda *a, **k: calls.append(a))
    as_caller("no_role")
    assert client.post("/pods/provision", json={"student_id": "x", "scenario_id": "01"}).status_code == 403
    assert client.post("/reviews/submit", json={"scenario_id": 1, "report_text": "x"}).status_code == 403
    assert client.delete("/progress/1").status_code == 403
    assert calls == []
    conn = db.get_db_connection()
    assert conn.execute("SELECT COUNT(*) FROM pods").fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM review_cases").fetchone()[0] == 0
    conn.close()


# --- manual URL / API bypass --------------------------------------------------

VICTIM_POD = 7
OWNER_ONLY_ROUTES = [
    ("GET", f"/pods/{VICTIM_POD}/guac-token"),
    ("GET", f"/pods/{VICTIM_POD}/lab-urls"),
    ("GET", f"/pods/{VICTIM_POD}/milestones"),
    ("GET", f"/pods/{VICTIM_POD}/alerts"),
    ("POST", f"/pods/{VICTIM_POD}/verify/1/1"),
    ("DELETE", f"/pods/{VICTIM_POD}/destroy"),
]


@pytest.mark.parametrize("caller", ["student", "instructor", "admin"])
@pytest.mark.parametrize("method,url", OWNER_ONLY_ROUTES)
def test_other_users_pod_in_url_is_404(client, caller, method, url):
    """IDOR: swapping another student's pod id into the URL. 404, not 403, so
    the response does not confirm the pod exists. Admin/Instructor get no
    owner bypass on lab-access routes (ADM-POD contract)."""
    _insert_pod(VICTIM_POD, "victim_student", status="ACTIVE")
    as_caller(caller)
    r = client.request(method, url)
    assert r.status_code == 404, f"{caller} {method} {url}: {r.status_code} {r.text[:200]}"
    conn = db.get_db_connection()
    assert conn.execute("SELECT status FROM pods WHERE pod_id=?", (VICTIM_POD,)).fetchone()[0] == "ACTIVE"
    conn.close()


@pytest.mark.parametrize("caller,want", [("student", 404), ("instructor", 404), ("admin", 200)])
def test_other_users_pod_status(client, caller, want):
    _insert_pod(VICTIM_POD, "victim_student", status="ACTIVE")
    as_caller(caller)
    assert client.get(f"/pods/{VICTIM_POD}/status").status_code == want


def test_student_cannot_force_destroy_other_pod(client):
    _insert_pod(VICTIM_POD, "victim_student", status="ACTIVE")
    as_caller("student")
    assert client.delete(f"/admin/pods/{VICTIM_POD}/force-destroy").status_code == 403
    conn = db.get_db_connection()
    assert conn.execute("SELECT status FROM pods WHERE pod_id=?", (VICTIM_POD,)).fetchone()[0] == "ACTIVE"
    conn.close()


def test_student_id_query_param_is_ignored_for_non_admin(client):
    _insert_pod(VICTIM_POD, "victim_student", status="ACTIVE")
    for caller in ("student", "instructor"):
        as_caller(caller)
        r = client.get("/pods?student_id=victim_student")
        assert r.status_code == 200
        assert [p["student_id"] for p in r.json()["pods"]] == [], caller


def test_provision_body_student_id_cannot_impersonate(client):
    as_caller("student")
    r = client.post("/pods/provision", json={"student_id": "victim_student", "scenario_id": "01"})
    assert r.status_code == 202, r.text
    conn = db.get_db_connection()
    owners = [row[0] for row in conn.execute("SELECT student_id FROM pods").fetchall()]
    conn.close()
    assert owners == ["student_demo"]


def test_review_submit_cannot_set_another_student_id(client):
    as_caller("student")
    r = client.post(
        "/reviews/submit",
        json={"scenario_id": 1, "report_text": "x", "student_id": "victim_student"},
    )
    assert r.status_code in (200, 201), r.text
    conn = db.get_db_connection()
    owners = [row[0] for row in conn.execute("SELECT student_id FROM review_cases").fetchall()]
    conn.close()
    assert owners == ["student_demo"]


def test_progress_reset_only_touches_callers_rows(client):
    conn = db.get_db_connection()
    for sid in ("student_demo", "victim_student"):
        conn.execute(
            "INSERT INTO milestone_verification (pod_id, student_id, scenario_id, milestone_id, status) "
            "VALUES (99, ?, 1, 1, 'PASS')",
            (sid,),
        )
    conn.commit()
    conn.close()
    as_caller("student")
    assert client.delete("/progress/1").status_code == 200
    conn = db.get_db_connection()
    left = [r[0] for r in conn.execute("SELECT student_id FROM milestone_verification").fetchall()]
    conn.close()
    assert left == ["victim_student"]


def _insert_review(owner, status="PENDING"):
    conn = db.get_db_connection()
    cur = conn.execute(
        "INSERT INTO review_cases (student_id, scenario_id, case_type, report_text, status) "
        "VALUES (?, 1, 'WRITTEN_REPORT', 'original', ?)",
        (owner, status),
    )
    conn.commit()
    review_id = cur.lastrowid
    conn.close()
    return review_id


def _review_row(review_id):
    conn = db.get_db_connection()
    row = dict(conn.execute("SELECT * FROM review_cases WHERE review_id=?", (review_id,)).fetchone())
    conn.close()
    return row


@pytest.mark.parametrize("caller,want", [("student", 404), ("instructor", 200), ("admin", 200)])
def test_other_students_review_detail(client, caller, want):
    """IDOR on INST-03's GET /reviews/{id}: owner or staff only; 404 for another student."""
    rid = _insert_review("victim_student")
    as_caller(caller)
    r = client.get(f"/reviews/{rid}")
    assert r.status_code == want, r.text[:200]
    if want == 404:
        assert "original" not in r.text


@pytest.mark.parametrize("caller", ["student", "instructor", "admin"])
def test_cannot_resubmit_another_students_review(client, caller):
    """Owner-only, even for staff: nobody can rewrite a student's submission for them."""
    rid = _insert_review("victim_student", status="RETRY")
    before = _review_row(rid)
    as_caller(caller)
    r = client.post(f"/reviews/{rid}/resubmit", json={"report_text": "tampered"})
    assert r.status_code == 404, r.text[:200]
    assert _review_row(rid) == before


@pytest.mark.parametrize("caller", ["student", "no_role"])
def test_student_cannot_resolve_reviews(client, caller):
    rid = _insert_review("student_demo")
    before = _review_row(rid)
    as_caller(caller)
    r = client.post(f"/instructor/reviews/{rid}/resolve", json={"status": "APPROVED", "score": 100})
    assert r.status_code == 403
    assert _review_row(rid) == before


@pytest.mark.parametrize(
    "url",
    [
        "/pods/..%2Fadmin%2Fusers/status",
        "/pods/1%2F..%2F..%2Fadmin%2Fusers/status",
        "/instructor/../admin/users",
        "/ADMIN/users",
        "/admin/users/",
    ],
)
def test_path_tricks_do_not_reach_admin_routes(client, url):
    as_caller("student")
    r = client.get(url)
    assert r.status_code in (401, 403, 404, 405, 422), f"{url}: {r.status_code} {r.text[:200]}"
    assert "users" not in (r.json() if r.headers.get("content-type", "").startswith("application/json") else {})


def test_forged_role_claim_in_body_is_ignored(client):
    """Roles come only from Keycloak introspection, never from the request.
    /admin/users validates the body before its in-handler Admin check, so the
    smuggled field may surface as 422 instead of 403 -- either way nothing is
    created and no role is taken from the body."""
    as_caller("student")
    kc = app.dependency_overrides[keycloak_admin.get_client]()
    before = kc.usernames()
    forged = {"username": "x_forged", "role": "admin", "password": "Probe!12345"}
    assert client.post("/admin/users", json={**forged, "realm_access": {"roles": ["admin"]}}).status_code in (403, 422)
    assert client.post("/admin/users", json=forged, headers={"X-Roles": "admin", "X-Forwarded-User": "admin_demo"}).status_code == 403
    assert kc.usernames() == before


# --- evidence ---------------------------------------------------------------


def teardown_module(_module):
    out = os.getenv("SEC01_MATRIX_OUT")
    if not out or not _observed:
        return
    callers = list(CALLERS)
    lines = [
        "| Method | Route | Policy | " + " | ".join(callers) + " |",
        "|---|---|---|" + "---|" * len(callers),
    ]
    for route, (policy, _url, _body) in ROUTE_POLICY.items():
        cells = []
        for c in callers:
            code = _observed.get((route, c), "—")
            want = EXPECTED[policy][c]
            ok = (code not in (401, 403) and code < 500) if want == "allow" else code == want
            cells.append(f"{code} {'✅' if ok else '❌'}")
        lines.append(f"| {route[0]} | `{route[1]}` | {policy} | " + " | ".join(cells) + " |")
    with open(out, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
