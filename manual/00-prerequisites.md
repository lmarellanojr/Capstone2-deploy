# Chapter 00: Prerequisites

Before starting Ampere deployment, prepare your OCI tenancy, SSH keys, and operator PC environment.

## OCI Setup

### 1. Always Free Eligibility

- Ensure your OCI account qualifies for **Always Free** tier (no payment method initially required).
- Oracle reduced Always Free from 4 OCPU / 24 GiB to **2 OCPU / 12 GiB** in June 2026.
- Verify available Always Free quotas:
  ```
  OCI Console → Compute → Instances → Check "Available" count
  ```

### 2. SSH Key Pair

Generate a dedicated key pair on your operator PC:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/id_oci_arm64 -C "ampere-cyberrange"
```

`ed25519` is smaller and faster than RSA and is accepted by OCI. Use
`-t rsa -b 4096` instead only if you have a tool that still requires RSA.

**Where the public key goes:** you paste it into the **instance's** "Add SSH keys"
field when you create the VM in Chapter 01. That is the only place it is needed.

> **Not under Identity & Security -> Users -> API Keys.** That section is for
> signing OCI **API** requests with the `oci` CLI. It expects an RSA key in PEM
> form, has nothing to do with logging into an instance, and putting your SSH key
> there will leave you unable to SSH while looking like everything is configured.

You will need the private key path for every `ssh` and `scp` command in this
Manual, so note where it is:

```bash
ls -l ~/.ssh/id_oci_arm64 ~/.ssh/id_oci_arm64.pub
```

On Windows the path is `C:\Users\<you>\.ssh\id_oci_arm64`. Keep the private key
off any share drive.

### 3. Cloudflare Zone

You need a Cloudflare account with a domain whose DNS Cloudflare manages.

- A registered domain, added to Cloudflare, nameservers pointed at Cloudflare
- Access to Zero Trust -> Networks -> Tunnels in that account

That is all that is required now. **You do not create the tunnel yet** -- Chapter
07 creates it, near the end, after a pod has been provisioned successfully on the
private path. Creating a tunnel early only means a token sitting around unused.

**When students exist:** they open `https://<TUNNEL_HOST>` (your zone). Write the name in `private/OPERATOR-RECORD.local.md`.

### 4. Ubuntu 24.04 (Noble) aarch64 Image

Ubuntu 24.04's codename is **Noble Numbat**. (Jammy is 22.04 -- the containers in
Chapter 03 use 22.04 for two of the goldens, which is why both versions appear in
this Manual.)

Nothing to prepare here. Oracle publishes Canonical's Ubuntu 24.04 aarch64 image
in the instance-creation wizard; you select it in Chapter 01 Step 1. There is no
image to upload and no OCID to record.

Confirm after first boot:

```bash
lsb_release -a          # -> Ubuntu 24.04.x LTS, codename noble
uname -m                # -> aarch64
```

## Operator PC Setup

### 1. Cloudflare CLI (optional, for tunnel management)

```bash
# Install cloudflared
# macOS: brew install cloudflare/cloudflare/cloudflared
# Windows: choco install cloudflare-warp (GUI) or download binary
# Linux: wget https://github.com/cloudflare/cloudflared/releases/download/...
```

### 2. OCI CLI (optional, for remote VM management)

```bash
# Install OCI CLI
# https://docs.oracle.com/en-us/iaas/Content/API/SDKDocs/clifile.htm
pip install oci-cli
# Configure: oci setup config
```

### 3. This Manual

If you were given **`C:\Capstone2-Deploy`**, you already have the Manual at
`C:\Capstone2-Deploy\manual`. Read that folder. Do not clone a second tree.

If you only have the Manual git remote:

```bash
git clone <Manual-remote> C:\Capstone2-Manual
```

Read in this order (see `README.md`).

## Tenant & Compartment

Ensure you have access to a compartment where you can:
- Create a VCN (Virtual Cloud Network)
- Create VM instances
- Assign public IPs
- Configure security lists

Note your **Compartment OCID** for later reference.

## Network Requirements

Ensure your home network can:
- Access OCI APIs via HTTPS (ports 443)
- SSH to Ampere public IP (port 22, VCN restricts by `/32`)
- Access portal URL via Cloudflare tunnel (HTTPS, port 443)

---

**Next:** Chapter "M4 to Ampere Guide for First-Time OCI" or skip to Chapter 01 if tenancy is ready.
