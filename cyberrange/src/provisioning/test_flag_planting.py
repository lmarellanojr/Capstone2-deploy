"""Unit tests for dynamic per-student milestone flag generation, DB persistence, and container planting.

Issue #111 (SCORE-HYBRID follow-up).
Validates:
- HMAC determinism and unforgeability
- Cross-student and cross-milestone flag isolation
- Cohort secret rotation effects
- Safe database upsert and retrieval in pod_milestone_flags (v7.sql)
- In-container script execution with positional parameters (injection safety)
- Fail-open and mock LXD client handling
"""
from __future__ import annotations

import sqlite3
from pathlib import Path
from unittest.mock import MagicMock

import pytest

import db
import migrate
from flag_planting import (
    DEFAULT_COHORT_SECRET,
    SCENARIO_MILESTONES,
    generate_all_scenario_flags,
    generate_milestone_flag,
    get_cohort_secret,
    get_student_expected_flag,
    plant_scenario_flags,
    save_pod_flags,
)


@pytest.fixture
def test_db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Hermetic SQLite database initialized with all migrations up to v7."""
    db_file = tmp_path / "test_flag_planting.db"
    monkeypatch.setattr(db, "DB_PATH", str(db_file))
    monkeypatch.setenv("COHORT_FLAG_SECRET", "test-cohort-secret-planting")
    migrate.apply(str(db_file))
    return str(db_file)


def test_flag_generation_determinism():
    """Identical inputs must produce identical HMAC flags."""
    flag1 = generate_milestone_flag("student_alice", 1, 1, secret="secret-key-1")
    flag2 = generate_milestone_flag("student_alice", 1, 1, secret="secret-key-1")
    assert flag1 == flag2
    assert flag1.startswith("FLAG{S01_M1_")
    assert len(flag1) == len("FLAG{S01_M1_") + 12 + 1  # prefix + 12 hex + }
    assert flag1.endswith("}")


def test_flag_cross_student_uniqueness():
    """Different students must receive completely distinct flags for the same milestone."""
    flag_alice = generate_milestone_flag("student_alice", 1, 1, secret="secret-key-1")
    flag_bob = generate_milestone_flag("student_bob", 1, 1, secret="secret-key-1")
    assert flag_alice != flag_bob


def test_flag_cross_milestone_uniqueness():
    """Different milestones for the same student must produce distinct flags."""
    flag_m1 = generate_milestone_flag("student_alice", 1, 1, secret="secret-key-1")
    flag_m2 = generate_milestone_flag("student_alice", 1, 2, secret="secret-key-1")
    assert flag_m1 != flag_m2


def test_flag_cohort_secret_rotation(monkeypatch: pytest.MonkeyPatch):
    """Rotating the cohort secret changes the generated flags."""
    flag_c1 = generate_milestone_flag("student_alice", 1, 1, secret="cohort-fall-2026")
    flag_c2 = generate_milestone_flag("student_alice", 1, 1, secret="cohort-spring-2027")
    assert flag_c1 != flag_c2


def test_flag_whitespace_and_empty_validation():
    """Student ID with whitespace is normalized; empty student ID raises ValueError."""
    flag_clean = generate_milestone_flag("student_alice", 1, 1, secret="secret-1")
    flag_space = generate_milestone_flag("  student_alice  ", 1, 1, secret="secret-1")
    assert flag_clean == flag_space

    with pytest.raises(ValueError, match="student_id cannot be empty"):
        generate_milestone_flag("", 1, 1)

    with pytest.raises(ValueError, match="student_id cannot be empty"):
        generate_milestone_flag("   ", 1, 1)


def test_generate_all_scenario_flags():
    """All milestones defined for catalog scenarios are generated."""
    flags_s01 = generate_all_scenario_flags("student_alice", 1, secret="test-key")
    assert set(flags_s01.keys()) == {1, 2, 3, 4}
    for mid, flag in flags_s01.items():
        assert flag.startswith(f"FLAG{{S01_M{mid}_")

    flags_s09 = generate_all_scenario_flags("student_alice", 9, secret="test-key")
    assert set(flags_s09.keys()) == {1, 2, 3}


def test_save_and_get_student_expected_flag(test_db: str):
    """Flags correctly persist in pod_milestone_flags and are retrievable."""
    conn = sqlite3.connect(test_db)
    conn.row_factory = sqlite3.Row

    flags_map = {
        1: "FLAG{S01_M1_AAAA1111BBBB}",
        2: "FLAG{S01_M2_CCCC2222DDDD}",
    }
    save_pod_flags(conn, pod_id=1, student_id="student_alice", scenario_id=1, flags_map=flags_map)

    # Retrieval
    retrieved_m1 = get_student_expected_flag(conn, "student_alice", 1, 1)
    assert retrieved_m1 == "FLAG{S01_M1_AAAA1111BBBB}"

    retrieved_m2 = get_student_expected_flag(conn, "student_alice", 1, 2)
    assert retrieved_m2 == "FLAG{S01_M2_CCCC2222DDDD}"

    # Non-existent milestone returns None
    assert get_student_expected_flag(conn, "student_alice", 1, 3) is None

    # Different student returns None
    assert get_student_expected_flag(conn, "student_bob", 1, 1) is None
    conn.close()


def test_save_pod_flags_upsert(test_db: str):
    """Re-provisioning updates pod_id and expected_flag without duplicate key error."""
    conn = sqlite3.connect(test_db)
    conn.row_factory = sqlite3.Row

    save_pod_flags(conn, 1, "student_alice", 1, {1: "FLAG{OLD}"})
    assert get_student_expected_flag(conn, "student_alice", 1, 1) == "FLAG{OLD}"

    # Re-provision with updated pod_id and new flag
    save_pod_flags(conn, 2, "student_alice", 1, {1: "FLAG{NEW}"})
    assert get_student_expected_flag(conn, "student_alice", 1, 1) == "FLAG{NEW}"

    # Verify single row exists in DB
    count = conn.execute(
        "SELECT COUNT(*) FROM pod_milestone_flags WHERE student_id='student_alice' AND scenario_id=1 AND milestone_id=1"
    ).fetchone()[0]
    assert count == 1
    conn.close()


def test_legacy_db_without_pod_milestone_flags_table():
    """Querying an older DB schema lacking pod_milestone_flags returns None gracefully."""
    # Temporary memory DB without v7 migration
    conn = sqlite3.connect(":memory:")
    res = get_student_expected_flag(conn, "student_alice", 1, 1)
    assert res is None
    conn.close()


def test_plant_scenario_flags_mock_client():
    """plant_scenario_flags executes in-container commands with positional arguments."""
    client = MagicMock()
    meta_mock = MagicMock()
    dvwa_mock = MagicMock()
    client.instances.get.side_effect = lambda name: meta_mock if "meta" in name else dvwa_mock

    vmids = {"meta": "pod-student_alice-meta", "dvwa": "pod-student_alice-dvwa", "kali": "pod-student_alice-kali"}
    flags_map = {1: "FLAG_1", 2: "FLAG_2", 3: "FLAG_3", 4: "FLAG_4"}

    # Scenario 01
    plant_scenario_flags(client, "student_alice", 1, vmids, 1, flags_map)
    assert meta_mock.execute.called
    call_args = meta_mock.execute.call_args[0][0]
    assert call_args[0] == "bash"
    assert call_args[1] == "-c"
    # Verify positional parameter passing ($1, $2, $3, $4)
    assert "FLAG_1" in call_args
    assert "FLAG_2" in call_args
    assert "FLAG_3" in call_args
    assert "FLAG_4" in call_args

    # Scenario 06
    meta_mock.reset_mock()
    dvwa_mock.reset_mock()
    plant_scenario_flags(client, "student_alice", 1, vmids, 6, flags_map)
    assert dvwa_mock.execute.called

    # Client None safety
    plant_scenario_flags(None, "student_alice", 1, vmids, 1, flags_map)


def test_plant_scenario_flags_handles_exec_failure():
    """Container exec failure logs warning but does not raise exception (fail-open)."""
    client = MagicMock()
    meta_mock = MagicMock()
    meta_mock.execute.side_effect = RuntimeError("Container execution timeout")
    client.instances.get.return_value = meta_mock

    vmids = {"meta": "pod-student_alice-meta"}
    flags_map = {1: "FLAG_1"}

    # Must not raise
    plant_scenario_flags(client, "student_alice", 1, vmids, 1, flags_map)
