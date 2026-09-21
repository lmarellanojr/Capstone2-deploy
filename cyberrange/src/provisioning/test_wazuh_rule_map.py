"""Unit and integration tests for wazuh_rule_map.py.

Verifies:
1. Retargeting to portal catalog IDs (01, 06, 09, 11).
2. Resolution of Scenario 09 M1 detection rule (sshd brute force / rule 5710 on meta).
3. Backward compatibility for integer keys and unlisted backend scenarios (4, 1) and (8, 1).
4. Explicit deferral of Apache web rules (Scenario 06).
5. Exposure of only live portal catalog IDs in get_live_catalog_scenarios() and get_live_catalog_rules().
6. Advisory nature of detection_score in verify_milestone (does not gate pass/fail).
"""
import json
import sqlite3
from pathlib import Path
from types import ModuleType
import sys
import pytest

# Ensure pylxd mock is present if running outside LXD environment
if "pylxd" not in sys.modules:
    _pylxd = ModuleType("pylxd")
    _exc = ModuleType("pylxd.exceptions")
    _exc.NotFound = type("NotFound", (Exception,), {})
    _pylxd.exceptions = _exc
    _pylxd.Client = object
    sys.modules["pylxd"] = _pylxd
    sys.modules["pylxd.exceptions"] = _exc

import db
import migrate
from scoring import verify_milestone
from wazuh_rule_map import (
    DETECTION_RULES,
    LIVE_CATALOG_SCENARIOS,
    PORTAL_CATALOG_SCENARIOS,
    detection_for,
    get_live_catalog_rules,
    get_live_catalog_scenarios,
)


class TestCatalogScenariosExposure:
    """Validate that only live catalog IDs are exposed."""

    def test_live_catalog_scenarios_tuple(self):
        expected = ("01", "06", "09", "11")
        assert get_live_catalog_scenarios() == expected
        assert LIVE_CATALOG_SCENARIOS == expected
        assert PORTAL_CATALOG_SCENARIOS == expected

    def test_unlisted_backend_scenarios_not_in_live_catalog(self):
        live = get_live_catalog_scenarios()
        assert "4" not in live
        assert "04" not in live
        assert "8" not in live
        assert "08" not in live
        assert 4 not in live
        assert 8 not in live

    def test_get_live_catalog_rules_only_exposes_live_ids(self):
        live_rules = get_live_catalog_rules()
        for (sid, mid), rule in live_rules.items():
            assert sid in LIVE_CATALOG_SCENARIOS
            assert sid not in ("04", "4", "08", "8")
        # Scenario 09 M1 is live and mapped
        assert ("09", 1) in live_rules
        assert live_rules[("09", 1)]["rule_id"] == "5710"
        assert live_rules[("09", 1)]["role"] == "meta"


class TestDetectionRuleLookup:
    """Validate detection_for normalization and rule retrieval."""

    def test_scenario_09_m1_lookup_variants(self):
        expected = {"role": "meta", "rule_id": "5710"}
        assert detection_for("09", 1) == expected
        assert detection_for(9, 1) == expected
        assert detection_for("9", 1) == expected
        assert detection_for("09", "1") == expected
        assert detection_for(9, "1") == expected
        assert detection_for(" 09 ", 1) == expected

    def test_scenario_09_other_milestones_return_none(self):
        assert detection_for("09", 2) is None
        assert detection_for("09", 3) is None
        assert detection_for(9, 2) is None

    def test_attacker_scenario_01_returns_none(self):
        for m in (1, 2, 3, 4):
            assert detection_for("01", m) is None
            assert detection_for(1, m) is None

    def test_apache_web_rules_scenario_06_explicitly_deferred(self):
        for m in (1, 2, 3):
            assert detection_for("06", m) is None
            assert detection_for(6, m) is None

    def test_defensive_scenario_11_returns_none(self):
        for m in (1, 2, 3):
            assert detection_for("11", m) is None
            assert detection_for(11, m) is None

    def test_unlisted_backend_scenario_04_supported(self):
        expected = {"role": "meta", "rule_id": "5715"}
        assert detection_for(4, 1) == expected
        assert detection_for("04", 1) == expected
        assert detection_for("4", 1) == expected

    def test_unlisted_backend_scenario_08_supported(self):
        expected = {"role": "meta", "rule_id": "5902"}
        assert detection_for(8, 1) == expected
        assert detection_for("08", 1) == expected
        assert detection_for("8", 1) == expected

    def test_invalid_and_out_of_bounds_inputs(self):
        assert detection_for(None, 1) is None
        assert detection_for("invalid", 1) is None
        assert detection_for("", 1) is None
        assert detection_for("09", None) is None
        assert detection_for("09", "invalid") is None
        assert detection_for(-1, 1) is None
        assert detection_for(999, 1) is None


@pytest.fixture
def scoring_db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    db_path = tmp_path / "test_scoring.db"
    migrate.apply(str(db_path))
    monkeypatch.setattr(db, "DB_PATH", str(db_path))
    return db_path


class DummyPassingVerifier:
    async def verify_milestone(self, student_id: str, scenario_id: int, milestone_id: int):
        return "PASS", "Behavioral check passed"


class DummyFailingVerifier:
    async def verify_milestone(self, student_id: str, scenario_id: int, milestone_id: int):
        return "FAIL", "Behavioral check failed"


class TestDetectionScoreAdvisoryInvariant:
    """Ensure detection_score remains strictly advisory and does not gate pass/fail."""

    @pytest.mark.anyio
    async def test_pass_with_detection_alert_found(self, scoring_db: Path):
        pod = {
            "pod_id": 101,
            "student_id": "alice",
            "wazuh_agent_id": json.dumps({"meta": "005"}),
        }
        res = await verify_milestone(
            pod=pod,
            scenario_id=9,
            milestone_id=1,
            scoring_enabled=True,
            ssh_verifier_cls=DummyPassingVerifier,
            detection_enabled=True,
            detection_for=detection_for,
            verify_siem_alert=lambda aid, rule_id, since_minutes: True,
        )
        assert res.status == "PASS"
        assert res.detection_score == 1

    @pytest.mark.anyio
    async def test_pass_without_detection_alert_still_passes(self, scoring_db: Path):
        """Even if SIEM alert is missing (score=0), milestone status remains PASS."""
        pod = {
            "pod_id": 102,
            "student_id": "alice",
            "wazuh_agent_id": json.dumps({"meta": "005"}),
        }
        res = await verify_milestone(
            pod=pod,
            scenario_id=9,
            milestone_id=1,
            scoring_enabled=True,
            ssh_verifier_cls=DummyPassingVerifier,
            detection_enabled=True,
            detection_for=detection_for,
            verify_siem_alert=lambda aid, rule_id, since_minutes: False,
        )
        assert res.status == "PASS"
        assert res.detection_score == 0

    @pytest.mark.anyio
    async def test_fail_with_detection_alert_still_fails(self, scoring_db: Path):
        """Even if SIEM alert is detected (score=1), behavioral failure keeps status FAIL."""
        pod = {
            "pod_id": 103,
            "student_id": "bob",
            "wazuh_agent_id": json.dumps({"meta": "005"}),
        }
        res = await verify_milestone(
            pod=pod,
            scenario_id=9,
            milestone_id=1,
            scoring_enabled=True,
            ssh_verifier_cls=DummyFailingVerifier,
            detection_enabled=True,
            detection_for=detection_for,
            verify_siem_alert=lambda aid, rule_id, since_minutes: True,
        )
        assert res.status == "FAIL"
        assert res.detection_score == 1
