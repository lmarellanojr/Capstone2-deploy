"""
S2 detection-scoring rule map.

(scenario_id, milestone_id) -> {role, rule_id} for victim-side detection.
Attacker-only scenarios are intentionally absent (manual scoring only; their
detection_score stays 0). Auth-log rules (meta) fire from the default agent
ossec.conf, which monitors /var/log/auth.log. Web rules (dvwa, 31xxx) require
apache log ingestion and are deferred until that's configured + verified.

Rule references (default Wazuh ruleset):
  5710 - sshd: attempt to login using a non-existent user (brute/triage)
  5715 - sshd: authentication success (privesc foothold)
  5902 - new user added to the system (persistence)
"""

DETECTION_RULES = {
    (4, 1): {"role": "meta", "rule_id": "5715"},   # privesc foothold (ssh auth success)
    (8, 1): {"role": "meta", "rule_id": "5902"},   # persistence (new user)
    (9, 1): {"role": "meta", "rule_id": "5710"},   # SIEM triage (brute on unknown user)
    # (3,1)/(6,1) dvwa web rules deferred until apache ingestion is verified.
}


def detection_for(scenario_id, milestone_id):
    return DETECTION_RULES.get((int(scenario_id), int(milestone_id)))
