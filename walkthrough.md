# SCORE-FALSEPOS walkthrough

## Branch and tracking

- Branch: `feature/score-falsepos-gates`
- GitHub issue: [#114](https://github.com/lmarellanojr/Capstone2-deploy/issues/114)
- Related issue #96 remains closed and unchanged.
- Commit: `104de72` (`fix scoring false positives and completion gates`).

## Resolved requirements

- Scenario 1 M4 no longer passes from command history or module selection alone. It checks the live Metasploit tmux pane, Tomcat module context, numbered session-open output to the pod's actual meta IP and peer port, `msfconsole` process identity, and an established socket owned by that process to the exact same target endpoint.
- Scenario 11 completion waits for progress belonging to the current `(pod_id, scenario_id)`, ignores stale requests, filters PASS milestones to the active scenario, and requires M3.
- The Scenario 1 guide now tells students to keep the successful session open until Manual Check passes.

## Changed files

- `cyberrange/src/provisioning/scoring_checks.sh`
- `cyberrange/src/provisioning/test_score_verify_behavioral.py`
- `cyberrange/portal/src/components/scenario/TerminalView.tsx`
- `cyberrange/portal/src/components/scenario/TerminalView.test.tsx`
- `cyberrange/portal/src/lib/scenarioCompletion.ts`
- `cyberrange/portal/src/lib/scenarioCompletion.test.ts`
- `cyberrange/portal/src/lib/api.ts`
- `cyberrange/portal/public/scenarios/scenario_01_network_reconnaissance.md`

## Verification evidence

- `uv run --no-project --with pytest --with httpx --with anyio --with fastapi --with pydantic --with requests --with urllib3 --with uvicorn --with pylxd --python 3.11 python -m pytest cyberrange/src/provisioning/test_score_verify_behavioral.py -q` — **67 passed**, 10 existing FastAPI deprecation warnings.
- `npm.cmd test -- --runInBand src/lib/scenarioCompletion.test.ts src/components/scenario/TerminalView.test.tsx` — **2 suites, 7 tests passed**.
- Git Bash `bash -n ../src/provisioning/scoring_checks.sh` — passed.
- `node node_modules/typescript/bin/tsc --noEmit --target ES2017 --module ESNext --moduleResolution bundler --strict --skipLibCheck src/lib/scenarioCompletion.ts` — passed.
- Full portal `tsc --noEmit` remains blocked by the existing `src/middleware.test.ts:135` Set-iteration diagnostic. Targeted Jest tests type-transpile and pass.
- `npm run lint -- --file ...` could not run because `next lint` prompts for first-time ESLint configuration. No config was created.
- Live LXD/Metasploit production validation was not available in this local environment; Lenie should reproduce the failed exploit and live-session cases on the lab stack.
- `git diff --check` — passed.

## Plan and final reviews

- Anti plan review: **APPROVED**.
- Codex plan review: **APPROVED**.
- Anti final diff review: **APPROVED FOR MERGE**.
- Codex final diff review: **APPROVED (ALL CHECKS PASS)**.

## Remaining limitation

The fixture tests verify parsing and process/socket correlation. They do not replace the requested live lab reproduction by Lenie.
