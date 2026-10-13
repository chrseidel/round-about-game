import test from "node:test";
import assert from "node:assert/strict";
import { apply, createGame } from "../game/rules.ts";
import {
  PROTOCOL_VERSION,
  projectCaller,
  projectPublic,
  publicEvent,
  type Session,
} from "./protocol.ts";

function session(): Session {
  const numbers = Array.from({ length: 99 }, (_, i) => i + 1).filter(
    (number) => number !== 33 && number !== 66,
  );
  return {
    squid: "7K9M2Q4V8P6R",
    version: 3,
    status: "playing",
    hostId: "host",
    tipsterId: "tip",
    turnId: "turn1",
    participants: [
      { id: "tip", nickname: "Alice", tokenHash: "secret-a", joinedAt: 1 },
      { id: "guess", nickname: "Bob", tokenHash: "secret-b", joinedAt: 2 },
    ],
    game: createGame(["cake", "work", "fruit"], numbers),
    revealAtUtc: null,
    lockedBy: null,
    expiresAt: 999999999999,
  };
}

test("secret number and future deck remain private during clue entry", () => {
  const value = session();
  value.game.phase = "tip";
  value.game.current = 83;
  value.game.clue = "unsent";
  const guesser = projectCaller(value, "guess", 1000);
  const tipster = projectCaller(value, "tip", 1000);
  assert.equal(tipster.currentDraw, 83);
  assert.equal(guesser.currentDraw, undefined);
  assert.equal(guesser.clue, null);
  for (const forbidden of [
    "tokenHash",
    "remainingNumbers",
    "currentDraw",
    "deck",
    "unsent",
    "83",
    "correctGap",
  ]) {
    assert.equal(
      JSON.stringify(publicEvent(value, 1000)).includes(forbidden),
      false,
      forbidden,
    );
  }
  assert.equal(guesser.protocolVersion, PROTOCOL_VERSION);
  assert.deepEqual(
    guesser.participants.map((p) => p.nickname),
    ["Alice", "Bob"],
  );
});

test("handoff hides number even from tipster", () => {
  const value = session();
  value.game.phase = "handoff";
  value.game.current = 83;
  value.game.clue = "sweet";
  assert.equal(projectCaller(value, "tip", 1000).currentDraw, undefined);
  assert.equal(projectPublic(value, 1000).clue, "sweet");
});

test("pending reveal does not render result early, then exposes graded card", () => {
  const value = session();
  value.game.phase = "result";
  value.game.current = 83;
  value.game.clue = "sweet";
  value.game.cards.push({ number: 83, word: "sweet" });
  value.game.lastResult = {
    correct: false,
    lost: false,
    discarded: false,
    timedOut: false,
    guessedGap: 0,
    lower: value.game.cards[2],
    upper: value.game.cards[0],
  };
  value.revealAtUtc = 3000;
  const early = projectPublic(value, 2000);
  assert.equal(early.result, null);
  assert.equal(early.phase, "guess");
  assert.equal(early.selectedGap, 0);
  assert.equal(early.lives, value.game.lives + 1);
  assert.deepEqual(
    early.cards.map((c) => c.number),
    [0, 33, 66],
  );
  assert.equal(early.pendingReveal?.result.number, 83);
  const revealed = projectPublic(value, 3000);
  assert.equal(revealed.pendingReveal, null);
  assert.equal(revealed.result?.number, 83);
  assert.deepEqual(
    revealed.cards.map((c) => c.number),
    [0, 33, 66, 83],
  );
});

test("public event excludes secrets", () => {
  const value = session();
  value.game.current = 83;
  const event = publicEvent(value, 1000);
  for (const secret of ["tokenHash", "currentDraw", "deck"]) {
    assert.equal(JSON.stringify(event).includes(secret), false);
  }
});

test("snapshots carry server time", () => {
  assert.equal(projectPublic(session(), 1234).serverTimeUtc, 1234);
});

test("drawn number never reaches Guessers or events", () => {
  const value = session();
  value.game = apply(value.game, { type: "DRAW" }, 1000);
  const drawn = value.game.current!;
  assert.equal(projectCaller(value, "tip", 2000).currentDraw, drawn);
  assert.equal("currentDraw" in projectCaller(value, "guess", 2000), false);
  const event = JSON.stringify(publicEvent(value, 2000));
  assert.equal(event.includes("currentDraw"), false);
  assert.equal(event.includes(`"number":${drawn}`), false);
});
