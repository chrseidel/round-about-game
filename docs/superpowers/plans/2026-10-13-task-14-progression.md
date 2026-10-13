# Task 14 Progression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Games run from first card to win or loss, the Tipster advances turns, and the host can hand everyone over to a fresh session.

**Architecture:** `finalStatus` decides the end at each result (lock or timeout), so the projection reveals it with the result. `nextTurn` (also inside `drawCard` from `result`) advances after the reveal. `POST /sessions` with `replaces` creates a new session and leaves a `nextSquid` pointer on the old one; the browser offers a one-click Join.

**Tech Stack:** TypeScript, Node test runner via `tsx`, DynamoDB, Vite, Amplify sandbox.

**Spec:** `docs/superpowers/specs/2026-10-13-task-14-progression-design.md`

## Global Constraints

- One feature commit at the end, then a separate docs commit with this plan.
- Copy verbatim: "Wait for the reveal.", "Only the host can start a new session.", "This game has moved to a new session.", "Draw next card", "Draw replacement", "Waiting for Bob to draw the next card.", "You won!", "Last card placed correctly.", "Game over", "Overtime ended.", "New game", "Alice started a new game.", "Join".
- Old session after replacement: `expiresAt` = now + 600 s; every command refused.
- Redeploy `round-about-dev` before sandbox tests.

## Review Focus

1. A Tipster double-clicking "Draw next card" must not skip a card: the retry must return the drawn card. Pinned in Task 2 (draw from result, then again → same object).
2. A Guesser on a stale page after the host moved must get "This game has moved to a new session." for any click, not a confusing error. Pinned in Task 2.
3. A winning last card in Overtime must show "You won!", not "Game over". Pinned in Task 1 (`finalStatus` correct with lives 0 and pile 0).
4. Joining the new session with a nickname already taken there must show the error in the panel, not break the page. Pinned in Task 3 (`turnView` join mode error path) and the browser test.
5. A late joiner to a finished game must see the end panel, not a draw button. Pinned in Task 3 (`turnView` for status `won`/`lost`).

---

### Task 1: End of game at the result

**Files:** Modify `shared/deadlines.ts`, `shared/deadlines.test.ts`, `amplify/functions/game-api/session.ts`, `session.test.ts`

**Interfaces:**
- Produces: `finalStatus(game: Game): SessionStatus` (in `shared/deadlines.ts`); `reconcile` and `lockGap` set `status` from it.

- [ ] **Step 1: Write failing tests**: `finalStatus` (lost result → "lost"; correct with pile 0 → "won", also with lives 0; correct with pile 3 → "playing"; wrong with pile 0 and lives 2 → "playing"); `Overtime timeout loses the session` (reconcile at the deadline → `status "lost"`); `grace discard at 0 lives loses` (`status "lost"`); in `session.test.ts`: `correct last card wins` (pile 0, lock the correct gap → `status "won"`); `wrong last card continues` (pile 0, wrong gap, lives 3 → `status "playing"`); `Overtime wrong lock loses` (lives 0 → `"lost"`).
- [ ] **Step 2: Run** `node --import tsx --test shared/deadlines.test.ts amplify/functions/game-api/session.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `finalStatus` and apply it in `reconcile` (when a timeout ran) and `lockGap`. The correct gap for tests: the index of the last card below `current` (wrap to the last card).
- [ ] **Step 4: Run** the same command. Expected: PASS.

### Task 2: Next turn and new session on the server

**Files:** Modify `amplify/functions/game-api/session.ts`, `session.test.ts`, `command.ts`, `command.test.ts`, `handler.ts`, `shared/protocol.ts`, `shared/protocol.test.ts`

**Interfaces:**
- Produces: `nextTurn(session: Session, participantId: string, now: number): Session`; `drawCard` accepting phase `result`; `applyCommand` handles `NEXT_TURN` and refuses everything on a moved session; `replaceSession(old: Session, participantId: string, now: number): { session: Session; participantId: string; credential: string; old: Session }`; `Session.nextSquid?: string | null`; `PublicSnapshot.nextSquid: string | null`; `POST /sessions` body `{ nickname, replaces? }`.

- [ ] **Step 1: Write failing tests**: `next turn waits for the reveal and clears it` (Guesser → `FORBIDDEN` "Only the Tipster can draw."; before `revealAtUtc` → `INVALID_PHASE` "Wait for the reveal."; after → phase `ready`, `revealAtUtc null`, `lockedBy null`, `current null`, version + 1); `draw next card advances and draws` (from `result` after the reveal → phase `tip`, a new `current` not in the old circle, same Tipster; calling again returns the same object); `replacement after a wrong last card` (pile 0 → draw → pile 0, phase `tip`); `new session replaces the old` (host → new squid ≠ old, status `lobby`, `tipsterId null`, pile 12, 3 cards, host nickname kept; old `nextSquid` = new squid, `expiresAt` = now/1000 + 600, version + 1; non-host → `FORBIDDEN` "Only the host can start a new session."); `moved sessions refuse commands` (`applyCommand` on a session with `nextSquid` → `INVALID_PHASE` "This game has moved to a new session."); `protocol`: `nextSquid` projected (null by default).
- [ ] **Step 2: Run** `node --import tsx --test amplify/functions/game-api/session.test.ts amplify/functions/game-api/command.test.ts shared/protocol.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the rules; in `handler.ts` `POST /sessions` with `replaces`: authenticate against the old session, `replaceSession`, put the new session (`attribute_not_exists`), then put the old one conditional on its loaded version; answer 201 with the new grant.
- [ ] **Step 4: Run** `npm run typecheck && npm test`. Expected: PASS.

