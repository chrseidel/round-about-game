# Round About: ordered build tasks

Work through tasks in order; commit each after verification. Design references: [ARCHITECTURE.md](ARCHITECTURE.md) and [INFRASTRUCTURE.md](INFRASTRUCTURE.md).

**Current state:** Tasks 1–14 have separate commits. Vite app and tests work locally; an Amplify sandbox runs in `eu-central-1` using `AWS_PROFILE=chreisel`. Guest host/join and per-room AppSync authorization were exercised in the sandbox. This is **not a deployed playable multiplayer game**. Tasks 15–16 are pending. The GitHub repository is `chrseidel/round-about-game` (private), `origin` is `git@github.com:chrseidel/round-about-game.git`, and the Check workflow runs on pushes and PRs to `main`. Do not commit `amplify_outputs.json` or `.amplify/`.

## 1. Establish maintainable project tooling

**Status:** Completed; `9eee0b1`.

**Context:** `index.html` loads global `app.js` and `game.css` directly. Multiplayer needs independently testable modules and reproducible builds without replacing the sparse UI.

**What needs to be done:** Add Node package manifest and lockfile, Vite + TypeScript configuration, formatting/typecheck/test/build scripts. Move existing UI into `web/` with separate rendering, transport, and state modules; keep existing prototype playable through transition. Update `AGENTS.md` commands once they really exist.

**Acceptance criteria:** `npm ci`, `npm run check`, and `npm run build` work from a clean checkout; local preview shows same circle, compact panel, and playable single-browser flow; build emits static files; no AWS credentials needed for frontend build.

## 2. Extract and test authoritative game rules

**Status:** Completed; `f4590ff`.

**Context:** Current game rules and DOM updates share one file. Server must own placement, lives, pile, timers and win conditions.

**What needs to be done:** Move rules into an AWS/DOM-free `game/` reducer with deterministic inputs (`now`, shuffled numbers/words supplied at initialization) and explicit commands/effects. Migrate existing tests and add boundary tests. Keep browser using reducer locally until multiplayer replaces that path.

**Acceptance criteria:** Tests cover starting 0/100, 33, 66; sorted/wrap gap; wrong insertion at correct location; last-card replacement; clue timeout and pile restoration; third lost life entering Overtime; Overtime timeout/miss; correct final placement in Overtime. Reducer imports neither DOM nor AWS SDK and can replay a turn deterministically.

## 3. Define contracts and private/public projections

**Status:** Completed; `b28c631`.

**Context:** Guessers must never receive current draw or future deck. AppSync room updates carry only shared game data.

**What needs to be done:** Define typed command, phase, session, public event, caller snapshot and result contracts in `shared/`. Build projection functions from authoritative session state; return Tipster-only `currentDraw` during clue/grace, then hide it until reveal. Define protocol version and error shapes.

**Acceptance criteria:** Contract tests prove deck/hidden number/correct gap never appear in Guesser snapshots or pre-reveal public events; Tipster can read own draw in correct phase only; result becomes shared at reveal; browser-supplied values cannot become authoritative state.

## 4. Add PR verification in GitHub

**Status:** Workflow committed in `6c3a4b0`; it runs on GitHub since 2026-10-12 (the first run exposed a broken lockfile, fixed in `3668a0e`). Branch protection is **not available** for a private repository on GitHub Free. Decision 2026-10-12: accept the gap for now (CI still runs on every push and PR); revisit before production deployment (Task 16).

**Context:** `main` will auto-deploy when changes land. Bad PRs must fail before merge.

**What needs to be done:** Add GitHub Actions `pull_request` check running locked install, formatting/typecheck, rule/contract tests and web build; add backend synth check when backend exists. Configure GitHub `main` branch protection to require checks and PR review; no GitHub AWS deploy credentials.

**Acceptance criteria:** Checks run for PRs to `main`, report failures on broken rules/types/build, pass on clean checkout; direct pushes to protected `main` are blocked; no separate GitHub deployment job exists.

## 5. Bootstrap isolated Amplify Gen 2 development backend

**Status:** Completed; `d1eb08b`. Sandbox deployed and `/health` responded in `eu-central-1` with `AWS_PROFILE=chreisel`.

