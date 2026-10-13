"""Shared-secret endpoint used by the booking Apps Script to provision a tester."""
from __future__ import annotations

import hashlib
import hmac
import logging
import re
import secrets
import string
import uuid

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator

import credential_email
from db import get_db_connection
from keycloak_admin import KeycloakAdminClient, KeycloakAdminError, KeycloakConflict, KeycloakRejected, get_client, primary_role
from secrets_loader import SecretsConfigError, get_secret

logger = logging.getLogger("provision_api")
router = APIRouter()
EMAIL_DOMAIN = "@mmdc.mcl.edu.ph"
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
CLAIM_TTL_SECONDS = 120


class BookingProvisionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: str = Field(max_length=254)

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        value = value.strip()
        if not EMAIL_RE.fullmatch(value):
            raise ValueError("invalid email")
        return value


def _claim(email: str, owner: str) -> str:
    """Claim normalized email in the shared SQLite DB before contacting Keycloak."""
    conn = get_db_connection()
    try:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT owner_token, status, updated_at FROM booking_account_claims WHERE email = ?", (email,)).fetchone()
        if row:
            age = conn.execute("SELECT (julianday('now') - julianday(?)) * 86400", (row["updated_at"],)).fetchone()[0]
            if row["status"] == "failed":
                # A later explicit booking may retry a known failed attempt.
                # _perform first checks Keycloak and will never reset any match.
                conn.execute(
                    "UPDATE booking_account_claims SET owner_token=?, status='creating', updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE email=? AND status='failed'",
                    (owner, email),
                )
                conn.commit()
                return "owner"
            if row["status"] in {"created", "existing"}:
                return "existing_check"
            if row["status"] == "email_failed":
                return "email_failed_check"
            if row["status"] == "needs_review":
                return "needs_review"
            if age is None or age < CLAIM_TTL_SECONDS:
                return "pending"
            # A crash/timeout may have happened after Keycloak created the user.
            # A stale claim is never retried automatically.
            conn.execute("UPDATE booking_account_claims SET status='needs_review', updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE email=?", (email,))
            conn.commit()
            return "needs_review"
        conn.execute("INSERT INTO booking_account_claims(email, owner_token, status) VALUES (?, ?, 'creating')", (email, owner))
        conn.commit()
        return "owner"
    finally:
        conn.close()


def _finish(email: str, owner: str, status: str) -> bool:
    conn = get_db_connection()
    try:
        with conn:
            cur = conn.execute(
                "UPDATE booking_account_claims SET status=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE email=? AND owner_token=? AND status='creating'",
                (status, email, owner),
            )
            return cur.rowcount == 1
    finally:
        conn.close()


def _username(email: str) -> str:
    local = email.split("@", 1)[0].lower()
    clean = "".join(c if c in string.ascii_lowercase + string.digits + "_.-" else "-" for c in local).strip("_.-") or "tester"
    suffix = hashlib.sha256(email.encode("utf-8")).hexdigest()[:8]
    return (clean[:23].rstrip("_.-") or "tester") + "-" + suffix


def _temporary_password() -> str:
    alphabet = string.ascii_letters + string.digits + "!@#$%*-_"
    # Seed each character class to satisfy typical realm policies; Keycloak
    # remains the authority and can reject the value under its configured policy.
    parts = [secrets.choice(string.ascii_lowercase), secrets.choice(string.ascii_uppercase), secrets.choice(string.digits), secrets.choice("!@#$%*-_")]
    parts.extend(secrets.choice(alphabet) for _ in range(28))
    secrets.SystemRandom().shuffle(parts)
    return "".join(parts)


def _find_exact(kc: KeycloakAdminClient, email: str) -> list[dict]:
    return [u for u in kc.find_users_by_email(email) if str(u.get("email", "")).lower() == email]


