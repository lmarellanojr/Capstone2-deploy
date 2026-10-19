# Strong password change usability

- Branch: `fix/keycloak-password-change-ux`
- Code commit: `0daefb4` (`fix(keycloak): fill password confirmation on generation`)
- Resolved: On Keycloak's update-password page, explicit Generate now puts the same 24-character Web Crypto password in both fields and shows a reminder to save it. Manual entry, visibility control, reset behavior, and Keycloak's password policy remain.
- Changed: `deploy/keycloak/themes/cyberrange/login/resources/js/password-strength.js`, `deploy/keycloak/test_password_strength.cjs`, `deploy/keycloak/dictionary-policy/test_local_keycloak.cjs`; plan in `password-change-ux/implementation_plan.md`.
- Checks: `$env:NODE_PATH = (Resolve-Path 'cyberrange/portal/node_modules').Path; node --test cyberrange/deploy/keycloak/test_password_strength.cjs` — 7 passed. `node --check` on both changed JavaScript files — passed. `git diff --check` — passed.
- Reviews: Anti — APPROVED FOR MERGE. Codex — APPROVED (ALL CHECKS PASS).
- Remaining: Disposable local Keycloak browser acceptance was not run because the instance at `127.0.0.1:18083` was unavailable. The change has not been deployed to the live host.
