import test from "node:test";
import assert from "node:assert/strict";
import {
  authenticate,
  joinSession,
  newSession,
  nickname,
  normalizeSquid,
  MAX_PLAYERS,
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
