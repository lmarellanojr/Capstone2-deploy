# Scenario 2 (scorer id 6) check diagnostics

Instructors get a reason when a SQL Injection / Reflected XSS attempt in the browser does not score. The portal calls this lab Scenario 2; the scorer calls it scenario 6. Students still see the generic result. Switches, storage, access and rollback are shared with every scenario: see [SCORING-DIAGNOSTICS.md](SCORING-DIAGNOSTICS.md).

Unlike the other scenarios, the reasons come from the portal's DVWA proxy, not from `scoring_checks.sh`. Students do this lab in the browser, and the proxy is what scores it.

## Live checks (baseline)

`detectBrowserMilestone` in `portal/src/lib/dvwaScoreSignals.ts` runs on every DVWA page the proxy returns with HTTP 200. Read at the release before this change:

| Milestone | Pass condition |
|---|---|
| M1 injection point | `/vulnerabilities/sqli`, a non-placeholder `id`, and either an `OR 1=1` payload with 2 or more `First name:` rows, or a quote with a SQL syntax error |
| M2 database extraction | `UNION SELECT` with `information_schema`/`database()`, and a result cell `information_schema` or `dvwa` |
| M3 admin hash | `UNION SELECT … FROM users`, and a 32-hex result cell |
| M4 reflected XSS | `/vulnerabilities/xss_r`, a non-placeholder `name` containing `<script`, and a response with `Hello <script` |

A request that doesn't pass is ignored, and almost every page view doesn't pass. The Kali `check_scenario_6` path is a fallback the poller also runs.

## Reason codes

`browserNearMiss` runs only when the detector returned nothing for the same request. It uses the detector's own payload tests to decide which milestone the request was aimed at, and it returns nothing unless that is clear.

| Code | Milestones | Meaning |
|---|---|---|
| `SECURITY_NOT_LOW` | 1–4 | the request was an attempt, and DVWA's `security` cookie said medium, high or impossible. Checked first. If the cookie is absent, the level is not guessed |
| `PAYLOAD_NO_ROWS` | 1 | an `OR 1=1` payload, but the page listed fewer than two users |
| `QUOTE_NO_ERROR` | 1 | an id with a quote and no `or`, `\|\|` or `UNION`, and the page showed no SQL syntax error and at most one user |
| `UNION_NO_METADATA` | 2 | `UNION SELECT` on `information_schema`/`database()`, but no result cell was `information_schema` or `dvwa` |
| `UNION_NO_HASH` | 3 | `UNION SELECT … FROM users`, but no result cell was a 32-character hash |
| `XSS_NOT_REFLECTED` | 4 | a `name` containing `<script`, but the page did not contain `Hello <script` |
| `CHECK_ERROR` | 1–4 | the panel's fallback for an unknown stored code. The proxy never sends it |

These stay generic (nothing is sent): a plain `id` or `name`, a guide placeholder (`<session_id>`, `<admin_hash_here>`), a `UNION` on another table, a tautology the detector has no rule for (`' or 'a'='a`, `' OR true#`, `' || 1#`) or any quoted id whose page listed several users (it may have worked), other DVWA pages, and any response other than HTTP 200.

Each code says what the response lacked. None says why, or how to fix it.

## Flow and data

1. The proxy classifies the request and, if there is a code, posts `{student_id, pod_id, scenario_id: 6, milestone_id, reason}` to `POST /internal/browser-diagnostic` with `X-Browser-Score-Secret`. The call is not awaited, so the student's page never waits on it. The payload, the page and the cookie value are never sent.
2. The API checks the secret, the code (scenario 6's list only), the milestone (1–4), and that the pod is ACTIVE, on scenario 06 and owned by that student, using the same checks as `/internal/browser-score`. With 6 switched off it returns `{"recorded": false}` and stores nothing.
3. If this student already passed that milestone on this pod (browser or Kali), the PASS row is kept. Otherwise one FAIL row is upserted with `location=NONE copies=0`.
4. A browser pass (`/internal/browser-score`) or a Kali-fallback PASS replaces the reason. A Kali-fallback FAIL is not recorded, because it carries no reason and would overwrite the proxy's.

## Rollout

1. Enable only after the Scenario 3 pilot has been reviewed: add `6` to `SCORING_DIAGNOSTICS_SCENARIOS` (e.g. `9,6`) and restart the API. The portal needs no change beyond this release. It already has `BROWSER_SCORE_SECRET`.
2. On one pod, in the browser: Reflected XSS `<script>alert(1)</script>` with security set to medium (DVWA medium strips `<script>`, so this gives M4 `SECURITY_NOT_LOW`). Don't use a SQLi payload on medium for this: there `1' OR '1'='1` returns a SQL syntax error, and that scores M1. Then, on Low, a `UNION … FROM users` that selects `first_name` instead of `password` (`UNION_NO_HASH`). Then the real M1 payload: check that the M1 row turns to PASS, and that a later `1'#` (a lone quote that shows no error and one row, so it would be `QUOTE_NO_ERROR`) doesn't change it. A plain `1'` on Low raises the syntax error and scores, so it doesn't test this.
3. Compare each reason in the instructor panel with what was sent, and confirm that the page and the PASS/FAIL the student saw are unchanged.
4. Roll back by removing `6` from the list and restarting. The proxy keeps posting, and the API stores nothing.
