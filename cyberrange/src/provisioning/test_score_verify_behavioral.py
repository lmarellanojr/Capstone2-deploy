"""SCORE-VERIFY: Behavioral Verifier Validation Across 4 Scenarios.

Task: Validate and stabilize automated container checking via scoring_checks.sh
and the manual check / auto-poll endpoints across scenarios 01, 06, 09, and 11.

This test suite exercises the FULL scoring pipeline from verifier through
persistence, covering:

  Scenario 01 (Reconnaissance): 4 milestones — PASS/FAIL on kali
  Scenario 06 (SQL Injection):  3 milestones — PASS/FAIL on kali
  Scenario 09 (SIEM Triage):    3 milestones — PASS/FAIL on meta + advisory detection
  Scenario 11 (Hardening):      3 milestones — PASS/FAIL on meta

Invariants validated:
  G-01: Automated scoring produces correct PASS/FAIL per milestone
  G-03: Milestone verification records are correctly persisted per student
  G-06: detection_score is advisory-only (Scenario 09)

Owner: Shekinah Jabez Florentino
Reviewer: Lenie Joice Mendoza
"""
from __future__ import annotations

import json
import os
import shutil
import sqlite3
from pathlib import Path
from typing import Dict, List, Literal, Tuple

import pytest
from fastapi import HTTPException

from scoring import verify_milestone
from score_poller import (
    SCENARIO_MILESTONE_COUNTS,
    _active_pods_with_scenario,
    _passed_milestone_ids,
    _pending_milestones,
    score_poll_once,
)
from ssh_verifier import SCENARIO_TARGETS
from wazuh_rule_map import (
    LIVE_CATALOG_SCENARIOS,
    detection_for,
    get_live_catalog_rules,
)
from db import get_db_connection
import db
import config
import migrate
import scoring_state


# ────────────────────────────────────────────────────────────────────────────
# Configurable Dummy Verifiers
# ────────────────────────────────────────────────────────────────────────────
class DummyVerifier:
    """Configurable verifier that returns preset results per (scenario, milestone)."""

    def __init__(self, results: Dict[Tuple[int, int], str] | None = None, default: str = "FAIL"):
        self._results = results or {}
        self._default = default

    async def verify_milestone(
        self, student_id: str, scenario_id: int, milestone_id: int
    ) -> Tuple[Literal["PASS", "FAIL", "UNKNOWN", "ERROR"], str]:
        status = self._results.get((scenario_id, milestone_id), self._default)
        return status, f"Behavioral check: {status}"


class DummyPassAll:
    """Verifier that returns PASS for every milestone."""
    async def verify_milestone(self, student_id, scenario_id, milestone_id):
        return "PASS", "All milestones pass"


class DummyFailAll:
    """Verifier that returns FAIL for every milestone."""
    async def verify_milestone(self, student_id, scenario_id, milestone_id):
        return "FAIL", "All milestones fail"


# ────────────────────────────────────────────────────────────────────────────
# Shared Fixtures
# ────────────────────────────────────────────────────────────────────────────
@pytest.fixture
def sv_db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Fresh migrated DB for SCORE-VERIFY tests."""
    db_path = tmp_path / "sv_pod_mgmt.db"
    migrate.apply(str(db_path))
    monkeypatch.setattr(db, "DB_PATH", str(db_path))
    monkeypatch.setattr(config, "DB_PATH", str(db_path))
    return db_path


def _insert_pod(
    student_id: str,
    pod_id: int,
    *,
    status: str = "ACTIVE",
    scenario_id: str = "01",
    wazuh_agent_id: str | None = None,
) -> dict:
    """Insert a pod and return its dict representation."""
    conn = get_db_connection()
    with conn:
        conn.execute(
            "INSERT INTO pods (student_id, pod_id, status, scenario_id, wazuh_agent_id) "
            "VALUES (?,?,?,?,?)",
            (student_id, pod_id, status, scenario_id, wazuh_agent_id),
        )
    pod = dict(conn.execute("SELECT * FROM pods WHERE pod_id=?", (pod_id,)).fetchone())
    conn.close()
    return pod


def _milestone_rows(student_id: str, scenario_id: int | None = None) -> List[dict]:
    """Query all milestone_verification rows for a student, optionally filtered by scenario."""
    conn = get_db_connection()
    if scenario_id is not None:
        rows = conn.execute(
            "SELECT * FROM milestone_verification WHERE student_id=? AND scenario_id=?",
            (student_id, scenario_id),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM milestone_verification WHERE student_id=?",
            (student_id,),
        ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def _pass_count(student_id: str, scenario_id: int) -> int:
    conn = get_db_connection()
    n = conn.execute(
        "SELECT COUNT(*) FROM milestone_verification "
        "WHERE student_id=? AND scenario_id=? AND status='PASS'",
        (student_id, scenario_id),
    ).fetchone()[0]
    conn.close()
    return n


def _fail_count(student_id: str, scenario_id: int) -> int:
    conn = get_db_connection()
    n = conn.execute(
        "SELECT COUNT(*) FROM milestone_verification "
        "WHERE student_id=? AND scenario_id=? AND status='FAIL'",
        (student_id, scenario_id),
    ).fetchone()[0]
    conn.close()
    return n


# ============================================================================
# SECTION 1 — Structural Invariants (No DB needed)
# ============================================================================
class TestStructuralInvariants:
    """Verify that the scoring subsystem's structural wiring is correct."""

    def test_live_catalog_scenarios_are_01_06_09_11(self):
        """G-01: Live portal catalog only exposes the four active scenarios."""
        assert LIVE_CATALOG_SCENARIOS == ("01", "06", "09", "11")

    def test_score_poller_milestone_counts_match_catalog(self):
        """G-03: Poller milestone counts cover exactly the four catalog scenarios."""
        assert set(SCENARIO_MILESTONE_COUNTS.keys()) == {1, 6, 9, 11}
        assert SCENARIO_MILESTONE_COUNTS[1] == 4
        assert SCENARIO_MILESTONE_COUNTS[6] == 4
        assert SCENARIO_MILESTONE_COUNTS[9] == 3
        assert SCENARIO_MILESTONE_COUNTS[11] == 3

    def test_scenario_targets_map_correct_roles(self):
        """G-01: Container role routing matches scoring_checks.sh expectations."""
        # Scenarios 01, 06 → kali (attacker)
        assert SCENARIO_TARGETS[1] == "kali"
        assert SCENARIO_TARGETS[6] == "kali"
        # Scenarios 09, 11 → meta (victim/target)
        assert SCENARIO_TARGETS[9] == "meta"
        assert SCENARIO_TARGETS[11] == "meta"

    def test_detection_for_scenario_09_m1_resolves(self):
        """G-06: Scenario 09 M1 maps to Wazuh rule 5710 on meta."""
        det = detection_for(9, 1)
        assert det is not None
        assert det["role"] == "meta"
        assert det["rule_id"] == "5710"

    def test_detection_for_scenarios_01_06_11_returns_none(self):
        """G-06: Scenarios 01, 06, 11 have no detection rules (advisory stays 0)."""
        for sid in (1, 6, 11):
            for mid in range(1, 5):
                assert detection_for(sid, mid) is None

    def test_pending_milestones_logic(self):
        """G-03: _pending_milestones returns correct unpassed milestones."""
        assert _pending_milestones(1, set()) == [1, 2, 3, 4]
        assert _pending_milestones(1, {1, 3}) == [2, 4]
        assert _pending_milestones(1, {1, 2, 3, 4}) == []
        assert _pending_milestones(6, set()) == [1, 2, 3, 4]
        assert _pending_milestones(9, {1}) == [2, 3]
        assert _pending_milestones(11, {1, 2, 3}) == []
        # Unknown scenario returns empty
        assert _pending_milestones(99, set()) == []


