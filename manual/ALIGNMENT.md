# Alignment: code ↔ Operator Manual

Paths below are **relative to `~/cyberrange`** on the VM (kit: `C:\Capstone2-Deploy\cyberrange`).

## Prerequisites & Environment

| Manual Chapter | Code | Task |
|---|---|---|
| `00-prerequisites.md` | SSH keys, Cloudflare zone | Generate keys, set up OCI tenancy |
| `M4 to Ampere Guide...` | N/A (infrastructure) | Always Free region, tenancy, login |
| `Ampere SSH Guide...` | `~\.ssh\id_oci_arm64` | SSH access, user setup |

---

## Infrastructure (Host Setup)

| Manual Chapter | Code | Task |
|---|---|---|
| `01-oci-host-and-network.md` | `deploy/host/install_lxd_oci_iptables.sh` | VCN, LXD init, `lxdbr0` 10.115.77.1/24 |
| `02-gateway-and-wazuh.md` | `deploy/guacamole/nginx-ampere.conf` | Guacamole bridge (10.115.77.12) |
| | `env/oci-12gib.env.example` | Wazuh manager-only (`WAZUH_TLS_VERIFY=true`) |
| `03-golden-images-arm64.md` | `deploy/oci_build_goldens_arm64.sh` | Build kali, meta+wazuh-agent, dvwa-ready |
| | `deploy/golden/phase3/kali_add_student.sh` | Add student accounts (before history flush) |
| `appendix-network-map.md` | N/A (reference) | IP addresses: 10.115.77.1 (API), 10.115.77.12 (guacamole) |

---

## Services (Provisioning & Portal)

| Manual Chapter | Code | Task |
|---|---|---|
| `04-core-services.md` | `deploy/systemd/` | Create/enable API, portal, bridge, Keycloak, cloudflared units |
| | `src/provisioning/provision_api_fastapi.py` | Provision API (listens 10.115.77.1:5000) |
| `04-core-services.md` Step 5 | `portal/` | Next.js portal **build on the PC**, ship `.next`, `next start` on Ampere |
| | `portal/.env.local.example` | Portal .env (Path B: 10.115.77.12 Keycloak, 10.115.77.1 API) |
| | `portal/postcss.config.js`, `portal/tailwind.config.js` | Portal styling |
| | `bridge-src/bridge.py` | SSH bridge (`websockets==12.0`) |
| | `src/provisioning/guest_nic.py`, `dvwa_compose.py`, `dvwa_ready.py` | Pod provisioning (Kali, DVWA) |
| `05-provisioning-api-and-portal.md` | `src/provisioning/`, `portal/` | API routes and Path B env; build itself is Chapter 04 Step 5 |
| `06-scoring.md` | `src/provisioning/alerts_reader.py`, `alerts_endpoint.py` | SIEM scoring (optional, safe to skip) |

---

## Deployment & Cutover

| Manual Chapter | Code | Task |
|---|---|---|
| `Ampere Cloudflare Tunnel Guide...` | `deploy/systemd/cloudflared.service` | DNS tunnel (`User=llms_admin`) |
| | `env/oci-12gib.env.example` | API capacity / bind (not tunnel secrets) |
| `07-deployment-and-cutover.md` | `docs/02_OCI_DEPLOY.md` | Short runbook; typed steps are this chapter |
| `08-verification.md` | N/A (checklist) | HTTPS student path over the tunnel; reboot gate repeated from Ch07 |
| `09-known-issues.md` | N/A (troubleshooting) | Common issues & fixes |

---

## Environment & Secrets

| File | Role | Mode | Location |
|---|---|---|---|
| `env/.env` (from template) | Provision API config | 600 | `~/cyberrange/env/` on host |
| `env/oci-12gib.env.example` | Template (git-safe) | — | `env/` in the code tree |
| `portal/.env.local` | Portal config | 600 | `~/cyberrange/portal/` on host |
| `portal/.env.local.example` | Template (git-safe, Path B) | — | `portal/` in the code tree |
| `OPERATOR-RECORD.local.md` | Live IP / tunnel / passwords | — | `private/` on the PC (gitignored; never the kit) |

---

## Tests shipped with the operator docs

| File | Purpose |
|---|---|
| `test_manual_one_clone.py` | Ensure no two-clone prose in Manual chapters |
| `deploy/systemd/test_validate_units.py` | Validate systemd unit templates (Chapter 04 Step 8) |
