import test from "node:test";
import assert from "node:assert/strict";
import {
  authenticate,
  claimTipster,
  CommandError,
  joinSession,
  newSession,
  nickname,
  normalizeSquid,
  MAX_PLAYERS,
  startGame,
} from "./session.ts";
import { projectCaller } from "../../../shared/protocol.ts";

test("hosting issues a unique secret per participant; invite code alone is insufficient", () => {
  const { session, participantId, credential } = newSession("Alice", 10_000);
  assert.match(session.squid, /^[0-9A-HJKMNP-TV-Z]{12}$/);
  assert.equal(authenticate(session, credential), participantId);
  assert.equal(authenticate(session, session.squid), null);
  assert.equal(
    JSON.stringify(projectCaller(session, participantId, 10_000)).includes(
      credential,
    ),
    false,
  );
  const joined = joinSession(session, "Bob", 11_000);
  assert.equal(
    authenticate(joined.session, joined.credential),
    joined.participantId,
  );
  assert.notEqual(credential, joined.credential);
  assert.equal(authenticate(joined.session, credential), participantId);
  assert.equal(session.participants.length, 1);
});

test("nicknames and codes are validated; late join remains a guesser", () => {
  assert.equal(nickname("  Alice  "), "Alice");
  assert.throws(() => nickname("<script>"));
  const { session } = newSession("Alice", 10_000);
  assert.equal(normalizeSquid(session.squid.toLowerCase()), session.squid);
  assert.throws(() => normalizeSquid("NOT_A_CODE"));
  assert.throws(() => joinSession(session, "alice", 11_000), /taken/);
  session.status = "playing";
  session.tipsterId = session.hostId;
  const joined = joinSession(session, "Bob", 11_000);
  assert.equal(joined.snapshot.tipsterId, session.hostId);
  assert.equal(joined.snapshot.currentDraw, undefined);
});

test("session size and expiry reject new joins", () => {
  const { session } = newSession("Alice", 10_000);
  session.participants = Array.from({ length: MAX_PLAYERS }, (_, i) => ({
    id: String(i),
    nickname: `Player ${i}`,
    tokenHash: "0".repeat(64),
    joinedAt: 10_000,
  }));
  assert.throws(() => joinSession(session, "Bob", 11_000), /full/);
  session.participants = [];
  assert.throws(
    () => joinSession(session, "Bob", session.expiresAt * 1000),
    /expired/,
  );
});

function lobby() {
  const hosted = newSession("Alice", 10_000);
  const bob = joinSession(hosted.session, "Bob", 11_000);
  const carol = joinSession(bob.session, "Carol", 12_000);
  return {
    session: carol.session,
    host: hosted.participantId,
    bob: bob.participantId,
    carol: carol.participantId,
  };
}

function rejects(action: () => unknown, code: string, message: string) {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof CommandError);
    assert.equal(error.code, code);
    assert.equal(error.message, message);
    return true;
  });
}

test("claim: first claimant becomes Tipster, retry is unchanged", () => {
  const { session, host } = lobby();
  const claimed = claimTipster(session, host);
  assert.equal(claimed.tipsterId, host);
  assert.equal(claimed.version, session.version + 1);
  assert.equal(claimTipster(claimed, host), claimed);
});

test("claim: competing claim names the winner", () => {
  const { session, bob, carol } = lobby();
  const won = claimTipster(session, bob);
  rejects(
    () => claimTipster(won, carol),
    "INVALID_PHASE",
    "Bob is already the Tipster.",
  );
});

test("start: only host, needs Tipster and Guesser", () => {
  const { session, host, bob } = lobby();
  rejects(
    () => startGame(session, bob),
    "FORBIDDEN",
    "Only the host can start the game.",
  );
  rejects(
    () => startGame(session, host),
    "INVALID_PHASE",
    "Someone needs to be the Tipster first.",
  );
  const alone = newSession("Alice", 10_000);
  rejects(
    () =>
      startGame(
        claimTipster(alone.session, alone.participantId),
        alone.participantId,
      ),
    "INVALID_PHASE",
    "At least one Guesser needs to join first.",
  );
  const ready = claimTipster(session, host);
  const started = startGame(ready, host);
  assert.equal(started.status, "playing");
  assert.equal(started.version, ready.version + 1);
  assert.equal(started.game.phase, "ready");
  assert.equal(startGame(started, host), started);
});

test("late joiner after start is a Guesser and cannot claim", () => {
  const { session, host, bob } = lobby();
  const started = startGame(claimTipster(session, bob), host);
  const late = joinSession(started, "Dave", 20_000);
  assert.equal(late.snapshot.tipsterId, bob);
  rejects(
    () => claimTipster(late.session, late.participantId),
    "INVALID_PHASE",
    "The game has already started.",
  );
});
