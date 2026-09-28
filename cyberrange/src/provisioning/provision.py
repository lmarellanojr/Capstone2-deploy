"""LXD pod provisioning and destruction workflow."""
import json
import logging
import os
import time
from typing import Dict, Optional

import pylxd

from db import get_db_connection, log_event
from dvwa_compose import ensure_dvwa_compose
from dvwa_ready import ensure_dvwa_ready
from guest_nic import ensure_guest_nic_up
from lab_proxy import add_dvwa_http_proxy, remove_dvwa_http_proxy
from pod_net import create_pod_network, delete_pod_network, pod_net_name, pod_subnet
from wazuh_client import deregister_agents, get_agent_id_by_name, get_wazuh_token

logger = logging.getLogger("provision_api")

_TERMINAL = frozenset({"DESTROYED", "FAILED_ROLLBACK_COMPLETE"})


def finalize_destroyed_pod(pod_id: int, terminal_status: str) -> None:
    """Drop the storage reservation and mark the pod row terminal.

    Does not touch milestone_verification — scores outlive the containers
    (GitHub issue 11).
    """
    if terminal_status not in _TERMINAL:
        raise ValueError(f"invalid terminal_status {terminal_status!r}")
    conn = get_db_connection()
    with conn:
        conn.execute("DELETE FROM storage_reservations WHERE vmid=?", (pod_id,))
        conn.execute(
            "UPDATE pods SET status=? WHERE pod_id=?",
            (terminal_status, pod_id),
        )
    conn.close()


def vmids_for_pod(pod_id: int, student_id: str):
    return {
        "kali": f"pod-{student_id}-kali",
        "meta": f"pod-{student_id}-meta",
        "dvwa": f"pod-{student_id}-dvwa",
    }


DEFAULT_WAZUH_MANAGER_IP = "10.0.40.10"


def wazuh_manager_ip(client) -> str:
    """Address agents enrol to: WAZUH_MANAGER_IP, else the manager's live mon-net IP.

    The manager's eth0 comes from mon-net DHCP unless pinned (Manual 02, Step 4a),
    so a host can hand it 10.0.40.2 instead of .10. A hardcoded .10 then leaves
    every agent unenrolled and Scenario 09 with no alerts (SIEM-SCOPE #112).
    """
    configured = os.getenv("WAZUH_MANAGER_IP", "").strip()
    if configured:
        return configured
    name = os.getenv("WAZUH_MANAGER_INSTANCE", "wazuh-manager")
    try:
        net = client.instances.get(name).state().network or {}
        for addr in (net.get("eth0") or {}).get("addresses", []):
            if addr.get("family") == "inet" and addr.get("scope") == "global":
                return addr["address"]
    except Exception as e:
        logger.warning(f"wazuh manager IP lookup failed, using default: {e}")
    return DEFAULT_WAZUH_MANAGER_IP


def get_lxd_free_mb() -> Optional[float]:
    try:
        client = pylxd.Client(project=os.getenv("LXD_PROJECT", "default"))
        pool = client.storage_pools.get("default")
        res = pool.resources.get()
        space = res.space
        return (int(space["total"]) - int(space["used"])) / 1024 / 1024
    except Exception as e:
        logger.warning(f"LXD storage check failed: {e}")
        return None


