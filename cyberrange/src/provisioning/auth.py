"""Keycloak token validation for the provision API."""
import os
import logging
from typing import Optional

import requests
from fastapi import Depends, HTTPException, Header

from introspect_cache import get_cached, store
from secrets_loader import get_secret, SecretsConfigError

logger = logging.getLogger("provision_api")

AUTH_ENABLED = os.getenv("AUTH_ENABLED", "true").lower() != "false"
KEYCLOAK_INTROSPECT = os.getenv("KEYCLOAK_INTROSPECT_URL")
KEYCLOAK_CLIENT_ID = os.getenv("KEYCLOAK_CLIENT_ID", "portal")
# Env / SECRETS_FILE today; Vault stub fails closed if VAULT_* is set (TRB cond 8).
try:
    KEYCLOAK_CLIENT_SECRET = get_secret("KEYCLOAK_CLIENT_SECRET", required=False, default=None)
except SecretsConfigError as e:
    # Vault half-config must surface at import/startup, not as a silent empty secret.
    KEYCLOAK_CLIENT_SECRET = None
    _SECRETS_LOADER_ERROR = e
else:
    _SECRETS_LOADER_ERROR = None


def probe_introspection(timeout: float) -> requests.Response:
    """POST a throwaway token to the introspection endpoint with the API's own
    client credentials. Keycloak answers 200 {"active": false} when the realm
    and client are healthy, 401 when the client credentials are rejected.
    Shared by the startup check and Admin infra-health (#55). Raises
    requests.RequestException on network failure or timeout."""
    return requests.post(
        KEYCLOAK_INTROSPECT,
        auth=(KEYCLOAK_CLIENT_ID, KEYCLOAK_CLIENT_SECRET),
        data={"token": "health-probe"},
        timeout=timeout,
    )


def validate_auth_config() -> None:
    if not AUTH_ENABLED:
        # caller_identity() falls back to the client-supplied identity when
        # auth is off, so require_owner() always passes for any client that
        # can reach this API -- destroy, verify, lab-urls, everything. This is
        # a deliberate bootstrap-mode escape hatch, not a hardened posture
        # (branch-review Issue 2). Loud at startup so it cannot be left on by
        # accident.
        logger.critical(
            "AUTH_ENABLED=false: ownership checks fall back to client-supplied "
            "identity -- this is a FULL AUTHORIZATION BYPASS for any client "
            "that can reach this API. Use only for local/host-bound bootstrap; "
            "API_BIND_HOST must not be LAN- or WAN-reachable in this mode."
        )
    if _SECRETS_LOADER_ERROR is not None:
        logger.critical("secrets_loader error: %s", _SECRETS_LOADER_ERROR)
        raise RuntimeError(str(_SECRETS_LOADER_ERROR)) from _SECRETS_LOADER_ERROR
    if AUTH_ENABLED and not KEYCLOAK_CLIENT_SECRET:
        logger.critical("KEYCLOAK_CLIENT_SECRET is not set; refusing to start (AUTH_ENABLED=true)")
        raise RuntimeError("KEYCLOAK_CLIENT_SECRET must be set when AUTH_ENABLED=true")
    if AUTH_ENABLED and not KEYCLOAK_INTROSPECT:
        logger.critical("KEYCLOAK_INTROSPECT_URL is not set; refusing to start (AUTH_ENABLED=true)")
        raise RuntimeError("KEYCLOAK_INTROSPECT_URL must be set when AUTH_ENABLED=true")
    if AUTH_ENABLED and KEYCLOAK_INTROSPECT:
        # Non-fatal: a slow-starting Keycloak must not block the API. This turns
        # a config error that previously ran silently for 11 days into a CRITICAL
        # log line at second zero, without making startup depend on the dependency.
        try:
            probe = probe_introspection(timeout=6)
            if probe.status_code not in (200, 401):
                logger.critical(
                    "Introspect endpoint %s answered HTTP %s (expect 200/401)",
                    KEYCLOAK_INTROSPECT, probe.status_code,
                )
        except Exception as e:
            logger.critical("Introspect endpoint %s is UNREACHABLE at startup: %s", KEYCLOAK_INTROSPECT, e)


def verify_token(authorization: Optional[str] = Header(None)) -> dict:
    if not AUTH_ENABLED:
        return {}
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing or malformed Authorization header")
    token = authorization.split(" ", 1)[1].strip()
    cached = get_cached(token)
    if cached is not None:
        return cached
    try:
        r = requests.post(
            KEYCLOAK_INTROSPECT,
            auth=(KEYCLOAK_CLIENT_ID, KEYCLOAK_CLIENT_SECRET),
            data={"token": token},
            timeout=6,
        )
        r.raise_for_status()
        claims = r.json()
    except Exception as e:
        logger.error("Keycloak introspection failed for %s: %s", KEYCLOAK_INTROSPECT, e)
        raise HTTPException(status_code=503, detail="Auth service unavailable")
    if not claims.get("active"):
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    store(token, claims)
    return claims


def caller_identity(claims: dict, fallback: Optional[str] = None) -> Optional[str]:
    if not AUTH_ENABLED:
        return fallback
    return claims.get("preferred_username")


def extract_roles(claims: dict) -> list:
    """Extract accepted realm and portal client roles from Keycloak claims."""
    roles = []
    if not claims:
        return roles
    realm_access = claims.get("realm_access", {})
    if isinstance(realm_access, dict):
        roles.extend(realm_access.get("roles", []))
    resource_access = claims.get("resource_access", {})
    if isinstance(resource_access, dict):
        portal_access = resource_access.get(KEYCLOAK_CLIENT_ID, {})
        if isinstance(portal_access, dict):
            roles.extend(portal_access.get("roles", []))
    return list(set(roles))


def require_role(required_roles: list, claims: dict) -> None:
    """Ensure the caller has at least one of the specified roles."""
    if not AUTH_ENABLED:
        return
    user_roles = extract_roles(claims)
    if not any(role in user_roles for role in required_roles):
        raise HTTPException(status_code=403, detail="Forbidden: Insufficient privileges")


# The three application roles (AUTH-03 contract). Keycloak-internal roles
# (offline_access, uma_authorization, default-roles-cyber-range) never count.
APP_ROLES = ("student", "instructor", "admin")


def require_app_role(claims: dict = Depends(verify_token)) -> dict:
    """Router-level guard (SEC-01 #36): authenticated AND holding at least one
    application role.

    AUTH-03's policy is that an account with no application role is
    unauthorized. The portal enforces that for pages (middleware.ts ->
    /no-role), but the self-scoped Student routes (provision, progress,
    reviews, pod status/lab access) only checked *who* was calling, so a
    role-less account could skip /no-role by calling /api/* or the backend
    directly. Attached to whole routers so a new route cannot forget it.
    Instructor/Admin-only routes still add their narrower require_role().
    """
    require_role(list(APP_ROLES), claims)
    return claims


def require_owner(pod_row, claims: dict) -> None:
    owner = pod_row["student_id"]
    caller = caller_identity(claims, owner)
    if caller != owner:
        raise HTTPException(status_code=404, detail="Pod not found")


def require_owner_or_admin(pod_row, claims: dict) -> None:
    """Owner may proceed; Admin may proceed for any pod; others get 404 (same as require_owner)."""
    if not AUTH_ENABLED:
        return
    owner = pod_row["student_id"]
    caller = caller_identity(claims, owner)
    if caller == owner:
        return
    if "admin" in extract_roles(claims):
        return
    raise HTTPException(status_code=404, detail="Pod not found")