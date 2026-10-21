"""Wazuh manager API client helpers."""
import json
import logging
import re
import time

import requests

from config import (
    WAZUH_CA_BUNDLE,
    WAZUH_CERT_PATH,
    WAZUH_PASS,
    WAZUH_PROVISION_PASS,
    WAZUH_PROVISION_USER,
    WAZUH_TLS_VERIFY,
    WAZUH_URL,
    WAZUH_USER,
)
from db import log_event

logger = logging.getLogger("provision_api")


class AgentNotConnected(Exception):
    """Lab agents enrolled but are not Active. Not swallowed: the pod must not
    become ACTIVE while detection scoring is still blind (issue #168)."""


class StaleWazuhAgent(Exception):
    """A lab name is still registered after cleanup. Subclass of Exception so
    provisioning's outer handler still rolls the pod back."""

    def __init__(self, student_id: str, ids: list):
        self.student_id = student_id
        self.ids = [str(i) for i in ids]
        super().__init__(f"{student_id} {self.ids}")

_tls_warning_logged = False


def _sanitize_cert_path(path: str) -> str:
    if not path:
        return ""
    lowered = path.strip().lower()
    if lowered in ("false", "true", "0", "1", "no", "yes"):
        return ""
    return path.strip()


def _wazuh_verify():
    global _tls_warning_logged
    if str(WAZUH_TLS_VERIFY).lower() in ("false", "0", "no"):
        if not _tls_warning_logged:
            logger.warning("WAZUH_TLS_VERIFY=false — TLS verification disabled (dev only)")
            _tls_warning_logged = True
        return False
    bundle = _sanitize_cert_path(WAZUH_CA_BUNDLE) or _sanitize_cert_path(WAZUH_CERT_PATH)
    if bundle:
        return bundle
    logger.error(
        "WAZUH_CA_BUNDLE and WAZUH_CERT_PATH unset — using system CA bundle for Wazuh TLS"
    )
    return True


def _authenticate(user: str, password: str, timeout=None) -> str:
    r = requests.post(
        f"{WAZUH_URL}/security/user/authenticate",
        auth=(user, password),
        verify=_wazuh_verify(),
        timeout=timeout,
    )
    r.raise_for_status()
    return r.json()["data"]["token"]


def get_wazuh_token(timeout=None):
    # Fail closed rather than sending empty or half-configured credentials.
    # The enrolment caller in provision.py catches Exception and continues, so
    # an unconfigured host logs WAZUH_ENROLL_FAIL and still provisions -- it
    # just does no scoring.
    if not WAZUH_USER or not WAZUH_PASS:
        raise RuntimeError(
            "Wazuh scoring is not configured: set WAZUH_SCORING_USER and "
            "WAZUH_SCORING_PW in the API .env, or leave WAZUH_API_URL unset to "
            "disable scoring entirely."
        )
    return _authenticate(WAZUH_USER, WAZUH_PASS, timeout)


def get_provision_token(timeout=None):
    """Token for the least-privilege `provisioner` user (agent:read and
    agent:delete only), used to remove lab agents. The read-only scoring user
    can't delete agents (403)."""
    if not WAZUH_PROVISION_USER or not WAZUH_PROVISION_PASS:
        raise RuntimeError(
            "Wazuh agent cleanup is not configured: set WAZUH_PROVISION_USER and "
            "WAZUH_PROVISION_PW in the API .env."
        )
    return _authenticate(WAZUH_PROVISION_USER, WAZUH_PROVISION_PASS, timeout)


def provisioner_configured() -> bool:
    return bool(WAZUH_PROVISION_USER and WAZUH_PROVISION_PASS)


def _audit_cleanup_skipped(student_id, source: str) -> None:
    """Record that lab-agent cleanup was skipped because the provisioner user is
    not set up, so an admin can see why the next lab is refused with
    WAZUH_STALE_AGENT. Silent on hosts with no Wazuh scoring at all, and never
    raises: cleanup must not block provisioning or teardown."""
    if not (WAZUH_USER and WAZUH_PASS):
        return
    try:
        log_event(
            "WAZUH_CLEANUP_SKIPPED",
            student_id=student_id or None,
            detail=f"source={source} reason=provisioner_not_configured",
        )
    except Exception as e:
        logger.warning(f"could not audit skipped agent cleanup: {e}")