def perform_provisioning(student_id: str, pod_id: int, vmids: Dict[str, str], scenario_id: str):
    wazuh_agent_id = None
    connection_id = None

    kali_name = vmids["kali"]
    meta_name = vmids["meta"]
    dvwa_name = vmids["dvwa"]

    sub = pod_subnet(pod_id)
    kali_ip = f"{sub}.10"
    meta_ip = f"{sub}.20"
    dvwa_ip = f"{sub}.30"

    try:
        logger.info(f"Starting provisioning for student {student_id}, pod {pod_id}")
        client = pylxd.Client(project=os.getenv("LXD_PROJECT", "default"))

        delete_pod_network(pod_id)
        create_pod_network(pod_id)
        log_event("NET_CREATE_OK", student_id, pod_id, detail=f"{pod_net_name(pod_id)} ({sub}.0/24)")

        user_data = f"""#cloud-config
write_files:
  - path: /etc/lab.env
    permissions: '0600'
    owner: root:root
    content: |
      STUDENT_ID={student_id}
      SCENARIO={scenario_id}
"""
        kali_config = {
            "name": kali_name,
            "source": {"type": "image", "alias": "kali-base"},
            "profiles": ["default", "pod-security-base"],
            "config": {"user.user-data": user_data},
            "devices": {
                "eth0": {
                    "type": "nic",
                    "network": pod_net_name(pod_id),
                    "ipv4.address": kali_ip,
                }
            },
        }
        kali = client.instances.create(kali_config, wait=True)
        kali.start(wait=True)
        log_event("CLONE_OK", student_id, pod_id, vmid=kali_name)

        for name, alias, ip in (
            (meta_name, "meta-base", meta_ip),
            (dvwa_name, "dvwa-base", dvwa_ip),
        ):
            cfg = {
                "name": name,
                "source": {"type": "image", "alias": alias},
                "profiles": ["default", "pod-target-base"],
                "devices": {
                    "eth0": {
                        "type": "nic",
                        "network": pod_net_name(pod_id),
                        "ipv4.address": ip,
                    }
                },
            }
            inst = client.instances.create(cfg, wait=True)
            inst.start(wait=True)
            log_event("CLONE_OK", student_id, pod_id, vmid=name)

        env_cmd = (
            f"echo 'export TARGET_META={meta_ip}' >> /etc/bash.bashrc && "
            f"echo 'export TARGET_DVWA={dvwa_ip}' >> /etc/bash.bashrc"
        )
        kali.execute(["sh", "-c", env_cmd])
        # Behavioral scoring greps ~/.bash_history. Portal terminal uses tmux, so
        # history never flushes on exit — enable_history_flush.sh installs
        # PROMPT_COMMAND + DEBUG trap (idempotent). Prefer Phase 3 script on disk.
        # src/provisioning/ -> repo root -> deploy/golden/phase3/ (the Phase 3
        # golden-bake fragments imported alongside the unified repo; the old
        # "Phase 3/scripts" layout does not exist here -- branch-review Issue 15).
        _flush = os.path.normpath(
            os.path.join(
                os.path.dirname(os.path.abspath(__file__)),
                "..",
                "..",
                "deploy",
                "golden",
                "phase3",
                "enable_history_flush.sh",
            )
        )
        if os.path.isfile(_flush):
            with open(_flush, encoding="utf-8") as _fh:
                _flush_body = _fh.read()
            for _inst in (kali, client.instances.get(meta_name), client.instances.get(dvwa_name)):
                _inst.execute(["bash", "-c", _flush_body])
        else:
            kali.execute(
                ["sh", "-c", 'echo \'export PROMPT_COMMAND="history -a"\' >> /etc/bash.bashrc']
            )
        # Students need passwordless sudo for nmap -O / msf (lab design).
        kali.execute(
            [
                "bash",
                "-c",
                "printf '%s\\n' 'student ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/student "
                "&& chmod 440 /etc/sudoers.d/student "
                "&& visudo -cf /etc/sudoers.d/student",
            ]
        )
        # S4 (Vulnerability Hardening) remediates Tomcat on meta: edit root-owned
        # tomcat-users.xml and restart tomcat9. Portal meta terminal lands as
        # msfadmin (bridge.py POD_USERS), non-sudo by golden design so the old
        # privesc scenario stayed valid. That scenario is no longer served; grant
        # sudo per-pod here (like kali). Golden stays non-sudo.
        client.instances.get(meta_name).execute(
            [
                "bash",
                "-c",
                "printf '%s\\n' 'msfadmin ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/msfadmin "
                "&& chmod 440 /etc/sudoers.d/msfadmin "
                "&& visudo -cf /etc/sudoers.d/msfadmin",
            ]
        )

        # R7e: bring guest eth0 up after clone (fail-open — never rollback for nic).
        prefix = f"{sub}.0/24"
        for inst_name, inst_obj in (
            (kali_name, kali),
            (meta_name, client.instances.get(meta_name)),
            (dvwa_name, client.instances.get(dvwa_name)),
        ):
            ok = ensure_guest_nic_up(inst_obj, subnet_prefix=prefix)
            if ok:
                log_event("GUEST_NIC_UP_OK", student_id, pod_id, vmid=inst_name)
            else:
                logger.warning("guest nic not up in time", extra={"vmid": inst_name})
                log_event(
                    "GUEST_NIC_UP_FAIL",
                    student_id,
                    pod_id,
                    vmid=inst_name,
                    detail="eth0 not UP or no /24 route",
                )

        pub_key_path = "/home/llms_admin/.ssh/id_rsa.pub"
        if os.path.exists(pub_key_path):
            with open(pub_key_path, "r") as f:
                pub_key = f.read().strip()
            # A single quote in id_rsa.pub (malformed key, or a tampered/
            # copied file) used to break out of an f-string-interpolated
            # `sh -c "echo '{pub_key}' >> ..."` and run arbitrary commands as
            # root in every pod container at provision time (branch-review
            # Issue 9). A host key should never contain a newline; refuse
            # rather than write something unexpected to authorized_keys.
            if "\n" in pub_key or "\r" in pub_key:
                raise RuntimeError(
                    f"{pub_key_path} contains embedded newlines; refusing to "
                    f"install a malformed SSH key"
                )
            # Pass the key as a positional shell parameter ($1), never as
            # text inside the script string -- the script itself is a static
            # literal, so no character pub_key contains (quotes, backticks,
            # $()) can be interpreted by the shell.
            install_key_script = (
                'printf "%s\\n" "$1" >> /root/.ssh/authorized_keys '
                "&& chmod 600 /root/.ssh/authorized_keys"
            )
            for inst in [kali, client.instances.get(meta_name), client.instances.get(dvwa_name)]:
                inst.execute(["mkdir", "-p", "/root/.ssh"])
                inst.execute(["sh", "-c", install_key_script, "_", pub_key])

        log_event("NET_APPLY_OK", student_id, pod_id, detail="LXD native networking and keys configured")

        try:
            dvwa_inst = client.instances.get(dvwa_name)
            if ensure_dvwa_compose(dvwa_inst):
                log_event("DVWA_COMPOSE_OK", student_id, pod_id, vmid=dvwa_name)
            else:
                log_event(
                    "DVWA_COMPOSE_FAIL",
                    student_id,
                    pod_id,
                    vmid=dvwa_name,
                    detail="DB_SERVER=db health check failed",
                )
            if ensure_dvwa_ready(dvwa_inst):
                log_event("DVWA_READY_OK", student_id, pod_id, vmid=dvwa_name)
            else:
                log_event(
                    "DVWA_READY_FAIL",
                    student_id,
                    pod_id,
                    vmid=dvwa_name,
                    detail="users table missing after seed",
                )
        except Exception as e:
            logger.warning(f"DVWA compose ensure skipped/failed: {e}")
            log_event("DVWA_COMPOSE_FAIL", student_id, pod_id, detail=str(e))

        # Student-browser access to DVWA (S2): LXD proxy device → host/lxdbr0 port.
        # See lab_proxy.py / Docs/2026-08-08_SCENARIO_UX_THM_IMPROVEMENT_PLAN.md G1.
        try:
            proxy_port = add_dvwa_http_proxy(dvwa_name, pod_id)
            log_event(
                "LAB_PROXY_OK",
                student_id,
                pod_id,
                detail=f"dvwa http proxy port={proxy_port}",
            )
        except Exception as e:
            logger.warning(f"DVWA lab proxy skipped/failed: {e}")
            log_event("LAB_PROXY_FAIL", student_id, pod_id, detail=str(e))

        agent_ids = {}
        try:
            manager_ip = wazuh_manager_ip(client)
            for inst_name in (meta_name, dvwa_name):
                inst = client.instances.get(inst_name)
                inst.execute(["sed", "-i", f"s/MANAGER_IP/{manager_ip}/g", "/var/ossec/etc/ossec.conf"])
                inst.execute(["systemctl", "enable", "wazuh-agent"])
                inst.execute(["systemctl", "start", "wazuh-agent"])
            token = get_wazuh_token()
            for _ in range(9):
                for role in ("meta", "dvwa"):
                    if role not in agent_ids:
                        aid = get_agent_id_by_name(token, f"pod-{student_id}-{role}")
                        if aid:
                            agent_ids[role] = aid
                if len(agent_ids) == 2:
                    break
                time.sleep(5)
            wazuh_agent_id = json.dumps(agent_ids) if agent_ids else None
            log_event("WAZUH_ENROLL_OK", student_id, pod_id, detail=f"manager={manager_ip} agents={agent_ids}")
        except Exception as e:
            logger.warning(f"Wazuh enroll skipped/failed: {e}")
            log_event("WAZUH_ENROLL_FAIL", student_id, pod_id, detail=str(e))

        conn = get_db_connection()
        with conn:
            conn.execute(
                "UPDATE pods SET status='ACTIVE', connection_id=?, wazuh_agent_id=?, last_heartbeat=CURRENT_TIMESTAMP WHERE pod_id=?",
                (connection_id, wazuh_agent_id, pod_id),
            )
        conn.close()
        log_event("PROVISION_SUCCESS", student_id, pod_id)
        logger.info(
            "Provisioning complete",
            extra={"event": "provision_complete", "student_id": student_id, "pod_id": pod_id},
        )

    except Exception as e:
        logger.error(
            "Provisioning failed",
            extra={"event": "provision_failed", "student_id": student_id, "pod_id": pod_id, "detail": str(e)},
        )
        log_event("PROVISION_FAILED", student_id, pod_id, detail=str(e))
        cleanup_after_failure(student_id, pod_id, wazuh_agent_id, connection_id)


