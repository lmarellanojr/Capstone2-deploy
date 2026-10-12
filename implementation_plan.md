# Booking session account provisioning plan

## Requirement

After a booking is accepted, create a student account for the tester's email in the Keycloak realm for the assigned Cyber Range domain. Send the tester a temporary password only for a newly created account. A repeat booking must reuse the account without changing its password. Booking remains accepted if provisioning or email delivery fails, and organizers need a clear status and follow-up path.

## Scope and contracts

- Add an internal FastAPI endpoint that accepts a validated MMDC email, creates a least-privilege student account if no exact email match exists, and sends the temporary credential through the existing TLS SMTP mailer. Return only an opaque outcome and delivery status; never return a username or password to the public booking caller.
- Add a public Next.js server route that authenticates the Apps Script caller with a per-domain shared secret and forwards the request to FastAPI. Keep each secret server-side and compare it in constant time.
- Update the supplied `C:\Users\Windows\Downloads\Code.gs` to append the booking with `pending` account status, then invoke the server route for the domain assigned to the newly saved booking after releasing the script lock. Store final provisioning state before sending notifications. Preserve the existing public `doPost` booking/cancel response contract and cancellation behavior. Organizer notifications explain delivery and follow-up; tester confirmation includes the assigned domain and tells them whether to check for a separate temporary credential email or use an existing password.
- On repeats, exact email lookup is case-insensitive and must not modify the account or resend/reset its password. Reuse only one enabled account with student role. Disabled, privileged, missing-role, or ambiguous exact-email matches produce `needs_review`; do not mutate them. Roll back a known partial new account if setup fails. Serialize same-email creation across API workers with a unique normalized-email claim in the existing per-domain SQLite database: acquire it in a short `BEGIN IMMEDIATE` transaction, commit `creating` before Keycloak calls, and record final status with an owner-token compare-and-set. Requests seeing a live claim return `pending` without creating. Stale claims become `needs_review`, never auto-retry or reset. Recheck exact email after Keycloak conflicts and use manual recovery when the external create outcome is ambiguous.
- Derive a deterministic lowercase Keycloak username from the email local part, sanitized to `[a-z0-9_.-]` and at most 32 characters, with an email hash suffix. If that username collides with a different account, stop safely with `needs_review` rather than guessing or mutating the other account. Generate temporary passwords using the Python secrets module and the configured realm password policy; a password-policy rejection rolls back the new account.
- Add per-email booking abuse limits in Apps Script before creating a booking, and keep account existence, username, and delivery detail out of the public response. The caller secret authenticates Apps Script, but does not itself verify email ownership.
- Document configuration and rollout for four distinct domain secrets across the portals, APIs, and matching Apps Script properties.

## Files

- `cyberrange/src/provisioning/booking_router.py` (new): request validation, shared-secret authorization, exact user lookup, student account creation, temporary password generation, and mail status.
- `cyberrange/src/provisioning/schema/v12.sql`: create the unique, durable booking-account claim table in the existing per-domain SQLite database; the API tests exercise the migration fixture.
- `cyberrange/src/provisioning/provision_api_fastapi.py`: register the internal booking router.
- `cyberrange/portal/src/app/api/booking/provision/route.ts` (new): secret-guarded server proxy to the internal API.
- `cyberrange/portal/.env.local.example`: declare the server-only booking secret.
- `cyberrange/env/oci-12gib.env.example`: declare the matching booking secret.
- `C:\Users\Windows\Downloads\Code.gs`: call the assigned domain after saving the booking; persist status, enforce abuse limits, and render accurate notifications. Add an editor-installed time trigger that scans old booked rows without a successful organizer notice, sends the notice, and records success under the Apps Script lock.
- `docs/BOOKING-ACCOUNT-PROVISIONING.md` (new): required secret configuration and deployment instructions.
- Focused tests for account creation, repeat booking, email failure, authorization, and response secrecy, using mocked Keycloak/SMTP.

## Safeguards and recovery

- Only allow `@mmdc.mcl.edu.ph` and assign the student role; never accept a caller-selected role, realm, or arbitrary API URL.
- Apps Script chooses the endpoint from the existing hardcoded domain mapping. Both the portal route and API validate the shared secret; secrets are absent from client HTML and logs.
- The API's repeat path is read-only for an existing user. If initial mail delivery fails after account creation, mark `email_failed` and direct the organizer to the existing admin reset/invite workflow; automated retries must never reset an existing account. Never classify an enabled but non-student, disabled, or ambiguous user as reusable.
- A provisioning failure does not cancel or remove a booking. The booking sheet and organizer notification record the failure for manual recovery.
- If Apps Script execution stops after saving the booking or the upstream times out, retain `pending`/`unknown` visibly in the row. An editor-installed time trigger scans booked rows older than five minutes whose organizer notice has not succeeded, sends the notice, and records `Organizer notice sent` under the same script lock used for doPost, avoiding duplicates. Recovery is an organizer/admin check of the row, durable per-domain claim, and Keycloak account; no automatic credential or account retry can reset an existing password.
- Minimize personal data in responses and emails. Never include the generated password in API or Apps Script responses.

## Acceptance criteria

1. A valid new booking creates one student account in its assigned realm and emails its username and temporary password.
2. A repeat booking with the same email leaves the password untouched and tells the tester to use the existing password.
3. Invalid email, missing/wrong secret, mail failure, and Keycloak failure produce safe statuses without leaking secrets or undoing the booking.
4. Concurrent requests for the same email across API workers converge on one ready account without password reset; interrupted partial account setup is rolled back or explicitly marked for review through the durable SQLite claim.
5. Existing booking and cancellation callers remain compatible, and organizer messages identify any required follow-up.
6. Configuration and deployment steps are documented for all four domains.

## Validation

Use focused unit tests with mocked Keycloak and SMTP for API behaviors, portal route tests for secret validation and proxying, Apps Script behavioral tests with SpreadsheetApp/UrlFetchApp/MailApp mocks for booking/cancel/domain/status behavior, portal type/lint checks, and `git diff --check`. Review the final diff independently for security and compatibility.
