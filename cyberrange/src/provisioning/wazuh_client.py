"""Wazuh manager API client helpers."""
import json
import logging

import requests

from config import (
    WAZUH_CA_BUNDLE,
    WAZUH_CERT_PATH,
    WAZUH_PASS,
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


def get_wazuh_token():
    # Fail closed rather than sending empty or half-configured credentials.
    # Both callers (provision.py's enrolment block, deregister_agents) already
    # catch Exception and continue, so an unconfigured host logs
    # WAZUH_ENROLL_FAIL and still provisions -- it just does no scoring.
    if not WAZUH_USER or not WAZUH_PASS:
        raise RuntimeError(
            "Wazuh scoring is not configured: set WAZUH_SCORING_USER and "
            "WAZUH_SCORING_PW in the API .env, or leave WAZUH_API_URL unset to "
            "disable scoring entirely."
        )
    r = requests.post(
        f"{WAZUH_URL}/security/user/authenticate",
        auth=(WAZUH_USER, WAZUH_PASS),
        verify=_wazuh_verify(),
    )
    r.raise_for_status()
    return r.json()["data"]["token"]


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


def delete_wazuh_agent(token: str, agent_id: str):
    r = requests.delete(
        f"{WAZUH_URL}/agents",
        headers={"Authorization": f"Bearer {token}"},
        params={"agents_list": agent_id, "older_than": "0s", "status": "all"},
        verify=_wazuh_verify(),
        timeout=10,
    )
    r.raise_for_status()


def deregister_agents(wazuh_agent_id):
    if not wazuh_agent_id:
        return
    try:
        ids = (
            json.loads(wazuh_agent_id)
            if str(wazuh_agent_id).strip().startswith("{")
            else {"_": wazuh_agent_id}
        )
        token = get_wazuh_token()
        for aid in ids.values():
            delete_wazuh_agent(token, aid)
    except Exception as e:
        logger.warning(f"agent de-registration skipped: {e}")