def cleanup_after_failure(
    student_id: str,
    pod_id: int,
    wazuh_agent_id: str = None,
    connection_id: int = None,
):
    logger.info(f"Cleaning up after failed provisioning for pod {pod_id}")
    # LXD-side cleanup runs best-effort: if the LXD connection itself is what
    # caused the original provisioning failure (e.g. a host permission or
    # daemon issue), this whole block would previously raise and skip the DB
    # update below, leaving the pod stuck in PROVISIONING forever and blocking
    # every future provision attempt at the capacity check. The DB must always
    # get marked FAILED_ROLLBACK_COMPLETE regardless of what happens here.
    try:
        deregister_agents(wazuh_agent_id)
 
        client = pylxd.Client(project=os.getenv("LXD_PROJECT", "default"))
        try:
            remove_dvwa_http_proxy(f"pod-{student_id}-dvwa")
        except Exception:
            pass
        for name in [f"pod-{student_id}-kali", f"pod-{student_id}-meta", f"pod-{student_id}-dvwa"]:
            try:
                instance = client.instances.get(name)
                if instance.status == "Running":
                    instance.stop(wait=True, force=True)
                instance.delete(wait=True)
            except Exception:
                pass
 
        delete_pod_network(pod_id)
    except Exception:
        logger.exception(
            f"LXD-side cleanup failed for pod {pod_id}; forcing DB status to "
            "FAILED_ROLLBACK_COMPLETE anyway so it doesn't block future provisioning"
        )
 
    finalize_destroyed_pod(pod_id, "FAILED_ROLLBACK_COMPLETE")



