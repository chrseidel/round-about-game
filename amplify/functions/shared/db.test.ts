import test from "node:test";
import assert from "node:assert/strict";
import { marshall } from "@aws-sdk/util-dynamodb";
import { apply, createGame } from "../../../game/rules.ts";
import { MARSHALL_OPTIONS } from "./db.ts";

test("an Overtime timeout result can be saved", () => {
  const numbers = Array.from({ length: 99 }, (_, i) => i + 1).filter(
    (number) => number !== 33 && number !== 66,
  );
  let game = apply(
    createGame(["cake", "work", "fruit"], numbers),
    { type: "DRAW" },
    0,
  );
  game = { ...game, phase: "guess", lives: 0, deadline: 5_000 };
  const timedOut = apply(game, { type: "DISCUSSION_TIMEOUT" }, 5_000);
  assert.equal(timedOut.lastResult?.guessedGap, undefined);
  assert.throws(() => marshall({ game: timedOut }), /undefined/);
  assert.doesNotThrow(() => marshall({ game: timedOut }, MARSHALL_OPTIONS));
});
