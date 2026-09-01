"""
Agentless Scoring Verifier (LXD control-plane)

Runs the milestone scoring checks INSIDE the target container via `lxc exec`,
not over the network. The provision API runs on the LXD host, which has no route
to the per-pod OVN networks (pod-<id>-net, 10.0.<50+id>.0/24), so the previous
SSH-from-host design (ssh root@<pod-ip>) always timed out. The control plane the
API already uses for provisioning needs no pod-network reachability.

The current scoring checks (scoring_checks.sh) are *behavioral* (grep of shell
history / logs) and several *execute* commands on the target (mysql, msfconsole,
ssh-keyscan, ...), so a read-only file API cannot express them — execution is
required. For Kali-target scenarios the evidence lives in the student's own box,
so the assurance ceiling is set by what's measured, not the read mechanism.
Victim-target / high-stakes milestones should migrate to Wazuh detection (S2).
"""

import asyncio
import logging
import os
import subprocess
from typing import Tuple, Literal

logger = logging.getLogger("ssh_verifier")

# === CONFIGURATION ===
# Was hardcoded to the pre-unification "Development Phase/Phase 5/scripts"
# layout; on a host deployed from this tree, that path never exists, so every
# milestone verify returned ERROR ("Scoring script not found") by default
# (branch-review Issue 6). scoring_checks.sh is co-located with this module in
# the flat src/provisioning/ import root; SCORING_SCRIPT_PATH remains an
# explicit env override for a deployment that keeps it elsewhere.
SCORING_SCRIPT_PATH = os.getenv(
    "SCORING_SCRIPT_PATH",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "scoring_checks.sh"),
)
EXEC_TIMEOUT = 15  # seconds (script execution inside the container)

# Scenario -> target container role mapping (container name = pod-{student_id}-{role})
SCENARIO_TARGETS = {
    1: "kali",    # Network Reconnaissance & Exploitation (attacker)
    2: "kali",    # Brute Force Authentication (attacker)
    3: "kali",    # CVE Exploitation (Tomcat on meta; attacker msf history on Kali)
    4: "meta",    # Privilege Escalation
    5: "kali",    # Lateral Movement (attacker)
    6: "kali",    # SQL Injection (attacker history / artifacts on Kali; not dvwa)
    7: "kali",    # Password Cracking (attacker)
    8: "meta",    # Persistence & Backdoors
    9: "meta",    # SIEM Alert Triage
    10: "kali",   # Full Attack Chain (attacker)
    11: "meta",   # Vulnerability Hardening (defender; target being hardened)
}


