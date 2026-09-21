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

from typing import Any, Dict, Optional, Tuple, Union

# Live portal catalog scenarios (portal/src/hooks/useScenarios.ts):
# 01: Network Reconnaissance & Exploitation (attacker-only; detection_score stays 0)
# 06: SQL Injection (dvwa web rules deferred until apache log ingestion is verified)
# 09: SIEM Alert Triage (M1 victim-side detection on meta: rule 5710)
# 11: Vulnerability Hardening (defensive hardening; detection_score stays 0)
LIVE_CATALOG_SCENARIOS: Tuple[str, ...] = ("01", "06", "09", "11")
PORTAL_CATALOG_SCENARIOS: Tuple[str, ...] = LIVE_CATALOG_SCENARIOS

DETECTION_RULES: Dict[Tuple[Union[str, int], int], Dict[str, str]] = {
    # Live catalog Scenario 09: SIEM Alert Triage
    # Retargeted to portal catalog ID "09" (also accessible via int 9).
    # M1 triggers rule 5710 (sshd attempt to login using non-existent user).
    ("09", 1): {"role": "meta", "rule_id": "5710"},
    (9, 1): {"role": "meta", "rule_id": "5710"},

    # Legacy backend-configured scenario keys (backend-configured but unlisted in the portal):
    # Keys (4, 1) and (8, 1) remain available for backend testing/verification,
    # but these scenarios are unlisted in the portal catalog.
    (4, 1): {"role": "meta", "rule_id": "5715"},  # backend-configured but unlisted in the portal (privesc foothold)
    ("04", 1): {"role": "meta", "rule_id": "5715"},  # backend-configured but unlisted in the portal
    (8, 1): {"role": "meta", "rule_id": "5902"},  # backend-configured but unlisted in the portal (persistence)
    ("08", 1): {"role": "meta", "rule_id": "5902"},  # backend-configured but unlisted in the portal

    # Apache web rules for Scenario 06 (and legacy 3) explicitly deferred:
    # (6, 1) / ("06", 1) DVWA web rules require apache log ingestion.
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

    sid_str_pad = f"{sid_int:02d}"

    # Check portal catalog formatted key ("09", 1), then integer key (9, 1)
    if (sid_str_pad, mid_int) in DETECTION_RULES:
        return DETECTION_RULES[(sid_str_pad, mid_int)]
    if (sid_int, mid_int) in DETECTION_RULES:
        return DETECTION_RULES[(sid_int, mid_int)]
    return None


def get_live_catalog_scenarios() -> Tuple[str, ...]:
    """Return tuple of live portal catalog scenario IDs."""
    return LIVE_CATALOG_SCENARIOS


def get_live_catalog_rules() -> Dict[Tuple[str, int], Dict[str, str]]:
    """Return only detection rules for live portal catalog scenarios (01, 06, 09, 11).

    Unlisted backend-configured scenarios (4, 8) are excluded.
    """
    return {
        (sid, mid): rule
        for (sid, mid), rule in DETECTION_RULES.items()
        if isinstance(sid, str) and sid in LIVE_CATALOG_SCENARIOS
    }

