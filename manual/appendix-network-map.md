# Appendix: Network Map and IP Addresses

Quick reference for all network addresses and roles on Ampere.

## Network Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│ OCI VCN: 10.0.0.0/24                                            │
│ (Public Internet via Cloudflare Tunnel)                         │
│                                                                   │
│ ┌─ Ampere VM (<PUBLIC_IP>) ────────────────────────────┐   │
│ │                                                             │   │
│ │  ┌──────────── LXD Hosts ───────────────┐                 │   │
│ │  │                                        │                 │   │
│ │  │  lxdbr0: 10.115.77.1/24              │                 │   │
│ │  │  ├─ guacamole: 10.115.77.12          │                 │   │
│ │  │  ├─ Student pods: OVN 10.0.{50+id}.x │                 │   │
│ │  │                                        │                 │   │
│ │  │  ┌─ OVN mgmt-net: 10.0.10.0/24 ─┐    │                 │   │
│ │  │  │ └─ guacamole (also lxdbr0)     │    │                 │   │
│ │  │  └─────────────────────────────────┘    │                 │   │
│ │  │                                        │                 │   │
│ │  │  ┌─ OVN mon-net: 10.0.40.0/24 ───┐    │                 │   │
│ │  │  │ └─ wazuh-manager: 10.0.40.x    │    │                 │   │
│ │  │  └─────────────────────────────────┘    │                 │   │
│ │  │                                        │                 │   │
│ │  │  vmbr1: 10.93.10.1/24 (OVN peer)      │                 │   │
│ │  └────────────────────────────────────────┘                 │   │
│ │                                                             │   │
│ │  ┌────────────────────────────────────────────────┐         │   │
│ │  │ User units (systemctl --user)                  │         │   │
│ │  │ • API :5000  portal :3000  bridge :8765        │         │   │
│ │  │   (all 10.115.77.1)                            │         │   │
│ │  │ System: Keycloak 127.0.0.1:8083 in guacamole   │         │   │
│ │  │   nginx .12:80 /auth/; cloudflared on host     │         │   │
│ │  └────────────────────────────────────────────────┘         │   │
│ │                                                             │   │
│ └─────────────────────────────────────────────────────────────┘   │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘

Operator PC (student access)
└─ Browser: https://<TUNNEL_HOST>/
   └─ Cloudflare → origin http://10.115.77.12:80 (guacamole nginx → portal /auth /lab)
