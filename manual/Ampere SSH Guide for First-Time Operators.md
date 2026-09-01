# **Ampere SSH Guide for First-Time Operators**

**Audience:** You have never SSHed to the Ampere VM from Windows, or you did once and forgot how.  
**Job of this file:** Get you a working `ssh ampere` as **`llms_admin`**, using the existing key, without opening extra Oracle ports and without regenerating the key that is already on the VM.  
**Not this file:** Creating the VM (that is `M4 to Ampere Guide for First-Time OCI.md`). Student website login (that is the Cloudflare guide). Agent checkbox commands.

| Role | Path |
| :---- | :---- |
| This guide (human, SSH) | `Ampere SSH Guide for First-Time Operators.md` (this file) |
| Creating the VM | `M4 to Ampere Guide for First-Time OCI.md` |
| Student website | `Ampere Cloudflare Tunnel Guide for First-Time Operators.md` |
| Host user + disk | Manual `01-oci-host-and-network.md` |

SSH is **your** admin pipe. Students never SSH. They open **`https://<TUNNEL_HOST>/login`**. Do **not** open Oracle port 22 to `0.0.0.0/0` “so SSH is easier.”

## **Which VM are you SSHing to?**

- **Proof host:** values in `private/OPERATOR-RECORD.local.md`. Do not terminate it. Do not create a second Always Free VM **in that tenancy**.
- **New host (second-host run):** use the public IP Oracle showed at create. Write it in `.local`. Do **not** reuse another host’s `HostName`.

Do **not** run `ssh-keygen` again for `id_oci_arm64` if that file already exists and is on the VM.

| Field | What you type |
| :---- | :---- |
| Public IPv4 | **`<PUBLIC_IP>`** (SSH only) — from Console or `.local` |
| VCN private IPv4 | `<VCN_PRIVATE_IP>` (Oracle VCN — not the lab) |
| SSH alias | **`ampere`** |
| User **now** | **`llms_admin`** (`sudo` + `lxd`) |
| User **first day** | `ubuntu` (`Host ampere-ubuntu`) |
| Private key on your PC | `C:\Users\<you>\.ssh\id_oci_arm64` (**no** `.pub`) |
| Public key (safe to look at) | `C:\Users\<you>\.ssh\id_oci_arm64.pub` (one `ssh-ed25519` line) |
| Config file | `C:\Users\<you>\.ssh\config` |

**Daily command after this file:** PowerShell → `ssh ampere` → prompt `llms_admin@<hostname>`.

## **0\. Picture in your head**

```text
  Your Windows PC
        │  ssh ampere
        │  key:  ~\.ssh\id_oci_arm64
        │  user: llms_admin
        ▼
  Oracle public IP  <PUBLIC_IP>  TCP 22
        │  VCN security list: YOUR home IP /32 only
        ▼
  Ubuntu on Ampere
        ├── /home/llms_admin/cyberrange/       code
        ├── /home/llms_admin/cyberrange-data/  secrets + sqlite
        └── lxdbr0  10.115.77.0/24             lab (not reachable from Chrome on your PC)
```

Two different “logins”:

| Who | How they connect | Not this |
| :---- | :---- | :---- |
| **You (admin)** | `ssh ampere` | Not the student website |
| **Students** | `https://<TUNNEL_HOST>/login` as Keycloak user `student` | Not SSH |

`http://10.115.77.12` from Chrome **times out**. That is expected. SSH does not fix that; Cloudflare does.

## **1\. Words you will see**

