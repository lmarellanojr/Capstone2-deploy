"""Unit tests for v4 review_cases schema, review APIs, and RBAC isolation."""
import os
import sqlite3
import tempfile
import pytest
from fastapi.testclient import TestClient

import sys
from types import ModuleType

if "pylxd" not in sys.modules:
    _pylxd = ModuleType("pylxd")
    _exc = ModuleType("pylxd.exceptions")
    _exc.NotFound = type("NotFound", (Exception,), {})
    _pylxd.exceptions = _exc
    _pylxd.Client = object
    sys.modules["pylxd"] = _pylxd
    sys.modules["pylxd.exceptions"] = _exc

import migrate
import db
import config
import auth
from auth import verify_token
from provision_api_fastapi import app


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


@pytest.fixture(autouse=True)
def temp_db(monkeypatch):
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tf:
        db_path = tf.name
    tf.close()
    monkeypatch.setattr("config.DB_PATH", db_path)
    monkeypatch.setattr("db.DB_PATH", db_path)
    monkeypatch.setattr("auth.AUTH_ENABLED", True)

    # By default, tests use a student-only token
    app.dependency_overrides[verify_token] = lambda: student_claims("student1")

    migrate.apply(db_path)
    yield db_path
    app.dependency_overrides.clear()
    if os.path.exists(db_path):
        try:
            os.unlink(db_path)
        except OSError:
            pass


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


def test_submit_scoring_conflict_without_report_text():
    client = TestClient(app)
    headers = {"Authorization": "Bearer mock_token"}

    # Submit as student
    res = client.post("/reviews/submit", json={
        "scenario_id": 2,
        "milestone_id": 1,
        "case_type": "SCORING_CONFLICT",
        "conflict_reason": "Flag submitted correctly but automated verifier failed.",
        "evidence_data": {"command": "cat /flag.txt", "output": "flag{pwned_123}"}
    }, headers=headers)
    assert res.status_code == 200
    review_id = res.json()["review_id"]

    # Verify via detail endpoint as instructor
    app.dependency_overrides[verify_token] = lambda: instructor_claims("instructor1")
    res_detail = client.get(f"/instructor/reviews/{review_id}", headers=headers)
    assert res_detail.status_code == 200
    detail = res_detail.json()
    assert detail["case_type"] == "SCORING_CONFLICT"
    assert detail["report_text"] is None
    assert detail["conflict_reason"] == "Flag submitted correctly but automated verifier failed."
    assert "flag{pwned_123}" in detail["evidence_data"]
    assert detail["score"] is None


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
    client = TestClient(app)
    headers = {"Authorization": "Bearer mock_token"}
    res = client.post("/reviews/submit", json={
        "scenario_id": 1,
        "case_type": "SCORING_CONFLICT"
    }, headers=headers)
    assert res.status_code == 400
    assert "Either conflict_reason or report_text is required" in res.json()["detail"]


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