**Context:** Backends need repeatable definitions and a development environment separate from eventual production.

**What needs to be done:** Define `amplify/backend.ts` with custom CDK HTTP API, Lambda, DynamoDB on-demand table and AppSync Event API namespace; export public endpoints/region. Use an Amplify sandbox for development. Start with least-privilege IAM and no VPC, Cognito, or browser table access. Add SQS in task 10.

**Acceptance criteria:** Sandbox deploy and synth succeed; HTTP health check works; static web client can read sandbox endpoint config; game table is inaccessible to browser credentials; sandbox teardown does not affect other environments.

## 6. Implement host/join and anonymous participant identity

**Status:** Completed; `53eb414`. Guest session API exercised in sandbox; multiplayer gameplay UI still pending.

**Context:** Players use nicknames, not accounts. SQUID is shareable but must not authenticate players or grant the Tipster's secret.

**What needs to be done:** Add `POST /sessions`, `POST /sessions/{squid}/participants`, and authorized `GET /sessions/{squid}`. Generate collision-checked random SQUID, participant ID/token; store token hash and nickname in session. Enforce unique case-insensitive nicknames, session size, expiry and input bounds. Browser retains token in SQUID-scoped `sessionStorage`, nickname prefills via `localStorage`.

**Acceptance criteria:** Two browsers can host/join by URL or code; reload with token restores seat; another browser with same nickname but no token cannot impersonate seat; invalid SQUID/token and duplicate nickname receive clear errors; snapshots never expose token hashes, deck or hidden draw to Guessers.

## 7. Prove per-room AppSync Events authorization

**Status:** Completed; `f84b589`. Sandbox spike confirmed member subscription, rejection of outsiders/wildcards/browser publishing, and backend event delivery.

**Context:** AppSync Events is recommended only if a browser can subscribe to its own room but cannot publish or listen to others. Test this before wiring gameplay to it.

**What needs to be done:** In isolated sandbox, implement participant-token-based connection/subscribe auth and backend-only event publishing for `games/{squid}`. Confirm SDK connection/token refresh and backend publish from Lambda. If room membership cannot be enforced cleanly, document result and switch design to API Gateway WebSocket with custom connection authorization **before** later tasks; do not ship both.

**Acceptance criteria:** Current member receives backend event; different-room member and nonmember cannot subscribe; browser cannot publish forged event; leaked SQUID alone grants no event access; disconnect/reconnect can reauthorize. Spike has executable integration test or reproducible manual steps and records chosen transport.

## 8. Build versioned real-time session transport

**Status:** Completed; `9fb19bc`. Publishing runs from a DynamoDB Stream → `event-publisher` Lambda with retries and a failure queue. Verified against the sandbox by `scripts/check-events.ts` and a three-tab browser test on 2026-10-12 (live joins, reload and in-page socket drop both caught up).

**Context:** All participants must see shared selections and results promptly while missed events must not corrupt state.

**What needs to be done:** Server publishes safe public versioned events after committed state changes, with retry/reconciliation for publish failure. Browser subscribes after join, applies newer versions only, fetches caller-specific snapshot after reconnect or a gap in versions, shows connection status and resubscribes after interruptions. Keep Tipster's private draw on authorized HTTP path only.

**Acceptance criteria:** Changes in one browser update another without refresh; duplicates/out-of-order events do not roll back board; reconnect catches up; no private draw in socket payloads, backend logs or Guesser view; a publish failure is recoverable from persisted state and retried.

## 9. Build lobby, first-claim Tipster, and start

**Status:** Completed; `d390aa6`. Design: [docs/superpowers/specs/2026-10-12-task-9-lobby-design.md](docs/superpowers/specs/2026-10-12-task-9-lobby-design.md). Verified 2026-10-12 with `scripts/check-lobby.ts` (always exactly one winning claim) and a three-tab browser test with a real claim race.

**Context:** First lobby participant to claim Tipster keeps role for full game; others are Guessers. Host cannot start alone or without Tipster.

