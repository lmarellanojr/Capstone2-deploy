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
    S1_FLAG_GENERIC_ERROR,
    S1_KALI_FLAG_PATH,
    SCENARIO_MILESTONES,
    Scenario1FlagPlantingError,
    generate_all_scenario_flags,
    generate_capture_flag,
    generate_milestone_flag,
    get_cohort_secret,
    get_student_expected_flag,
    plant_scenario1_kali_m5,
    plant_scenario_flags,
    prepare_scenario_flags,
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


def test_capture_flag_is_readable_and_deterministic():
    """generate_capture_flag yields a human-readable, per-student, deterministic code."""
    import re

    flag1 = generate_capture_flag("student_alice", 6, 5, secret="secret-key-1")
    flag2 = generate_capture_flag("student_alice", 6, 5, secret="secret-key-1")
    # Deterministic for identical inputs.
    assert flag1 == flag2
    # Readable "<adjective>-<noun>-<NNNN>" shape, no FLAG{...} wrapper.
    assert "FLAG{" not in flag1
    assert re.fullmatch(r"[a-z]+-[a-z]+-\d{4}", flag1), flag1
    # Per-student uniqueness.
    assert generate_capture_flag("student_bob", 6, 5, secret="secret-key-1") != flag1
    # Whitespace in student_id is trimmed; empty is rejected.
    assert generate_capture_flag("  student_alice  ", 6, 5, secret="secret-key-1") == flag1
    with pytest.raises(ValueError):
        generate_capture_flag("", 6, 5, secret="secret-key-1")


def test_flag_cross_student_uniqueness():
    """Different students must receive completely distinct flags for the same milestone."""
    flag_alice = generate_milestone_flag("student_alice", 1, 1, secret="secret-key-1")
    flag_bob = generate_milestone_flag("student_bob", 1, 1, secret="secret-key-1")
    assert flag_alice != flag_bob
    m5_alice = generate_milestone_flag("student_alice", 1, 5, secret="secret-key-1")
    m5_bob = generate_milestone_flag("student_bob", 1, 5, secret="secret-key-1")
    assert m5_alice != m5_bob
    assert m5_alice.startswith("FLAG{S01_M5_")


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
    assert set(flags_s01.keys()) == {1, 2, 3, 4, 5}
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
    flags_map = {1: "FLAG_1", 2: "FLAG_2", 3: "FLAG_3", 4: "FLAG_4", 5: "FLAG_5"}

    # Scenario 01
    plant_scenario_flags(client, "student_alice", 1, vmids, 1, flags_map)
    assert meta_mock.execute.called
    call_args = meta_mock.execute.call_args[0][0]
    assert call_args[0] == "bash"
    assert call_args[1] == "-c"
    # Verify positional parameter passing ($1..$4). Scenario 1 M5 is planted on
    # Kali by a separate helper, so FLAG_5 is not passed to the meta script.
    assert "FLAG_1" in call_args
    assert "FLAG_2" in call_args
    assert "FLAG_3" in call_args
    assert "FLAG_4" in call_args
    assert "FLAG_5" not in call_args

    # Scenario 06
    meta_mock.reset_mock()
    dvwa_mock.reset_mock()
    plant_scenario_flags(client, "student_alice", 1, vmids, 6, flags_map)
    assert dvwa_mock.execute.called

    # Client None safety
    plant_scenario_flags(None, "student_alice", 1, vmids, 1, flags_map)


def test_plant_scenario_flags_handles_exec_failure():
    """Meta/DVWA exec failure logs warning but does not raise (fail-open)."""
    client = MagicMock()
    meta_mock = MagicMock()
    meta_mock.execute.side_effect = RuntimeError("Container execution timeout")
    client.instances.get.return_value = meta_mock

    vmids = {"meta": "pod-student_alice-meta"}
    flags_map = {1: "FLAG_1"}

    plant_scenario_flags(client, "student_alice", 1, vmids, 1, flags_map)
    plant_scenario_flags(client, "student_alice", 1, vmids, 9, flags_map)
    plant_scenario_flags(client, "student_alice", 1, vmids, 11, flags_map)


