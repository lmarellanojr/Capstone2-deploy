"""Unit tests for v4 review_cases schema, review APIs, and RBAC isolation."""
import sqlite3
import pytest
from fastapi.testclient import TestClient

import migrate
import db
import config
import auth
from auth import verify_token
from provision_api_fastapi import app

# pylxd stub and the temp_db autouse fixture (fresh SQLite per test, default
# student claim on verify_token) now live in conftest.py -- shared with
# test_admin_pods.py and test_role_guard_matrix.py, which had byte-identical
# copies of both.


def _create_v3_milestone_verification(conn):
    """The milestone_verification table exactly as a real DB at schema v3 has it
    (v1.sql's CREATE TABLE plus the student_id column migrate.py adds for v3).

    These fixtures record v1-v3 as applied, so they must also contain v1's
    tables: later migrations (v6's ux_milestone_browser_pass index) rely on
    them, and a real v3 database always has this table.
    """
    conn.execute("""
        CREATE TABLE milestone_verification (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            pod_id          INTEGER NOT NULL,
            scenario_id     INTEGER NOT NULL,
            milestone_id    INTEGER NOT NULL,
            status          TEXT NOT NULL,
            detection_score INTEGER DEFAULT 0,
            detection_data  TEXT,
            verified_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            student_id      TEXT
        )
    """)


def student_claims(username="student1"):
    return {
        "preferred_username": username,
        "realm_access": {"roles": ["student"]}
    }


def instructor_claims(username="instructor1"):
    return {
        "preferred_username": username,
        "realm_access": {"roles": ["instructor"]}
    }


def test_v4_migration_creates_review_cases():
    conn = db.get_db_connection()
    tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
    assert "review_cases" in tables
    assert migrate.latest_version() >= 4

    indexes = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='index'").fetchall()]
    assert "idx_review_cases_student" in indexes
    assert "idx_review_cases_status" in indexes
    assert "idx_review_cases_case_type" in indexes

    cols = {r[1] for r in conn.execute("PRAGMA table_info(review_cases)").fetchall()}
    assert "case_type" in cols
    assert "conflict_reason" in cols
    assert "evidence_data" in cols
    assert "report_text" in cols
    conn.close()