```

## Address Summary

### Ampere Host

| IP | Host | Role |
|---|---|---|
| <PUBLIC_IP> | eth0 (public) | VCN attachment, SSH only (restricted /32) |
| <VCN_PRIVATE_IP> | eth0 (private) | This instance's private address in the VCN subnet |
| 10.0.0.1 | — | VCN subnet default gateway |
| 10.115.77.1 | lxdbr0 | LXD bridge, services bind here |

### LXD Networks

| Network | CIDR | Purpose | Gateway |
|---|---|---|---|
| lxdbr0 | 10.115.77.0/24 | Student pods, services | 10.115.77.1 |
| mgmt-net | 10.0.10.0/24 | Management (guacamole, keycloak) | 10.0.10.1 |
| mon-net | 10.0.40.0/24 | Monitoring (wazuh-manager) | 10.0.40.1 |
| vmbr1 | 10.93.10.0/24 | OVN host (internal) | 10.93.10.1 |

### Fixed Addresses

| IP | Container | Service | Port |
|---|---|---|---|
| 10.115.77.1 | (host) | Provision API | 5000 |
| 10.115.77.1 | (host) | Portal | 3000 |
| 10.115.77.12 | guacamole | Nginx reverse proxy | 80 |
| 127.0.0.1 (in guacamole) | guacamole | Keycloak | 8083 (/auth/) |
| 10.0.40.10 | wazuh-manager | agent enrolment / events (mon-net eth0) | 1514/1515 |
| 10.115.77.144 | wazuh-manager | apt egress (lxdbr0 eth1, dual-homed) | — |
| 127.0.0.1 | (host) | Wazuh API, via LXD proxy device into the container | 55000 |

### Dynamic Student Pods

| IP Range | Allocation | Notes |
|---|---|---|
| 10.0.{50+pod_id}.10/.20/.30 | kali / meta / dvwa | OVN `pod-{id}-net`; pod_id 1–6 |
| 10.0.10.100–10.0.10.254 | mgmt-net OVN | Reserved for peer networks |
| 10.0.40.100–10.0.40.254 | mon-net OVN | Reserved for peer networks |

## Service Binding

### Provision API (FastAPI)

```
Bind: 10.115.77.1:5000
Access from: 127.0.0.1 (host), Portal, Student pods (via bridge)
Endpoints: /pods, /capacity, /health, /alerts
```

### Portal (Next.js)

```
Bind: 10.115.77.1:3000
Public URL: https://cyberrange.domain.com/ (via Cloudflare tunnel)
Internal URL: http://10.115.77.1:3000/ (for testing)
Keycloak: http://10.115.77.12/auth/realms/cyber-range (Path B)
API: http://10.115.77.1:5000 (internal routing)
```

### SSH Bridge

```
Bind: 10.115.77.1:8765 (lxdbr0 only, never 0.0.0.0)
Protocol: websockets — NOT sshd. There is no SSH port to connect to.
Path: nginx 10.115.77.12/api/ssh-websocket → 10.115.77.1:8765
Public: wss://cyberrange.domain.com/api/ssh-websocket?token=…&pod_id=…&pod_type=…
Behind: the guacamole nginx vhost, reached from the portal terminal tab
```

The bridge opens an `lxc exec` PTY into the student's container. Override the
bind with `BRIDGE_BIND_HOST` / `BRIDGE_BIND_PORT` in `bridge-src/.env.bridge`.

### Keycloak

```
Bind: 127.0.0.1:8083 inside the guacamole container (--http-relative-path=/auth)
nginx: 10.115.77.12:80 /auth/ → 127.0.0.1:8083
Public URL (via nginx / tunnel): http://10.115.77.12/auth/  then https://<TUNNEL_HOST>/auth/
OAuth: …/auth/realms/cyber-range/protocol/openid-connect/
Admin console: SSH tunnel only — not on the Cloudflare hostname
```

### Cloudflare Tunnel

```
Public URL: https://<TUNNEL_HOST>/
Origin: http://10.115.77.12:80  (guacamole nginx — not the portal :3000)
```

## External Connectivity

### Operator PC to Ampere

| Direction | Protocol | Port | Access Method |
|---|---|---|---|
| Operator → Ampere | SSH | 22 | VCN restricted to `/32` |
| Operator → Ampere (Portal) | HTTPS | 443 | Cloudflare tunnel |
| Ampere → Operator | HTTPS (return) | varies | Tunnel initiated by host |

### Storage

| Path | Capacity | Mount | Purpose |
|---|---|---|---|
| `/mnt/ampere-lxd` | 150 GiB | `/dev/sdb` (Block volume) | LXD storage pool |
| `~llms_admin/cyberrange-data` | ~10 GiB | on-disk | API database, secrets |

## Firewall Rules (VCN Security List)

| Direction | Protocol | Port | CIDR | Purpose |
|---|---|---|---|---|
| Ingress | TCP | 22 | operator-ip/32 | SSH (admin only) |
| Ingress | ICMP | type 3, 4 | 0.0.0.0/0 | Path MTU discovery |
| Egress | All | All | 0.0.0.0/0 | apt, GitHub, Cloudflare |

**That is the complete ingress list.** There is no ingress 80 or 443: the
Cloudflare tunnel dials **outbound**, so students never touch this host's public
IP. Opening either one publishes the box and fails the Chapter 08 probe.

**Do NOT open:** 80, 443, 3000 (portal), 5000 (API), 8083 (Keycloak),
8443 (LXD), 8765 (bridge), 18300+ (DVWA lab proxy), 55000 (Wazuh API).

---

## Routing Reference

```bash
# On Ampere host:
ip -4 route

# Expected output:
# default via 10.0.0.1 dev enp0s6  # VCN gateway
# 10.0.0.0/24 dev enp0s6           # VCN subnet
# 10.0.10.0/24 dev ovn-vxlan0      # mgmt-net
# 10.0.40.0/24 dev ovn-vxlan0      # mon-net
# 10.93.10.0/24 dev vmbr1          # OVN peer bridge
# 10.115.77.0/24 dev lxdbr0        # Student pods (lxdbr0)
```

## DNS Resolution

| Hostname | IP | Method | TTL |
|---|---|---|---|
| cyberrange.domain.com | Cloudflare IP | CNAME to tunnel | 300s |
| (local pod name) | 10.115.77.x | LXD mDNS | — |
| localhost | 127.0.0.1 | OS resolution | — |
| wazuh-manager (from pod) | 10.0.40.x | OVN peer | — |

---

**End of Appendix. For diagram updates or corrections, refer to the Capstone2 implementation repository.**
