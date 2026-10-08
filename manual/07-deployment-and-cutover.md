# Chapter 07: Deployment and Cutover

Full Ampere deployment checklist and Cloudflare tunnel cutover.

## Pre-Deployment Checklist

Verify all prerequisites before cutover:

```bash
# On Ampere host (llms_admin)

# 1. LXD storage and network
lxc storage info default | grep "total space"  # → 150.00 GiB
lxc network show lxdbr0 | grep "ipv4.address" # → 10.115.77.1/24
lxc network list                                # All networks present

# 2. Origin (nginx → portal). An nginx index here means the default site is back.
curl -s http://10.115.77.12/ | head -5         # → Next.js portal HTML, not "Welcome to nginx"

# 3. Golden images ready
lxc image list | grep -E "kali|meta|dvwa"      # All 3 images present

# 4. systemd services configured
systemctl --user is-active cyberrange-provision-api.service   # -> active
systemctl --user is-active cyberrange-portal.service          # -> active
systemctl --user is-active cyberrange-ssh-bridge.service      # -> active

# Keycloak is a SYSTEM unit inside the guacamole container, not a host user unit.
lxc exec guacamole -- systemctl is-active keycloak.service    # -> active
lxc exec guacamole -- systemctl is-active nginx               # -> active

# 5. Provision API responds
curl -s http://10.115.77.1:5000/capacity | jq . # → JSON response

# 6. Portal running
curl -s http://10.115.77.1:3000/ | grep -o '<title>.*</title>'
```

## Gate: prove the student path on Path B, before any tunnel exists

The tunnel is the last thing that goes up, and it must not go up over a broken
student path — debugging through Cloudflare is strictly harder than debugging on
`10.115.77.12`. Provision one pod, use it, destroy it, all on the private address.

Get the student credentials written by Chapter 04 Step 1e:

```bash
sudo cat ~/cyberrange-data/student.env
```

Open `http://10.115.77.12/login` from the operator PC over an SSH tunnel:

```bash
# On the operator PC
ssh -i ~/.ssh/id_oci_arm64 -L 8080:10.115.77.12:80 llms_admin@<PUBLIC_IP>
# then browse to http://localhost:8080/login
```

| Check | Expected |
|---|---|
| Login as `student` | reaches `/dashboard`, no "Update Account Information" form |
| Create a pod | status `PROVISIONING` then `ACTIVE` within ~40 s |
| Containers | `pod-student-{kali,meta,dvwa}` RUNNING on `10.0.51.{10,20,30}` |
| Kali terminal → `whoami` | `student` |
| Meta terminal → `whoami` | `msfadmin` |
| Open DVWA | DVWA login page, **not** `setup.php` |
| Destroy the pod | disappears; `lxc list` shows no `pod-student-*` |

From the host, while the pod is up:

```bash
lxc list -c ns
lxc exec pod-student-kali -- ip -4 addr show eth0     # -> 10.0.51.10/24
lxc exec pod-student-kali -- ip route | grep default  # -> default via 10.0.51.1
curl -s -o /dev/null -w 'capacity %{http_code}\n' http://10.115.77.1:5000/capacity
```

`can_provision` should read `false` while the pod is up and `true` after destroy.

**Do not continue to the tunnel until every row above passes.** A failure here is
a Chapter 03–06 problem, not a Cloudflare problem.

## Cloudflare Tunnel Setup

The Cloudflare tunnel goes up **last** — only after the Path B gate above passes.
Bringing it up earlier only widens the blast radius of a misconfiguration.

> **Do not open VCN ingress 80 or 443.** A cloudflared tunnel dials **out** to
> Cloudflare over 443 and needs no inbound rule at all. VCN ingress stays TCP 22
> from your `/32` only. Opening 80/443 publishes the host directly and fails the
> internet probe in section 7.

### 1. Create the tunnel in Cloudflare

**On the Cloudflare dashboard:**

1. Zero Trust → Networks → **Tunnels** → **Create a tunnel**
2. Type: **Cloudflared**
3. Name: `ampere-cyberrange`
4. Connector environment: **Debian / Ubuntu, arm64-compatible**
5. Copy the tunnel token. Treat it as a credential — it is roughly 185 bytes and
   grants tunnel access.

