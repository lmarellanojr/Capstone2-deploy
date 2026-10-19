# Retired dictionary substring password provider

The active Cyber Range realm no longer uses `dictionaryWords(scowl-en-v1)`. Users can choose a unique password or passphrase containing ordinary English words. The realm continues to enforce 8–128 characters (with mandatory TOTP), a whole-password common-password blocklist, username/email checks, three-password history, and temporary brute-force lockout. `enable_keycloak_password_policy.sh` removes the substring rule; run it, verify the policy, and re-export the realm before a container recreate. `push_keycloak_realm.sh` rejects old exports that still include the rule.

The source and installer below are retained for historical compatibility with old realm snapshots and isolated provider tests. The provider may remain installed but is inert unless a realm explicitly enables it.

Issue #174, parent #169, originally introduced the `dictionaryWords(scowl-en-v1)` policy. When enabled, that provider rejects English dictionary words of two or more letters anywhere in a password, including longer values and multi-word passphrases. The single-letter words `a`, `i`, and `o` are allowed. Matching applies Unicode NFKC and locale-independent lowercase normalization. Punctuation does not join separate letters into a word. Leetspeak, arbitrary homoglyphs and other languages are not covered by this English dictionary.

That additional project rule went beyond the standards-based whole-password blocklist and proved too restrictive for user-chosen passwords. The meter remains advisory and cannot guarantee policy acceptance. Generated credentials use 24 random digits/symbols (Web Crypto) and remain optional. Keycloak still enforces length, blocklist, username/email and password history.

## Build and install

Requires Java 21 and Maven to build. Runtime target is exactly Keycloak 25.0.6; installation refuses other versions. From this directory:

```sh
mvn clean verify
```

The host installer uses the prebuilt `deploy/keycloak/providers/cyberrange-dictionary-policy-1.0.0.jar`. After `mvn clean verify`, copy `target/cyberrange-dictionary-policy-1.0.0.jar` there, or set `DICTIONARY_POLICY_JAR`. The artifact includes its SPI service registration, dictionary, metadata and English error message. Do not commit `target/`.

To apply the current policy on the LXD host:

```sh
bash ~/cyberrange/deploy/host/enable_keycloak_password_policy.sh
bash ~/cyberrange/deploy/host/install_keycloak_theme.sh
bash ~/cyberrange/deploy/host/verify_password_policy.sh
```

The policy-enabling script installs the whole-password blocklist, sets the realm policy and verifies readback. The unit-install and realm-import paths still install the provider for compatibility, but a new export must omit `dictionaryWords` before import. Existing passwords are checked only when set or changed.

## Pinned dictionary and reproduction

SCOWL/English Speller Database revision `7e99edab8e32f9f9ea2b15f249ca8d4d67237410` (`rel-2026.02.25`), from https://github.com/en-wl/wordlist. The full upstream copyright/license is preserved at `src/main/resources/dictionary/Copyright` and packaged with the provider.

Extraction: size60 American/British/Oxford/Canadian spellings, variant level1, no special categories, abbreviations or proper-name classes; deaccent; retain lowercase ASCII surface forms of two or more letters; sort and deduplicate. Capitalized surface forms are excluded before lowercasing because upstream proper-name classifications are incomplete. SCOWL treats single-letter entries as letter names, so they are excluded. Result: 81,344 entries, 780,017 bytes, longest entry23 letters. Runtime and installer require SHA256 `83f553bafcd8fc9fb32561fc69af2cb48778f056c7748aa2308d7adfd36510b7`.

After extracting the pinned source archive, run in its root:

```sh
python -X utf8 combine.py create-db scowl.db
```

Then run this project's `generate_dictionary.py /path/to/extracted-source`. It refuses output whose checksum differs from the pinned dictionary.

## Verification

JUnit checks both SPI validation paths, substring matching, acceptance of `a`, `i`, and `o`, Unicode/case normalization, work bounds, accepted word-free credentials, strict scowl-en-v1 configuration, and fail-closed missing/corrupt data. Host tests verify policy readback, artifact/version refusal, ownership, checksum, restart/readiness and lifecycle ordering.

For a disposable local Keycloak only, run `test_local_keycloak.cjs` with the bootstrap-admin password in `LOCAL_KEYCLOAK_ADMIN_PASSWORD` and Playwright available. It creates and removes a temporary realm and checks real Admin create/reset and forced change-password behavior, including a browser with JavaScript disabled. Never point this harness at production.
