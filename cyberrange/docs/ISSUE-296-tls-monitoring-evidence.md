# ISSUE-296: post-UAT Wazuh TLS trust and monitoring coverage limits

**Issue:** [#296](https://github.com/lmarellanojr/Capstone2-deploy/issues/296) (parent [#280](https://github.com/lmarellanojr/Capstone2-deploy/issues/280))
**Owner:** Lenie Joice Mendoza
**Testing partner:** Shekinah Jabez Florentino (independently repeats §3-§5 and checks the §7 wording against what she observes)
**Implementation owner:** [#168](https://github.com/lmarellanojr/Capstone2-deploy/issues/168) (merged as PR [#275](https://github.com/lmarellanojr/Capstone2-deploy/pull/275)); related #153, #154
**Code baseline:** `main` at `0d4633a` (2026-10-21 merge of PR #275)
**Status:** Pending evidence. Started 2026-10-22 (Asia/Manila). No live check in this document has been run yet.

This is **post-UAT technical verification**, not a new participant evaluation. Nothing here changes or rescores original UAT data. TLS implementation work stays in #168; if a check below fails, the defect is raised there, not fixed under this issue.

Before running anything in §3-§5 on a host, original UAT evidence must be preserved under [#283](https://github.com/lmarellanojr/Capstone2-deploy/issues/283).

---

## 1. What is being verified

| Required change (#296) | Section |
|---|---|
| Current `WAZUH_TLS_VERIFY`, trust configuration, manager certificate identity, enrollment status; link #168 evidence | §2, §3 |
| Disposable checks: trusted connection succeeds, invalid certificate fails, verification never disabled | §4 |
| Manager-only / agent coverage, retention (with Leonardo), identity / role-revocation limits | §5, §6 |
| Verified MFA, SIEM terminology and limitations wording for Shekinah; missing proof marked Pending | §7 |

---

## 2. What the code does (read from `main` `0d4633a`, not live evidence)

| Behavior | Where |
|---|---|
| Verification is on unless switched off: `WAZUH_TLS_VERIFY` defaults to `"true"` | `cyberrange/src/provisioning/config.py:89` |
| Only `false` / `0` / `no` disables verification, and that logs a warning. Otherwise the client trusts `WAZUH_CA_BUNDLE`, then `WAZUH_CERT_PATH`, then the system CA store (logged as an error) | `cyberrange/src/provisioning/wazuh_client.py:50-63` |
| The internal CA one-shot publishes `certs/wazuh-api-ca.crt` and points `WAZUH_CA_BUNDLE` at it | `cyberrange/deploy/host/issue_wazuh_internal_ca.py:186-201` |
| Once `certs/wazuh-api-ca.crt` exists, the release-time cert sync refuses a live manager cert that does not chain to it. Without the CA file the host stays on the transitional leaf pin `certs/wazuh-api.crt` | `cyberrange/deploy/host/sync_wazuh_api_cert.py:185-200`, called from `cyberrange/deploy/host/pull_release.sh:22-42` |
| Admin → System health shows `Wazuh TLS-Degraded` when the manager is reachable but TLS verification fails | `cyberrange/src/provisioning/infra_health.py:228-229` |
| A TLS failure during enrollment logs `WAZUH_ENROLL_FAIL ... tls:` and the lab does **not** become ACTIVE | `cyberrange/src/provisioning/wazuh_client.py:282-286` |
| Enrollment waits for every enrolled agent to be active (`WAZUH_AGENT_CONNECT_TIMEOUT_S`, default 90 s), then logs `WAZUH_ENROLL_OK` | `cyberrange/src/provisioning/provision.py:402-411` |
| On teardown, the lab's agents are deleted by id, then by name | `cyberrange/src/provisioning/wazuh_client.py:345-373` (`deregister_agents`) |

PR #275 states its CA one-shot had **not** been run on the Ampere host when it merged. Until §3 is recorded, the live host may still be on the leaf pin.

---

## 3. Live TLS state (Pending)

Host: _Pending: Ampere host or cyberrange.cyberonline.space, decided by the owner_
Build: _Pending: `DEPLOYED_SHA` / release tag on the host_
Date (Asia/Manila): _Pending_

```bash
# Configuration (paths and flags only, no secrets)
grep -E '^WAZUH_(TLS_VERIFY|CA_BUNDLE|CERT_PATH|API_URL)=' ~/cyberrange/env/.env
ls -l ~/cyberrange/certs/wazuh-api-ca.crt ~/cyberrange/certs/wazuh-api.crt

# Manager certificate identity, as served
openssl s_client -connect localhost:55000 -servername localhost </dev/null 2>/dev/null \
  | openssl x509 -noout -subject -issuer -ext subjectAltName -fingerprint -sha256

# Does it verify against the configured bundle?
openssl s_client -connect localhost:55000 -servername localhost \
  -CAfile "$(grep -E '^WAZUH_CA_BUNDLE=' ~/cyberrange/env/.env | cut -d= -f2-)" </dev/null 2>/dev/null \
  | grep 'Verify return code'            # expect: Verify return code: 0 (ok)
```

Also record the Admin → System health row for Wazuh (expect not `TLS-Degraded`).

**Live evidence:**
<!-- PASTE SANITIZED OUTPUT OF §3 HERE -->
_Pending: not run._

---

## 4. Positive and negative trust checks (Pending)

Disposable and read-only: nothing on the host is changed, and verification is never turned off (no `curl -k`, no `verify=False`, no `WAZUH_TLS_VERIFY=false`).

```bash
BUNDLE="$(grep -E '^WAZUH_CA_BUNDLE=' ~/cyberrange/env/.env | cut -d= -f2-)"

# Positive: the trusted bundle completes the handshake. 401 = TLS ok, request just has no login.
curl -sS -o /dev/null -w '%{http_code}\n' --cacert "$BUNDLE" https://localhost:55000/   # expect 401

# Negative: a throwaway CA the manager was never signed by.
TMP=$(mktemp -d)
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj '/CN=issue-296-bogus-ca' \
  -keyout "$TMP/bogus.key" -out "$TMP/bogus-ca.crt" 2>/dev/null
curl -sS -o /dev/null --cacert "$TMP/bogus-ca.crt" https://localhost:55000/; echo "curl exit $?"   # expect: curl exit 60
~/cyberrange/.venv/bin/python -c "import requests,sys; requests.get('https://localhost:55000/', verify=sys.argv[1], timeout=5)" \
  "$TMP/bogus-ca.crt" 2>&1 | tail -1                      # expect: requests.exceptions.SSLError ... CERTIFICATE_VERIFY_FAILED
rm -rf "$TMP"
```

**Live evidence:**
<!-- PASTE SANITIZED OUTPUT OF §4 HERE -->
_Pending: not run._

---

## 5. Fresh disposable enrollment (Pending)

Use a disposable student account (not a UAT participant), one lab, then end it.

1. Provision one lab as the disposable student.
2. Read the enrollment event from the `audit_log` **table**. It is not written to any log file: `log_event` inserts into `audit_log` (`cyberrange/src/provisioning/db.py:27-41`), so grepping a log file finds nothing. Use the admin read API:
   ```bash
   curl -sS -H "Authorization: Bearer <admin token>" \
     'https://<portal>/admin/audit-log?event_types=WAZUH_ENROLL_OK,WAZUH_ENROLL_FAIL&student_id=<test student>'
   ```
   If the API isn't reachable, read the table with Python stdlib (no `sqlite3` CLI needed on the host):
   ```bash
   ~/cyberrange/.venv/bin/python -c "import sqlite3,os; c=sqlite3.connect(os.getenv('DB_PATH','/home/llms_admin/cyberrange-data/pod_mgmt.db')); c.row_factory=sqlite3.Row; [print(dict(r)) for r in c.execute(\"SELECT timestamp,event_type,detail FROM audit_log WHERE student_id=? AND event_type IN ('WAZUH_ENROLL_OK','WAZUH_ENROLL_FAIL') ORDER BY id DESC LIMIT 5\", ('<test student>',)).fetchall()]" 2>&1
   ```
   Expect a `WAZUH_ENROLL_OK` row with `... agents={...}`. The `timestamp` column is UTC (SQLite `CURRENT_TIMESTAMP`, `cyberrange/src/provisioning/schema/v1.sql:37`); add 8 h for Asia/Manila when recording.
3. `lxc exec wazuh-manager -- /var/ossec/bin/agent_control -l`. Expect the lab's agents as `Active`.
4. Trigger one alert the student view should show (for example a failed SSH login) and confirm it appears in the portal SIEM panel.
5. End the session, then re-run step 3. Expect the lab's agents to be gone.

**Live evidence:**
<!-- PASTE SANITIZED OUTPUT OF §5 HERE (agent names may stay; no tokens or passwords) -->
_Pending: not run._

---

## 6. Coverage, retention and revocation limits

### Monitoring coverage (code-verified; live confirmation in §5)

- **Manager-only.** The 12 GiB profile runs the Wazuh manager with no indexer, no dashboard and no Filebeat (`manual/02-gateway-and-wazuh.md:289-291`, `manual/09-known-issues.md:262-269`). Students see alerts in the in-portal alert table, not a Wazuh dashboard.
- **Only lab machines whose image ships the agent are enrolled.** Provisioning skips any machine without `/var/ossec/etc/ossec.conf` and logs `no wazuh-agent in image` (`cyberrange/src/provisioning/provision.py:378-387`). The platform's own containers (gateway, Keycloak, portal, API) are not agents.
- **A lab can be ACTIVE without an agent.** TLS, auth and agent-not-connected failures stop the lab. Any other Wazuh error (for example an HTTP 5xx from the manager API) logs `WAZUH_ENROLL_FAIL` and the lab still becomes ACTIVE with no agent id (`cyberrange/src/provisioning/wazuh_client.py:288-297`, `cyberrange/src/provisioning/provision.py:415-425`).

### Retention (Pending, with Leonardo)

The repo sets no Wazuh alert retention or log rotation policy (no `logall` / retention setting found by grep on `0d4633a`). The only retention setting in the repo is for scoring diagnostics (`SCORING_DIAGNOSTICS_RETENTION_DAYS`, default 14; `cyberrange/docs/SCORING-DIAGNOSTICS.md:48`), which is not SIEM data.

_Pending: agreed retention expectation with Leonardo, and the manager's actual on-disk alert files and rotation observed on the host._

### Identity and role revocation (code-verified)

- The API caches a token's introspection result for at most 60 s (`cyberrange/src/provisioning/introspect_cache.py:11`, `20-28`).
- Disabling a user or changing a role **through Admin → Users** clears that user's cached tokens in the API process, so the API refuses them on the next request (`cyberrange/src/provisioning/users_router.py:214-217`).
- The **web-terminal bridge** is a separate service with its own copy of that cache (`cyberrange/bridge-src/bridge.py:180-182`). The Admin call does not clear it, so the bridge can accept a revoked token for up to 60 s. Whether an already-open terminal session is closed on revocation is not shown by the code: **Pending** live check.
- A change made **directly in the Keycloak console** clears no cache: up to 60 s in both the API and the web-terminal bridge.
- Portal pages read roles from the session cookie, so a revoked role still shows in the UI until the next token refresh (documented AUTH-04 limitation; `cyberrange/docs/SEC-01-rbac-evidence.md` §3). Backend calls are still refused.
- Wazuh agents and alerts are keyed by lab (`pod-<student>-<role>`), not by Keycloak identity. Revoking a user does not remove their running lab's agent; ending the lab does.

---

## 7. Wording for Shekinah

Each line is marked with the proof behind it. Lines marked **Pending** must not be used as a claim until the linked evidence exists.

| Topic | Wording | Proof |
|---|---|---|
| SIEM term | "The range uses a **Wazuh manager** (SIEM rule engine) in manager-only mode. There is no Wazuh indexer or dashboard; alerts are shown in the portal's alert table." | Docs + code (§6). Live: **Pending** §5 step 4 |
| Coverage | "Monitoring covers the student's lab machines that ship the Wazuh agent. It does not cover the platform's own services, and it is not full network monitoring." | Code (§6) |
| Coverage limit | "If the Wazuh manager has an unexpected error during setup, a lab can start without monitoring; this is logged as `WAZUH_ENROLL_FAIL`." | Code (§6) |
| TLS | "The API verifies the Wazuh manager's certificate against a pinned bundle; an untrusted certificate is refused and the lab does not start." | Code (§2). Live: **Pending** §3, §4 |
| Trust anchor | "The bundle is the internal Wazuh CA (`wazuh-api-ca.crt`)" **or** "a pinned copy of the manager's own certificate (`wazuh-api.crt`)", whichever §3 shows. | **Pending** §3 |
| MFA | "Every user signs in with a password plus a TOTP code (6 digits, 30 s). Automated verify scripts use dedicated marker-role accounts that cannot be used to skip MFA for real users." | Code: `cyberrange/deploy/host/enable_keycloak_mfa.sh:62-67`, `cyberrange/docs/SEC-03-verify-accounts.md`. Live: **Pending**, Shekinah to confirm on the same build |
| Revocation | "A disabled user or removed role is refused by the API on the next request when changed in Admin → Users, and within 60 seconds otherwise; the portal UI may show the old role until the session refreshes." | Code (§6) |
| Retention | _Pending agreement with Leonardo._ | **Pending** |
| Scope | "These are post-UAT technical checks on build `<sha>`, run on `<date>`. They are not a new participant evaluation and do not change UAT results." | Issue #296 |

---

## 8. Testing partner verification (Pending)

| Date (Asia/Manila) | Build / host | Check | Expected | Actual | Defect |
|---|---|---|---|---|---|
| _Pending_ | | §3 TLS state | Verify return code 0 | | |
| _Pending_ | | §4 positive | HTTP 401 | | |
| _Pending_ | | §4 negative | curl exit 60, `SSLError` | | |
| _Pending_ | | §5 enrollment + teardown | `WAZUH_ENROLL_OK`, agents Active, then removed | | |
| _Pending_ | | §7 wording | Matches observed behavior | | |

---

## 9. Follow-up evaluation decision (Pending)

_Pending until §3-§5 are recorded._ If every check passes, the expected decision is "no effect on the evaluated journey, score interpretation or acceptance criteria; no follow-up evaluation". If a check fails, record the effect here, raise the defect on #168, and keep any new results separate from original UAT.

---

## 10. Known gaps (not fixed here)

- Docs still name the leaf pin `certs/wazuh-api.crt` as `WAZUH_CA_BUNDLE`, not the CA `certs/wazuh-api-ca.crt`: `manual/06-scoring.md:166`, `cyberrange/env/oci-12gib.env.example:82`, and the default in `cyberrange/deploy/host/setup_wazuh_provisioner.sh:29`. Belongs to #168.
- No unit test covers `_wazuh_verify()` or the `TLS-Degraded` health row. Belongs to #168.
- The web-terminal bridge's introspection cache is not cleared on Admin revocation (§6). Hardening candidate for the identity owners; up to 60 s exposure.
