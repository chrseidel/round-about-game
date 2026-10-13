# Round About: infrastructure and deployment plan

**Status:** development sandbox deployed and verified (Tasks 5–15); production live via Amplify Hosting at `https://round-about.chreisel.net` since 2026-10-13 (Task 16; see DEVELOPMENT_HANDOFF.md). Companion to [ARCHITECTURE.md](ARCHITECTURE.md), which covers game rules, server authority, participant permissions and synchronized Reveal. Target: small groups, ~50 players and ~100 games/month. One GitHub repository; `main` is production.

## Traffic path

```text
GitHub PR ──► checks ──merge──► main ──► Amplify Hosting build/deploy
                                            │
                                    static browser app
                                            │
                        ┌── HTTPS ──► HTTP API ──► game Lambda ──► DynamoDB
                        │                         └─► SQS delay ──► timeout Lambda
                        └── WSS ───► AppSync Events ◄─ backend-only publish
```

| Component | Purpose | Deployment/ownership |
| --- | --- | --- |
| **Amplify Gen 2 app + Hosting** | Connect GitHub `main`, build static app and backend together on merges, serve site over HTTPS/CDN, provide generated domain and optional custom domain; rewrite `/s/{squid}` to SPA entry. | One production branch in Amplify; managed hosting/CDN. No SSR or always-on compute. |
| **AWS CDK resources in `amplify/backend.ts`** | Declare backend alongside frontend deployment; grant least-privilege permissions and export **public** API endpoints/region to frontend configuration. | Amplify Gen 2 branch deployment. HTTP API, AppSync Event API and SQS are **custom CDK resources**, not automatic `a.model()` resources. |
| **API Gateway HTTP API** | Host/join, authorized snapshots, game commands and participant credentials; one endpoint for browser actions. | Calls Lambda; restrict browser origins, throttle creates/joins and validate all requests server-side. |
| **Game Lambda** | Authenticate participant token, enforce host/fixed Tipster/Guesser/phase permissions, apply pure reducer, project public vs. private responses, conditionally commit to DynamoDB, publish shared gap selection and lock-in/result updates. | Stateless; token and drawn number never logged. Draw response goes to Tipster alone. |
| **DynamoDB on-demand** | Durable session per SQUID: participant nicknames/token hashes, one Tipster seat, shared provisional selected gap, sorted circle, hidden deck/current draw, pile, phase, version and deadlines. Conditional writes grant Tipster to only the first claimant and prevent competing Guessers from locking different gaps; TTL removes stale sessions. | Backend only; never grant browsers direct table access. Keep one session item below DynamoDB item-size limit. |
| **AppSync Events (Event API)** | Managed WebSocket channels for near-simultaneous shared game updates and Reveal, without our own connection registry. | `games/{squid}` subscription requires per-session membership; only backend IAM role may publish. Client cannot publish or subscribe to other rooms. Verify auth in a deployed spike before choosing this component definitively. |
| **SQS standard queue + dead-letter queue; timeout Lambda** | Wake backend around 20-second clue expiry, 3-second grace, and 20-second Overtime expiry; retry failed processing. | Delayed messages carry SQUID/turn/phase, **not** secret card values. Server still checks UTC deadlines on every command/read; SQS arrival is not the clock. Alarm on DLQ and late timeouts. |
| **CloudWatch logs/metrics/alarms** | Observe HTTP errors, auth failures, Lambda faults, missed timeouts, DLQ depth and failed event publishing. | Short log retention and bounded alarms. Avoid logging participant credentials or hidden numbers. |
| **Route 53 + Amplify-managed TLS (optional)** | Friendly `play.example.com` share URLs; Amplify-provided URL and TLS suffice initially. | Domain/DNS registration independent of application deployment. |

No Cognito, Amplify Auth sign-in, email service, chat/video service, VPC/NAT gateway, or dedicated server is needed for v1. A nickname in `localStorage` pre-fills future joins; the API-issued participant token in tab `sessionStorage` proves membership for the current SQUID. SQUID and nickname alone do **not** authorize reading the Tipster's number. Event subscription auth must validate the same membership, not merely channel name or a public API key. The [architecture draft](ARCHITECTURE.md) specifies a fallback to custom API Gateway WebSockets **only if** this AppSync membership/publish boundary fails a deployment spike; do not deploy both in production.

## GitHub → production pipeline

Use **Amplify Hosting's GitHub connection as the only deployment trigger**. GitHub Actions checks pull requests but does not independently deploy to AWS; this avoids duplicate releases, long-lived AWS credentials in GitHub and mismatched frontend/backend versions.

