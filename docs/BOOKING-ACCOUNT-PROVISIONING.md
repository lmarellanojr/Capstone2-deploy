# Booking and tester credentials

The booking page records a reservation and emails the tester a confirmation. It does not create a Cyber Range account. The assigned domain owner creates the student account after the booking and shares login details through an approved secure channel. Admin user creation does not email passwords.

## Domain owner workflow

1. Read the new booking notice and use its assigned domain and tester email.
2. Sign in to that domain's Admin Users page.
3. Create an enabled **Student** account using the tester's email and a temporary password. The Admin page shows a short-lived credential handoff; securely share the username, temporary password, and sign-in link with the tester.
4. If the tester already has an account, resolve it through the existing user-management workflow before the session.

This process does not need `BOOKING_PROVISION_SECRET` or booking-specific API settings. A small Apps Script trigger retries organizer notices only when email delivery fails; it does not create accounts or send tester credentials.

## Update the booking Apps Script

After deploying the updated script (including when replacing an older version that installed account reconciliation):

1. In the booking spreadsheet, open **Extensions > Apps Script** and replace `Code.gs` with this repository's `cyberrange/booking/Code.gs`.
2. In the Apps Script editor, run `installOrganizerNoticeRetry` once and authorize it. This removes the old account-reconciliation trigger and installs a five-minute retry for unsent organizer notices without changing booking rows.
3. Deploy a new version of the web app, keeping its existing execute-as and access settings.
4. Make a test booking and verify the tester receives the confirmation and the domain owner receives the action notice. Create the account in Admin Users and share credentials through an approved secure channel.

Old account-status columns in the booking sheet are renamed as legacy fields and left intact; historical rows and claim-table data are preserved. New bookings leave those fields blank. The v13 SQLite migration remains in the migration history because deployed domains have already applied it, but the API no longer uses the table.
