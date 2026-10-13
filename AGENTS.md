# Round About

Multiplayer word-and-number game, live at `https://round-about.chreisel.net`. Start with `DEVELOPMENT_HANDOFF.md` (current state, open items, lessons learned); [README.md](README.md) explains the game.

## Workflow

- `main` is protected for everyone: work on a branch (`task-NN-slug` or a short topic name), open a pull request, the `check` workflow must pass, and merge only with the owner's OK. **Merging deploys production** via Amplify Hosting. Keep documentation changes in their own commit.
- `amplify/backend.ts` is the single source of truth for AWS resources; there is no separate infrastructure inventory. After backend changes redeploy the sandbox (`AWS_PROFILE=chreisel npx ampx sandbox --once --identifier round-about-dev`) and run `AWS_PROFILE=chreisel npm run smoke:dev` before opening the pull request. Never leave spike-only resources deployed.
- Never commit `amplify_outputs.json`, `.amplify/`, `.env*` or participant tokens. Never run the development-only scripts (`check-gaps`, `check-timeouts`, `check-progress`, `check-alarm`) against production: they write into the table or queues.
- After `npm install <package>`, run `npm install --package-lock-only` and check `npm ci --dry-run`: npm drops nested lockfile entries Amplify needs, which breaks CI.
- Backend changes reach production before the matching frontend finishes building; keep API and session-shape changes backward compatible with the previous frontend and with sessions already stored.

## Commands

- `npm ci`, `npm run dev`, `npm run check` (format, typecheck, all tests, build), `npm run build`.
- `npm test` runs every test file listed in `package.json`; add new `*.test.ts` files there. Run one case with `node --import tsx --test --test-name-pattern='pattern' <file>`.
- Smoke procedures for sandbox and production: [docs/SMOKE.md](docs/SMOKE.md).

## Code map

- `game/rules.ts`: pure reducer, no DOM or AWS imports. Authoritative rules: placement, lives, pile, Overtime, `clueError()`.
- `shared/protocol.ts`: session, command and snapshot types plus the public/caller projections. `shared/deadlines.ts`: `reconcile()`, `finalStatus()`, timeout helpers.
- `amplify/functions/game-api/`: HTTP API handler; `session.ts` holds one function per command, `command.ts` dispatches and remembers command IDs. Other functions: `event-auth` (AppSync subscribe authorizer), `event-publisher` (stream → AppSync), `deadline-scheduler` (stream → delayed SQS), `timeout` (applies due deadlines), `shared/db.ts` (`documentClient()`; use it for every writer).
- `web/`: browser client. `main.ts` wires session entry, lobby (`lobby.ts`) and play (`play.ts`, `turn.ts`, `board.ts`); `art.ts` holds the shared SVG artwork (road sign, cars, cones); `events.ts` is the AppSync WebSocket client; `session-api.ts` the HTTP client. Without a configured backend the page only shows a "no game server" message.
- Look and feel: the circle is a roundabout (cards are road signs, gaps are exits), Bungee and Overpass fonts, street colours as CSS variables at the top of `game.css`. Design record: `docs/superpowers/specs/2026-10-13-issue-4-roundabout-design.md`.
- `scripts/`: smoke and AWS check scripts.
- `docs/superpowers/specs|plans/`: per-task designs and plans, kept as a historical record; do not update them after the task is done.

## Game and security invariants

- Keep the UI sparse: one roundabout of numbered-and-worded signs, one compact turn panel. No second card list, no lengthy on-screen rules. Call gaps "exits" in all copy.
- Cards stay in ascending order. Card 0 represents **0/100**; the gap after the last card wraps to card 0 and is a valid guess. A wrong guess still inserts the drawn card in its *correct* gap and costs one life.
- The 12-card pile is a goal, not a turn limit: a wrong guess on the last card requires replacement draws. No clue after 20 seconds plus 3 seconds' grace discards the card, costs a life and restores one pile card.
- Losing the third life starts Overtime: 20 seconds to lock a gap; another miss or timeout ends the game. Correctly placing the last card wins even in Overtime.
- The server decides everything; the browser never supplies the drawn number, the answer, lives or timestamps. Only the Tipster ever receives `currentDraw` (HTTP only, during clue and grace). Public AppSync events and Guesser snapshots never contain the deck, the current draw or the result before `revealAtUtc`. Logs never contain tokens or card numbers.
- `clueError()` checks format and exact duplicates only; semantic restrictions (real word, shared stem, number hints) are left to the players.
