"""Wazuh manager API client helpers."""
import json
import logging
import re

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

logger = logging.getLogger("provision_api")

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


def remove_agents_named(student_id: str) -> list:
    """Remove every agent registered under this student's lab names. Returns
    the removed ids. Never raises: cleanup must not block provisioning or
    teardown, so failures are logged instead."""
    if not student_id:
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