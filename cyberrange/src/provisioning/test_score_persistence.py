"""Issue 11: milestone rows survive pod teardown (student-owned)."""
from __future__ import annotations

import shutil
import sqlite3
import sys
from pathlib import Path
from types import ModuleType

import pytest
from fastapi import HTTPException

if "pylxd" not in sys.modules:
    _pylxd = ModuleType("pylxd")
    _exc = ModuleType("pylxd.exceptions")
    _exc.NotFound = type("NotFound", (Exception,), {})
    _pylxd.exceptions = _exc
    _pylxd.Client = object
    sys.modules["pylxd"] = _pylxd
    sys.modules["pylxd.exceptions"] = _exc

import auth
import db
import migrate
from db import get_db_connection
from pods_router import earned_points, get_progress, list_milestones_for_pod
from provision import finalize_destroyed_pod
from reaper import purge_storage_drift


def _pragma_names(conn: sqlite3.Connection, table: str) -> set[str]:
    return {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}


def test_migrate_to_v3(tmp_path: Path):
    db = tmp_path / "pod_mgmt.db"
    assert migrate.apply(str(db)) == 3
    conn = sqlite3.connect(db)
    try:
        assert migrate.current_version(conn) == 3
        assert "student_id" in _pragma_names(conn, "milestone_verification")
    finally:
        conn.close()


