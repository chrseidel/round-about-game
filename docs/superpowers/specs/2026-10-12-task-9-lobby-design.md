# Task 9: lobby, first-claim Tipster, and start

**Status:** design approved 2026-10-12. Implements Task 9 in [TASKS.md](../../../TASKS.md); background in [ARCHITECTURE.md](../../../ARCHITECTURE.md).

## Goal

Players in a session's lobby can see each other, any one of them can claim the single Tipster seat, and the host starts the game. Acceptance criteria from TASKS.md:

- Simultaneous claims yield exactly one Tipster; losing claimants see who won.
- The same Tipster persists for the whole game.
- No start without a Tipster **and** at least one other participant (a Guesser).
- A non-host cannot start.
- Someone joining after the start becomes a Guesser without interrupting play, and cannot claim Tipster.

## Decisions

1. **No strict `expectedVersion` for `CLAIM_TIPSTER` and `START`.** The server re-checks the rules against the latest state instead, so an unrelated change (for example someone joining) never makes a click fail. Strict version checks start with `LOCK_GAP` (Task 12), where the gap the player saw matters.
2. **No stored `commandId`s yet.** Retrying a claim or start reaches the same end state, so both are made idempotent by their rules. Storing applied command IDs for deduplication comes with Task 12.
3. **Branch protection (Task 4):** accepted as a gap for now. CI runs on every push and PR, but direct pushes to `main` are not blocked on a private repository with GitHub Free. Revisit before Task 16.

## API

`POST /sessions/{squid}/commands`, body is the existing `CommandRequest` from `shared/protocol.ts`, `Authorization: Bearer <token>`.

- **Input checks** (400 `INVALID_INPUT`): body at most 1 KB and valid JSON (existing `input()`), `protocolVersion` equals `PROTOCOL_VERSION`, `commandId` is a string of at most 64 characters, `command.type` is `CLAIM_TIPSTER` or `START`. Other command types answer "Not available yet." until their tasks implement them. `turnId` and `expectedVersion` are accepted but not enforced for these two commands.
- **Auth:** 404 `NOT_FOUND` for a missing or expired session, 401 `UNAUTHORIZED` for a missing or wrong token (same as `GET /sessions/{squid}`).
- **Success:** 200 with the caller's `CallerSnapshot`, the same shape `GET` returns.
- **Rule errors:** an `ApiError` body that always includes the caller's fresh `snapshot`:
  - 403 `FORBIDDEN`: a non-host sends `START`.
  - 409 `INVALID_PHASE`: the Tipster seat is taken ("Alice is already the Tipster."), the game has already started, or the start conditions are not met.
  - 409 `STALE_VERSION`: the write still conflicted after 3 attempts (only possible under heavy contention).

## Backend

**Rules** are pure functions in `amplify/functions/game-api/session.ts`, next to `joinSession`, and throw a `CommandError` carrying the API code:

- `claimTipster(session, participantId)`:
  - Already this participant's seat: return the session unchanged (idempotent retry).
  - Game not in the lobby: `INVALID_PHASE` "The game has already started."
  - Seat taken by someone else: `INVALID_PHASE` "<nickname> is already the Tipster."
  - Otherwise: `tipsterId` set, `version + 1`.
- `startGame(session, participantId)`:
  - Caller is not the host: `FORBIDDEN` "Only the host can start the game."
  - Already playing: return unchanged (idempotent retry).
  - Not in the lobby (won or lost): `INVALID_PHASE`.
  - No Tipster: `INVALID_PHASE` "Someone needs to be the Tipster first."
  - Fewer than 2 participants: `INVALID_PHASE` "At least one Guesser needs to join first."
  - Otherwise: `status: "playing"`, `version + 1`. The game stays in phase `ready`; drawing the first card is Task 11.

**Handler** (`handler.ts`): for up to 3 attempts, load the session with a consistent read, authenticate, apply the rule. An unchanged session is answered without a write. A changed one is written with `ConditionExpression: version = <loaded version>`. On `ConditionalCheckFailedException` the next attempt reloads and re-applies the rule, so a losing simultaneous claim ends with "already the Tipster". Logs contain only error names, never tokens or session contents.

**Publishing:** nothing new. The table stream publishes every committed write.

**Infrastructure:** one new route in `amplify/backend.ts`, `POST /sessions/{squid}/commands` to the game API Lambda. The existing CORS settings already allow `POST` with `authorization` and `content-type`. Redeploy `round-about-dev` before testing.

**Late joins:** `joinSession` already allows joining a started game. The joiner is a Guesser because `tipsterId` is someone else, and a later claim fails with "The game has already started."

## Browser

- `web/session-api.ts`: `command(squid, token, command, snapshot)` sends a `CommandRequest` with a fresh `crypto.randomUUID()` as `commandId`, plus `turnId` and `version` from the latest snapshot. Errors keep `status` and also carry `code` and `snapshot`.
- `web/events.ts`: make version-checked accepting public (`apply(snapshot)`), so command responses and error snapshots go through the same "never move backwards" path as live events.
- `web/lobby.ts` (new): `lobbyView(snapshot, participantId)` is a pure function returning what the lobby shows: players with host, Tipster and "you" markers, whether "Be the Tipster" and "Start game" are available, and a short hint why start is not yet possible. `renderLobby` turns that into DOM. `web/main.ts` only wires it up.
- Lobby content, kept sparse (AGENTS.md):
  - "Round About", the invite code and a "Copy invite link" button (`navigator.clipboard`; shows the link if copying fails).
  - One line of players, e.g. "Alice (host) · Bob (Tipster) · Carol".
  - "Be the Tipster" while the seat is free and the game is in the lobby.
  - "Start game" for the host only, disabled with a one-line hint until a Tipster and a Guesser exist.
  - The connection status line and an error line for command failures.
  - After the start: "Game started. Bob is the Tipster." The board comes with Tasks 11–14.
- The participant ID needed for "you" and host checks is already stored with the token in `sessionStorage`.

## Testing

- **Unit:** `session.test.ts` covers claim, competing claims (the second claim evaluated on the first one's result fails and names the winner), idempotent retries, start rules (non-host, no Tipster, no Guesser, success), and a late join after the start being a Guesser who cannot claim. `web/lobby.test.ts` covers `lobbyView`.
- **Sandbox script:** `scripts/check-lobby.ts` hosts a session, joins three players, fires all four claims at once and expects exactly one 200 and three 409 naming the winner. Then: non-host start gives 403, host start gives 200 with `status: "playing"`, a late joiner sees the same Tipster, and the late joiner's claim gives 409.
- **Browser:** three tabs against the sandbox: the claim and start buttons follow the rules, every change appears in all tabs without a refresh, and the losing claimant sees who won.
- `npm run check` passes before the commit.

## Out of scope

Board and turn UI (Tasks 11–14), giving up or reassigning the Tipster seat, leaving a session, and command-ID deduplication (Task 12).
