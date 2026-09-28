"""SCORE-HYBRID: Automated tests for Flag Submission API, Rubrics & Conflict State Machine.

Validates:
- G-01: Automated scoring produces correct PASS/FAIL/INCOMPLETE per milestone
- G-03: Milestone verification and review records correctly persist per student
- G-09: Hybrid scoring 3-outcome state machine and automatic routing into INST-03 review queue
- TC-S12-06: Scenario 1 Reconnaissance and exploitation hybrid milestone completion
- TC-S12-10: Automated scoring correlation, persistence, and conflicting evidence escalation
- PR #106 Review Findings:
  * Finding #1: Opaque flags and oracle defense (identical INCOMPLETE response for unverified flags)
  * Finding #2: Already-passed milestone with invalid flag does not open conflict
  * Finding #3: Compare-and-Swap (CAS) with 409 Conflict on stale review resolution
  * Finding #4: Audit log event REVIEW_CASE_RESOLVED on SYSTEM_HYBRID auto-approval
  * Finding #5: Pod attribution strictly scoped to scenario (never borrows other scenario's pod)
  * Finding #6: Pod status ACTIVE guard and live container check with scoring enabled

Owner: Shekinah Jabez Florentino
Reviewer: Lenie Joice Mendoza
"""
from __future__ import annotations

import json
import os
import sqlite3
import tempfile
from pathlib import Path
from typing import Dict, Optional, Tuple
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

import auth
import db
import keycloak_admin
import migrate
from provision_api_fastapi import app
from rubrics import (
    CATALOG_SCENARIO_IDS,
    DEFAULT_RUBRICS,
    get_rubric,
    list_rubrics,
    validate_flag,
)
import scoring_state
from hybrid_scoring import _resolve_pod_id_for_student


# ---------------------------------------------------------------------------
# Fixtures & Test Setup
# ---------------------------------------------------------------------------

class FakeKeycloak:
    def __init__(self):
        self.users = {}

    def add(self, username, *roles):
        self.users[username] = list(roles)


def _claims(username: str, *roles: str) -> dict:
    return {
        "preferred_username": username,
        "sub": f"sub-{username}",
        "realm_access": {"roles": list(roles)},
    }


@pytest.fixture
def hybrid_db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Hermetic SQLite database initialized with all migrations up to v5."""
    db_file = tmp_path / "test_hybrid.db"
    monkeypatch.setattr(db, "DB_PATH", str(db_file))
    monkeypatch.setenv("COHORT_FLAG_SECRET", "test-cohort-secret-hybrid")
    migrate.apply(str(db_file))
    return str(db_file)


@pytest.fixture
def client(hybrid_db: str, monkeypatch: pytest.MonkeyPatch):
    """TestClient with mocked infrastructure dependencies."""
    monkeypatch.setattr("pods_router.available_ram_mb", lambda: 10**6)
    monkeypatch.setattr("pods_router.get_lxd_free_mb", lambda: 10**6)
    monkeypatch.setattr("pods_router.perform_provisioning", lambda *a, **k: None)
    monkeypatch.setattr("pods_router.perform_destruction", lambda *a, **k: None)

    kc = FakeKeycloak()
    kc.add("student_shekinah", "student")
    kc.add("student_victim", "student")
    kc.add("instructor_lenie", "instructor")
    kc.add("admin_demo", "admin")
    kc.add("norole_user")
    monkeypatch.setattr(keycloak_admin, "get_client", lambda: kc)

    # Disable live LXD/SSH verifier during unit tests by default
    monkeypatch.setattr(scoring_state, "SCORING_ENABLED", False)

    return TestClient(app)


def set_caller(app_instance, username: str, *roles: str):
    """Set the authenticated caller claims on the FastAPI application."""
    if not username:
        app_instance.dependency_overrides.pop(auth.verify_token, None)
        return None
    else:
        claims = _claims(username, *roles)
        app_instance.dependency_overrides[auth.verify_token] = lambda: claims
        return claims


def insert_test_pod(db_path: str, student_id: str, scenario_id: int = 1, pod_id: int = 101, status: str = "ACTIVE"):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    with conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO pods (id, student_id, pod_id, scenario_id, status)
            VALUES (?, ?, ?, ?, ?)
            """,
            (pod_id, student_id, pod_id, str(scenario_id).zfill(2), status),
        )
    conn.close()


def insert_milestone_pass(db_path: str, student_id: str, scenario_id: int, milestone_id: int, pod_id: int = 101):
    conn = sqlite3.connect(db_path)
    with conn:
        conn.execute(
            """
            INSERT INTO milestone_verification
            (pod_id, student_id, scenario_id, milestone_id, status, detection_score, detection_data)
            VALUES (?, ?, ?, ?, 'PASS', 0, 'test_fixture_pass')
            """,
            (pod_id, student_id, scenario_id, milestone_id),
        )
    conn.close()


def plant_dynamic_flag(
    db_path: str,
    student_id: str,
    scenario_id: int,
    milestone_id: int,
    pod_id: int = 101,
) -> str:
    """Generate and persist a dynamic flag for a student, returning the flag string.

    Used by tests that need a valid flag for a student context now that the static
    bridge is blocked for authenticated students.
    """
    from flag_planting import generate_milestone_flag, save_pod_flags

    flag = generate_milestone_flag(student_id, scenario_id, milestone_id)
    conn = sqlite3.connect(db_path)
    save_pod_flags(conn, pod_id, student_id, scenario_id, {milestone_id: flag})
    conn.close()
    return flag


# ---------------------------------------------------------------------------
# 1. Schema & Migration Tests
# ---------------------------------------------------------------------------

def test_migration_v5_creates_table_and_indexes(hybrid_db: str):
    """Verify v5.sql creates milestone_rubrics table, checks, and conflict index."""
    conn = sqlite3.connect(hybrid_db)
    conn.row_factory = sqlite3.Row

    # Check migration version
    ver = migrate.current_version(conn)
    assert ver >= 5

    # Check table existence and columns
    cols = {r["name"]: r for r in conn.execute("PRAGMA table_info(milestone_rubrics)").fetchall()}
    assert "scenario_id" in cols
    assert "milestone_id" in cols
    assert "name" in cols
    assert "criteria" in cols
    assert "expected_flag" in cols
    assert "points" in cols

    # Check index on review_cases
    indexes = {r["name"] for r in conn.execute("PRAGMA index_list(review_cases)").fetchall()}
    assert "idx_conflict_cases_lookup" in indexes

    # Verify seed count (13 catalog milestones across 4 scenarios)
    count = conn.execute("SELECT COUNT(*) FROM milestone_rubrics").fetchone()[0]
    assert count == 13
    conn.close()


