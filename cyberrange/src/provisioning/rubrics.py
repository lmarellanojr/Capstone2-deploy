"""Rubrics and flag validation for the SCORE-HYBRID scoring engine."""
from __future__ import annotations

import secrets
import sqlite3
from typing import Any, Dict, List, Optional, Tuple

CATALOG_SCENARIO_IDS = (1, 6, 9, 11)

DEFAULT_RUBRICS: List[Dict[str, Any]] = [
    # Scenario 01: Network Reconnaissance & Exploitation
    {
        "scenario_id": 1,
        "milestone_id": 1,
        "name": "Host Discovery",
        "criteria": "Execute Nmap subnet sweep to detect live hosts in target subnet.",
        "expected_flag": "FLAG{S01_M1_7F8C2A1E9D4B}",
        "points": 50,
        "mitre_technique": "T1046",
        "nist_phase": "Network Enumeration",
    },
    {
        "scenario_id": 1,
        "milestone_id": 2,
        "name": "Port Enumeration",
        "criteria": "Accurately enumerate open TCP ports (21, 22, 80, 8180) on target host.",
        "expected_flag": "FLAG{S01_M2_3E5B7C9A1D2F}",
        "points": 50,
        "mitre_technique": "T1046",
        "nist_phase": "Vulnerability Scanning",
    },
    {
        "scenario_id": 1,
        "milestone_id": 3,
        "name": "Service Version Detection",
        "criteria": "Use Nmap service version detection (-sV) to determine exact service banners.",
        "expected_flag": "FLAG{S01_M3_A4D6F8C0E2B1}",
        "points": 50,
        "mitre_technique": "T1046",
        "nist_phase": "Service Identification",
    },
    {
        "scenario_id": 1,
        "milestone_id": 4,
        "name": "Tomcat Manager Exploitation",
        "criteria": "Deploy Metasploit tomcat_mgr_deploy to achieve authenticated remote shell.",
        "expected_flag": "FLAG{S01_M4_B2C4E6A8D0F1}",
        "points": 75,
        "mitre_technique": "T1190",
        "nist_phase": "Exploitation",
    },
    # Scenario 06: SQL Injection
    {
        "scenario_id": 6,
        "milestone_id": 1,
        "name": "Injection Point",
        "criteria": "Identify SQL injection entry point on DVWA form input under Low security.",
        "expected_flag": "FLAG{S06_M1_9B4E2F1A7C3D}",
        "points": 50,
        "mitre_technique": "T1190",
        "nist_phase": "Input Validation Analysis",
    },
    {
        "scenario_id": 6,
        "milestone_id": 2,
        "name": "Database Extraction",
        "criteria": "Extract schema and users table from database using SQL injection.",
        "expected_flag": "FLAG{S06_M2_5D7F9A1C3E5B}",
        "points": 75,
        "mitre_technique": "T1190",
        "nist_phase": "Data Access",
    },
    {
        "scenario_id": 6,
        "milestone_id": 3,
        "name": "Admin Hash",
        "criteria": "Retrieve admin user password hash from dumped backend database.",
        "expected_flag": "FLAG{S06_M3_8C0E2B4D6F8A}",
        "points": 100,
        "mitre_technique": "T1190",
        "nist_phase": "Credential Harvesting",
    },
    # Scenario 09: SIEM Alert Triage
    {
        "scenario_id": 9,
        "milestone_id": 1,
        "name": "Start Triage",
        "criteria": "Generate traffic, inspect SIEM events, and output structured alert_triage.json.",
        "expected_flag": "FLAG{S09_M1_1A3C5E7F9B2D}",
        "points": 50,
        "mitre_technique": "T1595",
        "nist_phase": "Detection & Identification",
    },
    {
        "scenario_id": 9,
        "milestone_id": 2,
        "name": "True Positive Classification",
        "criteria": "Filter noise, identify true positives, and compile incident_timeline.md.",
        "expected_flag": "FLAG{S09_M2_4D6F8A0C2E4B}",
        "points": 100,
        "mitre_technique": "T1595",
        "nist_phase": "Analysis",
    },
    {
        "scenario_id": 9,
        "milestone_id": 3,
        "name": "Incident Summary",
        "criteria": "Generate comprehensive incident_report.txt documenting evidence and response.",
        "expected_flag": "FLAG{S09_M3_7B9D1F3A5C7E}",
        "points": 75,
        "mitre_technique": "T1595",
        "nist_phase": "Documentation & Response",
    },
    # Scenario 11: Vulnerability Hardening
    {
        "scenario_id": 11,
        "milestone_id": 1,
        "name": "Identify the Weakness",
        "criteria": "Inspect Tomcat manager credentials in tomcat-users.xml and verify tomcat/tomcat vulnerability.",
        "expected_flag": "FLAG{S11_M1_2C4E6A8B0D2F}",
        "points": 50,
        "mitre_technique": "T1548",
        "nist_phase": "Vulnerability Assessment",
    },
    {
        "scenario_id": 11,
        "milestone_id": 2,
        "name": "Apply the Remediation",
        "criteria": "Rotate or remove default tomcat:tomcat credential in configuration.",
        "expected_flag": "FLAG{S11_M2_5F7A9C1E3B5D}",
        "points": 75,
        "mitre_technique": "T1548",
        "nist_phase": "Remediation",
    },
    {
        "scenario_id": 11,
        "milestone_id": 3,
        "name": "Confirm the Exploit Path Is Closed",
        "criteria": "Verify Tomcat manager authentication rejects previous default credentials.",
        "expected_flag": "FLAG{S11_M3_8A0C2E4F6A8B}",
        "points": 75,
        "mitre_technique": "T1548",
        "nist_phase": "Verification",
    },
]


