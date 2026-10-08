# Chapter 08: Verification

The final acceptance pass, run **over the public HTTPS hostname** after Chapter 07
has the tunnel up.

> The private-path equivalent — one pod created, used and destroyed on
> `10.115.77.12` — is Chapter 07's gate, and it runs **before** the tunnel exists.
> This chapter repeats the student journey over the tunnel. **Reboot persistence
> is a required gate in this chapter** (same commands as Chapter 07). If a check
> here fails and the same check passed in Chapter 07's private-path gate, the
> fault is in the tunnel or the HTTPS URL flip, not in the range.

## Infrastructure Checks

```bash
# SSH into Ampere as llms_admin
ssh -i ~/.ssh/id_oci_arm64 llms_admin@<PUBLIC_IP>

# 1. Disk and Memory
df -h /mnt/ampere-lxd         # 150 GiB mount
free -h                        # ~11 GiB available
uname -m                       # aarch64

# 2. LXD Storage
lxc storage info default       # 150 GiB pool
lxc storage list

# 3. Networks
lxc network list               # lxdbr0, mgmt-net, mon-net, vmbr1
lxc network show lxdbr0 | grep ipv4.address
ip -4 route | grep 10.        # Should see multiple /24 routes

# 4. Containers
lxc list                       # guacamole, wazuh-manager
lxc exec guacamole -- systemctl is-active nginx
lxc exec wazuh-manager -- systemctl is-active wazuh-manager
```

## Service Checks

```bash
# Check all systemd units
systemctl --user is-active cyberrange-provision-api.service
systemctl --user is-active cyberrange-portal.service
systemctl --user is-active cyberrange-ssh-bridge.service

# cloudflared is a SYSTEM unit (User=llms_admin), so --user cannot see it:
sudo systemctl is-active cloudflared

# Keycloak is a SYSTEM unit inside the guacamole container:
lxc exec guacamole -- systemctl is-active keycloak.service

# All should show: Active (running)

# 5. Provision API
curl -s http://10.115.77.1:5000/capacity | jq .
# Expected: JSON with pod capacity info

# 6. Portal (via portal endpoint)
curl -s http://10.115.77.1:3000/api/auth/session | jq .

# 7. Keycloak — through nginx on :80, not :8083.
# Keycloak binds 127.0.0.1:8083 *inside* guacamole; the host has nothing on .12:8083.
curl -s http://10.115.77.12/auth/realms/cyber-range/.well-known/openid-configuration \
  | jq -r '.issuer'
# Expected: http://10.115.77.12/auth/realms/cyber-range
# After Chapter 07 URL flip, the same path on https://<TUNNEL_HOST> should show
# issuer https://<TUNNEL_HOST>/auth/realms/cyber-range

# 8. Bridge
ss -ltn | grep 8765
# Expected: LISTEN 10.115.77.1:8765   (never 0.0.0.0)

# The bridge is a websockets server, not sshd. Test the handshake, not a port:
curl -s -o /dev/null -w '%{http_code}\n' \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  --max-time 5 http://10.115.77.12/api/ssh-websocket
# Expected: 101, then curl times out while the bridge fails closed on the
# missing token. That timeout is correct, not a 502.

# 9. Cloudflare tunnel
sudo journalctl -u cloudflared | grep -i "tunnel registered"
# Expected: confirmation of tunnel registration
```

## Network Connectivity Checks

```bash
# 1. VCN public IP access (should timeout or SSH)
curl -v https://<PUBLIC_IP>:443 --connect-timeout 2
# Expected: timeout or SSH banner (no HTTPS on public IP)

# 2. Origin (nginx → portal)
curl -s http://10.115.77.12/ | head -5
# Expected: Next.js portal HTML. "Welcome to nginx" = default site is back (Ch09 Issue 5).

# 3. lxdbr0 routes active (once a pod exists)
ip -4 route | grep 10.115.77.0
# Expected: lxdbr0 no longer shows linkdown
```

## Student Portal Checks

**Open browser on your PC:** `https://<TUNNEL_HOST>/` (not from the VM).

The catalog is four scenarios: **01, 06, 09, 11**. There is no image picker and
no timeout field. TTL is server-side and per scenario (`SCENARIO_TTL_MINUTES`: 30/45/45/60 min). Pods are not on
`lxdbr0`; they sit on OVN `10.0.{50+pod_id}.0/24` (pod 1 → `10.0.51.10` Kali).

### Check 1: Login

1. Redirected to Keycloak
2. Sign in as `student` (password from `~/cyberrange-data/student.env`)
3. Land on `/dashboard` or `/scenarios`

**Expected:** styled login card, then the scenario list — not a white unstyled page.

### Check 2: Start a lab

1. Open **My Labs** / `/scenarios`
2. Open scenario **01** (or **06** if you need DVWA)
3. Click **Start Lab →** (not "Create Pod" / "Launch Pod")

