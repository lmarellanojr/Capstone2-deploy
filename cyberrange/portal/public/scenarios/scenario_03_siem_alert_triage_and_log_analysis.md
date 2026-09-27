## Scenario 3 — SIEM Alert Triage

> **Network:** Generate traffic from Kali `$TARGET_KALI` toward meta `$TARGET_META` (and optionally DVWA). SIEM manager: `10.0.40.10` (shared). Your agents are named like `pod-<you>-meta` and `pod-<you>-dvwa`.

**Difficulty:** Intermediate  
**Estimated time:** 45–60 minutes  
**Role:** Defender (SOC analyst)  
**Tools:** Kali (noise), portal **meta** tab (write triage files), **Open SIEM** in-portal alert table (Wazuh events, live when agents exist)

### Learning outcomes

- Generate realistic noisy events that Wazuh can detect  
- Classify true positives vs noise  
- Reconstruct a short attack timeline  
- Write a concise incident summary for a supervisor  

### How this lab works (no instructor preload)

You create your own alert activity, then triage it. There is **no** required instructor “30-alert dump.”

1. **Kali tab** — run the noise steps below.  
2. **Open SIEM** — in-portal table showing live Wazuh events. It refreshes itself every 15 seconds (paused while the browser tab is hidden); **Refresh** fetches immediately. After Task 0, alerts usually appear within 1–2 minutes. The table displays real events from Wazuh **grouped by rule** (Count, Last seen, Rule, Agent, Lvl, Description). Click a group to expand events; click an expanded row to copy its timestamp and rule ID. Use the **rule**, **agent** and **severity** filters to narrow the table; **Clear filters** returns to all rows.  
   The lab runs Wazuh in **manager-only** mode: there is no Wazuh Dashboard or Indexer on the 12 GiB host, so this table is the SIEM view.  
   Rule **5710** (failed SSH login) is optional. CIS/SCA rows (agent config scans: 19007, 19008, 19004) appear as noise. **Rule 510** (rootcheck, often LXD hidden files) may fire automatically. Rule **1007** (filesystem full) is API-hidden and won’t clutter the window.  
   The table only shows alerts from **your current pod** (nothing from before it was created, even if you had an earlier pod).  
   If alerts don’t appear or the manager is unavailable, triage from meta’s own SSH log instead (see the hint under Task 0). The template files below are a starting point only: scoring checks that you replaced the placeholders with times and rule IDs from **your** run.  
3. **Meta tab** — write the scored artifact files (paths below). Scoring runs **on meta**.

---

### Task 0 — Generate detection noise (do this first)

On **Kali**:

```bash
ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 nosuchuser@$TARGET_META exit 2>/dev/null || true
```

> If pasting this inserts a literal `^[[200~` in front of the command (or the command otherwise fails to run), run this **once** in the Kali terminal, then paste again — or just type the line by hand:
> ```bash
> bind 'set enable-bracketed-paste off'
> ```
> Prefer the code block's **Copy** button over hand-selecting the text above, so you get the exact command even if it wraps on screen.

Then, light recon noise (separate block, does **not** trigger the primary 5710 signal by itself):

```bash
nmap -sn $TARGET_META
nmap -F $TARGET_META
```

Click **Open SIEM**. New alerts appear within about 15 seconds of reaching the manager (usually 1–2 minutes after the command). 

The table is **grouped by rule** (count + last seen). **5710** (failed SSH) should appear and is your primary signal. CIS Ubuntu / SCA scans (rules 19007, 19008, 19004) appear as noise; **Rule 510** (rootcheck) may also fire. Click a group to expand events. Click an expanded row to copy timestamp + rule ID. **Raw events** shows the flat log view. Set the agent filter to your `pod-<you>-meta` agent to separate your events. If 5710 is missing, re-run the SSH command and wait 1–2 minutes. nmap (`-sn` or `-F`) usually does **not** create a Wazuh detection row.

<details>
<summary>Hint</summary>

If the table is empty or says "Manager unavailable," read the failed SSH attempts straight from meta's log and use those times in Tasks 1–3 (5710 is Wazuh's rule for these lines):

```bash
# On meta
sudo grep "Invalid user" /var/log/auth.log | tail -5
# If auth.log is missing:
sudo journalctl -u ssh --since "1 hour ago" | grep "Invalid user" | tail -5
```

Copying a template without changing it does **not** pass: fill it in with what you found.

</details>

---

### Task 1 — Access / start triage (Milestone 1)

**Goal:** Produce a machine-readable triage starter file **on meta**.

1. Open the portal **Target: meta** tab.  
2. Create `/home/msfadmin/alert_triage.json` (or `/tmp/alert_triage.json`):

