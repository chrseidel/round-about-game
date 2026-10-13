import test from "node:test";
import assert from "node:assert/strict";
import type { CallerSnapshot } from "../shared/protocol.ts";
import {
  confirmsNewSession,
  correctExit,
  exitLabel,
  gapCommand,
  islandView,
  mergePrivate,
  revealed,
  secondsLeft,
  turnView,
} from "./turn.ts";

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
    "Your word: river. The team is picking an exit.",
  );
  assert.equal(turnView(guess, "alice").heading, "Pick the exit");
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
    assert.ok(turnView(discarded, me).description.startsWith("Time ran out."));
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

const guessing = (overrides: Partial<CallerSnapshot> = {}) =>
  snapshot({
    phase: "guess",
    clue: "river",
    selectedGap: 1,
    cards: [
      { number: 0, word: "Moss" },
      { number: 33, word: "Lantern" },
      { number: 66, word: "Orbit" },
    ],
    ...overrides,
  });

test("gap clicks choose or lock", () => {
  assert.deepEqual(gapCommand(guessing(), "alice", 2), {
    type: "CHOOSE_GAP",
    index: 2,
  });
  assert.deepEqual(gapCommand(guessing(), "alice", 1), {
    type: "LOCK_GAP",
    index: 1,
  });
  assert.equal(gapCommand(guessing(), "bob", 2), null);
  assert.equal(gapCommand(guessing({ phase: "tip" }), "alice", 2), null);
});

test("selection hint", () => {
  assert.equal(
    turnView(guessing(), "alice").description,
    "Tap the blinking exit again to lock it in, or tap another exit.",
  );
  assert.equal(
    turnView(guessing({ selectedGap: null }), "alice").description,
    "The clue is river. Tap an exit to suggest it.",
  );
});

test("result texts", () => {
  const result = (r: Partial<NonNullable<CallerSnapshot["result"]>>) =>
    guessing({
      phase: "result",
      result: {
        correct: true,
        lost: false,
        discarded: false,
        timedOut: false,
        number: 42,
        lower: 33,
        upper: 66,
        ...r,
      },
    });
  const correct = turnView(result({}), "alice");
  assert.equal(correct.heading, "Correct!");
  assert.ok(
    correct.description.startsWith("river: 42 sits between Lantern and Orbit."),
  );
  const wrong = turnView(result({ correct: false }), "bob");
  assert.equal(wrong.heading, "Wrong exit");
  assert.ok(wrong.description.endsWith(" Life lost."));
  // A lost result always ends the game (finalStatus), so status is "lost".
  const lost = turnView(
    { ...result({ correct: false, lost: true }), status: "lost" },
    "alice",
  );
  assert.ok(lost.description.endsWith("Overtime ended."));
  const late = turnView(result({ correct: false, timedOut: true }), "alice");
  assert.equal(late.heading, "Time ran out");
});

const pending = () =>
  guessing({
    participants: [
      { id: "alice", nickname: "Alice", joinedAt: 1 },
      { id: "bob", nickname: "Bob", joinedAt: 2 },
      { id: "carol", nickname: "Carol", joinedAt: 3 },
    ],
    deadlineUtc: null,
    revealAtUtc: 10_000,
    lockedBy: "carol",
    lives: 3,
    pendingReveal: {
      cards: [
        { number: 0, word: "Moss" },
        { number: 33, word: "Lantern" },
        { number: 42, word: "river" },
        { number: 66, word: "Orbit" },
      ],
      result: {
        correct: false,
        lost: false,
        discarded: false,
        timedOut: false,
        number: 42,
        lower: 33,
        upper: 66,
      },
      lives: 2,
      status: "playing",
    },
  });

test("revealed switches at the server target", () => {
  const before = pending();
  assert.equal(revealed(before, 9_999), before);
  const after = revealed(before, 10_000);
  assert.equal(after.phase, "result");
  assert.equal(after.result?.number, 42);
  assert.equal(after.cards.length, 4);
  assert.equal(after.lives, 2);
  assert.equal(after.pendingReveal, null);
  assert.equal(after.selectedGap, null);
});

test("no gap clicks while revealing", () => {
  assert.equal(gapCommand(pending(), "alice", 1), null);
});

test("build-up texts", () => {
  const others = turnView(pending(), "alice");
  assert.equal(others.heading, "Locked in");
  assert.equal(others.description, "Carol locked in. Revealing…");
  assert.equal(others.revealAtUtc, 10_000);
  assert.equal(
    turnView(pending(), "carol").description,
    "You locked in. Revealing…",
  );
});

