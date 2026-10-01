"""Dynamic per-student milestone flag generation, persistence, and container planting.

Issue #111 (SCORE-HYBRID follow-up).
- Deterministic HMAC-SHA256 flags based on cohort secret, student_id, scenario_id, and milestone_id.
- Host DB persistence in pod_milestone_flags table (v7.sql).
- Positional shell parameter injection into scenario containers (kali, meta, dvwa).
- Zero-leakage: flags are never logged in plaintext or exposed to rubrics/conflict review APIs.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import sqlite3
from typing import Any, Dict, List, Optional

from secrets_loader import get_secret

logger = logging.getLogger("provision_api")

DEFAULT_COHORT_SECRET = "cyberrange-default-cohort-secret-2026"

SCENARIO_MILESTONES: Dict[int, List[int]] = {
    # Milestone 5 on scenarios 1 and 6 is the pure-flag "capture the flag" final
    # task (see hybrid_scoring.PURE_FLAG_MILESTONES); its flag is planted below.
    1: [1, 2, 3, 4, 5],
    6: [1, 2, 3, 4, 5],
    9: [1, 2, 3],
    11: [1, 2, 3],
}


def _has_table(conn: sqlite3.Connection, table_name: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table_name,)
    ).fetchone()
    return bool(row)


def get_cohort_secret() -> str:
    """Retrieve the cohort flag secret via unified secrets_loader.

    Requires COHORT_FLAG_SECRET to be set. Raises RuntimeError at provision
    time if missing, preventing silent fallback to a committed constant.
    """
    secret = get_secret("COHORT_FLAG_SECRET", required=True)
    if not secret or not secret.strip():
        raise RuntimeError(
            "COHORT_FLAG_SECRET is empty. Set a strong random secret before provisioning."
        )
    return secret.strip()


def generate_milestone_flag(
    student_id: str,
    scenario_id: int,
    milestone_id: int,
    secret: Optional[str] = None,
) -> str:
    """Generate a deterministic, unguessable HMAC-SHA256 milestone flag.

    Format: FLAG{S<scen_id:02d>_M<milestone_id>_<12_HEX_UPPER>}
    Example: FLAG{S01_M1_4F9C2B8E0A1D}
    """
    clean_student = (student_id or "").strip()
    if not clean_student:
        raise ValueError("student_id cannot be empty")
    s_id = int(scenario_id)
    m_id = int(milestone_id)
    key = (secret or get_cohort_secret()).strip()

    payload = f"{clean_student}:{s_id}:{m_id}".encode("utf-8")
    digest = hmac.new(key.encode("utf-8"), payload, hashlib.sha256).hexdigest().upper()[:12]
    return f"FLAG{{S{s_id:02d}_M{m_id}_{digest}}}"


# Friendly word lists for human-readable capture-the-flag codes. Kept short,
# unambiguous, and easy to read/type (no look-alike or awkward words).
_CTF_ADJECTIVES = [
    "brave", "calm", "clever", "bright", "swift", "quiet", "bold", "sunny",
    "lucky", "noble", "eager", "gentle", "happy", "jolly", "keen", "kind",
    "mighty", "proud", "rapid", "sharp", "smart", "solid", "super", "witty",
    "amber", "coral", "golden", "silver", "cosmic", "royal", "zesty", "frosty",
]
_CTF_NOUNS = [
    "falcon", "otter", "tiger", "river", "panda", "eagle", "comet", "maple",
    "cobra", "lynx", "raven", "shark", "wolf", "bison", "heron", "koala",
    "mango", "cedar", "delta", "ember", "flint", "harbor", "island", "jasper",
    "kite", "ledger", "meadow", "nebula", "orbit", "pepper", "quartz", "willow",
]


def generate_capture_flag(
    student_id: str,
    scenario_id: int,
    milestone_id: int,
    secret: Optional[str] = None,
) -> str:
    """Generate a deterministic, human-readable capture-the-flag code.

    Unlike generate_milestone_flag (FLAG{...} format, used for planted artifacts),
    this is the value a student reads off the page and types into the capture-the-
    flag box. Format: <adjective>-<noun>-<NNNN>, e.g. "brave-otter-7421". It is
    per-student unique and deterministic, but easy to read, understand, and copy.
    """
    clean_student = (student_id or "").strip()
    if not clean_student:
        raise ValueError("student_id cannot be empty")
    s_id = int(scenario_id)
    m_id = int(milestone_id)
    key = (secret or get_cohort_secret()).strip()

    payload = f"capture:{clean_student}:{s_id}:{m_id}".encode("utf-8")
    digest = hmac.new(key.encode("utf-8"), payload, hashlib.sha256).digest()
    adjective = _CTF_ADJECTIVES[digest[0] % len(_CTF_ADJECTIVES)]
    noun = _CTF_NOUNS[digest[1] % len(_CTF_NOUNS)]
    number = int.from_bytes(digest[2:4], "big") % 10000
    return f"{adjective}-{noun}-{number:04d}"


def generate_all_scenario_flags(
    student_id: str,
    scenario_id: int,
    secret: Optional[str] = None,
) -> Dict[int, str]:
    """Generate all milestone flags for a given scenario and student."""
    s_id = int(scenario_id)
    milestones = SCENARIO_MILESTONES.get(s_id, [1, 2, 3, 4])
    return {
        mid: generate_milestone_flag(student_id, s_id, mid, secret=secret)
        for mid in milestones
    }


def save_pod_flags(
    conn: sqlite3.Connection,
    pod_id: int,
    student_id: str,
    scenario_id: int,
    flags_map: Dict[int, str],
) -> None:
    """Persist generated flags into pod_milestone_flags in an atomic transaction."""
    clean_student = (student_id or "").strip()
    s_id = int(scenario_id)

    with conn:
        for mid, flag_val in flags_map.items():
            conn.execute(
                """
                INSERT INTO pod_milestone_flags (
                    pod_id, student_id, scenario_id, milestone_id, expected_flag, updated_at
                ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(student_id, scenario_id, milestone_id) DO UPDATE SET
                    pod_id = excluded.pod_id,
                    expected_flag = excluded.expected_flag,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (pod_id, clean_student, s_id, int(mid), flag_val),
            )


