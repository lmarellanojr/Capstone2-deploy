# Chapter 09: Known Issues and Workarounds

Common issues encountered during Ampere deployment and their solutions.

## Issue 1: LXD Snap CLI Hangs with Systemd Unit Creation

**Symptom:** `lxc profile create` or `lxc network peer create` command hangs indefinitely.

**Root Cause:** LXD snap 5.21 CLI hangs when stdin is attached to a TTY and the command contains complex input.

**Workaround:**

Use REST API instead of CLI for profiles and peers:

```bash
# Instead of: lxc profile create pod-security-base ...
# Use: curl -X POST --unix-socket ... http://localhost/1.0/profiles

# Or pipe input to avoid TTY:
cat <<EOF | lxc profile create pod-security-base
...
EOF
```

---

## Issue 2: zram Module Not Found on Boot

**Symptom:** `modprobe zram` fails with "Module zram not found" error on first boot.

**Root Cause:** Linux modules extra package missing on Minimal Ubuntu image.

**Solution:**

```bash
sudo apt-get install -y linux-modules-extra-$(uname -r)
sudo modprobe zram
echo "zram" | sudo tee /etc/modules-load.d/zram.conf
```

---

## Issue 3: Keycloak Login Shows "invalid_client" Error

**Symptom:** Portal login redirects to Keycloak, but Keycloak returns "invalid_client" after user authenticates.

**Root Cause:** KEYCLOAK_CLIENT_SECRET mismatch between portal .env and Keycloak realm configuration.

**Solution:**

1. Verify client secret in .env.local:
   ```bash
   grep KEYCLOAK_CLIENT_SECRET ~/cyberrange/portal/.env.local
   ```

2. Verify secret in Keycloak realm (admin console):
   ```
   Keycloak Admin → Realms → cyber-range → Clients → portal → Credentials
   ```

3. If mismatched, regenerate secret in Keycloak and **replace** the existing line
   (do not `echo >>` — that leaves two keys; systemd last-wins but `grep` lies):
   ```bash
   sed -i 's|^KEYCLOAK_CLIENT_SECRET=.*|KEYCLOAK_CLIENT_SECRET=<new-secret>|' \
     ~/cyberrange/portal/.env.local
   grep -c '^KEYCLOAK_CLIENT_SECRET=' ~/cyberrange/portal/.env.local   # → 1
   systemctl --user restart cyberrange-portal.service
   ```

---

## Issue 4: Portal CSS Unstyled (Blank White Page)

**Symptom:** Portal loads but has no styling; CSS files missing or broken.

**Root Cause:** Next.js production build requires postcss and tailwind configuration files.

**Solution:**

**Do not run `npm run build` on Ampere.** A shell build sits outside the portal
cgroup, so `MemoryMax=512M` does not apply and a 12 GiB host can OOM.

1. On Ampere, confirm the configs were copied with the tree (they only matter at
   **build** time on the PC):
   ```bash
   ls -la ~/cyberrange/portal/postcss.config.js
   ls -la ~/cyberrange/portal/tailwind.config.js
   ```

2. Rebuild **on the operator PC** and re-ship `.next` — Chapter 04 Steps 5a and 5b
   (`npm ci && npm run build` next to those two files, tar `.next` without `cache`,
   extract on the host, `npm ci --omit=dev`).

3. Then on Ampere:
   ```bash
   systemctl --user restart cyberrange-portal.service
   ```
   Hard-refresh the browser (Ctrl+Shift+R).

---

## Issue 5: Nginx Binds to 0.0.0.0:80 (Security Risk)

**Symptom:** Guacamole nginx accidentally listening on all interfaces.

**Root Cause:** nginx-ampere.conf not properly restricting to 10.115.77.12.

**Workaround:**

Verify nginx binding (`ss`; Ubuntu 24.04 has no `netstat` by default):

```bash
lxc exec guacamole -- ss -ltn | grep ':80'
# Expected: 10.115.77.12:80
# Bad: 0.0.0.0:80  (inherited apt default site)
```

