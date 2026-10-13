import test from "node:test";
import assert from "node:assert/strict";
import type { SQSRecord } from "aws-lambda";
import { apply, createGame } from "../../../game/rules.ts";
import type { Session } from "../../../shared/protocol.ts";
import {
  reconcile,
  timeoutMessage,
  type TimeoutMessage,
} from "../../../shared/deadlines.ts";
import { handleTimeouts, type TimeoutDeps } from "./handler.ts";

const numbers = Array.from({ length: 99 }, (_, i) => i + 1).filter(
  (number) => number !== 33 && number !== 66,
);

function drawn(): Session {
  return {
    squid: "AAAAAAAAAAAA",
    version: 4,
    status: "playing",
    hostId: "host",
    tipsterId: "tip",
    turnId: "turn",
    participants: [],
    game: apply(
      createGame(["cake", "work", "fruit"], numbers),
      { type: "DRAW" },
      0,
    ),
    revealAtUtc: null,
    lockedBy: null,
    expiresAt: 999_999_999_999,
  };
}

const sqs = (message: TimeoutMessage, id = "m1") =>
  ({ messageId: id, body: JSON.stringify(message) }) as SQSRecord;

function deps(loads: (Session | null)[], saves: boolean[] = []) {
  const calls = { saved: [] as [Session, number][], resent: [] as number[] };
  const value: TimeoutDeps = {
    load: async () => loads.shift() ?? null,
    save: async (next, expected) => {
      calls.saved.push([next, expected]);
      return saves.shift() ?? true;
    },
    resend: async (_message, delay) => void calls.resent.push(delay),
  };
  return { value, calls };
}

test("applies a due timeout", async () => {
  const session = drawn();
  const { value, calls } = deps([session]);
  const result = await handleTimeouts(
    [sqs(timeoutMessage(session)!)],
    value,
    () => 20_000,
  );
  assert.deepEqual(result.batchItemFailures, []);
  assert.equal(calls.saved.length, 1);
  assert.equal(calls.saved[0]![0].game.phase, "grace");
  assert.equal(calls.saved[0]![1], 4);
});

test("re-decides after a conflict", async () => {
  const session = drawn();
  const { value, calls } = deps([session, reconcile(session, 20_000)], [false]);
  const result = await handleTimeouts(
    [sqs(timeoutMessage(session)!)],
    value,
    () => 20_000,
  );
  assert.deepEqual(result.batchItemFailures, []);
  assert.equal(calls.saved.length, 1);
});

test("re-queues early messages and ignores stale ones", async () => {
  const session = drawn();
  const early = deps([session]);
  await handleTimeouts(
    [sqs(timeoutMessage(session)!)],
    early.value,
    () => 19_700,
  );
  assert.deepEqual(early.calls.resent, [1]);
  assert.equal(early.calls.saved.length, 0);
  const stale = deps([session]);
  await handleTimeouts(
    [sqs({ ...timeoutMessage(session)!, deadline: 1 })],
    stale.value,
    () => 20_000,
  );
  assert.deepEqual(stale.calls.resent, []);
  assert.equal(stale.calls.saved.length, 0);
});

test("reports processing errors", async () => {
  const value: TimeoutDeps = {
    load: async () => {
      throw new Error("throttled");
    },
    save: async () => true,
    resend: async () => {},
  };
  const result = await handleTimeouts(
    [sqs(timeoutMessage(drawn())!, "m7")],
    value,
    () => 20_000,
  );
  assert.deepEqual(result.batchItemFailures, [{ itemIdentifier: "m7" }]);
});
