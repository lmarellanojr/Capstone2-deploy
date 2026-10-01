"""ADM-USER (issue #32): Admin-only Keycloak user & role management.

Every route here is Admin-only (require_role(["admin"])) and every write is
recorded in audit_log. There is deliberately no unauthenticated or
self-service route: accounts are created by an Admin, never by signup.

Contract for the portal Admin UI: docs/ADM-USER-contract.md.
"""
import logging
import threading
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from pydantic import BaseModel, ConfigDict, Field

import auth
import introspect_cache
from auth import caller_identity, verify_token
from db import log_event
from keycloak_admin import (
    KeycloakAdminClient,
    KeycloakAdminError,
    KeycloakConflict,
    KeycloakNotConfigured,
    KeycloakNotFound,
    KeycloakRejected,
    get_client,
    primary_role,
)

logger = logging.getLogger("provision_api")

router = APIRouter()

AppRole = Literal["student", "instructor", "admin"]

# Stricter than models.STUDENT_ID_PATTERN on purpose: Keycloak lower-cases
# usernames on write, and the username becomes student_id -- embedded in LXD
# instance names (pod-{student_id}-kali) -- so an upper-case request would be
# stored and audited under a different string than the one sent.
USERNAME_PATTERN = r"^[a-z0-9][a-z0-9_.-]{0,31}$"
EMAIL_PATTERN = r"^[^@\s]+@[^@\s]+$"
# Keycloak user ids are UUIDs; reject anything else before it reaches a URL path.
USER_ID_PATTERN = r"^[0-9a-fA-F-]{36}$"


class CreateUserRequest(BaseModel):
    # extra="forbid": callers cannot smuggle raw Keycloak fields
    # (realmRoles, clientRoles, attributes, credentials...) through this API.
    model_config = ConfigDict(extra="forbid")

    username: str = Field(..., pattern=USERNAME_PATTERN)
    email: Optional[str] = Field(None, max_length=254, pattern=EMAIL_PATTERN)
    first_name: Optional[str] = Field(None, max_length=64)
    last_name: Optional[str] = Field(None, max_length=64)
    role: AppRole
    password: str = Field(..., min_length=8, max_length=128)
    # True = Keycloak forces a password change at first login.
    temporary_password: bool = True


class SetEnabledRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool


class SetRoleRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: AppRole


class SetPasswordRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    password: str = Field(..., min_length=8, max_length=128)
    # True = Keycloak forces a password change at the user's next sign-in.
    temporary: bool = True


def _iso(ms: Optional[int]) -> Optional[str]:
    if not ms:
        return None
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def serialize_user(user: dict, roles: list[str]) -> dict:
    app_roles = sorted(roles)
    return {
        "id": user["id"],
        "username": user.get("username"),
        "email": user.get("email"),
        "first_name": user.get("firstName"),
        "last_name": user.get("lastName"),
        "enabled": bool(user.get("enabled")),
        # Single role per AUTH-03 (admin > instructor > student precedence if a
        # user somehow holds several); null = no application role.
        "role": primary_role(app_roles),
        "roles": app_roles,
        "created_at": _iso(user.get("createdTimestamp")),
    }


def _require_admin(claims: dict) -> str:
    auth.require_role(["admin"], claims)
    return caller_identity(claims) or "unknown"


def _audit(event: str, target: Optional[str], result: str, actor: str, detail: str = "") -> None:
    # Never pass passwords or tokens in `detail`.
    text = f"actor={actor}" + (f" {detail}" if detail else "")
    try:
        log_event(event, student_id=target or "", result=result, detail=text)
    except Exception:
        # An audit-DB hiccup must not be silent, but the Keycloak write has
        # already happened by the time most audits run.
        logger.exception("ADM-USER audit write failed: %s %s %s", event, target, result)


def _unavailable(e: Exception) -> HTTPException:
    if isinstance(e, KeycloakNotConfigured):
        logger.error("ADM-USER: %s", e)
        return HTTPException(status_code=503, detail="User management is not configured")
    logger.error("ADM-USER: Keycloak admin call failed: %s", e)
    return HTTPException(status_code=503, detail="User management service unavailable")


def _load_target(kc: KeycloakAdminClient, user_id: str) -> dict:
    try:
        return kc.get_user(user_id)
    except KeycloakNotFound:
        raise HTTPException(status_code=404, detail="User not found")
    except KeycloakAdminError as e:
        raise _unavailable(e)


def _reject_self(target: dict, actor: str, event: str, detail: str) -> None:
    # An Admin can never disable or demote themselves. Together with
    # _confirm_actor_still_admin (the actor is a freshly verified, enabled Admin
    # who is not the target), this is what keeps at least one enabled Admin.
    if target.get("username") == actor:
        _audit(event, target.get("username"), "DENIED", actor, f"{detail} reason=self".strip())
        raise HTTPException(
            status_code=409, detail="Admins cannot disable or change the role of their own account"
        )


