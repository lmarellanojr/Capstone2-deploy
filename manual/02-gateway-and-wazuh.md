# Chapter 02: Gateway and Wazuh

Set up the guacamole gateway VM and Wazuh security monitoring.

## Step 1: OVN Networks

Order matters here, and three of these steps are easy to miss because the failure
does not appear until the first pod is provisioned.

### 1a. Install OVN

`lxc network create --type=ovn` cannot work until OVN itself is on the host.

```bash
sudo apt-get update
sudo apt-get install -y ovn-central ovn-host openvswitch-switch

systemctl is-active openvswitch-switch ovn-central ovn-host ovn-northd
# -> active (all four)
```

The live host ran OVN 24.03.6 / OVS 3.3.9.

### 1b. Point OVS at the OVN southbound socket — before creating any network

```bash
sudo ovs-vsctl set open_vswitch . \
  external_ids:ovn-remote=unix:/var/run/ovn/ovnsb_db.sock \
  external_ids:ovn-encap-type=geneve \
  external_ids:ovn-encap-ip=127.0.0.1

sudo ovs-vsctl get open_vswitch . external_ids:ovn-remote
# -> "unix:/var/run/ovn/ovnsb_db.sock"
```

> **This must be set before the OVN networks are created.** Creating them first
> appears to succeed and then fails later, during the first pod provision, as a
> `lxc network peer create` that never returns.

### 1c. `vmbr1` — the uplink, created first

The OVN networks attach to `vmbr1`, so it has to exist before them.

```bash
lxc network create vmbr1 --type=bridge \
  ipv4.address=10.93.10.1/24 \
  ipv4.dhcp=false \
  ipv4.ovn.ranges=10.93.10.100-10.93.10.254 \
  ipv6.address=none
```

> **`vmbr1` cannot take `ipv4.address=none`.** LXD 5.21 needs a real subnet to
> allocate OVN uplink addresses from. `10.93.10.0/24` is chosen so it collides
> with neither the VCN (`10.0.0.0/24`) nor the lab networks.
>
> Note the syntax: LXD takes configuration as bare `key=value` pairs. `--type` is
> the only flag. `--ipv4.address=…` is rejected as an unknown option.

### 1d. The OVN networks

```bash
lxc network create mgmt-net --type=ovn network=vmbr1 \
  ipv4.address=10.0.10.1/24 ipv4.nat=true

lxc network create mon-net --type=ovn network=vmbr1 \
  ipv4.address=10.0.40.1/24 ipv4.nat=true

lxc network list
```

Expect `lxdbr0` and `vmbr1` as `bridge`, `mgmt-net` and `mon-net` as `ovn`, all
**CREATED**.

> Do **not** set `ovn.ingress_mode`. It is not a valid key on LXD 5.21 and the
> create will fail.

### 1e. The peer wrapper — the provisioner cannot create pods without it

`lxc network peer create` hangs for a non-root LXD client on this snap while the
same call succeeds as root. The provision API runs as `llms_admin`, so
`pod_net.py` routes every peer create/delete through a restricted sudo wrapper at
`/usr/local/sbin/cyberrange-lxc-peer`. **If the wrapper is missing, provisioning
hangs at pod-network creation.**

```bash
sudo bash ~/cyberrange/deploy/host/install_cyberrange_lxc_peer.sh llms_admin
```

It installs the wrapper — which permits only `network peer create|delete`, no
other `lxc` verb, with stdin closed — plus
`/etc/sudoers.d/cyberrange-ovn-peer`, validated with `visudo -c`.

Verify it answers without a password prompt:

```bash
sudo -n /usr/local/sbin/cyberrange-lxc-peer 2>&1 | head -2
# -> usage: cyberrange-lxc-peer create|delete <args...>
```

### 1f. Smoke the peering, then clean up

A pod network peers to `mon-net` in **both** directions — that is what
`pod_net.py` does per pod. Prove it here rather than during a student's first
provision:

```bash
lxc network create pod-test-net --type=ovn network=vmbr1 ipv4.address=10.0.51.1/24

sudo -n /usr/local/sbin/cyberrange-lxc-peer create pod-test-net to-mon mon-net
sudo -n /usr/local/sbin/cyberrange-lxc-peer create mon-net from-pod-test pod-test-net
lxc network peer list pod-test-net          # -> to-mon, state Created

sudo -n /usr/local/sbin/cyberrange-lxc-peer delete pod-test-net to-mon
sudo -n /usr/local/sbin/cyberrange-lxc-peer delete mon-net from-pod-test
lxc network delete pod-test-net
```

