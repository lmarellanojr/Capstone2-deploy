# Email temporary credentials for new users

## Requirement and current behavior

The Admin creates Keycloak users with an initial password. The portal currently gives no email delivery, even when an email address is supplied. The requested flow is to email the username and temporary password to that address; Keycloak already forces a password change at first sign-in when `temporary_password=true`.

## Scope and contracts

- Add `src/provisioning/credential_email.py`, a server-only SMTP sender using the existing secret loader. Require authenticated SMTP over STARTTLS or implicit TLS with certificate verification, a configured sender address, and a configured public portal URL. Set a finite 5-second network timeout. Never log password, SMTP secret, or message content.
- In `users_router.py`, after Keycloak successfully creates the user, sets the password, assigns the role, and reads the user, snapshot its Keycloak-returned email and release `_write_lock` before sending a plain-text credential email. Send only when an email is present and the password is temporary. Include username, temporary password, portal sign-in URL, and an instruction to change the password at first sign-in. Do not send for email-less or permanent-password accounts. Bounded mail I/O cannot hold up other Admin writes. A concurrent reset can supersede the password while email is in flight; a recipient then uses the newest reset email or asks an Admin for a fresh reset.
- Keep the existing `POST /admin/users` request contract. Add `credential_email_status` (`sent`, `failed`, or `skipped`) to its 201 response. A mail failure must not roll back a fully created account or turn its successful create into a retryable error, since SMTP delivery can be ambiguous. Audit delivery outcome without secrets.
- Update the portal success messaging to distinguish sent, failed, and skipped, and explain in the create form that automatic mail requires a temporary password and configured email delivery.
- Add an explicit recovery path in the existing password reset flow: only after `set_password`, `logout_user`, role lookup, and final `get_user` all succeed, snapshot the target email, release `_write_lock`, and mail the new temporary credentials. Return the same delivery status. Permanent resets and accounts without email skip mail. A failure after changing the password but before completing session revocation/read must not trigger email.
- Update `portal/src/lib/api.ts`, `portal/src/hooks/useAdminUsers.ts`, `portal/src/app/admin/users/page.tsx`, and the create/reset modal hints. `runWrite` must return the updated `AdminUser` so reset messaging can use `credential_email_status` while still patching the list. The reset modal's `onReset` remains `Promise<void>` because the page consumes the status in its callback.
- Document SMTP deployment variables and API behavior in `docs/ADM-USER-contract.md` and add nonsecret settings to `env/oci-12gib.env.example`. Operators put the real SMTP secret in `env/.env` (the provision API systemd EnvironmentFile) and restart the provision API. No external email provider credentials are committed.

## Safeguards

- Server sends only to the target email returned by Keycloak after creation/reset, not a client-supplied alternate recipient.
- SMTP is never allowed in plaintext mode. Configuration and transport errors are caught at the delivery boundary and shown as `failed`; never echo raw SMTP errors or credentials to the client.
- Preserve Admin-only authorization, fresh Admin recheck, password policy handling, session revocation, audit behavior, and the existing Keycloak rollback for account construction failures.
- Make no claim that a syntactically valid address is deliverable, or that SMTP acceptance guarantees inbox receipt.
- Keep unrelated existing worktree files untouched by working in an isolated worktree.

## Tests and acceptance

- Backend tests: temporary create with email sends exactly once after account construction; no email/permanent password skips; SMTP failure returns 201 with `failed` and account retained; current `@local` test addresses remain accepted by the existing API syntax check; invalid email rejected; reset success/failure and no-email behavior; no send after post-password Keycloak failure; slow SMTP does not hold `_write_lock`; secret absent from response and audit; mailer enforces TLS and handles configuration/transport failure.
- Portal tests: status-specific create/reset message and form hint; TypeScript and targeted Jest checks.
- Run targeted pytest, Jest, TypeScript/build validation, and `git diff --check`.
- Acceptance: an Admin-created account with email and a temporary password receives credentials when SMTP is configured; first sign-in requires a new password; delivery failure is accurately shown with a workable reset/retry path.
