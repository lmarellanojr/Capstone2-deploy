# Second host — Chapter 05: Provisioning API and portal

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
| 1 | Portal answers | `/api/auth/providers` returns JSON | |
| 2 | Login page | `/login` 200 direct and through Path B | |
| 3 | OIDC round trip | student login reaches `/dashboard`, no Update-Account form | |
| 4 | Dashboard cap | shows `n/1`, not `/6` | |

---

## Output

```text
<paste the command output that backs each gate above>
```

---

## Deviations from the Manual

Anything you had to do that Chapter 05 does not say, or that it says wrongly.
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

Chapter 06.
