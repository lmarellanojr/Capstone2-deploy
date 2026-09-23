# ADM-SYS-02 Keycloak & Wazuh service health

**Issue:** [#55](https://github.com/lmarellanojr/Capstone2-deploy/issues/55)  
**Builds on:** ADM-SYS-01 [#37](https://github.com/lmarellanojr/Capstone2-deploy/issues/37), `ADM-SYS-01-infra-health.md`  
**Audience:** Maricar Punzalan (Admin display), Shekinah Jabez Florentino (review)  
**Author:** Lenie Joice Mendoza

## What changed

`GET /admin/infra-health` (Admin only, unchanged auth) now returns four rows in
`services`, in this order: `API`, `LXD`, `Keycloak`, `Wazuh`. Same shape
`{name, status, detail}`, same three statuses. No new endpoint, no new
portal route, no change to `/capacity` or `/health`.

## What each check does

Both checks reuse integrations the API already depends on, with the credentials
it already holds. No new accounts, roles or secrets.

| Row | Call | Why this call |
|-----|------|---------------|
| Keycloak | `POST` token introspection with a throwaway token, using the API's `portal` client credentials (`auth.probe_introspection`, shared with the startup check) | Every authenticated API request goes through this path. |
| Wazuh | Authenticate as the read-only `scoring` user, then `GET /agents?agents_list=000&select=status` (`wazuh_client`) | Scoring uses the same login. Agent 000 is the manager itself, so `active` means wazuh-manager is running. The `readonly` role can already read agents (Manual 06 §1d). |

## Status mapping

| Situation | Keycloak | Wazuh |
|-----------|----------|-------|
| Answered as expected | Healthy (`active: false` for the probe token) | Healthy (agent 000 `active`) |
| Timeout (2 s) or probe crashed | Unavailable | Unavailable |
| Connection refused / DNS / network | Unavailable | Unavailable |
| Proxy says upstream down (502/503/504) | Unavailable | Unavailable |
| Credentials rejected (401/403) | Degraded | Degraded |
| TLS verification failed | Unavailable (unreachable) | Degraded |
| Other HTTP error or unexpected body | Degraded | Degraded |
| Manager agent not `active` | n/a | Degraded |
| Not configured on the API (`AUTH_ENABLED=false`, no introspect URL/secret; no scoring user/password) | Unavailable, no call made | No login attempted. An unauthenticated `GET /` decides: manager answers → Degraded ("reachable, but scoring credentials not configured"); no answer → Unavailable |

Nothing is ever reported Healthy on a failure path.

## Timeouts and load

- Keycloak and Wazuh run on their own single worker each, in parallel with the
  LXD probe, against one shared 2 s deadline (`SERVICE_PROBE_TIMEOUT_S`). Two
  hung services add about 2 s, not 4.
- Each outbound HTTP call also carries a 2 s timeout, so a worker cannot hang forever.
- Concurrent Admin requests share an in-flight probe instead of stacking
  threads on a dead dependency, the same pattern as the LXD probe.
- Probes run only after `require_role(["admin"])` passes. Students,
  Instructors and unauthenticated callers cannot trigger outbound calls.
- At the Admin UI's 30 s poll, Wazuh sees about 2 logins per minute per open tab,
  well under the default API login-block threshold.

## What never reaches the UI

`detail` strings are fixed text plus, at most, an HTTP status code or a known
Wazuh agent status. No URLs, hostnames, usernames, client ids, secrets, tokens
or exception messages. The probe does not use the Admin's own bearer token and
does not touch the introspection cache.

## Portal

- Rows render through the existing generic `services[]` list on `/admin` and `/admin/system`. No layout change.
- When the portal cannot reach the API (proxy 503), `servicesFromFetchFailure`
  now also shows Keycloak and Wazuh as `Unavailable — not checked (API unreachable)`.
  For 401/403 it still shows only the banner.
- **Keycloak fully down.** The Admin page still loads, because the portal session
  is a cookie. But the API cannot verify the Admin's token, so it answers
  `503 {"detail": "Auth service unavailable"}` before the probe runs. The UI
  recognizes that exact body and shows **Keycloak Unavailable** ("API could not
  reach Keycloak to verify your session"), **API Degraded**, and LXD/Wazuh as
  not checked. Auth is unchanged: this is the 503 the API already returned.
  `test_keycloak_down_returns_the_503_the_admin_ui_recognizes` pins the string.

## Out of scope

No dashboards, history, metrics, alert analytics, indexer/dashboard health or
OVN checks.

## Live host probe (2026-09-24)

Branch code run as a one-off script on the Ampere host behind
`cyberrange.cyberlaboratory.online`, using the API's own `.env`. No deploy, no
restarts, no `pod_mgmt.db` access; temp directory removed afterwards.

| Case | Result |
|------|--------|
| Keycloak, real config | Healthy, 0.01–0.37 s |
| Keycloak, wrong client secret | Degraded |
| Keycloak, nothing listening | Unavailable |
| Keycloak, black-holed address | Unavailable, timed out at 2.00 s |
| Wazuh, real config | Degraded: manager up, but the API `.env` has no `WAZUH_SCORING_USER` / `WAZUH_SCORING_PW` |
| Wazuh, unreachable / black-holed | Unavailable (black-holed timed out at 2.00 s) |
| Both probes in parallel (endpoint path) | 0.04 s total |
| Client secret in output | no |

The live host's deployed tree predates ADM-SYS-01 (`infra_health.py` absent),
so the Admin UI rows themselves are verified after deploy.

## Verifying (for review)

Unit tests: `pytest src/provisioning/test_admin_infra_health.py`.

On a host, as Admin, `GET /api/admin/infra-health` and watch the Keycloak/Wazuh rows:

| Case | How | Expect |
|------|-----|--------|
| Both up | normal | Keycloak Healthy, Wazuh Healthy |
| Wazuh down | stop wazuh-manager (`systemctl stop wazuh-manager` or the container) | Wazuh Unavailable within about 2 s |
| Wazuh bad creds | wrong `WAZUH_SCORING_PW`, restart API | Wazuh Degraded |
| Keycloak down | stop Keycloak, wait ~60 s for the introspection cache to expire, press Refresh on `/admin/system` | Keycloak Unavailable, API Degraded, LXD/Wazuh "not checked". Within the first ~60 s the cached session may reach the probe instead, which also reports Keycloak Unavailable |
| Student/Instructor | call the route | 403, no probe |
