## Scenario 3: SIEM Alert Triage & Log Analysis

> **Network:** Generate activity from Kali `$TARGET_KALI` toward meta `$TARGET_META`. Save all three files on **Target: meta (lab)**.

Defensive · 3 scored tasks · 225 points · required preparation is not scored.

## 0. Before you start: the big picture

Follow **Kali Linux (CLI): generate activity → Open SIEM: inspect alerts → Target: meta (lab): save findings**. No earlier scenario is required.

A **SIEM** (Security Information and Event Management) collects security logs and highlights events matching detection rules. Here it is **Wazuh**. An **alert** is a recorded detection, not proof of successful access. An **agent** sends logs from a monitored host to Wazuh. **Triage** means examining evidence and deciding what needs investigation or response.

You will generate a failed login as a nonexistent SSH user, record the alert, build a timeline, and write a report. An accurately detected failed login is a **true positive** for that detection; it does not establish compromise. Routine configuration findings may also be accurate, even when unrelated to this attempt.

## 1. The tools and files you'll use

Select **Open SIEM**, then filter **Agent** to your own meta host, named like `pod-…-meta`. The table shows **Count**, **Last seen**, **Rule**, **Agent**, **Level**, and **Description**. Expand a rule group to inspect individual events. Use an individual timestamp rather than assigning the group's last time to every event. The table refreshes every 15 seconds.

Save files on **Target: meta (lab)** as `msfadmin`. **JSON** is structured text with named fields and values; **Markdown** is text with simple formatting such as headings and lists.

| Task | File on meta | Points |
| --- | --- | --- |
| 1: Open a triage record | `/home/msfadmin/alert_triage.json` | 50 |
| 2: Build the timeline | `/home/msfadmin/incident_timeline.md` | 100 |
| 3: Write the incident report | `/home/msfadmin/incident_report.txt` | 75 |

## 2. How scoring works

Files on meta score automatically; there is no flag submission. A score confirms a limited check, so still review your evidence.

- Task 1 looks for `alert_id`, `severity`, or `rule` in the triage file. It does not validate JSON syntax, require all fields, or enforce severity/classification enums. Complete all fields accurately for the exercise.
- Task 2 looks for a rule ID and clock time on the same line, matching a genuine invalid-user SSH event in meta's authentication log. The checker allows five minutes of tolerance and whole-hour timezone differences by comparing minutes past the hour. Use the actual timestamp and state its timezone; do not invent a time to satisfy this limited check.
- Task 3 requires **more than 200 bytes**, plus at least one of `system`, `attack`, `alert`, or `recommend` (case-insensitive). More than 200 English characters satisfies the size threshold. Response actions are choices justified by evidence, not mandatory keywords.

## 3. Set up your lab

1. Start **SIEM Alert Triage** and wait for **ACTIVE**.
2. Select **Kali Linux (CLI)**. Use **Open SIEM** for alerts and **Target: meta (lab)** for files.
3. Select your meta **Agent** in the SIEM. Do not use another learner's events.

## 4. Do the tasks

### Task 0: Start here: Generate practice alerts

**Goal:** create a failed SSH login that you can investigate.

**Where to work:** **Kali Linux (CLI)**, then **Open SIEM**. Preparation is required but not scored.

1. In the Kali shell, run:

```bash
ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 nosuchuser@$TARGET_META exit
```

2. If asked for a password, type a deliberately incorrect practice value such as `not-a-real-password` and press Enter. Nothing appears as you type. Do not enter a personal password. If asked again, press **Ctrl+C**; you are generating an invalid-user attempt, not trying to log in successfully.
3. Select **Open SIEM**, your meta **Agent**, and **Rule 5710 only**. If no row appears, check again after a minute or two. This is a troubleshooting interval, not a guaranteed delivery time.
4. Expand the rule group and record an individual event's timestamp, rule, agent, level, and description. Clicking an event copies its timestamp and rule ID.

**Expected result:** the SSH login is denied; rule `5710` describes an attempt to log in using a nonexistent user. Connection refused or a timeout is a connectivity problem, not the required authentication evidence.

