# Smoke procedures

How to check that Round About works after a deploy. All commands run from the repository root with Node 22.23 (`nvm use 22`).

## Development sandbox (`round-about-dev`)

Run after every sandbox deploy (`AWS_PROFILE=chreisel npx ampx sandbox --once --identifier round-about-dev`). After any deploy that creates or updates functions, give the stream triggers about a minute before running the checks; an immediate run can miss the first live event.

```bash
AWS_PROFILE=chreisel npm run smoke:dev
```

Runs all seven sandbox checks one after another (about 90 seconds) and stops at the first failure: `check-events`, `check-lobby`, `check-clue`, `check-gaps`, `check-reveal`, `check-timeouts`, `check-progress`. The last three and `check-gaps` write test state straight into the sandbox table, so they are **development only**.

To prove the alarms still fire (takes about 5–6 minutes):

```bash
AWS_PROFILE=chreisel npx tsx scripts/check-alarm.ts
```

It puts one test message into the `TimeoutFailures` queue, waits for `TimeoutFailuresAlarm` to reach ALARM, removes exactly that message and waits for OK again.

## Production (`https://round-about.chreisel.net`)

Run after the first production deploy and after any backend change. **Never run the development-only scripts against production**: `check-timeouts`, `check-gaps`, `check-progress` and `check-alarm` write into the table or queues.

1. Get the production endpoints (`gameApiUrl`, `gameEventsUrl`) from the production branch's outputs, for example:

   ```bash
   AWS_PROFILE=chreisel npx ampx generate outputs --app-id <app-id of the Amplify app "round-about"> --branch main --out-dir /tmp/prod-outputs
   ```

2. Run the API-only checks with those values:

   ```bash
   npx tsx scripts/check-events.ts <gameApiUrl> <gameEventsUrl>
   npx tsx scripts/check-lobby.ts <gameApiUrl>
   npx tsx scripts/check-clue.ts <gameApiUrl> <gameEventsUrl>
   npx tsx scripts/check-reveal.ts <gameApiUrl> <gameEventsUrl>
   ```

   They create a few short-lived test sessions (deleted by TTL after 24 hours) and take about 45 seconds. Each prints `failures: []` when it passes.

3. Five minutes by hand on two devices (one phone):
   - Phone: open `https://round-about.chreisel.net`, host a session, copy the invite link.
   - Second device: open the link directly (it must load, not 404), join with another nickname.
   - Claim Tipster on one device, start on the host, draw a card, send a word.
   - On the other device: the word appears without a refresh; select a gap, tap it again to lock; both devices reveal the result together.
   - Host: ↻ New game; the other device shows "… started a new game." and Join works.

## When something fails

- **A script fails:** it prints which step and what it saw. Rerun once: a brand-new stream trigger right after a deploy can miss the first event.
- **Alarms** (CloudWatch → Alarms, `eu-central-1`): `LambdaThrottlesAlarm` means the account's Lambda concurrency limit was hit (10 until the requested increase is approved; Service Quotas → AWS Lambda → Concurrent executions); `GameApiServerErrorsAlarm` means the API answered 5xx; the three `…FailuresAlarm` mean timeouts, deadline scheduling or event publishing failed repeatedly.
- **Logs:** CloudWatch → Log groups → `amplify-roundabout-…-loggroup…` (one per function: game API, timeout, deadline scheduler, event publisher, event auth; kept 14 days). The older `/aws/lambda/amplify-roundabout-…` groups no longer receive logs. Logs contain only error names, never tokens or card numbers.
- **Deploys:** Amplify console → app `round-about` → branch `main` shows each build, its log and status; a failed `npm run check` or build stops the deploy and leaves the previous version live.