The live vhost filename may be **`sites-available/guacamole`** or
**`sites-available/cyberrange`** (Chapter 02 uses `cyberrange`; Ampere-1 proof
host uses `guacamole`). Push to whichever file `sites-enabled` points at. Recopy
the kit file and **restart** nginx if :80 is wrong (reload is enough when listen
is already `10.115.77.12:80` only):

```bash
# Ampere-1 example (enabled link → sites-available/guacamole):
lxc file push ~/cyberrange/deploy/guacamole/nginx-ampere.conf \
  guacamole/etc/nginx/sites-available/guacamole
lxc exec guacamole -- nginx -t
lxc exec guacamole -- systemctl reload nginx
lxc exec guacamole -- ss -ltn | grep ':80'
```

---

## Issue 12: Keycloak Admin Console Loading / redirect_uri (OPS-01 / #84)

**Symptom:** Admin UI stuck on “Loading…”, then `somethingWentWrong`, or
`Invalid parameter: redirect_uri` at
`https://<TUNNEL_HOST>/auth/admin/master/console/`.

**Root cause:** Admin SPA emits `/resources/`, `/admin/serverinfo`, and
`/realms/master/...` without the `/auth` prefix; nginx sent those to the portal.
Login also used `redirect_uri=.../auth/admin/...` while `security-admin-console`
only allowed `/admin/master/console/*`.

**Fix (in kit):** `deploy/guacamole/nginx-ampere.conf` locations for
`/resources/`, Keycloak-only `/admin/(serverinfo|realms|master)`, and
`/realms/master` only (not all `/realms/`). After pull:

```bash
lxc file push ~/cyberrange/deploy/guacamole/nginx-ampere.conf \
  guacamole/etc/nginx/sites-available/guacamole   # or cyberrange — see Issue 5
lxc exec guacamole -- nginx -t && lxc exec guacamole -- systemctl reload nginx
bash ~/cyberrange/deploy/host/fix_keycloak_admin_console_redirects.sh <TUNNEL_HOST>
```

Do **not** re-run `create_keycloak_realm.sh` for this.

---

## Issue 6: Kali Student User Missing Shell History After kali_add_student.sh

**Symptom:** Student launches a pod and has no bash history (`.bash_history` is empty).

**Expected Behavior:** This is intentional. `kali_add_student.sh` flushes history to prevent leaking prior commands.

**Workaround:** If needed to restore history for testing, skip running `kali_add_student.sh` on that golden image.

---

## Issue 7: Wazuh Agent Not Reporting to Manager

**Symptom:** Wazuh manager shows no agents connected, or agent fails to communicate.

**Root Cause:** Agent and manager on different OVN networks, or firewall blocking UDP 514.

**Verification:**

```bash
# Check agent status in pod
lxc exec <pod> -- systemctl status wazuh-agent
lxc exec <pod> -- grep "manager_address" /var/ossec/etc/ossec.conf

# Check manager sees agents
lxc exec wazuh-manager -- /var/ossec/bin/agent_control -l
```

**Solution:**

1. Verify manager IP in pod's ossec.conf (should be 10.0.40.x)
2. Ensure OVN NAT allows UDP 514 from pod network to mon-net
3. Restart agent in pod: `lxc exec <pod> -- systemctl restart wazuh-agent`

---

## Issue 8: Portal Times Out Accessing Keycloak (No Internet Fallback)

**Symptom:** Portal tries to reach Keycloak but times out (Keycloak offline or network issue).

**Root Cause:** Portal's KEYCLOAK_ISSUER points to 10.115.77.12, which requires lxdbr0 routing.

**Workaround:**

1. Ensure lxdbr0 is healthy:
   ```bash
   ip -4 route | grep 10.115.77.0
   lxc exec guacamole -- ping 10.115.77.1  # From guacamole container
   ```

2. Restart services in order:
   ```bash
   lxc exec guacamole -- systemctl restart keycloak.service
   sleep 30
   systemctl --user restart cyberrange-portal.service
   ```

---

## Issue 9: Bridge SSH Sessions Drop After Idle

**Symptom:** SSH terminal in portal closes after 5 minutes of inactivity.

**Root Cause:** Bridge or Cloudflare tunnel idle timeout.

**Workaround:**