**Done when:** you have an observed invalid-user event for your own meta host and its real timestamp. Continue to Task 1; preparation has no points.

> **Troubleshooting:** Confirm **ACTIVE**, the assigned meta address, and your filters. Use **Clear filters** if needed, then select your agent again. On the meta shell, `sudo grep "Invalid user" /var/log/auth.log` can show the underlying event. Use your attempt's line, not a planted `flag-m1-…` line. Current provisioning grants passwordless sudo; if it unexpectedly asks for a password, ask your instructor to check the lab access configuration.

**Optional scan activity — Kali shell:** these scans are not required for the primary alert. Nmap often creates no Wazuh row. Include a scan in your deliverables only if you observed and recorded it separately.

```bash
nmap -sn $TARGET_META
nmap -F $TARGET_META
```

### Task 1: Open a triage record

**Goal:** save an accurate structured record of your observed alert.

**Where to work:** **Target: meta (lab)**. Confirm the prompt identifies `msfadmin` on a meta host; files on Kali do not score.

1. Note your observed values in **Open SIEM** before opening the editor:

| Field | What to enter |
| --- | --- |
| `alert_id` | An analyst-assigned reference you choose, such as `case-1`; the grouped table does not require a Wazuh event ID. |
| `severity` | The observed level or portal band: `low` for 0–4, `medium` for 5–6, `high` for 7+. These are portal bands, not checker enums. |
| `rule` | The selected event's Rule, normally `5710` for your attempt. |
| `description` | The event's Description. |
| `agent` | Your event's actual Agent name. |
| `classification` | Your assessment: for example `true_positive` for a correctly detected failed login, or `needs_investigation` if evidence is insufficient. No checker enum is enforced. |
| `notes` | Actual timestamp and timezone, evidence, and limits of your conclusion. |

2. In the meta shell, open the file with `vi`:

```bash
vi /home/msfadmin/alert_triage.json
```

3. Press **i** for insert mode. Type your record using the reference structure below. **Replace every angle-bracket placeholder before saving.** Keep quotes around text, commas between fields, and no comma after the last field. This is reference text, not a command or completed answer:

> `{`\
> `"alert_id": "<your case reference>",`\
> `"severity": "<observed level or portal band>",`\
> `"rule": "<observed rule>",`\
> `"description": "<observed description>",`\
> `"agent": "<actual agent>",`\
> `"classification": "<your assessment>",`\
> `"notes": "<timestamp, timezone, evidence and uncertainty>"`\
> `}`

4. Press **Esc**, type **`:wq`**, and press Enter to save and return to the shell. To edit again, rerun the opening command; use arrow keys to move, **i** to insert, and **Esc** then **`:wq`** to save. To abandon unsaved edits, use **Esc** then **`:q!`**.
5. In the meta shell, inspect the saved file:

```bash
cat /home/msfadmin/alert_triage.json
```

**Expected result:** your event's values appear with no placeholders. Check matching braces and quotes and correct commas. If `python3` is installed, optional meta-shell command `python3 -m json.tool /home/msfadmin/alert_triage.json` checks syntax; it does not validate your evidence.

**Done when:** all seven fields describe your actual alert and **Open a triage record** is credited. The checker is less strict than this learning requirement.

**Optional reference:** select **PDF** beside the Guide to view the complete guide's **Example only: how evidence moves between files**. It connects a fictional alert, JSON excerpt, timeline, and report; use your own evidence for the tasks.

> **Troubleshooting:** If `vi` is unavailable, ask your instructor which installed editor to use. If pending, confirm the exact path and host. Do not save a fictional example unchanged.

### Task 2: Build the timeline

**Goal:** order observed events and explain what each establishes.

**Where to work:** **Open SIEM** for evidence; **Target: meta (lab)** for `/home/msfadmin/incident_timeline.md`.

1. Use the individual failed-login event's displayed SIEM timestamp. Record its date and timezone consistently. **Each additional event needs its own observed timestamp.** `HH:MM` means hours and minutes in 24-hour time; it is a placeholder to replace.
2. In the meta shell, open:

```bash
vi /home/msfadmin/incident_timeline.md
```

