"""Instructor SIEM history: lab windows, the daily-archive reader, and the
alert snapshot frozen with each report. Role boundaries for the new routes are
in test_sec01_rbac_matrix.py."""
from __future__ import annotations

import gzip
import json
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

import alerts_endpoint as ae
import alerts_reader
import db
import lab_history
from alerts_reader import ManagerUnavailable, archive_paths, list_siem_alerts_between
from auth import verify_token
from provision import finalize_destroyed_pod
from provision_api_fastapi import app

UTC = timezone.utc


def _ts(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%S.000+0000")


def _sql(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d %H:%M:%S")


def _alert(dt, name, rule="5710", agent_id="012"):
    return json.dumps({
        "timestamp": _ts(dt),
        "agent": {"id": agent_id, "name": name},
        "rule": {"id": rule, "level": 5, "description": "sshd: attempt to login using a non-existent user"},
        "full_log": "never returned",
    }).encode()


def _archive(files: dict):
    """read_file stub: {path: bytes}; .json.gz entries are gzipped here."""
    def read(path):
        data = files.get(path)
        if data is None:
            return None
        return gzip.compress(data) if path.endswith(".gz") else data
    return read


# ── alerts_reader.list_siem_alerts_between ──────────────────────────────────

class TestArchiveReader:
    START = datetime(2026, 9, 28, 23, 0, tzinfo=UTC)
    END = datetime(2026, 9, 29, 2, 0, tzinfo=UTC)

    def test_reads_across_midnight_and_keeps_only_the_window(self):
        d28_gz, _ = archive_paths(self.START.date())
        _, d29_plain = archive_paths(self.END.date())   # "today": uncompressed file
        read = _archive({
            d28_gz: b"\n".join([
                _alert(self.START - timedelta(hours=1), "pod-alice-meta"),  # before the lab
                _alert(self.START + timedelta(minutes=30), "pod-alice-meta"),
            ]),
            d29_plain: b"\n".join([
                _alert(self.END - timedelta(minutes=10), "pod-alice-dvwa", rule="31103"),
                _alert(self.END + timedelta(hours=1), "pod-alice-meta"),     # next lab
                _alert(self.END - timedelta(minutes=5), "pod-bob-meta"),     # other student
            ]),
        })

        page = list_siem_alerts_between([], agent_names=["pod-alice-meta", "pod-alice-dvwa"],
                                        start=self.START, end=self.END, read_file=read)

        assert page.total_count == 2
        assert [a["rule_id"] for a in page.alerts] == ["31103", "5710"]  # newest first
        assert set(page.alerts[0]) == set(alerts_reader.ALLOWED_KEYS)    # no full_log

    def test_missing_days_are_skipped_not_errors(self):
        page = list_siem_alerts_between([], agent_names=["pod-alice-meta"], start=self.START,
                                        end=self.END, read_file=lambda p: None)
        assert page.alerts == [] and page.total_count == 0

    def test_excluded_rule_and_limit(self):
        gz, _ = archive_paths(self.START.date())
        read = _archive({gz: b"\n".join(
            [_alert(self.START + timedelta(minutes=i), "pod-alice-meta") for i in range(1, 6)]
            + [_alert(self.START + timedelta(minutes=7), "pod-alice-meta", rule="1007")]
        )})
        page = list_siem_alerts_between([], agent_names=["pod-alice-meta"], start=self.START, end=self.END,
                                        exclude_rule_ids=["1007"], limit=2, read_file=read)
        assert page.total_count == 5 and len(page.alerts) == 2

    def test_month_folder_uses_english_abbreviation(self):
        gz, plain = archive_paths(datetime(2026, 9, 3).date())
        assert gz == "/var/ossec/logs/alerts/2026/Sep/ossec-alerts-03.json.gz"
        assert plain.endswith("/2026/Sep/ossec-alerts-03.json")


# ── lab windows ─────────────────────────────────────────────────────────────

def _conn():
    return db.get_db_connection()


def _verification(pod_id, student, scenario, pod_created: datetime):
    conn = _conn()
    with conn:
        conn.execute(
            "INSERT INTO milestone_verification (pod_id, student_id, scenario_id, milestone_id, status, pod_created_at) "
            "VALUES (?, ?, ?, 1, 'FAIL', ?)",
            (pod_id, student, scenario, _sql(pod_created)),
        )
    conn.close()


def _pod(pod_id, student, scenario="09", status="PROVISIONING"):
    conn = _conn()
    with conn:
        conn.execute(
            "INSERT INTO pods (pod_id, student_id, scenario_id, status) VALUES (?, ?, ?, ?)",
            (pod_id, student, scenario, status),
        )
        lab_history.record_lab_start(conn, pod_id)
    conn.close()


class TestListLabs:
    def test_pre_v8_labs_get_estimated_ends(self):
        t0 = datetime(2026, 9, 20, 8, 0, tzinfo=UTC)
        _verification(3, "alice", 9, t0)
        _verification(3, "alice", 6, t0 + timedelta(hours=2))   # next lab 2h later
        conn = _conn()
        labs = lab_history.list_labs(conn, "alice", now=t0 + timedelta(days=3))
        conn.close()

        older, newer = labs[1], labs[0]
        assert older["scenario_id"] == "09" and older["end_estimated"]
        assert older["ended_at"] == _sql(t0 + timedelta(hours=2))   # cut at the next lab
        assert newer["ended_at"] == _sql(t0 + timedelta(hours=10))  # start + 8h TTL
        assert not newer["active"]

    def test_recorded_session_open_then_closed(self):
        _pod(4, "bob")
        conn = _conn()
        [lab] = lab_history.list_labs(conn, "bob")
        conn.close()
        assert lab["active"] and lab["ended_at"] is None and not lab["end_estimated"]

        finalize_destroyed_pod(4, "DESTROYED")

        conn = _conn()
        [lab] = lab_history.list_labs(conn, "bob")
        status = conn.execute("SELECT end_status FROM lab_sessions WHERE pod_id=4").fetchone()[0]
        conn.close()
        assert not lab["active"] and lab["ended_at"] is not None
        assert status == "DESTROYED"

    def test_reused_slot_closes_the_stale_session(self):
        _pod(5, "carol")
        conn = _conn()
        with conn:
            conn.execute("DELETE FROM pods WHERE pod_id=5")
            conn.execute("INSERT INTO pods (pod_id, student_id, scenario_id, status) VALUES (5, 'dave', '01', 'PROVISIONING')")
            lab_history.record_lab_start(conn, 5)
        rows = conn.execute("SELECT student_id, end_status FROM lab_sessions WHERE pod_id=5 ORDER BY id").fetchall()
        conn.close()
        assert [tuple(r) for r in rows] == [("carol", "SUPERSEDED"), ("dave", None)]

    def test_verifier_rows_for_a_recorded_lab_are_not_duplicated(self):
        _pod(6, "erin")
        conn = _conn()
        started = conn.execute("SELECT started_at FROM lab_sessions WHERE pod_id=6").fetchone()[0]
        conn.close()
        _verification(6, "erin", 9, datetime.strptime(started, "%Y-%m-%d %H:%M:%S").replace(tzinfo=UTC))
        conn = _conn()
        assert len(lab_history.list_labs(conn, "erin")) == 1
        conn.close()


# ── endpoints ───────────────────────────────────────────────────────────────

def _client(*roles, username="instructor_demo"):
    claims = {"preferred_username": username, "realm_access": {"roles": list(roles)}}
    app.dependency_overrides[verify_token] = lambda: claims
    app.dependency_overrides[ae.verify_token_dep] = lambda: claims
    return TestClient(app)


@pytest.fixture
def ended_lab(monkeypatch):
    t0 = datetime.now(UTC) - timedelta(days=2)
    _verification(7, "alice", 9, t0)
    gz, _ = archive_paths(t0.date())
    files = {gz: b"\n".join([
        _alert(t0 + timedelta(minutes=5), "pod-alice-meta"),
        _alert(t0 + timedelta(minutes=6), "pod-bob-meta"),
    ])}
    monkeypatch.setattr(alerts_reader, "_read_manager_file", _archive(files))
    return _sql(t0)


def test_staff_list_labs_and_read_an_ended_labs_alerts(ended_lab):
    client = _client("instructor")
    labs = client.get("/instructor/students/alice/labs").json()["labs"]
    assert labs[0]["started_at"] == ended_lab and labs[0]["end_estimated"]

    res = client.get("/instructor/students/alice/labs/7/alerts", params={"started_at": ended_lab})
    assert res.status_code == 200
    body = res.json()
    assert body["total_count"] == 1
    assert body["alerts"][0]["agent_name"] == "pod-alice-meta"


def test_window_is_server_side_only(ended_lab):
    # A made-up start time (or another student's lab) is a 404, not a free-form query.
    client = _client("admin")
    assert client.get("/instructor/students/alice/labs/7/alerts",
                      params={"started_at": "2020-01-01 00:00:00"}).status_code == 404
    assert client.get("/instructor/students/bob/labs/7/alerts",
                      params={"started_at": ended_lab}).status_code == 404


def test_manager_down_is_503_with_the_lab(ended_lab, monkeypatch):
    def down(path):
        raise ManagerUnavailable("lxd gone")
    monkeypatch.setattr(alerts_reader, "_read_manager_file", down)
    res = _client("instructor").get("/instructor/students/alice/labs/7/alerts", params={"started_at": ended_lab})
    assert res.status_code == 503 and res.json()["error"] == "manager_unavailable"


# ── report snapshot ─────────────────────────────────────────────────────────

def test_submitting_a_report_freezes_that_labs_alerts(ended_lab):
    student = _client("student", username="alice")
    res = student.post("/reviews/submit", json={"scenario_id": 9, "report_text": "triage done"})
    review_id = res.json()["review_id"]

    snap = _client("instructor").get(f"/instructor/reviews/{review_id}/alert-snapshot").json()["snapshot"]
    assert snap["pod_id"] == 7 and snap["window_start"] == ended_lab
    assert snap["total_count"] == 1 and snap["error"] is None
    assert snap["alerts"][0]["agent_name"] == "pod-alice-meta"


def test_snapshot_records_why_when_siem_is_down(ended_lab, monkeypatch):
    def down(path):
        raise ManagerUnavailable("lxd gone")
    monkeypatch.setattr(alerts_reader, "_read_manager_file", down)
    res = _client("student", username="alice").post("/reviews/submit", json={"scenario_id": 9, "report_text": "x"})
    assert res.status_code == 200  # the submit itself never fails

    snap = _client("instructor").get(f"/instructor/reviews/{res.json()['review_id']}/alert-snapshot").json()["snapshot"]
    assert snap["alerts"] == [] and snap["error"].startswith("SIEM unavailable")


def test_report_without_a_matching_lab(monkeypatch):
    res = _client("student", username="nolab").post("/reviews/submit", json={"scenario_id": 11, "report_text": "x"})
    snap = _client("instructor").get(f"/instructor/reviews/{res.json()['review_id']}/alert-snapshot").json()["snapshot"]
    assert snap["error"] == "no lab found for this scenario"


def test_old_reports_have_no_snapshot():
    assert _client("instructor").get("/instructor/reviews/424242/alert-snapshot").json() == {"snapshot": None}
