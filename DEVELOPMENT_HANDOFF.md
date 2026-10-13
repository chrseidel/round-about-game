# Development handoff

**As of 2026-10-13:** all 16 tasks in [TASKS.md](TASKS.md) are complete. The game is live at `https://round-about.chreisel.net` (Amplify app `round-about-game`, ID `d25cphjw1kxoxa`, `eu-central-1`) and every merge to `main` deploys it. Working rules and the code map are in [AGENTS.md](AGENTS.md); AWS components and the pipeline in [INFRASTRUCTURE.md](INFRASTRUCTURE.md).

## Resume here

1. Inspect `git status`, `git log` and open pull requests before changing anything.
2. **Next:** no task is open. New work starts from a request, one branch and pull request at a time.
3. **Workflow that worked for Tasks 9–16:** agree a short design, write it to `docs/superpowers/specs/`, write a plan to `docs/superpowers/plans/`, build test-first, redeploy the sandbox, verify with `npm run smoke:dev` plus a three-tab browser test (a phone-sized tab for UI changes), then one feature commit and a separate docs commit on the branch. Push and open the pull request when the owner asks; merge only with the owner's OK.
4. After a merge that changes the backend, run the production part of [docs/SMOKE.md](docs/SMOKE.md).

## Open items for the owner (not code)

