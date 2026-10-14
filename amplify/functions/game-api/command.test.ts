import test from "node:test";
import assert from "node:assert/strict";
import { PROTOCOL_VERSION } from "../../../shared/protocol.ts";
import {
  alreadyApplied,
  applyCommand,
  parseCommandRequest,
  rememberCommand,
} from "./command.ts";
import { projectPublic } from "../../../shared/protocol.ts";
import { apply } from "../../../game/rules.ts";
import {
  chooseGap,
  claimTipster,
  CommandError,
  drawCard,
  joinSession,
  newSession,
  startGame,
  submitClue,
} from "./session.ts";

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

test("parse requires a clue string", () => {
  invalidInput(() =>
    parseCommandRequest({ ...valid, command: { type: "SUBMIT_CLUE" } }),
  );
  assert.equal(
    parseCommandRequest({
      ...valid,
      command: { type: "SUBMIT_CLUE", clue: "flumbo" },
    }).command.type,
    "SUBMIT_CLUE",
  );
});

test("parse accepts a valid claim", () => {
  assert.equal(parseCommandRequest(valid).command.type, "CLAIM_TIPSTER");
});

test("apply dispatches and rejects later commands", () => {
  const { session, participantId } = newSession("Alice", 10_000);
  assert.equal(
    applyCommand(session, participantId, { type: "CLAIM_TIPSTER" }, 0, 10_000)
      .tipsterId,
    participantId,
  );
  assert.throws(
    () =>
      applyCommand(
        session,
        participantId,
        { type: "UNKNOWN" } as never,
        0,
        10_000,
      ),
    /Not available yet\./,
  );
});

test("command after an overdue deadline is judged on the expired state", () => {
  const hosted = newSession("Alice", 0);
  const joined = joinSession(hosted.session, "Bob", 0).session;
  const started = startGame(
    claimTipster(joined, hosted.participantId),
    hosted.participantId,
  );
  const drawing = {
    ...started,
    game: apply(started.game, { type: "DRAW" }, 0),
  };
  const next = applyCommand(
    drawing,
    hosted.participantId,
    { type: "START" },
    0,
    20_000,
  );
  assert.equal(next.game.phase, "grace");
  assert.equal(next.version, drawing.version + 1);
});

test("parse requires gap indexes", () => {
  invalidInput(() =>
    parseCommandRequest({ ...valid, command: { type: "CHOOSE_GAP" } }),
  );
  invalidInput(() =>
    parseCommandRequest({
      ...valid,
      command: { type: "LOCK_GAP", index: "1" },
    }),
  );
  invalidInput(() =>
    parseCommandRequest({
      ...valid,
      expectedVersion: "3",
      command: { type: "LOCK_GAP", index: 1 },
    }),
  );
});

test("retry memory keeps the last 20 commands", () => {
  let { session } = newSession("Alice", 0);
  for (let i = 1; i <= 21; i++) session = rememberCommand(session, `c${i}`);
  assert.deepEqual(
    session.recentCommands,
    Array.from({ length: 20 }, (_, i) => `c${i + 2}`),
  );
  assert.equal(alreadyApplied(session, "c21"), true);
  assert.equal(alreadyApplied(session, "c1"), false);
  assert.equal("recentCommands" in projectPublic(session, 0), false);
});

test("apply passes the expected version to lock", () => {
  const hosted = newSession("Alice", 0);
  const bob = joinSession(hosted.session, "Bob", 0);
  const carol = joinSession(bob.session, "Carol", 0);
  let session = startGame(
    claimTipster(carol.session, bob.participantId),
    hosted.participantId,
  );
  session = drawCard(session, bob.participantId, 0);
  session = submitClue(session, bob.participantId, "flumbo", 1_000);
  session = chooseGap(session, hosted.participantId, 1);
  const lock = { type: "LOCK_GAP" as const, index: 1 };
  assert.throws(
    () =>
      applyCommand(
        session,
        carol.participantId,
        lock,
        session.version - 1,
        2_000,
      ),
    /The selection changed/,
  );
  assert.equal(
    applyCommand(session, carol.participantId, lock, session.version, 2_000)
      .game.phase,
    "result",
  );
});

test("moved sessions refuse commands", () => {
  const { session, participantId } = newSession("Alice", 0);
  assert.throws(
    () =>
      applyCommand(
        { ...session, nextSquid: "ABCDEFGHJKMN" },
        participantId,
        { type: "CLAIM_TIPSTER" },
        0,
        0,
      ),
    /This game has moved to a new session\./,
  );
});
