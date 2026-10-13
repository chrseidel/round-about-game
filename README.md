# Round About

A cooperative word-and-number game for small groups, each player on their own device (often while in a video call). Play at **https://round-about.chreisel.net**.

## How it plays

- The circle starts with three cards, 0/100, 33 and 66, each with a word. One player claims the **Tipster** seat and keeps it for the whole game; everyone else is a **Guesser**.
- The Tipster draws a secret number (1–99) and has 20 seconds, plus 3 seconds' grace, to send **one word** (or a proper name) as a clue.
- Any Guesser taps a gap in the circle to select it for the team; a second tap on the selected gap locks it in. All screens reveal the result together about two seconds later.
- A wrong guess still places the card in its correct gap but costs one of three lives. A missing clue discards the card, costs a life and puts one card back on the pile.
- Place all 12 pile cards to win. Losing the third life starts **Overtime**: one more miss or timeout ends the game.

No accounts: the host shares an invite link (`/s/<code>`), players join with a nickname, and the host can start a new game with a fresh link at any time.

## Development

Requires Node 22 (22.23 or newer) and npm.

```bash
npm ci
npm run dev     # local web app on http://127.0.0.1:5173
npm run check   # format, typecheck, tests, build — the same gate CI and Amplify run
```

Without a backend the dev server runs the single-browser prototype. For multiplayer, deploy your own Amplify sandbox (`npx ampx sandbox`), which writes the ignored `amplify_outputs.json` the web app reads.

## Documentation

- [AGENTS.md](AGENTS.md): working rules and code map for contributors and coding agents.
- [ARCHITECTURE.md](ARCHITECTURE.md): game flow, server authority, identity and the shared reveal.
- [INFRASTRUCTURE.md](INFRASTRUCTURE.md): AWS components, environments and the deployment pipeline.
- [DEVELOPMENT_HANDOFF.md](DEVELOPMENT_HANDOFF.md): current state, open items and lessons learned.
- [docs/SMOKE.md](docs/SMOKE.md): checks to run after a deploy.
- [TASKS.md](TASKS.md): the 16 build tasks and how each was verified; `docs/superpowers/` holds their design specs and plans.
