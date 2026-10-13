import test from "node:test";
import assert from "node:assert/strict";
import {
  authenticate,
  claimTipster,
  CommandError,
  chooseGap,
  drawCard,
  lockGap,
  nextTurn,
  replaceSession,
  joinSession,
  newSession,
  nickname,
  normalizeSquid,
  MAX_PLAYERS,
  startGame,
  submitClue,
} from "./session.ts";
import { clueError } from "../../../game/rules.ts";
import { reconcile } from "../../../shared/deadlines.ts";
import { projectCaller, type Session } from "../../../shared/protocol.ts";

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

function playing() {
  const { session, host, bob, carol } = lobby();
  return {
    session: startGame(claimTipster(session, bob), host),
    host,
    bob,
    carol,
  };
}

test("draw: only the Tipster, once per card", () => {
  const { session, bob, carol } = playing();
  rejects(
    () => drawCard(session, carol, 0),
    "FORBIDDEN",
    "Only the Tipster can draw.",
  );
  const { session: waiting, bob: tipster } = lobby();
  rejects(
    () => drawCard({ ...waiting, tipsterId: tipster }, tipster, 0),
    "INVALID_PHASE",
    "The game has not started.",
  );
  const drawn = drawCard(session, bob, 0);
  assert.equal(drawn.game.phase, "tip");
  assert.notEqual(drawn.game.current, null);
  assert.equal(drawn.game.deadline, 20_000);
  assert.equal(drawn.version, session.version + 1);
  assert.equal(drawCard(drawn, bob, 1_000), drawn);
});

test("clue: only the Tipster, valid word, in time", () => {
  const { session, bob, carol } = playing();
  const drawn = drawCard(session, bob, 0);
  rejects(
    () => submitClue(drawn, carol, "river", 1_000),
    "FORBIDDEN",
    "Only the Tipster can send the word.",
  );
  rejects(
    () => submitClue(drawn, bob, "two words", 1_000),
    "INVALID_INPUT",
    clueError("two words", drawn.game.cards),
  );
  const existing = ` ${drawn.game.cards[0]!.word.toLowerCase()} `;
  rejects(
    () => submitClue(drawn, bob, existing, 1_000),
    "INVALID_INPUT",
    "That word is already in the circle. Choose another.",
  );
  const sent = submitClue(drawn, bob, "river", 5_000);
  assert.equal(sent.game.phase, "guess");
  assert.equal(sent.game.clue, "river");
  assert.equal(sent.game.deadline, null);
  assert.equal(sent.version, drawn.version + 1);
  assert.equal(submitClue(sent, bob, " river ", 6_000), sent);
  const overtime = { ...drawn, game: { ...drawn.game, lives: 0 } };
  assert.equal(submitClue(overtime, bob, "river", 5_000).game.deadline, 25_000);
});

test("clue in grace is accepted, after expiry it is too late", () => {
  const { session, bob } = playing();
  const drawn = drawCard(session, bob, 0);
  const grace = reconcile(drawn, 21_000);
  assert.equal(grace.game.phase, "grace");
  assert.equal(submitClue(grace, bob, "river", 21_000).game.phase, "guess");
  rejects(
    () => submitClue(reconcile(drawn, 24_000), bob, "river", 24_000),
    "INVALID_PHASE",
    "Time is up for this card.",
  );
});

/** A started game in the guess phase: Bob drew at 0 and sent "river". */
function guessing(lives = 3) {
  const { session, host, bob, carol } = playing();
  const drawn = drawCard(session, bob, 0);
  const ready = { ...drawn, game: { ...drawn.game, lives } };
  return { session: submitClue(ready, bob, "river", 1_000), host, bob, carol };
}

test("choose: Guessers only, while guessing, valid gaps", () => {
  const { session, host, bob } = guessing();
  rejects(
    () => chooseGap(session, bob, 1),
    "FORBIDDEN",
    "The Tipster can't choose a gap.",
  );
  const { session: started, host: alice, bob: tipster } = playing();
  rejects(
    () => chooseGap(drawCard(started, tipster, 0), alice, 1),
    "INVALID_PHASE",
    "Guessing is not open right now.",
  );
  for (const index of [-1, 3, 1.5])
    rejects(
      () => chooseGap(session, host, index),
      "INVALID_INPUT",
      "Choose a gap in the circle.",
    );
  const chosen = chooseGap(session, host, 1);
  assert.equal(chosen.game.selectedGap, 1);
  assert.equal(chosen.game.phase, "guess");
  assert.equal(chosen.version, session.version + 1);
  assert.equal(chooseGap(chosen, host, 1), chosen);
});

test("choose keeps the Overtime deadline", () => {
  const { session, host } = guessing(0);
  assert.equal(session.game.deadline, 21_000);
  assert.equal(chooseGap(session, host, 2).game.deadline, 21_000);
});

test("lock: strict and once", () => {
  const { session, host, bob, carol } = guessing();
  const chosen = chooseGap(session, host, 1);
  rejects(
    () => lockGap(chosen, bob, 1, chosen.version, 2_000),
    "FORBIDDEN",
    "The Tipster can't lock a gap.",
  );
  const stale = "The selection changed. Tap again to lock in.";
  rejects(
    () => lockGap(chosen, carol, 2, chosen.version, 2_000),
    "STALE_VERSION",
    stale,
  );
  rejects(
    () => lockGap(chosen, carol, 1, chosen.version - 1, 2_000),
    "STALE_VERSION",
    stale,
  );
  const locked = lockGap(chosen, carol, 1, chosen.version, 2_000);
  assert.equal(locked.game.phase, "result");
  assert.equal(locked.game.lastResult?.guessedGap, 1);
  assert.equal(locked.game.cards.length, 4);
  assert.equal(locked.version, chosen.version + 1);
});