def test_migration_upgrades_legacy_review_cases(tmp_path):
    db_file = str(tmp_path / "legacy_review_test.db")
    conn = sqlite3.connect(db_file)
    # 1. Creates the old review table with report_text NOT NULL and score DEFAULT 0
    conn.execute("""
        CREATE TABLE schema_version (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)
    conn.execute("INSERT INTO schema_version (version) VALUES (1), (2), (3)")
    _create_v3_milestone_verification(conn)
    conn.execute("""
        CREATE TABLE review_cases (
            review_id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id TEXT NOT NULL,
            scenario_id INTEGER NOT NULL,
            milestone_id INTEGER,
            report_text TEXT NOT NULL,
            score INTEGER DEFAULT 0,
            status TEXT DEFAULT 'PENDING',
            feedback TEXT,
            graded_by TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    # Pre-create indexes on old table to verify they are not lost during rebuild
    conn.execute("CREATE INDEX idx_review_cases_student ON review_cases(student_id)")
    conn.execute("CREATE INDEX idx_review_cases_status ON review_cases(status)")
    # 2. Inserts an old review row
    conn.execute(
        "INSERT INTO review_cases (student_id, scenario_id, milestone_id, report_text, status) "
        "VALUES ('legacy_student', 1, 1, 'Legacy report text content', 'PENDING')"
    )
    conn.commit()
    conn.close()

    # 3. Runs migrate.apply()
    assert migrate.apply(db_file) >= 4

    # 4. Confirms the row still exists and ungraded score is NULL
    conn = sqlite3.connect(db_file)
    row = conn.execute("SELECT * FROM review_cases WHERE student_id='legacy_student'").fetchone()
    assert row is not None
    cols = [d[0] for d in conn.execute("SELECT * FROM review_cases").description]
    row_dict = dict(zip(cols, row))
    assert row_dict["report_text"] == "Legacy report text content"
    assert row_dict["status"] == "PENDING"
    assert row_dict["case_type"] == "WRITTEN_REPORT"
    assert row_dict["score"] is None

    # 5. Confirms the new columns and indexes exist
    col_names = {r[1] for r in conn.execute("PRAGMA table_info(review_cases)").fetchall()}
    assert "case_type" in col_names
    assert "conflict_reason" in col_names
    assert "evidence_data" in col_names

    index_names = {r[1] for r in conn.execute("PRAGMA index_list(review_cases)").fetchall()}
    assert "idx_review_cases_case_type" in index_names
    assert "idx_review_cases_student" in index_names
    assert "idx_review_cases_status" in index_names
    conn.close()


def test_migration_preserves_indexes_when_old_table_had_indexes(tmp_path):
    db_file = str(tmp_path / "legacy_indexes_test.db")
    conn = sqlite3.connect(db_file)
    conn.execute("""
        CREATE TABLE schema_version (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)
    conn.execute("INSERT INTO schema_version (version) VALUES (1), (2), (3)")
    _create_v3_milestone_verification(conn)
    conn.execute("""
        CREATE TABLE review_cases (
            review_id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id TEXT NOT NULL,
            scenario_id INTEGER NOT NULL,
            milestone_id INTEGER,
            report_text TEXT NOT NULL,
            score INTEGER DEFAULT 0,
            status TEXT DEFAULT 'PENDING',
            feedback TEXT,
            graded_by TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    # Pre-create the index names on the old table
    conn.execute("CREATE INDEX idx_review_cases_student ON review_cases(student_id)")
    conn.execute("CREATE INDEX idx_review_cases_status ON review_cases(status)")
    conn.execute(
        "INSERT INTO review_cases (student_id, scenario_id, milestone_id, report_text, status) "
        "VALUES ('indexed_student', 1, 1, 'Indexed report', 'PENDING')"
    )
    conn.commit()
    conn.close()

    assert migrate.apply(db_file) >= 4

    conn = sqlite3.connect(db_file)
    # Check that review_cases has all three indexes attached
    index_names = {r[1] for r in conn.execute("PRAGMA index_list(review_cases)").fetchall()}
    assert "idx_review_cases_student" in index_names
    assert "idx_review_cases_status" in index_names
    assert "idx_review_cases_case_type" in index_names

    # Check sqlite_master that they are attached to review_cases, not _review_cases_old
    master_indexes = conn.execute(
        "SELECT name, tbl_name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_review_cases_%'"
    ).fetchall()
    assert len(master_indexes) == 3
    for name, tbl in master_indexes:
        assert tbl == "review_cases"
    conn.close()


def test_migration_rebuilds_when_score_has_default_zero(tmp_path, monkeypatch):
    db_file = str(tmp_path / "score_default_test.db")
    conn = sqlite3.connect(db_file)
    conn.execute("""
        CREATE TABLE schema_version (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)
    conn.execute("INSERT INTO schema_version (version) VALUES (1), (2), (3)")
    _create_v3_milestone_verification(conn)
    # Schema with nullable report_text BUT score DEFAULT 0!
    conn.execute("""
        CREATE TABLE review_cases (
            review_id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id TEXT NOT NULL,
            scenario_id INTEGER NOT NULL,
            milestone_id INTEGER,
            report_text TEXT,
            score INTEGER DEFAULT 0,
            status TEXT DEFAULT 'PENDING',
            feedback TEXT,
            graded_by TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute(
        "INSERT INTO review_cases (student_id, scenario_id, milestone_id, report_text, status) "
        "VALUES ('existing_student', 1, 1, 'Some report', 'PENDING')"
    )
    conn.commit()
    conn.close()

    # Apply migration
    assert migrate.apply(db_file) >= 4

    # Verify score column no longer has DEFAULT 0 in PRAGMA table_info
    conn = sqlite3.connect(db_file)
    cols = {r[1]: r for r in conn.execute("PRAGMA table_info(review_cases)").fetchall()}
    # r[4] is dflt_value
    assert cols["score"][4] is None
    # Verify existing pending review score was cleaned to NULL
    row = conn.execute("SELECT score FROM review_cases WHERE student_id='existing_student'").fetchone()
    assert row[0] is None
    conn.close()

    # Point test app to this migrated database and submit a new pending review
    monkeypatch.setattr("config.DB_PATH", db_file)
    monkeypatch.setattr("db.DB_PATH", db_file)
    monkeypatch.setattr("auth.AUTH_ENABLED", True)
    app.dependency_overrides[verify_token] = lambda: student_claims("new_student")

    client = TestClient(app)
    headers = {"Authorization": "Bearer mock_token"}
    res = client.post("/reviews/submit", json={
        "scenario_id": 2,
        "milestone_id": 3,
        "report_text": "New pending review after migration."
    }, headers=headers)
    assert res.status_code == 200
    new_review_id = res.json()["review_id"]

    # Confirm the new review's score is NULL
    app.dependency_overrides[verify_token] = lambda: instructor_claims("instructor1")
    res_detail = client.get(f"/instructor/reviews/{new_review_id}", headers=headers)
    assert res_detail.status_code == 200
    assert res_detail.json()["score"] is None


def test_migration_additive_without_rebuild(tmp_path):
    db_file = str(tmp_path / "additive_review_test.db")
    conn = sqlite3.connect(db_file)
    conn.execute("""
        CREATE TABLE schema_version (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)
    conn.execute("INSERT INTO schema_version (version) VALUES (1), (2), (3)")
    _create_v3_milestone_verification(conn)
    # Table with nullable report_text, score without default, timestamps, and v4 check constraints
    # Missing only case_type, conflict_reason, evidence_data
    conn.execute("""
        CREATE TABLE review_cases (
            review_id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id TEXT NOT NULL,
            scenario_id INTEGER NOT NULL,
            milestone_id INTEGER,
            report_text TEXT,
            score INTEGER CHECK(score IS NULL OR (score >= 0 AND score <= 100)),
            status TEXT CHECK(status IN ('PENDING','APPROVED','REJECTED','RETRY')) DEFAULT 'PENDING',
            feedback TEXT,
            graded_by TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute(
        "INSERT INTO review_cases (student_id, scenario_id, milestone_id, report_text, score, status) "
        "VALUES ('additive_student', 2, 1, 'Additive report', 0, 'PENDING')"
    )
    conn.commit()
    conn.close()

    assert migrate.apply(db_file) >= 4

    conn = sqlite3.connect(db_file)
    row = conn.execute("SELECT * FROM review_cases WHERE student_id='additive_student'").fetchone()
    assert row is not None
    cols = [d[0] for d in conn.execute("SELECT * FROM review_cases").description]
    row_dict = dict(zip(cols, row))
    assert row_dict["report_text"] == "Additive report"
    assert row_dict["case_type"] == "WRITTEN_REPORT"
    # Ungraded pending review score should be cleaned up to NULL
    assert row_dict["score"] is None

    col_names = {r[1] for r in conn.execute("PRAGMA table_info(review_cases)").fetchall()}
    assert "case_type" in col_names
    assert "conflict_reason" in col_names
    assert "evidence_data" in col_names

    # Verify resulting table SQL in sqlite_master contains added columns and constraints
    master_sql = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='review_cases'"
    ).fetchone()[0]
    assert "case_type" in master_sql
    assert "conflict_reason" in master_sql
    assert "evidence_data" in master_sql
    assert "CHECK" in master_sql
    conn.close()


def test_migration_rebuilds_when_timestamps_missing(tmp_path):
    db_file = str(tmp_path / "missing_timestamps_test.db")
    conn = sqlite3.connect(db_file)
    conn.execute("""
        CREATE TABLE schema_version (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)
    conn.execute("INSERT INTO schema_version (version) VALUES (1), (2), (3)")
    _create_v3_milestone_verification(conn)
    # Legacy table missing created_at and updated_at
    conn.execute("""
        CREATE TABLE review_cases (
            review_id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id TEXT NOT NULL,
            scenario_id INTEGER NOT NULL,
            milestone_id INTEGER,
            report_text TEXT,
            score INTEGER CHECK(score IS NULL OR (score >= 0 AND score <= 100)),
            status TEXT CHECK(status IN ('PENDING','APPROVED','REJECTED','RETRY')) DEFAULT 'PENDING',
            feedback TEXT,
            graded_by TEXT
        )
    """)
    conn.execute(
        "INSERT INTO review_cases (student_id, scenario_id, milestone_id, report_text, status) "
        "VALUES ('ts_student', 1, 1, 'Report without timestamps', 'PENDING')"
    )
    conn.commit()
    conn.close()

    # apply() should rebuild the table cleanly instead of failing on ALTER TABLE ADD COLUMN DEFAULT CURRENT_TIMESTAMP
    assert migrate.apply(db_file) >= 4

    conn = sqlite3.connect(db_file)
    col_names = {r[1] for r in conn.execute("PRAGMA table_info(review_cases)").fetchall()}
    assert "created_at" in col_names
    assert "updated_at" in col_names
    row = conn.execute("SELECT created_at, updated_at FROM review_cases WHERE student_id='ts_student'").fetchone()
    assert row[0] is not None
    assert row[1] is not None
    conn.close()


def test_migration_rebuilds_when_v4_constraints_missing(tmp_path):
    db_file = str(tmp_path / "missing_constraints_test.db")
    conn = sqlite3.connect(db_file)
    conn.execute("""
        CREATE TABLE schema_version (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)
    conn.execute("INSERT INTO schema_version (version) VALUES (1), (2), (3)")
    _create_v3_milestone_verification(conn)
    # Table missing CHECK constraints on score and status
    conn.execute("""
        CREATE TABLE review_cases (
            review_id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id TEXT NOT NULL,
            scenario_id INTEGER NOT NULL,
            milestone_id INTEGER,
            report_text TEXT,
            score INTEGER,
            status TEXT DEFAULT 'PENDING',
            feedback TEXT,
            graded_by TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute(
        "INSERT INTO review_cases (student_id, scenario_id, milestone_id, report_text, status) "
        "VALUES ('constraint_student', 1, 1, 'Report without check constraints', 'PENDING')"
    )
    conn.commit()
    conn.close()

    assert migrate.apply(db_file) >= 4

    conn = sqlite3.connect(db_file)
    master_sql = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='review_cases'"
    ).fetchone()[0]
    # Verify rebuilt table SQL contains v4 CHECK constraints
    norm_sql = " ".join(master_sql.upper().split())
    assert "SCORE >= 0" in norm_sql and "SCORE <= 100" in norm_sql
    assert all(s in norm_sql for s in ("'PENDING'", "'APPROVED'", "'REJECTED'", "'RETRY'"))
    assert all(ct in norm_sql for ct in ("'WRITTEN_REPORT'", "'SCORING_CONFLICT'", "'MANUAL_REVIEW'"))
    conn.close()


def test_migration_rebuilds_when_score_exists_without_graded_by(tmp_path):
    db_file = str(tmp_path / "score_no_graded_by_test.db")
    conn = sqlite3.connect(db_file)
    conn.execute("""
        CREATE TABLE schema_version (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)
    conn.execute("INSERT INTO schema_version (version) VALUES (1), (2), (3)")
    _create_v3_milestone_verification(conn)
    # Table with score, status, no graded_by, and no v4 checks
    conn.execute("""
        CREATE TABLE review_cases (
            review_id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id TEXT NOT NULL,
            scenario_id INTEGER NOT NULL,
            milestone_id INTEGER,
            report_text TEXT,
            score INTEGER DEFAULT 0,
            status TEXT DEFAULT 'PENDING',
            feedback TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute(
        "INSERT INTO review_cases (student_id, scenario_id, milestone_id, report_text, score, status) "
        "VALUES ('legacy_pending', 1, 1, 'Pending report without graded_by', 0, 'PENDING')"
    )
    conn.execute(
        "INSERT INTO review_cases (student_id, scenario_id, milestone_id, report_text, score, status) "
        "VALUES ('legacy_approved', 1, 1, 'Approved report without graded_by', 85, 'APPROVED')"
    )
    conn.commit()
    conn.close()

    assert migrate.apply(db_file) >= 4

    conn = sqlite3.connect(db_file)
    # 1. Verify _review_cases_old is removed from sqlite_master
    old_tables = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='_review_cases_old'"
    ).fetchall()
    assert len(old_tables) == 0

    # 2. Verify rows survive, pending score converted to NULL, approved score preserved
    rows = {
        r[1]: r
        for r in conn.execute(
            "SELECT review_id, student_id, score, status, case_type, graded_by FROM review_cases"
        ).fetchall()
    }
    assert "legacy_pending" in rows
    assert "legacy_approved" in rows

    pending_row = rows["legacy_pending"]
    assert pending_row[2] is None  # pending score cleaned to NULL
    assert pending_row[3] == "PENDING"
    assert pending_row[4] == "WRITTEN_REPORT"
    assert pending_row[5] is None  # graded_by

    approved_row = rows["legacy_approved"]
    assert approved_row[2] == 85  # earned score preserved
    assert approved_row[3] == "APPROVED"
    assert approved_row[4] == "WRITTEN_REPORT"
    assert approved_row[5] is None

    # 3. Verify v4 CHECK constraints exist in sqlite_master
    master_sql = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='review_cases'"
    ).fetchone()[0]
    norm_sql = " ".join(master_sql.upper().split())
    assert "SCORE >= 0" in norm_sql and "SCORE <= 100" in norm_sql
    assert all(s in norm_sql for s in ("'PENDING'", "'APPROVED'", "'REJECTED'", "'RETRY'"))
    assert all(ct in norm_sql for ct in ("'WRITTEN_REPORT'", "'SCORING_CONFLICT'", "'MANUAL_REVIEW'"))

    # 4. Verify all 3 indexes exist on review_cases
    indexes = {r[1] for r in conn.execute("PRAGMA index_list(review_cases)").fetchall()}
    assert "idx_review_cases_student" in indexes
    assert "idx_review_cases_status" in indexes
    assert "idx_review_cases_case_type" in indexes
    conn.close()


def test_migration_rebuild_rolls_back_atomically_on_error(tmp_path, monkeypatch):
    db_file = str(tmp_path / "rollback_test.db")
    conn = sqlite3.connect(db_file)
    conn.execute("""
        CREATE TABLE schema_version (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)
    conn.execute("INSERT INTO schema_version (version) VALUES (1), (2), (3)")
    _create_v3_milestone_verification(conn)
    conn.execute("""
        CREATE TABLE review_cases (
            review_id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id TEXT NOT NULL,
            scenario_id INTEGER NOT NULL,
            milestone_id INTEGER,
            report_text TEXT,
            score INTEGER DEFAULT 0,
            status TEXT DEFAULT 'PENDING',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute(
        "INSERT INTO review_cases (student_id, scenario_id, milestone_id, report_text, score, status) "
        "VALUES ('rollback_student', 1, 1, 'Pre-rollback report', 0, 'PENDING')"
    )
    conn.commit()
    conn.close()

    # Simulate a failure during rebuild after rename
    def fail_get_sql(path, table_name):
        return "CREATE TABLE review_cases (SYNTAX ERROR INVALID SQL)"

    monkeypatch.setattr("migrate._get_create_table_sql", fail_get_sql)

    with pytest.raises(sqlite3.OperationalError):
        migrate.apply(db_file)

    conn = sqlite3.connect(db_file)
    # Rebuild must have rolled back atomically:
    # 1. review_cases still exists and contains the original row
    row = conn.execute("SELECT student_id FROM review_cases").fetchone()
    assert row is not None
    assert row[0] == "rollback_student"

    # 2. _review_cases_old is NOT stranded
    old_tables = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='_review_cases_old'"
    ).fetchall()
    assert len(old_tables) == 0
    conn.close()


def test_submit_and_list_reviews():
    client = TestClient(app)
    headers = {"Authorization": "Bearer mock_token"}

    # 1. Submit review as student (uses student-only token)
    res = client.post("/reviews/submit", json={
        "scenario_id": 1,
        "milestone_id": 2,
        "report_text": "Discovered SQL injection vulnerability on login portal."
    }, headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "submitted"
    review_id = data["review_id"]

    # 2. List reviews as instructor (uses instructor-only token)
    app.dependency_overrides[verify_token] = lambda: instructor_claims("instructor1")
    res_list = client.get("/instructor/reviews", headers=headers)
    assert res_list.status_code == 200
    reviews = res_list.json()["reviews"]
    assert len(reviews) == 1
    assert reviews[0]["review_id"] == review_id
    assert reviews[0]["status"] == "PENDING"
    assert reviews[0]["student_id"] == "student1"
    assert reviews[0]["score"] is None

    # 3. Verify single review detail endpoint as instructor
    res_detail = client.get(f"/instructor/reviews/{review_id}", headers=headers)
    assert res_detail.status_code == 200
    detail = res_detail.json()
    assert detail["review_id"] == review_id
    assert detail["status"] == "PENDING"
    assert detail["report_text"] == "Discovered SQL injection vulnerability on login portal."
    assert detail["case_type"] == "WRITTEN_REPORT"
    assert detail["score"] is None


def test_submit_scoring_conflict_rejected_for_students():
    """Students cannot forge SCORING_CONFLICT via /reviews/submit (system/hybrid only)."""
    client = TestClient(app)
    headers = {"Authorization": "Bearer mock_token"}

    res = client.post("/reviews/submit", json={
        "scenario_id": 2,
        "milestone_id": 1,
        "case_type": "SCORING_CONFLICT",
        "conflict_reason": "Flag submitted correctly but automated verifier failed.",
        "evidence_data": {"command": "cat /flag.txt", "output": "flag{pwned_123}"}
    }, headers=headers)
    assert res.status_code == 400
    assert "hybrid scoring system only" in res.json()["detail"].lower()

    # No forged review row created
    app.dependency_overrides[verify_token] = lambda: instructor_claims("instructor1")
    queue = client.get("/instructor/reviews?status_filter=PENDING", headers=headers)
    assert queue.status_code == 200
    forged = [
        r for r in queue.json()["reviews"]
        if r.get("case_type") == "SCORING_CONFLICT"
        and r.get("conflict_reason") == "Flag submitted correctly but automated verifier failed."
    ]
    assert forged == []


def test_submit_invalid_case_type():
    client = TestClient(app)
    headers = {"Authorization": "Bearer mock_token"}
    res = client.post("/reviews/submit", json={
        "scenario_id": 1,
        "case_type": "UNSUPPORTED_TYPE",
        "report_text": "Some text"
    }, headers=headers)
    assert res.status_code == 400
    assert "Invalid case_type" in res.json()["detail"]


def test_submit_scoring_conflict_missing_reason_and_report():
    """SCORING_CONFLICT is rejected before the missing-reason/report validation path."""
    client = TestClient(app)
    headers = {"Authorization": "Bearer mock_token"}
    res = client.post("/reviews/submit", json={
        "scenario_id": 1,
        "case_type": "SCORING_CONFLICT"
    }, headers=headers)
    assert res.status_code == 400
    assert "hybrid scoring system only" in res.json()["detail"].lower()


def test_submit_empty_report_text():
    client = TestClient(app)
    headers = {"Authorization": "Bearer mock_token"}
    res = client.post("/reviews/submit", json={
        "scenario_id": 1,
        "report_text": "   "
    }, headers=headers)
    assert res.status_code == 400
    assert "report_text cannot be empty" in res.json()["detail"]


def test_submit_unauthenticated(monkeypatch):
    monkeypatch.setattr("auth.AUTH_ENABLED", True)
    app.dependency_overrides.clear()
    client = TestClient(app)
    res = client.post("/reviews/submit", json={
        "scenario_id": 1,
        "report_text": "Valid report content"
    })
    assert res.status_code == 401


def test_get_review_detail():
    client = TestClient(app)
    headers = {"Authorization": "Bearer mock_token"}

    # Submit as student
    res_sub = client.post("/reviews/submit", json={
        "scenario_id": 3,
        "report_text": "Detail test report."
    }, headers=headers)
    review_id = res_sub.json()["review_id"]

    # View as instructor
    app.dependency_overrides[verify_token] = lambda: instructor_claims("instructor1")
    res = client.get(f"/instructor/reviews/{review_id}", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["review_id"] == review_id
    assert data["report_text"] == "Detail test report."
    assert data["student_id"] == "student1"
    assert data["score"] is None


def test_get_review_detail_not_found():
    client = TestClient(app)
    headers = {"Authorization": "Bearer mock_token"}
    app.dependency_overrides[verify_token] = lambda: instructor_claims("instructor1")
    res = client.get("/instructor/reviews/9999", headers=headers)
    assert res.status_code == 404
    assert "Review case not found" in res.json()["detail"]


def test_get_review_detail_rbac_forbidden():
    # Student token cannot access instructor review detail
    client = TestClient(app)
    headers = {"Authorization": "Bearer mock_token"}
    res = client.get("/instructor/reviews/1", headers=headers)
    assert res.status_code == 403


def test_instructor_pods_payload_minimization():
    conn = db.get_db_connection()
    try:
        conn.execute(
            "INSERT INTO pods ("
            "  pod_id, student_id, scenario_id, status, "
            "  vmid_kali, vmid_meta, connection_id, wazuh_agent_id"
            ") VALUES (10, 'student_test', '1', 'READY', '100', '101', 1234, 'wazuh_001')"
        )
        conn.commit()
    finally:
        conn.close()

    client = TestClient(app)
    headers = {"Authorization": "Bearer mock_token"}
    # Access as instructor
    app.dependency_overrides[verify_token] = lambda: instructor_claims("instructor1")
    res = client.get("/instructor/pods", headers=headers)
    assert res.status_code == 200
    pods = res.json()["pods"]
    assert len(pods) >= 1
    test_pod = next(p for p in pods if p["pod_id"] == 10)

    # Assert infrastructure secrets are stripped
    assert "vmid_kali" not in test_pod
    assert "vmid_meta" not in test_pod
    assert "connection_id" not in test_pod
    assert "wazuh_agent_id" not in test_pod
    assert not any(k.startswith("vmid_") for k in test_pod)

    # Assert necessary instructor monitoring fields remain
    assert test_pod["pod_id"] == 10
    assert test_pod["student_id"] == "student_test"
    assert test_pod["status"] == "READY"
    assert "milestones" in test_pod


def test_instructor_pods_rbac_forbidden_for_student():
    client = TestClient(app)
    headers = {"Authorization": "Bearer mock_token"}
    # Student token cannot access /instructor/pods
    res = client.get("/instructor/pods", headers=headers)
    assert res.status_code == 403


def test_unrelated_client_role_does_not_grant_access():
    client = TestClient(app)
    headers = {"Authorization": "Bearer mock_token"}

    # Token with admin/instructor in an unrelated client only
    app.dependency_overrides[verify_token] = lambda: {
        "preferred_username": "other_client_user",
        "realm_access": {"roles": ["student"]},
        "resource_access": {
            "unrelated-client": {"roles": ["admin", "instructor"]}
        }
    }

    assert client.get("/instructor/pods", headers=headers).status_code == 403
    assert client.get("/instructor/reviews", headers=headers).status_code == 403
    assert client.get("/instructor/students", headers=headers).status_code == 403

    # But roles from the configured portal client DO grant access
    app.dependency_overrides[verify_token] = lambda: {
        "preferred_username": "portal_instructor",
        "realm_access": {"roles": ["student"]},
        "resource_access": {
            "portal": {"roles": ["instructor"]}
        }
    }
    assert client.get("/instructor/reviews", headers=headers).status_code == 200


def test_instructor_student_progress_without_active_pod():
    conn = db.get_db_connection()
    try:
        # Student 1 has historical milestone verifications and a destroyed pod
        conn.execute(
            "INSERT INTO pods (pod_id, student_id, scenario_id, status) "
            "VALUES (20, 'historical_student', '1', 'DESTROYED')"
        )
        conn.execute(
            "INSERT INTO milestone_verification (pod_id, scenario_id, milestone_id, student_id, status, detection_score) "
            "VALUES (20, 1, 1, 'historical_student', 'PASS', 10)"
        )
        conn.execute(
            "INSERT INTO milestone_verification (pod_id, scenario_id, milestone_id, student_id, status, detection_score) "
            "VALUES (20, 1, 2, 'historical_student', 'PASS', 20)"
        )

        # Student 2 has an active pod
        conn.execute(
            "INSERT INTO pods (pod_id, student_id, scenario_id, status, vmid_kali) "
            "VALUES (21, 'active_student', '2', 'READY', '200')"
        )
        conn.commit()
    finally:
        conn.close()

    client = TestClient(app)
    headers = {"Authorization": "Bearer mock_token"}
    # Access as instructor
    app.dependency_overrides[verify_token] = lambda: instructor_claims("instructor1")

    # 1. List all students
    res_list = client.get("/instructor/students", headers=headers)
    assert res_list.status_code == 200
    students = res_list.json()["students"]
    s_hist = next(s for s in students if s["student_id"] == "historical_student")
    assert s_hist["active_pod"] is None
    assert len(s_hist["milestones"]) == 2
    assert s_hist["pending_review_count"] == 0

    s_act = next(s for s in students if s["student_id"] == "active_student")
    assert s_act["active_pod"] is not None
    assert s_act["active_pod"]["pod_id"] == 21
    assert "vmid_kali" not in s_act["active_pod"]
    assert s_act["pending_review_count"] == 0

    # 2. Get historical student progress by student_id
    res_single = client.get("/instructor/students/historical_student", headers=headers)
    assert res_single.status_code == 200
    single_data = res_single.json()
    assert single_data["student_id"] == "historical_student"
    assert single_data["active_pod"] is None
    assert len(single_data["milestones"]) == 2
    assert single_data["reviews"] == []
    # Evidence detail for the review page: which lab each attempt ran on and
    # what (if anything) corroborated it.
    for m in single_data["milestones"]:
        assert m["pod_id"] == 20
        assert "detection_data" in m


def test_instructor_student_progress_with_review_only():
    conn = db.get_db_connection()
    try:
        conn.execute(
            "INSERT INTO review_cases (student_id, scenario_id, milestone_id, case_type, conflict_reason, status) "
            "VALUES ('review_only_student', 5, 2, 'SCORING_CONFLICT', 'Verifier timed out', 'PENDING')"
        )
        conn.commit()
    finally:
        conn.close()

    client = TestClient(app)
    headers = {"Authorization": "Bearer mock_token"}
    # Access as instructor
    app.dependency_overrides[verify_token] = lambda: instructor_claims("instructor1")

    # 1. GET /instructor/students includes review_only_student with pending_review_count == 1
    res_list = client.get("/instructor/students", headers=headers)
    assert res_list.status_code == 200
    students = res_list.json()["students"]
    s = next((st for st in students if st["student_id"] == "review_only_student"), None)
    assert s is not None
    assert s["active_pod"] is None
    assert s["milestones"] == []
    assert s["pending_review_count"] == 1

    # 2. GET /instructor/students/{student_id} returns reviews list
    res_detail = client.get("/instructor/students/review_only_student", headers=headers)
    assert res_detail.status_code == 200
    detail = res_detail.json()
    assert detail["student_id"] == "review_only_student"
    assert detail["active_pod"] is None
    assert detail["milestones"] == []
    assert len(detail["reviews"]) == 1
    assert detail["reviews"][0]["case_type"] == "SCORING_CONFLICT"
    assert detail["reviews"][0]["conflict_reason"] == "Verifier timed out"
    assert detail["reviews"][0]["score"] is None


def test_instructor_student_progress_not_found():
    client = TestClient(app)
    headers = {"Authorization": "Bearer mock_token"}
    app.dependency_overrides[verify_token] = lambda: instructor_claims("instructor1")
    res = client.get("/instructor/students/unknown_student_xyz", headers=headers)
    assert res.status_code == 404
    assert "Student not found" in res.json()["detail"]


def test_instructor_students_rbac_forbidden():
    # Student token cannot access instructor student endpoints
    client = TestClient(app)
    headers = {"Authorization": "Bearer mock_token"}

    res_list = client.get("/instructor/students", headers=headers)
    assert res_list.status_code == 403

    res_single = client.get("/instructor/students/any_student", headers=headers)
    assert res_single.status_code == 403


def test_instructor_rbac_forbidden_for_student():
    # Student token cannot access instructor review queue or detail
    client = TestClient(app)
    headers = {"Authorization": "Bearer mock_token"}

    res_list = client.get("/instructor/reviews", headers=headers)
    assert res_list.status_code == 403

    res_detail = client.get("/instructor/reviews/1", headers=headers)
    assert res_detail.status_code == 403


def admin_claims(username="admin1"):
    return {
        "preferred_username": username,
        "realm_access": {"roles": ["admin"]}
    }


# ============================================================================
# INST-03: Approve / Reject / Retry Workflow Tests
# ============================================================================

def test_resolve_review_approve_default_score():
    client = TestClient(app)
    # Student submits review
    app.dependency_overrides[verify_token] = lambda: student_claims("student_appr1")
    res_sub = client.post(
        "/reviews/submit",
        json={"scenario_id": 1, "milestone_id": 1, "report_text": "Initial report"},
    )
    assert res_sub.status_code == 200
    rev_id = res_sub.json()["review_id"]

    # Instructor resolves with APPROVED without score (defaults to 100)
    app.dependency_overrides[verify_token] = lambda: instructor_claims("instructor_prof")
    headers = {"Authorization": "Bearer mock_token"}
    res_res = client.post(
        f"/instructor/reviews/{rev_id}/resolve",
        json={"status": "APPROVED", "feedback": "Well written exploit analysis."},
        headers=headers,
    )
    assert res_res.status_code == 200
    data = res_res.json()
    assert data["status"] == "resolved"
    assert data["review_id"] == rev_id
    assert data["decision"] == "APPROVED"

    # Verify persisted details
    res_detail = client.get(f"/instructor/reviews/{rev_id}", headers=headers)
    assert res_detail.status_code == 200
    detail = res_detail.json()
    assert detail["status"] == "APPROVED"
    assert detail["score"] == 100
    assert detail["feedback"] == "Well written exploit analysis."
    assert detail["graded_by"] == "instructor_prof"
    assert detail["updated_at"] is not None


def test_resolve_review_approve_custom_score():
    client = TestClient(app)
    app.dependency_overrides[verify_token] = lambda: student_claims("student_appr2")
    res_sub = client.post(
        "/reviews/submit",
        json={"scenario_id": 6, "milestone_id": 2, "report_text": "DVWA report"},
    )
    rev_id = res_sub.json()["review_id"]

    # Instructor resolves with APPROVED and explicit score 85
    app.dependency_overrides[verify_token] = lambda: instructor_claims("instructor_prof")
    headers = {"Authorization": "Bearer mock_token"}
    res_res = client.post(
        f"/instructor/reviews/{rev_id}/resolve",
        json={"status": "APPROVED", "score": 85, "feedback": "Minor omission in step 2"},
        headers=headers,
    )
    assert res_res.status_code == 200
    assert res_res.json()["decision"] == "APPROVED"

    res_detail = client.get(f"/instructor/reviews/{rev_id}", headers=headers)
    detail = res_detail.json()
    assert detail["status"] == "APPROVED"
    assert detail["score"] == 85
    assert detail["feedback"] == "Minor omission in step 2"


def test_resolve_review_reject_default_score():
    client = TestClient(app)
    app.dependency_overrides[verify_token] = lambda: student_claims("student_rej1")
    res_sub = client.post(
        "/reviews/submit",
        json={"scenario_id": 1, "report_text": "Failed attempt report"},
    )
    rev_id = res_sub.json()["review_id"]

    # Instructor resolves with REJECTED without score (defaults to 0)
    app.dependency_overrides[verify_token] = lambda: instructor_claims("instructor_prof")
    headers = {"Authorization": "Bearer mock_token"}
    res_res = client.post(
        f"/instructor/reviews/{rev_id}/resolve",
        json={"status": "REJECTED", "feedback": "Payload did not bypass defense."},
        headers=headers,
    )
    assert res_res.status_code == 200
    assert res_res.json()["decision"] == "REJECTED"

    res_detail = client.get(f"/instructor/reviews/{rev_id}", headers=headers)
    detail = res_detail.json()
    assert detail["status"] == "REJECTED"
    assert detail["score"] == 0
    assert detail["feedback"] == "Payload did not bypass defense."


def test_resolve_review_reject_custom_score():
    client = TestClient(app)
    app.dependency_overrides[verify_token] = lambda: student_claims("student_rej2")
    res_sub = client.post(
        "/reviews/submit",
        json={"scenario_id": 1, "report_text": "Incomplete report"},
    )
    rev_id = res_sub.json()["review_id"]

    # Instructor resolves with REJECTED with explicit score (e.g. 15 for effort)
    app.dependency_overrides[verify_token] = lambda: instructor_claims("instructor_prof")
    headers = {"Authorization": "Bearer mock_token"}
    res_res = client.post(
        f"/instructor/reviews/{rev_id}/resolve",
        json={"status": "REJECTED", "score": 15, "feedback": "Effort recognized, but criteria missed."},
        headers=headers,
    )
    assert res_res.status_code == 200
    detail = client.get(f"/instructor/reviews/{rev_id}", headers=headers).json()
    assert detail["status"] == "REJECTED"
    assert detail["score"] == 15


def test_resolve_review_retry_nullable_score():
    client = TestClient(app)
    app.dependency_overrides[verify_token] = lambda: student_claims("student_retry1")
    res_sub = client.post(
        "/reviews/submit",
        json={"scenario_id": 6, "report_text": "Draft report"},
    )
    rev_id = res_sub.json()["review_id"]

    # Instructor marks for RETRY without score (score stays None)
    app.dependency_overrides[verify_token] = lambda: instructor_claims("instructor_prof")
    headers = {"Authorization": "Bearer mock_token"}
    res_res = client.post(
        f"/instructor/reviews/{rev_id}/resolve",
        json={"status": "RETRY", "feedback": "Please attach raw terminal output and retry."},
        headers=headers,
    )
    assert res_res.status_code == 200
    assert res_res.json()["decision"] == "RETRY"

    detail = client.get(f"/instructor/reviews/{rev_id}", headers=headers).json()
    assert detail["status"] == "RETRY"
    assert detail["score"] is None
    assert detail["feedback"] == "Please attach raw terminal output and retry."


def test_resolve_review_retry_partial_score():
    client = TestClient(app)
    app.dependency_overrides[verify_token] = lambda: student_claims("student_retry2")
    res_sub = client.post(
        "/reviews/submit",
        json={"scenario_id": 1, "report_text": "Draft report"},
    )
    rev_id = res_sub.json()["review_id"]

    # Instructor marks for RETRY with partial score (50)
    app.dependency_overrides[verify_token] = lambda: instructor_claims("instructor_prof")
    headers = {"Authorization": "Bearer mock_token"}
    res_res = client.post(
        f"/instructor/reviews/{rev_id}/resolve",
        json={"status": "RETRY", "score": 50, "feedback": "Milestone 1 good, please redo Milestone 2."},
        headers=headers,
    )
    assert res_res.status_code == 200
    detail = client.get(f"/instructor/reviews/{rev_id}", headers=headers).json()
    assert detail["status"] == "RETRY"
    assert detail["score"] == 50


def test_admin_can_resolve_review():
    client = TestClient(app)
    app.dependency_overrides[verify_token] = lambda: student_claims("student_admin_test")
    res_sub = client.post(
        "/reviews/submit",
        json={"scenario_id": 1, "report_text": "Test report for admin resolution"},
    )
    rev_id = res_sub.json()["review_id"]

    # Admin resolves
    app.dependency_overrides[verify_token] = lambda: admin_claims("admin_super")
    headers = {"Authorization": "Bearer mock_token"}
    res_res = client.post(
        f"/instructor/reviews/{rev_id}/resolve",
        json={"status": "APPROVED", "score": 95, "feedback": "Approved by superadmin"},
        headers=headers,
    )
    assert res_res.status_code == 200
    assert res_res.json()["decision"] == "APPROVED"
    detail = client.get(f"/instructor/reviews/{rev_id}", headers=headers).json()
    assert detail["graded_by"] == "admin_super"
    assert detail["score"] == 95


def test_re_resolve_review():
    client = TestClient(app)
    app.dependency_overrides[verify_token] = lambda: student_claims("student_reresolve")
    res_sub = client.post(
        "/reviews/submit",
        json={"scenario_id": 1, "report_text": "Initial submission"},
    )
    rev_id = res_sub.json()["review_id"]

    app.dependency_overrides[verify_token] = lambda: instructor_claims("instructor_prof")
    headers = {"Authorization": "Bearer mock_token"}

    # First resolution: RETRY
    client.post(
        f"/instructor/reviews/{rev_id}/resolve",
        json={"status": "RETRY", "feedback": "Need revision"},
        headers=headers,
    )
    # Second resolution: APPROVED
    res2 = client.post(
        f"/instructor/reviews/{rev_id}/resolve",
        json={"status": "APPROVED", "score": 100, "feedback": "Oral defense passed, approving directly."},
        headers=headers,
    )
    assert res2.status_code == 200
    detail = client.get(f"/instructor/reviews/{rev_id}", headers=headers).json()
    assert detail["status"] == "APPROVED"
    assert detail["score"] == 100


def test_full_approve_reject_retry_workflow_cycle():
    client = TestClient(app)
    headers = {"Authorization": "Bearer mock_token"}

    # 1. Student submits review case
    app.dependency_overrides[verify_token] = lambda: student_claims("student_cycle")
    res_sub = client.post(
        "/reviews/submit",
        json={"scenario_id": 6, "milestone_id": 1, "report_text": "First attempt at SQLi report"},
    )
    assert res_sub.status_code == 200
    rev_id = res_sub.json()["review_id"]

    # 2. Instructor inspects and returns for RETRY
    app.dependency_overrides[verify_token] = lambda: instructor_claims("instructor_lead")
    res_retry = client.post(
        f"/instructor/reviews/{rev_id}/resolve",
        json={"status": "RETRY", "feedback": "Clarify which SQL comment token was used."},
        headers=headers,
    )
    assert res_retry.status_code == 200

    # 3. Student views their review and reads feedback
    app.dependency_overrides[verify_token] = lambda: student_claims("student_cycle")
    res_std_view = client.get(f"/reviews/{rev_id}", headers=headers)
    assert res_std_view.status_code == 200
    view_data = res_std_view.json()
    assert view_data["status"] == "RETRY"
    assert view_data["feedback"] == "Clarify which SQL comment token was used."

    # 4. Student resubmits revised report
    res_resub = client.post(
        f"/reviews/{rev_id}/resubmit",
        json={
            "report_text": "Updated SQLi report: Used '#' character to comment out the rest of the query.",
            "evidence_data": {"token": "#", "payload": "' OR 1=1 #"},
        },
        headers=headers,
    )
    assert res_resub.status_code == 200
    assert res_resub.json()["status"] == "resubmitted"

    # 5. Review is back in PENDING with NULL score
    res_post_resub = client.get(f"/reviews/{rev_id}", headers=headers)
    post_data = res_post_resub.json()
    assert post_data["status"] == "PENDING"
    assert post_data["score"] is None
    assert "Updated SQLi report" in post_data["report_text"]

    # 6. Instructor sees it in pending queue
    app.dependency_overrides[verify_token] = lambda: instructor_claims("instructor_lead")
    queue_res = client.get("/instructor/reviews?status_filter=PENDING", headers=headers)
    assert queue_res.status_code == 200
    pending_ids = [r["review_id"] for r in queue_res.json()["reviews"]]
    assert rev_id in pending_ids

    # 7. Instructor evaluates revised report and resolves with APPROVED 100
    res_final = client.post(
        f"/instructor/reviews/{rev_id}/resolve",
        json={"status": "APPROVED", "score": 100, "feedback": "Excellent explanation and payload."},
        headers=headers,
    )
    assert res_final.status_code == 200
    assert res_final.json()["decision"] == "APPROVED"

    final_detail = client.get(f"/instructor/reviews/{rev_id}", headers=headers).json()
    assert final_detail["status"] == "APPROVED"
    assert final_detail["score"] == 100


def test_student_resubmit_with_json_evidence():
    client = TestClient(app)
    headers = {"Authorization": "Bearer mock_token"}

    app.dependency_overrides[verify_token] = lambda: student_claims("student_json_test")
    res_sub = client.post(
        "/reviews/submit",
        json={"scenario_id": 1, "report_text": "Draft with text"},
    )
    rev_id = res_sub.json()["review_id"]

    # Mark RETRY
    app.dependency_overrides[verify_token] = lambda: instructor_claims("instructor_prof")
    client.post(f"/instructor/reviews/{rev_id}/resolve", json={"status": "RETRY"}, headers=headers)

    # Resubmit with nested dictionary and list in evidence_data
    app.dependency_overrides[verify_token] = lambda: student_claims("student_json_test")
    res_resub = client.post(
        f"/reviews/{rev_id}/resubmit",
        json={
            "report_text": "Updated report with JSON evidence",
            "evidence_data": {
                "scan": {"target": "10.0.0.1", "ports": [80, 443, 8080]},
                "banner": "Apache/2.4.41",
            },
        },
        headers=headers,
    )
    assert res_resub.status_code == 200

    detail = client.get(f"/reviews/{rev_id}", headers=headers).json()
    assert "ports" in detail["evidence_data"]
    assert "8080" in detail["evidence_data"]


def test_resolve_review_forbidden_for_student():
    client = TestClient(app)
    headers = {"Authorization": "Bearer mock_token"}
    # Student cannot resolve reviews
    app.dependency_overrides[verify_token] = lambda: student_claims("student1")
    res = client.post(
        "/instructor/reviews/1/resolve",
        json={"status": "APPROVED"},
        headers=headers,
    )
    assert res.status_code == 403
    assert "Forbidden" in res.json()["detail"]


def test_resolve_review_unauthenticated():
    client = TestClient(app)
    app.dependency_overrides.pop(verify_token, None)
    res = client.post("/instructor/reviews/1/resolve", json={"status": "APPROVED"})
    assert res.status_code == 401


def test_resolve_review_unrelated_client_role_forbidden():
    client = TestClient(app)
    headers = {"Authorization": "Bearer mock_token"}
    app.dependency_overrides[verify_token] = lambda: {
        "preferred_username": "other_client_user",
        "realm_access": {"roles": ["student"]},
        "resource_access": {"unrelated-client": {"roles": ["instructor"]}},
    }
    res = client.post("/instructor/reviews/1/resolve", json={"status": "APPROVED"}, headers=headers)
    assert res.status_code == 403


def test_resolve_review_missing_identity_fails():
    client = TestClient(app)
    headers = {"Authorization": "Bearer mock_token"}
    # Token has instructor role but preferred_username is missing
    app.dependency_overrides[verify_token] = lambda: {
        "realm_access": {"roles": ["instructor"]}
    }
    res = client.post("/instructor/reviews/1/resolve", json={"status": "APPROVED"}, headers=headers)
    assert res.status_code == 401
    assert "Identity required" in res.json()["detail"]


def test_student_resubmit_unauthenticated():
    client = TestClient(app)
    app.dependency_overrides.pop(verify_token, None)
    res = client.post("/reviews/1/resubmit", json={"report_text": "New text"})
    assert res.status_code == 401


def test_student_get_review_unauthenticated():
    client = TestClient(app)
    app.dependency_overrides.pop(verify_token, None)
    res = client.get("/reviews/1")
    assert res.status_code == 401


def test_student_resubmit_ownership_precedes_status_check():
    client = TestClient(app)
    headers = {"Authorization": "Bearer mock_token"}

    # Student A creates a review that is still PENDING
    app.dependency_overrides[verify_token] = lambda: student_claims("student_alice")
    res = client.post("/reviews/submit", json={"scenario_id": 1, "report_text": "Alice report"})
    rev_id = res.json()["review_id"]

    # Student B attempts to resubmit Alice's review (which is PENDING)
    # Ownership check MUST precede status check so Student B gets 404, not 400
    app.dependency_overrides[verify_token] = lambda: student_claims("student_bob")
    res_b = client.post(
        f"/reviews/{rev_id}/resubmit",
        json={"report_text": "Bob intrusion attempt"},
        headers=headers,
    )
    assert res_b.status_code == 404
    assert "Review case not found" in res_b.json()["detail"]


def test_student_resubmit_forbidden_for_different_student():
    client = TestClient(app)
    headers = {"Authorization": "Bearer mock_token"}

    # Student A has a review in RETRY status
    app.dependency_overrides[verify_token] = lambda: student_claims("student_alice")
    res = client.post("/reviews/submit", json={"scenario_id": 1, "report_text": "Alice report"})
    rev_id = res.json()["review_id"]

    app.dependency_overrides[verify_token] = lambda: instructor_claims("instructor_prof")
    client.post(f"/instructor/reviews/{rev_id}/resolve", json={"status": "RETRY"}, headers=headers)

    # Student B tries to resubmit Alice's RETRY case
    app.dependency_overrides[verify_token] = lambda: student_claims("student_bob")
    res_b = client.post(
        f"/reviews/{rev_id}/resubmit",
        json={"report_text": "Bob hijack"},
        headers=headers,
    )
    assert res_b.status_code == 404
    assert "Review case not found" in res_b.json()["detail"]


def test_student_get_review_isolation():
    client = TestClient(app)
    headers = {"Authorization": "Bearer mock_token"}

    # Student A creates review
    app.dependency_overrides[verify_token] = lambda: student_claims("student_alice")
    res = client.post("/reviews/submit", json={"scenario_id": 1, "report_text": "Alice report"})
    rev_id = res.json()["review_id"]

    # Student B attempts to view Alice's review -> 404
    app.dependency_overrides[verify_token] = lambda: student_claims("student_bob")
    res_bob = client.get(f"/reviews/{rev_id}", headers=headers)
    assert res_bob.status_code == 404

    # Student A can view
    app.dependency_overrides[verify_token] = lambda: student_claims("student_alice")
    res_alice = client.get(f"/reviews/{rev_id}", headers=headers)
    assert res_alice.status_code == 200
    assert res_alice.json()["student_id"] == "student_alice"

    # Staff (Instructor and Admin) can view
    app.dependency_overrides[verify_token] = lambda: instructor_claims("instructor_prof")
    res_inst = client.get(f"/reviews/{rev_id}", headers=headers)
    assert res_inst.status_code == 200

    app.dependency_overrides[verify_token] = lambda: admin_claims("admin_super")
    res_adm = client.get(f"/reviews/{rev_id}", headers=headers)
    assert res_adm.status_code == 200


def test_resolve_review_not_found():
    client = TestClient(app)
    headers = {"Authorization": "Bearer mock_token"}
    app.dependency_overrides[verify_token] = lambda: instructor_claims("instructor_prof")
    res = client.post(
        "/instructor/reviews/999999/resolve",
        json={"status": "APPROVED"},
        headers=headers,
    )
    assert res.status_code == 404
    assert "Review case not found" in res.json()["detail"]


def test_resolve_review_invalid_status():
    client = TestClient(app)
    headers = {"Authorization": "Bearer mock_token"}

    app.dependency_overrides[verify_token] = lambda: student_claims("student_val")
    res_sub = client.post("/reviews/submit", json={"scenario_id": 1, "report_text": "Val text"})
    rev_id = res_sub.json()["review_id"]

    app.dependency_overrides[verify_token] = lambda: instructor_claims("instructor_prof")
    # PENDING is not an allowed resolution decision
    res_pending = client.post(
        f"/instructor/reviews/{rev_id}/resolve",
        json={"status": "PENDING"},
        headers=headers,
    )
    assert res_pending.status_code == 400
    assert "Invalid status" in res_pending.json()["detail"]

    # Arbitrary bogus status
    res_bogus = client.post(
        f"/instructor/reviews/{rev_id}/resolve",
        json={"status": "BOGUS_STATUS"},
        headers=headers,
    )
    assert res_bogus.status_code == 400
    assert "Invalid status" in res_bogus.json()["detail"]


def test_resolve_review_score_out_of_bounds():
    client = TestClient(app)
    headers = {"Authorization": "Bearer mock_token"}

    app.dependency_overrides[verify_token] = lambda: student_claims("student_val2")
    res_sub = client.post("/reviews/submit", json={"scenario_id": 1, "report_text": "Val text"})
    rev_id = res_sub.json()["review_id"]

    app.dependency_overrides[verify_token] = lambda: instructor_claims("instructor_prof")

    # Score < 0
    res_neg = client.post(
        f"/instructor/reviews/{rev_id}/resolve",
        json={"status": "APPROVED", "score": -5},
        headers=headers,
    )
    assert res_neg.status_code == 400
    assert "score must be between 0 and 100" in res_neg.json()["detail"]

    # Score > 100
    res_over = client.post(
        f"/instructor/reviews/{rev_id}/resolve",
        json={"status": "APPROVED", "score": 105},
        headers=headers,
    )
    assert res_over.status_code == 400
    assert "score must be between 0 and 100" in res_over.json()["detail"]


def test_resolve_review_feedback_too_long():
    client = TestClient(app)
    headers = {"Authorization": "Bearer mock_token"}

    app.dependency_overrides[verify_token] = lambda: student_claims("student_val3")
    res_sub = client.post("/reviews/submit", json={"scenario_id": 1, "report_text": "Val text"})
    rev_id = res_sub.json()["review_id"]

    app.dependency_overrides[verify_token] = lambda: instructor_claims("instructor_prof")
    huge_feedback = "X" * 5001
    res = client.post(
        f"/instructor/reviews/{rev_id}/resolve",
        json={"status": "APPROVED", "feedback": huge_feedback},
        headers=headers,
    )
    assert res.status_code == 400
    assert "feedback exceeds maximum length" in res.json()["detail"]


def test_student_resubmit_non_retry_case_fails():
    client = TestClient(app)
    headers = {"Authorization": "Bearer mock_token"}

    # Resubmitting case that is currently PENDING
    app.dependency_overrides[verify_token] = lambda: student_claims("student_pending_resub")
    res_sub = client.post("/reviews/submit", json={"scenario_id": 1, "report_text": "Initial"})
    rev_id = res_sub.json()["review_id"]

    res = client.post(
        f"/reviews/{rev_id}/resubmit",
        json={"report_text": "Premature resubmit"},
        headers=headers,
    )
    assert res.status_code == 400
    assert "Only reviews in RETRY status can be resubmitted" in res.json()["detail"]

    # Resubmitting case that is currently APPROVED
    app.dependency_overrides[verify_token] = lambda: instructor_claims("instructor_prof")
    client.post(f"/instructor/reviews/{rev_id}/resolve", json={"status": "APPROVED"}, headers=headers)

    app.dependency_overrides[verify_token] = lambda: student_claims("student_pending_resub")
    res_appr = client.post(
        f"/reviews/{rev_id}/resubmit",
        json={"report_text": "Post-approval resubmit"},
        headers=headers,
    )
    assert res_appr.status_code == 400
    assert "Only reviews in RETRY status can be resubmitted" in res_appr.json()["detail"]


def test_student_resubmit_empty_payload_fails():
    client = TestClient(app)
    headers = {"Authorization": "Bearer mock_token"}

    app.dependency_overrides[verify_token] = lambda: student_claims("student_empty_resub")
    res_sub = client.post("/reviews/submit", json={"scenario_id": 1, "report_text": "Initial"})
    rev_id = res_sub.json()["review_id"]

    app.dependency_overrides[verify_token] = lambda: instructor_claims("instructor_prof")
    client.post(f"/instructor/reviews/{rev_id}/resolve", json={"status": "RETRY"}, headers=headers)

    app.dependency_overrides[verify_token] = lambda: student_claims("student_empty_resub")
    # Empty JSON object
    res_empty = client.post(f"/reviews/{rev_id}/resubmit", json={}, headers=headers)
    assert res_empty.status_code == 400
    assert "At least one updated field" in res_empty.json()["detail"]

    # Whitespace only
    res_ws = client.post(
        f"/reviews/{rev_id}/resubmit",
        json={"report_text": "   ", "conflict_reason": "  "},
        headers=headers,
    )
    assert res_ws.status_code == 400
    assert "At least one updated field" in res_ws.json()["detail"]

    # Empty evidence: empty string
    res_ev_str = client.post(
        f"/reviews/{rev_id}/resubmit",
        json={"evidence_data": ""},
        headers=headers,
    )
    assert res_ev_str.status_code == 400
    assert "At least one updated field" in res_ev_str.json()["detail"]

    # Empty evidence: empty dict
    res_ev_dict = client.post(
        f"/reviews/{rev_id}/resubmit",
        json={"evidence_data": {}},
        headers=headers,
    )
    assert res_ev_dict.status_code == 400
    assert "At least one updated field" in res_ev_dict.json()["detail"]

    # Empty evidence: empty list
    res_ev_list = client.post(
        f"/reviews/{rev_id}/resubmit",
        json={"evidence_data": []},
        headers=headers,
    )
    assert res_ev_list.status_code == 400
    assert "At least one updated field" in res_ev_list.json()["detail"]

    # Empty evidence: stringified brackets
    res_ev_brackets = client.post(
        f"/reviews/{rev_id}/resubmit",
        json={"evidence_data": "  {}  "},
        headers=headers,
    )
    assert res_ev_brackets.status_code == 400
    assert "At least one updated field" in res_ev_brackets.json()["detail"]


def test_student_resubmit_oversized_evidence_fails():
    client = TestClient(app)
    headers = {"Authorization": "Bearer mock_token"}

    app.dependency_overrides[verify_token] = lambda: student_claims("student_huge_ev")
    res_sub = client.post("/reviews/submit", json={"scenario_id": 1, "report_text": "Initial"})
    rev_id = res_sub.json()["review_id"]

    app.dependency_overrides[verify_token] = lambda: instructor_claims("instructor_prof")
    client.post(f"/instructor/reviews/{rev_id}/resolve", json={"status": "RETRY"}, headers=headers)

    app.dependency_overrides[verify_token] = lambda: student_claims("student_huge_ev")
    huge_evidence = "A" * 70000
    res = client.post(
        f"/reviews/{rev_id}/resubmit",
        json={"evidence_data": huge_evidence},
        headers=headers,
    )
    assert res.status_code == 400
    assert "evidence_data exceeds maximum length" in res.json()["detail"]


def test_instructor_reviews_status_filter_invalid():
    # Resolves GAP-10: invalid status filter returns 400
    client = TestClient(app)
    headers = {"Authorization": "Bearer mock_token"}
    app.dependency_overrides[verify_token] = lambda: instructor_claims("instructor_prof")

    res = client.get("/instructor/reviews?status_filter=INVALID_ENUM_XYZ", headers=headers)
    assert res.status_code == 400
    assert "Invalid status_filter" in res.json()["detail"]


def test_instructor_reviews_status_filter_valid():
    client = TestClient(app)
    headers = {"Authorization": "Bearer mock_token"}
    conn = db.get_db_connection()
    try:
        conn.execute(
            "INSERT INTO review_cases (student_id, scenario_id, status) "
            "VALUES ('std_p', 1, 'PENDING'), ('std_a', 1, 'APPROVED'), ('std_r', 1, 'RETRY')"
        )
        conn.commit()
    finally:
        conn.close()

    app.dependency_overrides[verify_token] = lambda: instructor_claims("instructor_prof")

    # Filter PENDING
    res_p = client.get("/instructor/reviews?status_filter=PENDING", headers=headers)
    assert res_p.status_code == 200
    assert all(r["status"] == "PENDING" for r in res_p.json()["reviews"])

    # Filter APPROVED
    res_a = client.get("/instructor/reviews?status_filter=approved", headers=headers)
    assert res_a.status_code == 200
    assert all(r["status"] == "APPROVED" for r in res_a.json()["reviews"])

    # Filter RETRY
    res_r = client.get("/instructor/reviews?status_filter=RETRY", headers=headers)
    assert res_r.status_code == 200
    assert all(r["status"] == "RETRY" for r in res_r.json()["reviews"])

    # Filter ALL
    res_all = client.get("/instructor/reviews?status_filter=ALL", headers=headers)
    assert res_all.status_code == 200
    statuses = {r["status"] for r in res_all.json()["reviews"]}
    assert "PENDING" in statuses
    assert "APPROVED" in statuses


def test_resolve_review_transaction_rollback():
    # Verify atomicity on unhandled DB error during resolution
    client = TestClient(app)
    headers = {"Authorization": "Bearer mock_token"}

    app.dependency_overrides[verify_token] = lambda: student_claims("student_rollback")
    res_sub = client.post("/reviews/submit", json={"scenario_id": 1, "report_text": "Before error"})
    rev_id = res_sub.json()["review_id"]

    app.dependency_overrides[verify_token] = lambda: instructor_claims("instructor_prof")

    # Simulate database lock or constraint error by temporarily creating a trigger that fails on UPDATE
    conn = db.get_db_connection()
    try:
        conn.execute("""
            CREATE TRIGGER fail_update BEFORE UPDATE ON review_cases
            BEGIN
                SELECT RAISE(FAIL, 'simulated constraint failure');
            END;
        """)
        conn.commit()
    finally:
        conn.close()

    try:
        # Call resolve; should encounter SQLite error and raise 500 / rollback
        with pytest.raises(Exception):
            client.post(
                f"/instructor/reviews/{rev_id}/resolve",
                json={"status": "APPROVED", "score": 100},
                headers=headers,
            )

        # Confirm review remained PENDING and score remained NULL
        conn = db.get_db_connection()
        try:
            row = conn.execute("SELECT status, score FROM review_cases WHERE review_id=?", (rev_id,)).fetchone()
            assert row["status"] == "PENDING"
            assert row["score"] is None
        finally:
            conn.close()
    finally:
        # Clean up trigger
        conn = db.get_db_connection()
        conn.execute("DROP TRIGGER IF EXISTS fail_update")
        conn.commit()
        conn.close()


def test_resolve_and_resubmit_audit_logging():
    client = TestClient(app)
    headers = {"Authorization": "Bearer mock_token"}

    # 1. Student submits
    app.dependency_overrides[verify_token] = lambda: student_claims("student_audit")
    res_sub = client.post("/reviews/submit", json={"scenario_id": 1, "report_text": "Audit test report"})
    rev_id = res_sub.json()["review_id"]

    # 2. Instructor marks RETRY
    app.dependency_overrides[verify_token] = lambda: instructor_claims("instructor_auditor")
    client.post(
        f"/instructor/reviews/{rev_id}/resolve",
        json={"status": "RETRY", "feedback": "Audit feedback"},
        headers=headers,
    )

    # 3. Student resubmits
    app.dependency_overrides[verify_token] = lambda: student_claims("student_audit")
    client.post(
        f"/reviews/{rev_id}/resubmit",
        json={"report_text": "Resubmitted text for audit"},
        headers=headers,
    )

    # Verify audit_log table
    conn = db.get_db_connection()
    try:
        events = conn.execute(
            "SELECT event_type, student_id, detail FROM audit_log WHERE student_id='student_audit' ORDER BY id"
        ).fetchall()
        event_names = [e["event_type"] for e in events]
        assert "REVIEW_CASE_RESOLVED" in event_names
        assert "REVIEW_CASE_RESUBMITTED" in event_names

        resolve_event = next(e for e in events if e["event_type"] == "REVIEW_CASE_RESOLVED")
        assert f"review_id={rev_id}" in resolve_event["detail"]
        assert "instructor_auditor" in resolve_event["detail"]

        resubmit_event = next(e for e in events if e["event_type"] == "REVIEW_CASE_RESUBMITTED")
        assert f"review_id={rev_id}" in resubmit_event["detail"]
    finally:
        conn.close()


def test_student_resubmit_cas_concurrent_status_change_conflict(monkeypatch):
    """Verify atomic CAS: if status changes concurrently between read and write, resubmit raises 409."""
    client = TestClient(app)
    headers = {"Authorization": "Bearer mock_token"}

    # 1. Student submits review
    app.dependency_overrides[verify_token] = lambda: student_claims("student_cas")
    res_sub = client.post("/reviews/submit", json={"scenario_id": 1, "report_text": "Initial report"})
    rev_id = res_sub.json()["review_id"]

    # 2. Instructor marks RETRY
    app.dependency_overrides[verify_token] = lambda: instructor_claims("instructor_prof")
    client.post(f"/instructor/reviews/{rev_id}/resolve", json={"status": "RETRY"}, headers=headers)

    # 3. Intercept DB connection so concurrent resolution commits between student read and write
    import pods_router
    real_get_conn = pods_router.get_db_connection

    class ConnProxy:
        def __init__(self, target):
            self._target = target

        def execute(self, sql, *args, **kwargs):
            res = self._target.execute(sql, *args, **kwargs)
            if "SELECT student_id, status FROM review_cases" in sql:
                # Concurrent instructor resolution commits immediately after student reads status='RETRY'
                other_conn = real_get_conn()
                try:
                    other_conn.execute(
                        "UPDATE review_cases SET status = 'APPROVED', score = 100 WHERE review_id = ?",
                        (rev_id,),
                    )
                    other_conn.commit()
                finally:
                    other_conn.close()
            return res

        def __enter__(self):
            self._target.__enter__()
            return self

        def __exit__(self, *args):
            return self._target.__exit__(*args)

        def __getattr__(self, name):
            return getattr(self._target, name)

    monkeypatch.setattr(pods_router, "get_db_connection", lambda: ConnProxy(real_get_conn()))

    # 4. Student resubmits -- should hit 409 Conflict due to CAS rowcount == 0
    app.dependency_overrides[verify_token] = lambda: student_claims("student_cas")
    res = client.post(
        f"/reviews/{rev_id}/resubmit",
        json={"report_text": "Revised report text"},
        headers=headers,
    )
    assert res.status_code == 409
    assert "no longer in RETRY status" in res.json()["detail"]


def test_student_resubmit_clears_score_feedback_and_graded_by():
    """Verify that resubmitting for RETRY resets score, feedback, and graded_by to NULL."""
    client = TestClient(app)
    headers = {"Authorization": "Bearer mock_token"}

    # 1. Student submits
    app.dependency_overrides[verify_token] = lambda: student_claims("student_hygiene")
    res_sub = client.post("/reviews/submit", json={"scenario_id": 1, "report_text": "Initial report"})
    rev_id = res_sub.json()["review_id"]

    # 2. Instructor marks RETRY with feedback
    app.dependency_overrides[verify_token] = lambda: instructor_claims("instructor_grader")
    client.post(
        f"/instructor/reviews/{rev_id}/resolve",
        json={"status": "RETRY", "feedback": "Needs more detail in section 2"},
        headers=headers,
    )

    # Verify fields populated in RETRY status
    conn = db.get_db_connection()
    try:
        row = conn.execute("SELECT status, score, feedback, graded_by FROM review_cases WHERE review_id = ?", (rev_id,)).fetchone()
        assert row["status"] == "RETRY"
        assert row["graded_by"] == "instructor_grader"
        assert row["feedback"] == "Needs more detail in section 2"
    finally:
        conn.close()

    # 3. Student resubmits
    app.dependency_overrides[verify_token] = lambda: student_claims("student_hygiene")
    res_resub = client.post(
        f"/reviews/{rev_id}/resubmit",
        json={"report_text": "Expanded report text with section 2 detail"},
        headers=headers,
    )
    assert res_resub.status_code == 200

    # 4. Verify score, feedback, and graded_by are now NULL on the PENDING row
    conn = db.get_db_connection()
    try:
        row_after = conn.execute("SELECT status, score, feedback, graded_by FROM review_cases WHERE review_id = ?", (rev_id,)).fetchone()
        assert row_after["status"] == "PENDING"
        assert row_after["score"] is None
        assert row_after["feedback"] is None
        assert row_after["graded_by"] is None
    finally:
        conn.close()


def test_student_resubmit_multibyte_boundary():
    """Verify that evidence_data length limit is measured in UTF-8 bytes, not character count."""
    client = TestClient(app)
    headers = {"Authorization": "Bearer mock_token"}

    app.dependency_overrides[verify_token] = lambda: student_claims("student_mb")
    res_sub = client.post("/reviews/submit", json={"scenario_id": 1, "report_text": "Initial report"})
    rev_id = res_sub.json()["review_id"]

    app.dependency_overrides[verify_token] = lambda: instructor_claims("instructor_prof")
    client.post(f"/instructor/reviews/{rev_id}/resolve", json={"status": "RETRY"}, headers=headers)

    app.dependency_overrides[verify_token] = lambda: student_claims("student_mb")

    # '€' is 3 bytes in UTF-8. 22,000 chars is 22,000 characters, but 66,000 bytes (> 65536 bytes).
    # If the limit checked character length, it would wrongly pass.
    multibyte_evidence = "€" * 22000
    assert len(multibyte_evidence) < 65536
    assert len(multibyte_evidence.encode("utf-8")) > 65536

    res_too_large = client.post(
        f"/reviews/{rev_id}/resubmit",
        json={"evidence_data": multibyte_evidence},
        headers=headers,
    )
    assert res_too_large.status_code == 400
    assert "evidence_data exceeds maximum length of 65536 bytes" in res_too_large.json()["detail"]


def test_resolve_review_deleted_row_returns_404(monkeypatch):
    """Verify check-then-write gap: if row is deleted before UPDATE commits, resolve raises 404."""
    client = TestClient(app)
    headers = {"Authorization": "Bearer mock_token"}

    app.dependency_overrides[verify_token] = lambda: student_claims("student_del")
    res_sub = client.post("/reviews/submit", json={"scenario_id": 1, "report_text": "To be deleted"})
    rev_id = res_sub.json()["review_id"]

    import pods_router
    real_get_conn = pods_router.get_db_connection

    class ConnProxy:
        def __init__(self, target):
            self._target = target

        def execute(self, sql, *args, **kwargs):
            res = self._target.execute(sql, *args, **kwargs)
            if "SELECT student_id, scenario_id, milestone_id, case_type" in sql:
                # Row deleted immediately after preliminary SELECT check
                other_conn = real_get_conn()
                try:
                    other_conn.execute("DELETE FROM review_cases WHERE review_id = ?", (rev_id,))
                    other_conn.commit()
                finally:
                    other_conn.close()
            return res

        def __enter__(self):
            self._target.__enter__()
            return self

        def __exit__(self, *args):
            return self._target.__exit__(*args)

        def __getattr__(self, name):
            return getattr(self._target, name)

    monkeypatch.setattr(pods_router, "get_db_connection", lambda: ConnProxy(real_get_conn()))

    app.dependency_overrides[verify_token] = lambda: instructor_claims("instructor_prof")
    res = client.post(
        f"/instructor/reviews/{rev_id}/resolve",
        json={"status": "APPROVED", "score": 100},
        headers=headers,
    )
    assert res.status_code == 404
    assert "Review case not found" in res.json()["detail"]


def test_audit_logging_failure_does_not_crash_request(monkeypatch):
    """Verify decoupled audit logging: secondary log_event errors do not 500 committed requests."""
    client = TestClient(app)
    headers = {"Authorization": "Bearer mock_token"}

    app.dependency_overrides[verify_token] = lambda: student_claims("student_log_fail")
    res_sub = client.post("/reviews/submit", json={"scenario_id": 1, "report_text": "Logging test report"})
    rev_id = res_sub.json()["review_id"]

    def failing_log_event(*args, **kwargs):
        raise sqlite3.OperationalError("simulated database lock on audit_log")

    import pods_router
    monkeypatch.setattr(pods_router, "log_event", failing_log_event)

    # 1. Resolve should succeed despite log failure
    app.dependency_overrides[verify_token] = lambda: instructor_claims("instructor_prof")
    res_res = client.post(
        f"/instructor/reviews/{rev_id}/resolve",
        json={"status": "RETRY", "feedback": "Try again"},
        headers=headers,
    )
    assert res_res.status_code == 200
    assert res_res.json()["decision"] == "RETRY"

    # 2. Resubmit should succeed despite log failure
    app.dependency_overrides[verify_token] = lambda: student_claims("student_log_fail")
    res_resub = client.post(
        f"/reviews/{rev_id}/resubmit",
        json={"report_text": "Updated report without audit log"},
        headers=headers,
    )
    assert res_resub.status_code == 200
    assert res_resub.json()["status"] == "resubmitted"


def test_resubmit_request_evidence_data_rejects_scalar_types():
    """Verify Pydantic validation: non-container / non-string scalars (float, bool) are rejected."""
    client = TestClient(app)
    headers = {"Authorization": "Bearer mock_token"}

    app.dependency_overrides[verify_token] = lambda: student_claims("student_scalar")
    res_sub = client.post("/reviews/submit", json={"scenario_id": 1, "report_text": "Scalar test report"})
    rev_id = res_sub.json()["review_id"]

    app.dependency_overrides[verify_token] = lambda: instructor_claims("instructor_prof")
    client.post(f"/instructor/reviews/{rev_id}/resolve", json={"status": "RETRY"}, headers=headers)

    app.dependency_overrides[verify_token] = lambda: student_claims("student_scalar")

    # Float scalar
    res_float = client.post(
        f"/reviews/{rev_id}/resubmit",
        json={"evidence_data": 3.14},
        headers=headers,
    )
    assert res_float.status_code == 422

    # Boolean scalar
    res_bool = client.post(
        f"/reviews/{rev_id}/resubmit",
        json={"evidence_data": True},
        headers=headers,
    )
    assert res_bool.status_code == 422