# ============================================================================
# SECTION 2 — Scenario 01: Network Reconnaissance (kali, 4 milestones)
# Persistence per scenario (G-03)
# ============================================================================
class TestScenario01Reconnaissance:
    """Milestone persistence verification across all 4 milestones for Scenario 01 (G-03)."""

    @pytest.mark.anyio
    async def test_scenario_01_pass_all_milestones(self, sv_db):
        """TC-S01-PASS: All 4 milestones pass → 4 PASS records in milestone_verification."""
        pod = _insert_pod("s01pass", 1, scenario_id="01")
        for mid in range(1, 5):
            res = await verify_milestone(
                pod=pod, scenario_id=1, milestone_id=mid,
                scoring_enabled=True, ssh_verifier_cls=DummyPassAll,
                detection_enabled=False, detection_for=None, verify_siem_alert=None,
            )
            assert res.status == "PASS"
            assert res.scenario_id == 1
            assert res.milestone_id == mid
            assert res.detection_score == 0  # No detection for scenario 01

        assert _pass_count("s01pass", 1) == 4
        assert _fail_count("s01pass", 1) == 0

    @pytest.mark.anyio
    async def test_scenario_01_fail_all_milestones(self, sv_db):
        """TC-S01-FAIL: All 4 milestones fail → 4 FAIL records, no false PASS."""
        pod = _insert_pod("s01fail", 2, scenario_id="01")
        for mid in range(1, 5):
            res = await verify_milestone(
                pod=pod, scenario_id=1, milestone_id=mid,
                scoring_enabled=True, ssh_verifier_cls=DummyFailAll,
                detection_enabled=False, detection_for=None, verify_siem_alert=None,
            )
            assert res.status == "FAIL"

        assert _pass_count("s01fail", 1) == 0
        assert _fail_count("s01fail", 1) == 4

    @pytest.mark.anyio
    async def test_scenario_01_mixed_results(self, sv_db):
        """Scenario 01: M1 PASS, M2 FAIL, M3 PASS, M4 FAIL — each recorded correctly."""
        results = {(1, 1): "PASS", (1, 2): "FAIL", (1, 3): "PASS", (1, 4): "FAIL"}
        verifier_cls = type("Mixed01", (), {
            "__init__": lambda self: None,
            "verify_milestone": lambda self, sid, scen, mid: _async_result(results.get((scen, mid), "FAIL")),
        })
        pod = _insert_pod("s01mix", 3, scenario_id="01")
        for mid in range(1, 5):
            res = await verify_milestone(
                pod=pod, scenario_id=1, milestone_id=mid,
                scoring_enabled=True, ssh_verifier_cls=verifier_cls,
                detection_enabled=False, detection_for=None, verify_siem_alert=None,
            )
            assert res.status == results[(1, mid)]

        assert _pass_count("s01mix", 1) == 2
        assert _fail_count("s01mix", 1) == 2


# ============================================================================
# SECTION 3 — Scenario 06: SQL Injection & Reflected XSS (kali, 4 milestones)
# Persistence per scenario (G-03)
# ============================================================================
class TestScenario06SQLInjection:
    """Milestone persistence verification across all 4 milestones for Scenario 06 (G-03)."""

    @pytest.mark.anyio
    async def test_scenario_06_pass_all_milestones(self, sv_db):
        """TC-S06-PASS: All 4 milestones pass, detection stays 0 (deferred web rules)."""
        pod = _insert_pod("s06pass", 10, scenario_id="06")
        for mid in range(1, 5):
            res = await verify_milestone(
                pod=pod, scenario_id=6, milestone_id=mid,
                scoring_enabled=True, ssh_verifier_cls=DummyPassAll,
                detection_enabled=True, detection_for=detection_for,
                verify_siem_alert=lambda aid, rule_id, since_minutes: True,
            )
            assert res.status == "PASS"
            assert res.detection_score == 0  # No web rules → score stays 0

        assert _pass_count("s06pass", 6) == 4

    @pytest.mark.anyio
    async def test_scenario_06_fail_all_milestones(self, sv_db):
        """TC-S06-FAIL: All 4 milestones fail → no false PASS."""
        pod = _insert_pod("s06fail", 11, scenario_id="06")
        for mid in range(1, 5):
            res = await verify_milestone(
                pod=pod, scenario_id=6, milestone_id=mid,
                scoring_enabled=True, ssh_verifier_cls=DummyFailAll,
                detection_enabled=False, detection_for=None, verify_siem_alert=None,
            )
            assert res.status == "FAIL"

        assert _pass_count("s06fail", 6) == 0
        assert _fail_count("s06fail", 6) == 4

    @pytest.mark.anyio
    async def test_scenario_06_detection_for_returns_none(self, sv_db):
        """G-06: detection_for returns None for all Scenario 06 milestones (Apache rules deferred)."""
        for mid in range(1, 5):
            assert detection_for(6, mid) is None
            assert detection_for("06", mid) is None


# ============================================================================
# SECTION 4 — Scenario 09: SIEM Alert Triage (meta, 3 milestones)
# Persistence per scenario (G-03) + advisory detection invariant (G-06)
# ============================================================================
class TestScenario09SIEMTriage:
    """Milestone persistence (G-03) and advisory detection invariant (G-06) for Scenario 09."""

    @pytest.mark.anyio
    async def test_scenario_09_pass_with_siem_detection(self, sv_db):
        """TC-S09-PASS: M1 PASS + SIEM alert found → PASS with detection_score=1."""
        pod = _insert_pod(
            "s09pass", 20, scenario_id="09",
            wazuh_agent_id=json.dumps({"meta": "005"}),
        )
        res = await verify_milestone(
            pod=pod, scenario_id=9, milestone_id=1,
            scoring_enabled=True, ssh_verifier_cls=DummyPassAll,
            detection_enabled=True, detection_for=detection_for,
            verify_siem_alert=lambda aid, rule_id, since_minutes: True,
        )
        assert res.status == "PASS"
        assert res.detection_score == 1

        rows = _milestone_rows("s09pass", 9)
        assert len(rows) == 1
        assert rows[0]["status"] == "PASS"
        assert rows[0]["detection_score"] == 1
        assert "5710" in (rows[0]["detection_data"] or "")

    @pytest.mark.anyio
    async def test_scenario_09_pass_without_siem_still_passes(self, sv_db):
        """G-06 CRITICAL: SIEM alert missing but behavioral PASS → status remains PASS (advisory)."""
        pod = _insert_pod(
            "s09nosiem", 21, scenario_id="09",
            wazuh_agent_id=json.dumps({"meta": "005"}),
        )
        res = await verify_milestone(
            pod=pod, scenario_id=9, milestone_id=1,
            scoring_enabled=True, ssh_verifier_cls=DummyPassAll,
            detection_enabled=True, detection_for=detection_for,
            verify_siem_alert=lambda aid, rule_id, since_minutes: False,
        )
        assert res.status == "PASS"
        assert res.detection_score == 0

    @pytest.mark.anyio
    async def test_scenario_09_fail_with_siem_still_fails(self, sv_db):
        """G-06 CRITICAL: SIEM alert found but behavioral FAIL → status remains FAIL (advisory)."""
        pod = _insert_pod(
            "s09failsiem", 22, scenario_id="09",
            wazuh_agent_id=json.dumps({"meta": "005"}),
        )
        res = await verify_milestone(
            pod=pod, scenario_id=9, milestone_id=1,
            scoring_enabled=True, ssh_verifier_cls=DummyFailAll,
            detection_enabled=True, detection_for=detection_for,
            verify_siem_alert=lambda aid, rule_id, since_minutes: True,
        )
        assert res.status == "FAIL"
        assert res.detection_score == 1  # advisory, does NOT gate pass/fail

    @pytest.mark.anyio
    async def test_scenario_09_fail_all_no_siem(self, sv_db):
        """TC-S09-FAIL: All 3 milestones fail, no SIEM → all FAIL, detection_score=0."""
        pod = _insert_pod("s09failall", 23, scenario_id="09")
        for mid in range(1, 4):
            res = await verify_milestone(
                pod=pod, scenario_id=9, milestone_id=mid,
                scoring_enabled=True, ssh_verifier_cls=DummyFailAll,
                detection_enabled=False, detection_for=None, verify_siem_alert=None,
            )
            assert res.status == "FAIL"
            assert res.detection_score == 0

        assert _pass_count("s09failall", 9) == 0
        assert _fail_count("s09failall", 9) == 3

    @pytest.mark.anyio
    async def test_scenario_09_m2_m3_have_no_detection_rule(self, sv_db):
        """G-06: Only M1 has a detection rule; M2 and M3 should have detection_score=0."""
        pod = _insert_pod(
            "s09m2m3", 24, scenario_id="09",
            wazuh_agent_id=json.dumps({"meta": "005"}),
        )
        for mid in (2, 3):
            res = await verify_milestone(
                pod=pod, scenario_id=9, milestone_id=mid,
                scoring_enabled=True, ssh_verifier_cls=DummyPassAll,
                detection_enabled=True, detection_for=detection_for,
                verify_siem_alert=lambda aid, rule_id, since_minutes: True,
            )
            assert res.status == "PASS"
            assert res.detection_score == 0  # No detection rule for M2/M3

    @pytest.mark.anyio
    async def test_scenario_09_no_wazuh_agent_id(self, sv_db):
        """G-06: Pod without wazuh_agent_id → detection_score stays 0 even with detection_enabled."""
        pod = _insert_pod("s09noagent", 25, scenario_id="09")
        res = await verify_milestone(
            pod=pod, scenario_id=9, milestone_id=1,
            scoring_enabled=True, ssh_verifier_cls=DummyPassAll,
            detection_enabled=True, detection_for=detection_for,
            verify_siem_alert=lambda aid, rule_id, since_minutes: True,
        )
        assert res.status == "PASS"
        assert res.detection_score == 0


