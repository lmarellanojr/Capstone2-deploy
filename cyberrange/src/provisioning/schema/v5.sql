-- Schema migration v5: Rubric criteria and expected flags per milestone (SCORE-HYBRID)
CREATE TABLE IF NOT EXISTS milestone_rubrics (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    scenario_id     INTEGER NOT NULL CHECK(scenario_id > 0),
    milestone_id    INTEGER NOT NULL CHECK(milestone_id > 0),
    name            TEXT NOT NULL,
    criteria        TEXT NOT NULL,
    expected_flag   TEXT NOT NULL,
    points          INTEGER NOT NULL DEFAULT 50 CHECK(points >= 0 AND points <= 1000),
    mitre_technique TEXT,
    nist_phase      TEXT,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (scenario_id, milestone_id)
);

CREATE INDEX IF NOT EXISTS idx_milestone_rubrics_scenario
    ON milestone_rubrics (scenario_id, milestone_id);

-- Supporting index for conflict deduplication and lookup in the review queue
CREATE INDEX IF NOT EXISTS idx_conflict_cases_lookup
    ON review_cases (student_id, scenario_id, milestone_id, case_type, status);

-- Seed canonical rubric criteria and expected flags for catalog scenarios (idempotent INSERT OR IGNORE)
INSERT OR IGNORE INTO milestone_rubrics (scenario_id, milestone_id, name, criteria, expected_flag, points, mitre_technique, nist_phase)
VALUES
  (1, 1, 'Host Discovery', 'Execute Nmap subnet sweep to detect live hosts in target subnet.', 'FLAG{S01_M1_7F8C2A1E9D4B}', 50, 'T1046', 'Network Enumeration'),
  (1, 2, 'Port Enumeration', 'Accurately enumerate open TCP ports (21, 22, 80, 8180) on target host.', 'FLAG{S01_M2_3E5B7C9A1D2F}', 50, 'T1046', 'Vulnerability Scanning'),
  (1, 3, 'Service Version Detection', 'Use Nmap service version detection (-sV) to determine exact service banners.', 'FLAG{S01_M3_A4D6F8C0E2B1}', 50, 'T1046', 'Service Identification'),
  (1, 4, 'Tomcat Manager Exploitation', 'Deploy Metasploit tomcat_mgr_deploy to achieve authenticated remote shell.', 'FLAG{S01_M4_B2C4E6A8D0F1}', 75, 'T1190', 'Exploitation'),
  (6, 1, 'Injection Point', 'Identify SQL injection entry point on DVWA form input under Low security.', 'FLAG{S06_M1_9B4E2F1A7C3D}', 50, 'T1190', 'Input Validation Analysis'),
  (6, 2, 'Database Extraction', 'Extract schema and users table from database using SQL injection.', 'FLAG{S06_M2_5D7F9A1C3E5B}', 75, 'T1190', 'Data Access'),
  (6, 3, 'Admin Hash', 'Retrieve admin user password hash from dumped backend database.', 'FLAG{S06_M3_8C0E2B4D6F8A}', 100, 'T1190', 'Credential Harvesting'),
  (9, 1, 'Start Triage', 'Generate traffic, inspect SIEM events, and output structured alert_triage.json.', 'FLAG{S09_M1_1A3C5E7F9B2D}', 50, 'T1595', 'Detection & Identification'),
  (9, 2, 'True Positive Classification', 'Filter noise, identify true positives, and compile incident_timeline.md.', 'FLAG{S09_M2_4D6F8A0C2E4B}', 100, 'T1595', 'Analysis'),
  (9, 3, 'Incident Summary', 'Generate comprehensive incident_report.txt documenting evidence and response.', 'FLAG{S09_M3_7B9D1F3A5C7E}', 75, 'T1595', 'Documentation & Response'),
  (11, 1, 'Identify the Weakness', 'Inspect Tomcat manager credentials in tomcat-users.xml and verify tomcat/tomcat vulnerability.', 'FLAG{S11_M1_2C4E6A8B0D2F}', 50, 'T1548', 'Vulnerability Assessment'),
  (11, 2, 'Apply the Remediation', 'Rotate or remove default tomcat:tomcat credential in configuration.', 'FLAG{S11_M2_5F7A9C1E3B5D}', 75, 'T1548', 'Remediation'),
  (11, 3, 'Confirm the Exploit Path Is Closed', 'Verify Tomcat manager authentication rejects previous default credentials.', 'FLAG{S11_M3_8A0C2E4F6A8B}', 75, 'T1548', 'Verification');