**What needs to be done:** Add `CLAIM_TIPSTER` and host-only `START` commands using conditional writes; build compact lobby with usernames, claim control, host start, and copy/share URL. Late joins after start become Guessers; claiming Tipster then is rejected.

**Acceptance criteria:** Simultaneous claims yield exactly one Tipster; losing claimants see chosen Tipster; same Tipster persists across turns; no start without Tipster **and** a separate Guesser; non-host cannot start; mid-game join becomes Guesser without interrupting turn.

## 10. Add server deadlines and timeout delivery

**Status:** Completed; `c939141`. Design: [docs/superpowers/specs/2026-10-13-task-10-deadlines-design.md](docs/superpowers/specs/2026-10-13-task-10-deadlines-design.md). Verified 2026-10-13 with `scripts/check-timeouts.ts`: grace, discard and Overtime loss broadcast 0.8–1.9 s after their deadlines; stale messages change nothing. Alarms exist and are OK; making one fire is Task 15.

**Context:** Browser countdown is visual; server decides whether a command meets 20-second clue, 3-second grace and 20-second Overtime deadlines.

**What needs to be done:** Add SQS standard delayed queue, DLQ, timeout Lambda, UTC deadline transitions, and deadline reconciliation on each API read/command. Queue message carries SQUID/turn/phase/deadline only. Use version/phase guards against duplicate, early and old-turn messages; derive grace expiry from original clue deadline. Broadcast committed transitions.

**Acceptance criteria:** Clue expiry enters grace, grace expiry discards card/costs life/restores pile, Overtime expiry loses; early/duplicate/late queue messages cannot extend or corrupt deadlines; rerender, reconnect or selecting gaps does not restart timer; DLQ failures are visible.

## 11. Connect private draw and explicit clue submission

**Status:** Completed; `f30de1a`. Design: [docs/superpowers/specs/2026-10-13-task-11-draw-and-clue-design.md](docs/superpowers/specs/2026-10-13-task-11-draw-and-clue-design.md). Verified 2026-10-13 with `scripts/check-clue.ts` and a three-tab browser test. Sending the word goes straight to guessing (no hand-over step).

**Context:** Fixed Tipster alone sees draw. Typed text is local until they press **Send word**, including during grace.

**What needs to be done:** Add Tipster-only `DRAW` and `SUBMIT_CLUE` API commands, phase validation and exact-duplicate/format errors. Wire secret-number panel, countdown and Send word to authoritative backend. Hide number at handoff; show submitted clue to all. Do not sync drafts or auto-send a typed word when timer expires.

**Acceptance criteria:** Only Tipster can draw/submit; Guesser cannot fetch hidden number; Tipster can send early or in grace; typed but unsent valid word is discarded at grace expiry; duplicate/malformed word shows actionable error; private number does not reappear to Guessers via refresh/socket.

## 12. Implement shared two-click gap selection

**Status:** Completed; `cad7fcf`. Design: [docs/superpowers/specs/2026-10-13-task-12-gap-selection-design.md](docs/superpowers/specs/2026-10-13-task-12-gap-selection-design.md). Verified 2026-10-13 with `scripts/check-gaps.ts` and a three-tab browser test including a real stale-lock race. Results show immediately until Task 13 adds the shared reveal.

**Context:** Any Guesser may select; the second click on *current* shared gap by any Guesser locks for whole team. There is no designated Guesser or separate Reveal button.

**What needs to be done:** Add `CHOOSE_GAP` and `LOCK_GAP` with optimistic version checks and idempotency; display selected hourglass to everyone. First click on a different/unselected gap selects and broadcasts. A second click on same *confirmed* selection locks; if another Guesser changed selection, show latest highlight and require a fresh click. Tipster has no guess controls. Never reset Overtime deadline on selection.

**Acceptance criteria:** Three-browser test: Guesser A selects, all see selection; Guesser B clicks same selected gap and locks once; competing clicks or stale versions cannot lock unintended gap; clicking another gap changes selection; one tap alone never grades; Tipster cannot select or lock; Overtime expiry still counts as miss if only selected.

## 13. Synchronize Reveal across players

