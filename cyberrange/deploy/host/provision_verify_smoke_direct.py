#!/usr/bin/env python3
"""E2E provision + verify (direct code path when Keycloak password grant is disabled)."""
from __future__ import annotations

import asyncio
import os
import sqlite3
import sys
import time
from pathlib import Path

REPO = Path(os.environ.get("REPO", Path.home() / "cyberrange"))
SCRIPTS = Path(os.environ.get("SCRIPTS", REPO / "src" / "provisioning"))
STUDENT = os.environ.get("STUDENT", "e2e-smoke")
SCENARIO = os.environ.get("SCENARIO", "01")
VERIFY_SCENARIO = int(os.environ.get("VERIFY_SCENARIO", "1"))
VERIFY_MILESTONE = int(os.environ.get("VERIFY_MILESTONE", "1"))
POLL_SECS = int(os.environ.get("POLL_SECS", "300"))
POD_STORAGE_MB = int(os.environ.get("POD_STORAGE_MB", "7168"))

sys.path.insert(0, str(SCRIPTS))
os.chdir(SCRIPTS)

# Load Phase 4 + Phase 5 env (same as systemd)
for env_file in (
    REPO / "Development Phase" / "Phase 4" / "scripts" / ".env",
    SCRIPTS / ".env",
):
    if env_file.is_file():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip())

from db import get_db_connection  # noqa: E402
from provision import perform_destruction, perform_provisioning, vmids_for_pod  # noqa: E402
from scoring import verify_milestone  # noqa: E402
import scoring_state  # noqa: E402
from scoring_imports import load_scoring_modules  # noqa: E402

DB = Path(os.environ.get("DB_PATH", Path.home() / "cyberrange-data" / "db" / "pod_mgmt.db"))


def destroy_live(student: str) -> None:
    conn = get_db_connection()
    row = conn.execute(
        "SELECT * FROM pods WHERE student_id=? AND status NOT IN ('DESTROYED','FAILED_ROLLBACK_COMPLETE')",
        (student,),
    ).fetchone()
    conn.close()
    if not row:
        return
    print(f"destroying pod_id={row['pod_id']} student={student}")
    perform_destruction(dict(row))
    deadline = time.time() + 120
    while time.time() < deadline:
        conn = get_db_connection()
        st = conn.execute("SELECT status FROM pods WHERE pod_id=?", (row["pod_id"],)).fetchone()
        conn.close()
        status = st["status"] if st else "DESTROYED"
        print(f"  destroy status={status}")
        if status in ("DESTROYED", "FAILED_ROLLBACK_COMPLETE"):
            return
        time.sleep(5)
    raise SystemExit("FAIL: destroy timeout")


def allocate_and_provision(student: str, scenario_id: str) -> int:
    conn = get_db_connection()
    try:
        conn.execute("BEGIN IMMEDIATE")
        pod_id = conn.execute(
            """
            SELECT MIN(available) FROM (
                SELECT 1 AS available UNION ALL SELECT 2 UNION ALL SELECT 3
                UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6
            ) WHERE available NOT IN (
                SELECT pod_id FROM pods
                WHERE status NOT IN ('DESTROYED', 'FAILED_ROLLBACK_COMPLETE')
            )
            """
        ).fetchone()[0]
        if pod_id is None:
            raise SystemExit("FAIL: POD_CAP_REACHED")
        vmids = vmids_for_pod(pod_id, student)
        conn.execute("DELETE FROM storage_reservations WHERE vmid=?", (pod_id,))
        conn.execute("DELETE FROM milestone_verification WHERE pod_id=?", (pod_id,))
        conn.execute("DELETE FROM pods WHERE pod_id=?", (pod_id,))
        conn.execute(
            "INSERT INTO pods (student_id, pod_id, vmid_kali, vmid_meta, vmid_dvwa, status, scenario_id) "
            "VALUES (?,?,?,?,?,?,?)",
            (student, pod_id, vmids["kali"], vmids["meta"], vmids["dvwa"], "PROVISIONING", scenario_id),
        )
        conn.execute("INSERT INTO storage_reservations (vmid, size_mb) VALUES (?,?)", (pod_id, POD_STORAGE_MB))
        conn.commit()
    finally:
        conn.close()

    print(f"provisioning pod_id={pod_id} student={student} scenario={scenario_id}")
    perform_provisioning(student, pod_id, vmids, scenario_id)
    return pod_id


