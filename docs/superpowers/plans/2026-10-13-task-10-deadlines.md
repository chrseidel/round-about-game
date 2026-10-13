# Task 10 Deadlines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Server-decided clue, grace and Overtime deadlines that take effect on every request and are delivered by a delayed queue when nobody is clicking.

**Architecture:** A pure `reconcile` applies due timeouts; the game API runs it on reads (in memory) and before writes. A stream consumer enqueues a delayed SQS message per saved running deadline; a timeout Lambda decides per message whether to ignore, re-queue or apply, and saves with the existing version condition. Failure queues get CloudWatch alarms.

**Tech Stack:** TypeScript, Node 22.23 test runner via `tsx`, AWS Lambda, DynamoDB Streams, SQS (`@aws-sdk/client-sqs`), CloudWatch alarms via CDK, Amplify Gen 2.

**Spec:** `docs/superpowers/specs/2026-10-13-task-10-deadlines-design.md`

## Global Constraints

- One feature commit for Task 10 at the end, then a separate docs commit (TASKS.md, handoff, this plan).
- Timeout messages carry only `{ squid, turn, phase, deadline }`; never cards, words, tokens or `current`.
- `DelaySeconds = clamp(ceil((deadline - now) / 1000), 0, 900)`.
- Retries: stream consumer 5 attempts / 10 minutes, then `DeadlineScheduleFailures`; timeout queue visibility 60 s, `maxReceiveCount: 5` into `TimeoutFailures`; queue retention 4 days.
- Alarms: `ApproximateNumberOfMessagesVisible >= 1`, one 60-second period, missing data = not breaching, no actions; on `TimeoutFailures`, `DeadlineScheduleFailures`, `EventPublishFailures`.
- Redeploy `round-about-dev` (`AWS_PROFILE=chreisel`, Node v22.23.3) before sandbox tests. Log only error names.

## Review Focus

1. A timeout and a player's command save at the same moment: the timeout must reload and re-decide, not overwrite. Pinned in Task 3 (`save` reports a conflict once).
2. Early delivery a fraction of a second before the deadline must re-queue with at least 1 s, never 0 (which would loop). Pinned in Task 1.
3. A deadline more than 15 minutes away must clamp the delay to 900 s, not fail the send. Pinned in Task 1.
4. A message for a session that expired or was deleted must be ignored without error. Pinned in Task 1.
5. Viewing a game with an overdue deadline must show the expired state without saving. Pinned in Task 4 (sandbox script checks the stored version).

---

### Task 1: Deadline rules

**Files:**
- Create: `shared/deadlines.ts`, test `shared/deadlines.test.ts`
- Modify: `package.json` (add the test file to `test`)

**Interfaces:**
- Produces: `reconcile(session: Session, now: number): Session` (same object if nothing due, else `version + 1`); `type TimeoutMessage = { squid: string; turn: number; phase: "tip" | "grace" | "guess"; deadline: number }`; `timeoutMessage(session: Session): TimeoutMessage | null`; `timeoutDelay(deadline: number, now: number): number`; `type TimeoutDecision = { action: "ignore" } | { action: "retry"; delaySeconds: number } | { action: "apply" }`; `decideTimeout(message: TimeoutMessage, session: Session | null, now: number): TimeoutDecision`.

- [ ] **Step 1: Write failing tests** (playing session built with `createGame`, `DRAW` applied at `now = 0`, so `deadline = 20_000`):
  - `clue expiry enters grace`: `reconcile(s, 20_000)` → phase `grace`, deadline `23_000`, version + 1.
  - `overdue clue and grace apply together`: `reconcile(s, 23_000)` → phase `result`, `lastResult.discarded`, lives 2, pile 12, `current` null, version + 1 (once).
  - `Overtime expiry loses`: lives 0, phase `guess`, deadline 5_000 → at 5_000 phase `result`, `lastResult.lost === true`.
  - `nothing due returns the same object`: at 19_999, and for a `lobby` session with a deadline set → identical object.
  - `selecting a gap keeps the deadline`: `apply(game, {type:"SELECT_GAP", index:0}, 3_000).deadline === game.deadline` in Overtime guess.
  - `timeoutMessage`: `{ squid, turn: 1, phase: "tip", deadline: 20_000 }`; `null` in lobby, phase `ready`, or deadline null; `JSON.stringify` has no `current`/`deck`.
  - `timeoutDelay`: `(20_000, 0) → 20`, `(20_000, 19_700) → 1`, `(20_000, 25_000) → 0`, `(2_000_000, 0) → 900`.
  - `decideTimeout`: `null` session → ignore; expired (`expiresAt` past) → ignore; phase differs → ignore; `turn` differs → ignore; deadline differs → ignore; matching at 19_700 → `{retry, delaySeconds: 1}`; matching at 20_000 → apply.
- [ ] **Step 2: Run** `node --import tsx --test shared/deadlines.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** in `shared/deadlines.ts` using `apply` from `game/rules.ts` with `CLUE_TIMEOUT`, `GRACE_TIMEOUT`, `DISCUSSION_TIMEOUT` in a loop until nothing is due.
- [ ] **Step 4: Run** the same command. Expected: PASS.

### Task 2: Game API uses reconcile

**Files:**
- Modify: `amplify/functions/game-api/command.ts`, `command.test.ts`, `handler.ts`

**Interfaces:**
- Consumes: `reconcile` (Task 1).
- Produces: `applyCommand(session: Session, participantId: string, command: SessionCommand, now: number): Session` (reconciles first; returns the original object only if neither reconcile nor the command changed anything).

- [ ] **Step 1: Write failing test** `command after an overdue deadline is judged on the expired state`: playing session with Tipster set and an overdue clue deadline; `applyCommand(s, host, {type:"START"}, 20_000)` → phase `grace`, version + 1. Update existing `applyCommand` calls to pass `now`.
- [ ] **Step 2: Run** `node --import tsx --test amplify/functions/game-api/command.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**: `applyCommand` reconciles then dispatches. In `handler.ts`: `runCommand` passes `Date.now()`; `GET` projects `reconcile(session, now)`; join applies `joinSession(reconcile(session, now), …)` and keeps writing with the loaded version.
- [ ] **Step 4: Run** `npm run typecheck && npm test`. Expected: pass.

