# Admin create-user password feedback

- Branch: `fix/admin-create-password-feedback`
- Code commit: `5260074` (`fix(admin): clarify password creation failures and offer generator`)
- Resolved: Create user now offers the existing Web Crypto password generator; manual entry and one-time credential handoff remain. Keycloak role/readback failures no longer appear as password-policy rejection. Rollback and existing password rules remain.
- Changed: `portal/src/components/admin/CreateUserModal.tsx`, `portal/src/components/admin/UserAdminSetupHint.test.tsx`, `src/provisioning/users_router.py`, `src/provisioning/test_admin_users.py`; plan in `implementation_plan.md`.
- Checks: `node node_modules/jest/bin/jest.js --runInBand src/components/admin/UserAdminSetupHint.test.tsx` — 12 passed; `node node_modules/typescript/bin/tsc --noEmit` — passed; `uv run --no-project --offline --with pytest --with fastapi --with httpx --with pydantic --with requests --with python-multipart python -m pytest src/provisioning/test_admin_users.py -q` — 122 passed; `git diff --check` — passed.
- Reviews: Anti — APPROVED FOR MERGE; Codex — APPROVED (ALL CHECKS PASS).
- Remaining: Scenario additions require topics and lab/checker requirements. The change has not been deployed to the live host.
