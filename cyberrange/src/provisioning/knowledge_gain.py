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
import sqlite3
from datetime import datetime
from typing import Any, Optional

from secrets_loader import get_secret

MIN_TELEMETRY_SALT_BYTES = 16
FORMULA_PREFIXES = ("=", "+", "-", "@")
# Leading characters stripped before formula detection (ASCII ws + NBSP + BOM).
_LEADING_STRIP = "".join(
    [
        " ",
        "\t",
        "\r",
        "\n",
        "\v",
        "\f",
        "\u00a0",
        "\ufeff",
    ]
)


class TelemetrySaltConfigError(Exception):
    """Raised when anonymization is requested but the telemetry salt is unusable."""


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


def _validate_salt_bytes(salt: bytes) -> bytes:
    if not isinstance(salt, (bytes, bytearray)) or len(salt) < MIN_TELEMETRY_SALT_BYTES:
        raise TelemetrySaltConfigError(
            "TELEMETRY_ANONYMIZATION_SALT must be at least "
            f"{MIN_TELEMETRY_SALT_BYTES} bytes"
        )
    return bytes(salt)


def resolve_telemetry_salt(explicit: bytes | None = None) -> bytes:
    """Resolve a deployment-specific telemetry salt; fail closed if unusable."""
    if explicit is not None:
        return _validate_salt_bytes(explicit)

    raw = get_secret("TELEMETRY_ANONYMIZATION_SALT", required=False, default=None)
    if raw is None:
        raise TelemetrySaltConfigError(
            "TELEMETRY_ANONYMIZATION_SALT is not configured"
        )
    cleaned = raw.strip()
    if not cleaned:
        raise TelemetrySaltConfigError(
            "TELEMETRY_ANONYMIZATION_SALT is not configured"
        )
    return _validate_salt_bytes(cleaned.encode("utf-8"))


def anonymize_student_id(student_id: str, salt: bytes) -> str:
    """Map a student ID to a salted HMAC-SHA256 pseudonym (full 64-hex digest)."""
    salt = _validate_salt_bytes(salt)
    if not student_id:
        return "anonymous"
    h = hmac.new(salt, student_id.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"student_{h}"


def sanitize_csv_cell(value: Any) -> Any:
    """Prevent CSV formula injection (CWE-1236), including whitespace/NBSP prefixes."""
    if not isinstance(value, str):
        return value
    if value.startswith(("\t", "\r")):
        return f"'{value}"
    normalized = value.lstrip(_LEADING_STRIP)
    if normalized.startswith(FORMULA_PREFIXES):
        return f"'{value}"
    return value


def _has_table(conn: sqlite3.Connection, table_name: str) -> bool:
    """Check whether a table exists in the SQLite database."""
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table_name,)
    ).fetchone()
    return bool(row)


def _has_column(conn: sqlite3.Connection, table_name: str, column_name: str) -> bool:
    """Check whether a column exists in the SQLite table."""
    cols = [r[1] for r in conn.execute(f"PRAGMA table_info({table_name})").fetchall()]
    return column_name in cols


def extract_knowledge_gain_records(
    conn: sqlite3.Connection,
    scenario_id: Optional[int] = None,
    status_filter: Optional[str] = None,
    anonymize: bool = False,
    salt: bytes | None = None,
) -> list[dict]:
    """Extract scoring records and calculate time-to-milestone telemetry.

    Library default keeps cleartext IDs (`anonymize=False`). When anonymize is
    True, a configured telemetry salt is required (explicit `salt=` or env).
    """
    resolved_salt: bytes | None = None
    if anonymize:
        resolved_salt = resolve_telemetry_salt(salt)

    has_pod_cat = _has_column(conn, "milestone_verification", "pod_created_at")

    # 1. Fetch milestone verification records
    pod_cat_col = ", pod_created_at" if has_pod_cat else ", NULL as pod_created_at"
    query = (
        f"SELECT id, pod_id, student_id, scenario_id, milestone_id, "
        f"status, detection_score, verified_at{pod_cat_col} "
        f"FROM milestone_verification WHERE 1=1"
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

    # 2. Pre-fetch pods to resolve pod created_at with tenant isolation
    # Join on pod_id AND student_id to prevent cross-tenant slot reuse contamination
    pod_by_slot_and_student: dict[tuple[int, str], str] = {}
    pods_by_student_scen: dict[tuple[str, int], list[tuple[datetime, str]]] = {}

    if _has_table(conn, "pods"):
        pod_query = (
            "SELECT pod_id, student_id, CAST(scenario_id AS INTEGER) as scen_int, created_at "
            "FROM pods ORDER BY created_at ASC"
        )
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

    def _resolve_pod_created_at(row_dict_or_obj: Any) -> Optional[str]:
        # 1. Primary: persisted on milestone_verification
        try:
            if "pod_created_at" in row_dict_or_obj.keys() and row_dict_or_obj["pod_created_at"]:
                return str(row_dict_or_obj["pod_created_at"])
        except Exception:
            pass

        s_id = row_dict_or_obj["student_id"] or ""
        p_id = row_dict_or_obj["pod_id"]
        sc_id = int(row_dict_or_obj["scenario_id"]) if row_dict_or_obj["scenario_id"] is not None else None
        ver_time = row_dict_or_obj["verified_at"] or ""
        v_dt = parse_timestamp(ver_time)

        # 2. Match slot and student (ONLY IF pod was created <= verified_at)
        if (p_id, s_id) in pod_by_slot_and_student:
            slot_cat = pod_by_slot_and_student[(p_id, s_id)]
            slot_dt = parse_timestamp(slot_cat)
            if v_dt and slot_dt and slot_dt <= v_dt:
                return slot_cat
            elif not v_dt:
                return slot_cat

        # 3. Match student and scenario (closest created_at <= verified_at)
        if sc_id is not None and (s_id, sc_id) in pods_by_student_scen:
            candidates = pods_by_student_scen[(s_id, sc_id)]
            if v_dt:
                valid_candidates = [c for c in candidates if c[0] <= v_dt]
                if valid_candidates:
                    return valid_candidates[-1][1]
                return None
            return candidates[0][1]
        return None

    # 3. Pre-calculate first PASS timestamp per session:
    # Key: (student_id, scenario_id, milestone_id, pod_created_at) -> first PASS verified_at
    pass_query = (
        f"SELECT id, pod_id, student_id, scenario_id, milestone_id, "
        f"status, detection_score, verified_at{pod_cat_col} "
        f"FROM milestone_verification "
        f"WHERE UPPER(status) = 'PASS' "
        f"ORDER BY verified_at ASC"
    )
    first_pass_map: dict[tuple[str, int, int, Optional[str]], str] = {}
    for r in conn.execute(pass_query).fetchall():
        r_sid = r["student_id"] or ""
        r_scen = int(r["scenario_id"])
        r_mid = int(r["milestone_id"])
        r_pcat = _resolve_pod_created_at(r)
        key = (r_sid, r_scen, r_mid, r_pcat)
        if key not in first_pass_map:
            first_pass_map[key] = r["verified_at"]

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

        # Resolve pod created_at for this session
        pod_cat_str = _resolve_pod_created_at(row)

        # Calculate time-to-milestone: pod created_at to first PASS timestamp of this session
        time_to_milestone: Optional[float] = None
        if st == "PASS":
            first_pass_str = first_pass_map.get((sid, scen, mid, pod_cat_str)) or ver_at
            p_dt = parse_timestamp(pod_cat_str)
            fp_dt = parse_timestamp(first_pass_str)
            if p_dt and fp_dt:
                diff = (fp_dt - p_dt).total_seconds()
                if diff >= 0:
                    time_to_milestone = round(diff, 2)
                else:
                    time_to_milestone = None

        # Resolve rubric scores: per-milestone score and scenario-level score separately
        rubric_score = rubric_map.get((sid, scen, mid))
        scenario_rubric_score = rubric_map.get((sid, scen, None))

        out_student_id = (
            anonymize_student_id(sid, resolved_salt) if anonymize else sid
        )

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
                "scenario_rubric_score": scenario_rubric_score,
            }
        )

    return records


