# ISSUE-287 — Booking Dormant-Router Finding: Disposition Record

**Issue:** [#287](https://github.com/lmarellanojr/Capstone2-deploy/issues/287) — Reconcile the Post-UAT Finding With Retired Account Provisioning
**Parent:** #280 (Identity, RBAC, Monitoring post-UAT remediation)
**Owner:** Lenie Joice Mendoza (@leniejoice)
**Testing partner:** Shekinah Jabez Florentino (independently verifies backend findings; no self-approval)
**Related:** #192 (completed — manual account creation by domain owners), #193, #189, #283 (evidence preservation)
**Recorded:** 2026-10-22 (Asia/Manila)
**Code context:** `origin/main` = `0d4633a0e248ac040615dd6ca38395535a2ab4f8` (unchanged since the ticket was written)

> **Status: Pending live/deployment proof and partner verification.** This record disposes of the
> source-tree portion of the finding against exact SHAs. The per-host deployed-SHA checks, the disposable
> test booking, and Shekinah's independent verification are **instructions, not yet executed** (§6). No
> historical UAT data is rescored here; this is post-UAT hygiene evidence only.

---

## 1. Disposition

The audit's "dormant booking router" finding is **already resolved on `main`**. The HTTP router that
auto-provisioned tester accounts (`booking_router.py`) and its test were removed before the current `main`,
as part of completed #192's switch to manual account creation by domain owners. No code needs to change on
`main` to satisfy the finding; the correct deliverable is this disposition record plus the evidence below.

One premise in the ticket is inaccurate and is corrected in §4: there is **no "Admin → Users credential
email."** By design since #192, Admin user creation sends no credentials by email; the handoff is a
short-lived in-portal modal.

## 2. SHA comparison against `main` and #192

The entire history of the router is two commits:

| Commit | What it did | Date |
|---|---|---|
| `ae359c7` "feat: provision tester accounts for bookings" | **Added** `booking_router.py` and `test_booking_router.py` | 2026-10-13 |
| `80c544c` "Simplify booking credential workflow" | **Deleted** both files; removed the `include_router` mount from `provision_api_fastapi.py`, the portal `api/booking/provision` route and its test, and the env-example provisioning secrets | 2026-10-13 |

`80c544c` shipped in **PR #193** (merge `bb2a40c`), which closed **#192**. `bb2a40c` is an ancestor of
`main`, so the deletion is present on `main`.

Verified this run:
```
$ git log --oneline --all -- '*booking_router.py' '*test_booking_router.py'
80c544c Simplify booking credential workflow
ae359c7 feat: provision tester accounts for bookings

$ git merge-base --is-ancestor bb2a40c origin/main && echo ancestor
ancestor

$ git cat-file -e origin/main:cyberrange/src/provisioning/booking_router.py; echo $?
# fatal: path does not exist  → main ABSENT (expected)

$ grep -n 'booking_router\|include_router(booking' cyberrange/src/provisioning/provision_api_fastapi.py
# (no matches — router is not imported or mounted)
```

At `0d4633a` the booking tree is `cyberrange/booking/Code.gs` and
`cyberrange/src/provisioning/test_booking_script.cjs`, with **no** `booking_router.py` /
`test_booking_router.py` — matching the ticket's stated expectation.

## 3. Where the obsolete router still exists (not on `main`)

The router still lives on three stale remote branches. **None is `main`**, and deleting them is the
repo owner's call (out of scope for this ticket). Verified this run with `git ls-tree -r <sha>`:

| Branch | Head SHA | PR | `booking_router.py` present? |
|---|---|---|---|
| `origin/feature/booking-session-accounts` | `aa9f4d9` | #190 (merged) | yes |
| `origin/fix/booking-row-reconciliation-identity` | `1dd0ad9` | #191 (closed) | yes |
| `origin/fix/wazuh-manager-pod-route` | `6fb0f4f` | #195 (merged; older snapshot `main` already supersedes) | yes |

No leftover was removed from `main`, because the router and its routes are **not present** on `main`. Per
the ticket, leftovers are removed only where actually present; self-service provisioning is **not**
reintroduced to satisfy any stale test.

## 4. Handoff checks (source copy)

- **Tester confirmation says credentials come separately** — `cyberrange/booking/Code.gs:405`, `:415`
  ("A domain owner will create your account after booking and share the login details separately").
- **Organizer notice carries the "Action required" step** to create the Student in Admin → Users —
  `cyberrange/booking/Code.gs:410` ("Before the session, open Admin → Users and create an enabled Student
  account for …"), with the "Action required" callout at `:253`/`:265`. The notice is sent to the fixed
  four-owner `NOTIFY_EMAIL` list (`Code.gs:20`), and the assigned domain is named in the body; per-domain
  routing would be a **new** requirement, not part of this finding.
- **"Admin → Users credential email" — ticket premise corrected.** There is no credential email by design
  (#192). `src/provisioning/test_admin_users.py:274`
  (`test_create_never_emails_or_exposes_credentials`) fails if SMTP is touched on create; the handoff is the
  short-lived `CredentialHandoffModal` (`portal/src/app/admin/users/page.tsx:442`). The check that still
  works is the **credential handoff modal**, not an email.

## 5. Leftovers — kept vs. noted

- **Kept on purpose:** migration `v13 booking_account_claims` remains as inert history
  (`src/provisioning/schema/README.md`, pinned by `test_score_hybrid.py`). Do not remove.
- **Noted, not removed:** `KeycloakAdmin.find_users_by_email` (`src/provisioning/keycloak_admin.py:191`)
  arrived with the booking feature (`ae359c7`) and now has **no callers**; its docstring still reads
  "booking account reuse." This is harmless dead code. It is left in place in this disposition because the
  owner has not yet decided whether to delete it (see "Decision needed" below); removing it would be a
  separate one-line scoped change.

## 6. Evidence — commands and actual results

**Executed this run (2026-10-22, local dev; borrowed venv from `../Capstone2-deploy`, worktree has none):**

```
$ node cyberrange/src/provisioning/test_booking_script.cjs
Notification email failed: Error: temporary mail failure      # simulated failure for the retry test
Apps Script booking, credential instructions, organizer retries, race deduplication,
per-row locking, header migration, calendar, and cancellation checks passed.
# exit 0

$ cd cyberrange && .venv/bin/python -m pytest -q -p no:warnings \
    src/provisioning/test_admin_users.py src/provisioning/test_sec01_rbac_matrix.py \
    src/provisioning/test_score_hybrid.py -k 'admin or booking or rbac or sec01 or users'
411 passed, 40 deselected in 5.59s
```

Guards confirming no reintroduction of the retired secret (grep this run):
```
$ grep -rn BOOKING_PROVISION_SECRET cyberrange
cyberrange/src/provisioning/test_booking_script.cjs:63:   # throws if Code.gs reads a provisioning secret
cyberrange/src/provisioning/test_booking_script.cjs:180:  # asserts no BOOKING_PROVISION_SECRET / UrlFetchApp.fetch / reconcilePendingProvisioning()
```
`BOOKING_PROVISION_SECRET` appears only inside the test that **forbids** it.

**Pending (instructions — NOT executed here; require #283 preservation and disposable accounts):**

- On each deployed domain host d1–d4: record `git rev-parse HEAD`; confirm `booking_router.py` is absent;
  confirm `POST /booking/provision` returns 404. Compare each host SHA to `0d4633a` / the original UAT build.
- One disposable test booking: tester confirmation received; organizer notice received; a disposable Student
  created in Admin → Users shows the handoff modal. Shekinah verifies independently and records
  date/build, expected vs. actual, and any defect.

## 7. Acceptance criteria status

- [x] Finding dispositioned against exact SHAs and completed #192 evidence — §1–§4, this run.
- [x] No reintroduction of `BOOKING_PROVISION_SECRET` or automatic account creation — §6 guards; router
      absent and unmounted on `main`.
- [~] Current booking/admin handoff checks pass — source-level checks pass this run (§6); the live
      disposable-booking check is **pending** (§6).
- [ ] Shekinah verifies backend findings; Leonardo checks any portal change by Maricar — **pending** (no
      portal change was made, so Maricar/Leonardo involvement is not triggered by this record).
- [ ] Any material effect on the evaluated journey/score has a documented follow-up decision, separate from
      original UAT — no scoring effect; no historical rescoring performed.

## 8. Decision needed from the owner

1. Correct the ticket wording "Admin → Users credential email still works" to "the credential handoff modal
   still works" (an email would contradict #192).
2. Confirm the four-owner broadcast (`Code.gs:20`) is acceptable for "notice reaches the assigned domain
   owner," or raise per-domain routing as a new requirement.
3. Decide whether to delete the unused `find_users_by_email` (§5) as a separate one-line PR, or leave it.
4. Who can read the deployed SHAs on d1–d4 and the UAT build SHA, and whether #283 is far enough along to
   permit the disposable test booking (§6).
