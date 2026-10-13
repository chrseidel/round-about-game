# Task 14: game progression and restart path

**Status:** design approved 2026-10-13. Implements Task 14 in [TASKS.md](../../../TASKS.md); background in [ARCHITECTURE.md](../../../ARCHITECTURE.md).

## Goal

Acceptance criteria from TASKS.md:

- A complete multiplayer run wins only on a correct placement with an empty pile (even in Overtime).
- A wrong final draw allows a replacement; a later Overtime miss or timeout loses.
- A new session has fresh roles, pile, cards and URL; the old session expires.
- No hidden number persists into a result or the next game.
- `NEXT_TURN` is refused before `revealAtUtc` and resets `revealAtUtc` and `lockedBy` (from Task 13).
- The Tipster stays fixed during a game; joining after the start and seeing a finished game work.

## Decisions

1. **The Tipster moves the game on.** After a result, the Tipster's "Draw next card" advances and draws in one step.
2. **Pointer from the old session.** A new session is linked from the old one, so every player gets a one-click "Join".
3. **New session any time.** The host may start one at any point; during a running game a confirmation dialog asks first.

## Server

**Ending the game at the result** (`shared/deadlines.ts`, used by `reconcile` and `lockGap`):

- `finalStatus(game: Game): SessionStatus` → `"lost"` if `lastResult.lost`; `"won"` if `lastResult.correct` and `pile === 0`; otherwise `"playing"`.
- `lockGap` and every timeout applied by `reconcile` set `session.status = finalStatus(game)`. The projection already reports the pre-reveal status until `revealAtUtc`, so the win or loss appears together with the result.

**Next turn** (`amplify/functions/game-api/session.ts`):

- `nextTurn(session, participantId, now): Session`
  - Not the Tipster: `FORBIDDEN` "Only the Tipster can draw."
  - Status not `playing` or phase not `result`: `INVALID_PHASE` "No card can be drawn now."
  - `now < revealAtUtc`: `INVALID_PHASE` "Wait for the reveal."
  - Otherwise apply `NEXT_TURN`; set `revealAtUtc: null`, `lockedBy: null`, `game.current: null`; `version + 1`. If no unused numbers remain, `status: "lost"`.
- `drawCard` in phase `result` first applies `nextTurn` (same checks), then draws, so "Draw next card" is one command. The `NEXT_TURN` command maps to `nextTurn` alone.
- A replacement after a wrong last card needs nothing new: with `pile === 0` the reducer's `DRAW` draws without decrementing.

**New session** (`amplify/functions/game-api/handler.ts`, `session.ts`):

- `POST /sessions` accepts an optional `replaces: <squid>` with the host's `Authorization` token. The handler loads the old session, checks the caller is its host (`FORBIDDEN` "Only the host can start a new session." otherwise), creates a fresh session with the host's nickname (same as a normal host), then writes the old session with `nextSquid` set, `expiresAt` = now + 10 minutes and `version + 1` (conditional on the loaded version). Answers 201 with the normal participant grant for the new session.
- `Session.nextSquid?: string | null`; `PublicSnapshot.nextSquid: string | null`.
- Every command on a session with `nextSquid` is refused: `INVALID_PHASE` "This game has moved to a new session."

**Privacy:** `nextTurn` clears `current`, so neither the previous draw nor the deck carries into the next turn; a new session is created from scratch.

## Browser

**Turn panel** (`turnView`):

| State | Tipster | Guessers |
| --- | --- | --- |
| Result, game continues | Result heading/text + button "Draw next card" ("Draw replacement" when `pile === 0`) | Result heading/text; "Waiting for Bob to draw the next card." |
| `won` | "You won!" / "Last card placed correctly." | same |
| `lost` | "Game over" / "Overtime ended." | same |
| `nextSquid` set | "New game" / "Alice started a new game." + button "Join" | same (the host has already moved) |

- `TurnView` gains `drawLabel` (draw button text) and mode `"join"`.
- **Header:** `#newGameButton` is visible for the host only. During a running game (`status === "playing"`) it opens `#confirmDialog`; after a game or in the lobby it starts at once. It calls `SessionApi.newSession(nickname, oldSquid, token)` (`POST /sessions` with `replaces`).
- **Leaving a session** (host starting a new one, or anyone pressing Join): `showSession` returns `leave()`, which closes `GameEvents`, clears the countdown interval and reveal timer, and removes the resize listener. Then the new grant is stored, the URL changes to `/s/<new>` and the new session's lobby shows. Join uses the player's nickname from the old session; a join error (e.g. nickname taken) shows in the panel.

## Testing

- **Unit:**
  - `deadlines.test.ts`: `finalStatus` cases; an Overtime timeout and a grace discard at 0 lives set `lost`.
  - `session.test.ts`:
    - a correct last card (pile 0) wins, also in Overtime;
    - a wrong last card keeps `playing`, and the next draw is a replacement;
    - an Overtime wrong lock loses;
    - `nextTurn` is refused before the reveal and by Guessers, and clears `revealAtUtc`, `lockedBy` and `current`;
    - `drawCard` from `result` advances and draws a different number;
    - `newSession` replacing an old one: fresh lobby, no Tipster, pile 12, 3 cards, a new squid;
    - commands on a moved session are refused.
  - `protocol.test.ts`: `nextSquid` projected.
  - `web/turn.test.ts`: the table above.
- **Sandbox script** `scripts/check-progress.ts` (near-end states written directly into the sandbox table, as in `check-timeouts.ts`):
  - (a) pile 0, lives 0, guess phase: lock the correct gap → after the reveal `status: "won"`;
  - (b) pile 0: lock a wrong gap → `playing`; the Tipster's draw before the reveal → 409 "Wait for the reveal."; after it → phase `tip`, pile 0 (replacement);
  - (c) lives 0: lock a wrong gap → `lost`;
  - (d) host `POST /sessions` with `replaces` → old snapshot has `nextSquid`; a command on the old session → 409; the new session is fresh; a non-host replace → 403.
- **Browser:** three tabs: Tipster draws the next card after a result; a won or lost game shows in all tabs; the host starts a new session, the others see "Join", and one click puts them in the new lobby.
- `npm run check`; redeploy; all earlier sandbox scripts pass.

## Out of scope

Production deployment, alarms and the end-to-end development test (Tasks 15–16). Leaving a session without a replacement and kicking players remain unsupported.
