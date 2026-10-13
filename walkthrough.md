# Admin credential email cleanup walkthrough

- Branch: `feature/admin-credential-email-security`
- Implementation commit: `9a911ac` (`Remove admin credential email delivery`, rebased on the current `main`)
- Pull request: [#198](https://github.com/lmarellanojr/Capstone2-deploy/pull/198), follow-up to merged PR #193

## Resolved requirements

- Removed SMTP delivery of temporary credentials from admin account creation and password resets, along with its status contract, audit event, mailer, tests, and environment example settings.
- Sanitized validation responses on password management endpoints and removed raw exception details from portal proxy logs.
- Added a transient Admin credential handoff after successful create/reset. Password display is masked, copying requires an explicit action, and the modal expires after two minutes even if the tab was backgrounded. Closing or expiry clears the handoff.
- Booking confirmations, organizer notices, calendar details, and operator documentation now explain that the domain owner creates the account and shares login details through an approved secure channel.

## Changed files

Implementation and tests: `cyberrange/src/provisioning/users_router.py`, `cyberrange/src/provisioning/provision_api_fastapi.py`, `cyberrange/src/provisioning/test_admin_users.py`, `cyberrange/src/provisioning/test_sec01_rbac_matrix.py`, `cyberrange/src/provisioning/test_booking_script.cjs`, `cyberrange/booking/Code.gs`, `cyberrange/portal/src/app/admin/users/page.tsx`, `cyberrange/portal/src/components/admin/CreateUserModal.tsx`, `cyberrange/portal/src/components/admin/ResetPasswordModal.tsx`, `cyberrange/portal/src/components/admin/CredentialHandoffModal.tsx`, `cyberrange/portal/src/components/admin/CredentialHandoffModal.test.tsx`, `cyberrange/portal/src/components/admin/ResetPasswordModal.test.tsx`, `cyberrange/portal/src/components/admin/UserAdminSetupHint.test.tsx`, `cyberrange/portal/src/lib/api.ts`, `cyberrange/portal/src/lib/apiProxy.ts`, `cyberrange/portal/src/lib/apiProxy.test.ts`, `cyberrange/portal/src/lib/adminCredentialFeedback.ts`, and `cyberrange/portal/src/lib/adminCredentialFeedback.test.ts`.

Removed files: `cyberrange/src/provisioning/credential_email.py`, `cyberrange/src/provisioning/test_credential_email.py`, `cyberrange/portal/src/lib/credentialEmailFeedback.ts`, and `cyberrange/portal/src/lib/credentialEmailFeedback.test.ts`.

Contracts and handoff docs: `cyberrange/docs/ADM-USER-contract.md`, `cyberrange/env/oci-12gib.env.example`, `docs/BOOKING-ACCOUNT-PROVISIONING.md`, and `implementation_plan.md`.

## Validation

- `node cyberrange/src/provisioning/test_booking_script.cjs` — passed. Booking, credential instructions, organizer notice retry/deduplication, locking, migration, calendar, and cancellation checks passed.
- `git diff --check` — passed before commit; Git reported only LF/CRLF normalization notices.
- `npm.cmd test -- --runInBand src/components/admin/CredentialHandoffModal.test.tsx src/components/admin/ResetPasswordModal.test.tsx src/components/admin/UserAdminSetupHint.test.tsx src/lib/apiProxy.test.ts src/lib/adminCredentialFeedback.test.ts` — not run: Jest is not installed in this checkout (`jest` not recognized).
- `python -m pytest src/provisioning/test_admin_users.py src/provisioning/test_sec01_rbac_matrix.py` — not run: the Windows Python launcher could not access its executable.
- `gh pr view 193 --json number,title,url,state,headRefName,baseRefName,body,reviewDecision` — not available: GitHub API connection was blocked by environment network permissions.

## Independent final reviews

- Anti security/privacy review: `APPROVED FOR MERGE`.
- Codex contract/architecture review: `APPROVED (ALL CHECKS PASS)`.

The portal and backend automated suites remain unverified in this environment. This follow-up branch contains the security cleanup after PR #193 was merged; PR #193 itself continues to describe the original booking change.