Each command must return promptly. **If any of them hangs**, OVS has usually lost
its `ovn-remote` external_ids after a service restart:

```bash
sudo bash ~/cyberrange/deploy/host/fix_ovn_peer.sh
```

That kills stuck peer processes, re-applies the OVS external_ids, restarts
`openvswitch-switch`, `ovn-central` and `ovn-host`, then restarts LXD. Re-run the
smoke afterwards. The live host recorded `fix_ovn_peer=PASS` at this point.

Leave no `pod-test-net` behind.

## Step 2: LXD Profiles

Create security and resource profiles for pods:

```bash
# Using REST API (CLI hangs with TTY input on LXD 5.21 snap)
curl -X POST \
  --unix-socket /var/snap/lxd/common/lxd/unix.socket \
  http://localhost/1.0/profiles \
  -H "Content-Type: application/json" \
  -d '{
    "name": "pod-security-base",
    "config": {
      "limits.cpu": "2",
      "limits.memory": "2GB",
      "security.privileged": "false"
    }
  }'

curl -X POST \
  --unix-socket /var/snap/lxd/common/lxd/unix.socket \
  http://localhost/1.0/profiles \
  -H "Content-Type: application/json" \
  -d '{
    "name": "pod-target-base",
    "config": {
      "limits.cpu": "1",
      "limits.memory": "1GB",
      "security.nesting": "true"
    }
  }'

# Verify
lxc profile list
```

## Step 3: The `guacamole` gateway container

### What this container actually is

Despite the name, this container does **not** run the Apache Guacamole web
application. It is the deployment's **HTTP gateway**, and it runs exactly two
things:

| Service | Port | Installed in |
|---|---|---|
| nginx -- the single origin for the portal, `/auth/` and the web terminal | `10.115.77.12:80` | this step |
| Keycloak -- native, behind that nginx | `127.0.0.1:8083` | **Chapter 04, Step 1** |

The name is historical. Student terminals are served by the websockets bridge
(`/api/ssh-websocket`), not by guacd, so there is **no `guacd`, no
`libguac-client-ssh`, and no Tomcat to install**. `deploy/guacamole/nginx-ampere.conf`
has no guacd upstream -- it proxies `/auth/` to Keycloak, `/api/ssh-websocket` to
the bridge on `10.115.77.1:8765`, and `/` to the portal on `10.115.77.1:3000`.

> That script is **not** in this kit. Do not fetch or run `init-guacamole.sh`;
> older copies belong to the Docker design and **delete** the guacamole container.

### 3a. Create the container, dual-homed

```bash
# init + start with stdin closed -- `lxc launch` hangs on the LXD 5.21 snap
lxc init ubuntu:24.04 guacamole --network mgmt-net \
  -c limits.cpu=2 -c limits.memory=2GB </dev/null
lxc start guacamole </dev/null
sleep 15
```

Two interfaces, as with the Wazuh manager:

```bash
# eth0 is already on mgmt-net; pin it
lxc config device set guacamole eth0 ipv4.address 10.0.10.12

# eth1 on lxdbr0 -- this is the address the host, the tunnel and the API all use
lxc config device add guacamole eth1 nic \
  network=lxdbr0 ipv4.address=10.115.77.12
lxc restart guacamole </dev/null
sleep 15

lxc list guacamole -c n4s
```

> **The `eth1` pin needs help from inside the guest.** LXD's static address on a
> bridged NIC is not applied by cloud-init, and on the live host `eth1` came up
> IPv6-only until netplan was written by hand:

```bash
lxc exec guacamole -- bash -c 'cat > /etc/netplan/60-eth1.yaml <<EOF
network:
  version: 2
  ethernets:
    eth1:
      addresses: [10.115.77.12/24]
EOF
chmod 600 /etc/netplan/60-eth1.yaml
netplan apply'

lxc list guacamole -c n4s
# -> 10.115.77.12 (eth1), 10.0.10.12 (eth0)
```