def test_migration_v5_is_idempotent(hybrid_db: str):
    """Running migrate.apply repeatedly must not throw constraint or syntax errors."""
    applied_ver = migrate.apply(hybrid_db)
    assert applied_ver >= 5
    conn = sqlite3.connect(hybrid_db)
    count = conn.execute("SELECT COUNT(*) FROM milestone_rubrics").fetchone()[0]
    assert count == 13
    conn.close()


# ---------------------------------------------------------------------------
# 2. Rubrics & Constant-Time Validation Unit Tests
# ---------------------------------------------------------------------------

def test_rubrics_validate_flag_constant_time(hybrid_db: str):
    """Verify validate_flag matches correct flags and rejects incorrect ones."""
    conn = sqlite3.connect(hybrid_db)
    conn.row_factory = sqlite3.Row

    # Scenario 1, Milestone 1: expected FLAG{S01_M1_7F8C2A1E9D4B}
    valid, rubric = validate_flag(conn, 1, 1, "FLAG{S01_M1_7F8C2A1E9D4B}")
    assert valid is True
    assert rubric["name"] == "Host Discovery"

    # Whitespace and case tolerance
    valid, _ = validate_flag(conn, 1, 1, "  flag{s01_m1_7f8c2a1e9d4b} \n")
    assert valid is True

    # Incorrect flag
    valid, rubric = validate_flag(conn, 1, 1, "FLAG{WRONG_FLAG}")
    assert valid is False
    assert rubric is not None

    # Empty flag
    valid, _ = validate_flag(conn, 1, 1, "")
    assert valid is False

    # Nonexistent milestone
    valid, rubric = validate_flag(conn, 1, 99, "FLAG{TEST}")
    assert valid is False
    assert rubric is None

    conn.close()


# ---------------------------------------------------------------------------
# 3. The 3-Outcome State Machine Tests (G-09)
# ---------------------------------------------------------------------------

def test_state_machine_outcome_pass(client, hybrid_db: str):
    """Outcome 1 (PASS): Flag + State agree -> PASS. Records milestone_verification."""
    student = "student_shekinah"
    set_caller(app, student, "student")
    insert_test_pod(hybrid_db, student, scenario_id=1, pod_id=101, status="ACTIVE")
    flag = plant_dynamic_flag(hybrid_db, student, scenario_id=1, milestone_id=1, pod_id=101)
    # State is PASS
    insert_milestone_pass(hybrid_db, student, scenario_id=1, milestone_id=1, pod_id=101)

    # Submit authentic flag
    res = client.post(
        "/progress/1/flag",
        json={"milestone_id": 1, "flag": flag},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["outcome"] == "PASS"
    assert data["status"] == "PASS"
    assert data["scenario_id"] == 1
    assert data["milestone_id"] == 1
    assert data["review_id"] is None
    assert "corroborated" in data["message"].lower()

    # Verify persistent state in milestone_verification
    conn = sqlite3.connect(hybrid_db)
    conn.row_factory = sqlite3.Row
    row = conn.execute(
        "SELECT * FROM milestone_verification WHERE student_id=? AND scenario_id=? AND milestone_id=?",
        (student, 1, 1),
    ).fetchone()
    assert row is not None
    assert row["status"] == "PASS"
    conn.close()


def test_state_machine_outcome_escalate_flag_without_state(client, hybrid_db: str):
    """Outcome 2 (ESCALATE): Flag valid but state NOT pass -> routes to review_cases.

    Finding #1: Response to student is indistinguishable from INCOMPLETE,
    preventing confirmation oracle attacks.
    """
    student = "student_shekinah"
    set_caller(app, student, "student")
    insert_test_pod(hybrid_db, student, scenario_id=1, pod_id=101, status="ACTIVE")
    flag = plant_dynamic_flag(hybrid_db, student, scenario_id=1, milestone_id=1, pod_id=101)
    # NOTE: No milestone_verification PASS record inserted

    # Student submits valid flag without doing the container work
    res = client.post(
        "/progress/1/flag",
        json={"milestone_id": 1, "flag": flag},
    )
    assert res.status_code == 200
    data = res.json()
    # Student receives INCOMPLETE
    assert data["outcome"] == "INCOMPLETE"
    assert data["status"] == "INCOMPLETE"
    assert data["review_id"] is None

    # Server escalates conflict to review_cases
    conn = sqlite3.connect(hybrid_db)
    conn.row_factory = sqlite3.Row
    rev = conn.execute(
        "SELECT * FROM review_cases WHERE student_id=? AND scenario_id=1 AND milestone_id=1",
        (student,),
    ).fetchone()
    assert rev is not None
    assert rev["student_id"] == student
    assert rev["scenario_id"] == 1
    assert rev["milestone_id"] == 1
    assert rev["case_type"] == "SCORING_CONFLICT"
    assert rev["status"] == "PENDING"
    assert "flag valid" in rev["conflict_reason"].lower()

    # Zero-leakage check: evidence_data must NOT leak expected_flag
    ev_data = json.loads(rev["evidence_data"])
    assert "expected_flag" not in ev_data
    assert flag not in rev["evidence_data"]
    conn.close()


def test_state_machine_outcome_state_without_flag_incomplete(client, hybrid_db: str):
    """G-09 Case 3: live state PASS + invalid flag -> student INCOMPLETE + one PENDING conflict.

    No durable PASS until instructor Approve; second submit dedups.
    """
    student = "student_shekinah"
    set_caller(app, student, "student")
    insert_test_pod(hybrid_db, student, scenario_id=1, pod_id=101, status="ACTIVE")

    orig_scoring = scoring_state.SCORING_ENABLED
    orig_ssh = scoring_state.SSHVerifier

    class StubVerifier:
        async def verify_milestone(self, sid, scen_id, mid):
            return "PASS", "Container check succeeded"

    scoring_state.SCORING_ENABLED = True
    scoring_state.SSHVerifier = StubVerifier

    try:
        res_case3 = client.post(
            "/progress/1/flag",
            json={"milestone_id": 1, "flag": "FLAG{INCORRECT_FLAG_VALUE}"},
        )
        assert res_case3.status_code == 200
        data_case3 = res_case3.json()

        # Case 4 baseline (scoring off so live stub is irrelevant): neither signal
        scoring_state.SCORING_ENABLED = False
        res_case4 = client.post(
            "/progress/1/flag",
            json={"milestone_id": 2, "flag": "FLAG{BOGUS_ATTEMPT}"},
        )
        assert res_case4.status_code == 200
        data_case4 = res_case4.json()

        for key in ("outcome", "status", "message", "review_id"):
            assert data_case3[key] == data_case4[key]
        assert data_case3["outcome"] == "INCOMPLETE"
        assert data_case3["status"] == "INCOMPLETE"
        assert data_case3["review_id"] is None
        assert data_case3["message"] == (
            "Milestone incomplete: Neither the submitted flag nor container state satisfied rubric criteria."
        )

        conn = sqlite3.connect(hybrid_db)
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT review_id, case_type, status FROM review_cases "
            "WHERE student_id=? AND scenario_id=1 AND milestone_id=1",
            (student,),
        ).fetchall()
        assert len(rows) == 1
        assert rows[0]["case_type"] == "SCORING_CONFLICT"
        assert rows[0]["status"] == "PENDING"
        first_id = rows[0]["review_id"]
        mv_count = conn.execute(
            "SELECT COUNT(*) FROM milestone_verification WHERE student_id=? AND scenario_id=1 AND milestone_id=1 AND status='PASS'",
            (student,),
        ).fetchone()[0]
        assert mv_count == 0
        live_tag = conn.execute(
            "SELECT COUNT(*) FROM milestone_verification WHERE detection_data='corroborated_live_check'"
        ).fetchone()[0]
        assert live_tag == 0
        conn.close()

        # Dedup: second Case 3 submit keeps a single PENDING conflict
        scoring_state.SCORING_ENABLED = True
        res_dup = client.post(
            "/progress/1/flag",
            json={"milestone_id": 1, "flag": "FLAG{INCORRECT_FLAG_VALUE}"},
        )
        assert res_dup.status_code == 200
        assert res_dup.json()["outcome"] == "INCOMPLETE"
        conn = sqlite3.connect(hybrid_db)
        rows2 = conn.execute(
            "SELECT review_id, status FROM review_cases "
            "WHERE student_id=? AND scenario_id=1 AND milestone_id=1",
            (student,),
        ).fetchall()
        assert len(rows2) == 1
        assert rows2[0][0] == first_id
        assert rows2[0][1] == "PENDING"
        conn.close()
    finally:
        scoring_state.SCORING_ENABLED = orig_scoring
        scoring_state.SSHVerifier = orig_ssh


