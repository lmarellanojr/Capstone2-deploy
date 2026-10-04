"""Keycloak Admin REST client for ADM-USER (issue #32).

Server-side only. Authenticates as the service account of a dedicated
confidential client (KEYCLOAK_USER_ADMIN_CLIENT_ID, default
`cyberrange-user-admin`) that holds realm-management view-users / query-users /
manage-users in the cyber-range realm and nothing else -- see
deploy/host/setup_user_admin_client.sh. The `portal` client secret is
deliberately NOT reused here: it also lives on the Next.js server, and
manage-users is a much bigger blast radius than token introspection.

This module only speaks HTTP to Keycloak. Authorization (Admin-only), role
constraints, self-protection and auditing live in users_router.py.
"""
from __future__ import annotations

import logging
import os
import re
import threading
import time
from typing import Optional

import requests

from secrets_loader import SecretsConfigError, get_secret

logger = logging.getLogger("provision_api")

# The only realm roles this API will ever read as "application roles" or
# assign/remove. Keycloak-internal roles (default-roles-cyber-range,
# offline_access, uma_authorization) are never touched -- AUTH-03 contract.
APP_ROLES = ("student", "instructor", "admin")
# Routing precedence from docs/AUTH-03-role-contract.md (admin > instructor > student).
_ROLE_PRECEDENCE = ("admin", "instructor", "student")

SERVICE_ACCOUNT_PREFIX = "service-account-"
# Upper bound for the role-membership lookups used to label the user list. The
# prototype realm holds tens of users; this keeps one bad realm from turning a
# list call into an unbounded fetch.
ROLE_MEMBER_LIMIT = 1000

_INTROSPECT_RE = re.compile(r"^(?P<base>.+)/realms/(?P<realm>[^/]+)/protocol/openid-connect/token/introspect/?$")


class KeycloakAdminError(RuntimeError):
    """Keycloak unreachable, misconfigured, or answered unexpectedly."""


class KeycloakNotConfigured(KeycloakAdminError):
    """User-management credentials are not set on this deployment."""


class KeycloakConflict(KeycloakAdminError):
    """Keycloak rejected a write as a duplicate (HTTP 409)."""


class KeycloakNotFound(KeycloakAdminError):
    """Target user (or role) does not exist in the realm."""


class KeycloakRejected(KeycloakAdminError):
    """Keycloak refused the input (HTTP 400), e.g. the realm password policy."""


def _derive_base_and_realm() -> tuple[Optional[str], Optional[str]]:
    base = os.getenv("KEYCLOAK_BASE_URL", "").strip() or None
    realm = os.getenv("KEYCLOAK_REALM", "").strip() or None
    if base and realm:
        return base.rstrip("/"), realm
    # Fall back to the introspection URL every deployment already sets, so no
    # new URL has to be kept in sync by hand.
    m = _INTROSPECT_RE.match(os.getenv("KEYCLOAK_INTROSPECT_URL", "").strip())
    if m:
        return (base or m.group("base")).rstrip("/"), realm or m.group("realm")
    return base, realm


def primary_role(roles: list[str]) -> Optional[str]:
    for role in _ROLE_PRECEDENCE:
        if role in roles:
            return role
    return None