```bash
cat > /home/msfadmin/alert_triage.json << 'EOF'
{
  "alert_id": "example-1",
  "severity": "medium",
  "rule": "5710",
  "description": "sshd: attempt to login using a non-existent user",
  "agent": "pod-STUDENT-meta",
  "classification": "needs_investigation",
  "notes": "Replace fields with what you see in Wazuh after Task 0"
}
EOF
```

Edit the file with real values when you have them (`nano` / `vi`). In the **Open SIEM** table, click a row to copy its timestamp and rule ID as a toast notification; paste them into your triage file.

**Manual Check** on Access Wazuh Dashboard / triage start.

---

### Task 2 — True positives & timeline (Milestone 2)

**Goal:** Classify at least a few events and order them in time.

Replace every `HH:MM` with the real time from the SIEM table (or `auth.log`), and delete lines for events you didn't see. To pass, at least one line needs a **rule ID** and a **real time** (e.g. `rule: 5710 — time: 14:32`). The template as written does **not** pass.

On **meta**, create a timeline:

```bash
cat > /home/msfadmin/incident_timeline.md << 'EOF'
# Incident timeline
1. phase: recon — rule: (nmap/scan if seen) — time: HH:MM
2. phase: initial_access_attempt — rule: 5710 — time: HH:MM — true_positive
3. phase: (add more if present)
EOF
```

You may also mark classifications inside `alert_triage.json` using words like `true_positive` or `TP`. This only counts once the Task 1 placeholders (`example-1`, `pod-STUDENT-meta`, the "Replace fields…" note) are replaced with your own values.

**Manual Check** on True Positive Classification / timeline.

<details>
<summary>Hint</summary>

Look for failed SSH (unknown user), port scans, and web noise if you also hit DVWA. Benign package updates (if any) are false positives.

</details>

---

### Task 3 — Incident summary (Milestone 3)

**Goal:** Write a short supervisor-ready report **on meta** (>200 characters, include action words).

```bash
cat > /home/msfadmin/incident_report.txt << 'EOF'
Incident summary
================
What happened:
  (plain language — e.g. failed SSH and recon against our meta host)

Systems affected:
  (agent / host names)

Attacker apparent objective:
  (recon / credential attack / …)

Evidence:
  - rule IDs and timestamps

Recommended actions:
  - (block source, rotate creds, tune rules, …)
EOF
```

Expand each section until the file is clearly longer than a tweet.  
**Manual Check** on Attack Timeline / incident summary milestone as labeled in the portal.

---

### Artifact checklist (scoring)

| File (on **meta**) | Used for |
|---|---|
| `/home/msfadmin/alert_triage.json` or `/tmp/alert_triage.json` | Milestone 1 (+ helps M2) |
| `/home/msfadmin/incident_timeline.md` or `/tmp/…` | Milestone 2 |
| `/home/msfadmin/incident_report.txt` or `/tmp/…` | Milestone 3 |

### Common failures

| Symptom | Fix |
|---|---|
| Manual Check FAIL | Files written on **Kali** — move them to **meta** |
| Empty SIEM table (no 5710) | Re-run Task 0 SSH; wait 1–2 min (the table auto-refreshes every 15s). If it says "No alerts match …", click **Clear filters**. If still empty, take the times from `sudo grep "Invalid user" /var/log/auth.log` on meta. Unedited templates do **not** pass. CIS/SCA and Rule 510 may appear alongside 5710. |
| Milestone 2 FAIL with a timeline file | At least one line needs a rule ID and a real time (`rule: 5710 — time: 14:32`); `HH:MM` left in means the template wasn't filled in. |
| Seeing many CIS/SCA rows (19007, 19008, 19004) | These are agent config scans (noise to classify). Focus on **5710** (failed SSH) or **510** (rootcheck) as true positives. |
| nmap is not creating alerts | Correct—nmap `-sn` / `-F` usually does **not** create Wazuh rows. It is not a primary detection signal. |
| Shared SIEM (multi-student) | Only trust agents named with **your** student/pod id (e.g., `pod-alice-meta`). Manager IP is `10.0.40.10`. |
| Kali tab disconnects / intermittent "Session Expired" during this lab (~20–30 min in) | Known issue, cause not yet confirmed — tracked in [REG-01 #39](https://github.com/lmarellanojr/Capstone2-deploy/issues/39). Reload the Kali tab (or the page) and re-authenticate; your triage files on **meta** are not affected. |

### Reflection (optional)

- How did you tell a true positive failed login from benign admin activity?  
- What was your time to first alert after Task 0? Did you see **5710** (failed SSH)? Or **510** (rootcheck)? Or only CIS/SCA (19007/19008/19004) config scans? (Typical: CIS/SCA appear immediately; failed SSH takes 1–2 minutes. Or: “triaged from auth.log.”)  
- Which rows were noise and why? (CIS Ubuntu / SCA = agent config scans; rootcheck = legitimate system checks. Failed SSH = true positive recon signal.)
