import test from "node:test";
import assert from "node:assert/strict";
import { PROTOCOL_VERSION } from "../../../shared/protocol.ts";
import { applyCommand, parseCommandRequest } from "./command.ts";
import { CommandError, newSession } from "./session.ts";

const valid = {
  protocolVersion: PROTOCOL_VERSION,
  turnId: "turn",
  commandId: "c1",
  expectedVersion: 1,
  command: { type: "CLAIM_TIPSTER" },
};

function invalidInput(action: () => unknown) {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof CommandError);
    assert.equal(error.code, "INVALID_INPUT");
    return true;
  });
}

test("parse rejects malformed requests", () => {
  invalidInput(() => parseCommandRequest("CLAIM_TIPSTER"));
  invalidInput(() => parseCommandRequest(null));
  invalidInput(() => parseCommandRequest({ ...valid, protocolVersion: 99 }));
  invalidInput(() =>
    parseCommandRequest({ ...valid, commandId: "x".repeat(65) }),
  );
  invalidInput(() => parseCommandRequest({ ...valid, command: undefined }));
  invalidInput(() => parseCommandRequest({ ...valid, command: { type: 7 } }));
});

test("parse accepts a valid claim", () => {
  assert.equal(parseCommandRequest(valid).command.type, "CLAIM_TIPSTER");
});

test("apply dispatches and rejects later commands", () => {
  const { session, participantId } = newSession("Alice", 10_000);
  assert.equal(
    applyCommand(session, participantId, { type: "CLAIM_TIPSTER" }).tipsterId,
    participantId,
  );
  assert.throws(
    () => applyCommand(session, participantId, { type: "DRAW" }),
    /Not available yet\./,
  );
});
