"""Section D.5 / PAPER-16 Knowledge-Gain Metrics Extraction and Export Engine.

Calculates completion rates, time-to-milestone telemetry (using pod created_at
to first PASS timestamp as the documented proxy), Wazuh detection indicators,
and instructor rubric scores.
"""
from __future__ import annotations

import csv
import hashlib
import hmac
import io
import os
import sqlite3
from datetime import datetime
from typing import Any, Optional, Union

DEFAULT_ANONYMIZATION_SALT = os.getenv(
    "TELEMETRY_ANONYMIZATION_SALT", "cyberrange-d5-telemetry-salt"
).encode("utf-8")

FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def parse_timestamp(ts: Any) -> Optional[datetime]:
    """Parse SQLite timestamp string into a datetime object."""
    if not ts:
        return None
    if isinstance(ts, datetime):
        return ts
    s = str(ts).strip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(s)
    except Exception:
        pass
    for fmt in (
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M:%S.%f",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%dT%H:%M:%S.%f",
    ):
        try:
            return datetime.strptime(s, fmt)
        except Exception:
            pass
    return None


def anonymize_student_id(
    student_id: str, salt: bytes = DEFAULT_ANONYMIZATION_SALT
) -> str:
    """Deterministically map a student ID to a pseudonym resistant to dictionary attacks."""
    if not student_id:
        return "anonymous"
    h = hmac.new(salt, student_id.encode("utf-8"), hashlib.sha256).hexdigest()[:8]
    return f"student_{h}"


def sanitize_csv_cell(value: Any) -> Any:
    """Prevent CSV Formula Injection (CWE-1236) by escaping leading formula characters."""
    if isinstance(value, str) and value.startswith(FORMULA_PREFIXES):
        return f"'{value}"
    return value


def _has_table(conn: sqlite3.Connection, table_name: str) -> bool:
    """Check whether a table exists in the SQLite database."""
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table_name,)
    ).fetchone()
    return bool(row)


def extract_knowledge_gain_records(
    conn: sqlite3.Connection,
    scenario_id: Optional[int] = None,
    status_filter: Optional[str] = None,
    anonymize: bool = False,
    salt: bytes = DEFAULT_ANONYMIZATION_SALT,
) -> list[dict]:
    """Extract sanitized scoring records and calculate time-to-milestone telemetry.

    Applies cross-tenant slot reuse defense, type casting for scenario_id,
    and deduplication for multiple review cases.
    """
    # 1. Fetch milestone verification records
    query = (
        "SELECT id, pod_id, student_id, scenario_id, milestone_id, "
        "status, detection_score, verified_at "
        "FROM milestone_verification WHERE 1=1"
    )
    params: list[Any] = []
    if scenario_id is not None:
        query += " AND scenario_id = ?"
        params.append(scenario_id)
    if status_filter is not None:
        query += " AND UPPER(status) = ?"
        params.append(status_filter.strip().upper())
    query += " ORDER BY student_id ASC, scenario_id ASC, milestone_id ASC, verified_at ASC"

    conn.row_factory = sqlite3.Row
    mv_rows = conn.execute(query, params).fetchall()

    if not mv_rows:
        return []

    # 2. Pre-calculate first PASS timestamp per (student_id, scenario_id, milestone_id)
    pass_query = (
        "SELECT student_id, scenario_id, milestone_id, MIN(verified_at) as first_pass_at "
        "FROM milestone_verification "
        "WHERE status = 'PASS' "
        "GROUP BY student_id, scenario_id, milestone_id"
    )
    first_pass_map: dict[tuple[str, int, int], str] = {}
    for r in conn.execute(pass_query).fetchall():
        first_pass_map[(r["student_id"], r["scenario_id"], r["milestone_id"])] = r[
            "first_pass_at"
        ]

    # 3. Pre-fetch pods to resolve pod created_at with tenant isolation
    # Join on pod_id AND student_id to prevent cross-tenant slot reuse contamination
    pod_query = (
        "SELECT pod_id, student_id, CAST(scenario_id AS INTEGER) as scen_int, created_at "
        "FROM pods ORDER BY created_at ASC"
    )
    pod_by_slot_and_student: dict[tuple[int, str], str] = {}
    pods_by_student_scen: dict[tuple[str, int], list[tuple[datetime, str]]] = {}

    for p in conn.execute(pod_query).fetchall():
        pid = p["pod_id"]
        sid = p["student_id"]
        scen = p["scen_int"]
        cat = p["created_at"]
        if pid is not None and sid:
            pod_by_slot_and_student[(pid, sid)] = cat
        if sid and scen is not None and cat:
            cdt = parse_timestamp(cat)
            if cdt:
                pods_by_student_scen.setdefault((sid, scen), []).append((cdt, cat))

    # 4. Pre-fetch latest approved rubric scores from review_cases if table exists
    rubric_map: dict[tuple[str, int, Optional[int]], int] = {}
    if _has_table(conn, "review_cases"):
        review_query = (
            "SELECT student_id, scenario_id, milestone_id, score "
            "FROM review_cases "
            "WHERE status = 'APPROVED' AND score IS NOT NULL "
            "ORDER BY updated_at ASC, review_id ASC"
        )
        for rc in conn.execute(review_query).fetchall():
            rubric_map[(rc["student_id"], rc["scenario_id"], rc["milestone_id"])] = rc[
                "score"
            ]

    # 5. Build sanitized records
    records: list[dict] = []
    for row in mv_rows:
        sid = row["student_id"] or ""
        scen = int(row["scenario_id"])
        mid = int(row["milestone_id"])
        st = (row["status"] or "UNKNOWN").upper()
        ver_at = row["verified_at"] or ""
        det_score = int(row["detection_score"]) if row["detection_score"] is not None else 0

        # Resolve pod created_at for this student and scenario
        pod_cat_str = pod_by_slot_and_student.get((row["pod_id"], sid))
        if not pod_cat_str and (sid, scen) in pods_by_student_scen:
            # Fallback to closest pod created prior to or at verification time
            v_dt = parse_timestamp(ver_at)
            candidates = pods_by_student_scen[(sid, scen)]
            if v_dt:
                valid_candidates = [c for c in candidates if c[0] <= v_dt]
                if valid_candidates:
                    pod_cat_str = valid_candidates[-1][1]
                else:
                    pod_cat_str = candidates[0][1]
            else:
                pod_cat_str = candidates[0][1]

        # Calculate time-to-milestone: pod created_at to first PASS timestamp
        time_to_milestone: Optional[float] = None
        if st == "PASS":
            first_pass_str = first_pass_map.get((sid, scen, mid)) or ver_at
            p_dt = parse_timestamp(pod_cat_str)
            fp_dt = parse_timestamp(first_pass_str)
            if p_dt and fp_dt:
                diff = (fp_dt - p_dt).total_seconds()
                # Defend against negative duration caused by clock drift or synthetic data
                time_to_milestone = max(0.0, round(diff, 2))

        # Resolve rubric score
        rubric_score = rubric_map.get((sid, scen, mid))
        if rubric_score is None:
            rubric_score = rubric_map.get((sid, scen, None))

        out_student_id = anonymize_student_id(sid, salt) if anonymize else sid

        records.append(
            {
                "student_id": out_student_id,
                "scenario_id": scen,
                "milestone_id": mid,
                "status": st,
                "verified_at": ver_at,
                "detection_score": det_score,
                "time_to_milestone_seconds": time_to_milestone,
                "rubric_score": rubric_score,
            }
        )

    return records