# Serializes every user-management write in this process (the API runs as a
# single uvicorn worker). A request that passed verify_token before a
# concurrent revoke finishes therefore re-checks its caller only after that
# revoke has landed, instead of racing it.
_write_lock = threading.Lock()


def _confirm_actor_still_admin(kc: KeycloakAdminClient, actor: str, event: str, target: Optional[str], detail: str) -> list[dict]:
    """Re-check the caller against Keycloak for every write.

    verify_token may answer from the introspection cache for up to 60s, so a
    just-disabled or just-demoted Admin could otherwise keep writing (e.g.
    create a new admin, or revoke the Admin who revoked them). Returns the
    fresh list of enabled Admins for the last-Admin guard.
    """
    try:
        admins = kc.enabled_admins()
    except KeycloakAdminError as e:
        raise _unavailable(e)
    if not any(u.get("username") == actor for u in admins):
        _audit(event, target, "DENIED", actor, f"{detail} reason=actor_not_admin".strip())
        raise HTTPException(status_code=403, detail="Forbidden: Insufficient privileges")
    return admins


def _reject_last_admin(admins: list[dict], target: dict, actor: str, event: str, detail: str) -> None:
    # Backstop invariant: never disable or demote the only remaining enabled
    # Admin. Unreachable while _reject_self + _confirm_actor_still_admin hold,
    # kept so a future change to either cannot silently empty the realm.
    if not any(u.get("id") != target["id"] for u in admins):
        _audit(event, target.get("username"), "DENIED", actor, f"{detail} reason=last_admin".strip())
        raise HTTPException(status_code=409, detail="Cannot disable or demote the last enabled Admin")


def _revoke_cached_tokens(user_id: str, username: Optional[str]) -> None:
    # Keycloak logout makes introspection report the user's tokens inactive,
    # but verify_token would keep serving cached claims for up to 60s.
    introspect_cache.invalidate_user(sub=user_id, username=username)


@router.get("/admin/users")
def admin_list_users(
    search: Optional[str] = Query(None, max_length=64),
    first: int = Query(0, ge=0),
    max_results: int = Query(100, ge=1, le=200, alias="max"),
    claims: dict = Depends(verify_token),
    kc: KeycloakAdminClient = Depends(get_client),
):
    _require_admin(claims)
    try:
        users = kc.list_users(search=search, first=first, max_results=max_results)
        members = kc.app_role_members()
    except KeycloakAdminError as e:
        raise _unavailable(e)
    return {"users": [serialize_user(u, members.get(u["id"], [])) for u in users]}


@router.post("/admin/users", status_code=status.HTTP_201_CREATED)
def admin_create_user(
    body: CreateUserRequest,
    claims: dict = Depends(verify_token),
    kc: KeycloakAdminClient = Depends(get_client),
):
    actor = _require_admin(claims)
    detail = f"role={body.role}"
    with _write_lock:
        _confirm_actor_still_admin(kc, actor, "ADMIN_USER_CREATE", body.username, detail)
        return _create_user_locked(body, actor, detail, kc)


def _create_user_locked(body: CreateUserRequest, actor: str, detail: str, kc: KeycloakAdminClient) -> dict:
    try:
        user_id = kc.create_user(
            username=body.username,
            email=body.email,
            first_name=body.first_name,
            last_name=body.last_name,
        )
    except KeycloakConflict:
        _audit("ADMIN_USER_CREATE", body.username, "FAILED", actor, f"{detail} reason=exists")
        raise HTTPException(status_code=409, detail="Username or email already exists")
    except KeycloakRejected:
        _audit("ADMIN_USER_CREATE", body.username, "FAILED", actor, f"{detail} reason=rejected")
        raise HTTPException(status_code=422, detail="Keycloak rejected the user details")
    except KeycloakAdminError as e:
        _audit("ADMIN_USER_CREATE", body.username, "FAILED", actor, f"{detail} reason=keycloak")
        raise _unavailable(e)

    try:
        kc.set_password(user_id, body.password, body.temporary_password)
        kc.set_app_role(user_id, body.role)
        user = kc.get_user(user_id)
    except KeycloakAdminError as e:
        # Never leave a half-built account (no password / no role) behind.
        try:
            kc.delete_user(user_id)
            rollback = "rolled_back"
        except KeycloakAdminError:
            logger.critical("ADM-USER: rollback of partially created user %s FAILED", body.username)
            rollback = "rollback_failed"
        if isinstance(e, KeycloakRejected):
            # 400 from reset-password = the realm password policy said no.
            _audit("ADMIN_USER_CREATE", body.username, "FAILED", actor, f"{detail} reason=password_policy {rollback}")
            raise HTTPException(status_code=422, detail="Password does not meet the Keycloak password policy")
        _audit("ADMIN_USER_CREATE", body.username, "FAILED", actor, f"{detail} reason=keycloak {rollback}")
        raise _unavailable(e)

    _audit("ADMIN_USER_CREATE", body.username, "OK", actor, f"{detail} temporary_password={body.temporary_password}")
    return serialize_user(user, [body.role])