| Word | Plain meaning |
| :---- | :---- |
| **SSH** | Encrypted remote terminal. You type Linux commands on Ampere from PowerShell. |
| **Public IP** | `<PUBLIC_IP>`. Only you should reach port 22 on it. |
| **Private key** | `id_oci_arm64` with **no** `.pub`. This is the password. Never email, never Discord, never git, never a screenshot. |
| **Public key** | `id_oci_arm64.pub`. Safe to paste into Oracle Console. Starts with `ssh-ed25519 AAAA…`. |
| **`Host ampere`** | A nickname in `~\.ssh\config` so you type `ssh ampere` instead of a long command. |
| **`IdentitiesOnly yes`** | Windows otherwise offers *every* key in `.ssh` and Oracle says “Permission denied.” |
| **Fingerprint / host key** | First connect asks “Are you sure you want to continue connecting?” Type `yes` once. Windows stores it in `~\.ssh\known_hosts`. |
| **`ubuntu` vs `llms_admin`** | Oracle image default vs the operator user we created in Task 2. Day-to-day = **`llms_admin`**. |
| **Security list `/32`** | Cloud firewall: only *your* public IP may hit port 22. If your home IP changes, SSH times out until you edit the rule. |
| **M4 / `arm64server`** | The dress-rehearsal laptop. Different machine. Do not mix its SSH host with Ampere. |

## **2\. What you must not do**

| Tempting click | Why not |
| :---- | :---- |
| `ssh-keygen` again for `id_oci_arm64` | Overwrites the private key. The VM still has the **old** public key. You lock yourself out. |
| Email / chat / git the file **without** `.pub` | That is the private key. Rotate if you did. |
| Oracle Security List **TCP 22 from `0.0.0.0/0`** | Whole internet can guess SSH. Edit to your `/32`. |
| Open Oracle **80 / 443** “so I can test in Chrome” | Failed deploy. Students use Cloudflare. |
| Login as **`root`** or **`oracle`** | Wrong user. Use `llms_admin` (or `ubuntu` only if `llms_admin` is missing). |
| PuTTY `.ppk` as a second source of truth | Optional converter only. This project uses **OpenSSH** (`ssh.exe` in PowerShell). |
| Notepad saving `config.txt` | SSH ignores it. The file must be named **`config`** with no extension. |
| `ssh ubuntu@10.115.77.12` from your PC | That IP is inside the VM. Timeout is expected. |

## **3\. Check Windows can SSH**

Open **PowerShell** (not Command Prompt).

```powershell
ssh -V
```

You want a line like `OpenSSH_for_Windows_…`.  

If Windows says `ssh` is not recognized:

1. **Settings** → **Apps** → **Optional features** → **OpenSSH Client** → Install.  
2. Or: **Settings** → **System** → **Optional features** → Add **OpenSSH Client**.  
3. Close PowerShell and open a **new** window. Run `ssh -V` again.

You do **not** need OpenSSH **Server** on your PC. You do **not** need `cloudflared.exe` for SSH.

## **4\. Confirm the key already exists (do not regenerate)**

```powershell
Get-ChildItem $env:USERPROFILE\.ssh\id_oci_arm64*
Get-Content $env:USERPROFILE\.ssh\id_oci_arm64.pub
```

**Pass:** two files (`id_oci_arm64` and `id_oci_arm64.pub`) and one line starting `ssh-ed25519`.

| What you see | What to do |
| :---- | :---- |
| Both files exist | **Stop.** Use them. Do not `ssh-keygen`. |
| Only `.pub` exists | The private key is missing. Do not invent a new pair until you have recovered a backup. Tell the agent. |
| Neither file exists **and** the VM is already Running | The key lives on the PC that created the VM. Copy `id_oci_arm64` from that PC (USB / password manager), or add a **new** public key in Oracle Console **and** in `~/.ssh/authorized_keys` for `llms_admin`. Do not overwrite a working PC’s key. |
| You have not created the VM yet | Follow Session A0 in `M4 to Ampere Guide for First-Time OCI.md` (`ssh-keygen -t ed25519 … id_oci_arm64`). |

Windows sometimes warns the key is too open. Fix **only** the private file:

