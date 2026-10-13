# Implementation plan: remove Admin email delivery of credentials

## Requirement and root cause
Admin create and temporary-password reset currently send the entered password through SMTP. This has been unreliable and exposes credentials in email. Remove that delivery path and its configuration and UI claims while retaining Admin account creation, password reset, and first-login password change.

## Scope and contracts
- `cyberrange/src/provisioning/users_router.py` and `provision_api_fastapi.py`: remove credential email import/helper, status fields, and credential-email audit events; create returns the existing serialized user and reset returns the existing serialized user after Keycloak success. Ensure FastAPI validation errors do not echo raw request inputs, and verify errors/logging/telemetry do not record request passwords; the request itself continues over the existing HTTPS API.
- `cyberrange/src/provisioning/credential_email.py` and `test_credential_email.py`: delete obsolete mailer implementation/tests.
- Admin portal API type, feedback helper/tests, create/reset modal copy, and Admin page notification: remove credential-email status behavior and replace with clear secure-handoff messaging. After successful create/reset, show credentials in an explicit Admin-only handoff modal for up to two minutes, with a user-triggered copy action; enforce an absolute expiry on timeout, tab visibility/focus, and copy so browser timer throttling cannot extend the display. Clear it on close/expiry. Do not persist it. Move password from input state to handoff state on success and clear the form input. On request failure, keep it only in the currently open form so the Admin can reconcile a possibly completed request; show a warning to verify before sharing, and clear it when the form closes. Prevent browser persistence where practical.
- `cyberrange/booking/Code.gs` and its Apps Script contract test: remove promises of automatic tester credential email from booking notices/confirmations/calendar text.
- `cyberrange/src/provisioning/test_admin_users.py`, RBAC test, `cyberrange/docs/ADM-USER-contract.md`, `cyberrange/env/oci-12gib.env.example`, and booking workflow doc: update regression expectations and operator instructions. Explicitly assert no email send/status on create/reset and ensure passwords stay absent from success and validation responses, audit records, app logs, exception reporting and browser console. Remove obsolete credential SMTP instructions without touching unrelated SMTP config or revealing secrets.

## Safeguards
- No password is emailed, logged, audited, or returned by the API.
- Existing Keycloak password setting, temporary-password required action, role assignment, rollback, session logout, and token-cache invalidation remain unchanged.
- Keep booking confirmations separate from account provisioning; explain that domain owners must securely share access details out of band after creating the account.
- Remove unused SMTP secret configuration instructions; do not expose or rotate existing SMTP secrets in this change.
- Deploy the backend and portal together (or rely on the portal safely ignoring the now-absent response field during rolling deployment).

## Validation
- Targeted Python tests for Admin user creation/reset and RBAC, plus all provisioning tests.
- Portal unit tests and type/lint/build checks available in the project.
- Booking Apps Script contract test and `git diff --check`.
- Acceptance: no Admin-triggered SMTP credential send or status contract remains; booking UI/email no longer promises an automatic credential email; account lifecycle semantics pass tests; UI/docs accurately describe the time-limited secure handoff, retain uncertain requests only in open form state for reconciliation, and clear credentials after close/absolute expiry including when a backgrounded tab resumes.

## Review gates
Obtain independent security and API/architecture plan reviews before production edits, then independent final diff reviews after tests.
