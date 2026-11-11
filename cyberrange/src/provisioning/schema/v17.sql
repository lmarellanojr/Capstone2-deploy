-- Schema migration v17: Scenario 4 (id 11) MITRE ATT&CK technique.
--
-- v5 seeded T1548 (Abuse Elevation Control Mechanism). The scenario is about a
-- default Tomcat Manager login, which is T1078.001 (Valid Accounts: Default
-- Accounts). INSERT OR IGNORE will not update existing rows, so this rewrites
-- mitre_technique only, and only where it still holds the old value. Do not
-- change name, criteria, expected_flag, points, or table shape.
UPDATE milestone_rubrics
SET mitre_technique = 'T1078.001'
WHERE scenario_id = 11 AND milestone_id IN (1, 2, 3) AND mitre_technique = 'T1548';