```powershell
icacls $env:USERPROFILE\.ssh\id_oci_arm64 /inheritance:r
icacls $env:USERPROFILE\.ssh\id_oci_arm64 /grant:r "$env:USERNAME:(R)"
```

Do **not** run that on the `.pub` file as a substitute for having the private key.

## **5\. Create `Host ampere` (the only config you need daily)**

The file is:

```text
C:\Users\<your-Windows-username>\.ssh\config
```

If `.ssh` does not exist:

```powershell
New-Item -ItemType Directory -Force -Path $env:USERPROFILE\.ssh | Out-Null
```

Open the config in Notepad **from PowerShell** so you do not accidentally create `config.txt`:

```powershell
notepad $env:USERPROFILE\.ssh\config
```

Paste **exactly** (this tenancy). `IdentitiesOnly yes` is required on Windows:

```text
Host ampere
    HostName <PUBLIC_IP>
    User llms_admin
    IdentityFile ~/.ssh/id_oci_arm64
    IdentitiesOnly yes

Host ampere-ubuntu
    HostName <PUBLIC_IP>
    User ubuntu
    IdentityFile ~/.ssh/id_oci_arm64
    IdentitiesOnly yes
```

Save. Close Notepad.

Check Windows did not add `.txt`:

```powershell
Get-ChildItem $env:USERPROFILE\.ssh\config*
```

You want **`config`**, not `config.txt`. If you see `config.txt`, rename it:

```powershell
Rename-Item $env:USERPROFILE\.ssh\config.txt config
```

**Why two Hosts:** daily work is `ssh ampere` (`llms_admin`). `ssh ampere-ubuntu` is the emergency first-day user if `llms_admin` is broken.

## **6\. Connect (first time and every time after)**

In PowerShell:

```powershell
ssh ampere
```

**First time only**, you will see something like:

```text
The authenticity of host '<PUBLIC_IP> (<PUBLIC_IP>)' can't be established.
ED25519 key fingerprint is SHA256:....
Are you sure you want to continue connecting (yes/no/[fingerprint])?
```

Type **`yes`** and Enter. Not `y`. Not clicking — type the word.

Then you should see a Ubuntu MOTD and a prompt:

```text
llms_admin@cyberrange-vcn:~$
```

Prove it:

```bash
whoami          # llms_admin
hostname        # cyberrange-vcn
uname -m        # aarch64
pwd             # /home/llms_admin
```

Leave with:

```bash
exit
```

You are back in PowerShell when the prompt looks like `PS C:\...>`.

### **Long form (if config is missing)**

```powershell
ssh -i $env:USERPROFILE\.ssh\id_oci_arm64 -o IdentitiesOnly=yes llms_admin@<PUBLIC_IP>
```

Same key, same user, same IP. Prefer the alias.

## **7\. What “in” looks like (so you know you are not on M4)**

On Ampere, `hostname` is whatever Oracle set (often the VCN name). Public IP in Oracle is **`<PUBLIC_IP>`**.

| Prompt / fact | You are on |
| :---- | :---- |
| `llms_admin@cyberrange-vcn` | **Ampere** — correct |
| `ubuntu@cyberrange-vcn` | Ampere, but old user. `exit` and `ssh ampere` (not `ampere-ubuntu`) for daily work |
| `llms_admin@arm64server` or Tailscale `100.83.29.13` | **M4** — wrong machine for Ampere tasks |

Optional: `sudo -n true && echo sudo_ok` should print `sudo_ok` (`llms_admin` has NOPASSWD sudo).

## **8\. Copy a file from your PC to Ampere (later)**

Stay in **PowerShell on your PC** (not already inside `ssh ampere`):

```powershell
scp -o IdentitiesOnly=yes some-local-file.md ampere:~/
```

With `Host ampere` set, `scp` uses the same user and key. Destination `ampere:~/` is `/home/llms_admin/`.

Do **not** `scp` secrets into git. Do **not** paste the tunnel token or `student.env` into chat.

## **9\. If you get stuck**

