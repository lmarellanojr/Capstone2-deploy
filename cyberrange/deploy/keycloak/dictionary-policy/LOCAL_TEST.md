# Disposable Keycloak acceptance check

`test_local_keycloak.cjs` tests the actual Keycloak 25.0.6 Admin API and browser
required action using a temporary realm. It only accepts
`http://127.0.0.1:18083/auth/`, blocks browser requests to other hosts or ports,
and starts a callback listener on `127.0.0.1:18084`. It deletes the temporary
realm in `finally`; use only a disposable local Keycloak runtime.

Before running, install the built provider JAR and the `cyberrange` login theme
into that runtime. Start it with `localtestadmin` as its bootstrap admin, without
MFA. Set `LOCAL_KEYCLOAK_ADMIN_PASSWORD` to that admin's password in the process
environment. The harness needs Node.js, Playwright and installed Chrome; point
`NODE_PATH` at the portal's `node_modules` if running outside that package.

```powershell
$env:NODE_PATH = 'cyberrange/portal/node_modules'
node cyberrange/deploy/keycloak/dictionary-policy/test_local_keycloak.cjs
```

The check verifies dictionary rejection during user creation, absence of a
partially created user, rejection during reset without changing the existing
credential, and mixed-case embedded words and passphrases on UPDATE_PASSWORD.
It runs the browser required action with JavaScript enabled and disabled, then
accepts a 24-character numeric/symbol password and authenticates with it.
With JavaScript enabled it uses the actual Generate password button.

Initial-form and dictionary-error screenshots are saved under
`Downloads/cyberrange-keycloak-local-test/`, with both new-password fields
empty. Passwords and tokens are never printed. This check provides evidence
for the isolated runtime; production deployment remains separate.
