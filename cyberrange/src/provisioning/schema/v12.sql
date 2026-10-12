-- Schema migration v12: Scenario 1 M5 rubric copy (personal FLAG file).
--
-- v10 seeded Capture the Flag (whoami). INSERT OR IGNORE will not update
-- existing rows, so this migration rewrites name/criteria only. Do not
-- change expected_flag, points, or table shape.
UPDATE milestone_rubrics
SET name = 'Capture the Flag',
    criteria = 'Return to the normal Kali shell, run cat /opt/cyberrange/flags/scenario1.txt, and submit the printed FLAG token. Usernames such as student or tomcat are not valid flags.'
WHERE scenario_id = 1 AND milestone_id = 5;
