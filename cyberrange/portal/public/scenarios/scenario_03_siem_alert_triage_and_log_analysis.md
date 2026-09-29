## Scenario 3 — SIEM Alert Triage & Log Analysis

> **Network:** Generate traffic from Kali `$TARGET_KALI` toward meta `$TARGET_META`. SIEM manager: `10.0.40.10` (shared). Agents look like `pod-<you>-meta`. Write triage files on the **Target: meta** tab.

A guided, beginner walkthrough — this time you're the **defender**. You'll create some suspicious activity, watch it light up the SIEM, tell the real threats from the noise, and write the report a supervisor would act on. Read each _“What you're doing & why”_ box as you go.

Medium Defensive 45–60 min · MITRE T1595 · Defender (SOC analyst) · 3 milestones

## 0. Before you start — the big picture

The first scenarios were the _attacker's_ view. This one is the **blue team's** view of the same kind of activity: an analyst watching alerts roll in and deciding what matters.

You work across three portal tabs: **Kali** (to generate activity), **Open SIEM** (the Wazuh alert table), and **Target: meta** (where you write your triage files). Everything runs inside your own **isolated pod**.

## 1. The pieces you'll use

### Wazuh — the SIEM

A **SIEM** (Security Information and Event Management) collects logs from many machines and raises an **alert** when something matches a detection rule. Here it's **Wazuh**. The portal's **Open SIEM** button shows a live alert table (grouped by rule: Count, Last seen, Rule, Agent, Level, Description). It auto-refreshes every ~15 seconds.

### Kali & meta

**Kali** is where you generate the suspicious activity (a failed SSH login, a scan). **meta** is the monitored target — and, importantly, the place you **write your triage files**. Your Wazuh agents are named like `pod-<you>-meta`.

The #1 thing to get right Scoring reads three files **on the meta host** , not on Kali. Generate noise on Kali, but **write your triage files on the meta tab**. Files created on Kali will not score. 

# | Milestone | What you produce (on meta)  
--- | --- | ---  
**Task 1** |  Triage start | `alert_triage.json` — a structured record of an alert  
**Task 2** |  True-positive classification / timeline | `incident_timeline.md` — events in order  
**Task 3** |  Incident summary | `incident_report.txt` — the supervisor report  
  
## 2. How scoring works

Unlike the attack scenarios, there's nothing to “exploit.” You demonstrate analyst skill by producing three **artifact files on meta**. The checker reads those files; then you click **Manual Check** for each milestone.

Templates always work If the SIEM table is empty or the manager is busy, you can still finish. Each file below has a ready template — fill it with the best values you can see (or the example values) and it still scores. Getting real values from Wazuh makes it a better exercise, not a scoring requirement. 

## 3. Set up your lab

  1. Provision the **SIEM Alert Triage** lab and wait for the pod to go **ACTIVE**.
  2. Open three tabs: **Kali Linux (CLI)** , **Target: meta (lab)** , and **Open SIEM**.
  3. In the SIEM table, set the **agent filter** to your own `pod-<you>-meta` so you only see your events.

## 4. Do the tasks

Task 0not scored · do this first

### Task 0 — generate the alerts

**Goal:** create the activity you'll triage.

> **What you're doing & why:** Before you can triage alerts, there have to be some. A failed SSH login as a non-existent user is a classic detection (Wazuh rule **5710**). You'll add a little scan noise too, so you have both “signal” and “noise” to sort later. 
```bash
# Failed / unknown-user SSH login → Wazuh rule 5710
ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 nosuchuser@$TARGET_META exit

# Light recon noise
nmap -sn $TARGET_META
nmap -F $TARGET_META
```

Open **SIEM** and wait ~1–2 minutes. Look for rule **5710** (failed SSH) — that's your primary signal. If it's missing, re-run the SSH line and wait.

What's signal vs noise here **5710** (failed SSH) and **510** (rootcheck) are the interesting rows. CIS/SCA rows (**19007, 19008, 19004**) are routine config scans — noise. `nmap` usually creates _no_ Wazuh row at all. 

**Task 1 — Triage start**

### Task 1 — open a triage record

**Goal:** write a structured record of one alert, on meta.

> **What you're doing & why:** Analysts don't triage in their heads — they capture each alert in a structured form (id, severity, rule, classification) so it can be tracked and handed off. You're creating that first record as JSON. 

