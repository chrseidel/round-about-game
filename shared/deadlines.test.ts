import test from "node:test";
import assert from "node:assert/strict";
import { apply, createGame } from "../game/rules.ts";
import type { Session } from "./protocol.ts";
import {
  decideTimeout,
  reconcile,
  timeoutDelay,
  timeoutMessage,
} from "./deadlines.ts";

const numbers = Array.from({ length: 99 }, (_, i) => i + 1).filter(
  (number) => number !== 33 && number !== 66,
);

/** A started game whose first card was drawn at time 0 (clue deadline 20 s). */
function drawn(): Session {
  return {
    squid: "7K9M2Q4V8P6R",
    version: 5,
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

function overtime(): Session {
  const session = drawn();
  session.game = { ...session.game, phase: "guess", lives: 0, deadline: 5_000 };
  return session;
}

test("clue expiry enters grace", () => {
  const next = reconcile(drawn(), 20_000);
  assert.equal(next.game.phase, "grace");
  assert.equal(next.game.deadline, 23_000);
  assert.equal(next.version, 6);
});

test("overdue clue and grace apply together", () => {
  const next = reconcile(drawn(), 23_000);
  assert.equal(next.game.phase, "result");
  assert.equal(next.game.lastResult?.discarded, true);
  assert.equal(next.game.lives, 2);
  assert.equal(next.game.pile, 12);
  assert.equal(next.game.current, null);
  assert.equal(next.version, 6);
});

test("Overtime expiry loses", () => {
  const next = reconcile(overtime(), 5_000);
  assert.equal(next.game.phase, "result");
  assert.equal(next.game.lastResult?.lost, true);
});

test("nothing due returns the same object", () => {
  const session = drawn();
  assert.equal(reconcile(session, 19_999), session);
  const lobby = { ...drawn(), status: "lobby" as const };
  assert.equal(reconcile(lobby, 30_000), lobby);
});

test("selecting a gap keeps the deadline", () => {
  const game = overtime().game;
  assert.equal(
    apply(game, { type: "SELECT_GAP", index: 0 }, 3_000).deadline,
    game.deadline,
  );
});

test("timeout message carries only identifiers and the deadline", () => {
  const session = drawn();
  const message = timeoutMessage(session);
  assert.deepEqual(message, {
    squid: "7K9M2Q4V8P6R",
    turn: 1,
    phase: "tip",
    deadline: 20_000,
  });
  assert.doesNotMatch(JSON.stringify(message), /current|deck/);
  assert.equal(timeoutMessage({ ...session, status: "lobby" }), null);
  const ready = {
    ...session,
    game: { ...session.game, phase: "ready" as const },
  };
  assert.equal(timeoutMessage(ready), null);
  const open = { ...session, game: { ...session.game, deadline: null } };
  assert.equal(timeoutMessage(open), null);
});

test("timeout delay rounds up and clamps to the SQS range", () => {
  assert.equal(timeoutDelay(20_000, 0), 20);
  assert.equal(timeoutDelay(20_000, 19_700), 1);
  assert.equal(timeoutDelay(20_000, 25_000), 0);
  assert.equal(timeoutDelay(2_000_000, 0), 900);
});

test("stale, early and due timeout messages", () => {
  const session = drawn();
  const message = timeoutMessage(session)!;
  assert.deepEqual(decideTimeout(message, null, 20_000), { action: "ignore" });
  assert.deepEqual(
    decideTimeout(message, { ...session, expiresAt: 1 }, 20_000),
    { action: "ignore" },
  );
  assert.deepEqual(
    decideTimeout({ ...message, phase: "grace" }, session, 20_000),
    { action: "ignore" },
  );
  assert.deepEqual(decideTimeout({ ...message, turn: 2 }, session, 20_000), {
    action: "ignore",
  });
  assert.deepEqual(
    decideTimeout({ ...message, deadline: 19_000 }, session, 20_000),
    { action: "ignore" },
  );
  assert.deepEqual(decideTimeout(message, session, 19_700), {
    action: "retry",
    delaySeconds: 1,
  });
  assert.deepEqual(decideTimeout(message, session, 20_000), {
    action: "apply",
  });
});

test("selected but unlocked gap at Overtime expiry is a miss", () => {
  const session = overtime();
  session.game = { ...session.game, selectedGap: 1 };
  const result = reconcile(session, 5_000).game.lastResult;
  assert.equal(result?.timedOut, true);
  assert.equal(result?.correct, false);
  assert.equal(result?.lost, true);
});
