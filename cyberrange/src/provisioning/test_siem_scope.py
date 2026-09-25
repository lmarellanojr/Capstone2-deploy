"""SIEM-SCOPE (#112): Scenario 09 alerts and detection are limited to the current pod.

Agent names (pod-<student>-meta) are reused when a student re-provisions, so
alerts must be cut off at pods.created_at, not just at since_minutes.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

import alerts_endpoint as ae
import alerts_reader
import db
import score_verifier
from auth import verify_token
from provision_api_fastapi import app
from scoring import verify_milestone
from ttl import minutes_since_created
from wazuh_rule_map import detection_for


def _wazuh_ts(dt: datetime) -> str:
    # Wazuh writes "2026-09-26T10:00:00.000+0000" (no colon in the offset).
    return dt.strftime("%Y-%m-%dT%H:%M:%S.000+0000")


def _sqlite_ts(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d %H:%M:%S")


def _alert(dt: datetime, agent_id: str, agent_name: str, rule_id: str = "5710") -> bytes:
    return json.dumps({
        "timestamp": _wazuh_ts(dt),
        "agent": {"id": agent_id, "name": agent_name},
        "rule": {"id": rule_id, "level": 5, "description": "sshd: attempt to login using a non-existent user"},
    }).encode()


# ── ttl.minutes_since_created ────────────────────────────────────────────────

class TestMinutesSinceCreated:
    NOW = datetime(2026, 9, 26, 12, 0, 0, tzinfo=timezone.utc)

    def test_rounds_up_partial_minute(self):
        assert minutes_since_created("2026-09-26 11:49:30", 480, self.NOW) == 11

    def test_capped_at_ttl_window(self):
        assert minutes_since_created("2026-09-25 12:00:00", 480, self.NOW) == 480

    def test_missing_or_junk_created_at_falls_back_to_cap(self):
        assert minutes_since_created(None, 480, self.NOW) == 480
        assert minutes_since_created("not-a-date", 480, self.NOW) == 480

    def test_clock_skew_never_below_one_minute(self):
        assert minutes_since_created("2026-09-26 12:05:00", 480, self.NOW) == 1


# ── alerts_reader.list_siem_alerts(not_before=...) ──────────────────────────

class TestListSiemAlertsNotBefore:
    def test_alert_before_pod_creation_is_excluded(self):
        now = datetime.now(timezone.utc)
        created = now - timedelta(minutes=10)
        raw = b"\n".join([
            _alert(now - timedelta(minutes=60), "007", "pod-alice-meta"),  # previous pod
            _alert(now - timedelta(minutes=5), "012", "pod-alice-meta"),   # this pod
        ])
        page = alerts_reader.list_siem_alerts(
            ["012"], agent_names=["pod-alice-meta"], since_minutes=240,
            not_before=created, raw=raw,
        )
        assert [a["agent_id"] for a in page.alerts] == ["012"]
        assert page.total_count == 1

    def test_without_not_before_name_match_keeps_old_alert(self):
        """Documents the pre-SIEM-SCOPE behaviour the cutoff exists to stop."""
        now = datetime.now(timezone.utc)
        raw = _alert(now - timedelta(minutes=60), "007", "pod-alice-meta")
        page = alerts_reader.list_siem_alerts(
            ["012"], agent_names=["pod-alice-meta"], since_minutes=240, raw=raw,
        )
        assert page.total_count == 1

    def test_since_minutes_still_applies_when_pod_is_older(self):
        now = datetime.now(timezone.utc)
        raw = _alert(now - timedelta(minutes=90), "012", "pod-alice-meta")
        page = alerts_reader.list_siem_alerts(
            ["012"], since_minutes=60,
            not_before=now - timedelta(hours=5), raw=raw,
        )
        assert page.total_count == 0


# ── GET /pods/{pod_id}/alerts end to end ────────────────────────────────────

def _insert_active_pod(pod_id: int, student: str, created: datetime, agents: dict) -> None:
    conn = db.get_db_connection()
    conn.execute(
        "INSERT INTO pods (pod_id, student_id, scenario_id, status, wazuh_agent_id, created_at) "
        "VALUES (?, ?, '09', 'ACTIVE', ?, ?)",
        (pod_id, student, json.dumps(agents), _sqlite_ts(created)),
    )
    conn.commit()
    conn.close()


class TestAlertsEndpointPodScope:
    @pytest.fixture
    def client(self):
        claims = {"preferred_username": "student1", "realm_access": {"roles": ["student"]}}
        app.dependency_overrides[verify_token] = lambda: claims
        app.dependency_overrides[ae.verify_token_dep] = lambda: claims
        return TestClient(app)

    def test_fresh_pod_hides_previous_pods_alerts(self, client, monkeypatch):
        now = datetime.now(timezone.utc)
        _insert_active_pod(1, "student1", now - timedelta(minutes=10), {"meta": "012"})
        raw = b"\n".join([
            _alert(now - timedelta(minutes=45), "007", "pod-student1-meta"),         # old pod, 5710
            _alert(now - timedelta(minutes=30), "007", "pod-student1-meta", "510"),  # old pod, rootcheck
            _alert(now - timedelta(minutes=2), "012", "pod-student1-meta"),          # this pod
        ])
        monkeypatch.setattr(alerts_reader, "_read_manager_tail", lambda: (raw, False))

        res = client.get("/pods/1/alerts")

        assert res.status_code == 200
        body = res.json()
        assert body["total_count"] == 1
        assert [(a["agent_id"], a["rule_id"]) for a in body["alerts"]] == [("012", "5710")]

    def test_brand_new_pod_starts_empty(self, client, monkeypatch):
        now = datetime.now(timezone.utc)
        _insert_active_pod(1, "student1", now, {"meta": "012"})
        raw = _alert(now - timedelta(minutes=3), "007", "pod-student1-meta")
        monkeypatch.setattr(alerts_reader, "_read_manager_tail", lambda: (raw, False))

        body = client.get("/pods/1/alerts").json()

        assert body["alerts"] == []
        assert body["total_count"] == 0


# ── scoring.verify_milestone detection window ───────────────────────────────

class _PassVerifier:
    async def verify_milestone(self, student_id, scenario_id, milestone_id):
        return "PASS", "ok"


class TestDetectionWindowPodScope:
    async def _run(self, pod: dict) -> list[int]:
        seen: list[int] = []

        def fake_siem(aid, rule_id, since_minutes):
            seen.append(since_minutes)
            return True

        await verify_milestone(
            pod, 9, 1,
            scoring_enabled=True,
            ssh_verifier_cls=_PassVerifier,
            detection_enabled=True,
            detection_for=detection_for,
            verify_siem_alert=fake_siem,
        )
        return seen

    @pytest.mark.anyio
    async def test_window_is_pod_age_not_full_ttl(self):
        created = datetime.now(timezone.utc) - timedelta(minutes=10)
        pod = {
            "pod_id": 201, "student_id": "alice",
            "wazuh_agent_id": json.dumps({"meta": "012"}),
            "created_at": _sqlite_ts(created),
        }
        assert await self._run(pod) in ([10], [11])

    @pytest.mark.anyio
    async def test_missing_created_at_keeps_ttl_window(self, monkeypatch):
        monkeypatch.setattr("scoring.POD_TTL_HOURS", 8)
        pod = {"pod_id": 202, "student_id": "alice", "wazuh_agent_id": json.dumps({"meta": "012"})}
        assert await self._run(pod) == [480]


# ── score_verifier.verify_siem_alert reads the newest bytes ─────────────────

class _FakeFiles:
    def __init__(self, data: bytes, chunk: int):
        self._data, self._chunk = data, chunk

    def get(self, params, stream):
        data, size = self._data, self._chunk

        class _Res:
            def iter_content(self, chunk_size):
                for i in range(0, len(data), size):
                    yield data[i:i + size]
        return _Res()


def _fake_client(data: bytes, chunk: int = 64):
    files = _FakeFiles(data, chunk)

    class _Inst:
        pass

    inst = _Inst()
    inst.files = files

    class _Instances(dict):
        def __missing__(self, key):
            return inst

    class _Api:
        instances = _Instances()

    class _Client:
        def __init__(self, project=None):
            self.api = _Api()
    return _Client


class TestVerifySiemAlertTail:
    def test_finds_newest_alert_past_the_byte_cap(self, monkeypatch):
        now = datetime.now(timezone.utc)
        filler = b"\n".join(
            _alert(now - timedelta(minutes=30), "099", "other", "19007") for _ in range(20)
        )
        newest = _alert(now - timedelta(minutes=1), "012", "pod-alice-meta")
        data = filler + b"\n" + newest + b"\n"
        # Cap well below the file size: the old head-first read stopped at the
        # cap and never reached the 5710 at the end.
        monkeypatch.setattr(score_verifier, "_ALERTS_MAX_BYTES", len(newest) * 3)
        monkeypatch.setattr(score_verifier.pylxd, "Client", _fake_client(data))

        assert score_verifier.verify_siem_alert("012", "5710", since_minutes=10) is True

    def test_alert_outside_window_is_not_counted(self, monkeypatch):
        now = datetime.now(timezone.utc)
        data = _alert(now - timedelta(minutes=30), "012", "pod-alice-meta") + b"\n"
        monkeypatch.setattr(score_verifier.pylxd, "Client", _fake_client(data))

        assert score_verifier.verify_siem_alert("012", "5710", since_minutes=10) is False
