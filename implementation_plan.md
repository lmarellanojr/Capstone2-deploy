# SCORE-FALSEPOS implementation plan

## Tracking

- GitHub issue: #114
- Branch: `feature/score-falsepos-gates`
- Base: `origin/main` at `95e2424`
- Related closed issue: #96 remains closed and is not reused.

## Root causes and requirements

1. `cyberrange/src/provisioning/scoring_checks.sh` currently awards Scenario 1 M4 when it finds only `tomcat_mgr_deploy` in Metasploit or shell history. A command being entered does not prove that the exploit succeeded, so failed attempts false-pass.
2. The backend already scopes `GET /pods/{pod_id}/milestones` to the pod's canonical scenario. The frontend bug is stale state: `TerminalView.tsx` retains its `completed` set while a new `(pod_id, scenario_id)` is rendering and its progress request is still pending. Since milestone ids repeat, old `{1,2,3}` state can be evaluated against Scenario 11 and open the completion modal before Scenario 11's own progress loads.
3. Scenario 11 completion must require progress loaded for its current pod/scenario key and its own final verification milestone (M3) before the completion modal is eligible to open.

## Planned files and contracts

### `cyberrange/src/provisioning/scoring_checks.sh`

- Add a narrowly scoped live-session helper based on the portal's existing persistent tmux `lab` pane. Without sending keystrokes or changing the student's console, it must verify all of the following: the live pane is running Metasploit; its captured output contains a Tomcat module context followed by a numbered `Meterpreter session ... opened` or `Command shell session ... opened` event correlated to this pod's actual meta target (`<own eth0 /24 prefix>.20`) and reporting a specific peer port; and the pane/Metasploit process has a command line identifying `msfconsole` and currently owns an established TCP connection to that exact peer IP and port.
- Do not use `.msf4/history`, because the interactive console may not flush it until the session/console exits. A same-target scan/failed connection without a session-open event, a different module's session, an unrelated-target session, and a live non-Metasploit socket all FAIL.
- Use the live tmux pane plus current process/socket state rather than standalone student-writable transcript files. Do not accept `Meterpreter session opened` text files as authoritative evidence. The captured session-open event is accepted only when it follows the Tomcat module context without a subsequent module-context change, and is corroborated by a still-live socket to the exact peer IP/port owned by the identified msfconsole process. A different same-target connection, such as an HTTP request to port 8180, cannot corroborate an old session on another port.
- Keep production command paths fixed. Tests may inject fixture command output through explicit test-only environment variables whose values are ignored unless a dedicated test-mode switch is enabled; enabling test mode in normal verifier execution is outside the production call contract and will be documented in code.
- Change Scenario 1 M4 to PASS only when the correlated live session check succeeds. Module/history text alone always FAILS.
- Do not change Scenario 3 M2/M3 or unrelated scenario contracts.

### `cyberrange/src/provisioning/test_score_verify_behavioral.py`

- Add a regression where isolated Metasploit history contains `tomcat_mgr_deploy` but no live session; expect FAIL.
- Add a positive regression with fixture tmux-pane output and process/socket output tying the Tomcat module's numbered session and running Metasploit PID to an established connection with this pod's meta IP; expect PASS without depending on history flush timing.
- Add adversarial negatives for a same-target socket with no session, a same-target session opened by a different module, a same-target socket on a different port from the session event, an unrelated target session, a non-Metasploit process/socket, and a forged standalone session-open text file.
- Provide an explicit history-file override in test mode that replaces (rather than supplements) production history paths, so `/home/*` or `/root` ambient evidence cannot influence tests.
- Keep all artifacts inside pytest temporary directories and avoid shared lab/database state.

### `cyberrange/portal/src/lib/scenarioCompletion.ts` (new)

- Add pure helpers that select PASS milestone ids for one strictly validated scenario id and decide completion from the scenario's required milestone ids.
- Accept integer API ids and canonical decimal strings (for compatibility), while rejecting empty, whitespace-only, malformed, non-finite, and unrelated values.
- Require the loaded progress key to equal the rendered `(pod_id, scenario_id)` key.
- For Scenario 11, explicitly require M3 in addition to all configured milestones.

### `cyberrange/portal/src/lib/scenarioCompletion.test.ts` (new)