# ============================================================================
# SECTION 5 — Scenario 11: Vulnerability Hardening (meta, 3 milestones)
# Persistence per scenario (G-03)
# ============================================================================
class TestScenario11Hardening:
    """Milestone persistence verification across all 3 milestones for Scenario 11 (G-03)."""

    @pytest.mark.anyio
    async def test_scenario_11_pass_all_milestones(self, sv_db):
        """TC-S11-PASS: All 3 milestones pass → 3 PASS records."""
        pod = _insert_pod("s11pass", 30, scenario_id="11")
        for mid in range(1, 4):
            res = await verify_milestone(
                pod=pod, scenario_id=11, milestone_id=mid,
                scoring_enabled=True, ssh_verifier_cls=DummyPassAll,
                detection_enabled=False, detection_for=None, verify_siem_alert=None,
            )
            assert res.status == "PASS"
            assert res.detection_score == 0

        assert _pass_count("s11pass", 11) == 3
        assert _fail_count("s11pass", 11) == 0

    @pytest.mark.anyio
    async def test_scenario_11_fail_all_milestones(self, sv_db):
        """TC-S11-FAIL: All 3 milestones fail → no false PASS."""
        pod = _insert_pod("s11fail", 31, scenario_id="11")
        for mid in range(1, 4):
            res = await verify_milestone(
                pod=pod, scenario_id=11, milestone_id=mid,
                scoring_enabled=True, ssh_verifier_cls=DummyFailAll,
                detection_enabled=False, detection_for=None, verify_siem_alert=None,
            )
            assert res.status == "FAIL"

        assert _pass_count("s11fail", 11) == 0
        assert _fail_count("s11fail", 11) == 3

    @pytest.mark.anyio
    async def test_scenario_11_detection_stays_zero(self, sv_db):
        """G-06: Scenario 11 has no detection rules → detection_score stays 0."""
        for mid in range(1, 4):
            assert detection_for(11, mid) is None
            assert detection_for("11", mid) is None


# ============================================================================
# SECTION 6 — Auto-Poll Behavior (score_poller.py)
# ============================================================================
class TestAutoPollerBehavior:
    """Validate that score_poll_once correctly identifies and verifies pending milestones."""

    @pytest.mark.anyio
    async def test_auto_poll_verifies_pending_milestones(self, sv_db, monkeypatch):
        """Auto-poll should verify all pending milestones for active pods."""
        _insert_pod("pollstudent", 40, scenario_id="01")

        monkeypatch.setattr(scoring_state, "SCORING_ENABLED", True)
        monkeypatch.setattr(scoring_state, "SSHVerifier", DummyPassAll)
        monkeypatch.setattr(scoring_state, "DETECTION_ENABLED", False)
        monkeypatch.setattr(scoring_state, "detection_for", None)
        monkeypatch.setattr(scoring_state, "verify_siem_alert", None)

        await score_poll_once()

        assert _pass_count("pollstudent", 1) == 4  # All 4 milestones

    @pytest.mark.anyio
    async def test_auto_poll_skips_already_passed_milestones(self, sv_db, monkeypatch):
        """Auto-poll should NOT re-verify milestones already marked PASS."""
        pod = _insert_pod("pollskip", 41, scenario_id="09")

        # Pre-insert M1 as PASS
        conn = get_db_connection()
        with conn:
            conn.execute(
                "INSERT INTO milestone_verification (pod_id, student_id, scenario_id, milestone_id, status) "
                "VALUES (?,?,?,?,?)",
                (41, "pollskip", 9, 1, "PASS"),
            )
        conn.close()

        monkeypatch.setattr(scoring_state, "SCORING_ENABLED", True)
        monkeypatch.setattr(scoring_state, "SSHVerifier", DummyPassAll)
        monkeypatch.setattr(scoring_state, "DETECTION_ENABLED", False)
        monkeypatch.setattr(scoring_state, "detection_for", None)
        monkeypatch.setattr(scoring_state, "verify_siem_alert", None)

        await score_poll_once()

        # M1 was already passed + 2 new (M2, M3) = 3 total PASS rows
        assert _pass_count("pollskip", 9) == 3

    @pytest.mark.anyio
    async def test_auto_poll_disabled_does_nothing(self, sv_db, monkeypatch):
        """Auto-poll should exit immediately when SCORING_ENABLED is False."""
        _insert_pod("polloff", 42, scenario_id="06")
        monkeypatch.setattr(scoring_state, "SCORING_ENABLED", False)

        await score_poll_once()

        assert _pass_count("polloff", 6) == 0

    @pytest.mark.anyio
    async def test_auto_poll_ignores_non_active_pods(self, sv_db, monkeypatch):
        """Auto-poll should only process ACTIVE pods with a scenario_id."""
        _insert_pod("destroyed", 43, status="DESTROYED", scenario_id="01")
        _insert_pod("noscenario", 44, status="ACTIVE", scenario_id=None)

        monkeypatch.setattr(scoring_state, "SCORING_ENABLED", True)
        monkeypatch.setattr(scoring_state, "SSHVerifier", DummyPassAll)
        monkeypatch.setattr(scoring_state, "DETECTION_ENABLED", False)
        monkeypatch.setattr(scoring_state, "detection_for", None)
        monkeypatch.setattr(scoring_state, "verify_siem_alert", None)

        await score_poll_once()

        assert _pass_count("destroyed", 1) == 0
        assert _pass_count("noscenario", 1) == 0

    @pytest.mark.anyio
    async def test_auto_poll_failure_does_not_block_other_pods(self, sv_db, monkeypatch):
        """If one pod's verification errors, other pods still get verified."""
        _insert_pod("goodpod", 45, scenario_id="11")
        _insert_pod("badpod", 46, scenario_id="11")

        call_count = {"good": 0, "bad": 0}

        class SelectiveVerifier:
            async def verify_milestone(self, student_id, scenario_id, milestone_id):
                if student_id == "badpod":
                    call_count["bad"] += 1
                    raise Exception("Simulated LXD failure")
                call_count["good"] += 1
                return "PASS", "OK"

        monkeypatch.setattr(scoring_state, "SCORING_ENABLED", True)
        monkeypatch.setattr(scoring_state, "SSHVerifier", SelectiveVerifier)
        monkeypatch.setattr(scoring_state, "DETECTION_ENABLED", False)
        monkeypatch.setattr(scoring_state, "detection_for", None)
        monkeypatch.setattr(scoring_state, "verify_siem_alert", None)

        await score_poll_once()

        # "goodpod" should get all 3 milestones verified
        assert _pass_count("goodpod", 11) == 3
        # "badpod" errors were caught, no records
        assert _pass_count("badpod", 11) == 0


# ============================================================================
# SECTION 7 — Cross-Scenario Milestone Persistence
# ============================================================================
class TestMilestonePersistenceAcrossScenarios:
    """Validate milestone records across different scenarios don't interfere."""

    @pytest.mark.anyio
    async def test_different_scenarios_isolated(self, sv_db):
        """Student working on Scenario 01 and later 09 — records are independent."""
        pod01 = _insert_pod("multiscen", 50, scenario_id="01")
        # PASS S01 M1
        await verify_milestone(
            pod=pod01, scenario_id=1, milestone_id=1,
            scoring_enabled=True, ssh_verifier_cls=DummyPassAll,
            detection_enabled=False, detection_for=None, verify_siem_alert=None,
        )

        # Insert another pod for S09
        conn = get_db_connection()
        with conn:
            conn.execute(
                "UPDATE pods SET status='DESTROYED' WHERE pod_id=50"
            )
            conn.execute(
                "INSERT INTO pods (student_id, pod_id, status, scenario_id) VALUES (?,?,?,?)",
                ("multiscen", 51, "ACTIVE", "09"),
            )
        pod09 = dict(conn.execute("SELECT * FROM pods WHERE pod_id=51").fetchone())
        conn.close()

        # FAIL S09 M1
        await verify_milestone(
            pod=pod09, scenario_id=9, milestone_id=1,
            scoring_enabled=True, ssh_verifier_cls=DummyFailAll,
            detection_enabled=False, detection_for=None, verify_siem_alert=None,
        )

        # S01 records are intact
        assert _pass_count("multiscen", 1) == 1
        # S09 records are separate
        assert _fail_count("multiscen", 9) == 1
        # No cross-contamination
        assert _pass_count("multiscen", 9) == 0

    @pytest.mark.anyio
    async def test_student_id_in_milestone_verification(self, sv_db):
        """student_id is always populated in milestone_verification (v3 schema requirement)."""
        pod = _insert_pod("checkstudent", 55, scenario_id="06")
        await verify_milestone(
            pod=pod, scenario_id=6, milestone_id=1,
            scoring_enabled=True, ssh_verifier_cls=DummyPassAll,
            detection_enabled=False, detection_for=None, verify_siem_alert=None,
        )
        rows = _milestone_rows("checkstudent", 6)
        assert len(rows) == 1
        assert rows[0]["student_id"] == "checkstudent"