def _instance_client(kali=None, meta=None, dvwa=None):
    kali = kali or MagicMock()
    meta = meta or MagicMock()
    dvwa = dvwa or MagicMock()
    for inst in (kali, meta, dvwa):
        res = MagicMock()
        res.exit_code = 0
        inst.execute.return_value = res

    def get(name):
        if "kali" in name:
            return kali
        if "meta" in name:
            return meta
        return dvwa

    client = MagicMock()
    client.instances.get.side_effect = get
    return client, kali, meta, dvwa


def test_plant_scenario1_kali_m5_uses_positional_path_and_exit_code():
    client, kali, _meta, _dvwa = _instance_client()
    flag = "FLAG{S01_M5_AABBCCDDEEFF}"
    plant_scenario1_kali_m5(client, "student_alice", {"kali": "pod-student_alice-kali"}, flag)
    argv = kali.execute.call_args[0][0]
    assert argv[0] == "bash"
    assert argv[1] == "-c"
    assert S1_KALI_FLAG_PATH in argv[2]
    assert "printf '%s\\n' \"$1\"" in argv[2]
    assert flag not in argv[2]
    assert argv[-1] == flag
    assert "chmod 0644" in argv[2]
    assert "chown root:root" in argv[2]


def test_prepare_scenario_flags_raises_on_missing_client_empty_flag_and_nonzero(
    test_db: str, monkeypatch: pytest.MonkeyPatch
):
    conn = sqlite3.connect(test_db)
    vmids = {"kali": "pod-student_alice-kali", "meta": "pod-student_alice-meta"}
    with pytest.raises(Scenario1FlagPlantingError, match=S1_FLAG_GENERIC_ERROR) as missing:
        prepare_scenario_flags(None, "student_alice", 1, vmids, 1, conn)
    assert missing.value.reason == "missing_client"

    client_ok, _kali, _meta, _dvwa = _instance_client()
    monkeypatch.setattr(
        "flag_planting.generate_all_scenario_flags",
        lambda *a, **k: {1: "FLAG{A}", 2: "FLAG{B}", 3: "FLAG{C}", 4: "FLAG{D}", 5: "  "},
    )
    with pytest.raises(Scenario1FlagPlantingError) as empty:
        prepare_scenario_flags(client_ok, "student_alice", 1, vmids, 1, conn)
    assert empty.value.reason == "empty_flag"
    monkeypatch.setattr(
        "flag_planting.generate_all_scenario_flags", generate_all_scenario_flags
    )

    client, kali, _meta, _dvwa = _instance_client()
    kali.execute.return_value.exit_code = 1
    with pytest.raises(Scenario1FlagPlantingError) as nonzero:
        prepare_scenario_flags(client, "student_alice", 1, vmids, 1, conn)
    assert nonzero.value.reason == "kali_exec_nonzero"

    kali.execute.side_effect = RuntimeError("bash -c ... FLAG{S01_M5_DEADBEEF}")
    with pytest.raises(Scenario1FlagPlantingError) as exec_exc:
        prepare_scenario_flags(client, "student_alice", 1, vmids, 1, conn)
    assert exec_exc.value.reason == "kali_exec_exception"
    assert "FLAG{S01_M5_DEADBEEF}" not in str(exec_exc.value)
    conn.close()


def test_prepare_scenario_flags_s1_failed_plant_does_not_replace_stored_row(test_db: str):
    conn = sqlite3.connect(test_db)
    save_pod_flags(conn, 1, "student_alice", 1, {5: "student"})
    client, kali, _meta, _dvwa = _instance_client()
    kali.execute.return_value.exit_code = 1
    vmids = {
        "kali": "pod-student_alice-kali",
        "meta": "pod-student_alice-meta",
        "dvwa": "pod-student_alice-dvwa",
    }
    with pytest.raises(Scenario1FlagPlantingError):
        prepare_scenario_flags(client, "student_alice", 1, vmids, 1, conn)
    assert get_student_expected_flag(conn, "student_alice", 1, 5) == "student"
    conn.close()


