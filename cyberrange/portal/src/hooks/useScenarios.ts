'use client'

import { useState } from 'react'

export interface Milestone {
  id: number
  name: string
  description: string
  points: number
  goal?: string
  cue?: string
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
}

// GUIDE-UX-TRIAL / SCEN-UX #116: "Scenario N -- Name" for any screen that
// wants the combined label (guide H1, print title, lab header breadcrumb).
export function scenarioDisplayTitle(scenario: Pick<Scenario, 'displayNumber' | 'name'>): string {
  return `Scenario ${scenario.displayNumber} — ${scenario.name}`
}

export const SCENARIOS: Scenario[] = [
  {
    id: '01',
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
        description: 'Use Nmap service detection (-sV) to enumerate version info on all discovered hosts.',
        points: 50,
      },
      {
        id: 4,
        name: 'Tomcat Manager Exploitation',
        goal: 'Exploit Tomcat Manager and land a shell on meta',
        cue: "After `shell`, the `meterpreter >` prompt is replaced by a plain `$` — that's expected.",
        description: 'Use Metasploit to exploit the Apache Tomcat Manager on port 8180 and obtain a shell on the meta target as the tomcat user.',
        points: 75,
      },
      {
        id: 5,
        name: 'Capture the Flag (whoami)',
        goal: 'Run whoami in Kali and submit your username as the flag',
        description: 'In the Kali terminal, run whoami and submit the username it prints as the flag.',
        points: 50,
      },
    ],
  },
  {
    id: '06',
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
      { id: 1, name: 'Injection Point', description: 'Identify the SQL injection vulnerability in the DVWA application (set security to Low).', points: 50 },
      { id: 2, name: 'Database Extraction', description: 'Extract the users table from the backend database using the injection vulnerability.', points: 75 },
      { id: 3, name: 'Admin Hash', description: 'Retrieve the admin account password hash from the database.', points: 100 },
      { id: 4, name: 'Reflected XSS', description: 'Exploit the Reflected Cross-Site Scripting (XSS) vulnerability in DVWA (set security to Low).', points: 75 },
      { id: 5, name: 'Capture the Flag', description: 'Submit the Reflected XSS payload in the "What\'s your name?" box (Task 4); a short code (e.g. brave-otter-7421) appears on that result page. Paste it below.', points: 50 },
    ],
  },
  {
    id: '09',
    displayNumber: 3,
    name: 'SIEM Alert Triage',
    type: 'defensive',
    description: 'Analyze security alerts and classify false positives.',
    mitre: 'T1595',
    difficulty: 2,
    guideFile: 'scenario_03_siem_alert_triage_and_log_analysis.md',
    milestones: [
      { id: 1, name: 'Start Triage', description: 'Generate noise from Kali, open the SIEM (if available), and write alert_triage.json on meta with rule/severity fields.', points: 50 },
      { id: 2, name: 'True Positive Classification', description: 'Classify true positives and write incident_timeline.md (or mark TPs in the triage file) on meta.', points: 100 },
      { id: 3, name: 'Incident Summary', description: 'Write incident_report.txt on meta (>200 chars) covering systems, evidence, and recommended actions.', points: 75 },
    ],
  },
  {
    id: '11',
    displayNumber: 4,
    name: 'Vulnerability Hardening',
    type: 'defensive',
    description: 'Remediate the Tomcat manager weakness exploited in Scenario 1 and confirm the exploit path is closed.',
    mitre: 'T1548',
    difficulty: 3,
    guideFile: 'scenario_04_vulnerability_hardening.md',
    milestones: [
      { id: 1, name: 'Identify the Weakness', description: 'Inspect the Tomcat manager configuration on the meta target and confirm the default tomcat/tomcat credential is present.', points: 50 },
      { id: 2, name: 'Apply the Remediation', description: 'Rotate or remove the default Tomcat manager credential on the meta target.', points: 75 },
      { id: 3, name: 'Confirm the Exploit Path Is Closed', description: 'Verify the Tomcat manager endpoint no longer authenticates with the default credential.', points: 75 },
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