class SSHVerifier:
    """Agentless scoring verifier — runs scoring_checks.sh in-container via `lxc exec`.

    (Name kept for import compatibility with provision_api_fastapi.py.)
    """

    def __init__(self, ssh_timeout: int = EXEC_TIMEOUT, **_ignored):
        # **_ignored keeps backward-compatible kwargs (e.g. ssh_key_path) harmless.
        self.exec_timeout = ssh_timeout

    async def verify_milestone(
        self, student_id: str, scenario_id: int, milestone_id: int
    ) -> Tuple[Literal["PASS", "FAIL", "UNKNOWN", "ERROR"], str]:
        """Run scoring_checks.sh for (scenario, milestone) inside the target container.

        Args:
            student_id: owner id; container name is pod-{student_id}-{role}
                        (matches vmids_for_pod()).
            scenario_id: 1-11 (portal keeps 1, 6, 9, 11; others may still be configured)
            milestone_id: typically 1-4

        Returns (status, message): status in PASS/FAIL/UNKNOWN/ERROR.
        - PASS/FAIL/UNKNOWN  = the check ran and reported its result
        - ERROR              = infrastructure failure (container/exec/timeout)
        """
        timeout = 30 if scenario_id >= 9 else self.exec_timeout

        role = SCENARIO_TARGETS.get(scenario_id)
        if not role:
            return "ERROR", f"Scenario {scenario_id} not configured"

        container = f"pod-{student_id}-{role}"

        # Control-plane exec (runs as root in-container, minimal env). The script sets
        # its own behavior; stdout carries only the result token (log() goes to a file).
        cmd = ["lxc", "exec", container, "--", "bash", "-s", str(scenario_id), str(milestone_id)]

        try:
            with open(SCORING_SCRIPT_PATH, "r") as script_file:
                script_content = script_file.read()

            result = await asyncio.wait_for(
                asyncio.to_thread(
                    subprocess.run,
                    cmd,
                    input=script_content,
                    capture_output=True,
                    text=True,
                    timeout=timeout,
                ),
                timeout=timeout + 5,
            )

            if result.returncode != 0:
                # lxc exec failure (no such container, daemon error, etc.) = infra ERROR.
                return "ERROR", f"lxc exec {container} failed (rc={result.returncode}): {result.stderr.strip()[:200]}"

            # Parse the last non-empty stdout line as the result token.
            lines = [ln.strip() for ln in result.stdout.splitlines() if ln.strip()]
            token = lines[-1] if lines else ""
            if token in ("PASS", "FAIL", "UNKNOWN"):
                return token, f"Check completed: {token}"
            return "ERROR", f"Unexpected verifier output: {token or '(empty)'} | stderr: {result.stderr.strip()[:200]}"

        except asyncio.TimeoutError:
            return "ERROR", f"Verifier timed out after {timeout}s on {container}"
        except FileNotFoundError:
            return "ERROR", f"Scoring script not found: {SCORING_SCRIPT_PATH}"
        except Exception as e:
            return "ERROR", f"Verification failed: {str(e)}"

    async def verify_multiple(
        self, student_id: str, scenario_id: int, milestone_ids: list
    ) -> dict:
        """Verify multiple milestones concurrently. Returns {milestone_id: (status, message)}."""
        tasks = [self.verify_milestone(student_id, scenario_id, mid) for mid in milestone_ids]
        results = await asyncio.gather(*tasks)
        return {mid: result for mid, result in zip(milestone_ids, results)}

    async def wait_for_container(self, container: str, max_retries: int = 15, delay: int = 2) -> bool:
        """Wait until `lxc exec <container> -- true` succeeds (container ready)."""
        for _ in range(max_retries):
            try:
                result = await asyncio.to_thread(
                    subprocess.run,
                    ["lxc", "exec", container, "--", "true"],
                    capture_output=True, text=True, timeout=5,
                )
                if result.returncode == 0:
                    return True
            except Exception:
                pass
            await asyncio.sleep(delay)
        return False


# === SYNCHRONOUS WRAPPERS ===
def verify_milestone_sync(
    student_id: str, scenario_id: int, milestone_id: int, timeout: int = EXEC_TIMEOUT
) -> Tuple[Literal["PASS", "FAIL", "UNKNOWN", "ERROR"], str]:
    """Synchronous wrapper for SSHVerifier.verify_milestone()."""
    def run_check():
        verifier = SSHVerifier(ssh_timeout=timeout)
        loop = asyncio.new_event_loop()
        try:
            return loop.run_until_complete(
                verifier.verify_milestone(student_id, scenario_id, milestone_id)
            )
        finally:
            loop.close()
    return run_check()


def wait_for_ssh_sync(target: str, timeout: int = 30) -> bool:
    """Backward-compatible name (imported by provision_api). Now polls container readiness
    via `lxc exec`. `target` is treated as a container name."""
    def run_wait():
        verifier = SSHVerifier()
        loop = asyncio.new_event_loop()
        try:
            return loop.run_until_complete(verifier.wait_for_container(target, max_retries=timeout // 2))
        finally:
            loop.close()
    return run_wait()


# === TESTING ===
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)

    async def test():
        verifier = SSHVerifier()
        status, msg = await verifier.verify_milestone(student_id="tester", scenario_id=1, milestone_id=1)
        print(f"Result: {status} - {msg}")

    asyncio.run(test())
