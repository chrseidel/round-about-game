# Issue 4 Roundabout Design Implementation Plan

**Goal:** Restyle entry, lobby and game as a roundabout; remove the legacy prototype.

**Spec:** `docs/superpowers/specs/2026-10-13-issue-4-roundabout-design.md`

## Global Constraints

- Frontend only; no change to `shared/`, `game/`, `amplify/`.
- Fonts: Bungee (logo, numbers, headings, main buttons) and Overpass (everything else) from Google Fonts.
- Colours: grass `#4F9A47`, island `#6CB65E`, asphalt `#3B4148`, lane `#F3F1E8`, sign blue `#1F56B3`, amber `#FFB81C`, cone `#FF6A13`, kerb red `#D8402F`, green `#1E9E5A`, ink `#16202A`.
- Text via `textContent` only for anything player-supplied (nicknames, clues, words).

## Review Focus

1. A Guesser's two taps on an exit must still send CHOOSE_GAP then LOCK_GAP (pinned by existing `gapCommand` tests; exits keep the gap index).
2. The Tipster's secret number must not appear for Guessers in the island (`islandView` test).
3. The reveal car must not reveal the result early for reduced-motion users or after the target (it only runs while `serverNow < revealAtUtc`).
4. Lobby re-renders must not restart the car animation (cars rebuilt only when the player list changes).
5. No backend configured: the page must show a message, not a blank screen.

### Task 1: Remove the legacy prototype

Delete `app.js`, `web/panel.ts`, `game.test.cjs`; drop `node --test game.test.cjs` from `npm test`; `main.ts` shows "No game server is configured…" in the entry overlay. Verify `npm run check`.

### Task 2: View models (TDD)

`web/turn.test.ts`, `web/lobby.test.ts` first, then `turn.ts`/`lobby.ts`:
- `turnView` guess copy: Guesser heading "Pick the exit", description "The clue is river. Tap an exit to suggest it." / "Tap the blinking exit again to lock it in, or tap another exit."; Tipster "Your word: river. The team is picking an exit."; result "Wrong exit"; placed text "river: 42 sits between …"; timer labels "Clue time", "Final seconds", "Discussion".
- `islandView(snapshot, participantId)` → `{ kind: "logo" | "thinking" | "secret" | "clue", title, text }`.
- `exitLabel(cards, index)` → "Exit between 33 Lighthouse and 66 Glacier" (0 shown as 0/100).
- `correctExit(snapshot)` → index or null from `pendingReveal.result.lower`.
- `lobbyView`: `cars: { id, name, tipster, host, you }[]`, `tipsterTitle`, `tipsterText`, `ready`, `startHint` for everyone.

### Task 3: Game screen

`index.html`, `game.css`, `web/board.ts`, `web/play.ts`, `web/turn.ts` render: SVG ring sized to the board, signs, exit buttons with chevrons, island, cones, Overtime hazard ring, traffic-light timer.

### Task 4: Entry and lobby

`web/lobby.ts` markup and `renderLobby` (cars keyed by player list), `main.ts` entry form, CSS.

### Task 5: Motion

Start sequence in `main.ts`; reveal drive in `board.ts` via Web Animations (once per `revealAtUtc`); cone tip-over; reduced motion.

### Task 6: Verify

`npm run check`; sandbox browser run with three tabs (one at 375 × 812) through lobby, start, draw, clue, two-tap exit, reveal, wrong guess, Overtime, New game; then PR.
