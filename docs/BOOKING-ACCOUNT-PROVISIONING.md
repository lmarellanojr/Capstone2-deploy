# Booking account provisioning

When a booking is accepted, Apps Script calls the assigned domain's server route. The server route forwards the email to that domain's provision API. A new enabled student account receives a randomly generated temporary password by authenticated TLS SMTP. A repeat booking reuses one enabled student account and never resets its password. Disabled, privileged, ambiguous, partial, or uncertain accounts are flagged for organizer review.

## Configure each domain

For each range domain, generate a different high-entropy secret (for example, `openssl rand -hex 32`) and set it in that domain's provision API and server-only portal environment. Keep it out of client code and source control. The API's existing SMTP settings (`CREDENTIAL_SMTP_HOST`, `CREDENTIAL_SMTP_PORT`, `CREDENTIAL_SMTP_SECURITY`, `CREDENTIAL_SMTP_FROM`, `CREDENTIAL_SMTP_USERNAME`, and `CREDENTIAL_SMTP_PASSWORD`) must be configured, along with the HTTPS `PORTAL_PUBLIC_URL`. Keycloak's existing dedicated user-admin service account needs user query/manage permissions in that domain's realm.

In the Apps Script project attached to the booking sheet, open **Project Settings → Script properties** and add `BOOKING_PROVISION_SECRET_D1`, `_D2`, `_D3`, and `_D4`, each with the matching domain's secret. The script selects the property using its fixed `DOMAINS` mapping. Never add these properties to the public booking page.

The provisioning claim table is added by the existing API startup migration. Back up `pod_mgmt.db` before deploying the new API as usual. Deploy the portal and API on all assigned domains before updating the Apps Script project.

## Update and deploy Apps Script

1. Replace the booking project's `Code.gs` with the updated file supplied alongside this change.
2. Set the script property above. Run `installProvisioningReconciliationTrigger` once in the Apps Script editor and authorize the requested spreadsheet, URL fetch, and email permissions. This creates a 15-minute trigger that alerts organizers about rows left `pending` or `unknown` for more than five minutes.
3. Deploy a new version of the web app, keeping its existing **Execute as: Me** and public access settings. The booking page keeps the same `doPost` request and response shape.
4. Make one controlled test booking using an approved MMDC address. Confirm the row records `created`, the user receives a temporary credential email, and the organizer notice reports the outcome. Repeat a booking using the same address and confirm the existing password is unchanged. Do not use a real tester's mailbox for a credential test without their consent.

## Status and recovery

`pending` means Apps Script could not verify completion yet. `unknown` means the portal call timed out or failed ambiguously. The timed reconciliation function alerts organizers once and marks that notice in the sheet. Check the per-domain claim row and Keycloak account before manual recovery. A stale claim or `needs_review` must be reconciled by an administrator; do not retry by resetting an existing account. `email_failed` means the account exists but SMTP did not accept the message; use the authenticated Admin → Users reset-password workflow to issue a new temporary password and email it. The booking remains confirmed throughout.

Apps Script applies a limit of four active bookings per email. The shared secret authenticates the server-to-server request; it does not prove that the person booking controls the submitted mailbox. Keep booking organizer notifications monitored for suspicious reservations.
