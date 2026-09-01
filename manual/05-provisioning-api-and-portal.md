# Chapter 05: Provisioning API and Portal

Configure the Provision API and Next.js Portal for student pod lifecycle management.

## Provision API (FastAPI)

The Provision API handles student pod creation, deletion, and lifecycle.

### Configuration

Edit `~/cyberrange/env/.env` (created in Chapter 04):

```bash
PROFILE=oci_12gib
MAX_PODS=1
POD_RAM_MB=4096
POD_STORAGE_MB=7168
API_BIND_HOST=10.115.77.1
API_BIND_PORT=5000
DB_PATH=/home/llms_admin/cyberrange-data/pod_mgmt.db

# Keycloak OAuth (Portal integration)
AUTH_ENABLED=true
KEYCLOAK_CLIENT_ID=portal
KEYCLOAK_CLIENT_SECRET=<your-secret>
KEYCLOAK_INTROSPECT_URL=http://10.115.77.12/auth/realms/cyber-range/protocol/openid-connect/token/introspect

# SIEM alerts (optional)
# ALERTS_PORT=18301
# WAZUH_API_URL=https://localhost:55000 (if Wazuh scoring enabled)
```

### Provision API Endpoints

Every route below requires a Keycloak bearer token — `AUTH_ENABLED=true`. Without
one you get **401**, which is the correct response, not a fault.

```bash
TOKEN=<student access token from the portal session>
AUTH="Authorization: Bearer $TOKEN"
```

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness. No auth. |
| `GET` | `/capacity` | RAM/pod budget. No auth. |
| `POST` | `/pods/provision` | Create a pod. Returns **202**. |
| `GET` | `/pods` | List pods (optional `?student_id=`) |
| `GET` | `/pods/{id}/status` | Pod state and container IDs |
| `GET` | `/pods/{id}/lab-urls` | DVWA and lab links for this pod |
| `GET` | `/pods/{id}/guac-token` | Terminal handoff token |
| `GET` | `/pods/{id}/milestones` | Scenario progress |
| `DELETE` | `/pods/{id}/destroy` | Tear the pod down |

```bash
# Unauthenticated health and capacity
curl -s http://10.115.77.1:5000/health
curl -s http://10.115.77.1:5000/capacity

# Provision. The body is student_id + scenario_id -- there is no "image" field
# and no timeout: a pod is always the full set of three containers
# (kali + meta + dvwa), cloned from kali-base, meta-base and dvwa-base.
curl -s -X POST http://10.115.77.1:5000/pods/provision \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"student_id": "student", "scenario_id": "01"}'
# → 202 Accepted; provisioning continues in the background

# Poll until ACTIVE
curl -s -H "$AUTH" http://10.115.77.1:5000/pods/1/status

# Destroy
curl -s -X DELETE -H "$AUTH" http://10.115.77.1:5000/pods/1/destroy
```

> `POST /pods/provision` returns **422** if `student_id` is missing. The access
> token also expires mid-poll on a slow provision — a **401** partway through
> status polling means refresh the token, not that provisioning failed.

### Verification

```bash
# API should be running (started in Chapter 04)
systemctl --user status cyberrange-provision-api.service

# Database should be created on first start
ls -la ~/cyberrange-data/pod_mgmt.db

# Check logs for errors (units append here, not the user journal)
tail -n 50 /tmp/provision-api.log
```

## Portal (Next.js)

The Portal is a web UI for students to launch and manage their lab containers.

### Portal Configuration

Edit `~/cyberrange/portal/.env.local`:

```bash
# Public API URL (browser-side, relative or public)
NEXT_PUBLIC_API_URL=/api

# Server-side API (internal, lxdbr0)
API_INTERNAL_URL=http://10.115.77.1:5000

# Keycloak (Ampere Path B)
KEYCLOAK_CLIENT_ID=portal
KEYCLOAK_CLIENT_SECRET=<your-secret>
KEYCLOAK_ISSUER=http://10.115.77.12/auth/realms/cyber-range
KEYCLOAK_PUBLIC_ISSUER=http://10.115.77.12/auth/realms/cyber-range
KEYCLOAK_SERVER_SIDE_ISSUER=http://10.115.77.12/auth/realms/cyber-range

# Next-Auth session secret
NEXTAUTH_SECRET=<generate: openssl rand -base64 32>

# Chapter 04 private path. Chapter 07 flips to https://<TUNNEL_HOST>
NEXTAUTH_URL=http://10.115.77.12
```

### Portal Build and Deployment

