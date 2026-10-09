'use client'

import { useState } from 'react'

export interface Milestone {
  id: number
  name: string
  description: string
  points: number
  goal?: string
  cue?: string
  // `warning` for the trap a student is most likely to misread (e.g. a
  // command whose success signal is empty output); default is `info`.
  cueVariant?: 'info' | 'warning'
  instructions?: string[]
  // Pins a milestone to a specific guide section when guide numbering differs
  // from its position among the scored milestones.
  guideTaskNumber?: number
  unscored?: boolean
}

export interface Scenario {
  id: string
  // GUIDE-UX-TRIAL / SCEN-UX #116: the single source of truth for the
  // student-facing "Scenario N" number. `id` stays the internal/backend
  // scenario_id (01/06/09/11 -- unchanged, still used for routing,
  // provisioning and scoring) and must never be shown to students directly;
  // every screen that used to derive a number from `id` (or keep its own
  // duplicate lookup table, e.g. ScenarioCard's old CAPSTONE_LABEL) should
  // read `displayNumber` instead so the catalog, lab header, guide, and
  // provisioning picker can't drift out of sync again.
  displayNumber: number
  name: string
  type: 'offensive' | 'defensive'
  description: string
  mitre: string
  difficulty: 1 | 2 | 3
  guideFile: string
  milestones: Milestone[]
  labSurface?: 'terminal' | 'dvwa' | 'siem'
  prepTask?: Milestone
  brief?: [string, string]
}

// Single helper to resolve the lab surface. Legacy callers may omit metadata.
export function getLabSurface(scenario?: Pick<Scenario, 'id' | 'labSurface'> | null): 'terminal' | 'dvwa' | 'siem' {
  if (!scenario) return 'terminal'
  if (scenario.labSurface) return scenario.labSurface
  if (scenario.id === '06') return 'dvwa'
  if (scenario.id === '09') return 'siem'
  return 'terminal'
}

// GUIDE-UX-TRIAL / SCEN-UX #116: "Scenario N -- Name" for any screen that
// wants the combined label (guide H1, print title, lab header breadcrumb).
export function scenarioDisplayTitle(scenario: Pick<Scenario, 'displayNumber' | 'name'>): string {
  return `Scenario ${scenario.displayNumber} — ${scenario.name}`
}

