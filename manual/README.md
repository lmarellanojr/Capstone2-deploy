# LLMS Cyber Range — Operator Manual

Read this on your PC. Do not copy this Manual onto the Ampere VM.

| If you have | On the PC, read | On the VM |
| :---- | :---- | :---- |
| **Deploy kit** `C:\Capstone2-Deploy` | `C:\Capstone2-Deploy\manual\` (this file, inside the kit) | copy **`cyberrange/` contents** to `~/cyberrange` (Chapter 01 Step 6 **path B**) |
| Split remotes | `C:\Capstone2-Manual` | `git clone <product-remote> ~/cyberrange` |

Do **not** clone the kit root onto the VM. That nests `manual/` inside `~/cyberrange`.

Wherever a chapter still names a Windows path:

| the chapters say | in the kit, read |
|---|---|
| `C:\Capstone2-Manual` | `C:\Capstone2-Deploy\manual` |
| `C:\Capstone2Implementation` | `C:\Capstone2-Deploy\cyberrange` |

`~/cyberrange` on the host is always the **code** tree.

**Quota:** Always Free is one A1 (2 OCPU / 12 GiB / 200 GB) **per tenancy**. Do not terminate the live proof host to free quota. A second-host rebuild needs another tenancy or a paid shape. Live IPs and passwords go in `private/OPERATOR-RECORD.local.md` (gitignored), not in these chapters.

See **`SPRINT-PLAN.md`** for second-host tracking.

---

## Quick Start

**Kit:**

- PC: this file, then the reading order below.
- VM: Chapter 01 Step 6 path B (tar from **inside** `cyberrange/`).
- Day-2 team shipping (after the host is up): merge to `main` builds on GitHub; **Promote** publishes Release `ampere-live`; Ampere's opt-in pull timer applies it. Do not install a GitHub Actions runner on the VM. Break-glass scp remains Chapter 01 path B. Operator HTML guide phase M (`C:\Capstone Learning Guide\Capstone2-Deploy-Guide.html`) has the steps.

**Split remotes:**

```bash
# On Ampere
git clone <product-remote> ~/cyberrange
mkdir -m 700 ~/cyberrange-data
```

---

## Reading Order

Follow these files in sequence on the **operator PC**:

1. **Pre-deployment guides:**
   - `M4 to Ampere Guide for First-Time OCI.md` — Set up tenancy, SSH key, Always Free
   - `Ampere SSH Guide for First-Time Operators.md` — Access the VM

2. **Host infrastructure (chapters 01–03):**
   - `00-prerequisites.md` — Prerequisites
   - `01-oci-host-and-network.md` — VCN, LXD, networking
   - `02-gateway-and-wazuh.md` — Guacamole, Wazuh manager-only
   - `03-golden-images-arm64.md` — Build golden student images

3. **Services (chapters 04–06):**
   - `04-core-services.md` — Core LXD services
   - `05-provisioning-api-and-portal.md` — API, Portal, Bridge
   - `06-scoring.md` — Scoring (optional)

4. **Deployment and verification:**
   - `Ampere Cloudflare Tunnel Guide for First-Time Operators.md` — DNS tunnel
   - `07-deployment-and-cutover.md` — Deploy and cutover
   - `08-verification.md` — Verification checklist
   - `09-known-issues.md` — Known issues and workarounds

5. **Reference:**
   - `appendix-network-map.md` — Network diagram and IP addresses
   - `SPRINT-PLAN.md` — Second-host schedule and per-chapter status
   - `OPERATOR-RECORD.example.md` — copy to `private/OPERATOR-RECORD.local.md`

---

## Recording the second-host run

Each chapter has a pre-filled evidence stub at
`docs/evidence/2026-09-secondhost-chNN-*.md` (in the kit: `cyberrange/docs/evidence/`).
Fill it in **as you go** — paste real output, do not retype it — then tick the row in
`SPRINT-PLAN.md` Section B.

Nine chapters, nine evidence notes. See `SPRINT-PLAN.md` Section B.

Two rules that matter more than they look:

- **A gate with no pasted output is NOT VERIFIED, not PASS.**
- **Fill in the Deviations table even when the chapter passes.** Anything you had
  to do that the Manual does not say is the finding this run exists to produce.
