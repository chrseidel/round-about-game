# Task 12 Gap Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Any Guesser selects a gap for the team; a second click on the shown selection locks it once, and everyone sees the result.

**Architecture:** Two rules (`chooseGap`, `lockGap`) behind the command endpoint, with a strict version check for locking and a per-session memory of the last 20 command IDs. The browser enables gaps only for Guessers while guessing and extends `turnView` with selection and result texts.

**Tech Stack:** TypeScript, Node test runner via `tsx`, Vite, Amplify sandbox.

**Spec:** `docs/superpowers/specs/2026-10-13-task-12-gap-selection-design.md`

## Global Constraints

- One feature commit at the end, then a separate docs commit with this plan.
- Copy verbatim: "The Tipster can't choose a gap.", "The Tipster can't lock a gap.", "Guessing is not open right now.", "Choose a gap in the circle.", "The selection changed. Tap again to lock in.", "Tap ⌛ again to lock it in.", "Correct!", "Wrong gap", "Time ran out", "X · N sits between L and U.", " Life lost.", "Overtime ended."
- `STALE_VERSION` answers HTTP 409. Retry memory keeps exactly the last 20 IDs and never appears in projections.
- Redeploy `round-about-dev` before sandbox tests; after any `npm install` repair the lockfile (`npm install --package-lock-only`, `npm ci --dry-run`).

## Review Focus

1. A Guesser double-tapping a fresh gap quickly sends `CHOOSE_GAP` then, before the response, a second click that must not become an unconfirmed lock. Pinned in Task 3 (`gapCommand` uses only the confirmed `selectedGap`; in-flight clicks ignored).
2. A retried lock after a lost response must return 200 with the result, not 409. Pinned in Task 4 (sandbox: resend same `commandId`).
3. A lock arriving after Overtime expired must not grade: it must answer "Guessing is not open right now." Pinned in Task 1.
4. Choosing a gap must never move or reset the Overtime deadline. Pinned in Task 1.
5. An index outside the circle (negative, too large, non-integer) must be rejected as input, not crash. Pinned in Task 1 and Task 2 (parse).

---

### Task 1: Gap rules

**Files:** Modify `amplify/functions/game-api/session.ts`, `session.test.ts`, `shared/deadlines.test.ts`

**Interfaces:**
- Produces: `chooseGap(session: Session, participantId: string, index: number): Session`; `lockGap(session: Session, participantId: string, index: number, expectedVersion: number, now: number): Session`; `CommandError` code `"STALE_VERSION"`.

- [ ] **Step 1: Write failing tests** (game in phase `guess` after Bob draws at 0 and sends "river"; Guessers Alice, Carol):
  - `choose: Guessers only, while guessing, valid gaps`: Bob → `FORBIDDEN` "The Tipster can't choose a gap."; phase `tip` → `INVALID_PHASE` "Guessing is not open right now."; index `-1`, `3` (3 cards), `1.5` → `INVALID_INPUT` "Choose a gap in the circle."; Alice index 1 → `selectedGap 1`, version + 1, phase `guess`; choosing 1 again returns the identical object.
  - `choose keeps the Overtime deadline`: lives 0, deadline 40_000 → after choosing, deadline 40_000.
  - `lock: strict and once`: Bob → `FORBIDDEN` "The Tipster can't lock a gap."; index ≠ selection → `STALE_VERSION` "The selection changed. Tap again to lock in."; correct index with `expectedVersion` one lower → `STALE_VERSION`; correct index and version → phase `result`, `lastResult.guessedGap` equals index, 4 cards, version + 1.
  - `lock after Overtime expiry is refused`: Overtime with selection, `reconcile` at the deadline then `lockGap` → `INVALID_PHASE` "Guessing is not open right now.".
  - In `deadlines.test.ts`: `selected but unlocked gap at Overtime expiry is a miss`: `timedOut true`, `correct false`, `lost true`.
- [ ] **Step 2: Run** `node --import tsx --test amplify/functions/game-api/session.test.ts shared/deadlines.test.ts`. Expected: FAIL (missing exports); the deadlines test may already pass (pins existing reducer behaviour).
- [ ] **Step 3: Implement** the two rules in the spec's check order.
- [ ] **Step 4: Run** the same command. Expected: PASS.

### Task 2: Commands, retry memory, handler