3. Press **i**. Write a heading and one line per observed event, earliest first. Include phase, rule, real date/time, timezone, classification, and a brief evidence statement. Replace all placeholders in this reference structure and remove unused rows:

> `# Incident timeline`\
> `1. phase: initial_access_attempt, rule: 5710, time: <actual HH:MM>, date: <actual date>, timezone: <SIEM timezone>, classification: true_positive — <failed-login evidence>`

4. Include the failed-login event even if it is the only observed event. Do not reuse its time for unrelated events. An accurate configuration alert may be unrelated; call it a false positive only if evidence shows the detection is incorrect. A failed login does not prove compromise.
5. Press **Esc**, type **`:wq`**, and press Enter. In the meta shell, inspect:

```bash
cat /home/msfadmin/incident_timeline.md
```

**Expected result:** every line has a real timestamp and supported interpretation. No `HH:MM`, angle-bracket placeholders, unused phases, or invented events remain.

**Done when:** the timeline includes your observed failed-login event with its real rule and time, events are ordered correctly, and **Build the timeline** is credited.

> **Troubleshooting:** Compare the individual rule-5710 time with your line and check the meta path. Scoring help explains timezone tolerance. If using `auth.log` as a fallback, label its timezone; do not mix UTC log times with local SIEM times without conversion.

### Task 3: Write the incident report

**Goal:** explain the evidence and recommend a proportionate response.

**Where to work:** **Target: meta (lab)**, saving `/home/msfadmin/incident_report.txt`.

1. Review your triage record and timeline. Use the same observed event throughout.
2. In the meta shell, open:

```bash
vi /home/msfadmin/incident_report.txt
```

3. Press **i**. Write **Summary**, **Affected system**, **Evidence**, **Interpretation**, and **Recommended response** headings, filling each with your own findings. Cite real agent, rule, timestamp, and timezone. State whether successful access was observed, unknown, or unsupported by the evidence.
4. Justify recommendations. Repeated hostile attempts may support blocking a source; exposed credentials may support rotation; evidence of compromise may support isolation. Tune noisy detections after checking accuracy. A single intentional lab login failure does not automatically justify all these actions.
5. Press **Esc**, type **`:wq`**, and press Enter. In the meta shell, read and measure the report:

```bash
cat /home/msfadmin/incident_report.txt
wc -c /home/msfadmin/incident_report.txt
```

**Expected result:** a clear report connects facts to interpretation and response. `wc -c` prints byte count and path; the count must exceed 200. An informative heading such as **Affected system** or **Recommended response** also supplies a recognized checker term.

**Done when:** the report is accurate, has no unfinished template text, exceeds 200 bytes, and **Write the incident report** is credited. All three scored tasks complete the scenario.

## 5. Example only: how evidence moves between files

**Example only — do not submit unchanged.** This entire chain is fictional; use your own observed event and host.

1. Fictional alert: `2026-10-10 14:32 UTC+08:00`, rule `5710`, level `5`, agent `pod-example-meta`, description `sshd: attempt to login using a non-existent user`.
2. Matching JSON excerpt: `"alert_id": "case-example", "severity": "medium", "rule": "5710", "agent": "pod-example-meta", "classification": "true_positive", "notes": "2026-10-10 14:32 UTC+08:00: invalid-user login attempt; no successful access established."`
3. Matching timeline: `1. phase: initial_access_attempt, rule: 5710, time: 14:32, date: 2026-10-10, timezone: UTC+08:00, classification: true_positive — nonexistent-user SSH attempt.`
4. Matching report: “At 14:32 UTC+08:00 on 10 October 2026, rule 5710 on system pod-example-meta recorded a nonexistent-user SSH attempt. This supports failed authentication; these records do not establish successful access. I recommend checking adjacent authentication events for repetition before choosing containment.”

## 6. SOC playground (optional, not scored)

After the required work, expand other groups and inspect **Raw events**. Compare configuration detections with authentication events, explaining whether each is accurate, related, suspicious, or evidence of compromise. Repeating your practice SSH attempt can show changes in **Count**. Keep each event's own timestamp; do not call every unrelated alert a false positive.