def get_agent_id_by_name(token: str, name: str):
    if not name or not all(c.isalnum() or c in "_.-" for c in name):
        logger.warning(f"unsafe agent name skipped: {name!r}")
        return None
    r = requests.get(
        f"{WAZUH_URL}/agents",
        headers={"Authorization": f"Bearer {token}"},
        params={"q": f"name={name}", "limit": 1},
        verify=_wazuh_verify(),
        timeout=10,
    )
    r.raise_for_status()
    items = r.json().get("data", {}).get("affected_items", [])
    return items[0]["id"] if items else None


def ping_manager_api(timeout: float = 10) -> int:
    """Unauthenticated GET / -- no credentials sent. Any HTTP answer (normally
    401) means the manager API is up. Raises requests.RequestException."""
    return requests.get(f"{WAZUH_URL}/", verify=_wazuh_verify(), timeout=timeout).status_code


def get_agent_status(token: str, agent_id, timeout: float = 10):
    """Status of one agent id. 'active' is the Wazuh API spelling of connected."""
    aid = "" if agent_id is None else str(agent_id).strip()
    if not re.fullmatch(r"[0-9]+", aid):
        return None
    r = requests.get(
        f"{WAZUH_URL}/agents",
        headers={"Authorization": f"Bearer {token}"},
        params={"agents_list": aid, "select": "status"},
        verify=_wazuh_verify(),
        timeout=timeout,
    )
    r.raise_for_status()
    items = r.json().get("data", {}).get("affected_items", [])
    return items[0].get("status") if items else None


def wait_for_agents_active(
    token: str,
    agent_ids: dict,
    *,
    timeout_s: float = 90,
    interval_s: float = 5,
    status_fn=None,
    sleep_fn=None,
    clock=None,
) -> dict:
    """Poll until every enrolled agent reports active. Raises AgentNotConnected
    when the deadline passes with any agent still not active."""
    status_fn = status_fn or get_agent_status
    sleep_fn = sleep_fn or time.sleep
    clock = clock or time.monotonic
    pending = dict(agent_ids)
    last = {}
    deadline = clock() + timeout_s
    while True:
        for role, aid in list(pending.items()):
            status = status_fn(token, aid)
            last[role] = status
            if str(status or "").lower() == "active":
                del pending[role]
        if not pending:
            return last
        now = clock()
        if now >= deadline:
            detail = ", ".join(f"{role}={last.get(role)}" for role in pending)
            raise AgentNotConnected(detail)
        sleep_fn(min(interval_s, max(0.0, deadline - now)))


def get_manager_agent_status(token: str, timeout: float = 10):
    """Status of agent 000 (the manager itself), readable by the `readonly`
    scoring role. 'active' means wazuh-manager is running (#55)."""
    r = requests.get(
        f"{WAZUH_URL}/agents",
        headers={"Authorization": f"Bearer {token}"},
        params={"agents_list": "000", "select": "status"},
        verify=_wazuh_verify(),
        timeout=timeout,
    )
    r.raise_for_status()
    items = r.json().get("data", {}).get("affected_items", [])
    return items[0].get("status") if items else None


def delete_wazuh_agent(token: str, agent_id) -> bool:
    """Delete one lab agent. Returns False, without calling the API, for
    anything that isn't a single real agent id: never the manager (000), and
    never a comma list or the `all` keyword, which `agents_list` would expand."""
    aid = "" if agent_id is None else str(agent_id).strip()
    if not re.fullmatch(r"[0-9]+", aid) or int(aid) == 0:
        logger.warning(f"refusing to delete Wazuh agent {agent_id!r}: not a single lab agent id")
        return False
    # purge=true also drops the key-store entry, so the agent's name is free for
    # the student's next lab straight away.
    r = requests.delete(
        f"{WAZUH_URL}/agents",
        headers={"Authorization": f"Bearer {token}"},
        params={"agents_list": aid, "older_than": "0s", "status": "all", "purge": "true"},
        verify=_wazuh_verify(),
        timeout=10,
    )
    r.raise_for_status()
    return True


def pod_agent_names(student_id: str) -> list:
    """Agent names a student's lab registers under (the container hostnames)."""
    return [f"pod-{student_id}-meta", f"pod-{student_id}-dvwa"]


def find_agent_ids_by_name(token: str, name: str) -> list:
    """Every agent id registered under this exact name (duplicates included)."""
    if not name or not all(c.isalnum() or c in "_.-" for c in name):
        logger.warning(f"unsafe agent name skipped: {name!r}")
        return []
    r = requests.get(
        f"{WAZUH_URL}/agents",
        headers={"Authorization": f"Bearer {token}"},
        params={"q": f"name={name}", "limit": 500, "select": "id,name"},
        verify=_wazuh_verify(),
        timeout=10,
    )
    r.raise_for_status()
    items = r.json().get("data", {}).get("affected_items", [])
    # Never touch agent 000 (the manager itself), whatever the query returns.
    return [a["id"] for a in items if a.get("name") == name and a.get("id") != "000"]


