# Beginner scenario guide implementation

Base: `origin/main` at `11217d1`. Working branch: `docs/beginner-scenario-guides`.

This is a follow-on instructional-content update. The four guides use Goal, Where to work, numbered actions, Expected result, and Done when. Prerequisites, definitions and recovery advice appear where useful; optional exploration follows the required path. Task identity, ordering, points, guide routing, lab layout, provisioning and scoring code remain unchanged.

## Content source map

The authoritative guides are:

- G1: `cyberrange/portal/public/scenarios/scenario_01_network_reconnaissance.md`
- G2: `cyberrange/portal/public/scenarios/scenario_02_web_application_attack_sql_injection.md`
- G3: `cyberrange/portal/public/scenarios/scenario_03_siem_alert_triage_and_log_analysis.md`
- G4: `cyberrange/portal/public/scenarios/scenario_04_vulnerability_hardening.md`

All task summaries/cues are in `cyberrange/portal/src/hooks/useScenarios.ts` (H). Landing and welcome tips are in `cyberrange/portal/src/components/scenario/ScenarioTips.tsx` (T). Pending/completed and flag-field copy is in `cyberrange/portal/src/components/scenario/TaskScoreStatus.tsx` and `FlagSubmission.tsx` (P); these components were inspected and left unchanged.

Checker C is `cyberrange/src/provisioning/scoring_checks.sh`. Browser detector B is `cyberrange/portal/src/lib/dvwaScoreSignals.ts`, called by `cyberrange/portal/src/app/lab/dvwa/[[...path]]/route.ts`. Flag validation F is `cyberrange/src/provisioning/rubrics.py` and `hybrid_scoring.py`, with reveal/identity planting in `flag_planting.py`.

Export E is the same complete injected guide rendered by `cyberrange/portal/src/components/scenario/GuideView.tsx` and `MarkdownView.tsx`, printed by the existing PDF action in `ExercisePanel.tsx`; there are no separate stored PDF sources. `cyberrange/portal/src/lib/guideSections.ts` extracts welcome/tools/scoring and individual tasks. `podIps.ts` substitutes addresses before rendering and Copy.

| Catalog / internal ID | Task | Content | Related hint/help | Checker | Export | Finding status at discovery → disposition |
| --- | --- | --- | --- | --- | --- | --- |
| 1 / 01 | Overview | G1 sections 0–3 | H, T | C, F | E: G1 | Formula/variable and history-only wording still open → corrected. |
| 1 / 01 | 1 Host Discovery | G1 Task 1 | H, T, P | C: check_scenario_1(1) | E: G1 | 254/256, DVWA requirement and scope confusion still open → corrected. |
| 1 / 01 | 2 Port Enumeration | G1 Task 2 | H, P | C: check_scenario_1(2) | E: G1 | Required targeted scan already present; column/state explanation open → added. |
| 1 / 01 | 3 Service Version Detection | G1 Task 3 | H, P | C: check_scenario_1(3) | E: G1 | Duplicate all-host scope and version-overclaim open → corrected. |
| 1 / 01 | 4 Tomcat Manager Exploitation | G1 Task 4 | H, T, P | C: check_live_tomcat_msf_session | E: G1 | Numeric RHOSTS, PATH and TARGET already fixed → retained. History-flush/exit advice stale after live-session checker change → corrected. |
| 1 / 01 | 5 Capture the Flag (whoami) | G1 Task 5 | H, P | F; read_kali_whoami | E: G1 | Missing Kali transition still open → added; example identity clearly illustrative. |
| 2 / 06 | Overview | G2 sections 0–3 | H, T | B, F | E: G2 | Missing Task 5 table row and all-auto claims open → corrected. |
| 2 / 06 | 1 Injection Point | G2 Task 1 | H, P | B: milestone 1 | E: G2 | Always-true required payload already present; baseline and error/result distinction open → clarified. |
| 2 / 06 | 2 Database Extraction | G2 Task 2 | H, P | B: milestone 2 | E: G2 | Database-name goal already aligned → retained. Duplicate users-table description open → corrected. |
| 2 / 06 | 3 Admin Hash | G2 Task 3 | H, P | B: milestone 3 | E: G2 | Admin-row mapping and hash definition open → added. |
| 2 / 06 | 4 Reflected XSS | G2 Task 4 | H, P | B: milestone 4 | E: G2 | Popup-observation scoring claim and broad impact open → corrected. |
| 2 / 06 | 5 Capture the Flag | G2 Task 5 | H, P | F; flag_planting Low PHP | E: G2 | Stale Tasks-panel reference and reveal condition needed verification → source verified and corrected. |
| 3 / 09 | Overview / preparation | G3 sections 0–3, Task 0 | H, T; TerminalView SIEM dialog | C: auth log helper | E: G3 | Nmap-no-alert caveat already fixed → retained. Noise/compromise framing open → corrected. SSH timing still needs live verification. |
| 3 / 09 | 1 Open a triage record | G3 Task 1 | H, P | C: check_scenario_9(1) | E: G3 | Values/editor/field mapping open → added. Enums and alert ID verified: no enum enforcement or required Wazuh ID. |
| 3 / 09 | 2 Build the timeline | G3 Task 2 | H, P | C: _s9_timeline_time_is_real | E: G3 | HH:MM warning already fixed → retained. Reused event time and false-positive framing open → corrected. |
| 3 / 09 | 3 Write the incident report | G3 Task 3 | H, P | C: check_scenario_9(3) | E: G3 | Byte threshold/action-keyword claims needed verification → corrected; recommendations evidence-based. |
| 4 / 11 | Overview | G4 sections 0–3 | H, T, P | C: check_scenario_11 | E: G4 | Dependency on earlier scenario and universal fix claims open → corrected. |
| 4 / 11 | 1 Identify the Weakness | G4 Task 1 | H, P | C: check_scenario_11(1) | E: G4 | Active-entry/comments and sudo guidance open → source-verified and added. |
| 4 / 11 | 2 Apply the Remediation | G4 Task 2 | H, P | C: check_scenario_11(2) | E: G4 | Password syntax, blind repeat and silence interpretation open → corrected; service-health check added. |
| 4 / 11 | 3 Confirm the Exploit Path Is Closed | G4 Task 3 | H, P | C: check_scenario_11(3) | E: G4 | 127.0.0.1, 000/unavailable-service and broad denial claims open → clarified; dangling module-below reference removed. |