> The dashboard shows a Windows snippet, `cloudflared.exe service install <token>`.
> That is the wrong OS. Ampere is Linux/aarch64; use the steps below.

### 2. Install cloudflared on Ampere

```bash
# On the Ampere host
ARCH=arm64
curl -fsSL -o /tmp/cloudflared.deb \
  https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH}.deb
sudo dpkg -i /tmp/cloudflared.deb
rm -f /tmp/cloudflared.deb

cloudflared --version      # → 2026.8.2 or newer, aarch64
```

### 3. Place the token

The shipped unit reads `--token-file /etc/cloudflared/token`. There is **no**
`TUNNEL_TOKEN` or `CLOUDFLARE_TOKEN` environment variable — setting one has no
effect.

```bash
# On the Ampere host
sudo mkdir -p /etc/cloudflared

# Paste the token, then press Ctrl-D. Using a here-doc keeps it out of
# ~/.bash_history, which `echo "<token>" | sudo tee` would not.
sudo tee /etc/cloudflared/token > /dev/null
# <paste token, no trailing newline concerns, then Ctrl-D>

sudo chown -R llms_admin:llms_admin /etc/cloudflared
sudo chmod 700 /etc/cloudflared
sudo chmod 600 /etc/cloudflared/token

stat -c '%a %U %n' /etc/cloudflared/token     # → 600 llms_admin
```

> **Ownership matters.** The unit runs as `User=llms_admin`. A `root:root 600`
> token file produces `Failed to read token file: permission denied`, exit 255,
> and an auto-restart loop that looks like a bad token.

### 4. Install the unit — as a **system** unit

`deploy/systemd/cloudflared.service` sets `User=llms_admin` and
`WantedBy=multi-user.target`. systemd **rejects `User=` in user units**, so this
one cannot be installed under `~/.config/systemd/user/`.

```bash
sudo cp ~/cyberrange/deploy/systemd/cloudflared.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now cloudflared

sudo systemctl is-active cloudflared      # → active
sudo journalctl -u cloudflared -n 30 --no-pager
```

Expected in the journal:

```text
Starting tunnel tunnelID=<your-tunnel-id>
Registered tunnel connection … location=sin09 protocol=quic
Environment is healthy. cloudflared will use 'quic' as primary protocol.
```

Two log lines that are **not** failures:

- `No ingress rules … will return 503 for all incoming HTTP requests` — you have
  not added the public hostname yet. That is Step 6.
- `ping_group_range` / ICMP warnings for the `llms_admin` GID — the HTTP tunnel is
  registered regardless.

### 5. Rotate every secret — before the hostname exists

**Do this before adding the public hostname.** Up to this point the host has been
reachable only from your `/32`. The moment a public hostname resolves, every
credential that is still at a default or was typed during a debugging session is
exposed.

Rotate all five of these, not the convenient ones:

| Secret | Where | Rotate with |
|---|---|---|
| Wazuh API admin | inside `wazuh-manager` | Chapter 06, Step 2 |
| Keycloak admin | `deploy/keycloak/admin.env` (600) | `openssl rand -base64 24`, then restart Keycloak |
| `KEYCLOAK_CLIENT_SECRET` | Keycloak `portal` client → **Credentials → Regenerate** | copy into **both** `env/.env` and `portal/.env.local` |
| `NEXTAUTH_SECRET` | `portal/.env.local` | `openssl rand -base64 32` |
| Student realm passwords | Keycloak `cyber-range` realm | `kcadm set-password --temporary false` |

```bash
# Keycloak admin
openssl rand -base64 24
nano ~/cyberrange/deploy/keycloak/admin.env      # set KEYCLOAK_ADMIN_PASSWORD
lxc file push ~/cyberrange/deploy/keycloak/admin.env guacamole/etc/keycloak/admin.env
lxc exec guacamole -- chmod 600 /etc/keycloak/admin.env
lxc exec guacamole -- systemctl restart keycloak

# NextAuth
openssl rand -base64 32
nano ~/cyberrange/portal/.env.local             # set NEXTAUTH_SECRET
```