- **Lambda concurrency** is still 10 in `eu-central-1`; the support case for 1000 is open. Until then heavier use can return 503 "Service Unavailable"; `LambdaThrottlesAlarm` shows it.
- Optional: rename the local folder `one-round` (this detaches Claude's saved project memory, which is keyed by folder path).
- Optional: delete the old `/aws/lambda/amplify-roundabout-…` sandbox log groups (no new logs since 14-day retention moved logs to new groups).

## Environment

- Use `AWS_PROFILE=chreisel` in `eu-central-1` (CDK-bootstrapped). Sandbox: `AWS_PROFILE=chreisel npx ampx sandbox --once --identifier round-about-dev`; it writes the ignored `amplify_outputs.json` that `npm run dev` serves. `.claude/launch.json` starts the dev server for the desktop app's browser pane.
- Node `v22.23.3` (nvm default `22`); older 22.x releases trigger Amplify engine warnings. If `node -v` shows an older version, prepend `~/.nvm/versions/node/v22.23.3/bin` to `PATH`. The Amplify CLI sometimes prints an unsettled top-level-await warning on exit; it is harmless.
- GitHub: public repository `chrseidel/round-about-game`, `origin` `git@github.com:chrseidel/round-about-game.git` (SSH as `chrseidel`). The project was called "One Round" until 2026-10-12.

## Known gaps and deferred minors

- No rate limiting of creates/joins (only the 12-player cap).
- Alarms have no notification target.
- A deliberately failing Amplify build has not been triggered; `amplify.yml` runs `npm run check` before deploying, so it should stop the deploy.
- The command handler's retry after a conditional-write conflict has never run against AWS (requests were always serialized) and has no automated test, because the DynamoDB client in `handler.ts` is not injectable. The conditional write alone keeps state consistent.
- Replacing a session: if the old session's write conflicts, the API answers 409 and the new session stays unused until its TTL (rare; a transaction would avoid it).
- An Overtime loss (or a grace discard at 0 lives) leaves `lives` at -1 in the reducer; the UI clamps the display.
- The locking player sees the reveal ~130 ms before the others, because each browser's clock offset includes its own one-way delay; a round-trip-based offset would tighten this.
- The lobby renders only after the WebSocket subscribes (~0.5 s), although join/reload already return a snapshot.
- The `web/events.ts` "session ended" path (stop reconnecting after a confirmed 401/404) is unit-tested only.

## Lessons learned

**Backend**

- `amplify/backend.ts` is the only record of what exists. On 2026-10-09 a deploy from an uncommitted tree left a throwaway route live for three days; deploy only from committed code and redeploy after every backend change.
- Amplify sandboxes delete the session table with the stack despite `RemovalPolicy.RETAIN`; the production stack keeps it (`DeletionPolicy: Retain` confirmed).
- New stream triggers need time before they deliver: about a minute after a sandbox deploy, about 3.5 minutes after the first production deploy.
- New commands: add a case to `applyCommand` in `amplify/functions/game-api/command.ts` and a pure function in `session.ts`. `applyCommand` reconciles due deadlines first and refuses replaced sessions; every write goes through `rememberCommand` (last 20 command IDs, so retries are answered without reapplying).
- `LOCK_GAP` is the only strict command: selected gap and `expectedVersion` must match the stored state, else 409 `STALE_VERSION`. `CHOOSE_GAP` is last-click-wins. A lock sets `revealAtUtc` (now + 2 s) and `lockedBy`; `NEXT_TURN` and `DRAW` from a result refuse to run before it.
- `finalStatus(game)` decides win/loss at each result; a finished session accepts no further turns.
- Write to DynamoDB through `documentClient()` from `amplify/functions/shared/db.ts`: results can contain `undefined` fields, which the default client rejects.
- **Lockfile trap:** `npm install <package>` drops nested `@opentelemetry/core@2.0.0` entries from Amplify's bundled constructs, after which `npm ci` (CI and Amplify) fails. Run `npm install --package-lock-only` and confirm `npm ci --dry-run`.

**Browser**

- Every snapshot, including command responses, goes through `mergePrivate(latest, next)` in `web/turn.ts`: it drops older versions and keeps the Tipster's `currentDraw` across public events. A draw's public event can arrive before the Tipster's own response with the same version.
- Decide anything status-related on `revealed(latest, serverNow)`, not on the raw snapshot: no event arrives at the reveal moment, so the raw snapshot keeps the pre-reveal status (this once broke the New game button).
- Countdowns use `serverTimeUtc` from each snapshot (`secondsLeft`). The typed clue lives only in page memory; the field is rebuilt only when the card changes, so live updates keep focus and draft.
- Since issue #4 the board is a pixel scene (`web/scene.ts`) fixed behind the page; empty placeholders (`.scene-spot` in entry/lobby, `#board` in the game layout) tell it where to fit the ring, so CSS decides the layout. Exits are real buttons (44 px tap area); the selected one blinks for everyone, including the Tipster, whose exits are disabled.
- The scene draws immediately on every update and uses animation frames only for motion: browsers pause frames in background tabs, and the board must still be current there. `renderPlay` updates the panel before the board, because on phones the panel's height decides the board's size.
- Sign size: `fitGame` (camera.ts) picks full or compact signs from a worst-case estimate; the scene then measures the drawn signs and steps up to compact signs, then extra board height (the page scrolls a little), if real signs collide. Checked with 18 cards at 1024 × 768 and 375 × 812: no overlapping signs, no covered exits.
- The reveal car and the camera move run once per `revealAtUtc` / game start; reduced motion skips them and the lobby's circling cars.
- The page reads the session code with `codeFromPath`, which tolerates `/s/<code>/`.

**Testing**

- In browser tests with batched steps, pauses between batches eat into the 20-second clue time; keep time-sensitive steps (draw, reload, read timer) in one batch.
- `.superpowers/` is git-ignored scratch for test helpers and plan ledgers.

## Recreating production

Done in this order on 2026-10-13; keep as the reference if the app ever has to be rebuilt.

1. **AWS console** (`eu-central-1`): Amplify → Create new app → GitHub → repository `chrseidel/round-about-game`, branch `main` → let Amplify create a new service role (it carries `AmplifyBackendDeployFullAccess`, although named `AmplifySSRLoggingRole-…`) → confirm the detected `amplify.yml` → Save and deploy. A build triggered before `amplify.yml` is on `main` uses the console's default spec.
2. **Rewrite rule**, placed before Amplify's default `/<*>` 404-200 rule (otherwise `/s/<code>` is redirected to `/s/<code>/` and answers 404): source `</^[^.]+$|\.(?!(css|gif|ico|jpg|js|png|txt|svg|woff|woff2|ttf|map|json|webp)$)([^.]+$)/>`, target `/index.html`, type 200. PR previews off.
3. **Domain:** association `chreisel.net`, prefix `round-about` → branch `main`. Amplify issues the certificate and adds one CNAME to the Route 53 zone.
4. **Production origins** are fixed in `amplify/origins.ts`; a new app ID changes the `amplifyapp.com` origin automatically, a new domain needs a code change.
5. **Verify:** the build log shows `npm run check`; the site and a direct `/s/<code>` link load; CORS answers the production origin and not localhost; the production part of [docs/SMOKE.md](docs/SMOKE.md) passes, including the two-device check.