#### On the **meta** tab:
```bash
cat > /home/msfadmin/alert_triage.json << 'EOF'
{
  "alert_id": "example-1",
  "severity": "medium",
  "rule": "5710",
  "description": "sshd: attempt to login using a non-existent user",
  "agent": "pod-STUDENT-meta",
  "classification": "needs_investigation",
  "notes": "Replace with the real values you see in Wazuh"
}
EOF
```

Make it real In the SIEM table, click a row to copy its timestamp and rule ID (a toast pops up), then edit the file (`nano` / `vi`) to match what you actually saw. 

**Done when:** `alert_triage.json` exists on meta with sensible values.

**Then:** Portal → Tasks → **Manual Check** on the triage-start milestone.

What you can do with this This JSON is the seed of a **case file**. As you triage more events you append records; a real SOC feeds these into a ticketing system so nothing is lost and the next analyst can pick up where you left off. 

**Task 2 — True positives & timeline**

### Task 2 — build the timeline

**Goal:** classify a few events and put them in order.

> **What you're doing & why:** A list of alerts isn't a story. Ordering them by time turns scattered events into an **attack narrative** (recon → login attempt → …) and lets you label which are real threats (true positives) versus routine noise (false positives). 

#### On the **meta** tab:
```bash
cat > /home/msfadmin/incident_timeline.md << 'EOF'
# Incident timeline
1. phase: recon — rule: (scan if seen) — time: HH:MM
2. phase: initial_access_attempt — rule: 5710 — time: HH:MM — true_positive
3. phase: (add more if present)
EOF
```

**Done when:** `incident_timeline.md` exists on meta with at least one classified, time-ordered event.

**Then:** **Manual Check** on the timeline milestone.

What you can do with this A timeline is what responders use to judge **scope** and decide what to contain first. It also becomes the backbone of the report in Task 3 — you're already halfway to the deliverable. 

**Task 3 — Incident summary**

### Task 3 — write the incident report

**Goal:** a short supervisor-ready summary on meta (make it clearly longer than a tweet — 200+ characters).

> **What you're doing & why:** Detection only matters if someone acts on it. The report translates your triage into decisions: what happened, what's affected, and what to do next. Use action words (block, rotate, isolate, tune). 

#### On the **meta** tab:
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

**Done when:** `incident_report.txt` exists on meta, filled out and 200+ characters.

**Then:** **Manual Check** on the incident-summary milestone.

What you can do with this This is the deliverable that drives the response — who to notify, what to block, which credentials to rotate. In a real SOC it's attached to the ticket and read by an on-call lead, so clarity beats length. 

**Scenario complete** when all three milestones pass — you generated, triaged, and reported an incident end to end. 

---
## 5. SOC playground (explore — not scored)

Once your three milestones are green, try these to build real analyst instincts. Safe here — it's your isolated pod.

Try this | What it teaches  
--- | ---  
Set the **agent** filter to your `pod-<you>-meta` | Separating your events from a shared manager's — the first skill in a busy SOC.  
Click a rule group to **expand** , then a row to copy its timestamp + rule ID | Pivoting from a summary count to the individual events behind it.  
Open **Raw events** for a 5710 row | Reading the underlying log line — the ground truth behind a rule.  
Re-run the failed SSH a few times, then watch the **Count** climb | Spotting brute-force patterns by volume, not single events.  
Also hit DVWA from Kali (curl the SQLi/XSS pages) and look for web rows | How different attacks produce different detections (or none).  
Compare **5710/510** against **19007/19008/19004** |  Telling true positives from routine CIS/SCA config-scan noise.  
Note your **time-to-first-alert** after Task 0 | A real SOC metric — how fast detection actually is.  
  
---
## 6. Common problems & fixes

Problem | Fix  
--- | ---  
Manual Check FAIL | Your files are on **Kali** — re-create them on the **meta** tab. Scoring runs on meta.  
SIEM table empty / no 5710 | Re-run the Task 0 SSH line and wait 1–2 min (auto-refreshes every 15s). If it says “No alerts match,” click **Clear filters**. 5710 is optional — use the templates and you still pass.  
Lots of 19007 / 19008 / 19004 rows | Those are CIS/SCA config scans — classify them as **noise**. Focus on 5710 (failed SSH) or 510 (rootcheck).  
nmap made no alert | Correct — `nmap -sn`/`-F` usually creates no Wazuh row. It's not a primary signal.  
Shared SIEM, many agents | Only trust rows for **your** `pod-<you>-meta` agent. Manager is `10.0.40.10`.  
MMDC Cyber Range · Scenario 3 student guide · for use only inside your assigned lab pod.
