# Easier strong password change

## Requirement and cause

Keycloak's update-password page already offers a Web Crypto generator whose 24-character digit/symbol output satisfies the current realm policy. It fills only the new-password field. Users must retype a long random value into confirmation and may lose it after saving. Make this flow usable without changing Keycloak's server-side dictionary, length, blocklist, username/email, or history rules.

## Files and behavior

- `deploy/keycloak/themes/cyberrange/login/resources/js/password-strength.js`: on explicit Generate click, set both `password-new` and `password-confirm` to the same strong value, dispatch input/change events, and keep the new password visible so the user can save it. Add a short reminder to save it in a password manager before continuing. Show the generator only when both inputs and Web Crypto are present. Do not submit automatically or put the value in logs, storage, URLs, or status text. Clear the reminder on form reset.
- `deploy/keycloak/test_password_strength.cjs`: verify generation fills both fields, does not submit, preserves manually entered values until clicked, does not mount on login, and behaves safely without a confirmation field or Web Crypto.
- `deploy/keycloak/dictionary-policy/test_local_keycloak.cjs`: adjust the JavaScript-enabled browser acceptance check to expect the confirmation field populated by Generate.

## Checks and acceptance

Run the focused Node test, syntax check, and diff check. The generated password is 24 random digit/symbol characters, appears in both fields only after explicit action, and the user is reminded to save it. Manual entry remains available and Keycloak remains the authority for policy acceptance. No live deployment in this change.
