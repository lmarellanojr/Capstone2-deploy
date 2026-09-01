# Sprint Plan & Second-Host Schedule

Walk chapters `00`–`09` in order on a host that is **not** the live student VM.

**Quota:** Oracle Always Free is **one** A1 (2 OCPU / 12 GiB / 200 GB) per
tenancy. You cannot run two Ampere VMs in the same tenancy. Do **not** terminate
the proof host to free quota. The second-host run needs a **different
tenancy/account** or a paid shape.

Live IPs, tunnel ids, and passwords stay in `private/OPERATOR-RECORD.local.md`.

---

## A. Defense-driven schedule (today → paper)

| Anchor | Date |
|---|---|
| Today | 2026-08-30 |
| **Final defense** | **2026-10-28** |
| **Final paper deadline** | **2026-11-11** |

| Phase | Window | Focus | Where this Manual fits |
|---|---|---|---|
| 1. E2E + defect burn-down | Aug 31 – Sep 13 | Suite against the **live** host; rotate secrets | — |
| **2. Pilot users + second-host build** | **Sep 14 – Sep 27** | SUS/scoring (live host) **and** this Manual's dry-run (second host) — different hosts, no contention | **Run Chapters `00`→`09` here, ideally Sep 14–20** |
| 3. Guide + Chapter III draft | Sep 28 – Oct 11 | Analyze SUS + scoring; write methodology | Fix any Manual gaps found in Phase 2 |
| 4. Freeze + rehearsal prep | Oct 12 – Oct 18 | Code freeze on the **live** host; fallback demo video | Second-host result is the reproducibility evidence |
| 5. Defense rehearsal | Oct 19 – Oct 25 | Mock defense, Q&A | — |
| 6. Defense → paper | Oct 28 → **Nov 11** | Panel feedback, final proofread | Cite second-host evidence in Chapter III/IV |

**Why Phase 2:** chapters are written and Ampere-1 proven, but nobody has followed
this Manual **verbatim on a machine that never saw the engineering workspace**.

**Why not later:** Phase 4 onward is freeze/rehearsal.

---

## B. Chapter status

None of these chapters has been executed on a second host. That is what this run is for.

| Chapter | Written | Reviewed | Second-host run | Evidence stub | Commit |
|---|---|---|---|---|---|
| `00-prerequisites.md` | [x] | [x] | [ ] | `…ch00-prerequisites.md` | |
| `01-oci-host-and-network.md` | [x] | [x] | [ ] | `…ch01-oci-host-and-network.md` | |
| `02-gateway-and-wazuh.md` | [x] | [x] | [ ] | `…ch02-gateway-and-wazuh.md` | |
| `03-golden-images-arm64.md` | [x] | [x] | [ ] | `…ch03-golden-images.md` | |
| `04-core-services.md` | [x] | [x] | [ ] | `…ch04-core-services.md` | |
| `05-provisioning-api-and-portal.md` | [x] | [x] | [ ] | `…ch05-provisioning-api-and-portal.md` | |
| `06-scoring.md` | [x] | [x] | [ ] | `…ch06-scoring.md` | **optional** — skip without blocking |
| `07-deployment-and-cutover.md` | [x] | [x] | [ ] | `…ch07-deployment-and-cutover.md` | |
| `08-verification.md` | [x] | [x] | [ ] | `…ch08-verification.md` | **the pass gate** |
| `09-known-issues.md` | [x] | [x] | n/a | — | reference only |

Stubs live at `docs/evidence/2026-09-secondhost-chNN-*.md` in the **code** tree
(kit: `cyberrange/docs/evidence/`). Fill them as you go.

Check a box only with command output, a screenshot, or a commit SHA.

### Evidence notes, one per chapter

```bash
# after finishing a chapter — kit:
#   C:\Capstone2-Deploy\cyberrange\docs\evidence\
# product repo:
#   docs/evidence/
```

Paste real output into the matching stub. Tick the row above.

**Expect an uneven cadence.** Chapters 01–04 are the heavy ones; 03 is roughly an
hour of baking. Three or four working days is realistic, not nine even days.

**The Deviations table in each stub is the point of the run.**

---

## C. Original build sprints — historical reference for Chapter III

Recalibrated so **Week 0 = Aug 17–23**. Already complete — kept so the paper can
cite real dates.

| Sprint | Goal | Planned window | Actually landed | Manual chapter(s) |
|---|---|---|---|---|
| 0 | Planning & Setup | Aug 17–23 | Pre-dates this window (Aug 11+) | `00` |
| 1 | Core Infrastructure | Aug 24–Sep 6 | Aug 13 | `01` |
| 2 | Access & Monitoring | Sep 7–20 | Aug 13–14 | `02`, `04`, `05` |
| 3 | Offensive Scenarios 1&2 | Sep 21–Oct 4 | Aug 13–14 | `03` |
| 4 | Defensive Scenarios 3&4, Scoring | Oct 5–18 | Aug 14–24 | `06` |
| 5 | Integration & Testing | Oct 19–Nov 1 | Ampere cutover PASS Aug 28–29; **second-host proof still open — see Section A** | `07`, `08` |
| 6 | Evaluation & Closeout | Nov 2–8 | Not started (SUS, paper) | `09` (known-issues only) |

---

## Next

Stand up the second Ampere (other tenancy or paid shape), then follow `README.md`
reading order, checking boxes in Section B as you go.
