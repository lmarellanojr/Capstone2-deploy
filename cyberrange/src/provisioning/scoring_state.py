"""Mutable scoring integration state (populated at import time)."""
from typing import Any, Callable, Optional, Type

SCORING_ENABLED = False
DETECTION_ENABLED = False
SSHVerifier: Optional[Type] = None
detection_for: Optional[Callable] = None
verify_siem_alert: Optional[Callable] = None


def configure(
    *,
    scoring_enabled: bool,
    detection_enabled: bool,
    ssh_verifier_cls: Optional[Type],
    detection_for_fn: Optional[Callable],
    verify_siem_alert_fn: Optional[Callable],
) -> None:
    global SCORING_ENABLED, DETECTION_ENABLED, SSHVerifier, detection_for, verify_siem_alert
    SCORING_ENABLED = scoring_enabled
    DETECTION_ENABLED = detection_enabled
    SSHVerifier = ssh_verifier_cls
    detection_for = detection_for_fn
    verify_siem_alert = verify_siem_alert_fn