### Task 3: Browser progression and handoff

**Files:** Modify `web/turn.ts`, `web/turn.test.ts`, `web/session-api.ts`, `web/main.ts`, `web/play.ts`

**Interfaces:**
- Consumes: `nextSquid`, statuses `won`/`lost`, `POST /sessions` with `replaces`.
- Produces: `TurnView.drawLabel: string`; `TurnView.mode` adds `"join"`; `SessionApi.newSession(nickname: string, replaces: string, token: string): Promise<ParticipantGrant>`; `showSession(...)` returns `() => void` (leave).

- [ ] **Step 1: Write failing tests** in `web/turn.test.ts` per the spec's table: result + playing → Tipster `mode "draw"`, `drawLabel "Draw next card"` (pile 0 → "Draw replacement"), Guesser description "Waiting for Bob to draw the next card."; `won` → "You won!" / "Last card placed correctly.", mode `none` for everyone; `lost` → "Game over" / "Overtime ended."; `nextSquid` with host Alice → "New game" / "Alice started a new game.", mode `"join"`.
- [ ] **Step 2: Run** `node --import tsx --test web/turn.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**: `turnView` and `renderTurn` (draw button uses `drawLabel`; join mode renders a "Join" button wired to `actions.join`); `SessionApi.newSession`; `main.ts`: `#newGameButton` shown for the host, confirm via `#confirmDialog` while `status === "playing"`, then `newSession` → leave → remember grant → `history.replaceState` → `showSession(new)`; `actions.join`: `api.join(nextSquid, myNickname)` → same switch; errors into the panel note. `showSession` returns `leave()` that closes events and clears interval, reveal timer and resize listener.
- [ ] **Step 4: Run** `npm run check`. Expected: PASS.

### Task 4: Deploy, verify, commit

**Files:** Create `scripts/check-progress.ts`; modify `TASKS.md`, `DEVELOPMENT_HANDOFF.md`

- [ ] **Step 1: Write** `scripts/check-progress.ts <gameApiUrl>` per the spec's (a)–(d), writing near-end states into the sandbox table like `check-timeouts.ts`.
- [ ] **Step 2: Deploy**, then **run** `check-progress.ts` and all earlier scripts. Expected: all succeed.
- [ ] **Step 3: Browser test** per the spec (three tabs: next card, game end, new-session handoff).
- [ ] **Step 4: Commit** after `npm run check`: `feat: complete game progression and new sessions`; then docs: `docs: record Task 14 completion`.