**Status:** Completed; `b70b1cc`. Design: [docs/superpowers/specs/2026-10-13-task-13-shared-reveal-design.md](docs/superpowers/specs/2026-10-13-task-13-shared-reveal-design.md). Verified 2026-10-13 with `scripts/check-reveal.ts` and three tabs: results appeared within 133 ms of each other; the tap shows the locked gap instantly and the 2 s are a visible build-up. `NEXT_TURN` gating is part of Task 14.

**Context:** Guessers may be in a video call; locking player must not see answer first. A short shared delay is accepted.

**What needs to be done:** On `LOCK_GAP`, grade server-side, store result and `revealAtUtc` ~2 seconds ahead, then broadcast result + target time. The locking command acknowledges without result. Browser waits for target using server clock offset. Authorized GET before target returns pre-reveal view + pending result/target for reconnect; reject `NEXT_TURN` until target passes.

**Acceptance criteria:** All connected screens show result around same target time, including locking Guesser; slow/reconnected player catches up; pre-reveal GET does not render result early; wrong guess still inserts correct card and deducts life once; double-lock retries cannot advance twice.

## 14. Complete game progression and restart path

**Status:** Completed; `b7aeab6`. Design: [docs/superpowers/specs/2026-10-13-task-14-progression-design.md](docs/superpowers/specs/2026-10-13-task-14-progression-design.md). Verified 2026-10-13 with `scripts/check-progress.ts` and a three-tab browser run: next card, a won game, and the new-session handoff with one-click Join.

**Context:** Twelve-card pile is a goal, not turn limit. Third lost life starts Overtime; wrong last card needs replacement. A player leaving may break game.

**What needs to be done:** Connect `NEXT_TURN`, replacement draws, win/loss panels and host's **New session** action. New session produces a new SQUID and invite URL; old session expires. Maintain fixed Tipster during a game. Handle joining after start and visibility of finished state. `NEXT_TURN` must be refused before `revealAtUtc` and must reset `revealAtUtc` and `lockedBy` (from Task 13).

**Acceptance criteria:** Complete multiplayer run wins only on correct placement with empty pile (even Overtime); wrong final draw allows replacement; subsequent Overtime miss/timeout loses; a new session has fresh roles/pile/cards and URL; no hidden number persists into result/next game.

## 15. Verify end-to-end in isolated development stack

**Status:** Pending.

**Context:** Unit tests cannot establish real-time authorization, shared timing or reconnect behavior across devices. Prove full game before production deployment.

**What needs to be done:** Exercise host/join/claim/start/draw/send/select/lock/reveal/end in development sandbox/branch with multiple browsers; test concurrent claims and locks, timeout races, late join, disconnect/reconnect, private-data leakage, new-session restart and mobile layout. Record a short smoke procedure for production. Configure CloudWatch/DLQ alarms in development and verify one controlled failure is detected.

**Acceptance criteria:** Two or more Guessers and Tipster complete game from separate browsers; unauthorized room subscription/publish and hidden-card requests fail; shared selection and Reveal timing work on real network; tests and build pass; alarm fires for a simulated failure; production smoke procedure is written.

## 16. Configure automatic GitHub `main` deployment

**Status:** Pending. Revisit the branch-protection gap from Task 4 first.

**Context:** After dev flow passes, production should update when a PR is merged to `main`, using Amplify as only deploy trigger.

**What needs to be done:** Connect GitHub repo `main` to Amplify Hosting production branch. Add versioned `amplify.yml` (`npm ci`, `npm run check`, `npx ampx pipeline-deploy --branch "$AWS_BRANCH" --app-id "$AWS_APP_ID"`, frontend build), static SPA rewrite, branch-specific endpoint outputs and optional domain. Configure production alarms, log retention and AWS budget alert; keep backend changes compatible with old frontend during rollout. Optional isolated PR previews only for private repository. Run task 15's smoke procedure after first merge.

**Acceptance criteria:** Merge of a tested PR updates live frontend/backend with no manual AWS command; failed checks/build do not publish broken frontend; fresh `/s/{squid}` link reloads; production data is separate from sandbox/previews; no AWS secrets stored in repository or GitHub Actions; deploy status and failure are visible; production smoke passes.
