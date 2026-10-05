# SEC-03: how the live verify scripts sign in with MFA on

Issue #144 requires the existing verification scripts to keep working after MFA is turned on, without weakening MFA for real users.

## The problem

Five scripts get their tokens with the password grant: `verify_sec01_rbac.sh`, `verify_sec02_instructor_admin.sh`, `verify_adm_user.sh`, `verify_demo_accounts.sh` and `verify_role_refresh.sh`. Under SEC-03, once an account enrols an authenticator, Keycloak's "Direct Grant - Conditional OTP" asks for a `totp` code on the password grant as well. The scripts used the demo accounts, which people also sign in to, so they would stop at the first token request.

## The fix

`deploy/host/setup_verify_accounts.sh` sets up a separate path. It leaves the browser flow and the `portal` client alone.

| Piece | What it is |
|---|---|
| `cyberrange-verify` realm role | Marker only. It isn't an application role, so the portal and the API ignore it. |
| `verify_student`, `verify_instructor`, `verify_admin` | Dedicated accounts. Each has exactly one application role plus the marker. |
| `cyberrange-verify` client | Confidential, password grant only: no browser login, no redirect URIs, no service account. Its direct-grant flow is overridden with the flow below. |
| `cyberrange verify direct grant` flow | Username → Password → CONDITIONAL sub-flow: *user lacks role `cyberrange-verify`* → **Deny access**. There is no OTP step. |

Accounts without the marker role are refused by the verify client, even with the correct password and the client secret, so it can't be used to skip MFA for a real user. The marker can't be granted through the provision API, which only assigns `student`, `instructor` or `admin`.

The script fails closed. It turns on the client's password grant only after two checks pass:

1. All three verify accounts get a token without a code.
2. A throwaway account that has `student` but not the marker is refused.

If either check fails, the grant stays off and the script exits non-zero. Credentials go to `/home/llms_admin/cyberrange-data/verify-accounts.env` (mode 600) and are never printed. The verify account passwords are regenerated on every run; the client secret is not.

## What changed in the scripts

- `verify_sec01_rbac.sh`, `verify_sec02_instructor_admin.sh` and `verify_role_refresh.sh` now act as the verify accounts, through the verify client.
- `verify_adm_user.sh` uses the verify accounts as the acting Admin, Student and Instructor. The throwaway users it creates still sign in through the `portal` client. They never enrol an authenticator, so that client's conditional OTP doesn't apply to them.
- `verify_demo_accounts.sh` reads the demo accounts' role mappings with kcadm instead of signing them in. It checks token issuance and the exact-role JWT on the verify accounts, and its multi-role self-test now runs on `verify_student`.
- `verify_sec03_mfa.sh` adds four checks: the verify client allows the password grant only, its direct grant is bound to the gated flow, `verify_student` gets a token, and `student_demo` is refused through it.
- `deploy/host/test_verify_scripts_mfa.py` fails if a script goes back to the demo accounts, or if the setup script loses its hardening, its deny step or its fail-closed probe.

## Running it

```bash
bash ~/cyberrange/deploy/host/setup_verify_accounts.sh   # ... VERIFY_GATE_OK / TASK_SEC03_VERIFY_ACCOUNTS_DONE
bash ~/cyberrange/deploy/host/verify_sec03_mfa.sh        # includes the verify-client checks
bash ~/cyberrange/deploy/host/verify_sec01_rbac.sh       # and the other verify_* scripts as before
```

Run it after `create_keycloak_realm.sh` and `enable_keycloak_mfa.sh`, then re-export the realm JSON (Manual 04 §5).

## Notes

- The verify accounts show up in Admin → Users. Disabling one, changing its role or resetting its password breaks the scripts. If that happens, re-run `setup_verify_accounts.sh` to restore them.
- In a browser, the verify accounts get the same OTP enrolment page as everyone else. Their passwords live only in the 600 file on the host, the same trust level as `demo-accounts.env`.