# ============================================================================
# SECTION 8 — Scoring Engine Availability Guards
# ============================================================================
class TestScoringEngineGuards:
    """Validate that verify_milestone rejects calls when scoring is disabled."""

    @pytest.mark.anyio
    async def test_scoring_disabled_returns_503(self, sv_db):
        """When scoring_enabled=False, verify_milestone raises 503."""
        pod = _insert_pod("disabled", 60, scenario_id="01")
        with pytest.raises(HTTPException) as exc_info:
            await verify_milestone(
                pod=pod, scenario_id=1, milestone_id=1,
                scoring_enabled=False, ssh_verifier_cls=None,
                detection_enabled=False, detection_for=None, verify_siem_alert=None,
            )
        assert exc_info.value.status_code == 503

    @pytest.mark.anyio
    async def test_no_verifier_class_returns_503(self, sv_db):
        """When ssh_verifier_cls is None, verify_milestone raises 503."""
        pod = _insert_pod("noverifier", 61, scenario_id="01")
        with pytest.raises(HTTPException) as exc_info:
            await verify_milestone(
                pod=pod, scenario_id=1, milestone_id=1,
                scoring_enabled=True, ssh_verifier_cls=None,
                detection_enabled=False, detection_for=None, verify_siem_alert=None,
            )
        assert exc_info.value.status_code == 503


# ============================================================================
# SECTION 9 — scoring_checks.sh Scenario Coverage
# ============================================================================
class TestScoringChecksShCoverage:
    """Validate that scoring_checks.sh has case handlers for all 4 catalog scenarios."""

    def test_scoring_checks_script_exists(self):
        """scoring_checks.sh is co-located with ssh_verifier.py."""
        from ssh_verifier import SCORING_SCRIPT_PATH
        assert Path(SCORING_SCRIPT_PATH).exists()

    def test_scoring_checks_handles_all_catalog_scenarios(self):
        """scoring_checks.sh has case entries for scenarios 1, 6, 9, 11."""
        from ssh_verifier import SCORING_SCRIPT_PATH
        content = Path(SCORING_SCRIPT_PATH).read_text()
        # Main dispatch case statement
        assert "1) check_scenario_1" in content
        assert "6) check_scenario_6" in content
        assert "9) check_scenario_9" in content
        assert "11) check_scenario_11" in content

    def test_scoring_checks_unknown_scenario_returns_unknown(self):
        """Default case in scoring_checks.sh should output UNKNOWN."""
        from ssh_verifier import SCORING_SCRIPT_PATH
        content = Path(SCORING_SCRIPT_PATH).read_text()
        assert "UNKNOWN" in content
        assert "check_scenario_default" in content


# ============================================================================
# SECTION 10 — scoring_checks.sh Direct Bash Execution Across 4 Scenarios
# ============================================================================
def _find_bash() -> str | None:
    """Prefer Git Bash on Windows. WSL's System32 bash cannot run Windows script paths."""
    git_candidates = [
        r"C:\Program Files\Git\bin\bash.exe",
        r"C:\Program Files\Git\usr\bin\bash.exe",
        r"C:\Git\bin\bash.exe",
    ]
    if os.name == "nt":
        for candidate in git_candidates:
            if Path(candidate).exists():
                return candidate
    p = shutil.which("bash")
    if p and "system32" not in p.lower() and "SysNative" not in p:
        return p
    if p:
        return p
    for candidate in git_candidates:
        if Path(candidate).exists():
            return candidate
    return None


_BASH_EXE = _find_bash()