def _perform(email: str, kc: KeycloakAdminClient) -> tuple[str, str | None, str]:
    found = _find_exact(kc, email)
    if found:
        if len(found) != 1:
            return "needs_review", None, "skipped"
        user = found[0]
        roles = kc.user_app_roles(user["id"])
        if not user.get("enabled") or primary_role(roles) != "student" or set(roles) != {"student"}:
            return "needs_review", None, "skipped"
        return "existing", user.get("username"), "skipped"

    username = _username(email)
    password = _temporary_password()
    try:
        user_id = kc.create_user(username=username, email=email, first_name=None, last_name=None)
    except KeycloakConflict:
        try:
            found = _find_exact(kc, email)
        except KeycloakAdminError:
            return "needs_review", None, "skipped"
        if len(found) == 1:
            return _perform_existing(found[0], kc)
        return "needs_review", None, "skipped"
    except KeycloakRejected:
        # A validation/policy rejection is a definitive non-creation response.
        return "failed", None, "skipped"
    except Exception:
        # A transport error can happen after Keycloak committed the create.
        # Do not retry automatically when the result is ambiguous.
        return "needs_review", None, "skipped"

    try:
        kc.set_password(user_id, password, True)
        kc.set_app_role(user_id, "student")
        user = kc.get_user(user_id)
        if not user.get("enabled") or user.get("email", "").lower() != email or primary_role(kc.user_app_roles(user_id)) != "student":
            raise KeycloakAdminError("new account failed readiness check")
    except Exception as exc:
        try:
            kc.delete_user(user_id)
        except KeycloakAdminError:
            logger.error("Booking account rollback failed; email=%s", hashlib.sha256(email.encode()).hexdigest()[:12])
            return "needs_review", None, "skipped"
        if isinstance(exc, KeycloakRejected):
            return "failed", None, "skipped"
        if isinstance(exc, KeycloakConflict):
            return "failed", None, "skipped"
        if isinstance(exc, KeycloakAdminError):
            return "failed", None, "skipped"
        return "failed", None, "skipped"
    try:
        credential_email.send_temporary_credentials(recipient=email, username=user["username"], password=password)
    except Exception as exc:
        logger.warning("Booking credential email failed: %s", type(exc).__name__)
        return "email_failed", user["username"], "failed"
    return "created", user["username"], "sent"


def _perform_existing(user: dict, kc: KeycloakAdminClient) -> tuple[str, str | None, str]:
    roles = kc.user_app_roles(user["id"])
    if not user.get("enabled") or primary_role(roles) != "student" or set(roles) != {"student"}:
        return "needs_review", None, "skipped"
    return "existing", user.get("username"), "skipped"


@router.post("/internal/booking/user")
def provision_booking_user(
    body: BookingProvisionRequest,
    x_booking_provision_secret: str | None = Header(None),
    kc: KeycloakAdminClient = Depends(get_client),
):
    try:
        expected = get_secret("BOOKING_PROVISION_SECRET", required=True)
    except SecretsConfigError:
        raise HTTPException(status_code=503, detail="Booking provisioning is not configured")
    if not x_booking_provision_secret or not hmac.compare_digest(
        x_booking_provision_secret.encode("utf-8"), (expected or "").encode("utf-8")
    ):
        raise HTTPException(status_code=401, detail="Unauthorized")
    email = str(body.email).strip().lower()
    if not email.endswith(EMAIL_DOMAIN):
        raise HTTPException(status_code=422, detail="Invalid booking email")
    owner = uuid.uuid4().hex
    state = _claim(email, owner)
    if state in {"existing_check", "email_failed_check"}:
        previous = "email_failed" if state == "email_failed_check" else "existing"
        try:
            found = _find_exact(kc, email)
            if len(found) != 1:
                return {"status": "needs_review", "credential_email_status": "skipped"}
            status, _username_value, _delivery = _perform_existing(found[0], kc)
            if status != "existing":
                return {"status": "needs_review", "credential_email_status": "skipped"}
            return {
                "status": previous,
                "credential_email_status": "failed" if previous == "email_failed" else "skipped",
            }
        except KeycloakAdminError as exc:
            logger.warning("Booking account recheck failed: %s", type(exc).__name__)
            return {"status": "needs_review", "credential_email_status": "skipped"}
    if state != "owner":
        return {"status": state, "credential_email_status": "skipped"}
    try:
        result, _username_value, delivery = _perform(email, kc)
    except KeycloakAdminError as exc:
        logger.warning("Booking Keycloak operation failed: %s", type(exc).__name__)
        result, delivery = "failed", "skipped"
    except Exception as exc:
        logger.warning("Booking account operation failed: %s", type(exc).__name__)
        result, delivery = "failed", "skipped"
    if not _finish(email, owner, result):
        # Another owner/reconciler changed the durable state; don't report an
        # outcome that was not committed.
        return {"status": "needs_review", "credential_email_status": "skipped"}
    return {"status": result, "credential_email_status": delivery}
