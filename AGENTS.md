# Round About

- For unfinished multiplayer work, read `DEVELOPMENT_HANDOFF.md` and the per-task statuses in `TASKS.md` before editing. Tasks 1–8 are committed; continue with Task 9. Commit each task separately from documentation changes. `amplify/backend.ts` is the single source of truth for AWS resources: redeploy the sandbox after backend changes and never leave spike-only resources deployed.

- After `npm install <package>`, run `npm install --package-lock-only` and check `npm ci --dry-run`: npm drops nested lockfile entries Amplify needs, which breaks CI.
- Vite prototype: `npm ci`, `npm run dev`, `npm run check`, `npm run build`. `index.html` loads `web/main.ts`, which currently imports legacy `app.js`; UI is split into `web/board.ts` and `web/panel.ts` while rules are being extracted.
- Verify logic with `npm test`; run one case with `node --test --test-name-pattern='pattern' game.test.cjs`. Tests bundle `app.js` with esbuild and execute it in a stubbed DOM via `node:vm`, not a browser.
- Keep UI sparse: one numbered-and-worded circle, one compact turn panel. Do not add a second card list or lengthy on-screen rules.
- `state.cards` stays in ascending numeric order. Card 0 represents **0/100**; the gap after the last card wraps to card 0 and is a valid guess. A wrong guess still inserts the drawn card in its *correct* gap and costs one life.
- The 12-card pile is a goal, not a fixed turn limit: a wrong guess on the last card requires replacement draws until one is placed correctly. No clue after the 20-second timer plus 3-second grace discards that card, costs a life, and restores one pile card.
- Losing the third life starts Overtime, not game over. Overtime gives the team 20 seconds to choose; another miss or timeout ends the game. Correctly placing the last card wins even in Overtime.
- `render()` rebuilds the turn panel; `renderBoard()` rebuilds circle buttons. Preserve active timers when selecting gaps or rerendering. Only the Tipster sees the drawn number before handoff.
- `clueError()` checks format and exact duplicates only; semantic restrictions (real word, shared stem, number/position hints) need human judgment.
