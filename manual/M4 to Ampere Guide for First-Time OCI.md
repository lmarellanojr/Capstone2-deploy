# **M4 → Ampere: Guide for First-Time OCI**

**Audience:** You have an Oracle Always Free account and have never used OCI.  
**Job of this file:** Get you from “I signed up” to a **correct empty Ampere VM**, then walk the software in order without breaking Always Free limits or the student security contract.  
**Not this file:** Host command checklists (Manual chapters 01–08 in this same folder). This file is Console clicks and the picture in your head.

| Role | Path |
| :---- | :---- |
| This guide (human, first time) | `M4 to Ampere Guide for First-Time OCI.md` (this file) |
| SSH | `Ampere SSH Guide for First-Time Operators.md` |
| Session G Cloudflare | `Ampere Cloudflare Tunnel Guide for First-Time Operators.md` |
| Host steps after the VM exists | Manual `01`–`08` in this folder |
| Code on the VM | copy `cyberrange/` from the deploy kit to `~/cyberrange` (or clone the product remote if you have one) |

## **Always Free quota (read before Create instance)**

Oracle gives you **2 OCPU + 12 GiB + 200 GB total per tenancy**. You cannot run two Ampere A1 VMs in the **same** tenancy.

- **Proof host already running:** do not terminate it. Live values are in `private/OPERATOR-RECORD.local.md` (not in this kit).
- **You are creating a VM:** empty tenancy, a **different** tenancy, or a paid shape. Fill `OPERATOR-RECORD.local.md` as you go. Do not copy another host’s public IP into `ssh config`.

| Field | Expected |
| :---- | :---- |
| Display name | `cyberrange-ampere` (Oracle may auto-name `instance-YYYYMMDD-HHMM` — cosmetic; do not recreate only to rename) |
| Shape | `VM.Standard.A1.Flex` **2 OCPU / 12 GiB** |
| Image | Ubuntu **24.04** aarch64 |
| Boot disk | ~50 GB (`lsblk` may show ~47G — **PASS**, do not format) |
| Data disk | `sdb` **150G btrfs** for the LXD pool |
| SSH | user **`llms_admin`** (`Host ampere`), key `~\.ssh\id_oci_arm64` |
| Public IPv4 | `<PUBLIC_IP>` — admin SSH only |
| VCN private IPv4 | `<VCN_PRIVATE_IP>` in `10.0.0.0/16` — must **not** collide with lab `10.115.77.0/24` |

**Screenshots already in evidence**

| Shot | What it shows | Result |
| :---- | :---- | :---- |
| Instance **Networking** tab, Running | Shape/network | **PASS** (this tenancy) |
| Default Security List **ingress** | SSH source | **FAIL** if TCP 22 is `0.0.0.0/0` — lock to your `/32` |

**Security list as of that ingress shot (3 rules, page 1 of 1):**

| Source | Protocol | Destination | Keep? |
| :---- | :---- | :---- | :---- |
| `0.0.0.0/0` | TCP | **22** | **No — FAIL.** Edit to your IP `/32`. This is the VCN wizard default. SSH working from your PC does **not** mean it is locked. |
| `0.0.0.0/0` | ICMP type 3, 4 | Path MTU | Yes (wizard default) |
| `10.0.0.0/16` | ICMP type 3 | VCN unreachable | Yes |

![Default Security List - SSH Open to World (FAIL)](OCI%20SS/Screenshot%202026-08-27%20225725.png)

No ingress rows for 80 / 443 / 3000 / 18301 / 5000 — keep it that way. Do **not** add those ports “so the website works.”

**Session A is not finished** until TCP 22 source is **your** `a.b.c.d/32` and you have a **new** ingress screenshot. Then we sit down for Session B (Task 2: `llms_admin`, format **only** `sdb`, LXD on that disk). Do not `mkfs`, `lxd init`, or `apt upgrade` until that `/32` screenshot exists.

## **0\. Picture in your head (read this once)**

**M4** is the ARM laptop/server you already built (arm64server, Tailscale 100.83.29.13). Students today open http://100.83.29.13:3000. That is a **dress rehearsal**. We copy **files and settings**, not M4’s public URLs or open ports.  
**Ampere** is one **Always Free** Oracle virtual machine in **your** tenancy:

| Piece | What it is | Our number   |
| :---- | :---- | :---- |
| Shape | Kind of CPU Oracle rents you | VM.Standard.A1.Flex (ARM, also called Ampere A1) |
| OCPU | Oracle’s unit of CPU | **2** (not 4\) |
| RAM | Memory | **12 GiB** (not 24\) |
| Disk | Whole account, boot \+ extra disks together | **200 GB** |
| How we split disk | OS on one disk, lab containers on the other | **50 GiB boot \+ 150 GiB data** |

Students will **never** type the Oracle public IP into a browser. They will later open **one** https://… hostname from Cloudflare. Oracle’s firewall stays almost shut: **SSH port 22 from your home/office IP only**.  
  Student browser  
        │  HTTPS  
        ▼  
  Cloudflare named tunnel  
        │  HTTP only to the lab gateway  
        ▼  
  guacamole nginx  10.115.77.12:80  
        ├── /           → portal (Next) on 10.115.77.1:3000  
        ├── /auth/      → Keycloak (login)  
        ├── /lab/dvwa/  → DVWA (after login, same site)  
        └── /api/ssh-websocket → Kali/Meta terminal

  Oracle public IP  
        └── TCP 22 from YOUR IP  → you (admin SSH)  
        └── ports 80, 443, 3000, 18301, 5000  → CLOSED

If you remember only four rules:

> 1. One ARM VM: **2 OCPU / 12 GiB**. Never AMD micros. Never 4/24.  
> 2. Disk: **50 \+ 150**. No other Always Free VMs eating the 200 GB.  
> 3. Students: **Cloudflare only**. Do not open website ports on Oracle.  
> 4. Copy **git files** from Capstone2 / M4. Do **not** copy Tailscale URLs, 0.0.0.0, or :18301.

## **1\. Words you will see in the Oracle Console**

| Word on screen | Plain meaning   |
| :---- | :---- |
| **Tenancy** | Your whole Oracle account. |
| **Home region** | The one country/city Oracle locked you into for Always Free. You **must** create the VM here. |
| **Compartment** | Folder inside the tenancy. Use the default (often named after you). Do not invent a second one yet. |
| **Availability domain (AD)** | A building/room inside the region (AD-1, AD-2, …). If create fails with “out of capacity,” try another AD. |
| **VCN** | Your private cloud network (like a home LAN in Oracle’s data center). |
| **Subnet** | A slice of the VCN. Use a **public** subnet so the VM can have a public IP for **your SSH**. |
| **Security list / NSG** | Cloud firewall. We allow **22 in** from your IP and **HTTPS out**. |
| **Instance** | The virtual machine. |
| **Shape** | CPU type \+ size. Ours is Ampere A1 Flex **2 / 12**. |
| **Image** | The operating system disk template. Ours is **Ubuntu 24.04 Minimal aarch64**. |
| **Boot volume** | The OS disk. Default **50 GB**. Counts against the 200 GB. |
| **Block volume** | Extra disk. We attach **150 GB** and put LXD (lab containers) on it. |
| **OCID** | Long Oracle ID. Safe to paste into evidence. Not a password. |
| **Always Free-eligible** | Green/grey label. Stay inside these or Oracle starts billing. |
| **Out of host capacity** | That AD is full of free ARM VMs. Wait or try another AD. **Do not** pick a bigger or AMD shape to “fix” it. |

## **2\. What you must not click (this is how people blow the free tier)**

Oracle’s signup page and Console offer many “free” toys. **This project uses one compute VM \+ its two disks.** Leave the rest alone.

| Tempting click | Why not   |
| :---- | :---- |
| **“Quickly launch Always Free resources”** / Resource Manager stack | Often creates **AMD micros \+ extra disks** and spends the 200 GB before our 150 GiB LXD disk exists. |
| **VM.Standard.E2.1.Micro** (AMD, 1 GB) | Eats a boot disk. We need the **entire** 200 GB for **one** Ampere. |
| Shape **4 OCPU / 24 GiB** | Older docs. **Not** Always Free anymore (since 2026-06-15). You will be billed or the create will fail. |
| **Oracle Linux** as the image | Wrong OS for our scripts. Use **Ubuntu 24.04 Minimal aarch64**. |
| Ubuntu **amd64 / x86\_64** | Wrong CPU. Lab images will die with exec format error. |
| Opening **80 / 443** “so the website works” | Forbidden. Students use Cloudflare later. |
| Creating **Autonomous Database**, HeatWave, extra load balancers | Unused. Extra moving parts. |
| A second Ampere “just to try” | You only have **2 OCPU \+ 12 GiB \+ 200 GB** total. One VM uses all of it. |
| Growing boot to 200 GB and skipping the extra disk | Allowed by Oracle, **not** our layout. LXD would fight the OS on /. |

