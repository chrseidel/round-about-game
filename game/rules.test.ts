import test from "node:test";
import assert from "node:assert/strict";
import { apply, createGame, clueError, type Game } from "./rules.ts";

const numbers = Array.from({ length: 99 }, (_, i) => i + 1).filter(
  (n) => n !== 33 && n !== 66,
);
function fresh(): Game {
  return createGame(["cake", "work", "fruit"], numbers);
}

test("deterministic draw and wrap gap; reducer does not mutate its input", () => {
  const original = fresh();
  const drawn = apply(original, { type: "DRAW" }, 1000);
  assert.equal(drawn.current, 99);
  assert.equal(drawn.deadline, 21000);
  assert.equal(original.current, null);
  assert.equal(original.deck.length, 97);
  const clue = apply(drawn, { type: "SUBMIT_CLUE", clue: "sweet" }, 5000);
  const guess = apply(clue, { type: "BEGIN_GUESS" }, 6000);
  const selected = apply(guess, { type: "SELECT_GAP", index: 2 }, 7000);
  const result = apply(selected, { type: "LOCK_GAP" }, 8000);
  assert.equal(result.lastResult?.correct, true);
  assert.deepEqual(
    result.cards.map((card) => card.number),
    [0, 33, 66, 99],
  );
  assert.equal(guess.selectedGap, null);
});

test("wrong guess inserts card correctly and costs a life", () => {
  const state = fresh();
  state.phase = "guess";
  state.current = 83;
  state.clue = "sweet";
  state.selectedGap = 0;
  const result = apply(state, { type: "LOCK_GAP" }, 1000);
  assert.deepEqual(
    result.cards.map((card) => card.number),
    [0, 33, 66, 83],
  );
  assert.deepEqual(
    [result.lastResult?.lower?.number, result.lastResult?.upper?.number],
    [66, 0],
  );
  assert.equal(result.lives, 2);
  assert.equal(state.cards.length, 3);
});

test("clue deadline and grace are based on original start", () => {
  const state = apply(fresh(), { type: "DRAW" }, 1000);
  assert.throws(() => apply(state, { type: "CLUE_TIMEOUT" }, 20999));
  const grace = apply(state, { type: "CLUE_TIMEOUT" }, 22000);
  assert.equal(grace.deadline, 24000);
  assert.throws(() =>
    apply(grace, { type: "SUBMIT_CLUE", clue: "sweet" }, 24000),
  );
  const discarded = apply(grace, { type: "GRACE_TIMEOUT" }, 24000);
  assert.equal(discarded.pile, 12);
  assert.equal(discarded.lives, 2);
  assert.equal(discarded.cards.length, 3);
});

test("third lost life permits overtime and final correct guess wins", () => {
  const state = fresh();
  state.phase = "guess";
  state.lives = 1;
  state.current = 83;
  state.clue = "sweet";
  state.selectedGap = 0;
  const missed = apply(state, { type: "LOCK_GAP" }, 1000);
  assert.equal(missed.lives, 0);
  assert.equal(apply(missed, { type: "NEXT_TURN" }, 2000).phase, "ready");

  const last = fresh();
  last.phase = "guess";
  last.lives = 0;
  last.pile = 0;
  last.deadline = 20000;
  last.current = 83;
  last.clue = "sweet";
  last.selectedGap = 2;
  const correct = apply(last, { type: "LOCK_GAP" }, 5000);
  assert.equal(apply(correct, { type: "NEXT_TURN" }, 6000).phase, "finished");
});

test("last wrong guess requires replacement; overtime timeout loses", () => {
  const state = fresh();
  state.phase = "guess";
  state.pile = 0;
  state.current = 83;
  state.clue = "sweet";
  state.selectedGap = 0;
  const missed = apply(state, { type: "LOCK_GAP" }, 1000);
  assert.equal(apply(missed, { type: "NEXT_TURN" }, 2000).phase, "ready");

  state.lives = 0;
  state.deadline = 5000;
  const timedOut = apply(state, { type: "DISCUSSION_TIMEOUT" }, 5000);
  assert.equal(timedOut.lastResult?.lost, true);
  assert.equal(apply(timedOut, { type: "NEXT_TURN" }, 5001).phase, "finished");
});

test("clue validation checks format and exact duplicates", () => {
  const state = fresh();
  assert.match(clueError("cake", state.cards), /already/);
  assert.match(clueError("two words", state.cards), /one word/);
  assert.equal(clueError("New York", state.cards), "");
});
