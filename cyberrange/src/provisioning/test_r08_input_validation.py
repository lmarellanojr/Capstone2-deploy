"""R-8: uniform input validation on the scoring/diagnostic request models.

Shape errors (unknown fields, malformed student_id, out-of-range ids, over-long
strings) are rejected with 422 before any handler logic or DB write. Valid
bodies, including boundary lengths, still score.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from models import FlagSubmissionRequest
from provision_api_fastapi import app
from test_browser_score import SECRET, _headers, _insert_pod, _pass_count

ID_32 = "a" + "b" * 31  # the STUDENT_ID_PATTERN maximum


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("BROWSER_SCORE_SECRET", SECRET)
    monkeypatch.setenv("SCORING_DIAGNOSTICS_SCENARIOS", "6")
    return TestClient(app)


def _score(**over):
    body = {"student_id": "student_demo", "pod_id": 10, "scenario_id": 6, "milestone_id": 1, "label": "browser:sqli-m1"}
    body.update(over)
    return body


def _diag(**over):
    body = {"student_id": "student_demo", "pod_id": 10, "scenario_id": 6, "milestone_id": 1, "reason": "PAYLOAD_NO_ROWS"}
    body.update(over)
    return body


SHAPE_ERRORS = [
    {"extra": "x"},                          # unknown field
    {"student_id": ""},
    {"student_id": "-leading-dash"},
    {"student_id": "has space"},
    {"student_id": "pod;rm"},
    {"student_id": ID_32 + "c"},             # 33 chars
    {"pod_id": 0},
    {"scenario_id": 0},
    {"scenario_id": 100},
    {"milestone_id": 0},
    {"milestone_id": 11},
]


@pytest.mark.parametrize("over", SHAPE_ERRORS + [{"label": ""}, {"label": "x" * 65}])
def test_browser_score_rejects_bad_shapes(client, over):
    _insert_pod()
    r = client.post("/internal/browser-score", json=_score(**over), headers=_headers())
    assert r.status_code == 422
    assert _pass_count(10, 1) == 0


@pytest.mark.parametrize("over", SHAPE_ERRORS + [{"reason": ""}, {"reason": "x" * 65}])
def test_browser_diagnostic_rejects_bad_shapes(client, over):
    _insert_pod()
    r = client.post("/internal/browser-diagnostic", json=_diag(**over), headers=_headers())
    assert r.status_code == 422


def test_browser_score_accepts_32_char_student_id(client):
    _insert_pod(student_id=ID_32)
    r = client.post("/internal/browser-score", json=_score(student_id=ID_32), headers=_headers())
    assert r.status_code == 200


def test_browser_diagnostic_accepts_valid_body(client):
    _insert_pod()
    r = client.post("/internal/browser-diagnostic", json=_diag(), headers=_headers())
    assert r.status_code == 200
    assert r.json() == {"recorded": True}


def test_flag_submission_forbids_unknown_fields():
    with pytest.raises(ValidationError):
        FlagSubmissionRequest(milestone_id=5, flag="FLAG{x}", student_id="someone_else")


@pytest.mark.parametrize("flag,ok", [("x", True), ("x" * 256, True), ("", False), ("x" * 257, False)])
def test_flag_submission_length_bounds(flag, ok):
    if ok:
        assert FlagSubmissionRequest(milestone_id=5, flag=flag).flag == flag
    else:
        with pytest.raises(ValidationError):
            FlagSubmissionRequest(milestone_id=5, flag=flag)
