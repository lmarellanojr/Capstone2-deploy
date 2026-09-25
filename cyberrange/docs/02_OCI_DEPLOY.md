# OCI Ampere Deployment — Short Runbook

**Operator payload:** `C:\Capstone2-Deploy` (`manual/` on the PC, `cyberrange/` copied to the VM as `~/cyberrange`).  
If you are working from the full product git instead, the Manual is `C:\Capstone2-Manual`.

## Quick Start

**On Ampere VM** — copy **`cyberrange/` contents only** (Chapter 01 Step 6 path B). Do not `git clone` the kit root to `~/cyberrange` (that would nest `manual/` inside the host tree).

```bash
mkdir -m 700 ~/cyberrange-data
# then extract cyberrange/ as ~/cyberrange  (see Manual chapter 01)
```

**On your operator PC:**
```
Follow: C:\Capstone2-Deploy\manual\README.md
# or, if you have the Manual repo: C:\Capstone2-Manual\README.md
```

---

## Reference: Capstone2 Code in This Repo

| Chapter | What to Deploy | Code Path |
|---------|----------------|-----------|
| Chapter 00 | SSH key, OCI tenancy setup | `env/oci-12gib.env.example` |
| Chapter 01 | VCN, LXD, disk setup | `deploy/host/install_lxd_oci_iptables.sh` |
| Chapter 02 | Gateway (guacamole) + Wazuh | `deploy/guacamole/nginx-ampere.conf`, `deploy/golden/bake_wazuh_agent.sh` |
| Chapter 03 | Golden images (kali, meta, dvwa) | `deploy/oci_build_goldens_arm64.sh`, `deploy/golden/phase3/kali_add_student.sh` |
| Chapter 04 | systemd units (API, portal, bridge, keycloak, tunnel) | `deploy/systemd/` |
| Chapter 05 | Provision API + Portal | `src/provisioning/`, `portal/` |
| Chapter 05 / #109 | Scenario 06 browser scoring | Same `BROWSER_SCORE_SECRET` in `env/.env` (from `env/oci-12gib.env.example`) and `portal/.env.local` (from `portal/.env.local.example`). If unset, Open DVWA still loads but browser milestones are not recorded. |
| Chapter 06 | Scoring (Wazuh integration) | `src/provisioning/alerts_*.py` |
| Chapter 07 | Deployment + Cloudflare tunnel | `deploy/systemd/cloudflared.service`, `portal/.env.local.example` |
| Chapter 08 | Verification checklist | N/A (manual checklist) |
| Chapter 09 | Known issues & workarounds | N/A (manual troubleshooting) |

---

## Contract

- **Kit:** `C:\Capstone2-Deploy` — read `manual/` on the PC; copy **`cyberrange/` contents** to `~/cyberrange` on the VM (Chapter 01 Step 6 path B).
- **Do not** clone the kit root onto the VM (that would nest `manual/` in the host tree).
- **Proof host:** do not terminate the live student VM. IPs, tunnel id, and passwords live in `private/OPERATOR-RECORD.local.md` (gitignored), not in this file.
- Network picture: `manual/appendix-network-map.md`.

---

**For step-by-step instructions, read `manual/README.md` (kit) or `C:\Capstone2-Manual\README.md`.**

## Student-path smoke (do not invent PASS)

- Login via Keycloak → dashboard.
- Create pod → Kali nmap 4 hosts, eth0 UP, default via `.1`.
- Open DVWA `/lab/dvwa/login.php` (admin/password), not setup.php after bake.
- Connect → `student` on Kali; meta tab `msfadmin`.
- Public IP `:80/:18301/:3000/:5000` timeout; only `https://<tunnel>/` works.
