# User-chosen password policy plan

## Requirement and cause

Users must be able to choose a strong password or passphrase themselves. The current `dictionaryWords(scowl-en-v1)` realm rule rejects any two-letter English word inside a candidate, so many long, unique user-chosen passwords fail. The generator must remain optional.

## Scope and contracts

- Keep the realm minimum at 8 because TOTP is mandatory, maximum at 128, whole-password common-password blocklist, username/email equality checks, three-password history, and temporary brute-force lockout. Remove `dictionaryWords` from the *active realm policy* and make policy readback verification reject it. Do not weaken API length validation.
- Stop making policy enablement depend on installing or registering the custom dictionary provider. An already installed provider can remain inert. Reject a host-canonical realm import JSON that still contains `dictionaryWords` so a later restart cannot silently restore the old rule; re-export the realm after the change.
- Update the disposable host probe and local Keycloak browser/API test to prove a user-chosen password with embedded words and a multi-word passphrase are accepted in create, reset, and forced UPDATE_PASSWORD, while weak/common/reused/too-short passwords remain rejected.
- Update portal create/reset hints and Keycloak strength hint so users understand that they can choose their own password, longer unique passphrases are welcome, and the server checks common passwords and reuse at save time. Keep Generate as an optional helper. Replace the meter's blanket penalty for alphabetic text with conservative handling of obvious patterns and common phrases; do not label predictable alphabetic values Strong solely due to length. The meter remains advisory.
- Update policy documentation and `dictionary-policy/LOCAL_TEST.md` to explain the change and the deployment/re-export steps. Preserve the custom provider source and installer for compatibility with older snapshots, but describe it as inactive under the new policy.

## Safeguards and verification

- Never log or expose actual account passwords. Use disposable test users and local Keycloak only for runtime acceptance tests. Do not apply the realm change on production without deployment approval and verified host identity.
- Run Bash syntax and policy verifier tests, portal Jest/TypeScript checks, strength meter Node tests, and any local disposable Keycloak integration available. Compare the active policy in the enable script, local harness, and import guard. Confirm the final diff contains no unrelated files.
- Acceptance: a user-chosen long password or passphrase containing ordinary English words succeeds across account creation/reset/forced change; representative blocklisted values, short, equal-to-identity, reused, and overlength passwords still fail; Generate still works; UI text matches policy. The policy cannot guarantee every guessable password is rejected.