| Symptom | What it actually means | What to do |
| :---- | :---- | :---- |
| `ssh: connect to host <PUBLIC_IP> port 22: Connection timed out` | Packets never arrive. Usually **wrong IP**, VM **Stopped**, or **security list** does not include **your current** public IP. | Oracle Console: instance **Running**? Public IP still `<PUBLIC_IP>`? Open [https://api.ipify.org](https://api.ipify.org), then Default Security List **ingress TCP 22** source = that address `/32`. Home IPs change. |
| `Permission denied (publickey)` | Oracle did not accept the key **or** the **user**. | `IdentitiesOnly yes`. User **`llms_admin`**. Key is `id_oci_arm64` **without** `.pub`. Try `ssh ampere-ubuntu`. Do not regenerate the key. |
| `Could not resolve hostname ampere` | No `Host ampere` block, or you typed it in Command Prompt with a broken config path. | §5. File named `config`, not `config.txt`. |
| `WARNING: UNPROTECTED PRIVATE KEY FILE` | Windows ACLs too open. | `icacls` commands in §4. |
| Asks for a **password** | It is not using the key. | `-i` / `IdentityFile` + `IdentitiesOnly yes`. Ampere is **key-only**. There is no `llms_admin` password for SSH. |
| `Are you sure…` every time | `known_hosts` not saved, or IP changed. | Type `yes` once. If the IP **changed** in Console, update `HostName` and ask the agent before wiping `known_hosts`. |
| Host key **changed** warning | Different machine at that IP, or VM was recreated. | Stop. Do not type `yes` until you confirm in Oracle Console that this is still the same Ampere. |
| Timeout from a **café / phone hotspot** | Your public IP is not the `/32` in the security list. | Either add a temporary `/32` for *this* network (then delete it) or wait until you are on the home IP. Do **not** set `0.0.0.0/0`. |
| `ssh ubuntu@10.115.77.12` from Chrome or PC | Lab address, not public SSH. | Use `<PUBLIC_IP>` / `ssh ampere`. |
| You opened TCP 22 to the world | Failed security contract. | Edit the security-list row back to your `/32`. Screenshot ingress. |
| PowerShell ate `$env:USERPROFILE` | You ran the line in **bash on Ampere**, or in a tool that expands `$`. | Run those snippets in **Windows PowerShell**. |

### **Timeout playbook (do in this order)**

1. Browser: [https://cloud.oracle.com](https://cloud.oracle.com) → Compute → Instances → **your** VM is **Running**.  
2. Networking tab public IP is still **`<PUBLIC_IP>`**. If Oracle gave a new IP, edit `HostName` in `~\.ssh\config`.  
3. Browser: [https://api.ipify.org](https://api.ipify.org) — that is **your** IP right now.  
4. VCN → Security Lists → Default → Ingress → TCP **22** source must be `YOUR.IP/32`.  
5. Only then retry `ssh ampere`.

Locked out from every network: use **Oracle Cloud Shell** in the Console (not this guide’s daily path) to confirm `sshd` is up, then fix the security list. Still do not open 22 to the world.

## **10\. Commands you will use every session**

On your PC:

```powershell
ssh ampere
```

Already inside Ampere, useful checks (do not invent PASS from memory):

```bash
whoami
hostname
systemctl --user status cyberrange-provision-api cyberrange-portal cyberrange-ssh-bridge --no-pager
sudo systemctl status cloudflared --no-pager
```

Leave:

```bash
exit
```

## **11\. What you do next**

1. `ssh ampere` → prompt `llms_admin@cyberrange-vcn`.  
2. Student website is **not** SSH: `https://<TUNNEL_HOST>/login`.  
3. If SSH works and the website does not, that is Cloudflare / DNS / CSS — not a new Oracle port.

Oracle firewall stays **SSH-only**. The website is Cloudflare, not `http://<PUBLIC_IP>`.
