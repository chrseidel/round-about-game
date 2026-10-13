# Task 13 Shared Reveal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a lock, every screen shows a 2-second shared build-up and reveals the result at the same server time, with instant feedback on the tap.

**Architecture:** `lockGap` stores `revealAtUtc` and `lockedBy`; the existing projection already hides the result until then. The browser derives what to show with a pure `revealed(snapshot, serverNow)`, re-renders once at the target, and adds an optimistic locked look plus CSS build-up animations.

**Tech Stack:** TypeScript, Node test runner via `tsx`, CSS animations, Vite, Amplify sandbox.

**Spec:** `docs/superpowers/specs/2026-10-13-task-13-shared-reveal-design.md`

## Global Constraints

- One feature commit at the end, then a separate docs commit with this plan.
- `REVEAL_DELAY_MS = 2000`; only `LOCK_GAP` sets `revealAtUtc`; timeouts reveal immediately.
- Copy verbatim: "Locking in…", "Locked in", "<Name> locked in. Revealing…", "You locked in. Revealing…".
- `prefers-reduced-motion`: no flip, fill or life animation.
- Redeploy `round-about-dev` before sandbox tests.

## Review Focus

1. A device clock that is seconds off must still reveal at the server's target, not early or late. Pinned in Task 2 (`revealed` uses server time from the offset).
2. A player reconnecting during the build-up must not see the result before the target. Pinned in Task 3 (sandbox `GET` before target) and the browser reload check.
3. A failed lock (stale selection) must remove the optimistic locked look. Pinned in Task 2 (`lockingGap` cleared on error) and the browser check.
4. A snapshot arriving after the target must show the result immediately, without a 2-second wait. Pinned in Task 2 (`revealed` at/after target).
5. An Overtime timeout must still show its result at once, with no pending reveal. Pinned in Task 1.

---

### Task 1: Server reveal time and locker

**Files:** Modify `shared/protocol.ts`, `shared/protocol.test.ts`, `amplify/functions/game-api/session.ts`, `session.test.ts`

**Interfaces:**
- Produces: `REVEAL_DELAY_MS`; `Session.lockedBy: string | null`; `PublicSnapshot.lockedBy: string | null`.

- [ ] **Step 1: Write failing tests**: `lock sets the shared reveal time` (`lockGap(..., now 2_000)` → `revealAtUtc 4_000`, `lockedBy` = locker; `projectCaller(locked, locker, 3_000)` has `result null`, `pendingReveal.result` set, `lockedBy` = locker; at 4_000 `result` set, `pendingReveal null`); `timeouts reveal immediately` (Overtime expiry via `reconcile` → `revealAtUtc null`, projection has `result`); new sessions have `lockedBy: null`.
- [ ] **Step 2: Run** `node --import tsx --test amplify/functions/game-api/session.test.ts shared/protocol.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the constant, `lockGap` fields, `newSession` default, projection field.
- [ ] **Step 4: Run** `npm run typecheck && npm test`. Expected: PASS.

### Task 2: Browser build-up and reveal

**Files:** Modify `web/turn.ts`, `web/turn.test.ts`, `web/board.ts`, `web/play.ts`, `web/main.ts`, `game.css`

**Interfaces:**
- Consumes: `lockedBy`, `revealAtUtc`, `pendingReveal` in snapshots.
- Produces: `revealed(snapshot: CallerSnapshot, serverNow: number): CallerSnapshot`; `turnView` pending texts; `gapCommand` null while pending; `renderBoard` state gains `lockedGap: number | null`; `TurnView.revealAtUtc: number | null` (for the progress bar).

- [ ] **Step 1: Write failing tests** in `web/turn.test.ts`: `revealed switches at the server target` (pending snapshot with `revealAtUtc 10_000`: at 9_999 unchanged; at 10_000 phase `result`, `result` and `cards` from `pendingReveal`, `pendingReveal null`, `selectedGap null`); `no gap clicks while revealing` (`gapCommand` on a pending snapshot → null); `build-up texts` (pending, `lockedBy` Carol: Alice's heading "Locked in", description "Carol locked in. Revealing…"; Carol's description "You locked in. Revealing…").
- [ ] **Step 2: Run** `node --import tsx --test web/turn.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**: `revealed` and texts in `turn.ts`; `renderTurn` shows a `.reveal-progress` bar when `view.revealAtUtc` is set, its `animationDuration` from the remaining server time; `board.ts` adds class `locked` to `lockedGap` and `is-recent` to `recent`; `play.ts` renders `revealed(snapshot, serverNow)` with `lockedGap` = local `lockingGap` ?? pending `selectedGap`, `recent` = `result.number` when revealed; `main.ts` sets `lockingGap` synchronously on a `LOCK_GAP` click (render before sending), clears it when the command ends, and keeps one timer that re-renders at `revealAtUtc − serverNow`; `game.css` adds the locked look, hourglass flip, progress fill, result colours, life-loss animation, all disabled under `prefers-reduced-motion`.
- [ ] **Step 4: Run** `npm run check`. Expected: PASS.

### Task 3: Deploy, verify, commit

**Files:** Create `scripts/check-reveal.ts`; modify `TASKS.md`, `DEVELOPMENT_HANDOFF.md`

- [ ] **Step 1: Write** `scripts/check-reveal.ts <gameApiUrl> <gameEventsUrl>` per the spec's sandbox list; print event lead time (target − arrival) and exit 1 on any mismatch.
- [ ] **Step 2: Deploy**, then **run** `check-reveal.ts`, `check-gaps.ts`, `check-clue.ts`, `check-timeouts.ts`, `check-lobby.ts`, `check-events.ts`. Expected: all succeed.
- [ ] **Step 3: Browser test** per the spec: reveal spread across three tabs, synchronous locked look, progress bar everywhere, no early result after a reload during the build-up.
- [ ] **Step 4: Commit** after `npm run check`: `feat: reveal results at a shared time`; then docs: `docs: record Task 13 completion`.
