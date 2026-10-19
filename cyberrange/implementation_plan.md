# Admin password creation feedback

## Cause and requirement

The realm intentionally rejects English dictionary substrings of two or more letters. The create-user form has no Generate option even though reset-password already has a secure generator. In `_create_user_locked`, any HTTP 400 after password assignment is reported as a password-policy failure, including a role-mapping rejection. Keep the realm policy and one-time credential flow; make compliant creation practical and errors accurate.

## Scope and contracts

- `portal/src/components/admin/CreateUserModal.tsx`: add the existing Web Crypto password generator to the initial-password field. Keep manual entry, password visibility, form reset, and the one-time handoff. Add concise guidance for a rejected password; do not expose or log the value.
- `src/provisioning/users_router.py`: track the failing Keycloak step so only a reset-password HTTP 400 maps to the existing password-policy 422. Other failures retain rollback and produce the service error, with a step in the audit detail but no secret.
- Focused UI and API regression tests: generated password is usable in create, manual value remains accepted for submission, failed creation keeps its value, and a role HTTP 400 returns 503 with `step=role` and `rolled_back` in the audit detail.

## Safeguards and verification

Keep rollback, role checks, history, blocklist, dictionary enforcement, and password secrecy. Run focused Jest and pytest, TypeScript check, and diff check. No deployment or new scenario is in this plan; scenario additions need topics and lab design from the requester.

## Acceptance

An admin can generate a policy-compatible initial password from Create user or supply one manually. A failed role assignment cannot show the password-policy message. Tests pass and no password appears in audit or server errors.