def wait_active(pod_id: int) -> dict:
    deadline = time.time() + POLL_SECS
    while time.time() < deadline:
        conn = get_db_connection()
        row = conn.execute("SELECT * FROM pods WHERE pod_id=?", (pod_id,)).fetchone()
        conn.close()
        if not row:
            raise SystemExit("FAIL: pod row missing")
        status = row["status"]
        print(f"poll pod_id={pod_id} status={status}")
        if status == "ACTIVE":
            return dict(row)
        if status.startswith("FAILED"):
            raise SystemExit(f"FAIL: provisioning failed ({status})")
        time.sleep(10)
    raise SystemExit("FAIL: ACTIVE timeout")


def seed_m1(kali_name: str, pod_id: int) -> None:
    import subprocess

    subnet = f"10.0.{50 + pod_id}"
    cmd = (
        f"echo 'nmap -sn {subnet}.0/24' >> /home/student/.bash_history && "
        "chown student:student /home/student/.bash_history"
    )
    subprocess.run(
        ["lxc", "exec", kali_name, "--project", os.environ.get("LXD_PROJECT", "default"), "--", "bash", "-c", cmd],
        check=True,
    )
    print(f"seeded nmap history on {kali_name} ({subnet}.0/24)")


def _configure_scoring() -> None:
    ssh_mod, score_mod, wazuh_mod = load_scoring_modules()
    scoring_state.configure(
        scoring_enabled=ssh_mod is not None,
        detection_enabled=score_mod is not None and wazuh_mod is not None,
        ssh_verifier_cls=ssh_mod.SSHVerifier if ssh_mod else None,
        detection_for_fn=wazuh_mod.detection_for if wazuh_mod else None,
        verify_siem_alert_fn=score_mod.verify_siem_alert if score_mod else None,
    )


async def run_verify(pod: dict) -> dict:
    _configure_scoring()
    deps = {
        "scoring_enabled": scoring_state.SCORING_ENABLED,
        "ssh_verifier_cls": scoring_state.SSHVerifier,
        "detection_enabled": scoring_state.DETECTION_ENABLED,
        "detection_for": scoring_state.detection_for,
        "verify_siem_alert": scoring_state.verify_siem_alert,
    }
    result = await verify_milestone(pod, VERIFY_SCENARIO, VERIFY_MILESTONE, **deps)
    return result.model_dump() if hasattr(result, "model_dump") else dict(result)


def _teardown_smoke(student: str) -> None:
    """Destroy the smoke student's pod. Scoped to STUDENT only — never other users.

    Raises SystemExit on destroy timeout (same as destroy_live). Callers that must
    not lose a prior exit code should catch SystemExit around this helper.
    """
    print(f"=== smoke teardown student={student} ===")
    destroy_live(student)
    print("smoke_teardown=OK")


def main() -> int:
    """Provision → verify smoke for STUDENT, always free the pod slot afterward.

    On MAX_PODS=1 (OCI Always Free 12 GiB), leaving the smoke pod ACTIVE blocks the
    first real student. Teardown runs in finally for both PASS and FAIL paths.
    Set KEEP_SMOKE_POD=1 to skip teardown (debug only).
    """
    print(f"=== provision_verify_smoke_direct student={STUDENT} ===")
    keep = os.environ.get("KEEP_SMOKE_POD", "").strip().lower() in ("1", "true", "yes")

    # Pre-clean leftovers from a previous interrupted run (same student only).
    destroy_live(STUDENT)

    exit_code = 1
    try:
        pod_id = allocate_and_provision(STUDENT, SCENARIO)
        pod = wait_active(pod_id)
        seed_m1(pod["vmid_kali"], pod_id)
        result = asyncio.run(run_verify(pod))
        print("verify_result:", result)
        status = result.get("status", "")
        if status == "PASS":
            print("provision_verify_smoke_direct=PASS")
            exit_code = 0
        else:
            print(f"provision_verify_smoke_direct=FAIL status={status}")
            exit_code = 1
    except SystemExit as e:
        code = e.code
        if isinstance(code, int):
            exit_code = code
        elif code is None:
            exit_code = 0
        else:
            exit_code = 1
        if exit_code != 0:
            print(f"provision_verify_smoke_direct=FAIL early_exit={exit_code}")
    except Exception as e:
        print(f"provision_verify_smoke_direct=FAIL exception={e}")
        exit_code = 1
    finally:
        if keep:
            print("KEEP_SMOKE_POD set — skipping teardown (debug only)")
        else:
            try:
                _teardown_smoke(STUDENT)
            except SystemExit as e:
                print(f"smoke_teardown=FAIL {e}")
                if exit_code == 0:
                    exit_code = 1
            except Exception as e:
                print(f"smoke_teardown=FAIL {e}")
                if exit_code == 0:
                    exit_code = 1

    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
