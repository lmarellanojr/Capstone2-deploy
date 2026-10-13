"""Credential email transport: authenticated TLS and bounded network calls."""
import pytest

import credential_email


class FakeSmtp:
    def __init__(self, host, port, *, timeout, context=None):
        assert host == "mail.example.test"
        assert port in (465, 587)
        assert timeout == 5
        self.calls = []
        self.context = context

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def ehlo(self):
        self.calls.append("ehlo")

    def starttls(self, *, context):
        assert context.verify_mode
        self.calls.append("starttls")

    def login(self, username, password):
        assert (username, password) == ("mailer", "mail-secret")
        self.calls.append("login")

    def send_message(self, message):
        assert message["To"] == "student@example.test"
        assert "Username: student_demo" in message.get_content()
        assert "Temporary password: Tmp!pass-1234" in message.get_content()
        self.calls.append("send")


@pytest.fixture
def mail_settings(monkeypatch):
    for key, value in {
        "CREDENTIAL_SMTP_HOST": "mail.example.test",
        "CREDENTIAL_SMTP_PORT": "587",
        "CREDENTIAL_SMTP_SECURITY": "starttls",
        "CREDENTIAL_SMTP_FROM": "accounts@example.test",
        "CREDENTIAL_SMTP_USERNAME": "mailer",
        "CREDENTIAL_SMTP_PASSWORD": "mail-secret",
        "PORTAL_PUBLIC_URL": "https://portal.example.test",
    }.items():
        monkeypatch.setenv(key, value)


def test_starttls_precedes_login_and_send(mail_settings, monkeypatch):
    instances = []

    def factory(*args, **kwargs):
        smtp = FakeSmtp(*args, **kwargs)
        instances.append(smtp)
        return smtp

    monkeypatch.setattr(credential_email.smtplib, "SMTP", factory)
    credential_email.send_temporary_credentials(
        recipient="student@example.test", username="student_demo", password="Tmp!pass-1234"
    )
    assert instances[0].calls == ["ehlo", "starttls", "ehlo", "login", "send"]


def test_implicit_tls(mail_settings, monkeypatch):
    monkeypatch.setenv("CREDENTIAL_SMTP_SECURITY", "ssl")
    monkeypatch.setenv("CREDENTIAL_SMTP_PORT", "465")
    instances = []

    def factory(*args, **kwargs):
        smtp = FakeSmtp(*args, **kwargs)
        instances.append(smtp)
        return smtp

    monkeypatch.setattr(credential_email.smtplib, "SMTP_SSL", factory)
    credential_email.send_temporary_credentials(
        recipient="student@example.test", username="student_demo", password="Tmp!pass-1234"
    )
    assert instances[0].context.verify_mode
    assert instances[0].calls == ["login", "send"]


def test_missing_configuration_fails_without_network(monkeypatch):
    monkeypatch.delenv("CREDENTIAL_SMTP_HOST", raising=False)
    monkeypatch.setattr(credential_email.smtplib, "SMTP", lambda *a, **kw: pytest.fail("unexpected network"))
    with pytest.raises(credential_email.CredentialEmailError):
        credential_email.send_temporary_credentials(
            recipient="student@example.test", username="student_demo", password="Tmp!pass-1234"
        )