### Task 3: Scheduler, timeout Lambda, queues and alarms

**Files:**
- Create: `amplify/functions/deadline-scheduler/{resource.ts,handler.ts,handler.test.ts}`, `amplify/functions/timeout/{resource.ts,handler.ts,handler.test.ts}`
- Modify: `amplify/backend.ts`, `package.json` (tests; dependency `@aws-sdk/client-sqs` ^3.900.0 in devDependencies like the other SDK clients)

**Interfaces:**
- Consumes: Task 1 exports.
- Produces: `scheduleRecords(records: DynamoDBRecord[], send: (message: TimeoutMessage, delaySeconds: number) => Promise<void>, now: number): Promise<DynamoDBBatchResponse>`; `handleTimeouts(records: SQSRecord[], deps: TimeoutDeps, now: () => number): Promise<SQSBatchResponse>` with `type TimeoutDeps = { load(squid: string): Promise<Session | null>; save(next: Session, expectedVersion: number): Promise<boolean>; resend(message: TimeoutMessage, delaySeconds: number): Promise<void> }` (`save` resolves `false` on a version conflict).

- [ ] **Step 1: Write failing tests**
  - Scheduler `enqueues running deadlines with their delay`: records for a `tip` session (deadline 20_000) and a lobby session at now 0 → one send with the message and delay 20; a `REMOVE` record is skipped; a failing send returns that record's sequence number in `batchItemFailures` and stops.
  - Timeout `applies a due timeout`: due message → `save` called once with phase `grace` and `expectedVersion` = loaded version; no failures.
  - Timeout `re-decides after a conflict`: `save` returns `false` once, the reloaded session is already in `grace` → no second save, no failures.
  - Timeout `re-queues early messages and ignores stale ones`: early → `resend` with delay 1; stale → no save, no resend.
  - Timeout `reports processing errors`: `load` throws → `batchItemFailures` contains that message id.
- [ ] **Step 2: Run** `node --import tsx --test amplify/functions/deadline-scheduler/handler.test.ts amplify/functions/timeout/handler.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** both handlers (exported `handler` wires real DynamoDB/SQS clients; conflict = `ConditionalCheckFailedException`; up to 3 load/decide/save attempts per message). In `backend.ts`: functions in group `round-about-game`, Node 22, 10 s; `TimeoutQueue` + `TimeoutFailures` DLQ, `DeadlineScheduleFailures`; `DynamoEventSource` for the scheduler (LATEST, batch 10, 5 retries, 10 min max age, `reportBatchItemFailures`, `SqsDlq`); `SqsEventSource` for timeout (batch 10, `reportBatchItemFailures`); grants: scheduler `sendMessages` on `TimeoutQueue`, timeout read/write on the table and `sendMessages`; env `TIMEOUT_QUEUE_URL`, `SESSION_TABLE` via the same `addPropertyOverride` pattern; three `Alarm`s per Global Constraints.
- [ ] **Step 4: Run** `npm run check`. Expected: format, typecheck, tests, build pass.

### Task 4: Deploy, verify, commit

**Files:**
- Create: `scripts/check-timeouts.ts`
- Modify: `TASKS.md`, `DEVELOPMENT_HANDOFF.md`

- [ ] **Step 1: Write** `scripts/check-timeouts.ts <gameApiUrl> <gameEventsUrl>` (AWS SDK with the default credential chain; table found by `ListTables` prefix `amplify-roundabout-roundaboutdev`, queue by `ListQueues` prefix containing `TimeoutQueue`): host + join via API; subscribe over the WebSocket; `UpdateItem` sets `status: "playing"`, `tipsterId`, game `phase: "tip"`, `current`, `pile: 11`, `deadline: now + 5000`, `version + 1`. Expect events: `phase: "grace"` then `phase: "result"` with discarded result, `lives: 2`, `pile: 12`; print lateness against 5 s and 8 s. Before the grace event, `GET` shows the expired state only after 5 s and the stored `version` is unchanged by the `GET`. Scenario 2: lives 0, phase `guess`, deadline `now + 4000` → result with `lost: true`. Scenario 3: send a stale message (deadline − 1) → after 3 s the stored version is unchanged. Exit 1 on any mismatch.
- [ ] **Step 2: Deploy** `AWS_PROFILE=chreisel npx ampx sandbox --once --identifier round-about-dev`. Expected: "Deployment completed". Wait about a minute for new stream triggers.
- [ ] **Step 3: Run** `check-timeouts.ts`, `check-lobby.ts`, `check-events.ts` with `AWS_PROFILE=chreisel`. Expected: all succeed. Check the three alarms exist and are `OK`, and the failure queues are empty.
- [ ] **Step 4: Commit** after `npm run check`: `feat: enforce deadlines with delayed timeout delivery`. Then update Task 10 status in `TASKS.md` and the handoff, and commit them with this plan as `docs: record Task 10 completion`.