- Prove numeric `11` and string `"11"` work, while malformed/coercion-prone ids and other-scenario rows are rejected.
- Prove Scenario 11 M2-only is not complete.
- Prove Scenario 11 is complete only with its own M1/M2/M3 PASS rows.
- Prove a non-PASS result does not count.

### `cyberrange/portal/src/components/scenario/TerminalView.tsx`

- Reset `completed`, completion-modal state, and loaded-progress identity when `(pod_id, scenario.id)` changes.
- Associate each initial restoration/poll response with the key that issued it and ignore stale responses.
- Use the pure filtering helper for both initial restoration and polling as defense-in-depth.
- Use the completion helper only after progress for the current key has loaded, so Scenario 11 cannot display `Scenario complete!` before its own M3 PASS.
- Preserve existing toast, scoring, polling interval, and modal behavior.

### `cyberrange/portal/src/components/scenario/TerminalView.test.tsx` (new)

- Mock external terminal/session/API dependencies and use fake timers for polling.
- Exercise initial restoration with Scenario 11 M2-only and assert no completion modal.
- Exercise a rerender/transition from completed another-scenario state to Scenario 11 M2-only and assert stale ids/responses cannot open the modal.
- Exercise polling with foreign/malformed PASS rows and assert they cause neither completion nor success toasts.
- Exercise Scenario 11 own M1/M2/M3 PASS state and assert the completion modal opens.

### `cyberrange/portal/src/lib/api.ts`

- Correct the milestone response contract to `scenario_id: number | string` for compatibility with the actual numeric FastAPI response and any older string-shaped mocks.

### `cyberrange/portal/public/scenarios/scenario_01_network_reconnaissance.md`

- Tell students to leave the successful Metasploit session open and invoke Manual Check before exiting it.
- Explain that selecting/running the module or retaining command history is insufficient; M4 checks a currently established Metasploit session to the pod's meta target.

## Safeguards

- Live session evidence must come from the active Metasploit tmux pane, identify the Tomcat module and numbered session to this pod's derived meta address, and be corroborated by a current target-bound socket owned by the same pane/process; standalone writable log strings are not accepted as proof.
- Test overrides replace all evidence inputs and are disabled by default, preventing ambient host state from entering regressions.
- Scenario filtering happens at both initial fetch and polling ingestion, and stale async responses are key-checked.
- Completion derives from current-key required milestone ids, not point totals or previous component state.
- No database schema, API response, RBAC, credential, or deployment behavior changes.
- Preserve unrelated worktrees and untracked files by working only in the clean dedicated worktree.

## Verification

1. Focused pytest direct-Bash regressions for Scenario 1 M4, including unrelated/forged evidence negatives.
2. Full `test_score_verify_behavioral.py` suite.
3. Focused Jest `scenarioCompletion.test.ts` suite.
4. Focused Jest `TerminalView.test.tsx` component suite covering initial load, polling, transitions, toasts, and modal eligibility.
5. Portal TypeScript/lint or the narrowest available compile check if repository-wide lint contains pre-existing failures.
6. Production-path/manual validation on the lab stack (when available): run the documented Scenario 1 flow, keep the successful session open, and confirm Manual Check sees the Metasploit-owned established connection; then close/fail the exploit and confirm FAIL. If the lab stack is unavailable locally, record this as a required Lenie/live-environment validation rather than claiming it passed from fixtures.
7. Inspect final diff and confirm only scoped files changed.

## Acceptance criteria

- History-only or failed `tomcat_mgr_deploy` attempts return FAIL for Scenario 1 M4.
- A live Tomcat-module session shown in the active Metasploit tmux pane and corroborated by that process's established connection to this pod's meta target returns PASS without relying on history flush timing.
- Same-target connections without a session, different-module sessions, unrelated sessions, non-Metasploit sockets, and forged standalone session text return FAIL.
- Scenario 11 M2-only state never opens the completion modal.
- PASS rows from another scenario cannot contribute to Scenario 11 completion.
- Scenario 11 completion requires its own M1, M2, and M3 PASS states.
- Focused Bash/pytest and frontend regression suites pass.
- Both independent plan reviewers approve before production edits, and both final reviewers approve the finished diff and test evidence.