Check it from the host. Ubuntu 24.04 Minimal has no `ping`, so install it on the
**host** if needed -- this is a diagnostic tool, not a student-facing bind:

```bash
sudo apt-get install -y iputils-ping
ping -c2 10.115.77.12
```

### 3b. nginx

```bash
lxc exec guacamole -- apt-get update
lxc exec guacamole -- apt-get install -y nginx

# Install the vhost and remove the stock default site
lxc file push ~/cyberrange/deploy/guacamole/nginx-ampere.conf \
  guacamole/etc/nginx/sites-available/cyberrange
lxc exec guacamole -- ln -sf /etc/nginx/sites-available/cyberrange \
  /etc/nginx/sites-enabled/cyberrange
lxc exec guacamole -- rm -f /etc/nginx/sites-enabled/default

lxc exec guacamole -- nginx -t
```

**Restart, do not reload:**

```bash
lxc exec guacamole -- systemctl stop nginx
lxc exec guacamole -- systemctl start nginx
lxc exec guacamole -- systemctl enable nginx

lxc exec guacamole -- ss -ltn | grep :80
# -> 10.115.77.12:80 only. Never 0.0.0.0:80.
```

> `apt-get install nginx` starts the master immediately, holding inherited
> `0.0.0.0:80` and `[::]:80` sockets from the stock site. `systemctl reload` will
> not release them -- it logs
> `bind() to 10.115.77.12:80 failed (98: Address already in use)` while host curls
> keep hitting the Ubuntu welcome page. Only a full stop/start frees the port.
> This cost real time on the live build; it is not a theoretical warning.

### 3c. Verify

```bash
curl -s -o /dev/null -w 'root %{http_code}\n' http://10.115.77.12/
# -> 502
```

**502 is the expected answer right now.** nginx is up and proxying to the portal,
which does not exist until Chapter 04. A **200** showing the Ubuntu welcome page
means the stock default site is still being served -- redo the restart above.

`/auth/` will 502 as well until Chapter 04 Step 1 installs Keycloak in this
container.

## Step 4: Wazuh Manager Container (manager-only)

On 12 GiB, Wazuh runs **manager-only**. No indexer, no dashboard, vulnerability
detection off. Those three are what make a Wazuh install large, and none of them
is needed for the scoring path.

Wazuh is **optional**. If you are skipping scoring (Chapter 06), skip this step.

### 4a. Create the container, dual-homed

```bash
# init + start with stdin closed -- `lxc launch` hangs on the LXD 5.21 snap
lxc init ubuntu:24.04 wazuh-manager --network mon-net -c limits.memory=3GB </dev/null
lxc start wazuh-manager </dev/null
sleep 15
```

The manager needs **two** interfaces. `mon-net` carries agent traffic, but OVN NAT
on `mon-net` does **not** reach the internet on this host — a 300-second timeout
against `packages.wazuh.com` is the symptom. Add a second NIC on `lxdbr0` purely
for `apt`:

```bash
lxc config device add wazuh-manager eth1 nic \
  network=lxdbr0 ipv4.address=10.115.77.144
# Pin the agent-facing address too. Without this, mon-net DHCP picks one
# (10.0.40.2 on one team host) and every doc/runbook that says .10 is wrong.
# (`device set` because --network made eth0 an instance device; if eth0 comes
# from a profile instead, use `lxc config device override` with the same key.)
lxc config device set wazuh-manager eth0 ipv4.address=10.0.40.10
lxc restart wazuh-manager </dev/null
sleep 15

lxc list wazuh-manager -c n4s
# → 10.0.40.10 (eth0, mon-net) and 10.115.77.144 (eth1, lxdbr0)

lxc exec wazuh-manager -- ping -c2 1.1.1.1
```

If that ping fails, `apt` below will hang. Fix the routing before continuing.

### 4b. Install the manager, version-pinned

Manager and agent must be the same version, and **4.7.5 is the pinned version
for this deployment** — `deploy/golden/bake_wazuh_agent.sh` pins the agent to it
and this step pins the manager. If you ever change it, change it in both places;
a skew is the usual cause of agents that register but never report.

