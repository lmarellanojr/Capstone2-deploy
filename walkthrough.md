# Walkthrough: Scenario 1 personal capture flag

## Branch and tree

- Repo worktree: isolated checkout of `Capstone2-deploy`
- Branch: `fix/scenario1-personal-flag`
- Base: `220e6d34ee36a30fee0f9bd5b5a3d651d96ac3c3` (merge of PR #172)
- Commit: `d03eb3a` (rebased on current `origin/main`)

## Requirement

Remove the Task 1 and Task 2 “Done when” notes. Scenario 1 Task 5 no longer accepts the shared Kali username (`student`); each student gets a unique HMAC FLAG file on Kali.

## What changed

- `flag_planting.py`: removed `read_kali_whoami`. Added `prepare_scenario_flags`, fatal Kali M5 plant at `/opt/cyberrange/flags/scenario1.txt` (`root:root` `0644`, dirs `0755`, positional `printf '%s\n' "$1"`). S1 plant-before-save; 6/9/11 stay save-before-plant and fail-open.
- `provision.py`: `plant_flags_during_provision`. Any Scenario 1 flag failure logs allowlisted `FLAGS_PLANTED_FAIL` (`scenario=1, reason=...`) and raises `RuntimeError("Scenario 1 flag planting failed") from None`, so the pod never becomes ACTIVE. Other scenarios remain nonfatal.
- `rubrics.py`: authenticated S1 M5 requires stored row == `generate_milestone_flag`; leftover `student`/`tomcat`, missing rows, and other users’ tokens fail.
- `schema/v11.sql`: `UPDATE` name/criteria only (no expected_flag/points/schema shape).
- Guide, `useScenarios.ts`, and rubric copy: `cat /opt/cyberrange/flags/scenario1.txt`; usernames are not valid flags.
- Active lab layout: guide and CLI split evenly on screens at least 900px wide; narrow screens keep the stacked layout.

Existing labs must End Session then Start lab after deploy. Previously awarded PASS rows are unchanged.

## Tests

From `cyberrange/`:

```
uv run --extra dev python -m pytest src/provisioning/test_flag_planting.py src/provisioning/test_score_hybrid.py -q
```

Result: **59 passed**, 13 warnings (existing FastAPI `on_event` deprecation).

Also: `python -m compileall` on changed provisioning modules; `git diff --check` clean.

Not run: portal `npm test` (no `node_modules` in this worktree).

The equal-pane layout received a static diff review; no live browser screenshot was captured.

## Reviews

- Plan: Anti APPROVED; Codex APPROVED (after one CHANGES REQUESTED round).
- Final code review: Anti APPROVED FOR MERGE; Codex APPROVED (ALL CHECKS PASS). Both also approved the equal-pane desktop layout in static review.

## Limits

- No live host provision. Unit tests use mocked LXD.
- `v11.sql` is untracked until commit.
- Do not commit `cyberrange/uv.lock` from this worktree unless asked.
- Deploy planting, validator, and guide together. Old pods keep a stored username until reprovision; the new validator rejects those usernames immediately.
