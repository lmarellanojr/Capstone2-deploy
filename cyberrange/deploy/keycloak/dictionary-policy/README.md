# Dictionary substring password policy

Issue #174, parent #169. The `dictionaryWords(scowl-en-v1)` Keycloak policy rejects a password containing any entry from the bundled English dictionary, including a word embedded within a longer value or a multi-word passphrase. Matching applies Unicode NFKC and locale-independent lowercase normalization. Short entries, including `a`, `i` and `k`, count; there is no minimum word-length exemption. Punctuation does not join separate letters into a word. Leetspeak, arbitrary homoglyphs and other languages are not covered by this English dictionary.

This is an additional project rule requested for Cyber Range. It goes beyond the existing standards-based whole-password blocklist. The meter remains advisory and cannot guarantee policy acceptance. Generated credentials use 24 random digits/symbols (Web Crypto), avoiding English dictionary substrings while retaining roughly 100 bits of alphabet entropy. Keycloak still enforces length, blocklist, username/email and password history.

## Build and install

Requires Java 21 and Maven to build. Runtime target is exactly Keycloak 25.0.6; installation refuses other versions. From this directory:

```sh
mvn clean verify
```

The host installer uses the prebuilt `deploy/keycloak/providers/cyberrange-dictionary-policy-1.0.0.jar`. After `mvn clean verify`, copy `target/cyberrange-dictionary-policy-1.0.0.jar` there, or set `DICTIONARY_POLICY_JAR`. The artifact includes its SPI service registration, dictionary, metadata and English error message. Do not commit `target/`.

On the LXD host:

```sh
bash ~/cyberrange/deploy/host/enable_keycloak_password_policy.sh
bash ~/cyberrange/deploy/host/install_keycloak_theme.sh
bash ~/cyberrange/deploy/host/verify_password_policy.sh
```

The policy-enabling script installs the provider, restarts Keycloak when the artifact changes, waits for readiness, confirms provider registration, sets the realm policy and verifies readback. The unit-install and realm-import paths install the provider too, before the imported realm is consumed. Missing artifacts, a mismatched dictionary checksum, incompatible Keycloak versions and startup failures stop installation. Re-export the realm after enabling the new policy. Existing passwords are checked only when set or changed.

## Pinned dictionary and reproduction

SCOWL/English Speller Database revision `7e99edab8e32f9f9ea2b15f249ca8d4d67237410` (`rel-2026.02.25`), from https://github.com/en-wl/wordlist. The full upstream copyright/license is preserved at `src/main/resources/dictionary/Copyright` and packaged with the provider.

Extraction: size60 American/British/Oxford/Canadian spellings, variant level1, no special categories, abbreviations or proper-name classes; deaccent; retain lowercase ASCII surface forms plus `I -> i`; sort and deduplicate. Capitalized surface forms are excluded before lowercasing because upstream proper-name classifications are incomplete. Result: 81,370 entries, 780,069 bytes, longest entry23 letters. Runtime and installer require SHA256 `981da5c06d01da21cdf6f37def0661ffb028266d21ce8f572510a5022e0a238d`.

After extracting the pinned source archive, run in its root:

```sh
python -X utf8 combine.py create-db scowl.db
```

Then run this project's `generate_dictionary.py /path/to/extracted-source`. It refuses output whose checksum differs from the pinned dictionary.

## Verification

JUnit checks both SPI validation paths, substring/short-word matching, Unicode/case normalization, work bounds, accepted word-free credentials, strict configuration, and fail-closed missing/corrupt data. Host tests verify policy readback, artifact/version refusal, ownership, checksum, restart/readiness and lifecycle ordering.

For a disposable local Keycloak only, run `test_local_keycloak.cjs` with the bootstrap-admin password in `LOCAL_KEYCLOAK_ADMIN_PASSWORD` and Playwright available. It creates and removes a temporary realm and checks real Admin create/reset and forced change-password behavior, including a browser with JavaScript disabled. Never point this harness at production.