def get_student_expected_flag(
    conn: sqlite3.Connection,
    student_id: str,
    scenario_id: int,
    milestone_id: int,
) -> Optional[str]:
    """Retrieve the expected dynamic flag for a specific student, scenario, and milestone.

    Handles legacy database schemas without pod_milestone_flags gracefully.
    """
    clean_student = (student_id or "").strip()
    if not clean_student:
        return None

    try:
        if not _has_table(conn, "pod_milestone_flags"):
            return None
        row = conn.execute(
            """
            SELECT expected_flag FROM pod_milestone_flags
            WHERE student_id=? AND scenario_id=? AND milestone_id=?
            LIMIT 1
            """,
            (clean_student, int(scenario_id), int(milestone_id)),
        ).fetchone()
        if row:
            return row["expected_flag"] if isinstance(row, sqlite3.Row) else row[0]
    except sqlite3.OperationalError:
        return None
    return None


def _exec_script(inst: Any, script: str, *args: str) -> None:
    """Execute a shell script inside an LXD instance with positional arguments (safe from breakout)."""
    cmd = ["bash", "-c", script, "_"] + list(args)
    inst.execute(cmd)


def read_kali_whoami(client: Any, vmids: Dict[str, str], student_id: str) -> str:
    """Return the account name a student sees from `whoami` in the Kali terminal.

    Scenario 1's capture-the-flag is simply the student's own Kali login name, so
    the flag is read live from the Kali container (the regular UID 1000 login
    user) rather than hardcoded. Falls back to 'student' only if the container
    cannot be read, so a transient infra error never makes the milestone
    impossible to pass.
    """
    fallback = "student"
    if client is None:
        return fallback
    kali_name = vmids.get("kali", f"pod-{student_id}-kali")
    try:
        kali = client.instances.get(kali_name)
        # The Kali terminal logs in as the regular (UID 1000) account; that is
        # what `whoami` prints there. Read it from the container, not hardcoded.
        res = kali.execute(["bash", "-c", "getent passwd 1000 | cut -d: -f1"])
        out = (getattr(res, "stdout", "") or "").strip()
        name = next((ln.strip() for ln in out.splitlines() if ln.strip()), "")
        return name or fallback
    except Exception as e:  # pragma: no cover - defensive, needs live LXD
        logger.warning(f"read_kali_whoami failed for {kali_name}: {e}")
        return fallback