```bash
lxc exec wazuh-manager -- bash -c '
  set -e
  export DEBIAN_FRONTEND=noninteractive
  apt-get update && apt-get install -y curl gnupg

  # --batch --yes is required: there is no /dev/tty inside lxc exec.
  curl -fsSL https://packages.wazuh.com/key/GPG-KEY-WAZUH \
    | gpg --batch --yes --dearmor -o /usr/share/keyrings/wazuh.gpg
  chmod 644 /usr/share/keyrings/wazuh.gpg

  echo "deb [signed-by=/usr/share/keyrings/wazuh.gpg] https://packages.wazuh.com/4.x/apt/ stable main" \
    > /etc/apt/sources.list.d/wazuh.list
  apt-get update

  VER=$(apt-cache madison wazuh-manager | grep -m1 -E "4\.7\.5-" | awk "{print \$3}")
  [ -n "$VER" ] || { echo "no 4.7.5 candidate"; exit 1; }
  apt-get install -y wazuh-manager="$VER"
  apt-mark hold wazuh-manager

  systemctl daemon-reload
  systemctl enable --now wazuh-manager
'

lxc exec wazuh-manager -- systemctl is-active wazuh-manager    # → active
```

> Plain `gpg --dearmor` fails inside `lxc exec` with a `/dev/tty` error. The
> `--batch --yes` flags are not optional here.

### 4c. Turn vulnerability detection off

VD downloads and indexes CVE feeds continuously. On 12 GiB it will eat the host.

```bash
lxc exec wazuh-manager -- bash -c '
  sed -i "/<vulnerability-detector>/,/<\/vulnerability-detector>/ \
        s|<enabled>yes</enabled>|<enabled>no</enabled>|g" \
        /var/ossec/etc/ossec.conf
  systemctl restart wazuh-manager
'

# Verify: no feed files should accumulate.
lxc exec wazuh-manager -- bash -c 'ls /var/ossec/tmp | wc -l'      # → 0
```

> **4.7.5 uses `<vulnerability-detector>`, not `<vulnerability-detection>`.** On the
> live host the parent element was already `<enabled>no</enabled>` while the
> **nvd** and **msu** provider blocks were still `yes` — so VD was partly running
> despite looking disabled. Force every `<enabled>` inside the block to `no`, then
> confirm `/var/ossec/tmp` stays empty.

### 4d. Expose the API to the host

The API listens on `127.0.0.1:55000` inside the container. Publish it to the host
loopback with an LXD proxy device — not to `0.0.0.0`, and not through the VCN.

```bash
lxc config device add wazuh-manager wazuh-api proxy \
  listen=tcp:127.0.0.1:55000 connect=tcp:127.0.0.1:55000

curl -sk https://localhost:55000/
# → 401 {"title": "Unauthorized", "detail": "No authorization token provided"}
```

**401 is the correct answer.** It proves the API is reachable and refusing
anonymous access.

### 4e. Pin the API certificate

The API uses a self-signed certificate whose SAN is **`DNS:localhost` only** — it
carries no IP SAN. `https://127.0.0.1:55000` therefore fails hostname verification
even with the right CA file, while `https://localhost:55000` verifies. Use the
hostname form everywhere.

```bash
mkdir -p ~/cyberrange/certs
lxc exec wazuh-manager -- cat /var/ossec/api/configuration/ssl/server.crt \
  > ~/cyberrange/certs/wazuh-api.crt

openssl x509 -in ~/cyberrange/certs/wazuh-api.crt -noout -text \
  | grep -A1 "Subject Alternative Name"
# → DNS:localhost
```

The repo ships a pinned copy of this certificate at `certs/wazuh-api.crt`. A fresh
Wazuh install generates its **own** cert, so the fingerprint will differ from the
committed one — extract yours as above and use it. See `certs/README.md` for the
rotation policy.

Chapter 06 wires `WAZUH_API_URL`, the read-only `scoring` user and
`WAZUH_CA_BUNDLE` into `env/.env`. Do not create API users here, and do not put
Wazuh settings in `.env` yet.

**Do not install:** the Wazuh indexer, the Wazuh dashboard, or Filebeat. None is
used by the scoring path and together they will not fit.

## Step 5: Network Connectivity

Verify guacamole and wazuh are reachable:

```bash
# From Ampere host
curl -s http://10.115.77.12/ | head -5
ping -c 1 10.0.40.x  # Wazuh manager (replace with actual IP)
```

---

**Next:** Chapter 03 — Golden Images