test("lock after Overtime expiry is refused", () => {
  const { session, host, carol } = guessing(0);
  const chosen = chooseGap(session, host, 1);
  rejects(
    () => lockGap(reconcile(chosen, 21_000), carol, 1, chosen.version, 21_000),
    "INVALID_PHASE",
    "Guessing is not open right now.",
  );
});

test("lock sets the shared reveal time", () => {
  const { session, host, carol } = guessing();
  const chosen = chooseGap(session, host, 1);
  const locked = lockGap(chosen, carol, 1, chosen.version, 2_000);
  assert.equal(locked.revealAtUtc, 4_000);
  assert.equal(locked.lockedBy, carol);
  const early = projectCaller(locked, carol, 3_000);
  assert.equal(early.result, null);
  assert.notEqual(early.pendingReveal, null);
  assert.equal(early.lockedBy, carol);
  const late = projectCaller(locked, host, 4_000);
  assert.notEqual(late.result, null);
  assert.equal(late.pendingReveal, null);
});

test("timeouts reveal immediately", () => {
  const { session, host } = guessing(0);
  const chosen = chooseGap(session, host, 1);
  const expired = reconcile(chosen, 21_000);
  assert.equal(expired.revealAtUtc, null);
  assert.notEqual(projectCaller(expired, host, 21_000).result, null);
  assert.equal(newSession("Zoe", 0).session.lockedBy, null);
});

/** Index of the gap the drawn card belongs in (the reducer's rule). */
function correctGap(session: Session) {
  const { cards, current } = session.game;
  const insertion = cards.findIndex((card) => card.number > current!);
  const target = insertion < 0 ? cards.length : insertion;
  return (target - 1 + cards.length) % cards.length;
}

function lastCard(lives = 3) {
  const { session, host, bob, carol } = guessing(lives);
  return {
    session: { ...session, game: { ...session.game, pile: 0 } },
    host,
    bob,
    carol,
  };
}

function lockAt(
  session: Session,
  chooser: string,
  locker: string,
  index: number,
) {
  const chosen = chooseGap(session, chooser, index);
  return lockGap(chosen, locker, index, chosen.version, 2_000);
}

test("correct last card wins", () => {
  const { session, host, carol } = lastCard();
  assert.equal(lockAt(session, host, carol, correctGap(session)).status, "won");
  const overtime = lastCard(0);
  assert.equal(
    lockAt(
      overtime.session,
      overtime.host,
      overtime.carol,
      correctGap(overtime.session),
    ).status,
    "won",
  );
});

test("wrong last card continues; Overtime wrong lock loses", () => {
  const { session, host, carol } = lastCard();
  const wrong = (correctGap(session) + 1) % session.game.cards.length;
  assert.equal(lockAt(session, host, carol, wrong).status, "playing");
  const overtime = guessing(0);
  const miss =
    (correctGap(overtime.session) + 1) % overtime.session.game.cards.length;
  assert.equal(
    lockAt(overtime.session, overtime.host, overtime.carol, miss).status,
    "lost",
  );
});

function revealedWrong() {
  const { session, host, bob, carol } = guessing();
  const wrong = (correctGap(session) + 1) % session.game.cards.length;
  return { session: lockAt(session, host, carol, wrong), host, bob, carol };
}

test("next turn waits for the reveal and clears it", () => {
  const { session, bob, carol } = revealedWrong();
  rejects(
    () => nextTurn(session, carol, 5_000),
    "FORBIDDEN",
    "Only the Tipster can draw.",
  );
  rejects(
    () => nextTurn(session, bob, 3_999),
    "INVALID_PHASE",
    "Wait for the reveal.",
  );
  const next = nextTurn(session, bob, 4_000);
  assert.equal(next.game.phase, "ready");
  assert.equal(next.revealAtUtc, null);
  assert.equal(next.lockedBy, null);
  assert.equal(next.game.current, null);
  assert.equal(next.version, session.version + 1);
});

test("draw next card advances and draws", () => {
  const { session, bob } = revealedWrong();
  const drawn = drawCard(session, bob, 5_000);
  assert.equal(drawn.game.phase, "tip");
  assert.equal(drawn.tipsterId, bob);
  assert.ok(
    !session.game.cards.some((card) => card.number === drawn.game.current),
  );
  assert.notEqual(drawn.game.current, session.game.current);
  assert.equal(drawCard(drawn, bob, 6_000), drawn);
});

test("replacement after a wrong last card", () => {
  const { session, host, bob, carol } = lastCard();
  const wrong = (correctGap(session) + 1) % session.game.cards.length;
  const missed = lockAt(session, host, carol, wrong);
  const replacement = drawCard(missed, bob, 5_000);
  assert.equal(replacement.game.phase, "tip");
  assert.equal(replacement.game.pile, 0);
});

test("new session replaces the old", () => {
  const { session: old, host, bob } = revealedWrong();
  rejects(
    () => replaceSession(old, bob, 10_000),
    "FORBIDDEN",
    "Only the host can start a new session.",
  );
  const replaced = replaceSession(old, host, 10_000);
  assert.notEqual(replaced.session.squid, old.squid);
  assert.equal(replaced.session.status, "lobby");
  assert.equal(replaced.session.tipsterId, null);
  assert.equal(replaced.session.game.pile, 12);
  assert.equal(replaced.session.game.cards.length, 3);
  assert.equal(replaced.session.participants[0]!.nickname, "Alice");
  assert.equal(replaced.old.nextSquid, replaced.session.squid);
  assert.equal(replaced.old.expiresAt, 10 + 600);
  assert.equal(replaced.old.version, old.version + 1);
  assert.equal(
    authenticate(replaced.session, replaced.credential),
    replaced.participantId,
  );
});
