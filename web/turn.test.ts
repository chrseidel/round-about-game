import test from "node:test";
import assert from "node:assert/strict";
import type { CallerSnapshot } from "../shared/protocol.ts";
import { mergePrivate, secondsLeft, turnView } from "./turn.ts";

function snapshot(overrides: Partial<CallerSnapshot> = {}): CallerSnapshot {
  return {
    status: "playing",
    hostId: "alice",
    tipsterId: "bob",
    participants: [
      { id: "alice", nickname: "Alice", joinedAt: 1 },
      { id: "bob", nickname: "Bob", joinedAt: 2 },
    ],
    phase: "ready",
    version: 5,
    turn: 1,
    clue: null,
    deadlineUtc: null,
    result: null,
    ...overrides,
  } as CallerSnapshot;
}

test("Tipster and Guesser views per phase", () => {
  const ready = snapshot();
  assert.equal(turnView(ready, "bob").mode, "draw");
  assert.equal(turnView(ready, "bob").heading, "Your turn");
  assert.equal(turnView(ready, "alice").mode, "wait");
  assert.equal(
    turnView(ready, "alice").description,
    "Waiting for Bob to draw.",
  );

  const tip = snapshot({ phase: "tip", deadlineUtc: 20_000, currentDraw: 42 });
  assert.equal(turnView(tip, "bob").mode, "write");
  assert.equal(turnView(tip, "bob").secret, 42);
  assert.equal(turnView(tip, "bob").countdown, true);
  const watching = turnView({ ...tip, currentDraw: undefined }, "alice");
  assert.equal(watching.description, "Bob is thinking of a word.");
  assert.equal(watching.countdown, true);
  assert.equal(watching.secret, null);

  const grace = snapshot({ phase: "grace", deadlineUtc: 23_000 });
  assert.equal(turnView(grace, "bob").heading, "Last chance");
  assert.equal(turnView(grace, "alice").description, "Last seconds…");

  const guess = snapshot({ phase: "guess", clue: "river" });
  assert.equal(
    turnView(guess, "bob").description,
    "Your word: river. The team is guessing.",
  );
  assert.equal(turnView(guess, "alice").heading, "Choose a gap.");
  assert.equal(turnView(guess, "alice").countdown, false);
  assert.equal(
    turnView({ ...guess, deadlineUtc: 40_000 }, "alice").countdown,
    true,
  );

  const discarded = snapshot({
    phase: "result",
    result: { correct: false, lost: false, discarded: true, timedOut: true },
  });
  for (const me of ["alice", "bob"]) {
    assert.equal(turnView(discarded, me).heading, "Card discarded");
    assert.equal(turnView(discarded, me).description, "Time ran out.");
  }
});

test("mergePrivate keeps the number within the same card", () => {
  const previous = snapshot({ phase: "tip", currentDraw: 42 });
  assert.equal(
    mergePrivate(previous, snapshot({ phase: "grace" })).currentDraw,
    42,
  );
  assert.equal(
    mergePrivate(previous, snapshot({ phase: "guess" })).currentDraw,
    undefined,
  );
  assert.equal(
    mergePrivate(previous, snapshot({ phase: "tip", turn: 2 })).currentDraw,
    undefined,
  );
  assert.equal(
    mergePrivate(previous, snapshot({ phase: "tip", currentDraw: 7 }))
      .currentDraw,
    7,
  );
  assert.equal(mergePrivate(null, snapshot()).currentDraw, undefined);
  // The public event for a draw can arrive before the Tipster's own response.
  const event = snapshot({ phase: "tip", version: 6 });
  const response = snapshot({ phase: "tip", version: 6, currentDraw: 42 });
  assert.equal(mergePrivate(event, response).currentDraw, 42);
  assert.equal(mergePrivate(response, snapshot({ version: 4 })), response);
});

test("countdown follows server time", () => {
  assert.equal(secondsLeft(20_000, 5_000, 10_000), 5);
  assert.equal(secondsLeft(20_000, 0, 25_000), 0);
  assert.equal(secondsLeft(null, 0, 0), 0);
});