def test_backfill_student_id(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    real_schema = Path(migrate._schema_dir())
    staged = tmp_path / "schema_v2"
    staged.mkdir()
    shutil.copy(real_schema / "v1.sql", staged / "v1.sql")
    shutil.copy(real_schema / "v2.sql", staged / "v2.sql")
    monkeypatch.setattr(migrate, "_SCHEMA_DIR", str(staged))
    db = tmp_path / "pod_mgmt.db"
    assert migrate.apply(str(db)) == 2

    conn = sqlite3.connect(db)
    try:
        conn.execute(
            "INSERT INTO pods (student_id, pod_id, status) VALUES ('alice', 1, 'ACTIVE')"
        )
        conn.execute(
            "INSERT INTO milestone_verification "
            "(pod_id, scenario_id, milestone_id, status) VALUES (1, 1, 1, 'PASS')"
        )
        conn.commit()
        cols = _pragma_names(conn, "milestone_verification")
        assert "student_id" not in cols
    finally:
        conn.close()

    monkeypatch.setattr(migrate, "_SCHEMA_DIR", str(real_schema))
    assert migrate.apply(str(db)) == 3

    conn = sqlite3.connect(db)
    try:
        row = conn.execute(
            "SELECT student_id FROM milestone_verification WHERE pod_id=1"
        ).fetchone()
        assert row[0] == "alice"
    finally:
        conn.close()


def test_v3_rerun_after_alter_without_version(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    real_schema = Path(migrate._schema_dir())
    staged = tmp_path / "schema_v2"
    staged.mkdir()
    shutil.copy(real_schema / "v1.sql", staged / "v1.sql")
    shutil.copy(real_schema / "v2.sql", staged / "v2.sql")
    monkeypatch.setattr(migrate, "_SCHEMA_DIR", str(staged))
    db = tmp_path / "pod_mgmt.db"
    assert migrate.apply(str(db)) == 2

    conn = sqlite3.connect(db)
    try:
        conn.execute("ALTER TABLE milestone_verification ADD COLUMN student_id TEXT")
        conn.commit()
        assert migrate.current_version(conn) == 2
    finally:
        conn.close()

    monkeypatch.setattr(migrate, "_SCHEMA_DIR", str(real_schema))
    assert migrate.apply(str(db)) == 3
    conn = sqlite3.connect(db)
    try:
        assert "student_id" in _pragma_names(conn, "milestone_verification")
        assert migrate.current_version(conn) == 3
    finally:
        conn.close()


@pytest.fixture
def persist_db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    db_path = tmp_path / "pod_mgmt.db"
    migrate.apply(str(db_path))
    monkeypatch.setattr(db, "DB_PATH", str(db_path))
    return db_path


def _insert_pod(
    student_id: str,
    pod_id: int,
    *,
    status: str = "ACTIVE",
    scenario_id: str | None = "01",
) -> None:
    conn = get_db_connection()
    with conn:
        conn.execute(
            "INSERT INTO pods (student_id, pod_id, status, scenario_id) VALUES (?,?,?,?)",
            (student_id, pod_id, status, scenario_id),
        )
        conn.execute(
            "INSERT INTO storage_reservations (vmid, size_mb) VALUES (?, 100)",
            (pod_id,),
        )
    conn.close()


def _insert_pass(
    student_id: str,
    pod_id: int,
    scenario_id: int = 1,
    milestone_id: int = 1,
) -> None:
    conn = get_db_connection()
    with conn:
        conn.execute(
            "INSERT INTO milestone_verification "
            "(pod_id, student_id, scenario_id, milestone_id, status) "
            "VALUES (?,?,?,?, 'PASS')",
            (pod_id, student_id, scenario_id, milestone_id),
        )
    conn.close()


def _pass_count(student_id: str) -> int:
    conn = get_db_connection()
    n = conn.execute(
        "SELECT COUNT(*) FROM milestone_verification "
        "WHERE student_id=? AND status='PASS'",
        (student_id,),
    ).fetchone()[0]
    conn.close()
    return n


def test_destroy_keeps_pass(persist_db: Path):
    _insert_pod("alice", 1)
    _insert_pass("alice", 1)
    finalize_destroyed_pod(1, "DESTROYED")
    assert _pass_count("alice") == 1
    conn = get_db_connection()
    try:
        assert conn.execute(
            "SELECT status FROM pods WHERE pod_id=1"
        ).fetchone()[0] == "DESTROYED"
        assert conn.execute(
            "SELECT COUNT(*) FROM storage_reservations WHERE vmid=1"
        ).fetchone()[0] == 0
    finally:
        conn.close()


def test_cleanup_keeps_pass(persist_db: Path):
    _insert_pod("alice", 1)
    _insert_pass("alice", 1)
    finalize_destroyed_pod(1, "FAILED_ROLLBACK_COMPLETE")
    assert _pass_count("alice") == 1
    conn = get_db_connection()
    try:
        assert conn.execute(
            "SELECT status FROM pods WHERE pod_id=1"
        ).fetchone()[0] == "FAILED_ROLLBACK_COMPLETE"
    finally:
        conn.close()


def test_finalize_rejects_non_terminal(persist_db: Path):
    with pytest.raises(ValueError):
        finalize_destroyed_pod(1, "ACTIVE")


def test_reaper_does_not_purge_destroyed_scores(persist_db: Path):
    _insert_pod("alice", 1, status="DESTROYED")
    _insert_pass("alice", 1)
    purge_storage_drift()
    assert _pass_count("alice") == 1


def test_slot_reuse_does_not_leak_or_wipe(persist_db: Path):
    _insert_pod("alice", 1)
    _insert_pass("alice", 1)
    finalize_destroyed_pod(1, "DESTROYED")
    conn = get_db_connection()
    with conn:
        conn.execute("DELETE FROM pods WHERE pod_id=?", (1,))
        conn.execute(
            "INSERT INTO pods (student_id, pod_id, status, scenario_id) "
            "VALUES ('bob', 1, 'ACTIVE', '01')"
        )
    conn.close()
    assert _pass_count("alice") == 1
    conn = get_db_connection()
    pod = dict(conn.execute("SELECT * FROM pods WHERE pod_id=1").fetchone())
    conn.close()
    assert list_milestones_for_pod(pod) == []


def test_new_pod_get_returns_prior_pass(persist_db: Path):
    _insert_pod("alice", 1, scenario_id="01")
    _insert_pass("alice", 1, scenario_id=1)
    finalize_destroyed_pod(1, "DESTROYED")
    conn = get_db_connection()
    with conn:
        conn.execute("DELETE FROM pods WHERE pod_id=?", (1,))
        conn.execute(
            "INSERT INTO pods (student_id, pod_id, status, scenario_id) "
            "VALUES ('alice', 1, 'ACTIVE', '01')"
        )
    pod = dict(conn.execute("SELECT * FROM pods WHERE pod_id=1").fetchone())
    conn.close()
    rows = list_milestones_for_pod(pod)
    assert any(r["status"] == "PASS" and r["milestone_id"] == 1 for r in rows)


def test_null_scenario_returns_empty(persist_db: Path):
    _insert_pod("alice", 1, scenario_id=None)
    _insert_pass("alice", 1, scenario_id=1)
    conn = get_db_connection()
    pod = dict(conn.execute("SELECT * FROM pods WHERE pod_id=1").fetchone())
    conn.close()
    assert list_milestones_for_pod(pod) == []


def test_progress_endpoint_is_owner_scoped(persist_db: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(auth, "AUTH_ENABLED", True)
    _insert_pod("alice", 1)
    _insert_pod("bob", 2)
    _insert_pass("alice", 1)
    _insert_pass("bob", 2)
    alice = get_progress(claims={"preferred_username": "alice"})
    assert alice["student_id"] == "alice"
    assert all(m["pod_id"] == 1 for m in alice["milestones"])
    bob = get_progress(claims={"preferred_username": "bob"})
    assert bob["student_id"] == "bob"
    assert all(m["pod_id"] == 2 for m in bob["milestones"])
    with pytest.raises(HTTPException) as ei:
        get_progress(claims={})
    assert ei.value.status_code == 401


def test_earned_dedupe_two_pass_rows(persist_db: Path):
    _insert_pod("alice", 1)
    _insert_pass("alice", 1, scenario_id=1, milestone_id=1)
    _insert_pass("alice", 1, scenario_id=1, milestone_id=1)
    catalog = {1: {1: 50}}
    conn = get_db_connection()
    rows = [
        dict(r)
        for r in conn.execute(
            "SELECT scenario_id, milestone_id, status FROM milestone_verification "
            "WHERE student_id='alice'"
        )
    ]
    conn.close()
    assert earned_points(rows, catalog) == 50

