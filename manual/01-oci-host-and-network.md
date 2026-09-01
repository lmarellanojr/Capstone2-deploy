# Chapter 01: OCI Host and Network

Create and configure the Ampere VM, LXD storage, and networking.

## Step 1: Create Ampere VM Instance

**OCI Console:**
1. Compute → Instances → Create Instance
2. **Name:** `ampere-cyberrange` (or your preferred name)
3. **Image:** Ubuntu 24.04 aarch64 (Always Free eligible)
4. **Shape:** `VM.Standard.A1.Flex` 2 OCPU / 12 GiB RAM
5. **Network:**
   - Create new VCN or select existing: e.g., `cyberrange-vcn`
   - Subnet: e.g., `cyberrange-subnet` (10.0.0.0/24 or wider)
   - Public IP: Ephemeral (auto-assigned)
   - SSH key: Upload your `id_oci_arm64.pub`
6. **Storage:** 
   - Boot volume: Default (50 GiB)
   - Block volume (150 GiB): Create and attach as `/dev/sdb`
7. Click **Create Instance**

**Wait for state:** Running (2–5 minutes)  
**Note the public IP:** e.g., `<PUBLIC_IP>`

## Step 2: Initial SSH Access

From your operator PC:

```bash
ssh -i ~/.ssh/id_oci_arm64 ubuntu@<PUBLIC_IP>
```

Verify you're on the right host:

```bash
uname -m  # → aarch64
nproc     # → 2
free -h   # → Mem: 11 GiB (slightly under 12 GiB due to kernel)
```

## Step 3: User and Disk Setup

Create the `llms_admin` user and prepare the 150 GiB disk:

```bash
# As ubuntu user, create llms_admin.
# Do NOT add group lxd yet — that group does not exist until LXD is installed
# (Step 4). useradd -G sudo,lxd fails on a fresh Ubuntu 24.04.
sudo useradd -m -s /bin/bash -G sudo llms_admin
sudo mkdir -p /etc/sudoers.d
echo "llms_admin ALL=(ALL) NOPASSWD:ALL" | sudo tee /etc/sudoers.d/llms_admin
sudo chmod 0440 /etc/sudoers.d/llms_admin

# Copy your SSH key to llms_admin
sudo mkdir -p /home/llms_admin/.ssh
sudo cp /home/ubuntu/.ssh/authorized_keys /home/llms_admin/.ssh/
sudo chown -R llms_admin:llms_admin /home/llms_admin/.ssh
sudo chmod 700 /home/llms_admin/.ssh
sudo chmod 600 /home/llms_admin/.ssh/authorized_keys
```

Now SSH directly as `llms_admin`:

```bash
ssh -i ~/.ssh/id_oci_arm64 llms_admin@<PUBLIC_IP>
```

### Format the 150 GiB Disk

```bash
# Identify the disk
lsblk  # Look for /dev/sdb (150G, not mounted)

# Format as btrfs
sudo mkfs.btrfs -f /dev/sdb

# Note the UUID for fstab
sudo blkid /dev/sdb  # → UUID=...

# Add to /etc/fstab
# Replace UUID with your actual UUID
echo "UUID=<UUID_HERE> /mnt/ampere-lxd btrfs defaults,nofail 0 2" | sudo tee -a /etc/fstab

# Mount
sudo mkdir -p /mnt/ampere-lxd
sudo mount /mnt/ampere-lxd

# Verify
df -h /mnt/ampere-lxd  # → 150G available
```

## Step 4: LXD Installation and Configuration

```bash
# Install LXD snap
sudo snap install lxd --channel=latest/stable

# Now the lxd group exists — add llms_admin (log out and back in before lxc as llms_admin)
sudo usermod -aG lxd llms_admin

# Initialize LXD with auto config
# Do NOT use --network-address=none (fails with "Couldn't resolve none")
# Do NOT use --storage-create-device=/dev/sdb (would try to mkfs again)
sudo lxd init --auto

# Configure storage pool (use REST API, CLI can hang)
curl -X POST \
  --unix-socket /var/snap/lxd/common/lxd/unix.socket \
  http://localhost/1.0/storage-pools \
  -H "Content-Type: application/json" \
  -d '{
    "name": "default",
    "driver": "btrfs",
    "config": {
      "source": "/mnt/ampere-lxd"
    }
  }'

# Or wait and retry CLI:
lxc storage create default btrfs source=/mnt/ampere-lxd

# Verify
lxc storage info default
lxc storage list
```

The default LXD profile assigns root disk to the `default` storage pool and `eth0` to `lxdbr0`.

### Fix the OCI packet filter — before you create any container

OCI's Ubuntu images ship an `oracle-cloud-agent` firewall with **reject-all**
`INPUT` and `FORWARD` chains. LXD's DHCP (UDP 67 on `lxdbr0`) never reaches
dnsmasq, so **every** container you create from here on comes up with `eth0` UP,
**0 bytes RX**, no IPv4, and every `apt-get update` inside it dies with
`Network is unreachable`.

