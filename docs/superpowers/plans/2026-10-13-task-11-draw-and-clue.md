# Task 11 Draw and Clue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Tipster privately draws a card and sends a word; everyone else follows the turn from server state.

**Architecture:** Two new command rules in `session.ts` behind the existing endpoint; snapshots carry server time. In the browser, a multiplayer view replaces the prototype once a session starts: `board.ts` draws the circle, a new pure `turnView` decides the turn panel, and `mergePrivate` keeps the Tipster's number between public events.

**Tech Stack:** TypeScript, Node test runner via `tsx`, Vite, existing Amplify sandbox.

**Spec:** `docs/superpowers/specs/2026-10-13-task-11-draw-and-clue-design.md`

## Global Constraints

- One feature commit at the end, then a separate docs commit with this plan.
- Error copy verbatim: "Only the Tipster can draw.", "The game has not started.", "No card can be drawn now.", "Only the Tipster can send the word.", "Time is up for this card."; bad words use `clueError`'s message.
- `currentDraw` only in the Tipster's own HTTP responses, phases `tip`/`grace`; never in public events or Guesser snapshots.
- Drafts never leave the page except via Send word. User text only through `textContent`.
- Redeploy `round-about-dev` (`AWS_PROFILE=chreisel`, Node v22.23.3) before sandbox tests; after any `npm install`, run `npm install --package-lock-only` and check `npm ci --dry-run`.

## Review Focus

1. A double-tapped Draw card must show the same drawn number, not an error. Pinned in Task 1 (draw retry returns the same object).
2. Sending a word with surrounding spaces or different case than a circle word must give the duplicate error, not slip through. Pinned in Task 1 (" moss " against card "Moss").
3. A public event arriving right after the Tipster's draw response must not hide the Tipster's number. Pinned in Task 3 (`mergePrivate`).
4. A device clock several seconds off must still show the server's remaining time. Pinned in Task 3 (countdown with offset).
5. A reconnecting Guesser after the draw must not receive the number from the catch-up snapshot. Pinned in Task 4 (sandbox script Guesser `GET`).

---

### Task 1: Draw and clue rules

**Files:** Modify `amplify/functions/game-api/session.ts`, `session.test.ts`, `command.ts`, `command.test.ts`

**Interfaces:**
- Produces: `drawCard(session: Session, participantId: string, now: number): Session`; `submitClue(session: Session, participantId: string, clue: string, now: number): Session`; `applyCommand` dispatches `DRAW` and `SUBMIT_CLUE`; `parseCommandRequest` rejects `SUBMIT_CLUE` without a string `clue`.

- [ ] **Step 1: Write failing tests** (started game: host Alice, Tipster Bob, Guesser Carol, at `now = 0`):
  - `draw: only the Tipster, once per card`: Carol → `FORBIDDEN` "Only the Tipster can draw."; lobby session → `INVALID_PHASE` "The game has not started."; Bob → phase `tip`, `current` set, deadline 20_000, version + 1; drawing again returns the identical object.
  - `clue: only the Tipster, valid word, in time`: Carol → `FORBIDDEN` "Only the Tipster can send the word."; `"two words"` → `INVALID_INPUT` with `clueError("two words", cards)`; `" moss "` with a circle card "Moss" → `INVALID_INPUT` duplicate message; valid at 5_000 → phase `guess`, `clue` set, deadline null (lives 3), version + 1; same clue again returns the identical object; with lives 0 → guess deadline `now + 20_000`.
  - `clue in grace is accepted, after expiry it is too late`: drawn at 0; at 21_000 after `reconcile` (phase grace) → accepted; via `applyCommand(..., 24_000)` → `INVALID_PHASE` "Time is up for this card.".
  - `parse requires a clue string`: `{ type: "SUBMIT_CLUE" }` → `INVALID_INPUT`.