def test_state_machine_outcome_neither_incomplete(client, hybrid_db: str):
    """Outcome 4 (INCOMPLETE): Invalid flag AND state NOT pass -> INCOMPLETE, no review case."""
    student = "student_shekinah"
    set_caller(app, student, "student")
    insert_test_pod(hybrid_db, student, scenario_id=1, pod_id=101, status="ACTIVE")

    # Neither signal is satisfied
    res = client.post(
        "/progress/1/flag",
        json={"milestone_id": 1, "flag": "FLAG{BOGUS_ATTEMPT}"},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["outcome"] == "INCOMPLETE"
    assert data["status"] == "INCOMPLETE"
    assert data["review_id"] is None

    # Confirm NO review case was created
    conn = sqlite3.connect(hybrid_db)
    count = conn.execute("SELECT COUNT(*) FROM review_cases").fetchone()[0]
    assert count == 0
    conn.close()


# ---------------------------------------------------------------------------
# 4. TC-S12-06 & TC-S12-10 Specification Tests
# ---------------------------------------------------------------------------

def test_tc_s12_06_scenario_1_recon_and_exploitation(client, hybrid_db: str):
    """TC-S12-06: Scenario 1 - recon and exploitation end-to-end milestone progression.

    Validates all 4 milestones of Scenario 01 with flag submission and state corroboration.
    """
    student = "student_shekinah"
    set_caller(app, student, "student")
    insert_test_pod(hybrid_db, student, scenario_id=1, pod_id=101, status="ACTIVE")

    s1_milestones = [
        (1, "Host Discovery"),
        (2, "Port Enumeration"),
        (3, "Service Version Detection"),
        (4, "Tomcat Manager Exploitation"),
    ]

    for m_id, name in s1_milestones:
        # Pre-seed container state pass for that milestone
        insert_milestone_pass(hybrid_db, student, scenario_id=1, milestone_id=m_id, pod_id=101)
        flag = plant_dynamic_flag(hybrid_db, student, scenario_id=1, milestone_id=m_id, pod_id=101)

        res = client.post(
            "/progress/01/flag",  # Test leading zero formatting support
            json={"milestone_id": m_id, "flag": flag},
        )
        assert res.status_code == 200, f"Milestone {m_id} ({name}) submission failed: {res.text}"
        data = res.json()
        assert data["outcome"] == "PASS"
        assert data["scenario_id"] == 1
        assert data["milestone_id"] == m_id

    # Verify GET /progress shows all 4 milestones passed
    prog_res = client.get("/progress")
    assert prog_res.status_code == 200
    prog_data = prog_res.json()
    passed_mids = {m["milestone_id"] for m in prog_data["milestones"] if m["status"] == "PASS"}
    assert {1, 2, 3, 4}.issubset(passed_mids)


def test_tc_s12_10_conflict_routed_to_inst_03_queue_and_resolved(client, hybrid_db: str):
    """TC-S12-10: Automated scoring and persistence with conflicting evidence routing and instructor resolution.

    1. Student triggers conflict (flag without state).
    2. Conflict automatically routed to INST-03 review queue.
    3. Instructor reviews case via GET /instructor/reviews/{id}.
    4. Instructor approves case via POST /instructor/reviews/{id}/resolve.
    5. milestone_verification is synchronized with status='PASS'.
    """
    student = "student_shekinah"
    set_caller(app, student, "student")
    insert_test_pod(hybrid_db, student, scenario_id=6, pod_id=202, status="ACTIVE")
    flag = plant_dynamic_flag(hybrid_db, student, scenario_id=6, milestone_id=1, pod_id=202)

    # Step 1: Submit valid flag for Scenario 6 M1 without state pass -> Escalated on server, returns INCOMPLETE to student
    res = client.post(
        "/progress/6/flag",
        json={"milestone_id": 1, "flag": flag},
    )
    assert res.status_code == 200
    sub_data = res.json()
    assert sub_data["outcome"] == "INCOMPLETE"

    # Get the escalated review_id from database
    conn = sqlite3.connect(hybrid_db)
    rev_row = conn.execute(
        "SELECT review_id FROM review_cases WHERE student_id=? AND scenario_id=6 AND milestone_id=1 AND status='PENDING'",
        (student,),
    ).fetchone()
    conn.close()
    assert rev_row is not None
    review_id = rev_row[0]

    # Step 2: Instructor logs in and queries the INST-03 review queue
    set_caller(app, "instructor_lenie", "instructor")
    queue_res = client.get("/instructor/reviews?status_filter=PENDING")
    assert queue_res.status_code == 200
    queue_items = queue_res.json()["reviews"]
    matching = [q for q in queue_items if q["review_id"] == review_id]
    assert len(matching) == 1
    assert matching[0]["case_type"] == "SCORING_CONFLICT"

    # Step 3: Instructor inspects review case detail
    detail_res = client.get(f"/instructor/reviews/{review_id}")
    assert detail_res.status_code == 200
    detail = detail_res.json()
    assert detail["student_id"] == student
    assert detail["scenario_id"] == 6
    assert detail["milestone_id"] == 1

    # Step 4: Instructor approves the conflict case
    resolve_res = client.post(
        f"/instructor/reviews/{review_id}/resolve",
        json={"status": "APPROVED", "score": 100, "feedback": "Verified exploit in student logs."},
    )
    assert resolve_res.status_code == 200
    assert resolve_res.json()["decision"] == "APPROVED"

    # Step 5: Verify synchronization loop (milestone_verification now records PASS)
    set_caller(app, student, "student")
    prog_res = client.get("/progress")
    assert prog_res.status_code == 200
    milestones = prog_res.json()["milestones"]
    s6_m1 = [m for m in milestones if m["scenario_id"] == 6 and m["milestone_id"] == 1 and m["status"] == "PASS"]
    assert len(s6_m1) >= 1


# ---------------------------------------------------------------------------
# 5. Security, Anti-Leak & IDOR Defense Tests
# ---------------------------------------------------------------------------

def test_flag_submit_cannot_impersonate_another_student(client, hybrid_db: str):
    """Smuggling student_id in body must be ignored."""
    set_caller(app, "student_shekinah", "student")
    insert_test_pod(hybrid_db, "student_shekinah", scenario_id=1, pod_id=101)
    insert_test_pod(hybrid_db, "student_victim", scenario_id=1, pod_id=999)
    flag_victim = plant_dynamic_flag(hybrid_db, "student_victim", scenario_id=1, milestone_id=1, pod_id=999)

    # Attacker tries to submit a flag on behalf of 'student_victim'
    res = client.post(
        "/progress/1/flag",
        json={
            "student_id": "student_victim",  # Smuggled parameter
            "milestone_id": 1,
            "flag": flag_victim,
        },
    )
    assert res.status_code == 200

    # Ensure review or verification row belongs to caller 'student_shekinah', NEVER 'student_victim'
    conn = sqlite3.connect(hybrid_db)
    victim_rev = conn.execute("SELECT * FROM review_cases WHERE student_id='student_victim'").fetchall()
    assert len(victim_rev) == 0
    victim_mv = conn.execute("SELECT * FROM milestone_verification WHERE student_id='student_victim'").fetchall()
    assert len(victim_mv) == 0
    conn.close()


def test_conflict_escalation_does_not_leak_expected_flag(client, hybrid_db: str):
    """SCORING_CONFLICT is staff-only: student GET 404; instructor sees evidence without expected_flag."""
    student = "student_shekinah"
    set_caller(app, student, "student")
    insert_test_pod(hybrid_db, student, scenario_id=1, pod_id=101)
    flag = plant_dynamic_flag(hybrid_db, student, scenario_id=1, milestone_id=1, pod_id=101)

    # Trigger Case 2 conflict (valid flag without state)
    client.post(
        "/progress/1/flag",
        json={"milestone_id": 1, "flag": flag},
    )

    conn = sqlite3.connect(hybrid_db)
    rev_row = conn.execute(
        "SELECT review_id FROM review_cases WHERE student_id=? AND scenario_id=1 AND milestone_id=1",
        (student,),
    ).fetchone()
    conn.close()
    assert rev_row is not None
    rev_id = rev_row[0]

    # Student must not see SCORING_CONFLICT while PENDING
    rev_res = client.get(f"/reviews/{rev_id}")
    assert rev_res.status_code == 404

    # Instructor GET remains full-fidelity for triage
    set_caller(app, "instructor_lenie", "instructor")
    inst_res = client.get(f"/instructor/reviews/{rev_id}")
    assert inst_res.status_code == 200
    inst_body = inst_res.json()
    assert inst_body["case_type"] == "SCORING_CONFLICT"
    assert flag not in inst_res.text
    assert "expected_flag" not in inst_res.text
    evidence = inst_body.get("evidence_data") or ""
    assert "Flag valid" in inst_body.get("conflict_reason", "") or "flag_valid" in evidence


def test_rubrics_endpoint_strips_expected_flag(client, hybrid_db: str):
    """GET /progress/{id}/rubrics must omit expected_flag."""
    set_caller(app, "student_shekinah", "student")
    res = client.get("/progress/1/rubrics")
    assert res.status_code == 200
    data = res.json()
    assert "rubrics" in data
    assert len(data["rubrics"]) == 4

    for r in data["rubrics"]:
        assert "expected_flag" not in r
        assert "FLAG{" not in json.dumps(r)
        assert "criteria" in r
        assert "points" in r
        assert "name" in r


def test_conflict_deduplication(client, hybrid_db: str):
    """Repeated conflict submissions update single PENDING row."""
    student = "student_shekinah"
    set_caller(app, student, "student")
    insert_test_pod(hybrid_db, student, scenario_id=9, pod_id=303)
    flag = plant_dynamic_flag(hybrid_db, student, scenario_id=9, milestone_id=1, pod_id=303)

    # First conflict attempt (valid flag without state)
    res1 = client.post(
        "/progress/9/flag",
        json={"milestone_id": 1, "flag": flag},
    )
    assert res1.json()["outcome"] == "INCOMPLETE"

    # Second conflict attempt for same milestone
    res2 = client.post(
        "/progress/9/flag",
        json={"milestone_id": 1, "flag": flag},
    )
    assert res2.json()["outcome"] == "INCOMPLETE"

    conn = sqlite3.connect(hybrid_db)
    count = conn.execute(
        "SELECT COUNT(*) FROM review_cases WHERE student_id=? AND scenario_id=9 AND milestone_id=1",
        (student,),
    ).fetchone()[0]
    assert count == 1
    conn.close()


def test_rbac_auth_guards(client, hybrid_db: str):
    """Verify 401 unauthenticated and 403 no-role."""
    # Unauthenticated
    set_caller(app, None)
    res = client.post("/progress/1/flag", json={"milestone_id": 1, "flag": "FLAG{TEST}"})
    assert res.status_code == 401

    res = client.get("/progress/1/rubrics")
    assert res.status_code == 401

    # Role-less user
    set_caller(app, "norole_user")
    res = client.post("/progress/1/flag", json={"milestone_id": 1, "flag": "FLAG{TEST}"})
    assert res.status_code == 403

    res = client.get("/progress/1/rubrics")
    assert res.status_code == 403


def test_input_boundary_validations(client, hybrid_db: str):
    """Boundary testing: invalid scenarios, milestones, and flags."""
    set_caller(app, "student_shekinah", "student")

    # Invalid scenario
    res = client.post("/progress/99/flag", json={"milestone_id": 1, "flag": "FLAG{TEST}"})
    assert res.status_code == 400

    # Non-integer scenario string
    res = client.post("/progress/invalid/flag", json={"milestone_id": 1, "flag": "FLAG{TEST}"})
    assert res.status_code == 400

    # Invalid milestone id out of Pydantic bounds (le=10)
    res = client.post("/progress/1/flag", json={"milestone_id": 99, "flag": "FLAG{TEST}"})
    assert res.status_code == 422

    # Milestone id exceeding scenario milestone count (e.g. Milestone 5 for Scenario 1)
    res = client.post("/progress/1/flag", json={"milestone_id": 5, "flag": "FLAG{TEST}"})
    assert res.status_code == 400

    # Empty flag
    res = client.post("/progress/1/flag", json={"milestone_id": 1, "flag": "   "})
    assert res.status_code == 400


# ---------------------------------------------------------------------------
# 6. Review Findings Regression & Verification Tests (PR #106 Findings #1 - #6)
# ---------------------------------------------------------------------------

def test_unverified_flag_submission_returns_identical_incomplete_response(client, hybrid_db: str):
    """Finding #1: Valid flag without state must return identical response to invalid flag (oracle defense)."""
    student = "student_shekinah"
    set_caller(app, student, "student")
    insert_test_pod(hybrid_db, student, scenario_id=1, pod_id=101, status="ACTIVE")
    flag = plant_dynamic_flag(hybrid_db, student, scenario_id=1, milestone_id=1, pod_id=101)

    # Submission A: Correct flag without container state
    res_valid = client.post(
        "/progress/1/flag",
        json={"milestone_id": 1, "flag": flag},
    )
    # Submission B: Wrong flag without container state
    res_wrong = client.post(
        "/progress/1/flag",
        json={"milestone_id": 1, "flag": "FLAG{WRONG_GUESS_TOKEN}"},
    )

    data_valid = res_valid.json()
    data_wrong = res_wrong.json()

    # The student response MUST be identical to prevent guessing oracle
    assert data_valid["outcome"] == data_wrong["outcome"] == "INCOMPLETE"
    assert data_valid["status"] == data_wrong["status"] == "INCOMPLETE"
    assert data_valid["message"] == data_wrong["message"]
    assert data_valid["review_id"] == data_wrong["review_id"] is None

    # Server MUST have escalated only the valid flag to review_cases
    conn = sqlite3.connect(hybrid_db)
    conn.row_factory = sqlite3.Row
    rev_cases = conn.execute(
        "SELECT * FROM review_cases WHERE student_id=? AND scenario_id=1 AND milestone_id=1",
        (student,),
    ).fetchall()
    assert len(rev_cases) == 1
    assert rev_cases[0]["status"] == "PENDING"
    conn.close()


def test_already_passed_milestone_with_invalid_flag_does_not_escalate(client, hybrid_db: str):
    """Finding #2: Invalid flag after PASS returns generic incomplete (no progress oracle) and does not escalate."""
    student = "student_shekinah"
    set_caller(app, student, "student")
    insert_test_pod(hybrid_db, student, scenario_id=1, pod_id=101, status="ACTIVE")
    insert_milestone_pass(hybrid_db, student, scenario_id=1, milestone_id=1, pod_id=101)

    # Student mistypes flag for already completed milestone
    res = client.post(
        "/progress/1/flag",
        json={"milestone_id": 1, "flag": "FLAG{TYPO_AFTER_PASS}"},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["outcome"] == "INCOMPLETE"
    assert data["message"] == (
        "Milestone incomplete: Neither the submitted flag nor container state satisfied rubric criteria."
    )

    # Confirm NO review case was opened in review_cases
    conn = sqlite3.connect(hybrid_db)
    count = conn.execute("SELECT COUNT(*) FROM review_cases WHERE student_id=?", (student,)).fetchone()[0]
    assert count == 0
    conn.close()


def test_resolve_review_case_conflict_returns_409_if_already_resolved(client, hybrid_db: str):
    """Finding #3: Stale expected_status=PENDING after auto-approve returns 409 Conflict."""
    student = "student_shekinah"
    set_caller(app, student, "student")
    insert_test_pod(hybrid_db, student, scenario_id=1, pod_id=101, status="ACTIVE")
    flag = plant_dynamic_flag(hybrid_db, student, scenario_id=1, milestone_id=1, pod_id=101)

    # Create a conflict case
    client.post(
        "/progress/1/flag",
        json={"milestone_id": 1, "flag": flag},
    )

    conn = sqlite3.connect(hybrid_db)
    rev_row = conn.execute(
        "SELECT review_id FROM review_cases WHERE student_id=? AND scenario_id=1 AND milestone_id=1 AND status='PENDING'",
        (student,),
    ).fetchone()
    review_id = rev_row[0]

    # Interleaving event: Student completes container state and resubmits flag -> auto-approves case to 'APPROVED'
    insert_milestone_pass(hybrid_db, student, scenario_id=1, milestone_id=1, pod_id=101)
    res_pass = client.post(
        "/progress/1/flag",
        json={"milestone_id": 1, "flag": flag},
    )
    assert res_pass.json()["outcome"] == "PASS"

    # Instructor attempts to resolve with stale client-rendered PENDING expectation
    set_caller(app, "instructor_lenie", "instructor")
    res_resolve = client.post(
        f"/instructor/reviews/{review_id}/resolve",
        json={"status": "REJECTED", "feedback": "Too late", "expected_status": "PENDING"},
    )
    assert res_resolve.status_code == 409
    detail = res_resolve.json()["detail"].lower()
    assert "status changed" in detail
    assert "pending" in detail


def test_resolve_expected_status_invalid_returns_400(client, hybrid_db: str):
    """Garbage expected_status is rejected with 400 allow-list detail."""
    student = "student_shekinah"
    set_caller(app, student, "student")
    insert_test_pod(hybrid_db, student, scenario_id=1, pod_id=101, status="ACTIVE")
    flag = plant_dynamic_flag(hybrid_db, student, scenario_id=1, milestone_id=1, pod_id=101)
    client.post(
        "/progress/1/flag",
        json={"milestone_id": 1, "flag": flag},
    )
    conn = sqlite3.connect(hybrid_db)
    review_id = conn.execute(
        "SELECT review_id FROM review_cases WHERE student_id=? AND status='PENDING'",
        (student,),
    ).fetchone()[0]
    conn.close()

    set_caller(app, "instructor_lenie", "instructor")
    res = client.post(
        f"/instructor/reviews/{review_id}/resolve",
        json={"status": "APPROVED", "expected_status": "BOGUS"},
    )
    assert res.status_code == 400
    assert "expected_status" in res.json()["detail"].lower()


def test_resolve_regrade_approved_to_rejected_with_expected_status(client, hybrid_db: str):
    """APPROVED -> REJECTED with matching expected_status succeeds (review status only; no clawback claim)."""
    student = "student_shekinah"
    set_caller(app, student, "student")
    insert_test_pod(hybrid_db, student, scenario_id=1, pod_id=101, status="ACTIVE")
    flag = plant_dynamic_flag(hybrid_db, student, scenario_id=1, milestone_id=1, pod_id=101)
    client.post(
        "/progress/1/flag",
        json={"milestone_id": 1, "flag": flag},
    )
    conn = sqlite3.connect(hybrid_db)
    review_id = conn.execute(
        "SELECT review_id FROM review_cases WHERE student_id=? AND status='PENDING'",
        (student,),
    ).fetchone()[0]
    conn.close()

    set_caller(app, "instructor_lenie", "instructor")
    res_approve = client.post(
        f"/instructor/reviews/{review_id}/resolve",
        json={"status": "APPROVED", "expected_status": "PENDING"},
    )
    assert res_approve.status_code == 200

    res_reject = client.post(
        f"/instructor/reviews/{review_id}/resolve",
        json={"status": "REJECTED", "expected_status": "APPROVED", "feedback": "Re-grade after oral defense"},
    )
    assert res_reject.status_code == 200
    assert res_reject.json()["decision"] == "REJECTED"

    detail = client.get(f"/instructor/reviews/{review_id}").json()
    assert detail["status"] == "REJECTED"


def test_resolve_omit_expected_status_on_approved_returns_409(client, hybrid_db: str):
    """Omitting expected_status on already APPROVED uses PENDING/RETRY IN clause -> 409."""
    student = "student_shekinah"
    set_caller(app, student, "student")
    insert_test_pod(hybrid_db, student, scenario_id=1, pod_id=101, status="ACTIVE")
    flag = plant_dynamic_flag(hybrid_db, student, scenario_id=1, milestone_id=1, pod_id=101)
    client.post(
        "/progress/1/flag",
        json={"milestone_id": 1, "flag": flag},
    )
    conn = sqlite3.connect(hybrid_db)
    review_id = conn.execute(
        "SELECT review_id FROM review_cases WHERE student_id=? AND status='PENDING'",
        (student,),
    ).fetchone()[0]
    conn.close()

    set_caller(app, "instructor_lenie", "instructor")
    assert client.post(
        f"/instructor/reviews/{review_id}/resolve",
        json={"status": "APPROVED", "expected_status": "PENDING"},
    ).status_code == 200

    res = client.post(
        f"/instructor/reviews/{review_id}/resolve",
        json={"status": "REJECTED", "feedback": "stale omit"},
    )
    assert res.status_code == 409


def test_resolve_scoring_conflict_rejects_retry(client, hybrid_db: str):
    """RETRY is not allowed for SCORING_CONFLICT (students cannot see/resubmit those cases)."""
    student = "student_shekinah"
    set_caller(app, student, "student")
    insert_test_pod(hybrid_db, student, scenario_id=1, pod_id=101, status="ACTIVE")
    flag = plant_dynamic_flag(hybrid_db, student, scenario_id=1, milestone_id=1, pod_id=101)
    client.post(
        "/progress/1/flag",
        json={"milestone_id": 1, "flag": flag},
    )
    conn = sqlite3.connect(hybrid_db)
    review_id = conn.execute(
        "SELECT review_id FROM review_cases WHERE student_id=? AND status='PENDING'",
        (student,),
    ).fetchone()[0]
    conn.close()

    set_caller(app, "instructor_lenie", "instructor")
    res = client.post(
        f"/instructor/reviews/{review_id}/resolve",
        json={"status": "RETRY", "expected_status": "PENDING", "feedback": "try again"},
    )
    assert res.status_code == 400
    assert "retry is not allowed" in res.json()["detail"].lower()

    conn = sqlite3.connect(hybrid_db)
    status = conn.execute(
        "SELECT status FROM review_cases WHERE review_id=?",
        (review_id,),
    ).fetchone()[0]
    conn.close()
    assert status == "PENDING"


def test_scoring_conflict_hidden_on_student_get_and_resubmit(client, hybrid_db: str):
    """Wrong and right guesses: student GET/resubmit always 404 for SCORING_CONFLICT review id."""
    student = "student_shekinah"
    set_caller(app, student, "student")
    insert_test_pod(hybrid_db, student, scenario_id=1, pod_id=101, status="ACTIVE")
    flag = plant_dynamic_flag(hybrid_db, student, scenario_id=1, milestone_id=1, pod_id=101)

    # Wrong guess: no conflict row
    client.post(
        "/progress/1/flag",
        json={"milestone_id": 1, "flag": "FLAG{WRONG_GUESS_TOKEN}"},
    )
    # Right guess: creates PENDING SCORING_CONFLICT invisible to student
    client.post(
        "/progress/1/flag",
        json={"milestone_id": 1, "flag": flag},
    )

    conn = sqlite3.connect(hybrid_db)
    rev_row = conn.execute(
        "SELECT review_id FROM review_cases WHERE student_id=? AND case_type='SCORING_CONFLICT'",
        (student,),
    ).fetchone()
    conn.close()
    assert rev_row is not None
    rev_id = rev_row[0]

    assert client.get(f"/reviews/{rev_id}").status_code == 404
    assert client.post(
        f"/reviews/{rev_id}/resubmit",
        json={"conflict_reason": "please reconsider"},
    ).status_code == 404

    # Staff still sees triage evidence including flag_valid
    set_caller(app, "instructor_lenie", "instructor")
    inst = client.get(f"/instructor/reviews/{rev_id}")
    assert inst.status_code == 200
    assert "flag_valid" in (inst.json().get("evidence_data") or "")


def test_auto_approval_logs_review_case_resolved_event(client, hybrid_db: str):
    """Finding #4: Auto-approval of conflict cases emits REVIEW_CASE_RESOLVED audit log."""
    student = "student_shekinah"
    set_caller(app, student, "student")
    insert_test_pod(hybrid_db, student, scenario_id=1, pod_id=101, status="ACTIVE")
    flag = plant_dynamic_flag(hybrid_db, student, scenario_id=1, milestone_id=1, pod_id=101)

    # Step 1: Create conflict case
    client.post(
        "/progress/1/flag",
        json={"milestone_id": 1, "flag": flag},
    )

    conn = sqlite3.connect(hybrid_db)
    rev_id = conn.execute("SELECT review_id FROM review_cases WHERE student_id=? AND status='PENDING'", (student,)).fetchone()[0]
    conn.close()

    # Step 2: Corroborate state and auto-resolve case
    insert_milestone_pass(hybrid_db, student, scenario_id=1, milestone_id=1, pod_id=101)
    res_pass = client.post(
        "/progress/1/flag",
        json={"milestone_id": 1, "flag": flag},
    )
    assert res_pass.json()["outcome"] == "PASS"

    # Step 3: Check audit_log table for REVIEW_CASE_RESOLVED event
    conn = sqlite3.connect(hybrid_db)
    conn.row_factory = sqlite3.Row
    audit_row = conn.execute(
        "SELECT * FROM audit_log WHERE event_type='REVIEW_CASE_RESOLVED' AND student_id=?",
        (student,),
    ).fetchone()
    assert audit_row is not None
    assert f"review_id={rev_id}" in audit_row["detail"]
    assert "graded_by=SYSTEM_HYBRID" in audit_row["detail"]
    conn.close()


def test_pod_resolution_never_borrows_other_scenario_pod(hybrid_db: str):
    """Finding #5: _resolve_pod_id_for_student scopes strictly to scenario and never borrows another scenario's pod."""
    student = "student_multi"
    # Insert a pod for scenario 9
    insert_test_pod(hybrid_db, student, scenario_id=9, pod_id=909, status="ACTIVE")

    conn = sqlite3.connect(hybrid_db)
    conn.row_factory = sqlite3.Row

    # When resolving for Scenario 1, it must NOT return pod 909
    pod_id_s1 = _resolve_pod_id_for_student(conn, student, scenario_id=1)
    assert pod_id_s1 == 0

    # When resolving for Scenario 9, it correctly returns pod 909
    pod_id_s9 = _resolve_pod_id_for_student(conn, student, scenario_id=9)
    assert pod_id_s9 == 909
    conn.close()


def test_live_container_check_corroborates_pass_when_scoring_enabled(client, hybrid_db: str):
    """Finding #6: Valid flag + stub live PASS -> Case 1 PASS with corroborated_hybrid_flag_state.

    Live helper alone must not write corroborated_live_check rows.
    """
    student = "student_shekinah"
    set_caller(app, student, "student")
    insert_test_pod(hybrid_db, student, scenario_id=1, pod_id=101, status="ACTIVE")
    flag = plant_dynamic_flag(hybrid_db, student, scenario_id=1, milestone_id=1, pod_id=101)

    class MockSSHVerifier:
        async def verify_milestone(self, sid, scen_id, mid):
            return "PASS", "LXD container probe passed"

    orig_scoring = scoring_state.SCORING_ENABLED
    orig_ssh = scoring_state.SSHVerifier

    scoring_state.SCORING_ENABLED = True
    scoring_state.SSHVerifier = MockSSHVerifier

    try:
        res = client.post(
            "/progress/1/flag",
            json={"milestone_id": 1, "flag": flag},
        )
        assert res.status_code == 200
        data = res.json()
        assert data["outcome"] == "PASS"

        conn = sqlite3.connect(hybrid_db)
        conn.row_factory = sqlite3.Row
        mv = conn.execute(
            "SELECT * FROM milestone_verification WHERE student_id=? AND scenario_id=1 AND milestone_id=1",
            (student,),
        ).fetchone()
        assert mv is not None
        assert mv["status"] == "PASS"
        assert mv["detection_data"] == "corroborated_hybrid_flag_state"
        live_only = conn.execute(
            "SELECT COUNT(*) AS c FROM milestone_verification WHERE detection_data='corroborated_live_check'"
        ).fetchone()["c"]
        assert live_only == 0
        conn.close()
    finally:
        scoring_state.SCORING_ENABLED = orig_scoring
        scoring_state.SSHVerifier = orig_ssh


def test_inactive_pod_not_used_for_live_check(client, hybrid_db: str):
    """Finding #6: Pod with status != 'ACTIVE' is not probed for live container check."""
    student = "student_shekinah"
    set_caller(app, student, "student")
    # Insert pod in PROVISIONING status
    insert_test_pod(hybrid_db, student, scenario_id=1, pod_id=101, status="PROVISIONING")
    flag = plant_dynamic_flag(hybrid_db, student, scenario_id=1, milestone_id=1, pod_id=101)

    class MockSSHVerifier:
        async def verify_milestone(self, sid, scen_id, mid):
            raise RuntimeError("Should never be called for inactive pod!")

    orig_scoring = scoring_state.SCORING_ENABLED
    orig_ssh = scoring_state.SSHVerifier

    scoring_state.SCORING_ENABLED = True
    scoring_state.SSHVerifier = MockSSHVerifier

    try:
        # Submitting valid flag with PROVISIONING pod should NOT probe, returns INCOMPLETE
        res = client.post(
            "/progress/1/flag",
            json={"milestone_id": 1, "flag": flag},
        )
        assert res.status_code == 200
        data = res.json()
        assert data["outcome"] == "INCOMPLETE"
    finally:
        scoring_state.SCORING_ENABLED = orig_scoring
        scoring_state.SSHVerifier = orig_ssh


# ---------------------------------------------------------------------------
# 11. Dynamic Per-Student Milestone Flag Tests (Issue #111)
# ---------------------------------------------------------------------------

def test_dynamic_flag_case_1_pass_with_planted_flag(client, hybrid_db: str):
    """Dynamic flag planted in pod_milestone_flags + active state yields Case 1 PASS."""
    from flag_planting import generate_milestone_flag, save_pod_flags

    student = "student_shekinah"
    set_caller(app, student, "student")
    insert_test_pod(hybrid_db, student, scenario_id=1, pod_id=101, status="ACTIVE")

    # Generate and plant dynamic flag
    dynamic_flag = generate_milestone_flag(student, 1, 1)
    conn = sqlite3.connect(hybrid_db)
    save_pod_flags(conn, 101, student, 1, {1: dynamic_flag})
    conn.close()

    insert_milestone_pass(hybrid_db, student, scenario_id=1, milestone_id=1, pod_id=101)

    res = client.post(
        "/progress/1/flag",
        json={"milestone_id": 1, "flag": dynamic_flag},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["outcome"] == "PASS"
    assert data["status"] == "PASS"
    assert data["milestone_id"] == 1


def test_static_flag_rejected_for_provisioned_student(client, hybrid_db: str):
    """A provisioned student cannot use the static git answer key."""
    from flag_planting import generate_milestone_flag, save_pod_flags

    student = "student_shekinah"
    set_caller(app, student, "student")
    insert_test_pod(hybrid_db, student, scenario_id=1, pod_id=101, status="ACTIVE")

    dynamic_flag = generate_milestone_flag(student, 1, 1)
    conn = sqlite3.connect(hybrid_db)
    save_pod_flags(conn, 101, student, 1, {1: dynamic_flag})
    conn.close()

    # Student has verified container state
    insert_milestone_pass(hybrid_db, student, scenario_id=1, milestone_id=1, pod_id=101)

    # Student submits the static leaked key from v5.sql
    res = client.post(
        "/progress/1/flag",
        json={"milestone_id": 1, "flag": "FLAG{S01_M1_7F8C2A1E9D4B}"},
    )
    assert res.status_code == 200
    data = res.json()
    # Since flag is invalid for this provisioned student, state without flag escalates server-side; student sees INCOMPLETE
    assert data["outcome"] == "INCOMPLETE"


def test_unplanted_student_cannot_use_static_key(client, hybrid_db: str):
    """Student with no pod_milestone_flags row still cannot pass with the static git key.

    Regression guard for the validate_flag static fallthrough bug: when student_id
    is set but no planted row exists, the static bridge must NOT be reached.
    """
    student = "student_shekinah"
    set_caller(app, student, "student")
    insert_test_pod(hybrid_db, student, scenario_id=1, pod_id=101, status="ACTIVE")

    # Verify: no pod_milestone_flags row exists for this student
    conn = sqlite3.connect(hybrid_db)
    row = conn.execute(
        "SELECT COUNT(*) FROM pod_milestone_flags WHERE student_id=?", (student,)
    ).fetchone()
    assert row[0] == 0
    conn.close()

    # Student has verified container state
    insert_milestone_pass(hybrid_db, student, scenario_id=1, milestone_id=1, pod_id=101)

    # Student submits the static leaked key from v5.sql — must be rejected
    res = client.post(
        "/progress/1/flag",
        json={"milestone_id": 1, "flag": "FLAG{S01_M1_7F8C2A1E9D4B}"},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["outcome"] == "INCOMPLETE"


def test_cross_student_flag_isolation(client, hybrid_db: str):
    """Student A's flag submitted by Student B is rejected (anti-cheating guard)."""
    from flag_planting import generate_milestone_flag, save_pod_flags

    student_a = "student_shekinah"
    student_b = "student_victim"

    # Set up Student B
    set_caller(app, student_b, "student")
    insert_test_pod(hybrid_db, student_b, scenario_id=1, pod_id=102, status="ACTIVE")
    flag_b = generate_milestone_flag(student_b, 1, 1)
    flag_a = generate_milestone_flag(student_a, 1, 1)
    assert flag_a != flag_b

    conn = sqlite3.connect(hybrid_db)
    save_pod_flags(conn, 102, student_b, 1, {1: flag_b})
    conn.close()

    insert_milestone_pass(hybrid_db, student_b, scenario_id=1, milestone_id=1, pod_id=102)

    # Student B submits Student A's flag
    res = client.post(
        "/progress/1/flag",
        json={"milestone_id": 1, "flag": flag_a},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["outcome"] == "INCOMPLETE"


def test_audit_log_zero_leakage_after_flag_planting(client, hybrid_db: str):
    """Zero-leakage: audit_log detail never contains plaintext flags after a full plant+submit flow."""
    from flag_planting import generate_milestone_flag, save_pod_flags

    student = "student_shekinah"
    set_caller(app, student, "student")
    insert_test_pod(hybrid_db, student, scenario_id=1, pod_id=101, status="ACTIVE")

    dynamic_flag = generate_milestone_flag(student, 1, 1)
    conn = sqlite3.connect(hybrid_db)
    save_pod_flags(conn, 101, student, 1, {1: dynamic_flag})
    conn.close()

    insert_milestone_pass(hybrid_db, student, scenario_id=1, milestone_id=1, pod_id=101)

    # Submit the correct flag to trigger full scoring + audit logging path
    res = client.post(
        "/progress/1/flag",
        json={"milestone_id": 1, "flag": dynamic_flag},
    )
    assert res.status_code == 200

    # Now verify no flag literals leaked into audit_log
    conn = sqlite3.connect(hybrid_db)
    conn.row_factory = sqlite3.Row
    rows = conn.execute("SELECT * FROM audit_log").fetchall()
    assert len(rows) > 0, "Expected audit_log rows after flag submission"
    for r in rows:
        detail = r["detail"] or ""
        assert "FLAG{" not in detail, f"Plaintext flag leaked in audit_log: {detail}"
    conn.close()


def test_empty_or_whitespace_flag_rejected(client, hybrid_db: str):
    """Empty or whitespace-only flag submission returns HTTP 400."""
    student = "student_shekinah"
    set_caller(app, student, "student")

    res = client.post(
        "/progress/1/flag",
        json={"milestone_id": 1, "flag": "   "},
    )
    assert res.status_code == 400
    assert "Flag cannot be empty" in res.json()["detail"]
