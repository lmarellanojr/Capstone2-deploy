# User-chosen password policy walkthrough

- Branch: `fix/user-chosen-password-policy`
- Implementation commit: `660dd4c` (`Allow user-chosen passwords under Keycloak policy`)
- Requirement: users can choose their own unique password or passphrase containing ordinary words. The optional generator still works.
- Changed: active Keycloak realm policy, readback and import guard, host verification probes, disposable Keycloak harness, portal create/reset hints, Keycloak strength hint/estimate, tests, and provider documentation. The whole-password blocklist, 8–128 length under mandatory TOTP, identity checks, three-password history, and temporary lockout remain.

## Verification

- `uv run --no-project --offline --with pytest python -m pytest cyberrange/deploy/host/test_enable_keycloak_password_policy.py -q --basetemp cyberrange/.pytest-tmp --tb=short` with Git Bash on `PATH`: 38 passed.
- `node node_modules/jest/bin/jest.js --runInBand src/components/admin/UserAdminSetupHint.test.tsx src/components/admin/ResetPasswordModal.test.tsx`: 13 passed.
- `node node_modules/typescript/bin/tsc --noEmit`: passed.
- `NODE_PATH=<portal/node_modules> node --test test_password_strength.cjs` from `cyberrange/deploy/keycloak`: 7 passed.
- `node --check cyberrange/deploy/keycloak/dictionary-policy/test_local_keycloak.cjs` and `git diff --check`: passed.
- Anti final review: `APPROVED FOR MERGE`, itemized policy, import, test, guidance, and scope checks passed.
- Codex final review: `APPROVED (ALL CHECKS PASS)`, itemized policy, import, UI, test, and scope checks passed.

## Remaining deployment work

The disposable real-Keycloak harness was syntax checked but not run because no local Keycloak instance was available. No production host was changed. On deployment, verify host identity, apply `enable_keycloak_password_policy.sh`, run `verify_password_policy.sh`, install the updated theme/portal, and re-export the realm before any container recreate. An old export containing `dictionaryWords` now fails the import push.