export const SCENARIOS: Scenario[] = [
  {
    id: '01',
    labSurface: 'terminal',
    displayNumber: 1,
    name: 'Network Reconnaissance & Exploitation',
    type: 'offensive',
    description: 'Identify live hosts and map services across a target subnet.',
    mitre: 'T1046',
    difficulty: 1,
    guideFile: 'scenario_01_network_reconnaissance.md',
    milestones: [
      {
        id: 1,
        name: 'Host Discovery',
        goal: 'Run a host-discovery sweep across the subnet',
        description: 'Run an Nmap sweep of the target subnet to identify live hosts.',
        points: 50,
      },
      {
        id: 2,
        name: 'Port Enumeration',
        goal: 'Enumerate open TCP ports on the meta target',
        description: 'Identify open TCP ports on the meta target (expect 21, 22, 80, 8180).',
        points: 50,
      },
      {
        id: 3,
        name: 'Service Version Detection',
        goal: 'Detect service versions on open ports',
        description: 'Use Nmap service detection (-sV) to identify software and versions on meta’s scanned ports.',
        points: 50,
      },
      {
        id: 4,
        name: 'Tomcat Manager Exploitation',
        goal: 'Exploit Tomcat Manager and land a shell on meta',
        cue: 'After shell, commands run on meta. Keep the remote session open until this task is credited; then follow the Guide exits back to Kali.',
        description: 'Use Metasploit to exploit the Apache Tomcat Manager on port 8180 and obtain a shell on the meta target as the tomcat user.',
        points: 75,
      },
      {
        id: 5,
        name: 'Capture the Flag (whoami)',
        goal: 'Run whoami in Kali and submit your username as the flag',
        description: 'Return from Metasploit to the normal Kali shell, run whoami, and submit the printed Kali username as the flag.',
        points: 50,
      },
    ],
  },
  {
    id: '06',
    labSurface: 'dvwa',
    displayNumber: 2,
    name: 'SQL Injection',
    type: 'offensive',
    // Browser-only lab: DVWA is embedded in the lab page (portal-proxied) and
    // scoring comes from the proxied DVWA responses — no Kali/sqlmap needed.
    description: 'Exploit DVWA in your browser with SQL injection and XSS to extract database data.',
    mitre: 'T1190',
    difficulty: 2,
    guideFile: 'scenario_02_web_application_attack_sql_injection.md',
    milestones: [
      {
        id: 1,
        name: 'Injection Point',
        goal: 'Compare a normal ID result with an always-true payload returning multiple user rows',
        cue: '⚠ Set DVWA Security to Low first — higher levels block these payloads and nothing will score.',
        description: 'Identify the SQL injection vulnerability in the DVWA application (set security to Low).',
        points: 50,
      },
      {
        id: 2,
        name: 'Database Extraction',
        goal: 'Use a UNION SELECT to make DVWA print the database\'s own name',
        description: 'Use a two-column UNION query to find the current database name in DVWA’s Surname result.',
        points: 75,
      },
      {
        id: 3,
        name: 'Admin Hash',
        goal: 'Dump the users table so the admin\'s password hash appears',
        description: 'Retrieve the admin account password hash from the database.',
        points: 100,
      },
      {
        id: 4,
        name: 'Reflected XSS',
        goal: 'Get DVWA to reflect and run a <script>',
        cue: 'The popup is evidence that the script ran; dismiss it before continuing. Scoring separately checks the script reflected in DVWA’s response.',
        description: 'Exploit the Reflected Cross-Site Scripting (XSS) vulnerability in DVWA (set security to Low).',
        points: 75,
      },
      {
        id: 5,
        name: 'Capture the Flag',
        goal: 'Read the lab flag on the Low-security XSS result page and submit it',
        cue: 'Dismiss the popup, then scroll inside the DVWA result page to Your capture-the-flag code. Submit your own code in this task’s Status area.',
        description: 'Read your code from the Low-security XSS (Reflected) result and submit it in the portal. brave-otter-7421 is an example only.',
        points: 50,
      },
    ],
  },
  {
    id: '09',
    labSurface: 'siem',
    displayNumber: 3,
    name: 'SIEM Alert Triage',
    type: 'defensive',
    description: 'Analyze observed security alerts, build a timeline, and recommend an evidence-based response.',
    mitre: 'T1595',
    difficulty: 2,
    guideFile: 'scenario_03_siem_alert_triage_and_log_analysis.md',
    brief: [
      'You are the defender. Generate a failed SSH login, inspect Wazuh alerts, and distinguish that detection from unrelated configuration findings.',
      'Turn your evidence into a triage record, a timeline, and a report. Save all three files on meta; the checker scores them automatically. There is no flag to submit.',
    ],
    prepTask: {
      id: 0, name: 'Generate the alerts', description: 'Prepare the evidence you will investigate.', points: 0,
      unscored: true, guideTaskNumber: 0,
      instructions: ['On Kali, generate a failed SSH login against meta; scanning is optional.', 'Open SIEM, find your meta agent’s individual rule 5710 event, and note its timestamp and timezone for Task 2.'],
      cue: 'Open the SIEM now and note the rule 5710 time — you need it for Task 2.',
      cueVariant: 'info',
    },
    milestones: [
      {
        id: 1, name: 'Open a triage record', description: 'Capture the alert as a structured case record.', points: 50, guideTaskNumber: 1,
        instructions: ['Switch to Target: meta (lab) and confirm the prompt identifies the meta host.', 'Save /home/msfadmin/alert_triage.json with all seven fields describing your observed alert; replace every placeholder before saving.'],
        cue: 'Write on the meta tab — files created on Kali never score. Confirm the prompt reads msfadmin@pod-…-meta.', cueVariant: 'warning',
      },
      {
        id: 2, name: 'Build the timeline', description: 'Classify observed events and put them in time order.', points: 100, guideTaskNumber: 2,
        instructions: ['On meta, save /home/msfadmin/incident_timeline.md with observed events in time order, including the failed login.', 'Give each event its own actual timestamp and timezone. Replace all placeholders and remove events you did not observe.'],
        cue: 'Use the actual rule 5710 event time for the failed-login line. Other events need their own timestamps; do not reuse one time for every row.', cueVariant: 'warning',
      },
      {
        id: 3, name: 'Write the incident report', description: 'Turn your findings into actions for a supervisor.', points: 75, guideTaskNumber: 3,
        instructions: ['On meta, save /home/msfadmin/incident_report.txt with summary, affected system, evidence, interpretation, and recommended response.', 'Explain whether successful access is supported by the evidence. Exceed 200 bytes and justify response choices.'],
        cue: 'Clarity and observed evidence come first. The size check is more than 200 bytes; blocking, rotation, isolation, and tuning are choices to justify.', cueVariant: 'info',
      },
    ],
  },
  {
    id: '11',
    labSurface: 'terminal',
    displayNumber: 4,
    name: 'Vulnerability Hardening',
    type: 'defensive',
    description: 'Remediate the Tomcat manager weakness exploited in Scenario 1 and confirm the exploit path is closed.',
    mitre: 'T1548',
    difficulty: 3,
    guideFile: 'scenario_04_vulnerability_hardening.md',
    milestones: [
      {
        id: 1,
        name: 'Identify the Weakness',
        goal: 'On the meta tab, read the Tomcat users config',
        description: 'Confirm the default tomcat/tomcat Manager credential is present. Scoring reads the inspection command from your meta shell history.',
        cue: 'All work in this scenario is on the **meta** tab — confirm the prompt reads `msfadmin@pod-…-meta`.',
        points: 50,
      },
      {
        id: 2,
        name: 'Apply the Remediation',
        goal: 'Replace the default password and restart Tomcat',
        description: 'Replace the sample secret before editing, restart Tomcat, confirm it is active, and inspect the configuration.',
        cue: '⚠ **Empty output = success only if there is no grep error.** Inspect any matching line before editing again, and confirm Tomcat is active.',
        cueVariant: 'warning',
        points: 75,
      },
      {
        id: 3,
        name: 'Confirm the Exploit Path Is Closed',
        goal: 'Send one request with the old credential and read the status code',
        description: 'On meta, test the reachable Manager endpoint with tomcat/tomcat. HTTP 401 or 403 means the tested request was rejected.',
        cue: '`200` means the old request was accepted; `401`/`403` means rejected. `000` or a connection error is not a verified fix; check service health.',
        points: 75,
      },
    ],
  },
]

// Final "find the flag" tasks scored purely by flag submission — mirrors the
// backend PURE_FLAG_MILESTONES set in hybrid_scoring.py. Keyed "catalogId:milestoneId".
const FLAG_MILESTONES = new Set<string>(['01:5', '06:5'])

/** True for the capture-the-flag final tasks (Scenario 1 & 2) that are scored by
 *  submitting a flag rather than by auto-detect / Manual Check. */
export function isFlagMilestone(scenarioId: string, milestoneId: number): boolean {
  return FLAG_MILESTONES.has(`${scenarioId}:${milestoneId}`)
}

export function useScenarios() {
  const [scenarios] = useState<Scenario[]>(SCENARIOS)
  return scenarios
}
