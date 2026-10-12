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

test("players line marks host, Tipster and you", () => {
  assert.equal(
    lobbyView(snapshot({ tipsterId: "bob" }), "alice").players,
    "Alice (host, you) · Bob (Tipster) · Carol",
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
  assert.equal(guest.startHint, "");
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
  const ready = lobbyView(snapshot({ tipsterId: "bob" }), "alice");
  assert.equal(ready.canStart, true);
  assert.equal(ready.startHint, "");
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