Also: **Always Free compute must be in the home region.** Creating the VM in another region can bill you.  
**Idle VM warning:** Oracle may **delete** an Always Free VM that stays nearly unused for 7 days (CPU, network, and memory all low). After we install the range, it will not look idle. Do **not** create the VM today and leave it empty for a week.  
**Card / trial:** Signup may ask for a card. Always Free Ampere is **$0** if you stay in the table above. Turn on a **budget alert** (Governance → Budgets) at $1 so a wrong shape emails you.

## **3\. How we will proceed (sessions)**

Do **not** try to finish the whole range in one evening. Stop at the checkpoint.

| Session | You do | Done when | Plan tasks   |
| :---- | :---- | :---- | :---- |
| **A — today** | SSH key \+ empty tenancy \+ VCN firewall \+ create VM \+ 150 GiB disk \+ first login | `uname -m` = aarch64, `nproc` = 2, `free -g` ≈ 12, `lsblk` shows ~50G \+ 150G, **and** ingress TCP 22 is your `/32` (not `0.0.0.0/0`) | Deploy Tasks **1–2** (human) |
| **B** | Linux user llms\_admin, format 150 GiB, install LXD on **that** disk | lxc storage info pool is the 150G disk, **not** a file on / | Deploy Task **2** rest |
| **C** | Clone Capstone2, zram, networks | lxdbr0 is 10.115.77.1/24 | Deploy Tasks **3–4** |
| **D** | Bake goldens **before** guacamole/Wazuh | lxc image list has kali / meta / dvwa | Deploy Task **5** |
| **E** | Gateway, Wazuh manager-only, Keycloak, API | Login works on the **private** path | Deploy Tasks **6–9** |
| **F** | Portal next start (build on your PC), bridge, one student pod | Dashboard create → Kali whoami | Deploy Tasks **10–12** |
| **G — last** | Cloudflare \+ HTTPS URLs \+ internet probe \+ reboot | Public IP ports closed; only https://\<tunnel\>/ works | Deploy Tasks **13–14** |

**On this tenancy (2026-08-28):** shape proof and disks are recorded. The remaining Session A item is **lock TCP 22 to your `/32`** (still `0.0.0.0/0` in `Screenshot 2026-08-27 225725.png`). Do not start Session B until that screenshot is replaced.

If you are recreating and create fails on capacity, Session A still “passes” by recording the error — we retry, we do not change shape.  
Write evidence as you go in Manual chapter 01’s evidence stub (or `OPERATOR-RECORD.example.md` / your private record file).  
Public IP, region, AD, OCID, command output — **no** private keys, **no** passwords in git.

## **4\. Session A0 — SSH key on your Windows PC**

Oracle will ask for a **public** key when you create the VM. The **private** key never leaves your PC.

> 1. Open **PowerShell** (not Command Prompt).  
> 2. Run:

New-Item \-ItemType Directory \-Force \-Path $env:USERPROFILE\\.ssh | Out-Null  
if (Test-Path "$env:USERPROFILE\\.ssh\\id\_oci\_arm64") {  
  Write-Output "Key already exists — do not overwrite. Use the existing .pub file."  
} else {  
  ssh-keygen \-t ed25519 \-C "oci-cyberrange" \-f "$env:USERPROFILE\\.ssh\\id\_oci\_arm64" \-N '""'  
}  
Get-Content "$env:USERPROFILE\\.ssh\\id\_oci\_arm64.pub"

> 3. You should see one line starting with ssh-ed25519 AAAA…. **Copy that whole line.** That is what Oracle wants.  
> 4. Leave id\_oci\_arm64 (no .pub) alone. That is the private key. Do not email it, do not commit it, do not paste it into chat.

After the VM exists, you will add this to C:\\Users\\\<you\>\\.ssh\\config:  
Host ampere  
  HostName PASTE\_PUBLIC\_IP\_HERE  
  User ubuntu  
  IdentityFile \~/.ssh/id\_oci\_arm64