def remaining_agent_ids(student_id: str) -> list:
    """Ids still registered under this student's lab names, read with the
    scoring token. Agent 000 is dropped by find_agent_ids_by_name. A scoring
    auth failure propagates; it is not a StaleWazuhAgent."""
    if not student_id:
        return []
    token = get_wazuh_token()
    ids = []
    for name in pod_agent_names(student_id):
        ids.extend(find_agent_ids_by_name(token, name))
    return ids


def finish_enroll(student_id: str, pod_id: int, enroll, log_event, log_warning):
    """Run one enroll attempt.

    except StaleWazuhAgent has to stay first. It is a subclass of Exception,
    so a wider handler written above it would swallow the refusal and the pod
    would still become ACTIVE.
    """
    try:
        return enroll()
    except StaleWazuhAgent as e:
        log_event("WAZUH_STALE_AGENT", student_id, pod_id, detail=str(e.ids))
        raise
    except AgentNotConnected as e:
        log_event("WAZUH_ENROLL_FAIL", student_id, pod_id, detail=str(e))
        raise
    except Exception as e:
        log_warning(f"Wazuh enroll skipped/failed: {e}")
        log_event("WAZUH_ENROLL_FAIL", student_id, pod_id, detail=str(e))
        return None


def abort_if_names_remain(student_id: str) -> list:
    """Delete this student's leftover agents, then refuse the lab if any name
    is still registered. Returns the ids remove_agents_named actually removed
    (empty when there was nothing to purge). remove_agents_named stays
    best-effort. A failure of the follow-up scoring read is logged and
    swallowed so the agents still start. StaleWazuhAgent is raised only after
    that read returns a non-empty list."""
    removed = remove_agents_named(student_id)
    try:
        leftover = remaining_agent_ids(student_id)
    except Exception as e:
        logger.warning(f"WAZUH_STALE_CHECK_SKIPPED {student_id}: {e}")
        return removed
    if leftover:
        raise StaleWazuhAgent(student_id, leftover)
    return removed


def remove_agents_named(student_id: str) -> list:
    """Remove every agent registered under this student's lab names. Returns
    the removed ids. Never raises: cleanup must not block provisioning or
    teardown, so failures are logged instead."""
    if not student_id:
        return []
    if not provisioner_configured():
        logger.warning(
            f"agent cleanup by name skipped for {student_id!r}: Wazuh agent cleanup "
            "is not configured: set WAZUH_PROVISION_USER and WAZUH_PROVISION_PW in the API .env."
        )
        _audit_cleanup_skipped(student_id, "remove_by_name")
        return []
    try:
        token = get_provision_token()
        removed = []
        for name in pod_agent_names(student_id):
            for aid in find_agent_ids_by_name(token, name):
                if delete_wazuh_agent(token, aid):
                    removed.append(aid)
        return removed
    except Exception as e:
        logger.warning(f"agent cleanup by name skipped for {student_id!r}: {e}")
        return []


def deregister_agents(wazuh_agent_id, student_id=None):
    """Remove a lab's agents at teardown: the ids stored at enrolment, plus any
    agent still registered under the lab's names (labs whose enrolment couldn't
    read ids back never stored them, so id-only cleanup missed those)."""
    if not provisioner_configured():
        logger.warning(
            "agent de-registration skipped: Wazuh agent cleanup is not configured: "
            "set WAZUH_PROVISION_USER and WAZUH_PROVISION_PW in the API .env."
        )
        if wazuh_agent_id or student_id:
            _audit_cleanup_skipped(student_id, "teardown")
        return
    try:
        ids = {}
        if wazuh_agent_id:
            ids = (
                json.loads(wazuh_agent_id)
                if str(wazuh_agent_id).strip().startswith("{")
                else {"_": wazuh_agent_id}
            )
        if ids:
            token = get_provision_token()
            for aid in ids.values():
                if aid:  # machines without an agent store null; 000 is refused inside
                    delete_wazuh_agent(token, aid)
    except Exception as e:
        logger.warning(f"agent de-registration skipped: {e}")
    if student_id:
        remove_agents_named(student_id)