1. **One-time setup:** create the Amplify Gen 2 app, authorize it to read this GitHub repository, connect the `main` branch and enable auto-build. Configure its service role to deploy backend resources. Add an Amplify SPA rewrite for `/s/{squid}`; use the generated Amplify URL or attach a domain. Keep `main` connected only to production backend; test changes with a developer sandbox or isolated preview branch, never against live sessions.
2. **PR checks (GitHub Actions, `pull_request` targeting `main`):** install from committed lockfile with `npm ci` once the planned TypeScript/Vite migration introduces `package.json`; run formatting/typecheck, game/API tests, frontend build and backend synth. For the **current static prototype**, the runnable checks are `node --check app.js` and `node --test game.test.js`; do not claim nonexistent npm scripts exist yet. Run authorization/projection/integration tests after implementing backend. Configure GitHub branch protection so checks and review must pass before merge. No AWS deployment credentials needed for this CI job. Proposed CI commands (after migration): `npm ci`, `npm run check`, `npm run build`; add a synth-only script when the backend definitions exist.
3. **Merge to `main`:** GitHub notifies Amplify; its fullstack build installs locked dependencies, runs checks, runs `npx ampx pipeline-deploy --branch "$AWS_BRANCH" --app-id "$AWS_APP_ID"` for backend resources, builds the frontend and serves it with the branch-specific generated endpoint configuration. Store the build specification as `amplify.yml` in repo once build tooling exists (avoid console-only steps that teammates cannot review). Backend deployment precedes frontend publication, so a frontend failure **can leave new backend resources live with old frontend**; keep API/schema changes backward compatible, monitor Amplify deployment failures and fix forward or revert. Check rollout with a host/join smoke test from two devices after backend changes.
4. **Previews (optional, later):** Amplify PR previews can create isolated fullstack environments for manual two-player tests; tear them down on PR close. AWS documents that fullstack previews with Amplify backend templates require a **private GitHub repository**. If repo is public, use a private dev branch/sandbox instead. Never point preview builds at the production DynamoDB table or Event API. Avoid automatic deployment of *every* feature branch to limit cost/resources.

Example intended `amplify.yml` sequence **after migration** (the `check` script and `dist/` directory are proposed, not present today):

```yaml
version: 1
backend:
  phases:
    build:
      commands:
        - npm ci
        - npm run check
        - npx ampx pipeline-deploy --branch "$AWS_BRANCH" --app-id "$AWS_APP_ID"
frontend:
  phases:
    build:
      commands:
        - npm run build
  artifacts:
    baseDirectory: dist
    files:
      - '**/*'
  cache:
    paths:
      - node_modules/**/*
```

Maintain the same `npm run check` in GitHub Actions and Amplify build so an accidental direct push to `main` cannot ship code that fails checks. Protect `main` in GitHub; Amplify auto-build runs on any push, not only a merged PR. Put frontend URLs/region in Amplify-generated outputs; do **not** commit `amplify_outputs.json` for production as a universal local config, or use frontend environment variables for secrets. Add secrets only through Amplify's branch-specific secret management if the backend later needs them. Keep domain and rollback procedure documented: fix-forward or revert/merge on `main`; for a broken release, redeploy a known-good commit via a controlled Git revert rather than changing backend records manually. DynamoDB schema changes must be backward compatible across backend/frontend rollout and existing sessions.

## First infrastructure validation

Before committing to real-time implementation, deploy a small isolated Amplify sandbox/dev stack and verify: member can subscribe to `games/{squid}`; nonmember cannot; a browser cannot publish; simultaneous Tipster claims yield one winner; backend broadcasts a Guesser's provisional gap selection to every player; another Guesser's second click on that same current gap locks exactly once; the Tipster cannot submit a guess; no hidden draw is in the event; reconnect catches up via authorized snapshot; and clients display the locked result using the same `revealAtUtc`. Confirm the deployment role can create custom CDK resources in Amplify, the SPA rewrite works on refresh, and delayed queue delivery never overrides a later turn.

## References

- [Amplify Hosting Git-based deployment](https://docs.amplify.aws/react/deploy-and-host/amplify-hosting/) and [fullstack `main` branch deployment](https://docs.amplify.aws/react/deploy-and-host/amplify-hosting/branch-deployments/)
- [Amplify Gen 2 quickstart: connect GitHub `main`](https://docs.amplify.aws/react/start/quickstart/), [PR preview requirements](https://docs.amplify.aws/react/deploy-and-host/amplify-hosting/pr-previews/), [branch secrets vs. environment variables](https://docs.amplify.aws/react/deploy-and-host/amplify-hosting/secrets-and-vars/)
- [Amplify custom CDK resources](https://docs.amplify.aws/react/build-a-backend/add-aws-services/custom-resources/), [AppSync Events overview](https://docs.aws.amazon.com/appsync/latest/eventapi/event-api-welcome.html)
