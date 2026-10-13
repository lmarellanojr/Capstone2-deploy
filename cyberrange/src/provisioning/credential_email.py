"""Send temporary account credentials from the provision API over authenticated TLS SMTP."""
from __future__ import annotations

import os
import smtplib
import ssl
from email.message import EmailMessage
from urllib.parse import urlparse

from secrets_loader import SecretsConfigError, get_secret


class CredentialEmailError(RuntimeError):
    """Mail configuration or transport failed; do not expose the underlying error."""


def send_temporary_credentials(*, recipient: str, username: str, password: str) -> None:
    """SMTP acceptance means sent; it cannot prove inbox delivery."""
    try:
        host = os.getenv("CREDENTIAL_SMTP_HOST", "").strip()
        mode = os.getenv("CREDENTIAL_SMTP_SECURITY", "starttls").strip().lower()
        port = int(os.getenv("CREDENTIAL_SMTP_PORT", "465" if mode == "ssl" else "587"))
        sender = os.getenv("CREDENTIAL_SMTP_FROM", "").strip()
        smtp_user = get_secret("CREDENTIAL_SMTP_USERNAME", required=True)
        smtp_password = get_secret("CREDENTIAL_SMTP_PASSWORD", required=True)
        portal_url = os.getenv("PORTAL_PUBLIC_URL", "").strip().rstrip("/")
        parsed = urlparse(portal_url)
        if (
            not host or mode not in {"starttls", "ssl"} or not 1 <= port <= 65535
            or not sender or "\r" in sender or "\n" in sender
            or not smtp_user or not smtp_password or parsed.scheme != "https"
            or not parsed.netloc or parsed.username or parsed.password
            or parsed.path not in {"", "/"} or parsed.query or parsed.fragment
        ):
            raise CredentialEmailError("credential email is not configured")

        message = EmailMessage()
        message["From"] = sender
        message["To"] = recipient
        message["Subject"] = "Your MMDC Cyber Range account"
        message.set_content(
            "Your MMDC Cyber Range account is ready.\n\n"
            f"Sign in: {portal_url}\n"
            f"Username: {username}\n"
            f"Temporary password: {password}\n\n"
            "You must choose a new password when you first sign in. "
            "Do not forward this email.\n"
        )

        context = ssl.create_default_context()
        if mode == "ssl":
            with smtplib.SMTP_SSL(host, port, timeout=5, context=context) as smtp:
                smtp.login(smtp_user, smtp_password)
                smtp.send_message(message)
        else:
            with smtplib.SMTP(host, port, timeout=5) as smtp:
                smtp.ehlo()
                smtp.starttls(context=context)
                smtp.ehlo()
                smtp.login(smtp_user, smtp_password)
                smtp.send_message(message)
    except (SecretsConfigError, ValueError, OSError, smtplib.SMTPException) as exc:
        raise CredentialEmailError("credential email could not be sent") from exc