**Expected:** provisioning overlay, then status **ACTIVE**. One pod (`MAX_PODS=1`).

### Check 3: Terminal

1. Kali tab in the scenario terminal (xterm over `/api/ssh-websocket`)
2. `whoami` → `student`
3. Meta tab (if present): `msfadmin`

**Expected:** PTY in the browser. This is the websockets bridge, not guacd/SSH.

### Check 4: DVWA (scenario 06)

1. Open DVWA from the portal — URL is **`/lab/dvwa/` on the same hostname**
2. Login `admin` / `password` (not setup.php after a ready golden)

**Expected:** DVWA in a new tab on `https://<TUNNEL_HOST>/lab/dvwa/…`. Do not use
`:18301` or the Oracle public IP.

### Check 5: Destroy

1. **Destroy Pod** (confirmation modal) or **End Session**
2. Wait until the pod is gone (`MAX_PODS=1` frees the slot)

**Expected:** you can Start Lab again. The button is not labelled "Delete Pod".

## Performance Checks

```bash
# 1. API response time
time curl -s http://10.115.77.1:5000/capacity > /dev/null
# Expected: <100ms

# 2. Portal startup time (from systemd start to ready)
systemctl --user restart cyberrange-portal.service
sleep 20
curl -s -w "\n%{time_total}s" http://10.115.77.1:3000/ > /dev/null
# Expected: <500ms response time

# 3. Pod launch time (from create request to SSH access)
# Create pod via API and measure
# Expected: 30-40 seconds from create to SSH ready

# 4. Storage usage after 1 pod
du -sh /mnt/ampere-lxd/containers/
# Expected: ~1-2 GiB (one 1GB pod + overhead)
```

## Security Checks

```bash
# 1. SSH /32 is an OCI VCN security-list rule, not host iptables.
#    /etc/iptables/rules.v4 is the LXD/OVN filter from Chapter 01 — do not grep
#    it for TCP 22. In Console: Default Security List ingress TCP 22 = YOUR /32
#    (https://api.ipify.org). 80/443 must be absent.

# 2. LXD API not exposed (ss; Ubuntu 24.04 has no netstat by default)
ss -ltn | grep 8443 || echo "no 8443 listener — correct"
# Expected: no 8443 (unix socket only)

# 3. Secrets file permissions
ls -la ~/cyberrange/env/.env
# Expected: -rw------- (mode 600)

# 4. Database permissions
ls -la ~/cyberrange-data/
# Expected: drwx------ (mode 700)
```

## Reboot persistence (required — do not skip)

Same order as Chapter 07. User units without linger start at SSH, so
`systemctl --user is-active` after login cannot prove boot.

```bash
sudo reboot now
```

Wait ~2 minutes. **From your PC, before SSH:**

```bash
curl -sS -o /dev/null -w '%{http_code}\n' --max-time 20 https://<TUNNEL_HOST>/login
# → 200 or 302
```

Then SSH:

```bash
ssh -i ~/.ssh/id_oci_arm64 llms_admin@<PUBLIC_IP>

loginctl show-user llms_admin | grep Linger    # → Linger=yes
uptime -s
systemctl --user show -p ActiveEnterTimestamp cyberrange-portal.service
# Timestamp near boot, not this SSH.

systemctl --user is-active cyberrange-provision-api.service
systemctl --user is-active cyberrange-portal.service
systemctl --user is-active cyberrange-ssh-bridge.service
sudo systemctl is-active cloudflared
lxc exec guacamole -- systemctl is-active keycloak.service
```

**Expected:** login **200** or **302** *before* SSH; all five units `active`;
Linger=yes. `/tmp/*.log` is empty after reboot because systemd-tmpfiles
clears `/tmp` at boot (not because the units failed).

## Cleanup Verification

After testing, verify you can reset:

```bash
# Delete student pods ONLY. Student containers are named pod-student-*.
# List first, delete second -- never pipe an unfiltered lxc list into delete.
lxc list --format csv -c n | grep '^pod-student-'

for pod in $(lxc list --format csv -c n | grep '^pod-student-'); do
  lxc delete "$pod" -f
done

# Confirm the infrastructure containers are still there
lxc list -c ns
# Expected: guacamole RUNNING, wazuh-manager RUNNING

# Storage should return to roughly 6.5 GiB used (the three goldens)
lxc storage info default | grep -A1 'space used'
df -h /mnt/ampere-lxd
```

> **Never run `for pod in $(lxc list -c n --format=csv)` unfiltered.** That matches
> every container on the host, including `guacamole` and `wazuh-manager`, and
> deleting those takes down Keycloak, nginx and the SIEM along with the pods.

Deleting a golden image is a separate, deliberate act — only when you intend to
rebake it (Chapter 03), and only after the pods cloned from it are gone:

```bash
lxc image delete kali-base
```

---

**Next:** Chapter 09 — Known Issues and Workarounds
