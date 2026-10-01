"""Runtime configuration for the provision API."""
import os

from secrets_loader import get_secret
from profiles import active_profile

_PROFILE = active_profile()

PROFILE_NAME = _PROFILE.name
WAZUH_MODE = _PROFILE.wazuh_mode
KEYCLOAK_MODE = _PROFILE.keycloak_mode

# Default targets the unified layout (~/cyberrange + ~/cyberrange-data). Both
# env templates set DB_PATH explicitly, so this only applies when an operator
# forgets -- and then the Ampere layout is the right guess. The old default
# pointed at the pre-unification deploy root, a directory this tree never creates.
DB_PATH = os.getenv("DB_PATH", "/home/llms_admin/cyberrange-data/pod_mgmt.db")
API_BIND_HOST = os.getenv("API_BIND_HOST", "10.115.77.1")
API_BIND_PORT = int(os.getenv("API_BIND_PORT", "5000"))

# 3, not 6. Until the Issue 1 formula fix, the RAM gate's double-counting bug
# refused a 4th pod on the 30 GiB on-prem host (it demanded 18432 MiB free with
# 3 running), so 3 is at or below the concurrency this host has actually been
# operating at for any MemTotal <= 32 GiB. Correcting the formula alone would
# have raised the live ceiling to 6 as a side effect of a bug fix.
# Resolves the open item in Phase 7/hardening_followups_plan.md ("re-derive the
# safe cap from 30 GiB RAM / 50 GiB pool, not the 64 GiB-era default").
# Raising it above 3 needs a load test -- see Manual 09 §2b.
# OCI 12 GiB sets MAX_PODS=1 explicitly in .env and is unaffected.
MAX_PODS = int(os.getenv("MAX_PODS", str(_PROFILE.max_pods)))
STORAGE_LIMIT_MB = int(os.getenv("STORAGE_LIMIT_MB", str(_PROFILE.storage_limit_mb)))
POD_STORAGE_MB = int(os.getenv("POD_STORAGE_MB", str(_PROFILE.pod_storage_mb)))
POD_TTL_HOURS = int(os.getenv("POD_TTL_HOURS", "8"))
REAP_INTERVAL_SECONDS = int(os.getenv("REAP_INTERVAL_SECONDS", "600"))
# A crashed background task, hung LXD call, or API restart mid-flight can
# leave a row in PROVISIONING or DESTROYING forever -- nothing else ever
# revisits it, so it permanently occupies a MAX_PODS slot and the v2
# one-live-pod-per-student index (branch-review Issue 4). Grace window is
# intentionally much larger than REAP_INTERVAL_SECONDS so a slow-but-healthy
# provision/destroy in progress is never mistaken for stuck.
STUCK_POD_GRACE_MINUTES = int(os.getenv("STUCK_POD_GRACE_MINUTES", "30"))

# How often the background scorer re-checks each active pod's unfinished
# milestones (issue #12). The guide tells students to "wait for auto-detect,"
# but nothing previously called verify_milestone except a manual "Manual
# Check" click -- this interval is how long that promise takes to come true
# on its own. Frontend polls its own GET /milestones every 5s to display
# whatever this loop has already written; the two are independent.
SCORE_POLL_INTERVAL_SECONDS = int(os.getenv("SCORE_POLL_INTERVAL_SECONDS", "3"))

# "localhost", not "127.0.0.1". The Wazuh API server certificate is issued with
# `subjectAltName = DNS:localhost` ONLY -- there is no IP SAN. Requesting the
# literal IP makes TLS hostname verification fail (WAZUH_TLS_VERIFY defaults to
# "true"), so the default must be the name that is actually in the cert. The
# LXD proxy device still listens on 127.0.0.1:55000; "localhost" resolves there.
WAZUH_URL = os.getenv("WAZUH_API_URL", "https://localhost:55000")
# No default. "wazuh-wui" used to sit here, which meant an operator who set
# WAZUH_SCORING_PW but forgot WAZUH_SCORING_USER authenticated as a built-in
# account carrying the administrator role instead of the read-only `scoring`
# user. score_verifier.py has always read this variable with no default, so the
# two modules also disagreed about the same setting. Empty means "scoring not
# configured" and wazuh_client.get_wazuh_token() refuses to call out.
WAZUH_USER = os.getenv("WAZUH_SCORING_USER", "")
# Optional secret; empty string when unset (scoring may be disabled).
WAZUH_PASS = get_secret("WAZUH_SCORING_PW", required=False, default="") or ""
# Separate least-privilege user for agent cleanup (agent:read + agent:delete
# only). The read-only scoring user gets 403 on DELETE /agents, which left every
# lab's agents registered; a same-name agent then blocks the student's next lab
# from enrolling. Kept apart from the scoring user so scoring stays read-only.
WAZUH_PROVISION_USER = os.getenv("WAZUH_PROVISION_USER", "")
WAZUH_PROVISION_PASS = get_secret("WAZUH_PROVISION_PW", required=False, default="") or ""
WAZUH_CERT_PATH = os.getenv("WAZUH_CERT_PATH", "")
WAZUH_CA_BUNDLE = os.getenv("WAZUH_CA_BUNDLE", "")
WAZUH_TLS_VERIFY = os.getenv("WAZUH_TLS_VERIFY", "true")