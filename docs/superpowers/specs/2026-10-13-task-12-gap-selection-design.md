# Task 12: shared two-click gap selection

**Status:** design approved 2026-10-13. Implements Task 12 in [TASKS.md](../../../TASKS.md); background in [ARCHITECTURE.md](../../../ARCHITECTURE.md).

## Goal

Acceptance criteria from TASKS.md:

- Guesser A selects a gap and all players see it; Guesser B clicks the same selected gap and it locks once.
- Competing clicks or stale versions cannot lock an unintended gap; clicking another gap changes the selection.
- One tap alone never grades; the Tipster cannot select or lock.
- Overtime expiry still counts as a miss if a gap is only selected.

The reducer already has `SELECT_GAP` (deadline untouched) and `LOCK_GAP` (grades, inserts the card in its correct gap, costs a life if wrong); an Overtime timeout is a miss even with a selection. The protocol already defines `CHOOSE_GAP { index }` and `LOCK_GAP { index }`.

## Decisions

1. **Strict lock.** A lock counts only if the session has not changed since the player saw the selection (`expectedVersion` equals the stored version).
2. **Command retry memory.** The session remembers the last 20 applied command IDs; a repeated ID returns the current state without applying anything.
3. **Simple result now.** After a lock, a short result shows immediately; the shared reveal delay comes with Task 13.

## Server

**Rules** in `amplify/functions/game-api/session.ts` (after `reconcile`, like every command):

- `chooseGap(session, participantId, index): Session`
  - Tipster: `FORBIDDEN` "The Tipster can't choose a gap."
  - Phase not `guess` (including after an expired Overtime): `INVALID_PHASE` "Guessing is not open right now."
  - `index` not an integer in `0 … cards.length − 1`: `INVALID_INPUT` "Choose a gap in the circle."
  - Same as the current selection: return unchanged.
  - Otherwise apply `SELECT_GAP`, `version + 1`.
- `lockGap(session, participantId, index, expectedVersion, now): Session`
  - Tipster: `FORBIDDEN` "The Tipster can't lock a gap."
  - Phase not `guess`: `INVALID_PHASE` "Guessing is not open right now."
  - `index !== game.selectedGap` or `expectedVersion !== session.version`: `STALE_VERSION` (409) "The selection changed. Tap again to lock in."
  - Otherwise apply `LOCK_GAP` at `now`, `version + 1`.
- `CommandError` gains code `STALE_VERSION` (HTTP 409). `applyCommand(session, participantId, command, expectedVersion, now)` passes `expectedVersion` to `lockGap`; the version compared is the stored one before `reconcile`. `parseCommandRequest` requires an integer `index` for both gap commands and an integer `expectedVersion` for `LOCK_GAP`.

**Retry memory** (`command.ts`): `Session.recentCommands?: string[]`.

- `alreadyApplied(session, commandId): boolean`; `rememberCommand(session, commandId): Session` appends and keeps the last 20.
- The handler checks `alreadyApplied` on every load (including reloads after a conflict) and then answers 200 with the caller's snapshot without writing. Every write of a changed session goes through `rememberCommand`.
- `recentCommands` never appears in projections (`projectPublic` is an allowlist).

**Concurrency:** `CHOOSE_GAP` is last-click-wins: on a write conflict the handler reloads and applies it again. `LOCK_GAP` after a conflict sees a newer version and fails with `STALE_VERSION`, as intended.

## Browser

- `renderBoard` gets a `selectGap` handler only for Guessers in phase `guess`, so gaps are clickable just for them. A click on `latest.selectedGap` sends `LOCK_GAP` with that index; any other gap sends `CHOOSE_GAP`. One command at a time: clicks are ignored while a gap command is in flight.
- Everyone sees the hourglass on `selectedGap` (existing board behaviour).
- Turn panel (`turnView`):
  - Guesser, no selection: "Choose a gap." / "The word is X."
  - Guesser with a selection: "Choose a gap." / "Tap ⌛ again to lock it in."
  - Tipster: unchanged ("Your word: X. The team is guessing."), no gap controls.
  - Result after a lock, for everyone: heading "Correct!" or "Wrong gap"; description "X · N sits between L and U." plus " Life lost." when wrong, or "Overtime ended." when the game is lost. An Overtime timeout shows heading "Time ran out" with the same description.
- A `STALE_VERSION` answer shows its message under the panel and applies the returned snapshot (the latest selection), so the next click starts fresh.

## Testing

- **Unit:** `session.test.ts`: choose (Tipster refused, outside guess refused, invalid index, same gap unchanged, selection changes without touching the deadline, never grades); lock (Tipster refused, wrong index → `STALE_VERSION`, stale version → `STALE_VERSION`, valid lock grades correct and wrong guesses, inserting the card). `command.test.ts`: parsing of `index`/`expectedVersion`; `rememberCommand` keeps 20; `applyCommand` with an already applied ID is decided in the handler (covered by the sandbox script). `deadlines.test.ts` already pins the Overtime miss; add: a selected-but-unlocked gap at Overtime expiry yields `timedOut`, `correct: false`, `lost: true`. `web/turn.test.ts`: the new panel texts.
- **Sandbox script** `scripts/check-gaps.ts`: Tipster Bob, Guessers Alice, Carol, Dave. Bob `CHOOSE_GAP` → 403; Alice chooses 1 → Carol and Dave see `selectedGap: 1` and phase still `guess`; Carol locks 1 with the current version → 200, phase `result`; resending Carol's exact request (same `commandId`) → 200 with the same version. Second game: Alice chooses 1, Carol reads the version, Dave chooses 2, Carol locks 1 with the old version → 409 with the message; Carol locks 2 with the old version → 409. Third game, Overtime: written directly into the sandbox table (lives 0, deadline in 4 s, as in `check-timeouts.ts`); Alice chooses a gap; after expiry the result is `timedOut`, `lost`, not correct.
- **Browser:** three tabs (Tipster, two Guessers): A selects and all see the hourglass; B taps it and the result appears in all tabs; the Tipster cannot click gaps; a stale tap shows the message and the latest selection.
- `npm run check`; redeploy; all earlier sandbox scripts still pass.

## Out of scope

Shared reveal timing (Task 13); next turn, game end, new session (Task 14).