def compute_knowledge_gain_summary(records: list[dict]) -> dict:
    """Calculate aggregate knowledge-gain indicators with zero-division safeguards."""
    total_records = len(records)
    if total_records == 0:
        return {
            "total_records": 0,
            "total_passes": 0,
            "completion_rate": 0.0,
            "avg_time_to_milestone_seconds": None,
            "avg_detection_score": None,
        }

    passes = [r for r in records if r.get("status") == "PASS"]
    total_passes = len(passes)
    completion_rate = round(total_passes / total_records, 4)

    times = [
        r["time_to_milestone_seconds"]
        for r in records
        if r.get("time_to_milestone_seconds") is not None
    ]
    avg_time = round(sum(times) / len(times), 2) if times else None

    det_scores = [
        r["detection_score"]
        for r in records
        if r.get("detection_score") is not None
    ]
    avg_det = round(sum(det_scores) / len(det_scores), 4) if det_scores else None

    return {
        "total_records": total_records,
        "total_passes": total_passes,
        "completion_rate": completion_rate,
        "avg_time_to_milestone_seconds": avg_time,
        "avg_detection_score": avg_det,
    }


def format_records_csv(records: list[dict]) -> str:
    """Format records into an RFC 4180-compliant CSV string with CWE-1236 protection."""
    output = io.StringIO()
    fieldnames = [
        "student_id",
        "scenario_id",
        "milestone_id",
        "status",
        "verified_at",
        "detection_score",
        "time_to_milestone_seconds",
        "rubric_score",
    ]
    writer = csv.DictWriter(output, fieldnames=fieldnames, quoting=csv.QUOTE_MINIMAL, lineterminator="\n")
    writer.writeheader()
    for rec in records:
        row: dict[str, Any] = {}
        for fn in fieldnames:
            val = rec.get(fn)
            if val is None:
                row[fn] = ""
            else:
                row[fn] = sanitize_csv_cell(val)
        writer.writerow(row)
    return output.getvalue()
