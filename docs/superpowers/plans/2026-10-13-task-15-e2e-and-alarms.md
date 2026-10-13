# Task 15 End-to-End and Alarms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove a full game in the development stack, add throttle and server-error alarms, show an alarm firing, and document a production smoke procedure.

**Architecture:** Two CloudWatch alarms in `backend.ts` (verified by deploying, since the Amplify backend is not unit-synthesizable here); a sequential runner for the existing sandbox scripts with a small tested step list; an alarm script that injects and removes one test message; a long browser run with one phone-sized tab; `docs/SMOKE.md`.

**Tech Stack:** AWS CDK (CloudWatch alarms, math expressions), SQS, Node test runner via `tsx`, built-in browser.

**Spec:** `docs/superpowers/specs/2026-10-13-task-15-e2e-and-alarms-design.md`

## Global Constraints

- One feature commit at the end, then a separate docs commit with this plan.
- Alarms without actions. Throttles: sum over the five game functions, ≥ 1 in 60 s. API 5xx: ≥ 1 in 300 s. Missing data not breaching.
- The alarm test deletes only its own message (body `{ "test": "check-alarm" }`).
- Sandbox scripts run sequentially (concurrency limit 10).
- Production smoke may only use `check-events`, `check-lobby`, `check-clue`, `check-reveal`.

## Review Focus

1. A smoke run must stop at the first failing script and say which one, not continue and report green. Pinned in Task 2 (`runSteps` stops and returns the failing name).
2. The alarm test must not delete unrelated messages already in the failure queue. Pinned in Task 2 (body match) and noted in the script header.
3. A phone-width screen must not need horizontal scrolling during any phase. Pinned in Task 3 (`scrollWidth <= innerWidth` checked per phase).
4. A reconnecting Guesser mid-turn must show the current phase and countdown, not a stale one. Pinned in Task 3 browser run.
5. Production scripts must not write to the table. Pinned in Task 4 (`SMOKE.md` lists only API-only scripts; table-writing scripts carry a header warning).

---

### Task 1: Alarms

**Files:** Modify `amplify/backend.ts`

- [ ] **Step 1:** Add `LambdaThrottlesAlarm` (`MathExpression` `t1+t2+t3+t4+t5` over each function's `metricThrottles({ period: 60 s, statistic: "Sum" })`, threshold 1, 1 period) and `GameApiServerErrorsAlarm` (`api.metricServerError({ period: 300 s })`, threshold 1, 1 period), comparison ≥, missing data not breaching, no actions.
- [ ] **Step 2: Run** `npm run check`. Expected: PASS (typecheck covers the CDK code).
- [ ] **Step 3: Deploy** and run `aws cloudwatch describe-alarms` for `roundabout`. Expected: five alarms, all `OK` or `INSUFFICIENT_DATA` turning `OK`.

Ruling recorded at execution: no unit test for CDK constructs; verified by deployment.

### Task 2: Smoke runner and alarm test

**Files:** Create `scripts/smoke-steps.ts`, `scripts/smoke-steps.test.ts`, `scripts/smoke-dev.ts`, `scripts/check-alarm.ts`; modify `package.json` (`smoke:dev` script, test list)

**Interfaces:**
- Produces: `smokeSteps(api: string, events: string): { name: string; args: string[] }[]` (the seven scripts in the spec's order with their arguments); `runSteps(steps, run: (step) => Promise<boolean>): Promise<{ passed: string[]; failed: string | null }>`.

- [ ] **Step 1: Write failing tests** in `scripts/smoke-steps.test.ts`: `steps cover every sandbox script in order` (names equal `["check-events","check-lobby","check-clue","check-gaps","check-reveal","check-timeouts","check-progress"]`; `check-lobby` args `[api]`, `check-events` args `[api, events]`); `runSteps stops at the first failure` (fake `run` failing on `check-clue` → `failed "check-clue"`, `passed ["check-events","check-lobby"]`, `check-gaps` never called).
- [ ] **Step 2: Run** `node --import tsx --test scripts/smoke-steps.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `smoke-steps.ts`; `smoke-dev.ts` reads `amplify_outputs.json`, spawns `tsx scripts/<name>.ts …args` per step (inherit output), prints a summary with durations, exits 1 on failure; `check-alarm.ts` per the spec. Add a "development only — writes to the sandbox table/queue" header comment to `check-timeouts.ts`, `check-gaps.ts`, `check-progress.ts`, `check-alarm.ts`.
- [ ] **Step 4: Run** `npm run check`, then `AWS_PROFILE=chreisel npm run smoke:dev` and `AWS_PROFILE=chreisel npx tsx scripts/check-alarm.ts`. Expected: all pass; alarm reaches `ALARM` and back to `OK`.

### Task 3: Browser end-to-end run

**Files:** none planned (fixes only if the run finds problems)

- [ ] **Step 1:** Three tabs (Alice host, Bob Tipster, Carol Guesser); Carol's tab at `mobile` preset (375 × 812). Play the lobby and at least three turns with real clicks, including: Carol reloads mid-turn; Dave joins mid-game via a fourth tab or API; Alice and Carol tap at the same moment; one clue runs into grace and expires.
- [ ] **Step 2:** In every phase, check Carol's tab: `document.documentElement.scrollWidth <= innerWidth`, the gaps and buttons are inside the viewport, the panel text is visible. Screenshots if the pane is displayed.
- [ ] **Step 3:** Lower the pile with the Task 14 helper, finish the game through the UI, start a new session as host, everyone joins.
- [ ] **Step 4:** Record each finding; fix small ones test-first, record the rest.

### Task 4: Smoke procedure, commit

**Files:** Create `docs/SMOKE.md`; modify `TASKS.md`, `DEVELOPMENT_HANDOFF.md`

- [ ] **Step 1: Write** `docs/SMOKE.md` per the spec: development (`npm run smoke:dev`, `check-alarm.ts`) and production (four API-only scripts with production endpoints, then the two-device manual run at `https://round-about.chreisel.net`), what failure looks like, where to look.
- [ ] **Step 2: Commit** after `npm run check`: `feat: add alarms, smoke runner and alarm test`; then docs (SMOKE.md, Task 15 status, handoff, this plan): `docs: record Task 15 completion and smoke procedure`.