- [ ] **Step 2: Run** `node --import tsx --test amplify/functions/game-api/session.test.ts amplify/functions/game-api/command.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the rules in the spec's order; `submitClue` applies `SUBMIT_CLUE` then `BEGIN_GUESS` with the same `now`.
- [ ] **Step 4: Run** the same command. Expected: PASS.

### Task 2: Server time and private-number projection

**Files:** Modify `shared/protocol.ts`, `shared/protocol.test.ts`

**Interfaces:**
- Produces: `PublicSnapshot.serverTimeUtc: number`.

- [ ] **Step 1: Write failing tests**: `snapshots carry server time` (`projectPublic(s, 1234).serverTimeUtc === 1234`); `drawn number never reaches Guessers or events` (after `DRAW`, `projectCaller(s, guesser, t)` has no `currentDraw` and `JSON.stringify(publicEvent(s, t))` contains neither `"currentDraw"` nor `` `"number":${s.game.current}` ``).
- [ ] **Step 2: Run** `node --import tsx --test shared/protocol.test.ts`. Expected: FAIL on `serverTimeUtc`.
- [ ] **Step 3: Implement** `serverTimeUtc: now` in `projectPublic`.
- [ ] **Step 4: Run** `npm run typecheck && npm test`. Expected: PASS.

### Task 3: Multiplayer board and turn panel

**Files:**
- Create: `web/turn.ts`, `web/turn.test.ts`
- Modify: `web/board.ts`, `web/main.ts`, `web/lobby.ts` (hide after start), `game.css`, `package.json` (test list)

**Interfaces:**
- Consumes: `serverTimeUtc`, commands `DRAW`/`SUBMIT_CLUE` via `SessionApi.command`.
- Produces: `type TurnView = { heading: string; description: string; mode: "draw" | "write" | "wait" | "none"; secret: number | null; countdown: boolean; clue: string | null }`; `turnView(snapshot: CallerSnapshot, participantId: string): TurnView`; `mergePrivate(previous: CallerSnapshot | null, next: CallerSnapshot): CallerSnapshot`; `secondsLeft(deadlineUtc: number | null, offsetMs: number, now: number): number`; `renderBoard(state, selectGap?)`.

- [ ] **Step 1: Write failing tests** in `web/turn.test.ts`:
  - `Tipster and Guesser views per phase`: `ready` → Tipster `mode "draw"`, heading "Your turn"; Guesser `mode "wait"`, description "Waiting for Bob to draw."; `tip` with `currentDraw: 42` → Tipster `mode "write"`, `secret 42`, `countdown true`; Guesser description "Bob is thinking of a word.", `countdown true`, `secret null`; `grace` → Tipster heading "Last chance", Guesser description "Last seconds…"; `guess` with clue "river" → Tipster description "Your word: river. The team is guessing.", Guesser heading "Choose a gap.", `countdown` only when `deadlineUtc` is set; `result` with discarded result → heading "Card discarded" for both, description "Time ran out.".
  - `mergePrivate keeps the number within the same card`: previous `{turn 1, phase tip, currentDraw 42}`, next `{turn 1, phase grace}` → `currentDraw 42`; next `{phase guess}` → none; next `{turn 2, phase tip}` → none; next carrying `currentDraw 7` → 7.
  - `countdown follows server time`: `secondsLeft(20_000, 5_000, 10_000) === 5`; `secondsLeft(20_000, 0, 25_000) === 0`; `secondsLeft(null, 0, 0) === 0`.
- [ ] **Step 2: Run** `node --import tsx --test web/turn.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `turn.ts` (pure functions plus `renderTurn(view, draft, actions)` writing into `#turnHeading`, `#turnDescription`, `#turnContent`; the secret card, timer row, field and button reuse the prototype's CSS classes). `board.ts`: gaps disabled when `selectGap` is undefined. `main.ts`: import `app.js` only when no backend is configured; on every snapshot `latest = mergePrivate(latest, next)`; while `status === "lobby"` render the lobby, otherwise hide the overlay, hide `#newGameButton`, and render header, board and turn; one 200 ms interval updates `#timerValue` from `secondsLeft`; keep `draft` across renders, clear it on a new `turn`, validate with `clueError` on input, send via `SUBMIT_CLUE`, show command errors under the field.
- [ ] **Step 4: Run** `npm run check`. Expected: PASS.

### Task 4: Deploy, verify, commit

**Files:** Create `scripts/check-clue.ts`; modify `TASKS.md`, `DEVELOPMENT_HANDOFF.md`

- [ ] **Step 1: Write** `scripts/check-clue.ts <gameApiUrl> <gameEventsUrl>` per the spec's sandbox list (scenarios: draw/privacy/bad words/valid clue; second card sent at 21 s; third card sent at 24 s → 409 and discarded). Second and third cards need `NEXT_TURN`, which does not exist yet: use a fresh session for each scenario. Subscribe as the Guesser for the whole run and fail if any event contains `currentDraw`.
- [ ] **Step 2: Deploy** and wait a minute. Expected: "Deployment completed".
- [ ] **Step 3: Run** `check-clue.ts`, `check-timeouts.ts`, `check-lobby.ts`, `check-events.ts`. Expected: all succeed.
- [ ] **Step 4: Browser test** per the spec (three tabs).
- [ ] **Step 5: Commit** after `npm run check`: `feat: add private draw and clue submission`; then docs (Task 11 status, handoff, this plan): `docs: record Task 11 completion`.
