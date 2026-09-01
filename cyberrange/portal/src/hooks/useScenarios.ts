'use client'

import { useState } from 'react'

export interface Milestone {
  id: number
  name: string
  description: string
  points: number
}

export interface Scenario {
  id: string
  name: string
  type: 'offensive' | 'defensive'
  description: string
  mitre: string
  difficulty: 1 | 2 | 3
  guideFile: string
  milestones: Milestone[]
}

export const SCENARIOS: Scenario[] = [
  {
    id: '01',
    name: 'Network Reconnaissance & Exploitation',
    type: 'offensive',
    description: 'Identify live hosts and map services across a target subnet.',
    mitre: 'T1046',
    difficulty: 1,
    guideFile: 'scenario_01_network_reconnaissance.md',
    milestones: [
      { id: 1, name: 'Host Discovery', description: 'Run an Nmap sweep of the target subnet to identify live hosts.', points: 50 },
      { id: 2, name: 'Port Enumeration', description: 'Identify open TCP ports on the meta target (expect 21, 22, 80, 8180).', points: 50 },
      { id: 3, name: 'Service Version Detection', description: 'Use Nmap service detection (-sV) to enumerate version info on all discovered hosts.', points: 50 },
      { id: 4, name: 'Tomcat Manager Exploitation', description: 'Use Metasploit to exploit the Apache Tomcat Manager on port 8180 and obtain a shell on the meta target as the tomcat user.', points: 75 },
    ],
  },
  {
    id: '06',
    name: 'SQL Injection',
    type: 'offensive',
    description: 'Exploit DVWA SQL injection (browser + sqlmap on Kali) to extract database data.',
    mitre: 'T1190',
    difficulty: 2,
    guideFile: 'scenario_06_web_application_attack_sql_injection.md',
    milestones: [
      { id: 1, name: 'Injection Point', description: 'Identify the SQL injection vulnerability in the DVWA application (set security to Low).', points: 50 },
      { id: 2, name: 'Database Extraction', description: 'Extract the users table from the backend database using the injection vulnerability.', points: 75 },
      { id: 3, name: 'Admin Hash', description: 'Retrieve the admin account password hash from the database.', points: 100 },
    ],
  },
  {
    id: '09',
    name: 'SIEM Alert Triage',
    type: 'defensive',
    description: 'Analyze security alerts and classify false positives.',
    mitre: 'T1595',
    difficulty: 2,
    guideFile: 'scenario_09_siem_alert_triage_and_log_analysis.md',
    milestones: [
      { id: 1, name: 'Start Triage', description: 'Generate noise from Kali, open the SIEM (if available), and write alert_triage.json on meta with rule/severity fields.', points: 50 },
      { id: 2, name: 'True Positive Classification', description: 'Classify true positives and write incident_timeline.md (or mark TPs in the triage file) on meta.', points: 100 },
      { id: 3, name: 'Incident Summary', description: 'Write incident_report.txt on meta (>200 chars) covering systems, evidence, and recommended actions.', points: 75 },
    ],
  },
  {
    id: '11',
    name: 'Vulnerability Hardening',
    type: 'defensive',
    description: 'Remediate the Tomcat manager weakness exploited in Scenario 1 and confirm the exploit path is closed.',
    mitre: 'T1548',
    difficulty: 3,
    guideFile: 'scenario_11_vulnerability_hardening.md',
    milestones: [
      { id: 1, name: 'Identify the Weakness', description: 'Inspect the Tomcat manager configuration on the meta target and confirm the default tomcat/tomcat credential is present.', points: 50 },
      { id: 2, name: 'Apply the Remediation', description: 'Rotate or remove the default Tomcat manager credential on the meta target.', points: 75 },
      { id: 3, name: 'Confirm the Exploit Path Is Closed', description: 'Verify the Tomcat manager endpoint no longer authenticates with the default credential.', points: 75 },
    ],
  },
]

export function useScenarios() {
  const [scenarios] = useState<Scenario[]>(SCENARIOS)
  return scenarios
}
