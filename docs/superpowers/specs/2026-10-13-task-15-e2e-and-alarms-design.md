# Task 15: end-to-end verification, alarms, smoke procedure

**Status:** design approved 2026-10-13. Implements Task 15 in [TASKS.md](../../../TASKS.md).

## Goal

Acceptance criteria from TASKS.md:

- Two or more Guessers and a Tipster complete a game from separate browsers.
- Unauthorized room subscription and publishing, and hidden-card requests, fail.
- Shared selection and reveal timing work on the real network.
- Tests and build pass.
- An alarm fires for a simulated failure.
- A production smoke procedure is written.

Also to exercise: concurrent claims and locks, timeout races, late join, disconnect/reconnect, private-data leakage, new-session restart, mobile layout.

## Decisions

1. **No notifications yet.** Alarms stay visible in the CloudWatch console only; no SNS topic.
2. **Extra alarms.** Add one for Lambda throttles and one for game API server errors.
3. **Simulated failure via the queue.** One test message is placed directly into the `TimeoutFailures` queue.

## Alarms (`amplify/backend.ts`)

Existing: `TimeoutFailuresAlarm`, `DeadlineScheduleFailuresAlarm`, `EventPublishFailuresAlarm`.

- **`LambdaThrottlesAlarm`:** a CloudWatch math expression summing the `Throttles` metric of all five game functions (game API, event auth, event publisher, deadline scheduler, timeout). Fires at ≥ 1 in one 60-second period, missing data not breaching. This targets the account's concurrency limit of 10.
- **`GameApiServerErrorsAlarm`:** the HTTP API's `5xx` metric. Fires at ≥ 1 in one 300-second period, missing data not breaching. The game API catches its own exceptions and answers 500, so Lambda's `Errors` metric would not count them; the API's 5xx count does, and also counts throttled requests (503).
- No actions on any alarm (decision 1).

## One command for the development checks

- `scripts/smoke-dev.ts`, run as `npm run smoke:dev`. It reads the endpoints from `amplify_outputs.json` and runs, one after another: `check-events`, `check-lobby`, `check-clue`, `check-gaps`, `check-reveal`, `check-timeouts`, `check-progress`. It stops at the first failure and prints each script's result and duration.
- Sequential on purpose: running scripts in parallel can hit the concurrency limit.
- Needs `AWS_PROFILE=chreisel`, because three scripts write test state into the sandbox table.

## Alarm test

`scripts/check-alarm.ts` (sandbox only):

1. Sends one message `{ "test": "check-alarm" }` to `TimeoutFailures`.
2. Polls `DescribeAlarms` until `TimeoutFailuresAlarm` is `ALARM` (up to 5 minutes) and prints the time it took.
3. Receives and deletes exactly that test message (by its body), nothing else.
4. Polls until the alarm is `OK` again (up to 5 minutes).

Exit 1 if either state is not reached.

## Browser run

- **Players:** Tipster Bob, Guessers Alice (host) and Carol; one tab at phone size (375 × 812), the other two at normal width.
- **Played with real clicks:** lobby, claim, start, several turns with draw, word, selection, lock and reveal.
- **Disruptions along the way:**
  - a Guesser reloads mid-turn and catches up;
  - a fourth player joins mid-game as a Guesser;
  - two Guessers tap at the same moment (one selects, one locks);
  - one clue is left to run into grace and expire.
- **To reach the end in reasonable time:** after a few real turns the pile is lowered through the table helper used in Task 14. The game is then won or lost through the UI, and the host restarts with New session, everyone joining.
- **Phone layout check** in the phone tab: the circle, gaps and panel fit without horizontal scrolling, buttons are reachable, text is readable. Screenshots are taken if the pane is visible.
- **Findings:** layout or behaviour problems are fixed in this task if small, otherwise recorded.

## Production smoke procedure (`docs/SMOKE.md`)

- **Against production only:**
  - `check-events`, `check-lobby`, `check-clue` and `check-reveal` (API only, no table access), with the production endpoints;
  - a 5-minute manual run on two devices at `https://round-about.chreisel.net`: host, join by link, claim, start, draw, word, lock, reveal, New session.
- **Never against production:** `check-timeouts`, `check-gaps`, `check-progress` and `check-alarm` write into the table or the queues. They stay development-only and say so in their headers.
- **Notes:** the production scripts create short-lived test sessions (24-hour TTL). The procedure says what a failure looks like and where to look: the CloudWatch alarms and the Lambda logs.

## Out of scope

Hosting, the custom domain `round-about.chreisel.net`, production backend and CORS (Task 16).
