"""Cyber Range Pod Provisioning API — thin entrypoint."""
import asyncio
import logging
import sys

import urllib3
from fastapi import Depends, FastAPI

from auth import require_owner as real_require_owner
from auth import require_app_role, require_role, validate_auth_config
from auth import verify_token as real_verify_token
import alerts_endpoint as ae
from capacity import (
    available_ram_mb,
    build_capacity_payload,
    count_active_pods,
    validate_capacity_config,
)
from config import API_BIND_HOST, API_BIND_PORT, MAX_PODS, REAP_INTERVAL_SECONDS, SCENARIO_TTL_MINUTES, SCORE_POLL_INTERVAL_SECONDS, TTL_CHECK_INTERVAL_SECONDS, PROFILE_NAME
from db import get_db_connection, init_db
from logging_config import configure_logging
from pods_router import internal_router as browser_score_router
from pods_router import router as pods_router
from users_router import router as users_router
import keycloak_admin
from infra_health import router as infra_health_router
from audit_router import router as audit_router
from reaper import pod_ttl_reaper
from score_poller import score_poller
from scoring_imports import load_scoring_modules
import scoring_state

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

configure_logging("provision_api")
logger = logging.getLogger("provision_api")

_ssh_mod, _score_mod, _wazuh_mod = load_scoring_modules()
_ssh_cls = _ssh_mod.SSHVerifier if _ssh_mod is not None else None
_det_fn = _wazuh_mod.detection_for if _wazuh_mod is not None else None
_siem_fn = _score_mod.verify_siem_alert if _score_mod is not None else None
scoring_state.configure(
    scoring_enabled=_ssh_mod is not None,
    detection_enabled=_score_mod is not None and _wazuh_mod is not None,
    ssh_verifier_cls=_ssh_cls,
    detection_for_fn=_det_fn,
    verify_siem_alert_fn=_siem_fn,
)
if _score_mod is None or _wazuh_mod is None:
    logger.warning("S2 detection scoring disabled: score_verifier or wazuh_rule_map not loadable")

app = FastAPI(title="Cyber Range Pod Provisioning API (LXD Version)", version="1.2.0")
app.include_router(pods_router)
app.include_router(browser_score_router)
app.include_router(users_router)
app.include_router(infra_health_router)
app.include_router(audit_router)
# alerts_endpoint.py keeps its own stub-friendly verify_token_dep, so the
# app-role guard (SEC-01 #36) is attached here rather than in that module.
app.include_router(ae.alerts_router, dependencies=[Depends(require_app_role)])
app.dependency_overrides[ae.verify_token_dep] = real_verify_token
ae.require_owner = real_require_owner
ae.require_staff = lambda claims: require_role(["instructor", "admin"], claims)
ae.get_db_connection = get_db_connection


@app.on_event("startup")
async def _validate_auth_config_startup():
    validate_auth_config()


@app.on_event("startup")
def _validate_capacity_config_startup():
    # Fail closed before serving: the RAM gate is point-in-time and reserves
    # nothing, so MAX_PODS is the real interlock on a small host and it arrives
    # from .env. Raising here prevents the API from starting at all.
    validate_capacity_config(MAX_PODS)


@app.on_event("startup")
def startup_event():
    init_db()


@app.on_event("startup")
def _log_user_management_status():
    # #145: say at startup, not on the first /admin/users call, when the
    # user-admin client is missing. Warn only; the API still starts.
    keycloak_admin.log_configuration_status()


@app.on_event("startup")
async def start_reaper():
    asyncio.create_task(pod_ttl_reaper())
    logger.info(
        "Pod TTL reaper started",
        extra={
            "event": "api_startup",
            "detail": f"TTL={SCENARIO_TTL_MINUTES}min check={TTL_CHECK_INTERVAL_SECONDS}s sweep={REAP_INTERVAL_SECONDS}s",
        },
    )
    if scoring_state.SCORING_ENABLED:
        logger.info("Phase 7: Agentless scoring enabled")
    else:
        logger.warning("Phase 7: Agentless scoring disabled (ssh_verifier not available)")


@app.on_event("startup")
async def start_score_poller():
    # issue #12: makes the guides' "or wait for auto-detect" promise real —
    # previously nothing ever called verify_milestone except a Manual Check
    # click. See score_poller.py.
    asyncio.create_task(score_poller())
    logger.info(
        "Background score poller started",
        extra={
            "event": "api_startup",
            "detail": f"interval={SCORE_POLL_INTERVAL_SECONDS}s",
        },
    )


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/capacity")
def capacity_status():
    conn = get_db_connection()
    active = count_active_pods(conn)
    conn.close()
    avail = available_ram_mb()
    return build_capacity_payload(active, avail, MAX_PODS, PROFILE_NAME)


if __name__ == "__main__":
    import uvicorn

    try:
        validate_auth_config()
    except RuntimeError:
        sys.exit(1)
    uvicorn.run(app, host=API_BIND_HOST, port=API_BIND_PORT)