It looks like a broken image or a bad mirror. It is the host filter, and it hits
the gateway container in Chapter 02 exactly as hard as the image builders in
Chapter 03.

```bash
cd ~/cyberrange
sudo bash deploy/host/install_lxd_oci_iptables.sh
```

Expected last line:

```text
lxd_oci_iptables=PASS
```

The script inserts `ACCEPT` for `lxdbr0`, `vmbr1`, `lxdovn*` and `br-int` only,
saves the ruleset to `/etc/iptables/rules.v4`, and installs
`cyberrange-lxd-iptables.service` so it survives reboot. It opens nothing on the
public NIC.

**Prove a container can reach the internet before going further:**

```bash
lxc init ubuntu:22.04 nettest </dev/null
lxc start nettest </dev/null
sleep 15
lxc exec nettest -- ping -c2 1.1.1.1
lxc delete -f nettest </dev/null
```

If that ping fails, stop here. Nothing in Chapters 02 or 03 will work.

### zram

The 12 GiB shape runs the API, the portal, Keycloak, Wazuh and a student pod at
once, and the provision API refuses to start a pod without 5,632 MB free. zram
gives compressed swap in RAM. **No disk swap** — the 50 GiB boot volume stays for
the OS.

The repo ships the script the live host used:

```bash
cd ~/cyberrange
sudo bash deploy/host/setup_zram_and_swap.sh
```

It removes any disk-backed swap **first** (order matters — `swapoff -a` after
zram is live would disable zram too), installs `systemd-zram-generator`, writes
`/etc/systemd/zram-generator.conf` with `zram-size = 3072` and
`compression-algorithm = lz4`, sets `vm.swappiness=80`, and starts
`systemd-zram-setup@zram0.service`.

**On the Oracle Minimal image it fails the first time** with
`Module zram not found`. The image carries `linux-modules-*` but not `-extra`:

```bash
sudo apt-get install -y linux-modules-extra-$(uname -r)
sudo modprobe zram
echo zram | sudo tee /etc/modules-load.d/zram.conf     # persist across reboot
sudo bash deploy/host/setup_zram_and_swap.sh           # re-run
```

Verify:

```bash
systemctl is-active systemd-zram-setup@zram0     # -> active
swapon --show
# NAME       TYPE      SIZE USED PRIO
# /dev/zram0 partition   3G   0B  100
zramctl                                          # -> lz4, 3G, [SWAP]
```

Exactly one swap device, and it is `/dev/zram0`. A disk-backed entry still listed
means the script ran before the module was available — re-run it.

## Step 5: Network Configuration

### LXD Bridge (lxdbr0)

Verify lxdbr0 is configured as expected:

```bash
lxc network show lxdbr0
```

Expected output includes:
```
ipv4.address: 10.115.77.1/24
ipv4.nat: true
ipv6.address: none
```

If not configured, set it:

```bash
lxc network set lxdbr0 ipv4.address 10.115.77.1/24
lxc network set lxdbr0 ipv4.nat true
lxc network set lxdbr0 ipv6.address none
```

### Verify Network Routes

```bash
ip -4 route
# Should show:
#   default via 10.0.0.1 dev enp0s6 ...
#   10.0.0.0/24 dev enp0s6
#   10.115.77.0/24 dev lxdbr0 src 10.115.77.1 linkdown
```

The lxdbr0 route shows `linkdown` because no container exists yet. It will activate when the first container joins the network.

### VCN Security List

**The only ingress rule this deployment needs is SSH from your own IP.**

**OCI Console:** Networking → Virtual Cloud Networks → your VCN → Security Lists →
Default Security List.

| Direction | Protocol | Port | Source / Destination | Keep? |
|---|---|---|---|---|
| Ingress | TCP | **22** | **your operator PC's public IPv4 `/32`** | **Yes** |
| Ingress | ICMP | type 3, 4 | `0.0.0.0/0` | Yes — path MTU discovery |
| Egress | All | All | `0.0.0.0/0` | Yes — apt, GitHub, Cloudflare |

> **Do not open 80 or 443.** A Cloudflare tunnel dials **outbound** to Cloudflare
> over 443; it needs no inbound rule whatsoever. Students reach the range through
> the tunnel hostname, never through this host's public IP. Opening 80/443
> publishes the box directly to the internet and fails the verification in
> Chapter 08.

> **The VCN wizard defaults ingress TCP 22 to `0.0.0.0/0`.** SSH from your house
> works either way, which is exactly why this is easy to miss. Edit the existing
> row — do not add a second SSH rule:
>
> Tick the TCP / 22 / `0.0.0.0/0` line → **Edit** → Source CIDR =
> `YOUR.IP.HERE/32` → Save. Find your address at `https://api.ipify.org` first.

Also do **not** open, at any point:

| Port | What it is | Why not |
|---|---|---|
| 3000 | Next.js portal | Reached through the tunnel origin, not directly |
| 5000 | Provision API | Binds `10.115.77.1` only |
| 8083 | Keycloak | Binds `127.0.0.1` inside the guacamole container |
| 8765 | SSH bridge | Binds `10.115.77.1` only |
| 18301+ | DVWA lab proxy | An intentionally vulnerable app — never publish it |
| 55000 | Wazuh API | Reached through an LXD proxy on `127.0.0.1` |
| 8443 | LXD API | Unix socket only; no public binding needed |

**Checkpoint — screenshot the full ingress table into your evidence folder.**
Chapter 01 fails this checkpoint if TCP 22 is still `0.0.0.0/0`, or if 80 or 443
appear at all.

## Step 6: Get the product repo onto Ampere

Two ways, depending on how the product tree was handed to you. Both produce the
same `~/cyberrange`; neither is a lesser option.

| You have | Use |
|---|---|
| a reachable git remote for the product repo | **A — clone** |
| the deploy kit, or a tree with no remote | **B — copy an archive** |

Whichever you use, the result must pass the file check under **Verification**
below. That check, not the method, is what says the transfer worked.

### A — clone it

```bash
# On Ampere, as llms_admin
git clone <product-repo-remote> ~/cyberrange
mkdir -m 700 ~/cyberrange-data
```

The repo is self-contained: the portal, the SSH bridge, the systemd units, the
deploy scripts and the provisioning helpers are all tracked, so a clone is
everything the rest of this Manual needs. `node_modules/`, `.next/` and every
`.env` are excluded by `.gitignore` and are created on the host.

### B — copy an archive

This is the path to use with `C:\Capstone2-Deploy`, which is a generated
directory rather than a repository and so cannot be cloned. It is equally the
path when the repo simply has no remote the VM can reach.

Change into the **code** tree on your PC first — `C:\Capstone2-Deploy\cyberrange`
if you are using the deploy kit, or `C:\Capstone2Implementation` if you have the
product repo.

Build the archive **from inside** that directory, using a relative path, so it
does not carry a Windows or absolute path:

```bash
cd /c/Capstone2-Deploy/cyberrange        # or: cd /c/Capstone2Implementation
tar --exclude='.git' \
    --exclude='.mypy_cache' \
    --exclude='.pytest_cache' \
    --exclude='.superpowers' \
    --exclude='__pycache__' \
    --exclude='node_modules' \
    --exclude='.next' \
    --exclude='.venv' \
    --exclude='.env' \
    --exclude='.env.local' \
    -czf ~/capstone2-prod.tar.gz .
```

The trailing `.` is what makes this work. `tar -czf out.tgz C:\Capstone2-Deploy`
fails on a POSIX tar: `C:` is read as a remote-host prefix, not a drive.

Upload and extract:

```bash
scp -i ~/.ssh/id_oci_arm64 ~/capstone2-prod.tar.gz llms_admin@<PUBLIC_IP>:~/

ssh -i ~/.ssh/id_oci_arm64 llms_admin@<PUBLIC_IP>
mkdir -p ~/cyberrange ~/cyberrange-data
chmod 700 ~/cyberrange-data
tar xzf ~/capstone2-prod.tar.gz -C ~/cyberrange
rm -f ~/capstone2-prod.tar.gz
```

> Create the target directory **before** extracting, and pass `-C` exactly once.
> `tar ... -C ~ --strip-components=1 -C ~/cyberrange` is wrong twice: only the last
> `-C` takes effect, and it points at a directory that does not exist yet.
> `--strip-components` is unnecessary because the archive was built from inside the
> repo.

## Verification

```bash
# On Ampere
cd ~/cyberrange
ls
```

Expect ordinary directories, not symlinks. The exact listing depends on which
source you copied from — a full clone of the product repo carries more than the
deploy kit does — so do not compare it line for line. These must be present in
either case:

```text
bridge-src  certs  deploy  docs  env  portal  pyproject.toml  src
```

What actually matters is the file-level check below. Run it:

```bash
for f in portal/package.json bridge-src/bridge.py \
         deploy/systemd/install-user-units.sh \
         deploy/keycloak/keycloak.service \
         deploy/guacamole/nginx-ampere.conf \
         deploy/host/install_lxd_oci_iptables.sh \
         deploy/oci_build_goldens_arm64.sh \
         src/provisioning/provision_api_fastapi.py \
         env/oci-12gib.env.example; do
  [ -f "$f" ] && echo "  OK   $f" || echo "  MISS $f"
done
```

Every line must read `OK`. A `MISS` means the clone or the tarball was incomplete
-- fix it here rather than discovering it in Chapter 04.

Nothing below should exist yet; all are created on the host later:

```bash
ls -d portal/node_modules portal/.next .venv env/.env portal/.env.local 2>/dev/null \
  || echo "  none present - correct for a fresh clone"
```

```bash
# Data directory and LXD pool
stat -c '%a %n' ~/cyberrange-data                    # -> 700
lxc storage info default | grep -A1 'total space'    # -> 150.00GiB
```

---

**Next:** Chapter 02 — Gateway and Wazuh setup