def perform_destruction(pod: dict):
    pod_id = pod["pod_id"]
    student_id = pod["student_id"]
    wazuh_agent_id = pod.get("wazuh_agent_id")

    deregister_agents(wazuh_agent_id)

    client = pylxd.Client(project=os.getenv("LXD_PROJECT", "default"))
    try:
        remove_dvwa_http_proxy(f"pod-{student_id}-dvwa")
    except Exception as e:
        logger.warning(f"DVWA lab proxy remove: {e}")

    # Track whether every container actually left, rather than logging and
    # pressing on. A row previously went to DESTROYED here even when a
    # container delete failed, freeing the slot while the LXD instance (and
    # its name) lingered -- the next student assigned this pod_id could hit a
    # name collision or leave an orphan the reconciler never cleans up (it
    # only sweeps confirmed-orphan *networks*, not containers -- branch-review
    # Issue 5).
    all_deleted = True
    for name in [f"pod-{student_id}-kali", f"pod-{student_id}-meta", f"pod-{student_id}-dvwa"]:
        try:
            instance = client.instances.get(name)
            if instance.status == "Running":
                instance.stop(wait=True, force=True)
            instance.delete(wait=True)
            logger.info(f"Destroyed container {name}")
        except pylxd.exceptions.NotFound:
            # Already gone (retry after a prior partial destroy, or never
            # created) -- not a failure to delete.
            continue
        except Exception as e:
            all_deleted = False
            logger.error(f"Failed to delete container {name}: {e}")

    delete_pod_network(pod_id)

    if not all_deleted:
        # Leave status='DESTROYING' (already set by the caller before
        # dispatch). The row keeps blocking a new pod for this student/slot,
        # which is correct: reusing pod_id or student_id while an LXD instance
        # of the same name may still exist is worse than a temporarily stuck
        # slot. reaper.py's stuck-state sweep retries DESTROYING rows past a
        # grace window, so this is not a silent permanent leak.
        logger.error(
            f"Pod {pod_id} destruction incomplete -- one or more containers "
            f"failed to delete; leaving status=DESTROYING for retry"
        )
        return

    finalize_destroyed_pod(pod_id, "DESTROYED")
    logger.info(f"Pod {pod_id} destroyed successfully")