> **Rotating `NEXTAUTH_SECRET` invalidates every active session** and breaks any
> OAuth handshake in flight, surfacing as "State cookie was missing" on the
> callback. That is harmless now, before students exist — and disruptive later.
> This is the right moment, and it is why the step sits here rather than after
> cutover.

> The `portal` client secret must match in **three** places: the Keycloak client,
> `env/.env`, and `portal/.env.local`. A mismatch is the `invalid_client` error in
> Chapter 09, Issue 3.

Restart what consumes them, then confirm login still works on Path B **before**
you create the hostname:

```bash
systemctl --user restart cyberrange-provision-api.service
systemctl --user restart cyberrange-portal.service
systemctl --user restart cyberrange-ssh-bridge.service

curl -s -o /dev/null -w 'pathb %{http_code}\n' http://10.115.77.12/login
```

The Cloudflare tunnel token is the sixth secret. It is already on the host at
`/etc/cloudflared/token` (Step 3); rotate it in the dashboard only if it has been
pasted into chat, a screenshot, or shell history.

### 6. Add the public hostname — origin is the gateway, not the portal

**On the Cloudflare dashboard:** Zero Trust → Networks → Tunnels → your tunnel →
**Public Hostname** → **Add a public hostname**.

| Field | Value |
|---|---|
| Subdomain | `cyberrange` |
| Domain | your zone, e.g. `<YOUR_ZONE>` |
| Type | **HTTP** |
| URL | **`10.115.77.12:80`** |

> **The origin is `10.115.77.12:80`, the guacamole nginx — not
> `10.115.77.1:3000`.** That nginx vhost is the only place where the portal,
> Keycloak's `/auth/`, and the terminal's `/api/ssh-websocket` are served from one
> origin. Pointing the tunnel straight at the portal breaks login and the terminal.

Add exactly **one** public hostname. Do not add hostnames for `:18301` (DVWA),
`:3000`, `:5000`, `:8765` or `:55000`.

The CNAME is created automatically and is proxied (orange cloud). If you add it by
hand, the target is `<tunnel-id>.cfargotunnel.com`.

### 7. Probe from the internet, before flipping any URL

Run this **from your operator PC**, not from the VM — the VM is inside the VCN and
will give you a misleading result.

```bash
curl -s -o /dev/null -w 'tunnel %{http_code}\n' https://<TUNNEL_HOST>/login

for p in 80 443 3000 5000 8765 18301; do
  curl -s -o /dev/null --connect-timeout 3 -w "port $p %{http_code}\n" \
    http://<PUBLIC_IP>:$p || echo "port $p timeout (correct)"
done
```

Pass criteria:

- `https://<TUNNEL_HOST>/login` → **200**
- every `http://<PUBLIC_IP>:<port>` → **timeout**

If any direct port answers, stop. Do not continue to student access.

### 8. Flip the URLs to HTTPS

Only now, with the hostname known and probed:

```bash
# On Ampere — edit, do not overwrite; the file holds the client secret.
nano ~/cyberrange/portal/.env.local
```

| Variable | Value |
|---|---|
| `NEXTAUTH_URL` | `https://<TUNNEL_HOST>` |
| `KEYCLOAK_ISSUER` | `https://<TUNNEL_HOST>/auth/realms/cyber-range` |
| `KEYCLOAK_PUBLIC_ISSUER` | same as `KEYCLOAK_ISSUER` (logout + browser auth) |
| `KEYCLOAK_SERVER_SIDE_ISSUER` | **stays Path B** — `http://10.115.77.12/auth/realms/cyber-range` |

The server-side issuer stays on Path B deliberately: the VM's token POST to the
public hostname returns `401 invalid_client`, while the same grant over Path B
succeeds. The browser uses the HTTPS issuer; the server uses the private one.

`KEYCLOAK_INTROSPECT_URL` in `~/cyberrange/env/.env` also stays Path B.

Then, in the Keycloak admin console, add `https://<TUNNEL_HOST>/*` to
the `portal` client's redirect URIs — **keep** the existing Path B URIs — and add a
drop-in so Keycloak knows its public hostname:

```bash
lxc exec guacamole -- mkdir -p /etc/systemd/system/keycloak.service.d
lxc exec guacamole -- bash -c 'cat > /etc/systemd/system/keycloak.service.d/hostname.conf <<EOF
[Service]
ExecStart=
ExecStart=/opt/keycloak/bin/kc.sh start-dev --http-host=127.0.0.1 --http-port=8083 --proxy-headers=xforwarded --http-relative-path=/auth --import-realm --hostname=https://<TUNNEL_HOST> --hostname-strict=false
EOF'
lxc exec guacamole -- systemctl daemon-reload
lxc exec guacamole -- systemctl restart keycloak

systemctl --user restart cyberrange-portal.service
```

Verify the issuer now matches the public hostname:

```bash
curl -s https://<TUNNEL_HOST>/auth/realms/cyber-range/.well-known/openid-configuration \
  | grep -o '"issuer":"[^"]*"'
# → "issuer":"https://<TUNNEL_HOST>/auth/realms/cyber-range"
```

### 9. Confirm login from a home browser

Open `https://<TUNNEL_HOST>/login` **on your PC**, not from the VM, and
sign in as the student. A scripted login from inside the VM is not a valid proof —
it failed on the live host while the browser flow worked.

## Student Access Verification

Open a browser and navigate to:
```
https://<TUNNEL_HOST>/
```

You should see:
1. Keycloak login (if not already signed in)
2. Dashboard / **My Labs** (`/scenarios`) — catalog is **01, 06, 09, 11**
3. No image picker and no timeout field (lab time limits are per scenario, server-side: `SCENARIO_TTL_MINUTES` in config.py)

### Quick Test: Start a lab

1. Open scenario **01** (or **06** for DVWA)
2. Click **Start Lab →** (not "Create Pod" / "Launch")
3. Wait until status is **ACTIVE** (`MAX_PODS=1`)
4. Kali tab: `whoami` → `student` (websockets bridge, not guacd)
5. **Destroy Pod** or **End Session** when done

The full HTTPS checklist, including reboot, is Chapter 08.

## Keycloak Admin Console

Keycloak binds `127.0.0.1:8083` **inside** the guacamole container and is
published by nginx at `10.115.77.12/auth/`. The admin console is a browser UI,
not a curl target.

Reach it from your operator PC over an SSH tunnel:

```bash
ssh -i ~/.ssh/id_oci_arm64 -L 8080:10.115.77.12:80 llms_admin@<PUBLIC_IP>
```

Then open `http://localhost:8080/auth/admin/` and sign in with the
`KEYCLOAK_ADMIN` / `KEYCLOAK_ADMIN_PASSWORD` values from
`~/cyberrange/deploy/keycloak/admin.env` (Chapter 04, Step 1b).

The admin console is never exposed through the Cloudflare tunnel.

## Persistence After Reboot

The three portal/API/bridge units are **user** units. Without linger they start
only when you SSH, so `systemctl --user is-active` after login always looks
fine. Prove boot, not login.

```bash
sudo reboot now
```

Wait ~2 minutes. **From your PC, before SSH:**

```bash
curl -sS -o /dev/null -w '%{http_code}\n' --max-time 20 https://<TUNNEL_HOST>/login
# → 200 or 302. Timeout/000 means linger is off or cloudflared did not start.
```

Then SSH and confirm:

```bash
ssh -i ~/.ssh/id_oci_arm64 llms_admin@<PUBLIC_IP>

loginctl show-user llms_admin | grep Linger    # → Linger=yes
uptime -s
systemctl --user show -p ActiveEnterTimestamp cyberrange-portal.service
# ActiveEnterTimestamp must be near boot, not "just now" when this SSH started.

systemctl --user is-active cyberrange-provision-api.service
systemctl --user is-active cyberrange-portal.service
systemctl --user is-active cyberrange-ssh-bridge.service
sudo systemctl is-active cloudflared
lxc exec guacamole -- systemctl is-active keycloak.service
```

## Logs and Troubleshooting

```bash
# App output for the three user units (StandardOutput=append)
tail -n 50 /tmp/portal.log
tail -n 50 /tmp/provision-api.log
tail -f /tmp/ssh-bridge.log

# Tunnel is a system unit — journal is correct
sudo journalctl -u cloudflared -f
```

---

**Next:** Chapter 08 — Verification