**The portal is built on your operator PC, not on Ampere.** The full procedure --
Node at `~/opt/node`, `npm ci && npm run build` on the PC, shipping `.next` plus
`public`, then `npm ci --omit=dev` on the host -- is Chapter 04, Step 5. Do not
repeat it here.

> A Next.js build peaks well above what 12 GiB leaves free once LXD, Keycloak and
> Wazuh are running, and a build started from a shell sits outside the portal
> unit's cgroup, so its `MemoryMax` drop-in cannot bound it. Chapter 04 Step 5
> and the M4-to-Ampere guide say to build off-host.

To pick up a rebuilt portal after re-shipping `.next`:

```bash
systemctl --user restart cyberrange-portal.service
sleep 10

curl -s http://10.115.77.1:3000/api/auth/providers | head -c 200; echo
curl -s -o /dev/null -w 'login %{http_code}\n' http://10.115.77.1:3000/login
```

If the portal loads but every page is unstyled, `postcss.config.js` and
`tailwind.config.js` were missing next to `package.json` at build time on the PC.
Rebuild there and re-ship -- rebuilding on Ampere is not the fix.

### Portal Features

**Homepage:**
- Student login via Keycloak OAuth
- Pod list (student's active containers)
- Create pod (select image, timeout)

**Lab Tab:**
- Open terminal (SSH via bridge)
- Open DVWA (proxy to student container)
- View pod logs

**Dashboard:**
- Pod status, uptime, resource usage
- Delete pod (if owned by student)

## Web Terminal Bridge

The bridge is what makes the portal's terminal tab work.

### It is not an SSH server

Despite the name, there is nothing to `ssh` to. `bridge.py` is a **websockets**
server that opens an `lxc exec` PTY into the student's container and streams it to
xterm.js in the browser. It speaks no SSH protocol and listens on no SSH port.

| | |
|---|---|
| Bind | `10.115.77.1:8765` (lxdbr0 only, never `0.0.0.0`) |
| Unit | `cyberrange-ssh-bridge.service` (user unit, Chapter 04 Step 7) |
| Config | `~/cyberrange/bridge-src/.env.bridge`, mode 600 |
| Override | `BRIDGE_BIND_HOST` / `BRIDGE_BIND_PORT` in that file |

### Request path

```
browser
  → wss://<tunnel-host>/api/ssh-websocket?token=…&pod_id=…&pod_type=…
    → Cloudflare tunnel
      → nginx  10.115.77.12:80   (location /api/ssh-websocket)
        → bridge 10.115.77.1:8765
          → lxc exec into pod-student-<id>-<type>
```

`pod_type` is one of `kali`, `meta`, `dvwa`. The `token` is the student's Keycloak
access token; the bridge introspects it and checks pod ownership before attaching,
so an unauthenticated socket is accepted at the HTTP layer and then **failed
closed**.

### Verify

```bash
# Listening on lxdbr0 only
ss -ltn | grep 8765
# → LISTEN 10.115.77.1:8765

# Handshake through nginx, the same path the browser takes
curl -s -o /dev/null -w '%{http_code}\n' \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  --max-time 5 http://10.115.77.12/api/ssh-websocket
# → 101, then curl hangs until --max-time
```

**101 followed by a timeout is the correct result.** The bridge holds the socket
open after the handshake while it rejects the missing token. It is not a 502.

Actually typing in the terminal is verified in Chapter 08, which needs a live pod.

## DVWA Lab Proxy

DVWA student URLs are served by the Provision API:

```bash
# Lab proxy listens on HTTP (no auth)
# Portal link: http://10.115.77.1:18301/dvwa/
# Proxied URL: https://<TUNNEL_HOST>/lab/dvwa/
```

**Do NOT open VCN port 18300+** (LAN-only access).

## Alerts and Scoring (Optional)

Scoring is **Chapter 06**, and the `WAZUH_*` settings belong to that chapter's
Step 3. They are deliberately not repeated here — three slightly different
renderings of the same block is how `WAZUH_CA_BUNDLE` ended up pointing at a
directory that does not exist.

The API exposes the alerts the portal reads:

```bash
curl -s -H "$AUTH" http://10.115.77.1:5000/pods/1/alerts
# -> {"alerts": [], "total_count": 0}   when scoring is off or no alerts yet
```

An empty list is normal. Leave the `WAZUH_*` settings unset and the API skips
Wazuh entirely; students keep full lab access with no alerts displayed.

---

**Next:** Chapter 06 — Scoring
