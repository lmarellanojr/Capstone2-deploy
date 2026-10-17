// "Before you start" prerequisites for each scenario: the tools, commands and
// concepts the scenario assumes, each with a one-line explanation. Shown on the
// scenario landing page so students know what the lab takes for granted before
// they start (SUS Q10 "needed to learn a lot before I could get going").
//
// Keep each blurb to one plain sentence. Copy is drawn from section 1 ("The
// tools you'll use") of each guide in public/scenarios/*.md so the two stay
// consistent. Keyed by Scenario.id ("01", "06", "09", "11").

export interface PrereqItem {
  /** Tool name, command, or concept — rendered emphasised. */
  term: string
  /** One-line, plain-language explanation. */
  blurb: string
}

export interface ScenarioPrereqs {
  /** One sentence naming what the scenario assumes you can already do. */
  intro: string
  /** Tools and commands the tasks use. */
  tools: PrereqItem[]
  /** Ideas worth knowing the name of before you start. */
  concepts: PrereqItem[]
}

const PREREQS: Record<string, ScenarioPrereqs> = {
  '01': {
    intro:
      'You run every command yourself in the Kali Linux (CLI) tab. No prior Nmap or Metasploit experience is assumed — the guide gives the exact commands.',
    tools: [
      { term: 'Nmap', blurb: 'Scans a network: finds live hosts, open ports, and (with -sV) service versions.' },
      { term: 'Metasploit (msfconsole)', blurb: 'Runs exploit modules; here it deploys to Tomcat Manager and opens a remote session.' },
      { term: 'Meterpreter / shell', blurb: 'The command session you get on the target after the exploit — not your normal Kali shell.' },
      { term: 'cat', blurb: 'Prints a file; you use it to read the flag in the final task.' },
    ],
    concepts: [
      { term: 'Port', blurb: 'A numbered endpoint a service listens on, such as SSH on 22 or Tomcat on 8180.' },
      { term: 'Subnet / scope', blurb: 'The address range you are authorised to scan — shown in the lab header as $TARGET_SUBNET.' },
      { term: 'Kali vs meta', blurb: 'Kali is your attacker machine; meta is the intentionally vulnerable target.' },
      { term: 'Default credentials', blurb: 'A service left on its factory username/password — here tomcat / tomcat on the Manager.' },
    ],
  },
  '06': {
    intro:
      'You work entirely in the browser: DVWA loads inside the lab page, already signed in to your session. No terminal or sqlmap is needed.',
    tools: [
      { term: 'DVWA', blurb: 'A deliberately vulnerable practice website; log in as admin / password.' },
      { term: 'DVWA Security = Low', blurb: 'Set this first — higher levels block the payloads and nothing will score.' },
      { term: 'SQL injection', blurb: "Typing SQL into an input so the database runs it; you use the User ID field for Tasks 1–3." },
      { term: 'Reflected XSS', blurb: 'Getting the page to run your <script> by reflecting your input back unescaped.' },
    ],
    concepts: [
      { term: "Quote and OR '1'='1", blurb: "A single quote closes the input's string; OR '1'='1' makes the condition always true." },
      { term: 'UNION SELECT', blurb: 'Joins extra rows onto the original query; it must return the same number of columns (two here).' },
      { term: 'Password hash', blurb: "The admin password stored as a 32-character hex value — what you extract, not the plaintext." },
    ],
  },
  '09': {
    intro:
      'You are the defender. You generate one alert from Kali, read it in the SIEM, then write three evidence files on the meta tab. There is no flag to submit.',
    tools: [
      { term: 'Wazuh SIEM (Open SIEM)', blurb: 'Shows security alerts; filter Agent to your own pod-…-meta host and expand a rule group.' },
      { term: 'Target: meta (lab) tab', blurb: 'Where you save the three files as msfadmin — files written on Kali never score.' },
      { term: 'vi', blurb: 'The text editor used to create the JSON, Markdown and report files on meta.' },
      { term: 'ssh', blurb: 'One failed SSH login from Kali is what produces the alert you investigate.' },
    ],
    concepts: [
      { term: 'Rule 5710', blurb: 'The Wazuh rule ID for an invalid-user SSH attempt — the alert this scenario is about.' },
      { term: 'UTC and the …Z timestamp', blurb: 'SIEM times end in Z and are UTC; copy that exact string, not your local clock.' },
      { term: 'JSON / Markdown', blurb: 'JSON is structured named fields; Markdown is text with simple headings and lists.' },
      { term: 'True positive', blurb: 'A real detected event, as opposed to unrelated configuration findings you must rule out.' },
    ],
  },
  '11': {
    intro:
      'You do everything on the meta (lab) tab as msfadmin — confirm the prompt reads msfadmin@pod-…-meta. This scenario fixes the Tomcat weakness from Scenario 1.',
    tools: [
      { term: 'sudo', blurb: 'Runs a command as administrator; msfadmin can use it without a password.' },
      { term: 'cat', blurb: 'Shows a file — you read tomcat-users.xml with it.' },
      { term: 'sed', blurb: 'Finds and replaces text in a file; you use it to change the default password.' },
      { term: 'systemctl', blurb: 'Restarts and checks services, such as restarting Tomcat after the change.' },
      { term: 'grep', blurb: 'Searches a file for text; no output means the default password is gone.' },
      { term: 'curl', blurb: 'Sends a web request from the shell to test whether the old login still works.' },
    ],
    concepts: [
      { term: 'tomcat-users.xml', blurb: 'An XML file at /etc/tomcat9/ holding Tomcat logins; <!-- … --> is an ignored comment.' },
      { term: 'HTTP 401 / 403', blurb: 'A rejected login — what you want to see after hardening. 200 means it still works.' },
    ],
  },
}

export function prereqsForScenario(scenarioId: string): ScenarioPrereqs | null {
  return PREREQS[scenarioId] ?? null
}
