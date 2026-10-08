"""Instructor SIEM history: each student's labs and the alerts that fired in them.

A lab's alerts live in the Wazuh manager's daily archives long after the lab
is gone, but agent names (pod-<student>-meta/-dvwa) are reused every time the
student starts a lab, so alerts must be scoped by the lab's time window.

Windows come from lab_sessions (v8: real start/end, recorded from now on).
Labs from before v8 are reconstructed from milestone_verification.pod_created_at
with an *estimated* end: the student's next lab start or start + 8 hours (the
global limit those labs ran under, before per-scenario limits),
whichever is earlier. The estimate is flagged so the UI can say so.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from alerts_reader import ManagerUnavailable, list_siem_alerts_between
from ttl import created_at_utc

logger = logging.getLogger("provision_api")

DISK_FULL_RULE_ID = "1007"  # same newest-window flood the live view hides
# Estimated labs all predate v8, when every lab was capped at 8 hours.
_LEGACY_TTL = timedelta(hours=8)
SNAPSHOT_LIMIT = 200
HISTORY_LIMIT = 500


def _iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.strftime("%Y-%m-%d %H:%M:%S") if dt else None


def _sid(value) -> str:
    """'09' / 9 / '9' -> '09' (pods store TEXT '09', reviews store INTEGER 9)."""
    try:
        return f"{int(str(value).strip()):02d}"
    except (TypeError, ValueError):
        return str(value or "")


def record_lab_start(conn, pod_id: int) -> None:
    """Open a lab_sessions row from the just-inserted pods row (same transaction).
    Any session still open on this slot (crash, missed teardown) is closed first
    so two labs can never share a window."""
    conn.execute(
        "UPDATE lab_sessions SET ended_at = CURRENT_TIMESTAMP, end_status = 'SUPERSEDED' "
        "WHERE pod_id = ? AND ended_at IS NULL",
        (pod_id,),
    )
    conn.execute(
        "INSERT INTO lab_sessions (pod_id, student_id, scenario_id, started_at) "
        "SELECT pod_id, student_id, scenario_id, COALESCE(created_at, CURRENT_TIMESTAMP) "
        "FROM pods WHERE pod_id = ?",
        (pod_id,),
    )


def record_lab_end(conn, pod_id: int, end_status: str) -> None:
    conn.execute(
        "UPDATE lab_sessions SET ended_at = CURRENT_TIMESTAMP, end_status = ? "
        "WHERE pod_id = ? AND ended_at IS NULL",
        (end_status, pod_id),
    )


def list_labs(conn, student_id: str, now: Optional[datetime] = None) -> list[dict]:
    """Newest first. Each lab: pod_id, scenario_id ('09'), started_at, ended_at
    (None while running), active, end_estimated."""
    now = now or datetime.now(timezone.utc)
    ttl = _LEGACY_TTL
    labs: list[dict] = []
    seen: set[tuple[int, str]] = set()

    for r in conn.execute(
        "SELECT pod_id, scenario_id, started_at, ended_at FROM lab_sessions "
        "WHERE student_id = ? ORDER BY started_at",
        (student_id,),
    ).fetchall():
        start = created_at_utc(r["started_at"])
        if not start:
            continue
        end = created_at_utc(r["ended_at"]) if r["ended_at"] else None
        labs.append({
            "pod_id": int(r["pod_id"]),
            "scenario_id": _sid(r["scenario_id"]),
            "start": start,
            "end": end,
            "active": end is None,
            "end_estimated": False,
        })
        seen.add((int(r["pod_id"]), _iso(start)))

    # Running lab that predates v8 (no session row yet).
    for r in conn.execute(
        "SELECT pod_id, scenario_id, created_at FROM pods WHERE student_id = ? "
        "AND status NOT IN ('DESTROYED','FAILED_ROLLBACK_COMPLETE')",
        (student_id,),
    ).fetchall():
        start = created_at_utc(r["created_at"])
        if start and (int(r["pod_id"]), _iso(start)) not in seen:
            labs.append({"pod_id": int(r["pod_id"]), "scenario_id": _sid(r["scenario_id"]),
                         "start": start, "end": None, "active": True, "end_estimated": False})
            seen.add((int(r["pod_id"]), _iso(start)))

    # Pre-v8 labs, reconstructed from verifier history.
    derived = []
    for r in conn.execute(
        "SELECT DISTINCT pod_id, scenario_id, pod_created_at "
        "FROM milestone_verification WHERE student_id = ? AND pod_created_at IS NOT NULL",
        (student_id,),
    ).fetchall():
        start = created_at_utc(r["pod_created_at"])
        if not start or (int(r["pod_id"]), _iso(start)) in seen:
            continue
        derived.append({"pod_id": int(r["pod_id"]), "scenario_id": _sid(r["scenario_id"]),
                        "start": start, "end": None, "active": False, "end_estimated": True})
        seen.add((int(r["pod_id"]), _iso(start)))
    labs.extend(derived)

    labs.sort(key=lambda lab: lab["start"])
    for i, lab in enumerate(labs):
        if lab["end_estimated"]:
            cap = lab["start"] + ttl
            nxt = labs[i + 1]["start"] if i + 1 < len(labs) else None
            lab["end"] = min(cap, nxt) if nxt else min(cap, now)
    labs.reverse()

    return [
        {
            "pod_id": lab["pod_id"],
            "scenario_id": lab["scenario_id"],
            "started_at": _iso(lab["start"]),
            "ended_at": _iso(lab["end"]),
            "active": lab["active"],
            "end_estimated": lab["end_estimated"],
        }
        for lab in labs
    ]


def find_lab(conn, student_id: str, pod_id: int, started_at: str) -> Optional[dict]:
    for lab in list_labs(conn, student_id):
        if lab["pod_id"] == pod_id and lab["started_at"] == started_at:
            return lab
    return None


def lab_alerts(student_id: str, lab: dict, limit: int = HISTORY_LIMIT, read_file=None):
    """Alerts for one lab window. Agent names only: pre-v8 labs never stored
    agent ids (Wazuh enrolment was failing), and the window disambiguates."""
    start = created_at_utc(lab["started_at"])
    end = created_at_utc(lab["ended_at"]) if lab["ended_at"] else datetime.now(timezone.utc)
    return list_siem_alerts_between(
        [],
        agent_names=[f"pod-{student_id}-meta", f"pod-{student_id}-dvwa"],
        start=start,
        end=end,
        exclude_rule_ids=[DISK_FULL_RULE_ID],
        limit=max(1, min(int(limit), HISTORY_LIMIT)),
        read_file=read_file,
    )


def lab_for_review(conn, student_id: str, scenario_id) -> Optional[dict]:
    """The lab a report is about: the student's running lab for that scenario,
    else their most recent one."""
    sid = _sid(scenario_id)
    for lab in list_labs(conn, student_id):  # newest first
        if lab["scenario_id"] == sid:
            return lab
    return None


def capture_review_snapshot(review_id: int, read_file=None) -> None:
    """Freeze the alerts from the report's lab into review_alert_snapshots.
    Runs after the response (BackgroundTasks): never blocks or fails a submit.
    A failure is stored as the snapshot's error so the instructor sees why."""
    from db import get_db_connection

    conn = get_db_connection()
    try:
        review = conn.execute(
            "SELECT student_id, scenario_id FROM review_cases WHERE review_id = ?", (review_id,)
        ).fetchone()
        if not review:
            return
        lab = lab_for_review(conn, review["student_id"], review["scenario_id"])
        row = {"pod_id": None, "window_start": None, "window_end": None, "end_estimated": 0,
               "total_count": 0, "alerts_json": "[]", "error": None}
        if lab is None:
            row["error"] = "no lab found for this scenario"
        else:
            end = lab["ended_at"] or _iso(datetime.now(timezone.utc))
            row.update(pod_id=lab["pod_id"], window_start=lab["started_at"], window_end=end,
                       end_estimated=int(lab["end_estimated"]))
            try:
                page = lab_alerts(review["student_id"], {**lab, "ended_at": end},
                                  limit=SNAPSHOT_LIMIT, read_file=read_file)
                row.update(total_count=page.total_count, alerts_json=json.dumps(page.alerts))
            except ManagerUnavailable as e:
                row["error"] = f"SIEM unavailable: {e}"[:300]
        with conn:
            conn.execute(
                "INSERT INTO review_alert_snapshots (review_id, pod_id, window_start, window_end, "
                "end_estimated, total_count, alerts_json, error) VALUES (?,?,?,?,?,?,?,?)",
                (review_id, row["pod_id"], row["window_start"], row["window_end"],
                 row["end_estimated"], row["total_count"], row["alerts_json"], row["error"]),
            )
    except Exception as e:  # background task: log, never raise
        logger.warning("review %s alert snapshot failed: %s", review_id, e)
    finally:
        conn.close()


def latest_snapshot(conn, review_id: int) -> Optional[dict]:
    r = conn.execute(
        "SELECT * FROM review_alert_snapshots WHERE review_id = ? "
        "ORDER BY captured_at DESC, id DESC LIMIT 1",
        (review_id,),
    ).fetchone()
    if not r:
        return None
    return {
        "review_id": review_id,
        "pod_id": r["pod_id"],
        "window_start": r["window_start"],
        "window_end": r["window_end"],
        "end_estimated": bool(r["end_estimated"]),
        "total_count": r["total_count"],
        "alerts": json.loads(r["alerts_json"] or "[]"),
        "error": r["error"],
        "captured_at": r["captured_at"],
    }