class KeycloakAdminClient:
    def __init__(
        self,
        base_url: Optional[str],
        realm: Optional[str],
        client_id: Optional[str],
        client_secret: Optional[str],
        session: Optional[requests.Session] = None,
        timeout: float = 6.0,
    ):
        self.base_url = base_url.rstrip("/") if base_url else None
        self.realm = realm
        self.client_id = client_id
        self.client_secret = client_secret
        self.session = session or requests.Session()
        self.timeout = timeout
        self._token: Optional[str] = None
        self._token_expires_at = 0.0
        self._lock = threading.Lock()

    @property
    def configured(self) -> bool:
        return bool(self.base_url and self.realm and self.client_id and self.client_secret)

    # --- transport -------------------------------------------------------

    def _admin_url(self, path: str) -> str:
        return f"{self.base_url}/admin/realms/{self.realm}{path}"

    def _get_token(self) -> str:
        if not (self.configured and self.client_id and self.client_secret):
            raise KeycloakNotConfigured("Keycloak user-management client is not configured")
        client_auth = (self.client_id, self.client_secret)
        with self._lock:
            if self._token and time.time() < self._token_expires_at:
                return self._token
            try:
                r = self.session.post(
                    f"{self.base_url}/realms/{self.realm}/protocol/openid-connect/token",
                    auth=client_auth,
                    data={"grant_type": "client_credentials"},
                    timeout=self.timeout,
                )
            except requests.RequestException as e:
                raise KeycloakAdminError(f"token endpoint unreachable: {e}") from e
            if r.status_code != 200:
                # 401 here = wrong client secret or service accounts disabled.
                raise KeycloakAdminError(f"service-account token request failed: HTTP {r.status_code}")
            body = r.json()
            self._token = body["access_token"]
            # Refresh 30s early so a token never expires mid-request.
            self._token_expires_at = time.time() + max(float(body.get("expires_in", 60)) - 30, 5)
            return self._token

    def _request(self, method: str, path: str, *, expected=(200, 204), **kwargs) -> requests.Response:
        token = self._get_token()
        headers = {"Authorization": f"Bearer {token}"}
        try:
            r = self.session.request(
                method, self._admin_url(path), headers=headers, timeout=self.timeout, **kwargs
            )
        except requests.RequestException as e:
            raise KeycloakAdminError(f"{method} {path} unreachable: {e}") from e
        if r.status_code in expected:
            return r
        if r.status_code == 404:
            raise KeycloakNotFound(f"{method} {path}: not found")
        if r.status_code == 409:
            raise KeycloakConflict(f"{method} {path}: conflict")
        if r.status_code == 400:
            raise KeycloakRejected(f"{method} {path}: rejected by Keycloak")
        if r.status_code in (401, 403):
            # The service account is missing realm-management roles, or the
            # cached token was revoked. Drop it so the next call re-mints.
            with self._lock:
                self._token = None
            raise KeycloakAdminError(
                f"{method} {path}: HTTP {r.status_code} (service account lacks realm-management permissions?)"
            )
        raise KeycloakAdminError(f"{method} {path}: HTTP {r.status_code}")

    # --- users -----------------------------------------------------------

    def get_user(self, user_id: str) -> dict:
        user = self._request("GET", f"/users/{user_id}").json()
        if user.get("username", "").startswith(SERVICE_ACCOUNT_PREFIX):
            # Service-account users are Keycloak plumbing, never manageable here.
            raise KeycloakNotFound(f"user {user_id}: not found")
        return user

    def list_users(self, *, search: Optional[str], first: int, max_results: int) -> list[dict]:
        params: dict = {"first": first, "max": max_results, "briefRepresentation": "true"}
        if search:
            params["search"] = search
        users = self._request("GET", "/users", params=params).json()
        return [u for u in users if not u.get("username", "").startswith(SERVICE_ACCOUNT_PREFIX)]

    def app_role_members(self) -> dict[str, list[str]]:
        """user id -> application roles held, via one call per app role (not N+1 per user)."""
        members: dict[str, list[str]] = {}
        for role in APP_ROLES:
            users = self._request(
                "GET", f"/roles/{role}/users", params={"first": 0, "max": ROLE_MEMBER_LIMIT}
            ).json()
            for u in users:
                members.setdefault(u["id"], []).append(role)
        return members

    def enabled_admins(self) -> list[dict]:
        """Enabled users holding the `admin` realm role, read fresh from Keycloak
        (never from the introspection cache). Direct role members only -- this
        API only ever assigns roles directly, never via groups or composites."""
        users = self._request(
            "GET", "/roles/admin/users", params={"first": 0, "max": ROLE_MEMBER_LIMIT}
        ).json()
        return [
            u for u in users
            if u.get("enabled") and not u.get("username", "").startswith(SERVICE_ACCOUNT_PREFIX)
        ]

    def user_app_roles(self, user_id: str) -> list[str]:
        mappings = self._request("GET", f"/users/{user_id}/role-mappings/realm").json()
        return [m["name"] for m in mappings if m.get("name") in APP_ROLES]

    def create_user(
        self,
        *,
        username: str,
        email: Optional[str],
        first_name: Optional[str],
        last_name: Optional[str],
    ) -> str:
        payload = {
            "username": username,
            "enabled": True,
            # Test accounts: no email round-trip before first login.
            "emailVerified": bool(email),
            "requiredActions": [],
        }
        if email:
            payload["email"] = email
        if first_name:
            payload["firstName"] = first_name
        if last_name:
            payload["lastName"] = last_name
        r = self._request("POST", "/users", json=payload, expected=(201,))
        location = r.headers.get("Location", "")
        user_id = location.rstrip("/").rsplit("/", 1)[-1]
        if not user_id or "/users/" not in location:
            raise KeycloakAdminError("user created but Keycloak returned no Location header")
        return user_id

    def set_password(self, user_id: str, password: str, temporary: bool) -> None:
        self._request(
            "PUT",
            f"/users/{user_id}/reset-password",
            json={"type": "password", "value": password, "temporary": temporary},
        )

    def delete_user(self, user_id: str) -> None:
        self._request("DELETE", f"/users/{user_id}")

    def set_enabled(self, user_id: str, enabled: bool) -> None:
        # Read-modify-write: with the declarative user profile (always on in
        # Keycloak 24+, and the host runs 25.0.6), a PUT that omits
        # email / firstName / lastName / attributes can clear them. Send the
        # full current representation with only `enabled` changed.
        rep = self._request("GET", f"/users/{user_id}").json()
        rep["enabled"] = enabled
        self._request("PUT", f"/users/{user_id}", json=rep)

    def remove_otp_credentials(self, user_id: str) -> int:
        """Delete every OTP (authenticator) credential the user has; returns how many.

        SEC-03 makes the browser flow's OTP Form REQUIRED, so a user left with no
        OTP credential is sent through CONFIGURE_TOTP (QR enrolment) on their
        next sign-in. Passwords and other credential types are never touched.
        """
        creds = self._request("GET", f"/users/{user_id}/credentials").json()
        otp = [c for c in creds if c.get("type") == "otp"]
        for c in otp:
            self._request("DELETE", f"/users/{user_id}/credentials/{c['id']}")
        return len(otp)

    def logout_user(self, user_id: str) -> None:
        """End every session so refresh tokens stop working and introspection reports inactive."""
        self._request("POST", f"/users/{user_id}/logout")

    def set_app_role(self, user_id: str, role: str) -> None:
        """Make `role` the user's only application role; non-app realm roles are left alone."""
        if role not in APP_ROLES:
            raise ValueError(f"role must be one of {APP_ROLES}")
        current = self._request("GET", f"/users/{user_id}/role-mappings/realm").json()
        to_remove = [m for m in current if m.get("name") in APP_ROLES and m.get("name") != role]
        if not any(m.get("name") == role for m in current):
            role_rep = self._request("GET", f"/roles/{role}").json()
            self._request(
                "POST", f"/users/{user_id}/role-mappings/realm", json=[{"id": role_rep["id"], "name": role_rep["name"]}]
            )
        if to_remove:
            self._request(
                "DELETE",
                f"/users/{user_id}/role-mappings/realm",
                json=[{"id": m["id"], "name": m["name"]} for m in to_remove],
            )


_client: Optional[KeycloakAdminClient] = None
_client_lock = threading.Lock()


def get_client() -> KeycloakAdminClient:
    """FastAPI dependency. Built lazily so an unconfigured deployment still starts
    (student flows must not depend on user management) and simply answers 503."""
    global _client
    with _client_lock:
        if _client is None:
            base, realm = _derive_base_and_realm()
            try:
                secret = get_secret("KEYCLOAK_USER_ADMIN_CLIENT_SECRET", required=False, default=None)
            except SecretsConfigError as e:
                logger.critical("secrets_loader error for user-admin client: %s", e)
                secret = None
            _client = KeycloakAdminClient(
                base_url=base,
                realm=realm,
                client_id=os.getenv("KEYCLOAK_USER_ADMIN_CLIENT_ID", "cyberrange-user-admin"),
                client_secret=secret,
            )
            if not _client.configured:
                logger.warning(
                    "ADM-USER: KEYCLOAK_USER_ADMIN_CLIENT_SECRET / Keycloak base URL not set; "
                    "/admin/users endpoints will answer 503"
                )
        return _client
