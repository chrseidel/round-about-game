# Task 16: production deployment from GitHub `main`

**Status:** design approved 2026-10-13. Implements Task 16 in [TASKS.md](../../../TASKS.md); background in [INFRASTRUCTURE.md](../../../INFRASTRUCTURE.md).

## Goal

Acceptance criteria from TASKS.md:

- Merging a tested pull request updates the live frontend and backend with no manual AWS command.
- Failed checks or builds do not publish a broken frontend.
- A fresh `/s/{squid}` link loads.
- Production data is separate from the sandbox.
- No AWS secrets in the repository or GitHub Actions.
- Deploy status and failures are visible.
- The production smoke procedure passes.

Plus: the game runs at **`https://round-about.chreisel.net`**.

## Decisions

1. **Domain:** `round-about.chreisel.net`. `chreisel.net` is a Route 53 domain and hosted zone in the same account, so Amplify creates the certificate and DNS records.
2. **No PR previews.**
3. **The repository is public; `main` is protected for everyone, admins included.**
   - Changes reach `main` only through pull requests.
   - The `check` workflow must pass first.
   - 0 required approvals (single maintainer).
   - No force pushes, no deletion.

   From now on every task is a branch `task-NN-slug` with a pull request; merging (only after the owner's OK) deploys production.
4. **Launch waits for the Lambda quota.** The owner requested 1000 concurrent executions in `eu-central-1` (support case opened 2026-10-13). The first production deploy happens after approval.

## Repository changes (this task's pull request)

- **`amplify.yml`:**
  - backend phase: `npm ci`, `npm run check`, `npx ampx pipeline-deploy --branch $AWS_BRANCH --app-id $AWS_APP_ID`;
  - frontend phase: `npx ampx generate outputs --branch $AWS_BRANCH --app-id $AWS_APP_ID`, `npm run build`, `cp amplify_outputs.json dist/`;
  - artifacts `dist/**/*`; cache `node_modules`.

  A failing `npm run check` or build fails the job, and Amplify keeps the previous version live.
- **`amplify/backend.ts`, allowed origins by branch:** when `AWS_BRANCH` is set (Amplify Hosting builds), allow `https://round-about.chreisel.net` and `https://${AWS_BRANCH}.${AWS_APP_ID}.amplifyapp.com`; otherwise (sandbox) keep the localhost origins. Extract this into a small tested function `allowedOrigins(env)` in `amplify/origins.ts`.
- **Log retention:** every `defineFunction` gets `logging: { retention: "2 weeks" }`.
- **Docs:**
  - `AGENTS.md` and `DEVELOPMENT_HANDOFF.md` describe the pull-request workflow and the production setup;
  - `INFRASTRUCTURE.md` gets a status line saying it is now deployed;
  - `docs/SMOKE.md` names the Amplify app and how to read the production outputs.

## One-time setup (outside the repository, each step confirmed first)

1. **Branch protection on `main`** via the GitHub API, right after this pull request is opened: required check `check`, require pull requests, 0 approvals, enforce for admins, no force push or deletion.
2. **Amplify app (the owner, in the AWS console, after the quota is approved and this pull request is merged):** Amplify → Create new app → GitHub → authorize → repository `chrseidel/round-about-game`, branch `main` → app name `round-about`. Let Amplify **create a new service role** (it attaches `AmplifyBackendDeployFullAccess`). Confirm the detected `amplify.yml`. Save and deploy. No GitHub token passes through the assistant.
3. **Through the AWS CLI, after the app exists (assistant, with confirmation):**
   - rewrite rule `</^[^.]+$|\.(?!(css|gif|ico|jpg|js|png|txt|svg|woff|woff2|ttf|map|json|webp)$)([^.]+$)/>` → `/index.html` (200);
   - PR previews off;
   - domain association `chreisel.net` with subdomain `round-about` → branch `main` (Amplify creates the certificate and records in the hosted zone).

## Verification

- `npm run check` (unit test for `allowedOrigins`) and the pull request's `check` run on GitHub.
- A direct push to `main` is rejected after protection is on.
- **First production build:** `npm run check` ran in the Amplify log, a separate production stack exists (`amplify-…-main-branch-…`), and the sandbox is untouched.
- `https://round-about.chreisel.net` loads with a valid certificate; `/s/ABCDEFGHJKMN` loads the app (not a 404).
- The game API answers CORS for the production origin and rejects `http://localhost:5173` there.
- `docs/SMOKE.md` production part passes: the four API scripts against the production endpoints, plus the owner's two-device check.
- A deliberately failing build (a pull request branch never merged is enough to show `check` blocking; no broken build is merged) shows the gate.

## Out of scope

PR previews, a staging environment, alarm notifications.
