"""Cyber Range Pod Provisioning API — thin entrypoint."""
import asyncio
import logging
import sys

import urllib3
from fastapi import FastAPI

from auth import require_owner as real_require_owner
from auth import validate_auth_config
from auth import verify_token as real_verify_token
import alerts_endpoint as ae
from capacity import (
    POD_RAM_MB,
    RAM_BUFFER_MB,
    available_ram_mb,
    can_provision_ram,
    ram_required_mb,
    validate_capacity_config,
)
from config import API_BIND_HOST, API_BIND_PORT, MAX_PODS, POD_TTL_HOURS, REAP_INTERVAL_SECONDS, PROFILE_NAME
from db import get_db_connection, init_db
from logging_config import configure_logging
from pods_router import router as pods_router
from reaper import pod_ttl_reaper
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
app.include_router(ae.alerts_router)
app.dependency_overrides[ae.verify_token_dep] = real_verify_token
ae.require_owner = real_require_owner
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
async def start_reaper():
    asyncio.create_task(pod_ttl_reaper())
    logger.info(
        "Pod TTL reaper started",
        extra={
            "event": "api_startup",
            "detail": f"TTL={POD_TTL_HOURS}h interval={REAP_INTERVAL_SECONDS}s",
        },
    )
    if scoring_state.SCORING_ENABLED:
        logger.info("Phase 7: Agentless scoring enabled")
    else:
        logger.warning("Phase 7: Agentless scoring disabled (ssh_verifier not available)")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/capacity")
def capacity_status():
    conn = get_db_connection()
    active = conn.execute(
        "SELECT COUNT(*) FROM pods WHERE status NOT IN ('DESTROYED', 'FAILED_ROLLBACK_COMPLETE')"
    ).fetchone()[0]
    conn.close()
    avail = available_ram_mb()
    return {
        "available_mb": avail,
        "active_pods": active,
        "max_pods": MAX_PODS,
        "pod_ram_mb": POD_RAM_MB,
        "ram_buffer_mb": RAM_BUFFER_MB,
        "profile": PROFILE_NAME,
        # Free headroom needed to admit ONE more pod -- not a fleet total.
        "ram_required_mb": ram_required_mb(),
        "can_provision": active < MAX_PODS and can_provision_ram(avail),
    }


if __name__ == "__main__":
    import uvicorn

    try:
        validate_auth_config()
    except RuntimeError:
        sys.exit(1)
    uvicorn.run(app, host=API_BIND_HOST, port=API_BIND_PORT)