Then ssh ampere works. First login user is almost always **ubuntu** (the image default). Later we add llms\_admin and switch the User line.  
**Checkpoint:** You can open id\_oci\_arm64.pub and see one ssh-ed25519 line.

## **5\. Session A1 — Confirm the account is empty (do this before Create)**

> 1. Open [https://cloud.oracle.com](https://cloud.oracle.com) and sign in.  
> 2. Top-right: note the **region** name (example: US East (Ashburn)). That should be your **home region**. If the region picker is set somewhere else, switch back.  
> 3. Hamburger (☰, top left) → **Compute** → **Instances**.  
>    **Expect:** empty list, or only junk you are willing to **terminate**.  
>    If you see AMD **Micro** instances from a wizard: **Terminate** them **and** delete their **boot volumes** (Compute → Boot Volumes). Otherwise the 200 GB is already gone.  
> 4. ☰ → **Block Storage** → **Block Volumes** and **Boot Volumes**.  
>    **Expect:** no leftover disks. A terminated instance can leave a 50 GB boot behind and still count.  
> 5. ☰ → **Governance & Administration** → **Limits, Quotas and Usage**.  
>    Filter service **Compute** / **Block Volume** if you want. You do not need to understand every row. You need to see you have not already spent A1 OCPUs and 200 GB.

**Checkpoint:** Zero Always Free VMs, zero leftover boot/block volumes. Write the **home region** into the evidence file.

## **6\. Session A2 — VCN and the cloud firewall**

You need a VCN **before** or **while** creating the instance. First-time accounts often have **no** VCN yet.

### **6.1 Create a VCN (if none exists)**

![VCN Wizard Step 1](OCI%20SS/Screenshot%202026-08-27%20223326.png)

> 1. ☰ → **Networking** → **Virtual cloud networks**.  
> 2. **Start VCN Wizard** → **Create VCN with Internet Connectivity** → Start.  
> 3. Name: cyberrange-vcn.  
> 4. Leave the default CIDR if it is **10.0.0.0/16** (or anything that does **not** include 10.115.77.0/24).  
>    If the wizard offers 10.115.77.0/24 as the VCN itself — **stop** and use 10.0.0.0/16 instead. We need 10.115.77.0/24 later for the **lab bridge inside the VM**, not for Oracle’s network.  
> 5. Create. Wait until it finishes. You should see a **public** subnet and an **internet gateway**.

### **6.2 Lock SSH to your IP**

Find your public IPv4 immediately before editing rules (to account for dynamic ISP lease changes): open [https://ifconfig.me](https://ifconfig.me) or [https://api.ipify.org](https://api.ipify.org) in a browser. You want a.b.c.d — write it as a.b.c.d/32.

> 1. Open the VCN → **Security Lists** → **Default Security List** (or the list attached to the **public** subnet).  
> 2. **Ingress** (inbound):

| Source | IP protocol | Destination port | Meaning   |
| :---- | :---- | :---- | :---- |
| YOUR.IP.HERE/32 | TCP | **22** | Only you can SSH |

> 3. Remove or do **not** add: 80, 443, 3000, 3389, 22 from 0.0.0.0/0 (the whole internet).  
>    **This tenancy hit the wizard default:** after “Create VCN with Internet Connectivity,” ingress already had **TCP 22 from `0.0.0.0/0`**. Creating the VM later does **not** change that rule. SSH from your house will still work, which is why it is easy to miss.  
>    **Edit that existing row** (do not add a second SSH rule): tick the TCP/22/`0.0.0.0/0` line → **Edit** → Source CIDR = `YOUR.IP.HERE/32` → Save. Leave the two ICMP rows.  
>    If your home IP changes later, you will be locked out until you fix the rule from the Console (or Oracle Cloud Shell). That is the intended tradeoff.  
> 4. **Egress** (outbound): allow **TCP 443** to 0.0.0.0/0 (updates, GitHub, Cloudflare, Ubuntu packages). A default “allow all egress” is OK for this project. The egress table may sit **below the fold** — scroll down before you screenshot.  
> 5. **Re-check after the instance is Running.** VCN on 2026-08-27 + VM on 2026-08-28 left 22 open to the world. Same Security List page, same three rows, until you edit.

**Checkpoint:** Ingress TCP 22 source is **only** your `/32` (not `0.0.0.0/0`). ICMP-only extras are OK. Screenshot the **full ingress table** into `docs/evidence/`. Session A **fails** this checkpoint if 22 is still `0.0.0.0/0`.

## **7\. Session A3 — Create the Ampere instance (Updated for Current OCI Console Layout)**

*Note: OCI uses a multi-step streamlined wizard layout. Follow these sections sequentially to prevent misconfigurations.*

![Compute Instances Menu](OCI%20SS/Screenshot%202026-08-28%20132455.png)

> 1. ☰ → **Compute** → **Instances** → **Create instance**.  
> 2. **Basic Information:**  
   * **Name:** `cyberrange-ampere`. If you skip this, Oracle auto-names `instance-YYYYMMDD-HHMM`. That is cosmetic — do **not** terminate and recreate only to rename.  
   * **Hostname:** optional. If you leave it blank, it may become the VCN name (`cyberrange-vcn` on this tenancy). Cosmetic.  
   * **Compartment:** Default/root compartment.  
   * **Placement:** Choose your **home region** (this tenancy: **Singapore**) and select an **Availability Domain** (try AD-1 first). Always Free compute **must** stay in the home region.  
> 3. **Image and Shape:**  
   * **Image:** Click **Change image** → Choose **Canonical Ubuntu** → Select **Ubuntu 24.04 Minimal aarch64** (Ensure it displays the *Always Free-eligible* badge). Do not choose Oracle Linux or amd64/x86\_64.  
   
   ![Image Selection](OCI%20SS/Screenshot%202026-08-28%20133033.png)
   
   * **Shape:** Click **Change shape** → Select the **Ampere** card → Select **VM.Standard.A1.Flex** radio button → Click **Select shape**.  
   * **Flexible Shape Config:** Set **OCPU count \= 2** and **Memory \= 12 GB** (Do not set to 24 GB, as Always Free caps at 12 GB). Double-check that the shape configuration summary clearly displays the *Always Free-eligible* tag.
   
   ![Shape Configuration - Ampere A1 Flex 2 OCPU / 12 GB](OCI%20SS/Screenshot%202026-08-28%20133552.png)  
> 4. **Networking:**  
   * **Primary network:** Select existing virtual cloud network (cyberrange-vcn).  
   * **Subnet:** Select the public subnet.  
   * **Public IPv4 address:** Select **Assign a public IPv4 address** (Yes). (Students will never use this IP; you need it strictly for admin SSH).
   
   ![Networking Configuration](OCI%20SS/Screenshot%202026-08-28%20134913.png)  
> 5. **Add SSH Keys:**  
   * Select **Paste public keys**.  
   * Paste the single ssh-ed25519 … public key string generated in Session A0. Do not select "Generate a key pair for me".  
> 6. **Boot Volume:**  
   * Leave **"Specify a custom boot volume size and performance setting"** toggled **OFF** so it defaults to the standard free size.  
   * Leave **"Use in-transit encryption"** toggled **ON**.  
   * Leave **"Encrypt this volume with a key that you manage"** toggled **OFF**.  
   * Do **not** increase boot volume size to 200 GB, as we need that budget for our extra block volume. Leave block volumes empty for now.  
> 7. Click **Create**. Monitor the status until it changes from *Provisioning* to **Running**.

![Instance Running Status](OCI%20SS/Screenshot%202026-08-28%20140515.png)

### **If you see Out of host capacity**

> * Try the other **availability domain** in your home region.  
> * Wait hours or a day and retry. Free ARM is often scarce.  
> * **Do not** switch to AMD Micro or larger 4 OCPU / 24 GiB shapes.  
> * Record the exact error text \+ AD \+ time in evidence. Session A is then “blocked on Oracle capacity,” not “you failed.”

### **After it is Running**

On the instance detail page write down:

| Field | Write in OPERATOR-RECORD.local.md | Put in evidence? |
| :---- | :---- | :---- |
| Public IP | `<PUBLIC_IP>` | Yes |
| Private IP | `<VCN_PRIVATE_IP>` | Yes |
| OCID | `<INSTANCE_OCID>` | Yes |
| AD | `AP-SINGAPORE-1-AD-1` | Yes |
| Shape | `VM.Standard.A1.Flex` 2 / 12 | Yes |
| Image | Ubuntu 24.04.4 LTS aarch64 | Yes |

![Instance Details - Networking Tab with Shape & Image](OCI%20SS/Screenshot%202026-08-28%20181103.png)

On the workstation, add **`Host ampere`** to `C:\Users\<you>\.ssh\config` if it is missing (`IdentitiesOnly yes` stops Windows from offering the wrong key):

```text
Host ampere
  HostName <PUBLIC_IP>
  User ubuntu
  IdentityFile ~/.ssh/id_oci_arm64
  IdentitiesOnly yes
```

Then **go back to §6.2** and confirm TCP 22 is your `/32`. Creating the instance does not lock the security list.

## **8\. Session A4 — Attach the 150 GiB data disk**

The create-instance wizard sometimes lets you add a volume. If you already attached **150 GB** during create, skip to lsblk in Session A5.  
Otherwise:

![Block Storage Menu](OCI%20SS/Screenshot%202026-08-28%20135142.png)

> 1. ☰ → **Storage** → **Block Storage** → **Block Volumes** → **Create block volume**.  
> 2. Name: cyberrange-lxd.  
> 3. **Create in:** same **compartment**, same **availability domain** as the VM (a volume in AD-1 cannot attach to a VM in AD-2).  
> 4. Size: **150 GB**.  
> 5. Leave backup policy empty / no extra backups (Always Free includes **five** backups tenancy-wide; we do not need one yet).  
> 6. Create. Wait until **Available**.  
> 7. Open the volume → **Attached instances** → **Attach to instance** → the Running VM.  
>    Attachment type: **Paravirtualized** is fine.  
>    Device path: default.

**Math check:** 50 \+ 150 \= **200**. You are now at the Always Free disk ceiling. Do not create another volume.  

![Block Volume Attached to Instance](OCI%20SS/Screenshot%202026-08-28%20135838.png)

**Checkpoint:** Instance shows two disks (boot 50, block 150).

## **9\. Session A5 — First SSH and shape proof (stop if any line fails)**

From PowerShell:  
ssh ampere  
\# if config is not set yet:  
\# ssh \-i $env:USERPROFILE\\.ssh\\id\_oci\_arm64 ubuntu@PASTE\_PUBLIC\_IP

First connect will ask to trust the host fingerprint. Type yes.  

![SSH Connection to Ampere Instance](OCI%20SS/Screenshot%202026-08-28%20140044.png)

On the VM:  
uname \-m          \# must print: aarch64  
nproc             \# must print: 2  
free \-g           \# Mem total about 12 (11 or 12 is OK)  
lsblk             \# look for one \~50G disk (OS) AND one \~150G disk (empty data volume)

*Note: Device letters (sda, sdb, sdc) may vary. Rely on **size**, not the letter. Oracle “50 GB” boot often shows as **~46–47G** in `lsblk` — that still counts as the 50G boot. Do **not** grow it or format it.*

![Shape and Disk Validation Output](OCI%20SS/Screenshot%202026-08-28%20181510.png)

**This tenancy (2026-08-28) — treat as the pass pattern:**

```text
sda      46.6G  disk          ← boot, has sda1 /  (ext4). NEVER mkfs this.
├─sda1   45.6G  part  /
sdb       150G  disk          ← empty, no FSTYPE. Session B formats THIS disk only.
```

`sdb` with **no filesystem** is correct until Task 2. Do not `mkfs` in Session A.  
Oracle may also show `/dev/oracleoci/oraclevdb` as a friendly name for the 150G disk — confirm it is the **150G** device before any format.  
**If uname \-m is x86\_64:** You created the wrong CPU. Terminate and start Session A3 again with Ampere A1. Do not install anything.  
**If nproc is 4 or memory is \~24:** You picked the old billed shape. Stop and resize or recreate to **2 / 12**.  
**If lsblk has only 50G:** The 150G volume is not attached. Go back to Session A4.  
**If SSH times out:**

> 1. Instance **Running**?  
> 2. Public IP matches HostName?  
> 3. Security list still has **22** from **your current** IP (/32)? Home IPs change.  
> 4. You used user **ubuntu** and the **private** key that matches the pasted .pub?

Paste the four commands’ output into your chapter-01 evidence stub, `docs/evidence/2026-09-secondhost-ch01-oci-host-and-network.md`. (The first host’s equivalent was `2026-08-15-ampere-console.md` in the engineering tree.)

Optional from PowerShell (confirms students cannot hit the public IP yet): TCP **22** open; **80 / 443 / 3000 / 18301 / 5000 / 8765** closed or filtered. `sshd` listening on `0.0.0.0:22` **inside** the VM is normal — the **VCN security list** is what must stay `/32`.

**Session A ends only when all of these are true:**

1. The four commands match (`aarch64`, `2`, ~12 GiB, 50-class boot \+ 150G empty).  
2. Ingress TCP 22 is your **`/32`**, screenshot saved (this tenancy still needs that edit).  
3. `Host ampere` is in `~\.ssh\config`.

![Security List with SSH Locked to /32 (PASS)](OCI%20SS/Screenshot%202026-08-28%20182052.png)

Do **not** run `mkfs`, `lxd init`, or `apt upgrade` until those three match. Formatting the **boot** disk by mistake wipes the OS.

## **10\. Sessions B–G in plain English (so you know what “next” means)**

You will do these with Manual chapters 01–08 in this folder. This section is only the **why**.

### **B — Disk \+ LXD (Task 2\)**

We format **only** the 150G disk as **btrfs** and tell LXD to put containers there. Ensure that LXD storage roots and any required container storage pools explicitly reference this mounted block volume rather than the root 50G boot volume.  
M4 stored containers in a **36 GiB file** on the OS disk and ran out of space (Keycloak died). Ampere must not repeat that.  
Pass: lxc storage info source is the 150G device.

### **C — Clone \+ networks (Tasks 3–4)**

/home/llms\_admin/cyberrange/        copy of kit `cyberrange/` (or product clone)  
/home/llms\_admin/cyberrange-data/   sqlite only (never inside git)

We pin the host bridge to 10.115.77.1. If Oracle’s VCN already owns that range (it should not if you followed §6.1), we pick another /24 and use it **everywhere**.

### **D — Bake images first (Task 5\)**

Goldens (kali / meta / dvwa) eat RAM while they build. We bake them **before** starting guacamole and Wazuh.  
Wazuh **vulnerability-detection** stays **off**. On M4 those feeds filled the disk (/var/ossec/tmp multi-GiB tarballs) and Keycloak returned **502**.

### **E — Gateway \+ API (Tasks 6–9)**

guacamole is just a **container name**. Students do not use Apache Guacamole desktop. Inside it: **nginx \+ Keycloak**.  
Wazuh is **manager-only** (no dashboard, no indexer). Those two extra pieces would steal the RAM we need for one student pod.

**Task 8 nginx (do this by hand, in this order):** after `apt install nginx` inside guacamole, the package starts nginx on **`0.0.0.0:80`** (Ubuntu welcome page). Put `deploy/guacamole/nginx-ampere.conf` in `sites-available/guacamole`, enable it, **delete** `sites-enabled/default`, `nginx -t`, then **`systemctl restart nginx`** (not `reload`, not `enable --now`). `ss` must show **`10.115.77.12:80` only**. If `http://10.115.77.12/` is a 615-byte welcome page and `/auth/` is nginx HTML 404, restart nginx — do **not** re-run the Keycloak realm script (that would create a new client secret). Then curl well-known; expect **200**.

### **F — Portal \+ one pod (Tasks 10–12)**

Build Next.js on **your Windows PC** (npm run build). Do **not** build on the 12 GiB VM while other services are up.  
Students will later open Cloudflare. For this session we prove the lab on the **private** path (10.115.77.1:3000 via SSH or nginx :80). One pod only (MAX\_PODS=1).

### **G — Cloudflare last (Tasks 13–14)**

**Click-by-click guide:** `Ampere Cloudflare Tunnel Guide for First-Time Operators.md`.

Tunnel origin \= **http://10.115.77.12:80 only**. Do **not** open Oracle 80/443. You create the named tunnel and paste the token; then tell the agent **only** the hostname. Then flip NEXTAUTH\_URL to https://\<tunnel\>/. Then probe from a network that is **not** the VM:  
https://\<tunnel\>/login                      → 200 or 302  
http://\<PUBLIC\_IP\>:80                       → timeout  
http://\<PUBLIC\_IP\>:18301                    → timeout  
http://\<PUBLIC\_IP\>:3000                     → timeout  
http://\<PUBLIC\_IP\>:5000                     → timeout

If any of the last four answer, we failed the security contract. Reboot must keep API, portal, bridge, and cloudflared up.

## **11\. What we copy from M4 vs what we leave behind**

M4 already proved the student path. Ampere is a **new** machine with the **same** code.

| Bring to Ampere | Leave on M4   |
| :---- | :---- |
| Capstone2 git tree (portal/, src/provisioning/, bridge-src/, deploy/) | Tailscale IP 100.83.29.13 |
| guest\_nic.py (Kali NIC up \+ default route) | next dev and \-H 0.0.0.0 as the student bind |
| dvwa\_compose.py / ready bake (MariaDB db) | Host publish of DVWA on :18301 |
| systemd units, but **paths** under \~/cyberrange/ | NEXTAUTH\_URL=http://100.83.29.13:3000 |
| PROFILE=oci\_12gib MAX\_PODS=1 RAM need **5632** | POD\_STORAGE\_MB=1024 (that was a tiny-pool hack) |
| Wazuh VD **disabled** | Live Wazuh feeds / tmp tarballs |
| Same-origin /lab/dvwa/ | M4 Keycloak cookie nosecure as the **student** HTTPS setting |

**Never** copy provision.py as a whole file over the Capstone2 copy (old “Issue 9” key-install bug). Copy helpers \+ a small hook only.  
On Ampere set POD\_STORAGE\_MB=7168 because the pool is **150 GiB**, not 36\.

## **12\. Pass / fail (do not call Ampere “student-ready” early)**

| Milestone | Pass   |
| :---- | :---- |
| Session A | Shape proof \+ 50/150 disks \+ **ingress TCP 22 from your `/32` only** (screenshot). Shape SSH succeeding while 22 is `0.0.0.0/0` is **not** a pass. |
| Before Cloudflare | One pod from the dashboard; Kali whoami \= student; DVWA /lab/dvwa/login.php is login, not setup.php; LXD still on 150G; Wazuh tmp has no multi-GiB tars |
| Student-ready | Session G internet probe **and** reboot persist recorded in evidence |

File-grade Scenario 09 can PASS without SIEM rows. Do **not** block cutover on Wazuh dashboard or detection\_score.

## **13\. If you get stuck**

| Symptom | What to do |
| :---- | :---- |
| Out of host capacity | Other AD or wait. Do not change shape. |
| SSH works but 22 source is `0.0.0.0/0` | **This tenancy.** Edit Default Security List → TCP 22 → your `/32`. Do not add port 80. Re-screenshot. |
| SSH timeout after a day | Your home IP changed. Edit security list 22 source to the new `/32`. |
| “Unauthorized” on SSH | Wrong user (try `ubuntu`) or wrong key. Add `IdentitiesOnly yes` to `Host ampere`. |
| Create instance wants a paid shape | You left the home region, or you picked 4/24, or A1 quota is already used. |
| `lsblk` boot is ~46–47G not 50G | **PASS.** Oracle default boot. Do not grow it. |
| Hostname is `cyberrange-vcn` / name is `instance-…` | Cosmetic. Do not recreate. |
| Only 50G in `lsblk` | Volume in a **different AD**, or attach never finished. |
| Console shows two Micro VMs you forgot | Terminate \+ delete boot volumes **before** creating Ampere. |
| Fear you are being billed | Limits page \+ Budgets. Shape must stay A1 Flex 2/12 in home region. |
| `/auth/` is nginx HTML **404**; `GET /` is 200 and ~615 bytes | nginx still holds inherited `0.0.0.0:80`. `systemctl restart nginx` inside guacamole. Confirm `ss` is `10.115.77.12:80` only. Do not re-seed the Keycloak realm. |

Do not invent a “working” public website by opening port 80\. That is a failed deploy even if the page loads.

## **14\. What you do right after this file**

Oracle account signup **and** VM create are **finished** on this tenancy. Do **not** launch another instance.

> 1. **Lock SSH (still open):** Default Security List → edit TCP **22** source from `0.0.0.0/0` to your current public IPv4 `/32` (check [https://api.ipify.org](https://api.ipify.org) first). Screenshot ingress. Save it under `docs/evidence/`.  
> 2. Add `Host ampere` to `~\.ssh\config` (snippet in §7) if it is missing.  
> 3. Tell the agent: **Session A `/32` done** (attach the new screenshot).  
> 4. Next session is **Session B / Deploy Task 2** as `llms_admin`: `mkfs.btrfs` **only** the 150G disk (`sdb` / `oraclevdb`), then LXD on **that** device — still **no** Cloudflare, still **no** port 80.

If you are a **future** operator recreating from scratch, start at Session A0 instead, and treat the 2026-08-28 table as an example — not a second VM to create.