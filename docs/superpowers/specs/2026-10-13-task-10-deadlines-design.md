# Task 10: server deadlines and timeout delivery

**Status:** design approved 2026-10-13. Implements Task 10 in [TASKS.md](../../../TASKS.md); background in [ARCHITECTURE.md](../../../ARCHITECTURE.md) ("Shared reveal and short timers").

## Goal

The server alone decides when time runs out. Acceptance criteria from TASKS.md:

- Clue expiry enters grace; grace expiry discards the card, costs a life and restores one pile card; Overtime expiry loses.
- Early, duplicate or late queue messages cannot extend or corrupt deadlines.
- Rerendering, reconnecting or selecting gaps does not restart a timer.
- Failures in timeout delivery are visible.

The reducer in `game/rules.ts` already has the transitions (`CLUE_TIMEOUT`, `GRACE_TIMEOUT`, `DISCUSSION_TIMEOUT`), derives the grace deadline from the original clue deadline, and leaves deadlines alone on `SELECT_GAP`. Nothing sets a deadline yet: `DRAW` arrives with Task 11, Overtime guessing with Task 12.

## Decisions

1. **Scheduling from the table stream.** A separate `deadline-scheduler` Lambda reads the session table stream and enqueues timeouts for every saved running deadline, so every writer is covered and failures are retried.
2. **End-to-end test without `DRAW`.** A sandbox-only script writes a running deadline directly into the sandbox table and watches the transitions over the WebSocket.
3. **Alarms only.** CloudWatch alarms on the failure queues, without notifications. Email via SNS comes with Task 15.

## Correct timing on every request

`reconcile(session: Session, now: number): Session` in `shared/deadlines.ts`:

- Only for `status: "playing"`. Repeatedly applies the due transition: phase `tip` with `now >= deadline` → `CLUE_TIMEOUT`; `grace` with `now >= deadline` → `GRACE_TIMEOUT`; `guess` with a non-null deadline and `now >= deadline` → `DISCUSSION_TIMEOUT`. Several can apply in one call (clue and grace both overdue).
- Returns the **same object** when nothing was due, otherwise a copy with `version + 1` (one increment, however many transitions).
- Session `status` is not changed: an Overtime loss shows as `lastResult.lost` in phase `result`; finishing the game is Task 14. The shared reveal delay (Task 13) does not apply yet.

Uses in the game API (`handler.ts`):

- `GET /sessions/{squid}` projects `reconcile(session, now)` without writing.
- Commands reconcile first, then apply the command, and write if anything changed. A command that arrives after its deadline is therefore judged against the expired state.
- Joins also reconcile before adding the participant, so their write carries any due transition.

## Delivery when nobody is clicking

**Message** (`shared/deadlines.ts`): `type TimeoutMessage = { squid: string; turn: number; phase: "tip" | "grace" | "guess"; deadline: number }`. No cards, words or tokens. (`turn` is `game.turn`; the session's `turnId` is fixed for the whole session.)

**`timeoutMessage(session: Session): TimeoutMessage | null`** returns a message when `status === "playing"`, the phase is one of the three, and `game.deadline` is not null.

**`deadline-scheduler`** (`amplify/functions/deadline-scheduler/`): consumes the session table stream (second consumer next to `event-publisher`). For each record with a `NewImage` where `timeoutMessage` is not null, sends it to the timeout queue with `DelaySeconds = clamp(ceil((deadline - now) / 1000), 0, 900)`. A failed send is reported per record (`reportBatchItemFailures`), retried 5 times within 10 minutes, then stream metadata goes to a `DeadlineScheduleFailures` queue. Duplicate messages are harmless.

**`timeout`** (`amplify/functions/timeout/`): consumes the timeout queue. The pure decision `decideTimeout(message: TimeoutMessage, session: Session | null, now: number)` returns:

- `{ action: "ignore" }`: session missing or expired, or `game.turn`, `game.phase` or `game.deadline` no longer equal the message (stale, duplicate or old turn).
- `{ action: "retry", delaySeconds }`: still matching but `now < deadline` (early delivery). The handler re-sends the same message with the remaining delay, rounded up.
- `{ action: "apply" }`: matching and due. The handler writes `reconcile(session, now)` with the same version condition as commands, reloading and re-deciding up to 3 times on conflict.

Processing errors are reported per message; after 5 receives a message moves to the `TimeoutFailures` dead-letter queue. Queue visibility timeout: 60 s (function timeout 10 s).

**Chaining:** the write that enters grace sets the grace deadline; the stream sees it and the scheduler enqueues the 3-second grace timeout. Broadcasting needs nothing new: the publisher sends every saved transition.

**Accuracy:** SQS delays have one-second granularity and Lambda/stream hops add latency, so transitions may be broadcast up to about 2 s late. Rules are not affected, because every command is judged by `reconcile` with the real time.

## Visibility

A CloudWatch alarm per failure queue (`TimeoutFailures`, `DeadlineScheduleFailures`, and the existing `EventPublishFailures`): `ApproximateNumberOfMessagesVisible >= 1` over one 60-second period, missing data treated as OK, no actions.

## Infrastructure (`amplify/backend.ts`)

- New functions `deadline-scheduler` and `timeout` (`defineFunction`, group `round-about-game`, Node 22, 10 s).
- SQS: `TimeoutQueue` (visibility 60 s, DLQ `TimeoutFailures` with `maxReceiveCount: 5`, retention 4 days), `DeadlineScheduleFailures` (retention 4 days).
- Permissions: scheduler may send to `TimeoutQueue`; `timeout` may read/write the session table and send to `TimeoutQueue` (re-send on early delivery). No browser access to any queue.
- Env: `SESSION_TABLE` for `timeout`, `TIMEOUT_QUEUE_URL` for both.
- The session table stream stays `NEW_IMAGE`.

## Testing

- **Unit:** `shared/deadlines.test.ts`: clue expiry enters grace with deadline + 3 s; overdue clue and grace both apply in one call; grace expiry discards (lives − 1, pile + 1, `current` null); Overtime expiry loses; nothing due returns the same object; lobby/non-playing untouched; selecting a gap leaves the deadline unchanged; `timeoutMessage` contents. `decideTimeout` cases: ignore (stale phase, other turn, changed deadline, missing session), retry with rounded-up delay, apply. Scheduler: message and delay clamping.
- **Sandbox script** `scripts/check-timeouts.ts`: hosts and joins via the API, subscribes over the WebSocket, then writes a running clue deadline (5 s ahead) directly into the sandbox table using the `chreisel` profile. Expects a `grace` event, then a discarded `result` with one life fewer and the pile restored, and prints each transition's lateness. Second scenario: an Overtime guess deadline (4 s, lives 0) ends with `lastResult.lost`. Third: a hand-sent stale message (wrong deadline) leaves the version unchanged.
- `GET` during an overdue deadline shows the reconciled state without changing the stored version.
- `npm run check` passes; redeploy `round-about-dev`; `check-events.ts` and `check-lobby.ts` still pass; all three alarms exist and are in OK state.

## Out of scope

Drawing and clue submission (Task 11), gap selection and locking (Task 12), the shared reveal delay (Task 13), ending the game and new sessions (Task 14), alarm notifications (Task 15).
