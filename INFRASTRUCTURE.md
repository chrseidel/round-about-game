# Round About: infrastructure and deployment

**Status:** production live at `https://round-about.chreisel.net` since 2026-10-13; development sandbox `round-about-dev`. Both run in `eu-central-1` in the owner's account (`AWS_PROFILE=chreisel`). Game behavior and security boundaries are in [ARCHITECTURE.md](ARCHITECTURE.md). **The exact resources are defined in [`amplify/backend.ts`](amplify/backend.ts)**, the single source of truth; this page explains how they fit together and how they are deployed.

## Traffic path

```text
GitHub PR ──► check workflow ──merge──► main ──► Amplify Hosting build (amplify.yml)
                                                   │ checks → backend deploy → frontend build
                                                   ▼
browser ── HTTPS ──► HTTP API ──► game-api Lambda ──► DynamoDB Sessions table
   │                                                    │ stream (NEW_IMAGE)
   │                                     ┌──────────────┴──────────────┐
   │                                     ▼                             ▼
   │                           event-publisher Lambda        deadline-scheduler Lambda
   │                                     │ IAM publish                 │ delayed message
   └── WSS ──► AppSync Events ◄──────────┘                   SQS TimeoutQueue ──► timeout Lambda
              (event-auth Lambda checks membership)                               (writes table)
```

## Components

| Component | Role |
| --- | --- |
| **Amplify Hosting** (app `round-about-game`, `d25cphjw1kxoxa`) | Builds `main` on every push, deploys its backend stack and serves the static app over CloudFront. Custom domain `round-about.chreisel.net` (Amplify-managed certificate, one CNAME in the `chreisel.net` Route 53 zone). A 200 rewrite sends extension-less paths such as `/s/<code>` to `/index.html`; it must stay **before** Amplify's default `/<*>` 404 rule. PR previews are off. |
| **HTTP API** → `game-api` Lambda | Host, join, snapshot and command endpoints. CORS allows only the production origins in Amplify builds and only `localhost:5173` in the sandbox (`amplify/origins.ts`). |
| **DynamoDB `Sessions`** | One item per session, on-demand, TTL on `expiresAt` (24 h; 10 min after a session is replaced). Retained if the production stack is deleted. Browsers never access it directly. |
| **Table stream → `event-publisher`** | Publishes the public projection of every committed write to AppSync channel `/games/{squid}`; retries 5 times, then records the failure in the `EventPublishFailures` queue. Only this function may publish. |
| **AppSync Events** (namespace `games`) | WebSocket fan-out. Subscribing requires a participant token of that session, checked by the `event-auth` Lambda authorizer; browsers cannot publish. |
| **Table stream → `deadline-scheduler` → `TimeoutQueue` → `timeout`** | Every saved deadline becomes a delayed SQS message (SQUID, turn, phase, deadline; no card values). `timeout` applies it only if it still matches. The API also reconciles due deadlines on every read and command, so a late message never extends play. Failures go to `DeadlineScheduleFailures` and `TimeoutFailures`. |
| **CloudWatch** | Five alarms, without notifications: the three failure queues, `LambdaThrottlesAlarm` and `GameApiServerErrorsAlarm` (HTTP 5xx). Function logs are kept 14 days. |

No Cognito, VPC, NAT gateway, always-on server or GitHub-held AWS credentials.

## Environments

| | Production | Development sandbox |
| --- | --- | --- |
| Deployed by | Amplify Hosting on every push to `main` | `AWS_PROFILE=chreisel npx ampx sandbox --once --identifier round-about-dev` |
| Stack | `amplify-d25cphjw1kxoxa-main-branch-…` | `amplify-roundabout-roundaboutdev-sandbox-…` |
| Frontend | `https://round-about.chreisel.net` | local `npm run dev` (reads the ignored `amplify_outputs.json`) |
| Endpoints | `npx ampx generate outputs --app-id d25cphjw1kxoxa --branch main` | `amplify_outputs.json` |
| Allowed scripts | API-only checks (see [docs/SMOKE.md](docs/SMOKE.md)) | everything, including table-writing checks |

The environments share nothing except the account's Lambda concurrency quota.

## Deployment pipeline

1. **Pull request:** GitHub Actions (`.github/workflows/check.yml`) runs `npm ci` and `npm run check`. Branch protection on `main` (admins included) requires a pull request and a passing `check`, and forbids force pushes and deletion. GitHub holds no AWS credentials.
2. **Merge:** Amplify builds with [`amplify.yml`](amplify.yml): `npm ci`, `npm run check`, `npx ampx pipeline-deploy` (backend), then `npx ampx generate outputs`, `npm run build` and copying `amplify_outputs.json` into `dist/`, where the browser reads its endpoints at startup. A failing step stops the build and the previous frontend stays live.
3. **Rollout order:** the backend deploys before the frontend is published, so a frontend failure can leave a new backend serving the old frontend. Keep changes backward compatible; fix forward or revert on `main` through a pull request. Never edit production resources or table items by hand.
4. **After a deploy that touches the backend:** run the production part of [docs/SMOKE.md](docs/SMOKE.md). A brand-new stack's stream triggers took about 3.5 minutes to deliver their first event.

Build status and logs: Amplify console → app `round-about-game` → branch `main`.

## Limits and costs

- **Lambda concurrency:** the account allows 10 concurrent executions in `eu-central-1` (new-account default); an increase to 1000 is requested (support case opened 2026-10-13). Both environments' five functions share it; throttled API calls answer 503 and trigger `LambdaThrottlesAlarm`.
- **Budget:** an account-wide AWS Budget "My Monthly Cost Budget" (USD 50/month) exists; it is not managed by this repository.
- At ~100 games a month every component stays in on-demand pricing; there is no idle compute.

## Known gaps

- No rate limiting of creates and joins beyond API Gateway's account defaults; sessions are capped at 12 players.
- Alarms have no notification target; check the CloudWatch console.
- The old `/aws/lambda/amplify-roundabout-…` log groups from before 14-day retention still exist (sandbox only, no new logs) and can be deleted.