@router.patch("/admin/users/{user_id}/enabled")
def admin_set_user_enabled(
    body: SetEnabledRequest,
    user_id: str = Path(..., pattern=USER_ID_PATTERN),
    claims: dict = Depends(verify_token),
    kc: KeycloakAdminClient = Depends(get_client),
):
    actor = _require_admin(claims)
    event = "ADMIN_USER_ENABLE" if body.enabled else "ADMIN_USER_DISABLE"
    with _write_lock:
        target = _load_target(kc, user_id)
        username = target.get("username")
        admins = _confirm_actor_still_admin(kc, actor, event, username, "")
        _reject_self(target, actor, event, "")
        if not body.enabled and any(u.get("id") == user_id for u in admins):
            _reject_last_admin(admins, target, actor, event, "")
        try:
            kc.set_enabled(user_id, body.enabled)
            if not body.enabled:
                # Disabling alone blocks new logins; ending sessions also kills
                # refresh tokens and makes introspection report the current
                # access token inactive.
                kc.logout_user(user_id)
            roles = kc.user_app_roles(user_id)
            target = kc.get_user(user_id)
        except KeycloakAdminError as e:
            _audit(event, username, "FAILED", actor, "reason=keycloak")
            raise _unavailable(e)
        finally:
            if not body.enabled:
                _revoke_cached_tokens(user_id, username)
    _audit(event, username, "OK", actor)
    return serialize_user(target, roles)


@router.put("/admin/users/{user_id}/role")
def admin_set_user_role(
    body: SetRoleRequest,
    user_id: str = Path(..., pattern=USER_ID_PATTERN),
    claims: dict = Depends(verify_token),
    kc: KeycloakAdminClient = Depends(get_client),
):
    actor = _require_admin(claims)
    event = "ADMIN_USER_ROLE_SET"
    detail = f"role={body.role}"
    with _write_lock:
        target = _load_target(kc, user_id)
        username = target.get("username")
        admins = _confirm_actor_still_admin(kc, actor, event, username, detail)
        _reject_self(target, actor, event, detail)
        if body.role != "admin" and any(u.get("id") == user_id for u in admins):
            _reject_last_admin(admins, target, actor, event, detail)
        previous: list[str] = []
        try:
            previous = kc.user_app_roles(user_id)
            kc.set_app_role(user_id, body.role)
            if previous != [body.role]:
                # A demoted user's existing access token still carries the old
                # role until it expires; ending sessions makes introspection
                # reject it, so the change applies at next sign-in.
                kc.logout_user(user_id)
            roles = kc.user_app_roles(user_id)
        except KeycloakAdminError as e:
            _audit(event, username, "FAILED", actor, f"{detail} reason=keycloak")
            raise _unavailable(e)
        finally:
            if previous != [body.role]:
                _revoke_cached_tokens(user_id, username)
    _audit(event, username, "OK", actor, f"{detail} previous={','.join(previous) or 'none'}")
    return serialize_user(target, roles)


@router.put("/admin/users/{user_id}/password")
def admin_reset_user_password(
    body: SetPasswordRequest,
    user_id: str = Path(..., pattern=USER_ID_PATTERN),
    claims: dict = Depends(verify_token),
    kc: KeycloakAdminClient = Depends(get_client),
):
    """Set a new password for another user (e.g. a student locked out).

    Same guards as every other user write: Admin-only, the caller re-checked
    against Keycloak, serialized. An Admin can't reset their own password here
    (they use their own Keycloak account page), so this can never lock the
    acting Admin out. Existing sessions are ended so a leaked password stops
    working immediately. The password is never returned, logged or audited.
    """
    actor = _require_admin(claims)
    event = "ADMIN_USER_PASSWORD_RESET"
    detail = f"temporary={body.temporary}"
    with _write_lock:
        target = _load_target(kc, user_id)
        username = target.get("username")
        _confirm_actor_still_admin(kc, actor, event, username, detail)
        if target.get("username") == actor:
            _audit(event, username, "DENIED", actor, f"{detail} reason=self")
            raise HTTPException(
                status_code=409,
                detail="Admins can't reset their own password here; use your Keycloak account page",
            )
        try:
            kc.set_password(user_id, body.password, body.temporary)
        except KeycloakRejected:
            _audit(event, username, "FAILED", actor, f"{detail} reason=password_policy")
            raise HTTPException(status_code=422, detail="Password does not meet the Keycloak password policy")
        except KeycloakAdminError as e:
            _audit(event, username, "FAILED", actor, f"{detail} reason=keycloak")
            raise _unavailable(e)
        try:
            kc.logout_user(user_id)
            roles = kc.user_app_roles(user_id)
            target = kc.get_user(user_id)
        except KeycloakAdminError as e:
            # The password DID change; report the failure honestly rather than
            # claim the old sessions were ended.
            _audit(event, username, "FAILED", actor, f"{detail} reason=keycloak_after_set")
            raise _unavailable(e)
        finally:
            _revoke_cached_tokens(user_id, username)
    _audit(event, username, "OK", actor, detail)
    return serialize_user(target, roles)