**Files:** Modify `amplify/functions/game-api/command.ts`, `command.test.ts`, `handler.ts`, `shared/protocol.ts` (`Session.recentCommands?: string[]`)

**Interfaces:**
- Consumes: Task 1 rules.
- Produces: `applyCommand(session, participantId, command, expectedVersion: number, now: number)`; `alreadyApplied(session: Session, commandId: string): boolean`; `rememberCommand(session: Session, commandId: string): Session`.

- [ ] **Step 1: Write failing tests** in `command.test.ts`: `parse requires gap indexes` (`CHOOSE_GAP` without integer `index` → `INVALID_INPUT`; `LOCK_GAP` with `index: "1"` → `INVALID_INPUT`; `expectedVersion: "3"` → `INVALID_INPUT`); `retry memory keeps the last 20 commands` (21 IDs remembered → first forgotten, last 20 kept in order, `alreadyApplied` true for the 21st); `apply passes the expected version to lock` (lock via `applyCommand` with the stored version succeeds, with version − 1 throws `STALE_VERSION`); existing calls updated to the new signature; `projectPublic` output has no `recentCommands`.
- [ ] **Step 2: Run** `node --import tsx --test amplify/functions/game-api/command.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**: parsing, dispatch of `CHOOSE_GAP`/`LOCK_GAP`, the two helpers; in `handler.ts` `runCommand` checks `alreadyApplied` after every load (200 with `projectCaller(reconcile(...))`, no write), writes `rememberCommand(next, commandId)`, maps `STALE_VERSION` → 409.
- [ ] **Step 4: Run** `npm run typecheck && npm test`. Expected: PASS.

### Task 3: Gaps and result in the browser

**Files:** Modify `web/turn.ts`, `web/turn.test.ts`, `web/play.ts`, `web/main.ts`

**Interfaces:**
- Consumes: commands `CHOOSE_GAP`/`LOCK_GAP` with `expectedVersion` = `latest.version` (already sent by `SessionApi.command`).
- Produces: `gapCommand(snapshot: CallerSnapshot, participantId: string, index: number): SessionCommand | null` (null for the Tipster or outside `guess`; `LOCK_GAP` when `index === selectedGap`, else `CHOOSE_GAP`); `turnView` result and selection texts.

- [ ] **Step 1: Write failing tests** in `web/turn.test.ts`: `gap clicks choose or lock` (Guesser on gap 2 with selection 1 → `{type:"CHOOSE_GAP", index:2}`; on gap 1 → `{type:"LOCK_GAP", index:1}`; Tipster → null; phase `tip` → null); `selection hint` (Guesser with `selectedGap 1` → description "Tap ⌛ again to lock it in."); `result texts` (correct: heading "Correct!", description "river · 42 sits between Moss and Lantern."; wrong: "Wrong gap", description ends " Life lost."; lost Overtime: description ends "Overtime ended."; timed out: heading "Time ran out").
- [ ] **Step 2: Run** `node --import tsx --test web/turn.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** in `turn.ts`; `play.ts` passes a `selectGap` handler to `renderBoard` only when `gapCommand` can return a command; `main.ts` sends it via `send`, ignoring clicks while a gap command is in flight, and shows `STALE_VERSION` messages in the panel note.
- [ ] **Step 4: Run** `npm run check`. Expected: PASS.

### Task 4: Deploy, verify, commit

**Files:** Create `scripts/check-gaps.ts`; modify `TASKS.md`, `DEVELOPMENT_HANDOFF.md`

- [ ] **Step 1: Write** `scripts/check-gaps.ts <gameApiUrl>` per the spec's three games (third game writes Overtime into the sandbox table with the default AWS credential chain, like `check-timeouts.ts`). Exit 1 on any mismatch.
- [ ] **Step 2: Deploy** and wait a minute.
- [ ] **Step 3: Run** with `AWS_PROFILE=chreisel`: `check-gaps.ts`, `check-clue.ts`, `check-timeouts.ts`, `check-lobby.ts`, `check-events.ts`. Expected: all succeed.
- [ ] **Step 4: Browser test** per the spec (time-sensitive steps in one batch).
- [ ] **Step 5: Commit** after `npm run check`: `feat: add shared two-click gap selection`; then docs: `docs: record Task 12 completion`.