1. Reconnect (portal automatically reconnects terminal)
2. Or increase timeout in bridge-src/bridge.py (expert mode)

---

## Issue 10: Public IP Access Shows Default nginx Page

**Symptom:** `curl http://<PUBLIC_IP>/` returns an nginx page instead of timeout.

**Root Cause:** Same as Issue 5 — nginx still on `0.0.0.0:80`, so the Oracle
public IP answers. Students must never get a page on that IP.

**Solution:** Issue 5 (reinstall `cyberrange` vhost, restart nginx). Confirm
from your PC:

```bash
curl -sS -o /dev/null --connect-timeout 3 -w '%{http_code}\n' http://<PUBLIC_IP>/ \
  || echo "timeout — correct"
```

---

## Issue 11: Do not install a GitHub Actions runner on Ampere

A self-hosted runner is always-on RAM on a 12 GiB host and runs workflow
code as llms_admin (sudo + lxd). Build on GitHub-hosted runners. Apply
with `deploy/host/pull_release.sh` and the opt-in user timer. Never
`runs-on: self-hosted` in this repo.

Day-2 team shipping: merge to `main` builds artifacts; GitHub **Promote**
publishes Release tag `ampere-live`; Ampere pulls. First copy is still
Chapter 01 path B. Operator HTML guide phase M has the steps.

---

## Issue 13: No Wazuh Dashboard or Indexer (12 GiB manager-only)

**Symptom:** There is no Wazuh Dashboard URL to open. The portal's SIEM access
panel shows the in-portal alert table (`SiemAlertViewer`), not an "Open SIEM in
new tab" button.

**Root Cause:** Not a fault. It's a sizing constraint. The 12 GiB OCI host
profile runs Wazuh **manager-only** (Chapter 02, Step 4): no Wazuh Indexer, no
Wazuh Dashboard, no Filebeat. Those components are what make a Wazuh install
large, and they do not fit alongside the gateway, Keycloak, the portal and a
student pod (`MAX_PODS=1`) on this profile.

**How alerts reach students instead:**

1. Agents on `pod-<student>-meta` / `pod-<student>-dvwa` report to the manager
   at `10.0.40.10`.
2. `GET /pods/{pod_id}/alerts` (`alerts_endpoint.py` → `alerts_reader.py`) tails
   the manager's `alerts.json`, scoped to that student's agents.
3. The portal's Scenario 09 SIEM pane polls that endpoint every **15 s**
   (`POLL_MS` in `siemAlertQuery.ts`), skips polling while the tab is hidden,
   and offers rule / agent / severity filters on the fetched rows.

**Limits that follow from this:**

- No Dashboard search, saved queries, or visualisations. Filtering is limited
  to rule ID, agent and severity over the most recent 200 alerts in the query
  window.
- Detection is mapped for Scenario 09 Milestone 1 only (rule `5710`). Apache
  web-rule correlation for Scenario 06 is deferred (see `wazuh_rule_map.py`).
- `detection_score` is advisory and never gates PASS/FAIL.

**Do not** install the Indexer or Dashboard on the 12 GiB profile. The
`WAZUH_DASHBOARD_PUBLIC_URL` path in `lab_proxy.py` exists only for a larger
host. Leave it unset here.

---

## Troubleshooting Workflow

If a component fails:

1. **Check logs:** user units write `/tmp/portal.log`, `/tmp/provision-api.log`,
   `/tmp/ssh-bridge.log` (not the journal). `/tmp` is emptied on reboot.
   ```bash
   tail -n 50 /tmp/portal.log /tmp/provision-api.log /tmp/ssh-bridge.log
   sudo journalctl -u cloudflared -n 50 --no-pager
   ```

2. **Verify network:**
   ```bash
   curl http://10.115.77.1:5000/capacity
   curl http://10.115.77.12/
   lxc list
   ```

3. **Restart service:**
   ```bash
   systemctl --user restart <service>
   ```

4. **Reboot (last resort):**
   ```bash
   sudo reboot now
   ```

---

**End of Manual.** Code paths vs chapters: `ALIGNMENT.md` in this folder (kit: `cyberrange/` is `~/cyberrange`).