def test_prepare_scenario_flags_s1_success_plants_kali_and_saves(test_db: str):
    conn = sqlite3.connect(test_db)
    client, kali, meta, _dvwa = _instance_client()
    vmids = {
        "kali": "pod-student_alice-kali",
        "meta": "pod-student_alice-meta",
        "dvwa": "pod-student_alice-dvwa",
    }
    flags_map = prepare_scenario_flags(client, "student_alice", 1, vmids, 1, conn)
    stored = get_student_expected_flag(conn, "student_alice", 1, 5)
    assert stored == flags_map[5]
    assert stored.startswith("FLAG{S01_M5_")
    kali_argv = kali.execute.call_args[0][0]
    assert kali_argv[-1] == stored
    meta_argv = meta.execute.call_args[0][0]
    assert stored not in meta_argv
    conn.close()


def test_prepare_scenario_flags_other_scenario_exec_failure_is_nonfatal(test_db: str):
    conn = sqlite3.connect(test_db)
    client = MagicMock()
    dvwa = MagicMock()
    dvwa.execute.side_effect = RuntimeError("timeout")
    client.instances.get.return_value = dvwa
    vmids = {"dvwa": "pod-student_alice-dvwa"}
    flags_map = prepare_scenario_flags(client, "student_alice", 1, vmids, 6, conn)
    assert get_student_expected_flag(conn, "student_alice", 6, 5) == flags_map[5]
    conn.close()


def test_s1_plant_failure_does_not_log_flag_token(test_db: str, monkeypatch: pytest.MonkeyPatch, caplog):
    recorded = []

    def fake_log_event(event_type, student_id=None, pod_id=None, vmid=None, result=None, detail=None):
        recorded.append(detail or "")

    import provision
    monkeypatch.setattr(provision, "log_event", fake_log_event)
    from provision import plant_flags_during_provision

    client, kali, _meta, _dvwa = _instance_client()
    leak = "FLAG{S01_M5_DEADBEEF}"
    kali.execute.side_effect = RuntimeError(f"bash -c ... {leak}")
    vmids = {
        "kali": "pod-student_alice-kali",
        "meta": "pod-student_alice-meta",
        "dvwa": "pod-student_alice-dvwa",
    }
    with pytest.raises(RuntimeError, match=S1_FLAG_GENERIC_ERROR):
        plant_flags_during_provision(client, "student_alice", 1, vmids, "1")
    assert recorded
    assert all(leak not in (d or "") for d in recorded)
    assert recorded[-1] == "scenario=1, reason=kali_exec_exception"
    assert leak not in caplog.text


def test_plant_flags_during_provision_s1_raises_other_scenarios_do_not(test_db: str, monkeypatch: pytest.MonkeyPatch):
    import provision
    from provision import plant_flags_during_provision

    monkeypatch.setattr(provision, "log_event", lambda *a, **k: None)

    def boom(*_a, **_k):
        raise Scenario1FlagPlantingError("missing_client")

    monkeypatch.setattr("flag_planting.prepare_scenario_flags", boom)
    with pytest.raises(RuntimeError, match=S1_FLAG_GENERIC_ERROR):
        plant_flags_during_provision(MagicMock(), "student_alice", 1, {}, "1")

    def other_fail(*_a, **_k):
        raise RuntimeError("plant skipped FLAG{S01_M5_DEADBEEF}")

    monkeypatch.setattr("flag_planting.prepare_scenario_flags", other_fail)
    plant_flags_during_provision(MagicMock(), "student_alice", 1, {}, "6")

    def untyped_s1(*_a, **_k):
        raise RuntimeError("COHORT_FLAG_SECRET missing FLAG{S01_M5_DEADBEEF}")

    recorded = []
    monkeypatch.setattr(
        provision,
        "log_event",
        lambda event_type, student_id=None, pod_id=None, vmid=None, result=None, detail=None: recorded.append(detail or ""),
    )
    monkeypatch.setattr("flag_planting.prepare_scenario_flags", untyped_s1)
    with pytest.raises(RuntimeError, match=S1_FLAG_GENERIC_ERROR):
        plant_flags_during_provision(MagicMock(), "student_alice", 1, {}, "1")
    assert recorded[-1] == "scenario=1, reason=kali_exec_exception"
    assert all("FLAG{" not in d for d in recorded)