## Contract evidence and important distinctions

- Address injection replaces every TARGET token, even in explanatory prose. Guides now describe displayed numeric addresses without calling them shell variables. Metasploit options remain `PATH /manager/text`, `TARGET 1`, port 8180 and the default lab credentials.
- Scenario 1 Task 4 requires an active Metasploit process, a session-open message associated with the selected module and assigned meta address, and a process-owned established connection. Cleanup exits follow credit. The former history-flush prerequisite was a content defect, not a checker defect.
- Browser scoring observes HTTP 200 response content. The popup is learning evidence, not the detector signal. The planted Low PHP reveals the flag for nonempty `name` input; this is not conditional on script execution. Flag validation normalizes case and leading/trailing whitespace.
- Scenario 3 M1 is only a field-name text check; JSON syntax and complete field content are stronger exercise requirements. Portal severity bands are 0–4 / 5–6 / 7+, not Wazuh's universal severity standard or checker enums. Classification examples are analyst assessments. M2's permissive minute matching is described in scoring help, not used to justify fabricated timestamps. M3's threshold is over 200 bytes and any recognized term, not all response actions.
- Current provisioning grants passwordless sudo to msfadmin. Golden Tomcat config uses one active double-quoted default account. The restricted replacement secret avoids shell/sed/XML metacharacters. A no-match grep must be distinguished from read errors; checker text matching includes comments. HTTP 401/403 is rejection of the tested request; 403 does not uniquely prove password rejection. HTTP 000 is never successful verification.

## Verification and limits

The browser QA fixture uses the real ExercisePanel, GuideView, MarkdownView and flag/pending/completed components with local static guides and mocked lab state. It is not a live lab or an end-to-end exercise test.

- `node node_modules/jest/bin/jest.js --runInBand src/lib/guideSections.test.ts src/lib/dvwaScoreSignals.test.ts src/lib/dvwaProxy.test.ts src/components/scenario/ExercisePanel.test.tsx src/components/scenario/TaskScoreStatus.test.tsx src/components/scenario/FlagSubmission.test.tsx src/components/scenario/TerminalView.labLayout.test.tsx src/components/scenario/TerminalView.scenario4.test.tsx src/components/scenario/siemAlertQuery.test.ts src/components/scenario/SiemAlertViewer.test.tsx`: **10 suites, 106 tests passed** (run from cyberrange/portal).
- `node node_modules/typescript/bin/tsc --noEmit --incremental false`: passed.
- Local real-component browser fixture: **34 task renders** (16 scored tasks + preparation, each with pod IDs 1 and 6), **74 Copy actions** compared to intended blocks, four overviews, four tools sections, four scoring sections, four completed states and both incomplete final flag inputs. No page errors. Windows clipboard CRLF normalization is expected; all command content matched.
- Existing PDF button calls the print action; the existing full-guide print root includes every task and no Copy buttons. Four pod-6 PDFs generated with browser print: 8 / 6 / 7 / 5 pages for Scenarios 1 / 2 / 3 / 4. Text extraction found no unresolved address tokens. PDFs and screenshots are local QA artifacts under `evidence/guide-browser/`, not independent content sources.
- `git diff --check`: passed. Production diff is limited to the four guides, useScenarios learner strings and ScenarioTips learner strings. No task metadata or renderer/layout/scoring code changed.

Live verification still required: actual SSH interaction and alert delay, editor availability (`vi`) and optional `python3`, exploit prompt/session behavior, actual service restart and new/old credential outcomes. The guide explicitly avoids guaranteed alert latency and labels optional syntax checking as conditional on python3 availability. If vi is absent, the guide directs the learner to the instructor; installed editor availability was not established from provisioning sources.

No scoring/provisioning/layout defects were patched. No deployment, remote lab mutation, PR or publication is part of this implementation.
