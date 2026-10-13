# Task 11: private draw and explicit clue submission

**Status:** design approved 2026-10-13. Implements Task 11 in [TASKS.md](../../../TASKS.md); background in [ARCHITECTURE.md](../../../ARCHITECTURE.md).

## Goal

Acceptance criteria from TASKS.md:

- Only the Tipster can draw and submit; a Guesser cannot fetch the hidden number.
- The Tipster can send early or in grace; a typed but unsent valid word is discarded at grace expiry.
- A duplicate or malformed word shows an actionable error.
- The private number never reappears to Guessers via refresh or socket.
- Drafts are not synced and a typed word is never auto-sent.

The reducer already has `DRAW`, `SUBMIT_CLUE`, `BEGIN_GUESS` and `clueError`; `projectCaller` already gives `currentDraw` to the Tipster only, in phases `tip` and `grace`; Task 10 expires the clue and grace deadlines.

## Decisions

1. **No hand-over step.** `SUBMIT_CLUE` moves straight to guessing: the server applies `SUBMIT_CLUE` and `BEGIN_GUESS` in one write, which also starts the 20-second Overtime deadline when lives are 0.
2. **Server time in snapshots.** Every snapshot carries `serverTimeUtc`, so countdowns follow the server's clock.
3. **Gaps stay disabled** in the guess phase until Task 12, with no extra text.

## Server

**Commands** (existing endpoint, `applyCommand` after `reconcile`), pure rules in `amplify/functions/game-api/session.ts`:

- `drawCard(session: Session, participantId: string, now: number): Session`
  - Caller not the Tipster: `FORBIDDEN` "Only the Tipster can draw."
  - Session not playing: `INVALID_PHASE` "The game has not started."
  - Phase `tip` or `grace`: return unchanged (retry after a lost response returns the drawn card).
  - Phase not `ready`, or no cards left: `INVALID_PHASE` "No card can be drawn now."
  - Otherwise apply `DRAW`, `version + 1`.
- `submitClue(session: Session, participantId: string, clue: string, now: number): Session`
  - Caller not the Tipster: `FORBIDDEN` "Only the Tipster can send the word."
  - Phase `guess` with `game.clue` equal to the trimmed clue: return unchanged (retry).
  - Phase not `tip`/`grace` (including after expiry): `INVALID_PHASE` "Time is up for this card."
  - `clueError(clue, cards)` non-empty: `INVALID_INPUT` with that message.
  - Otherwise apply `SUBMIT_CLUE` then `BEGIN_GUESS` at `now`, `version + 1`.
- `parseCommandRequest` additionally requires `command.clue` to be a string for `SUBMIT_CLUE`.

**Projection** (`shared/protocol.ts`): `PublicSnapshot` gains `serverTimeUtc: number` (the `now` passed to the projection). Public events and Guesser snapshots never contain `currentDraw`.

## Browser

**Mode:** when a backend is configured, the single-screen prototype (`app.js`) is not started; it is imported only in local mode, so `game.test.cjs` is unaffected.

**After the start** the lobby overlay hides and the page shows the session:

- Header: `DRAW 01`-style turn label, cards left, lives; the prototype's New game button is hidden (Task 14).
- Circle: `renderBoard` from `web/board.ts`, which gains an optional `selectGap`; without it all gaps are disabled. The center shows the clue in the guess phase, as today.
- Turn panel: new `web/turn.ts`, pure `turnView(snapshot, participantId, now)` plus `renderTurn`:

| Phase | Tipster | Guesser |
| --- | --- | --- |
| `ready` | "Your turn" + Draw card | "Waiting for Bob to draw." |
| `tip` | secret number, countdown, word field, Send word | "Bob is thinking of a word." + countdown |
| `grace` | "Last chance", 3-second countdown, same field | "Last seconds…" + countdown |
| `guess` | "Your word: X. The team is guessing." (+ Overtime countdown) | "Choose a gap." (+ Overtime countdown) |
| `result` (discarded) | "Card discarded. Time ran out." | same |

Copy stays short (AGENTS.md); user text only via `textContent`.

**Secret number:** it arrives only through the Tipster's own HTTP responses (`DRAW`, `GET`). `mergePrivate(previous, next)` in `web/turn.ts` keeps `currentDraw` from the previous snapshot when the next one lacks it but has the same `turn` and a `tip`/`grace` phase; otherwise it is dropped.

**Countdown:** clock offset = `serverTimeUtc − Date.now()` at receipt of each snapshot; seconds left = `ceil((deadlineUtc − (Date.now() + offset)) / 1000)`, at least 0. One 200 ms interval updates only the timer text and survives re-renders; the server, not the browser, ends the phase.

**Draft:** the typed word lives in page memory, is restored into the field on every re-render (e.g. a join event mid-turn), is cleared when a new card is drawn, and is never sent except by Send word. `clueError` runs as the Tipster types for instant feedback; the server checks again. Errors from commands show under the field.

## Testing

- **Unit:** `session.test.ts` (draw and submit rules above, including retries and the expired-clue case); `command.test.ts` (`SUBMIT_CLUE` parsing); `protocol.test.ts` (`serverTimeUtc`; after a draw, a Guesser snapshot and the public event contain no `currentDraw` and no drawn number); `web/turn.test.ts` (views per role and phase, `mergePrivate`, countdown with clock offset); `board.ts` gaps disabled without `selectGap`.
- **Sandbox script** `scripts/check-clue.ts`: host, join, claim, start; Guesser `DRAW` → 403; Tipster `DRAW` → 200 with `currentDraw`; Guesser `GET` has no `currentDraw`; no WebSocket event contains `currentDraw`; two-word clue → 400 with the format message; an existing circle word → 400 with the duplicate message; valid clue → phase `guess` and the clue visible to the Guesser. Second card: send during grace (after 21 s) → 200. Third card: wait past grace → send → 409 "Time is up for this card." and a discarded result.
- **Browser:** three tabs against the sandbox: Tipster draws and sees the number; Guessers see waiting text and the countdown; a Guesser reload shows no number; a Tipster reload shows it again; a draft survives a join event; Send word shows the clue everywhere; an unsent draft is discarded at expiry.
- `npm run check` passes; redeploy `round-about-dev`; earlier sandbox scripts still pass.

## Out of scope

Gap selection and locking (Task 12), shared reveal timing (Task 13), next turn, end of game and new session (Task 14). A discarded card currently leaves the game on the result until Task 14 adds `NEXT_TURN`.
