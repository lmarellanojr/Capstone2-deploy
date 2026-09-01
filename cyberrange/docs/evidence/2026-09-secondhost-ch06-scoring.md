# Second host — Chapter 06: Scoring

**Date:** 2026-09-__ (UTC __:__Z)
**Host:** `llms_admin@<SECOND_HOST_PUBLIC_IP>` (instance `<name>`)
**Manual commit:** `<sha of C:\Capstone2-Manual at the time of the run>`
**Product commit:** `<sha of the ~/cyberrange checkout on the host>`
**Verdict:** **PASS | FAIL | PARTIAL**

> Fill this in **as you go**, not afterwards. Paste real output; do not retype it.
> A gate with no output pasted under it is **NOT VERIFIED**, not PASS.

---

## Gates

| # | Gate | Expected | Result |
|---|---|---|---|
| 1 | **OPTIONAL — may be skipped** | if skipped, say so and move on; do not block cutover | |
| 2 | Admin token via JWT | `/security/user/authenticate` returns a token | |
| 3 | scoring user created | note the id (was 100 on host 1) | |
| 4 | **Role IDs read, not assumed** | paste the `/security/roles` listing; record which id is `readonly` | |
| 5 | Role attached | scoring has readonly | |
| 6 | **Negative test** | scoring creating a user -> **403**. A 200 here is a FAIL | |
| 7 | Built-in account rotated | `wazuh` password changed | |
| 8 | env wired | WAZUH_API_URL/TLS_VERIFY/CA_BUNDLE/USER/PW in `env/.env` 600 | |
| 9 | Agent + alerts checks | **deferred to Chapter 07's gate** — no pod exists yet | |

---

## Output

```text
<paste the command output that backs each gate above>
```

---

## Deviations from the Manual

Anything you had to do that Chapter 06 does not say, or that it says wrongly.
**This section is the point of the whole run** — it is what Phase 3 fixes.

| # | Manual says | What was actually needed | Chapter/§ |
|---|---|---|---|
| 1 | | | |

If this table is empty, say so explicitly: "No deviations." An empty table with no
statement reads as "not filled in."

---

## Time

| | |
|---|---|
| Started | |
| Finished | |
| Blocked on | |

---

## Next

Chapter 07.