const afterResult = (overrides: Partial<CallerSnapshot> = {}) =>
  guessing({
    phase: "result",
    pile: 5,
    result: {
      correct: false,
      lost: false,
      discarded: false,
      timedOut: false,
      number: 42,
      lower: 33,
      upper: 66,
    },
    ...overrides,
  });

test("the Tipster draws the next card after a result", () => {
  const tipster = turnView(afterResult(), "bob");
  assert.equal(tipster.mode, "draw");
  assert.equal(tipster.drawLabel, "Draw next card");
  assert.equal(tipster.heading, "Wrong exit");
  assert.equal(
    turnView(afterResult({ pile: 0 }), "bob").drawLabel,
    "Draw replacement",
  );
  const guesser = turnView(afterResult(), "alice");
  assert.equal(guesser.mode, "none");
  assert.ok(guesser.description.startsWith("river: 42 sits between"));
  assert.ok(
    guesser.description.endsWith(" Waiting for Bob to draw the next card."),
  );
});

test("game end shows the same panel to everyone", () => {
  for (const me of ["alice", "bob"]) {
    const won = turnView(afterResult({ status: "won" }), me);
    assert.equal(won.heading, "You won!");
    assert.equal(won.description, "Last card placed correctly.");
    assert.equal(won.mode, "none");
    const lost = turnView(afterResult({ status: "lost" }), me);
    assert.equal(lost.heading, "Game over");
    assert.equal(lost.description, "Overtime ended.");
  }
});

test("a moved session offers to join the new one", () => {
  const moved = turnView(afterResult({ nextSquid: "ABCDEFGHJKMN" }), "bob");
  assert.equal(moved.heading, "New game");
  assert.equal(moved.description, "Alice started a new game.");
  assert.equal(moved.mode, "join");
});

test("a new session needs confirmation only while the game really runs", () => {
  const won = {
    ...pending(),
    pendingReveal: { ...pending().pendingReveal!, status: "won" as const },
  };
  assert.equal(confirmsNewSession(won, 9_999), true);
  assert.equal(confirmsNewSession(won, 10_000), false);
  assert.equal(confirmsNewSession(afterResult({ status: "lost" }), 0), false);
});

test("timer labels in sentence case", () => {
  const tip = snapshot({ phase: "tip", deadlineUtc: 20_000, currentDraw: 42 });
  assert.equal(turnView(tip, "bob").timerLabel, "Clue time");
  const grace = snapshot({ phase: "grace", deadlineUtc: 23_000 });
  assert.equal(turnView(grace, "alice").timerLabel, "Final seconds");
  assert.equal(
    turnView(guessing({ deadlineUtc: 40_000 }), "alice").timerLabel,
    "Discussion",
  );
});

test("exits are named after the signs on both sides", () => {
  const cards = guessing().cards;
  assert.equal(exitLabel(cards, 0), "Exit between 0/100 Moss and 33 Lantern");
  assert.equal(exitLabel(cards, 2), "Exit between 66 Orbit and 0/100 Moss");
});

test("the correct exit comes from the pending result", () => {
  assert.equal(correctExit(pending()), 1);
  assert.equal(correctExit(guessing()), null);
  const wrap = pending();
  wrap.pendingReveal!.result.lower = 66;
  assert.equal(correctExit(wrap), 2);
});

test("island shows the secret number to the Tipster only", () => {
  const tip = snapshot({ phase: "tip", deadlineUtc: 20_000, currentDraw: 42 });
  assert.deepEqual(islandView(tip, "bob"), {
    kind: "secret",
    title: "Your secret number",
    text: "42",
  });
  assert.deepEqual(islandView({ ...tip, currentDraw: undefined }, "alice"), {
    kind: "thinking",
    title: "Bob is thinking",
    text: "of a word",
  });
  assert.deepEqual(islandView(guessing(), "alice"), {
    kind: "clue",
    title: "Bob's clue",
    text: "river",
  });
  assert.deepEqual(islandView(guessing(), "bob"), {
    kind: "clue",
    title: "Your clue",
    text: "river",
  });
  assert.equal(islandView(snapshot(), "alice").kind, "logo");
  const discarded = snapshot({
    phase: "result",
    clue: null,
    result: { correct: false, lost: false, discarded: true, timedOut: true },
  });
  assert.equal(islandView(discarded, "alice").kind, "logo");
});
