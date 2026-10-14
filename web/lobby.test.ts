import test from "node:test";
import assert from "node:assert/strict";
import type { PublicSnapshot } from "../shared/protocol.ts";
import { lobbyView } from "./lobby.ts";

function snapshot(overrides: Partial<PublicSnapshot> = {}): PublicSnapshot {
  return {
    status: "lobby",
    hostId: "alice",
    tipsterId: null,
    participants: [
      { id: "alice", nickname: "Alice", joinedAt: 1 },
      { id: "bob", nickname: "Bob", joinedAt: 2 },
      { id: "carol", nickname: "Carol", joinedAt: 3 },
    ],
    ...overrides,
  } as PublicSnapshot;
}

test("one car per player, marking host, Tipster and you", () => {
  assert.deepEqual(lobbyView(snapshot({ tipsterId: "bob" }), "alice").cars, [
    { id: "alice", name: "Alice", host: true, tipster: false, you: true },
    { id: "bob", name: "Bob", host: false, tipster: true, you: false },
    { id: "carol", name: "Carol", host: false, tipster: false, you: false },
  ]);
});

test("Tipster sign names the seat holder", () => {
  const free = lobbyView(snapshot(), "bob");
  assert.equal(free.tipsterTitle, "Nobody is the Tipster yet");
  assert.equal(
    free.tipsterText,
    "The Tipster sees the secret numbers and gives the clues.",
  );
  const taken = lobbyView(snapshot({ tipsterId: "bob" }), "alice");
  assert.equal(taken.tipsterTitle, "Bob is the Tipster");
  assert.equal(
    taken.tipsterText,
    "Bob sees the secret numbers and gives one-word clues. Everyone else guesses.",
  );
  assert.equal(
    lobbyView(snapshot({ tipsterId: "bob" }), "bob").tipsterTitle,
    "You are the Tipster",
  );
});

test("claim only while the seat is free in the lobby", () => {
  assert.equal(lobbyView(snapshot(), "bob").canClaim, true);
  assert.equal(
    lobbyView(snapshot({ tipsterId: "carol" }), "bob").canClaim,
    false,
  );
  assert.equal(
    lobbyView(snapshot({ status: "playing" }), "bob").canClaim,
    false,
  );
});

test("start only for the host once ready", () => {
  const guest = lobbyView(snapshot({ tipsterId: "bob" }), "bob");
  assert.equal(guest.canStart, false);
  assert.equal(guest.ready, true);
  assert.equal(guest.startHint, "Waiting for Alice to start the game.");
  assert.equal(
    lobbyView(snapshot(), "bob").startHint,
    "Alice starts the game once someone takes the Tipster seat.",
  );
  assert.equal(
    lobbyView(snapshot(), "alice").startHint,
    "Someone needs to be the Tipster first.",
  );
  const alone = snapshot({
    tipsterId: "alice",
    participants: [{ id: "alice", nickname: "Alice", joinedAt: 1 }],
  });
  assert.equal(
    lobbyView(alone, "alice").startHint,
    "At least one Guesser needs to join first.",
  );
  assert.equal(lobbyView(alone, "alice").ready, false);
  const ready = lobbyView(snapshot({ tipsterId: "bob" }), "alice");
  assert.equal(ready.canStart, true);
  assert.equal(ready.ready, true);
  assert.equal(
    ready.startHint,
    "3 players on the road. Late arrivals join as Guessers.",
  );
});

test("started game names the Tipster", () => {
  const view = lobbyView(
    snapshot({ status: "playing", tipsterId: "bob" }),
    "alice",
  );
  assert.equal(view.started, "Game started. Bob is the Tipster.");
  assert.equal(view.canClaim, false);
  assert.equal(view.canStart, false);
});

test("the lobby names the starting-word language", () => {
  assert.equal(
    lobbyView(snapshot({ language: "de" }), "bob").languageLabel,
    "Starting words: Deutsch",
  );
  assert.equal(
    lobbyView(snapshot({ language: "en" }), "bob").languageLabel,
    "Starting words: English",
  );
});
