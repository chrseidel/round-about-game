import test from "node:test";
import assert from "node:assert/strict";
import type { DynamoDBRecord } from "aws-lambda";
import { marshall } from "@aws-sdk/util-dynamodb";
import { createGame } from "../../../game/rules.ts";
import type { PublicEvent, Session } from "../../../shared/protocol.ts";
import { publishRecords } from "./handler.ts";

function session(squid: string, version: number): Session {
  const numbers = Array.from({ length: 99 }, (_, i) => i + 1).filter(
    (number) => number !== 33 && number !== 66,
  );
  const game = createGame(["cake", "work", "fruit"], numbers);
  game.current = 83;
  return {
    squid,
    version,
    status: "lobby",
    hostId: "host",
    tipsterId: null,
    turnId: "turn1",
    participants: [
      { id: "host", nickname: "Alice", tokenHash: "secret-a", joinedAt: 1 },
    ],
    game,
    revealAtUtc: null,
    expiresAt: 999999999999,
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
      Keys: { squid: { S: value.squid } },
      NewImage:
        eventName === "REMOVE"
          ? undefined
          : (marshall(value, { removeUndefinedValues: true }) as never),
    },
  };
}

test("publishes a public snapshot for each committed session write", async () => {
  const sent: { squid: string; event: PublicEvent }[] = [];
  const result = await publishRecords(
    [record(session("AAAAAAAAAAAA", 1), "1", "INSERT")],
    async (squid, event) => void sent.push({ squid, event }),
    1000,
  );
  assert.deepEqual(result.batchItemFailures, []);
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.squid, "AAAAAAAAAAAA");
  assert.equal(sent[0]!.event.snapshot.version, 1);
  const payload = JSON.stringify(sent[0]!.event);
  for (const secret of ["tokenHash", "secret-a", "currentDraw", "deck"])
    assert.equal(payload.includes(secret), false, secret);
});

test("skips TTL removals and superseded versions of the same session", async () => {
  const sent: number[] = [];
  const result = await publishRecords(
    [
      record(session("AAAAAAAAAAAA", 1), "1"),
      record(session("BBBBBBBBBBBB", 4), "2"),
      record(session("AAAAAAAAAAAA", 2), "3"),
      record(session("CCCCCCCCCCCC", 9), "4", "REMOVE"),
    ],
    async (_squid, event) => void sent.push(event.snapshot.version),
    1000,
  );
  assert.deepEqual(result.batchItemFailures, []);
  assert.deepEqual(sent, [4, 2]);
});

test("a failed publish is reported so Lambda retries it and later records", async () => {
  const sent: number[] = [];
  const result = await publishRecords(
    [
      record(session("AAAAAAAAAAAA", 1), "1"),
      record(session("BBBBBBBBBBBB", 4), "2"),
      record(session("CCCCCCCCCCCC", 7), "3"),
    ],
    async (squid, event) => {
      if (squid === "BBBBBBBBBBBB") throw new Error("throttled");
      sent.push(event.snapshot.version);
    },
    1000,
  );
  assert.deepEqual(sent, [1]);
  assert.deepEqual(result.batchItemFailures, [{ itemIdentifier: "2" }]);
});