def plant_scenario_flags(
    client: Any,
    student_id: str,
    pod_id: int,
    vmids: Dict[str, str],
    scenario_id: int,
    flags_map: Dict[int, str],
) -> None:
    """Inject scenario milestone flags into container artifacts.

    Positional arguments are strictly used to eliminate command injection.
    Failures are logged as warnings and do not abort provisioning.
    """
    if client is None:
        logger.info("LXD client is None; skipping container flag planting")
        return

    s_id = int(scenario_id)
    meta_name = vmids.get("meta", f"pod-{student_id}-meta")
    dvwa_name = vmids.get("dvwa", f"pod-{student_id}-dvwa")
    kali_name = vmids.get("kali", f"pod-{student_id}-kali")

    try:
        if s_id == 1:
            # Scenario 01: Reconnaissance & Exploitation (Target: meta)
            meta = client.instances.get(meta_name)
            m1_flag = flags_map.get(1, "")
            m2_flag = flags_map.get(2, "")
            m3_flag = flags_map.get(3, "")
            m4_flag = flags_map.get(4, "")
            m5_flag = flags_map.get(5, "")

            s1_script = """
set -euo pipefail
# M1: Web discovery (robots.txt & index.html comment)
mkdir -p /var/www/html
printf 'User-agent: *\\nDisallow: /\\n# Recon Discovery Flag: %s\\n' "$1" > /var/www/html/robots.txt
if [ -f /var/www/html/index.html ]; then
  printf '\\n<!-- Host Discovery Complete: %s -->\\n' "$1" >> /var/www/html/index.html
fi

# M2: Port 21 vsftpd FTP banner & service reload
if [ -f /etc/vsftpd.conf ]; then
  sed -i '/^ftpd_banner=/d' /etc/vsftpd.conf
  printf 'ftpd_banner=Welcome to Meta FTP Service - %s\\n' "$2" >> /etc/vsftpd.conf
  systemctl restart vsftpd 2>/dev/null || service vsftpd restart 2>/dev/null || true
fi

# M3: Service version detection (Tomcat ROOT & info)
mkdir -p /var/lib/tomcat9/webapps/ROOT /usr/share/tomcat9/webapps/ROOT
printf '\\n<!-- Service Version Detection: %s -->\\n' "$3" >> /var/lib/tomcat9/webapps/ROOT/index.html 2>/dev/null || true
printf 'Service Version Detection Flag: %s\\n' "$3" > /var/www/html/version.txt 2>/dev/null || true

# M4 is scored from Metasploit history (behavioral) and M5 is "whoami" in the
# exploited Tomcat shell (the flag is simply the word `tomcat`), so no flag file
# is planted here. Clean up any stray flag files from earlier designs so students
# don't cat the wrong value.
rm -f /home/tomcat/flag.txt /home/tomcat/whoami_flag.txt /tmp/flag_m4.txt 2>/dev/null || true
"""
            _exec_script(meta, s1_script, m1_flag, m2_flag, m3_flag, m4_flag)

        elif s_id == 6:
            # Scenario 06: SQL Injection & Reflected XSS (Target: dvwa)
            dvwa = client.instances.get(dvwa_name)
            m1_flag = flags_map.get(1, "")
            m2_flag = flags_map.get(2, "")
            m3_flag = flags_map.get(3, "")
            m4_flag = flags_map.get(4, "")
            m5_flag = flags_map.get(5, "")

            s6_script = """
set -euo pipefail
# Target nested docker database: vulnerable-apps_db
DB=$(docker ps -qf name=vulnerable-apps_db 2>/dev/null || true)
if [ -n "$DB" ]; then
  # M1: Insert user row in dvwa.users
  docker exec -i "$DB" mysql -udvwa -pp@ssw0rd dvwa -e "
    INSERT INTO users (user_id, first_name, last_name, user, password, avatar)
    VALUES (6, 'Milestone1', '$1', 'flag_m1', MD5('flag_m1'), 'default.jpg')
    ON DUPLICATE KEY UPDATE last_name='$1';
  " 2>/dev/null || true

  # NOTE: no milestone_flags table is seeded. M2 (Database Extraction) is scored
  # from the browser when the student runs database(); the capture-the-flag (M5)
  # value is shown on the XSS (Reflected) result page below, not via SQL. Seeding
  # flags into a SQL table made a `... flag FROM milestone_flags` query dump
  # several FLAG rows at once, so students couldn't tell which one to submit.

  # M3: Admin flag user & Kali artifact file
  docker exec -i "$DB" mysql -udvwa -pp@ssw0rd dvwa -e "
    INSERT INTO users (user_id, first_name, last_name, user, password, avatar)
    VALUES (7, 'AdminFlag', '$3', 'admin_flag', '5f4dcc3b5aa765d61d8327deb882cf99', 'default.jpg')
    ON DUPLICATE KEY UPDATE last_name='$3';
  " 2>/dev/null || true
fi

# M3 admin flag file on dvwa instance
printf '%s\\n' "$3" > /tmp/admin_flag.txt 2>/dev/null || true

# M5 Capture-the-Flag: show the per-pod code INLINE in the XSS (Reflected) result.
# When the student submits the "What's your name?" field, the reflected result also
# shows their capture code -- "the result when they click submit" -- right under the
# Hello line, inside the page (NOT a fixed/floating overlay). We rewrite the active
# Low source: a quoted heredoc writes the PHP verbatim (so the single-/double-quote
# mix needs no shell escaping) with a placeholder, then sed swaps in $5 (the
# generate_capture_flag code, which is only [a-z-] and digits -- safe in sed).
WEB=$(docker ps -qf name=vulnerable-apps_dvwa 2>/dev/null || true)
if [ -n "$WEB" ]; then
  # The ghcr.io/digininja/dvwa image serves DVWA at /var/www/html, but some builds
  # nest it under /var/www/html/dvwa -- resolve whichever source/low.php exists.
  LOW=$(docker exec "$WEB" sh -c "ls /var/www/html/vulnerabilities/xss_r/source/low.php /var/www/html/dvwa/vulnerabilities/xss_r/source/low.php 2>/dev/null | head -1")
  if [ -n "$LOW" ]; then
    docker exec -i "$WEB" sh -c "cat > $LOW" <<'LOWPHP'
<?php

header ("X-XSS-Protection: 0");

// Is there any input?
if( array_key_exists( "name", $_GET ) && $_GET[ 'name' ] != NULL ) {
	// Feedback for end user
	$html .= '<pre>Hello ' . $_GET[ 'name' ] . '</pre>';
	// Capture-the-flag reward (planted per student)
	$html .= '<p style="margin-top:10px;padding:10px;border:1px solid #b94a48;background:#fff3cd"><strong>Your capture-the-flag code:</strong> <code>__CTF_CODE__</code>. Copy it into the Capture the Flag task in the portal.</p>';
}

?>
LOWPHP
    docker exec "$WEB" sh -c "sed -i 's/__CTF_CODE__/$5/' $LOW" 2>/dev/null || true
  fi
fi
"""
            _exec_script(dvwa, s6_script, m1_flag, m2_flag, m3_flag, m4_flag, m5_flag)

        elif s_id == 9:
            # Scenario 09: SIEM Alert Triage (Target: meta)
            meta = client.instances.get(meta_name)
            m1_flag = flags_map.get(1, "")
            m2_flag = flags_map.get(2, "")
            m3_flag = flags_map.get(3, "")

            s9_script = """
set -euo pipefail
# M1: Failed SSH auth log entry with invalid user flag
printf '%s sshd[%d]: Invalid user flag-m1-%s from 10.0.50.10 port 45123\\n' "$(date '+%b %d %H:%M:%S')" $$ "$1" >> /var/log/auth.log 2>/dev/null || true

# M2: Wazuh alerts.json alert event
mkdir -p /var/ossec/logs/alerts
printf '{"timestamp":"%s","rule":{"id":"5710","level":5,"description":"sshd: attempt to login using a non-existent user"},"data":{"flag":"%s"}}\\n' "$(date -u +'%Y-%m-%dT%H:%M:%S.000Z')" "$2" >> /var/ossec/logs/alerts/alerts.json 2>/dev/null || true

# M3: Incident summary verification flag
printf 'Incident Summary Verification Flag: %s\\n' "$3" > /var/log/incident_summary.flag 2>/dev/null || true
chmod 644 /var/log/incident_summary.flag 2>/dev/null || true
"""
            _exec_script(meta, s9_script, m1_flag, m2_flag, m3_flag)

        elif s_id == 11:
            # Scenario 11: Vulnerability Hardening (Target: meta)
            meta = client.instances.get(meta_name)
            m1_flag = flags_map.get(1, "")
            m2_flag = flags_map.get(2, "")
            m3_flag = flags_map.get(3, "")

            s11_script = """
set -euo pipefail
# M1: Audit comment in tomcat-users.xml right above default tomcat user
if [ -f /etc/tomcat9/tomcat-users.xml ]; then
  sed -i '/<!-- Hardening Audit Milestone 1:/d' /etc/tomcat9/tomcat-users.xml
  sed -i '/<user username="tomcat"/i <!-- Hardening Audit Milestone 1: '"$1"' -->' /etc/tomcat9/tomcat-users.xml
fi

# M2: Remediation notice in catalina.out
mkdir -p /var/log/tomcat9
printf '%s [main] INFO org.apache.catalina.startup.Catalina - Remediation verified: %s\\n' "$(date '+%d-%b-%Y %H:%M:%S.000')" "$2" >> /var/log/tomcat9/catalina.out 2>/dev/null || true

# M3: Closed exploit path flag
printf 'Exploit Path Closed Flag: %s\\n' "$3" > /var/log/tomcat9/hardening_closed.flag 2>/dev/null || true
chmod 644 /var/log/tomcat9/hardening_closed.flag 2>/dev/null || true
"""
            _exec_script(meta, s11_script, m1_flag, m2_flag, m3_flag)

    except Exception as e:
        logger.warning(
            f"Failed to plant scenario flags for pod {pod_id} (scenario {scenario_id}): {e}",
            exc_info=True,
        )