@pytest.mark.skipif(_BASH_EXE is None, reason="Bash executable not available")
class TestScoringChecksDirectBashExecution:
    """Direct subprocess execution of scoring_checks.sh using bash."""

    @pytest.fixture(autouse=True)
    def setup_script(self, tmp_path: Path):
        from ssh_verifier import SCORING_SCRIPT_PATH
        self.script_path = str(Path(SCORING_SCRIPT_PATH).resolve())
        assert Path(self.script_path).exists()
        self.default_home = tmp_path / "bash_home"
        self.default_home.mkdir(parents=True, exist_ok=True)
        self.default_log = tmp_path / "scoring.log"

    def _run_script(self, scenario: int | str, milestone: int | str, env=None) -> Tuple[int, str, str]:
        import subprocess
        run_env = {
            **os.environ,
            "HOME": self.default_home.as_posix(),
            "LOG_FILE": self.default_log.as_posix(),
        }
        if env:
            run_env.update(env)
        res = subprocess.run(
            [_BASH_EXE, self.script_path, str(scenario), str(milestone)],
            capture_output=True,
            text=True,
            env=run_env,
        )
        lines = [ln.strip() for ln in res.stdout.splitlines() if ln.strip()]
        token = lines[-1] if lines else ""
        return res.returncode, token, res.stderr

    @pytest.mark.parametrize("scenario,milestones", [
        (1, [1, 2, 3, 4]),
        (6, [1, 2, 3, 4]),
        (9, [1, 2, 3]),
        (11, [1, 2, 3]),
    ])
    def test_direct_bash_all_scenarios_baseline_fail(self, scenario, milestones):
        """In clean/unconfigured state, all milestones across 4 scenarios return RC=0 and token=FAIL."""
        for mid in milestones:
            rc, token, stderr = self._run_script(scenario, mid)
            assert rc == 0, f"Scenario {scenario} M{mid} exited with rc={rc}, stderr={stderr}"
            assert token == "FAIL", f"Scenario {scenario} M{mid} returned token='{token}', expected FAIL"

    def test_direct_bash_unknown_scenario_returns_unknown(self):
        """Unknown scenario returns RC=0 and token=UNKNOWN."""
        rc, token, stderr = self._run_script(99, 1)
        assert rc == 0
        assert token == "UNKNOWN"

    def test_direct_bash_missing_arguments_errors(self):
        """Missing scenario or milestone argument causes script error (exit != 0)."""
        import subprocess
        res = subprocess.run([_BASH_EXE, self.script_path], capture_output=True, text=True)
        assert res.returncode != 0

    def test_direct_bash_scenario_01_m1_artifact_pass(self, tmp_path):
        """Scenario 01 M1: seeded history + stub ip → PASS."""
        import subprocess

        history = tmp_path / ".bash_history"
        history.write_text("nmap -sn 10.0.51.0/24\n")

        bin_dir = tmp_path / "bin"
        bin_dir.mkdir()
        stub_ip = bin_dir / "ip"
        stub_content = (
            "#!/bin/bash\n"
            "if [[ \"$*\" == *\"addr show\"* ]]; then\n"
            "  echo \"2: eth0    inet 10.0.51.100/24 brd 10.0.51.255 scope global eth0\"\n"
            "elif [[ \"$*\" == *\"route\"* ]]; then\n"
            "  echo \"10.0.51.0/24 dev eth0 proto kernel scope link src 10.0.51.100\"\n"
            "fi\n"
        )
        stub_ip.write_text(stub_content)
        subprocess.run([_BASH_EXE, "-c", f"chmod +x '{stub_ip.as_posix()}'"], check=True)

        env = {
            "HOME": tmp_path.as_posix(),
            "PATH": f"{bin_dir}{os.pathsep}{os.environ.get('PATH', '')}",
            "LOG_FILE": (tmp_path / "scoring.log").as_posix(),
        }
        rc, token, stderr = self._run_script(1, 1, env=env)
        assert rc == 0
        assert token == "PASS", f"Expected PASS, got {token}; stderr={stderr}"

    def test_direct_bash_scenario_01_empty_prefix_fails(self, tmp_path):
        """Scenario 01 M1: empty prefix logs WARN and returns FAIL."""
        import subprocess

        bin_dir = tmp_path / "bin"
        bin_dir.mkdir()
        stub_ip = bin_dir / "ip"
        stub_ip.write_text("#!/bin/bash\nexit 0\n")
        subprocess.run([_BASH_EXE, "-c", f"chmod +x '{stub_ip.as_posix()}'"], check=True)

        log_file = tmp_path / "scoring.log"
        env = {
            "HOME": tmp_path.as_posix(),
            "PATH": f"{bin_dir}{os.pathsep}{os.environ.get('PATH', '')}",
            "LOG_FILE": log_file.as_posix(),
        }
        rc, token, stderr = self._run_script(1, 1, env=env)
        assert rc == 0
        assert token == "FAIL"
        assert log_file.exists()
        log_text = log_file.read_text()
        assert "WARN: no IPv4 on eth0; scenario 1 M1-M3 will FAIL" in log_text

    def test_direct_bash_scenario_01_m4_empty_prefix_no_warn(self, tmp_path):
        """Scenario 01 M4: empty prefix does NOT log WARN (M4 doesn't use prefix)."""
        import subprocess

        bin_dir = tmp_path / "bin"
        bin_dir.mkdir()
        stub_ip = bin_dir / "ip"
        stub_ip.write_text("#!/bin/bash\nexit 0\n")
        subprocess.run([_BASH_EXE, "-c", f"chmod +x '{stub_ip.as_posix()}'"], check=True)

        log_file = tmp_path / "scoring.log"
        env = {
            "HOME": tmp_path.as_posix(),
            "PATH": f"{bin_dir}{os.pathsep}{os.environ.get('PATH', '')}",
            "LOG_FILE": log_file.as_posix(),
        }
        rc, token, stderr = self._run_script(1, 4, env=env)
        assert rc == 0
        assert token == "FAIL"
        if log_file.exists():
            log_text = log_file.read_text()
            assert "WARN: no IPv4 on eth0" not in log_text

    def _scenario_01_m4_env(self, tmp_path, pane_output, socket_output, pane_info="4100|ruby", msf_pid="4242"):
        """Build isolated live-session fixtures; production evidence paths are not read."""
        import subprocess

        bin_dir = tmp_path / "bin"
        bin_dir.mkdir()
        stub_ip = bin_dir / "ip"
        stub_ip.write_text(
            "#!/bin/bash\n"
            "echo '2: eth0    inet 10.0.51.100/24 brd 10.0.51.255 scope global eth0'\n"
        )
        subprocess.run([_BASH_EXE, "-c", f"chmod +x '{stub_ip.as_posix()}'"], check=True)

        pane_info_file = tmp_path / "pane-info.txt"
        pane_output_file = tmp_path / "pane-output.txt"
        socket_output_file = tmp_path / "socket-output.txt"
        pane_info_file.write_text(pane_info)
        pane_output_file.write_text(pane_output)
        socket_output_file.write_text(socket_output)
        return {
            "PATH": f"{bin_dir}{os.pathsep}{os.environ.get('PATH', '')}",
            "SCORING_TEST_MODE": "1",
            "SCORING_TEST_PANE_INFO_FILE": pane_info_file.as_posix(),
            "SCORING_TEST_PANE_OUTPUT_FILE": pane_output_file.as_posix(),
            "SCORING_TEST_SOCKET_OUTPUT_FILE": socket_output_file.as_posix(),
            "SCORING_TEST_MSF_PID": msf_pid,
            "SCORING_TEST_MSF_CMDLINE": "/usr/bin/ruby /usr/bin/msfconsole -q",
        }

    def test_direct_bash_scenario_01_m4_history_only_fails(self, tmp_path):
        """A failed exploit attempt/module history cannot satisfy M4."""
        history = tmp_path / ".bash_history"
        history.write_text("use exploit/multi/http/tomcat_mgr_deploy\nrun\n")
        env = self._scenario_01_m4_env(tmp_path, "", "")
        env["HOME"] = tmp_path.as_posix()
        rc, token, stderr = self._run_script(1, 4, env=env)
        assert rc == 0
        assert token == "FAIL", stderr

    @pytest.mark.parametrize(
        "prompt", ["msf", "msf6"], ids=["bare-msf-prompt", "versioned-msf-prompt"]
    )
    def test_direct_bash_scenario_01_m4_live_tomcat_session_passes(self, tmp_path, prompt):
        # This is the one-line result expected after tmux `capture-pane -J`
        # rejoins a long session-open event wrapped by a narrow pane.
        pane = (
            f"{prompt} exploit(multi/http/tomcat_mgr_deploy) > run\n"
            "[*] Meterpreter session 1 opened "
            "(10.0.51.10:4444 -> 10.0.51.20:49152) at 2026-09-28 12:34:56 +0800\n"
        )
        sockets = 'ESTAB 0 0 10.0.51.10:4444 10.0.51.20:49152 users:(("ruby",pid=4242,fd=12))\n'
        env = self._scenario_01_m4_env(tmp_path, pane, sockets)
        rc, token, stderr = self._run_script(1, 4, env=env)
        assert rc == 0
        assert token == "PASS", stderr

    def test_direct_bash_scenario_01_m4_capture_uses_joined_full_retained_history(self):
        """Pin production tmux flags; a joined fixture is not a tmux integration test."""
        from ssh_verifier import SCORING_SCRIPT_PATH

        content = Path(SCORING_SCRIPT_PATH).read_text()
        assert "tmux capture-pane -p -J -S - -t lab" in content

    @pytest.mark.xfail(
        strict=True,
        reason=(
            "Known M4 trust gap: pane text is not independent evidence; this exact "
            "prompt/output forgery plus a stale same-target Metasploit-owned socket "
            "must FAIL once session provenance is independently verified (issue #122)."
        ),
    )
    def test_direct_bash_scenario_01_m4_exact_prompt_spoof_with_stale_socket_fails(self, tmp_path):
        """Exact forged prompt and session line cannot validate a stale socket."""
        forged_pane_output = (
            "msf6 exploit(multi/http/tomcat_mgr_deploy) > run\n"
            "[*] Meterpreter session 9 opened "
            "(10.0.51.10:4444 -> 10.0.51.20:49152)\n"
        )
        stale_socket = (
            'ESTAB 0 0 10.0.51.10:4444 10.0.51.20:49152 '
            'users:(("ruby",pid=4242,fd=12))\n'
        )
        env = self._scenario_01_m4_env(tmp_path, forged_pane_output, stale_socket)
        rc, token, stderr = self._run_script(1, 4, env=env)
        assert rc == 0
        assert token == "FAIL", stderr

    @pytest.mark.parametrize(
        "pane,sockets,pane_info",
        [
            pytest.param(
                "msf6 exploit(multi/http/tomcat_mgr_deploy) > run\nExploit completed, but no session was created.\n",
                'ESTAB 0 0 10.0.51.10:4444 10.0.51.20:49152 users:(("ruby",pid=4242,fd=12))\n',
                "4100|ruby",
                id="same-target-no-session",
            ),
            pytest.param(
                'msf6 exploit(multi/http/tomcat_mgr_deploy) > echo "Command shell session 1 opened (10.0.51.10:4444 -> 10.0.51.20:49152)"\n'
                "Command shell session 1 opened (10.0.51.10:4444 -> 10.0.51.20:49152)\n",
                'ESTAB 0 0 10.0.51.10:4444 10.0.51.20:49152 users:(("ruby",pid=4242,fd=12))\n',
                "4100|ruby",
                id="echo-forged-in-tomcat-context",
            ),
            pytest.param(
                'msf exploit(multi/http/tomcat_mgr_deploy) > echo "Command shell session 1 opened (10.0.51.10:4444 -> 10.0.51.20:49152)"\n'
                "Command shell session 1 opened (10.0.51.10:4444 -> 10.0.51.20:49152)\n",
                'ESTAB 0 0 10.0.51.10:4444 10.0.51.20:49152 users:(("ruby",pid=4242,fd=12))\n',
                "4100|ruby",
                id="echo-forged-in-tomcat-context-bare-msf-prompt",
            ),
            pytest.param(
                "msf6 exploit/multi/handler > run\n[*] Meterpreter session 2 opened (10.0.51.10:4444 -> 10.0.51.20:49152)\n",
                'ESTAB 0 0 10.0.51.10:4444 10.0.51.20:49152 users:(("ruby",pid=4242,fd=12))\n',
                "4100|ruby",
                id="different-module",
            ),
            pytest.param(
                "msf6 exploit(multi/http/tomcat_mgr_deploy) > run\n[*] Meterpreter session 1 opened (10.0.51.10:4444 -> 10.0.52.20:49152)\n",
                'ESTAB 0 0 10.0.51.10:4444 10.0.52.20:49152 users:(("ruby",pid=4242,fd=12))\n',
                "4100|ruby",
                id="unrelated-target",
            ),
            pytest.param(
                "msf6 exploit(multi/http/tomcat_mgr_deploy) > run\n[*] Meterpreter session 1 opened (10.0.51.10:4444 -> 10.0.51.20:49152)\n",
                'ESTAB 0 0 10.0.51.10:4444 10.0.51.20:8180 users:(("ruby",pid=4242,fd=12))\n',
                "4100|ruby",
                id="same-target-wrong-session-port",
            ),
            pytest.param(
                "msf6 exploit(multi/http/tomcat_mgr_deploy) > run\n[*] Command shell session 3 opened (10.0.51.10:4444 -> 10.0.51.20:49152)\n",
                'ESTAB 0 0 10.0.51.10:4444 10.0.51.20:49152 users:(("nc",pid=9999,fd=3))\n',
                "4100|ruby",
                id="wrong-process-owner",
            ),
            pytest.param(
                "msf6 exploit(multi/http/tomcat_mgr_deploy) > run\n[*] Meterpreter session 1 opened (10.0.51.10:4444 -> 10.0.51.20:49152)\n",
                'ESTAB 0 0 10.0.51.10:4444 10.0.51.20:49152 users:(("ruby",pid=4242,fd=12))\n',
                "4100|bash",
                id="pane-not-metasploit",
            ),
        ],
    )
    def test_direct_bash_scenario_01_m4_rejects_uncorrelated_evidence(
        self, tmp_path, pane, sockets, pane_info
    ):
        env = self._scenario_01_m4_env(tmp_path, pane, sockets, pane_info=pane_info)
        rc, token, stderr = self._run_script(1, 4, env=env)
        assert rc == 0
        assert token == "FAIL", stderr

    def test_direct_bash_scenario_01_m4_forged_transcript_file_fails(self, tmp_path):
        """A standalone writable success string is not part of the evidence contract."""
        (tmp_path / "msfconsole.log").write_text(
            "msf6 exploit(multi/http/tomcat_mgr_deploy) > run\n"
            "[*] Meterpreter session 9 opened (10.0.51.10:4444 -> 10.0.51.20:49152)\n"
        )
        env = self._scenario_01_m4_env(tmp_path, "", "")
        env["HOME"] = tmp_path.as_posix()
        rc, token, stderr = self._run_script(1, 4, env=env)
        assert rc == 0
        assert token == "FAIL", stderr

    def test_direct_bash_scenario_11_m1_sudo_inspect_pass(self, tmp_path):
        """Scenario 11 M1: a sudo inspection of tomcat-users.xml → PASS."""
        history = tmp_path / ".bash_history"
        history.write_text("sudo cat /etc/tomcat9/tomcat-users.xml\n")
        env = {"HOME": tmp_path.as_posix()}
        rc, token, stderr = self._run_script(11, 1, env=env)
        assert rc == 0
        assert token == "PASS"

    def test_direct_bash_scenario_11_m1_plain_cat_fails(self, tmp_path):
        """Scenario 11 M1: a plain `cat` is Permission denied on the root-owned
        file, so it must NOT score — the student never saw the credential
        (regression for the false positive found in live testing)."""
        history = tmp_path / ".bash_history"
        history.write_text("cat /etc/tomcat9/tomcat-users.xml\n")
        env = {"HOME": tmp_path.as_posix()}
        rc, token, stderr = self._run_script(11, 1, env=env)
        assert rc == 0
        assert token == "FAIL"

    def test_direct_bash_scenario_09_m1_artifact_pass(self):
        """Scenario 09 M1: alert_triage.json with required fields produces PASS."""
        import subprocess
        # Create triage artifact in bash /tmp
        setup_cmd = 'mkdir -p /tmp && printf \'{"alert_id": 1, "severity": "high", "rule": 5710}\' > /tmp/alert_triage.json'
        cleanup_cmd = 'rm -f /tmp/alert_triage.json'
        try:
            subprocess.run([_BASH_EXE, "-c", setup_cmd], check=True)
            rc, token, stderr = self._run_script(9, 1)
            assert rc == 0
            assert token == "PASS"
        finally:
            subprocess.run([_BASH_EXE, "-c", cleanup_cmd])

    # A real rule-5710 SSH event at 14:32, used to validate the claimed time.
    _S09_AUTHLOG_1432 = "Oct  1 14:32:05 meta sshd[1337]: Invalid user oracle from 10.0.51.10 port 50122 ssh2\n"

    def test_direct_bash_scenario_09_m2_artifact_pass(self):
        """Scenario 09 M2: a rule ID + a time that matches a real 5710 event -> PASS."""
        import subprocess

        setup_cmd = (
            'mkdir -p /tmp && printf "# Incident Timeline\\n- 14:32 rule 5710 triggered (true_positive)\\n- phase 1 complete\\n" > /tmp/incident_timeline.md'
        )
        authlog_cmd = "mkdir -p /tmp && cat > /tmp/s9_authlog"
        cleanup_cmd = 'rm -f /tmp/incident_timeline.md /tmp/s9_authlog'
        try:
            subprocess.run([_BASH_EXE, "-c", setup_cmd], check=True)
            subprocess.run(
                [_BASH_EXE, "-c", authlog_cmd],
                input=self._S09_AUTHLOG_1432.encode("utf-8"), check=True,
            )
            rc, token, stderr = self._run_script(9, 2, env={"S9_AUTHLOG": "/tmp/s9_authlog"})
            assert rc == 0
            assert token == "PASS"
        finally:
            subprocess.run([_BASH_EXE, "-c", cleanup_cmd])

    # SIEM-SCOPE (#112): the guide's templates must not earn M2 unedited.
    # Backend scenario 09 is student-facing "Scenario 3"; the guide file was
    # renamed to scenario_03_* in SCEN-UX #116 (catalog numbering).
    _S09_GUIDE = (
        Path(__file__).resolve().parents[2]
        / "portal/public/scenarios/scenario_03_siem_alert_triage_and_log_analysis.md"
    )

    @classmethod
    def _guide_heredoc(cls, target: str) -> str:
        """Body of the guide's `cat > <target> << 'EOF'` block, as a student would paste it."""
        text = cls._S09_GUIDE.read_text(encoding="utf-8")
        start = text.index(f"cat > {target} << 'EOF'\n") + len(f"cat > {target} << 'EOF'\n")
        return text[start:text.index("\nEOF", start)] + "\n"

    def _score_s09_m2(self, files: Dict[str, str], authlog: str | None = None) -> str:
        # Write through bash, not pathlib: on Windows, Python's "/tmp" is C:\tmp
        # while Git Bash (which runs the script) has its own /tmp.
        import subprocess
        env = None
        try:
            for name, body in files.items():
                subprocess.run(
                    [_BASH_EXE, "-c", f"mkdir -p /tmp && cat > '/tmp/{name}'"],
                    input=body.encode("utf-8"), check=True,
                )
            if authlog is not None:
                subprocess.run(
                    [_BASH_EXE, "-c", "mkdir -p /tmp && cat > /tmp/s9_authlog"],
                    input=authlog.encode("utf-8"), check=True,
                )
                env = {"S9_AUTHLOG": "/tmp/s9_authlog"}
            rc, token, stderr = self._run_script(9, 2, env=env)
            assert rc == 0, stderr
            return token
        finally:
            rm = " ".join(f"'/tmp/{name}'" for name in files)
            subprocess.run([_BASH_EXE, "-c", f"rm -f {rm} /tmp/s9_authlog"])

    def test_direct_bash_scenario_09_m2_guide_timeline_template_fails(self):
        template = self._guide_heredoc("/home/msfadmin/incident_timeline.md")
        assert "HH:MM" in template  # guard: the test reads the real template
        assert self._score_s09_m2({"incident_timeline.md": template}) == "FAIL"

    def test_direct_bash_scenario_09_m2_filled_in_guide_timeline_passes(self):
        filled = self._guide_heredoc("/home/msfadmin/incident_timeline.md").replace("HH:MM", "14:32")
        assert self._score_s09_m2(
            {"incident_timeline.md": filled}, authlog=self._S09_AUTHLOG_1432
        ) == "PASS"

    def test_direct_bash_scenario_09_m2_wrong_time_fails(self):
        """A well-formed but incorrect time (no matching 5710 event) must FAIL."""
        filled = self._guide_heredoc("/home/msfadmin/incident_timeline.md").replace("HH:MM", "00:00")
        assert self._score_s09_m2(
            {"incident_timeline.md": filled}, authlog=self._S09_AUTHLOG_1432
        ) == "FAIL"

    def test_direct_bash_scenario_09_m2_timeline_without_time_fails(self):
        body = "# Incident timeline\n1. phase: initial_access_attempt - rule: 5710 - true_positive\n"
        assert self._score_s09_m2({"incident_timeline.md": body}) == "FAIL"

    def test_direct_bash_scenario_09_m2_triage_template_marked_tp_fails(self):
        """Only flipping classification in the unedited M1 template is not triage."""
        template = self._guide_heredoc("/home/msfadmin/alert_triage.json")
        flipped = template.replace("needs_investigation", "true_positive")
        assert flipped != template
        assert self._score_s09_m2({"alert_triage.json": flipped}) == "FAIL"

    def test_direct_bash_scenario_09_m2_real_triage_tp_passes(self):
        triage = json.dumps({
            "alert_id": "1727346720.51234",
            "severity": "medium",
            "rule": "5710",
            "agent": "pod-alice-meta",
            "classification": "true_positive",
            "notes": "14:32 failed SSH for nosuchuser from Kali",
        })
        assert self._score_s09_m2({"alert_triage.json": triage}) == "PASS"

    def _write_history(self, text: str) -> None:
        (self.default_home / ".bash_history").write_text(text, encoding="utf-8")

    def test_direct_bash_scenario_06_m2_artifact_pass(self, tmp_path):
        """Scenario 06 M2: username:32-hex file produces PASS."""
        artifact = tmp_path / "sqli_users.txt"
        artifact.write_text("admin:5f4dcc3b5aa765d61d8327deb882cf99\n", encoding="utf-8")
        rc, token, stderr = self._run_script(
            6, 2, env={"SQLI_USERS_FILE": artifact.as_posix()}
        )
        assert rc == 0
        assert token == "PASS"

    def test_direct_bash_scenario_06_m3_artifact_pass(self, tmp_path):
        """Scenario 06 M3: real sqlmap history plus 32-hex hash file produces PASS."""
        artifact = tmp_path / "admin_hash.txt"
        artifact.write_text("e10adc3949ba59abbe56e057f20f883e\n", encoding="utf-8")
        self._write_history(
            'sqlmap -u "http://$TARGET_DVWA/dvwa/vulnerabilities/sqli/?id=1&Submit=Submit" '
            '--cookie="PHPSESSID=abc123def456; security=low" -D dvwa -T users --dump --batch\n'
        )
        rc, token, stderr = self._run_script(
            6, 3, env={"ADMIN_HASH_FILE": artifact.as_posix()}
        )
        assert rc == 0
        assert token == "PASS"

    def test_scenario_06_m1_guide_echo_is_fail(self):
        self._write_history("echo \"manual sqli probe: 1' OR '1'='1 against DVWA\"\n")
        rc, token, _ = self._run_script(6, 1)
        assert rc == 0
        assert token == "FAIL"

    def test_scenario_06_m1_real_curl_is_pass(self):
        self._write_history(
            "curl -s -b 'PHPSESSID=abc123def456; security=low' "
            "\"http://10.0.51.12/dvwa/vulnerabilities/sqli/?id=1'+OR+'1'='1&Submit=Submit\"\n"
        )
        rc, token, _ = self._run_script(6, 1)
        assert rc == 0
        assert token == "PASS"

    def test_scenario_06_m1_quote_only_curl_with_target_env_is_pass(self):
        """Canonical 1' probe. $TARGET_DVWA stays literal in history and must still PASS."""
        self._write_history(
            "curl -s -b 'PHPSESSID=abc123def456; security=low' "
            "\"http://$TARGET_DVWA/dvwa/vulnerabilities/sqli/?id=1%27&Submit=Submit\"\n"
        )
        rc, token, _ = self._run_script(6, 1)
        assert rc == 0
        assert token == "PASS"

    def test_scenario_06_m1_mixed_case_or_is_pass(self):
        self._write_history(
            "curl -s \"http://10.0.51.12/dvwa/vulnerabilities/sqli/?id=1'+Or+'1'='1&Submit=Submit\"\n"
        )
        rc, token, _ = self._run_script(6, 1)
        assert rc == 0
        assert token == "PASS"

    def test_scenario_06_m1_plain_quoted_url_without_injection_is_fail(self):
        """Finding 3: shell apostrophes around a plain id=1 URL must not PASS."""
        self._write_history(
            "curl -s 'http://$TARGET_DVWA/dvwa/vulnerabilities/sqli/?id=1&Submit=Submit'\n"
        )
        rc, token, _ = self._run_script(6, 1)
        assert rc == 0
        assert token == "FAIL"

    def test_scenario_06_m1_plain_id_ending_at_shell_quote_is_fail(self):
        """Finding 8: curl '...?id=1' must FAIL (closing quote is not injection)."""
        self._write_history(
            "curl -s 'http://$TARGET_DVWA/dvwa/vulnerabilities/sqli/?id=1'\n"
        )
        rc, token, _ = self._run_script(6, 1)
        assert rc == 0
        assert token == "FAIL"

    def test_scenario_06_m1_zsh_extended_history_echo_is_fail(self):
        """Finding 4: zsh EXTENDED_HISTORY echo paste must FAIL."""
        self._write_history(
            ": 1700000000:0;echo \"manual sqli probe: 1' OR '1'='1 against DVWA\"\n"
        )
        rc, token, _ = self._run_script(6, 1)
        assert rc == 0
        assert token == "FAIL"

    def test_scenario_06_m1_leading_whitespace_echo_is_fail(self):
        self._write_history("   echo \"1' OR '1'='1\"\n")
        rc, token, _ = self._run_script(6, 1)
        assert rc == 0
        assert token == "FAIL"

    def test_scenario_06_m1_printf_guide_line_is_fail(self):
        self._write_history("printf '%s\\n' \"1' OR '1'='1\"\n")
        rc, token, _ = self._run_script(6, 1)
        assert rc == 0
        assert token == "FAIL"

    def test_scenario_06_m1_chained_echo_is_fail(self):
        self._write_history("true; echo \"1' OR '1'='1 against DVWA\"\n")
        rc, token, _ = self._run_script(6, 1)
        assert rc == 0
        assert token == "FAIL"

    def test_scenario_06_m3_snoopy_sqlmap_with_hash_is_pass(self, tmp_path):
        """Finding 5: Snoopy evidence counts when interactive history is empty."""
        snoopy = tmp_path / "auth.log"
        snoopy.write_text(
            "snoopy[123]: cmdline: sqlmap -u http://10.0.51.12/dvwa/vulnerabilities/sqli/"
            "?id=1 --cookie=PHPSESSID=abc123def456 -D dvwa -T users --dump --batch\n",
            encoding="utf-8",
        )
        artifact = tmp_path / "admin_hash.txt"
        artifact.write_text("5f4dcc3b5aa765d61d8327deb882cf99\n", encoding="utf-8")
        self._write_history("")
        rc, token, _ = self._run_script(
            6,
            3,
            env={
                "ADMIN_HASH_FILE": artifact.as_posix(),
                "SNOOPY_LOG_FILE": snoopy.as_posix(),
            },
        )
        assert rc == 0
        assert token == "PASS"

    def test_scenario_06_m1_syntax_error_artifact_is_pass(self, tmp_path):
        artifact = tmp_path / "sqli_probe.txt"
        artifact.write_text("You have an error in your SQL syntax\n", encoding="utf-8")
        rc, token, _ = self._run_script(6, 1, env={"SQLI_PROBE_FILE": artifact.as_posix()})
        assert rc == 0
        assert token == "PASS"

    def test_scenario_06_m2_union_echo_history_is_fail(self):
        self._write_history(
            "echo \"UNION SELECT user, password FROM users\" >> /tmp/sqli_users.txt\n"
        )
        rc, token, _ = self._run_script(6, 2)
        assert rc == 0
        assert token == "FAIL"

    def test_scenario_06_m2_placeholder_file_is_fail(self, tmp_path):
        artifact = tmp_path / "sqli_users.txt"
        artifact.write_text("UNION SELECT user, password FROM users\n", encoding="utf-8")
        rc, token, _ = self._run_script(6, 2, env={"SQLI_USERS_FILE": artifact.as_posix()})
        assert rc == 0
        assert token == "FAIL"

    def test_scenario_06_m2_real_rows_file_is_pass(self, tmp_path):
        artifact = tmp_path / "sqli_users.txt"
        artifact.write_text("admin:5f4dcc3b5aa765d61d8327deb882cf99\n", encoding="utf-8")
        rc, token, _ = self._run_script(6, 2, env={"SQLI_USERS_FILE": artifact.as_posix()})
        assert rc == 0
        assert token == "PASS"

    def test_scenario_06_m3_placeholder_sqlmap_is_fail(self):
        """Angle-bracket cookie fails. $TARGET_DVWA in the same line is not the reason."""
        self._write_history(
            'sqlmap -u "http://$TARGET_DVWA/dvwa/vulnerabilities/sqli/?id=1&Submit=Submit" '
            '--cookie="PHPSESSID=<session_id>; security=low" -D dvwa -T users --dump --batch\n'
        )
        rc, token, _ = self._run_script(6, 3)
        assert rc == 0
        assert token == "FAIL"

    def test_scenario_06_m3_placeholder_hash_file_is_fail(self, tmp_path):
        artifact = tmp_path / "admin_hash.txt"
        artifact.write_text("<admin_hash_here>\n", encoding="utf-8")
        self._write_history(
            'sqlmap -u "http://$TARGET_DVWA/dvwa/vulnerabilities/sqli/?id=1" '
            '--cookie="PHPSESSID=abc123def456; security=low" -D dvwa -T users --dump --batch\n'
        )
        rc, token, _ = self._run_script(6, 3, env={"ADMIN_HASH_FILE": artifact.as_posix()})
        assert rc == 0
        assert token == "FAIL"

    def test_scenario_06_m3_real_hash_file_is_pass(self, tmp_path):
        artifact = tmp_path / "admin_hash.txt"
        artifact.write_text("5f4dcc3b5aa765d61d8327deb882cf99\n", encoding="utf-8")
        self._write_history(
            'sqlmap -u "http://$TARGET_DVWA/dvwa/vulnerabilities/sqli/?id=1&Submit=Submit" '
            '--cookie="PHPSESSID=abc123def456; security=low" -D dvwa -T users --dump --batch\n'
        )
        rc, token, _ = self._run_script(6, 3, env={"ADMIN_HASH_FILE": artifact.as_posix()})
        assert rc == 0
        assert token == "PASS"

    def test_scenario_06_check_ignores_sqlmap_output_file(self):
        """Decision: /tmp/sqlmap_output.txt is not an M3 pass path."""
        from ssh_verifier import SCORING_SCRIPT_PATH
        content = Path(SCORING_SCRIPT_PATH).read_text(encoding="utf-8")
        start = content.index("check_scenario_6()")
        end = content.index("check_scenario_7")
        assert "sqlmap_output.txt" not in content[start:end]

    def test_direct_bash_scenario_06_m4_history_pass(self, tmp_path):
        """Scenario 06 M4: seeded bash history with curl XSS payload produces PASS."""
        history = tmp_path / ".bash_history"
        history.write_text("curl -s 'http://10.0.51.20/dvwa/vulnerabilities/xss_r/?name=<script>alert(1)</script>&Submit=Submit'\n")
        env = {"HOME": tmp_path.as_posix()}
        rc, token, stderr = self._run_script(6, 4, env=env)
        assert rc == 0
        assert token == "PASS"

    def test_direct_bash_scenario_06_m4_artifact_pass(self):
        """Scenario 06 M4: /tmp/xss_reflected.txt artifact containing reflection produces PASS."""
        import subprocess
        setup_cmd = 'mkdir -p /tmp && printf \'<pre>Hello <script>alert("XSS")</script></pre>\\n\' > /tmp/xss_reflected.txt'
        cleanup_cmd = 'rm -f /tmp/xss_reflected.txt'
        try:
            subprocess.run([_BASH_EXE, "-c", setup_cmd], check=True)
            rc, token, stderr = self._run_script(6, 4)
            assert rc == 0
            assert token == "PASS"
        finally:
            subprocess.run([_BASH_EXE, "-c", cleanup_cmd])

    def test_direct_bash_scenario_06_m4_payload_artifact_pass(self):
        """Scenario 06 M4: /tmp/xss_payload.txt artifact containing reflection produces PASS."""
        import subprocess
        setup_cmd = 'mkdir -p /tmp && printf \'Hello <script>alert(document.cookie)</script>\\n\' > /tmp/xss_payload.txt'
        cleanup_cmd = 'rm -f /tmp/xss_payload.txt'
        try:
            subprocess.run([_BASH_EXE, "-c", setup_cmd], check=True)
            rc, token, stderr = self._run_script(6, 4)
            assert rc == 0
            assert token == "PASS"
        finally:
            subprocess.run([_BASH_EXE, "-c", cleanup_cmd])

    def test_direct_bash_scenario_06_m4_empty_artifact_fails(self):
        """Scenario 06 M4: 0-byte artifact file produces FAIL (size guard)."""
        import subprocess
        setup_cmd = 'mkdir -p /tmp && touch /tmp/xss_reflected.txt'
        cleanup_cmd = 'rm -f /tmp/xss_reflected.txt'
        try:
            subprocess.run([_BASH_EXE, "-c", setup_cmd], check=True)
            rc, token, stderr = self._run_script(6, 4)
            assert rc == 0
            assert token == "FAIL"
        finally:
            subprocess.run([_BASH_EXE, "-c", cleanup_cmd])

    def test_direct_bash_scenario_06_m4_echo_payload_fails_history(self, tmp_path):
        """Scenario 06 M4 negative: bare echo payload does NOT pass without curl targeting xss_r."""
        history = tmp_path / ".bash_history"
        history.write_text("echo \"<script>alert('XSS')</script>\"\n")
        env = {"HOME": tmp_path.as_posix()}
        rc, token, stderr = self._run_script(6, 4, env=env)
        assert rc == 0
        assert token == "FAIL"

    def test_direct_bash_scenario_06_m4_curl_without_payload_fails_history(self, tmp_path):
        """Scenario 06 M4 negative: curl targeting xss_r without script payload does NOT pass."""
        history = tmp_path / ".bash_history"
        history.write_text("curl -sI http://10.0.51.20/dvwa/vulnerabilities/xss_r/\n")
        env = {"HOME": tmp_path.as_posix()}
        rc, token, stderr = self._run_script(6, 4, env=env)
        assert rc == 0
        assert token == "FAIL"

    def test_direct_bash_scenario_06_m4_unrelated_alert_grep_fails_history(self, tmp_path):
        """Scenario 06 M4 negative: unrelated alert grep does NOT pass."""
        history = tmp_path / ".bash_history"
        history.write_text("grep 'alert(1)' notes.txt\n")
        env = {"HOME": tmp_path.as_posix()}
        rc, token, stderr = self._run_script(6, 4, env=env)
        assert rc == 0
        assert token == "FAIL"

    def test_direct_bash_scenario_06_m4_artifact_without_reflection_fails(self):
        """Scenario 06 M4 negative: artifact lacking DVWA reflection string fails."""
        import subprocess
        setup_cmd = 'mkdir -p /tmp && printf \'echo x > /tmp/xss_proof.txt\\n\' > /tmp/xss_proof.txt'
        cleanup_cmd = 'rm -f /tmp/xss_proof.txt'
        try:
            subprocess.run([_BASH_EXE, "-c", setup_cmd], check=True)
            rc, token, stderr = self._run_script(6, 4)
            assert rc == 0
            assert token == "FAIL"
        finally:
            subprocess.run([_BASH_EXE, "-c", cleanup_cmd])

    def test_direct_bash_scenario_06_m1_artifact_pass(self):
        """Scenario 06 M1: /tmp/sqli_probe.txt containing SQL error produces PASS."""
        import subprocess
        setup_cmd = 'mkdir -p /tmp && printf \'You have an error in your SQL syntax near 1\\n\' > /tmp/sqli_probe.txt'
        cleanup_cmd = 'rm -f /tmp/sqli_probe.txt'
        try:
            subprocess.run([_BASH_EXE, "-c", setup_cmd], check=True)
            rc, token, stderr = self._run_script(6, 1)
            assert rc == 0
            assert token == "PASS"
        finally:
            subprocess.run([_BASH_EXE, "-c", cleanup_cmd])

    def test_direct_bash_scenario_06_sqli_evidence_fails_m4(self):
        """Scenario 06 M4: SQLi artifacts/history do NOT satisfy Milestone 4 (no collision)."""
        import subprocess
        setup_cmd = 'mkdir -p /tmp && printf \'admin:password123\\n\' > /tmp/sqli_users.txt'
        cleanup_cmd = 'rm -f /tmp/sqli_users.txt'
        try:
            subprocess.run([_BASH_EXE, "-c", setup_cmd], check=True)
            rc, token, stderr = self._run_script(6, 4)
            assert rc == 0
            assert token == "FAIL"
        finally:
            subprocess.run([_BASH_EXE, "-c", cleanup_cmd])

    def test_direct_bash_scenario_06_xss_evidence_fails_m1_m2_m3(self):
        """Scenario 06 M1-M3: XSS artifacts do NOT satisfy Milestones 1, 2, or 3 (no collision)."""
        import subprocess
        setup_cmd = 'mkdir -p /tmp && printf \'Hello <script>alert(1)</script>\\n\' > /tmp/xss_reflected.txt'
        cleanup_cmd = 'rm -f /tmp/xss_reflected.txt'
        try:
            subprocess.run([_BASH_EXE, "-c", setup_cmd], check=True)
            for mid in (1, 2, 3):
                rc, token, stderr = self._run_script(6, mid)
                assert rc == 0
                assert token == "FAIL"
        finally:
            subprocess.run([_BASH_EXE, "-c", cleanup_cmd])


# ============================================================================
# Helper: async result wrapper for inline verifiers
# ============================================================================
async def _async_result(status: str):
    return status, f"Behavioral check: {status}"
