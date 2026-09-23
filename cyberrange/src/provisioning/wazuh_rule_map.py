"""
S2 detection-scoring rule map.

Maps (scenario_id, milestone_id) -> {role, rule_id} for victim-side detection.
Attacker-only scenarios are intentionally absent (manual scoring only; their
detection_score stays 0). Auth-log rules (meta) fire from the default agent
ossec.conf, which monitors /var/log/auth.log. Web rules (dvwa, 31xxx) require
apache log ingestion and are deferred until that's configured + verified.

Rule references (default Wazuh ruleset):
  5710 - sshd: attempt to login using a non-existent user (brute/triage)
  5715 - sshd: authentication success (privesc foothold)
  5902 - new user added to the system (persistence)
"""
from __future__ import annotations

from typing import Any, Dict, Optional, Tuple

# Live portal catalog scenarios (portal/src/hooks/useScenarios.ts):
# 01: Network Reconnaissance & Exploitation (attacker-only; detection_score stays 0)
# 06: SQL Injection (dvwa web rules deferred until apache log ingestion is verified)
# 09: SIEM Alert Triage (M1 victim-side detection on meta: rule 5710)
# 11: Vulnerability Hardening (defensive hardening; detection_score stays 0)
LIVE_CATALOG_SCENARIOS: Tuple[str, ...] = ("01", "06", "09", "11")
PORTAL_CATALOG_SCENARIOS: Tuple[str, ...] = LIVE_CATALOG_SCENARIOS

# Keys use plain integer tuples (scenario_id, milestone_id) matching house
# conventions (ssh_verifier.py SCENARIO_TARGETS, pods_router, score_poller).
DETECTION_RULES: Dict[Tuple[int, int], Dict[str, str]] = {
    # Live catalog Scenario 09: SIEM Alert Triage
    # M1 triggers rule 5710 (sshd attempt to login using non-existent user).
    (9, 1): {"role": "meta", "rule_id": "5710"},

    # Legacy backend-configured scenario keys (backend-configured but unlisted in the portal):
    # Keys (4, 1) and (8, 1) remain available for backend testing/verification,
    # but these scenarios are unlisted in the portal catalog.
    (4, 1): {"role": "meta", "rule_id": "5715"},  # backend-configured but unlisted in the portal (privesc foothold)
    (8, 1): {"role": "meta", "rule_id": "5902"},  # backend-configured but unlisted in the portal (persistence)

    # Apache web rules for Scenario 06 (and legacy 3) explicitly deferred:
    # (6, 1) DVWA web rules require apache log ingestion.
}


def detection_for(scenario_id: Any, milestone_id: Any) -> Optional[Dict[str, str]]:
    """Look up detection rule for (scenario_id, milestone_id).

    Accepts scenario_id as portal catalog string (e.g. "09", "01"), integer (e.g. 9, 1),
    or plain string (e.g. "9"). Milestone ID can be int or str.
    Returns {role, rule_id} dictionary or None if no detection rule is configured.
    """
    try:
        sid_int = int(str(scenario_id).strip())
        mid_int = int(str(milestone_id).strip())
    except (TypeError, ValueError):
        return None

    return DETECTION_RULES.get((sid_int, mid_int))


def get_live_catalog_scenarios() -> Tuple[str, ...]:
    """Return tuple of live portal catalog scenario IDs."""
    return LIVE_CATALOG_SCENARIOS


def get_live_catalog_rules() -> Dict[Tuple[str, int], Dict[str, str]]:
    """Return only detection rules for live portal catalog scenarios (01, 06, 09, 11).

    Keys are normalized to (catalog_id_str, milestone_id_int), e.g. ("09", 1).
    Unlisted backend-configured scenarios (4, 8) are excluded.
    """
    rules: Dict[Tuple[str, int], Dict[str, str]] = {}
    for (sid, mid), rule in DETECTION_RULES.items():
        try:
            sid_str = f"{int(sid):02d}"
            mid_int = int(mid)
        except (TypeError, ValueError):
            continue
        if sid_str in LIVE_CATALOG_SCENARIOS:
            rules[(sid_str, mid_int)] = rule
    return rules
