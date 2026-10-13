import test from "node:test";
import assert from "node:assert/strict";
import type { DynamoDBRecord } from "aws-lambda";
import { marshall } from "@aws-sdk/util-dynamodb";
import { apply, createGame } from "../../../game/rules.ts";
import type { Session } from "../../../shared/protocol.ts";
import type { TimeoutMessage } from "../../../shared/deadlines.ts";
import { scheduleRecords } from "./handler.ts";

const numbers = Array.from({ length: 99 }, (_, i) => i + 1).filter(
  (number) => number !== 33 && number !== 66,
);

function session(squid: string, status: Session["status"]): Session {
  return {
    squid,
    version: 2,
    status,
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

function record(
  value: Session,
  sequence: string,
  eventName: DynamoDBRecord["eventName"] = "MODIFY",
): DynamoDBRecord {
  return {
    eventName,
    dynamodb: {
      SequenceNumber: sequence,
      NewImage:
        eventName === "REMOVE"
          ? undefined
          : (marshall(value, { removeUndefinedValues: true }) as never),
    },
  };
}

test("enqueues running deadlines with their delay", async () => {
  const sent: [TimeoutMessage, number][] = [];
  const result = await scheduleRecords(
    [
      record(session("AAAAAAAAAAAA", "playing"), "1"),
      record(session("BBBBBBBBBBBB", "lobby"), "2"),
      record(session("CCCCCCCCCCCC", "playing"), "3", "REMOVE"),
    ],
    async (message, delay) => void sent.push([message, delay]),
    0,
  );
  assert.deepEqual(result.batchItemFailures, []);
  assert.deepEqual(sent, [
    [{ squid: "AAAAAAAAAAAA", turn: 1, phase: "tip", deadline: 20_000 }, 20],
  ]);
});

test("a failed send is reported so the stream retries it", async () => {
  const result = await scheduleRecords(
    [
      record(session("AAAAAAAAAAAA", "playing"), "1"),
      record(session("DDDDDDDDDDDD", "playing"), "2"),
    ],
    async (message) => {
      if (message.squid === "AAAAAAAAAAAA") throw new Error("throttled");
    },
    0,
  );
  assert.deepEqual(result.batchItemFailures, [{ itemIdentifier: "1" }]);
});