def seed_default_rubrics(conn: sqlite3.Connection) -> None:
    """Ensure all default rubrics are present in the milestone_rubrics table."""
    with conn:
        for r in DEFAULT_RUBRICS:
            conn.execute(
                """
                INSERT OR IGNORE INTO milestone_rubrics (
                    scenario_id, milestone_id, name, criteria, expected_flag, points, mitre_technique, nist_phase
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    r["scenario_id"],
                    r["milestone_id"],
                    r["name"],
                    r["criteria"],
                    r["expected_flag"],
                    r["points"],
                    r.get("mitre_technique"),
                    r.get("nist_phase"),
                ),
            )


def get_rubric(conn: sqlite3.Connection, scenario_id: int, milestone_id: int) -> Optional[dict]:
    """Retrieve rubric details for a specific scenario and milestone."""
    row = conn.execute(
        "SELECT * FROM milestone_rubrics WHERE scenario_id=? AND milestone_id=?",
        (scenario_id, milestone_id),
    ).fetchone()
    if not row:
        return None
    return dict(row)


def list_rubrics(conn: sqlite3.Connection, scenario_id: int) -> List[dict]:
    """Retrieve all rubrics for a given scenario ordered by milestone_id."""
    rows = conn.execute(
        "SELECT * FROM milestone_rubrics WHERE scenario_id=? ORDER BY milestone_id ASC",
        (scenario_id,),
    ).fetchall()
    return [dict(r) for r in rows]


def validate_flag(
    conn: sqlite3.Connection,
    scenario_id: int,
    milestone_id: int,
    submitted_flag: str,
    student_id: Optional[str] = None,
) -> Tuple[bool, Optional[dict]]:
    """Validate a submitted flag against rubric criteria.

    - When student_id is provided, resolution is dynamic-only: checks
      pod_milestone_flags table, then deterministic generation via
      generate_milestone_flag(). If neither matches the submitted flag,
      validation fails — the static git seed bridge is never reached.
    - When student_id is None, falls back to milestone_rubrics["expected_flag"]
      as a backward-compatible bridge for legacy test fixtures.
    - Uses secrets.compare_digest in constant time to prevent timing attacks.
    Returns (is_valid, rubric_dict).
    """
    rubric = get_rubric(conn, scenario_id, milestone_id)
    if not rubric:
        return False, None

    if not submitted_flag or not submitted_flag.strip():
        return False, rubric

    from flag_planting import generate_milestone_flag, get_student_expected_flag

    clean_submitted = submitted_flag.strip().upper()

    if student_id and student_id.strip():
        clean_sid = student_id.strip()
        # 1. If student has a provisioned dynamic flag in pod_milestone_flags, that is authoritative.
        # Static v5.sql git answer keys MUST NOT pass for a provisioned student.
        planted_expected = get_student_expected_flag(conn, clean_sid, scenario_id, milestone_id)
        if planted_expected:
            is_valid = secrets.compare_digest(clean_submitted, planted_expected.strip().upper())
            return is_valid, rubric

        # 2. If student is not yet in pod_milestone_flags, check deterministic dynamic generation:
        try:
            dynamic_expected = generate_milestone_flag(clean_sid, scenario_id, milestone_id)
            if secrets.compare_digest(clean_submitted, dynamic_expected.strip().upper()):
                return True, rubric
        except Exception:
            # If dynamic generation is unavailable (e.g. COHORT_FLAG_SECRET not set),
            # reject rather than crash or fall back to static answer keys.
            pass

        # Student context is present but neither dynamic path matched — reject.
        # Never fall through to the static bridge for an authenticated student.
        return False, rubric

    # 3. Backward-compatible bridge: fall back to static rubric expected_flag ONLY when
    # student_id is None (legacy test fixtures without student context).
    static_expected = rubric.get("expected_flag", "")
    if static_expected:
        is_valid = secrets.compare_digest(clean_submitted, static_expected.strip().upper())
        return is_valid, rubric

    return False, rubric