def compute_knowledge_gain_summary(records: list[dict]) -> dict:
    """Calculate aggregate knowledge-gain indicators with zero-division safeguards.

    `completion_rate`: distinct curriculum milestone completion rate
    (distinct_milestones_passed / distinct_milestones_attempted) across unique
    (student_id, scenario_id, milestone_id) tuples.

    `attempt_pass_rate`: raw verification-row pass ratio (total_passes / total_records),
    which reflects attempt frequency and includes background poller ticks and manual retries.

    `avg_time_to_milestone_seconds`: mean duration from pod creation to first PASS,
    evaluated using exactly one sample per completed distinct milestone.

    `avg_detection_score`: mean detection indicator across completed distinct milestones,
    evaluated using the detection score from each milestone's first PASS row to prevent
    background poller FAIL ticks from diluting student detection rates.
    """
    total_records = len(records)
    if total_records == 0:
        return {
            "total_records": 0,
            "total_passes": 0,
            "distinct_milestones_attempted": 0,
            "distinct_milestones_passed": 0,
            "completion_rate": 0.0,
            "attempt_pass_rate": None,
            "avg_time_to_milestone_seconds": None,
            "avg_detection_score": None,
        }

    passes = [r for r in records if r.get("status") == "PASS"]
    total_passes = len(passes)
    attempt_pass_rate = round(total_passes / total_records, 4)

    distinct_attempted = {
        (r.get("student_id"), r.get("scenario_id"), r.get("milestone_id"))
        for r in records
    }
    distinct_passed = {
        (r.get("student_id"), r.get("scenario_id"), r.get("milestone_id"))
        for r in passes
    }
    distinct_milestones_attempted = len(distinct_attempted)
    distinct_milestones_passed = len(distinct_passed)

    if distinct_milestones_attempted > 0:
        completion_rate = round(
            distinct_milestones_passed / distinct_milestones_attempted, 4
        )
    else:
        completion_rate = 0.0

    # One first-pass sample per distinct completed milestone
    distinct_milestone_times: dict[tuple[Any, Any, Any], float] = {}
    distinct_detection_scores: dict[tuple[Any, Any, Any], int] = {}
    for r in records:
        if r.get("status") == "PASS":
            key = (r.get("student_id"), r.get("scenario_id"), r.get("milestone_id"))
            t = r.get("time_to_milestone_seconds")
            if t is not None and key not in distinct_milestone_times:
                distinct_milestone_times[key] = t
            det = r.get("detection_score")
            if det is not None and key not in distinct_detection_scores:
                distinct_detection_scores[key] = det

    time_samples = list(distinct_milestone_times.values())
    avg_time = round(sum(time_samples) / len(time_samples), 2) if time_samples else None

    det_samples = list(distinct_detection_scores.values())
    avg_det = round(sum(det_samples) / len(det_samples), 4) if det_samples else None

    return {
        "total_records": total_records,
        "total_passes": total_passes,
        "distinct_milestones_attempted": distinct_milestones_attempted,
        "distinct_milestones_passed": distinct_milestones_passed,
        "completion_rate": completion_rate,
        "attempt_pass_rate": attempt_pass_rate,
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
        "scenario_rubric_score",
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
