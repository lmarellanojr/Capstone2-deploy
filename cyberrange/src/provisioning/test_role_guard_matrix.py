"""AUTH-02: cross-cutting test matrix for the shared require_role()/extract_roles()
authorization guard (provisioning/auth.py), exercised generically against every
Instructor/Admin route that uses it -- this is the "one reusable mechanism"
being tested at the mechanism level, not per-feature.

Complements, does not duplicate, the route-specific tests already in
test_admin_pods.py and test_reviews.py. Two matrix cells were not covered
anywhere else and are the reason this file exists:

1. Unauthenticated (no Authorization header at all) -> 401 on every
   /instructor/* route. Existing coverage has this for /pods, /pods/{id}/status,
   /admin/pods/{id}/force-destroy, and /reviews/submit, but not for
   /instructor/pods, /instructor/students, or /instructor/reviews.
2. An authenticated caller whose realm_access.roles is a realistic, complete
   Keycloak default set (offline_access, uma_authorization,
   default-roles-<realm>) but contains none of student/instructor/admin ->
   403, not a crash and not accidental access. This is distinct from "student
   denied instructor endpoint" (wrong role) -- it's "no application role at
   all", and malformed/missing role data must fail safely per this ticket's
   acceptance criteria.
"""
# pylxd stub and the temp_db autouse fixture (fresh SQLite per test, default
# student claim on verify_token) live in conftest.py, shared with
# test_admin_pods.py and test_reviews.py. This file's own unauthenticated
# tests explicitly clear that default override (see below) rather than
# needing a variant fixture without one.
import pytest
from fastapi.testclient import TestClient

from auth import verify_token
from provision_api_fastapi import app

# Every route currently gated by require_role(["instructor", "admin"], claims).
# Kept as an explicit list (not introspected from the router) so this test
# fails loudly -- not silently -- if a route is renamed without updating this
# matrix. All 5 are unauthenticated-safe to hit with a placeholder path param:
# verify_token() rejects a request with no Authorization header before the
# route body (and therefore require_role()) ever runs, so the placeholder
# student_id/review_id below is never actually looked up.
INSTRUCTOR_OR_ADMIN_GET_ROUTES = [
    "/instructor/pods",
    "/instructor/students",
    "/instructor/students/placeholder-student-id",
    "/instructor/reviews",
    "/instructor/reviews/999999",
]

NO_APPLICATION_ROLE_CLAIMS = {
    "preferred_username": "no_app_role_user",
    "realm_access": {
        "roles": ["offline_access", "uma_authorization", "default-roles-cyber-range"]
    },
}


@pytest.mark.parametrize("path", INSTRUCTOR_OR_ADMIN_GET_ROUTES)
def test_instructor_routes_require_authentication(path: str):
    # conftest.py's temp_db fixture defaults dependency_overrides[verify_token]
    # to a student claim for every test in this package; pop it here so this
    # request has NO override at all and the real verify_token() runs, sees no
    # Authorization header, and rejects before require_role() ever executes.
    # That's what actually distinguishes "who are you" (401) from "you're
    # someone, but not allowed here" (403).
    app.dependency_overrides.pop(verify_token, None)
    client = TestClient(app)
    res = client.get(path)
    assert res.status_code == 401


def test_no_application_role_denied_on_instructor_endpoint():
    client = TestClient(app)
    app.dependency_overrides[verify_token] = lambda: NO_APPLICATION_ROLE_CLAIMS
    res = client.get("/instructor/pods", headers={"Authorization": "Bearer mock"})
    assert res.status_code == 403


def test_no_application_role_denied_on_admin_endpoint():
    client = TestClient(app)
    app.dependency_overrides[verify_token] = lambda: NO_APPLICATION_ROLE_CLAIMS
    # force-destroy needs a real pod row to reach require_role in some
    # implementations; this route checks the role before touching the DB, so
    # a nonexistent pod_id is fine -- if the guard let this through, we'd see
    # 404 (pod lookup) instead of 403 (role check), which would itself be the
    # bug this test exists to catch.
    res = client.delete(
        "/admin/pods/999999/force-destroy", headers={"Authorization": "Bearer mock"}
    )
    assert res.status_code == 403
