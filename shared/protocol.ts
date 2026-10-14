import type { Game, Phase, Result } from "../game/rules.ts";

export const PROTOCOL_VERSION = 1;
export type Role = "tipster" | "guesser";
export type Participant = { id: string; nickname: string; joinedAt: number };
export type SessionStatus = "lobby" | "playing" | "won" | "lost";
/** Language of the starting words, chosen by the host. */
export type Language = "en" | "de";
export type Session = {
  squid: string;
  version: number;
  status: SessionStatus;
  hostId: string;
  tipsterId: string | null;
  participants: (Participant & { tokenHash: string })[];
  game: Game;
  turnId: string;
  revealAtUtc: number | null;
  /** Who locked the current guess; shown during the shared reveal. */
  lockedBy: string | null;
  expiresAt: number;
  /** IDs of the last applied commands, so retries are not applied twice. */
  recentCommands?: string[];
  /** Set when the host started a new session; players follow this code. */
  nextSquid?: string | null;
  /** Starting-word language; sessions from before it existed are English. */
  language?: Language;
};

export type PublicResult = Pick<
  Result,
  "correct" | "lost" | "discarded" | "timedOut"
> & {
  number?: number;
  lower?: number;
  upper?: number;
};
export type PublicSnapshot = {
  protocolVersion: number;
  squid: string;
  version: number;
  status: SessionStatus;
  hostId: string;
  tipsterId: string | null;
  participants: Participant[];
  turnId: string;
  phase: Phase | "lobby";
  cards: { number: number; word: string }[];
  pile: number;
  lives: number;
  turn: number;
  clue: string | null;
  selectedGap: number | null;
  deadlineUtc: number | null;
  result: PublicResult | null;
  revealAtUtc: number | null;
  lockedBy: string | null;
  nextSquid: string | null;
  language: Language;
  /** Server clock when the snapshot was made; browsers correct countdowns with it. */
  serverTimeUtc: number;
  pendingReveal: {
    cards: { number: number; word: string }[];
    result: PublicResult;
    lives: number;
    status: SessionStatus;
  } | null;
};
export type CallerSnapshot = PublicSnapshot & { currentDraw?: number };
export type PublicEvent = { type: "game_updated"; snapshot: PublicSnapshot };

export type CreateSessionRequest = { nickname: string; language?: Language };
export type JoinSessionRequest = { nickname: string };
export type ParticipantGrant = {
  participantId: string;
  token: string;
  snapshot: CallerSnapshot;
};
export type SessionCommand =
  | { type: "CLAIM_TIPSTER" }
  | { type: "START" }
  | { type: "DRAW" }
  | { type: "SUBMIT_CLUE"; clue: string }
  | { type: "CHOOSE_GAP"; index: number }
  | { type: "LOCK_GAP"; index: number }
  | { type: "NEXT_TURN" };
export type CommandRequest = {
  protocolVersion: number;
  turnId: string;
  commandId: string;
  expectedVersion: number;
  command: SessionCommand;
};
export type ApiError = {
  code:
    | "INVALID_INPUT"
    | "UNAUTHORIZED"
    | "FORBIDDEN"
    | "NOT_FOUND"
    | "STALE_VERSION"
    | "INVALID_PHASE";
  message: string;
  snapshot?: CallerSnapshot;
};

function publicResult(
  result: Result | null,
  current: number | null,
): PublicResult | null {
  if (!result) return null;
  return {
    correct: result.correct,
    lost: result.lost,
    discarded: result.discarded,
    timedOut: result.timedOut,
    ...(result.discarded
      ? {}
      : {
          number: current ?? undefined,
          lower: result.lower?.number,
          upper: result.upper?.number,
        }),
  };
}

/** Explicit allowlist: future private fields added to Session cannot leak automatically. */
export function projectPublic(session: Session, now: number): PublicSnapshot {
  const game = session.game;
  const revealPending =
    session.revealAtUtc !== null && now < session.revealAtUtc;
  const previous =
    revealPending && game.lastResult && !game.lastResult.discarded;
  const cards = previous
    ? game.cards.filter((card) => card.number !== game.current)
    : game.cards;
  const pendingResult = revealPending
    ? publicResult(game.lastResult, game.current)
    : null;
  return {
    protocolVersion: PROTOCOL_VERSION,
    squid: session.squid,
    version: session.version,
    status: revealPending ? "playing" : session.status,
    hostId: session.hostId,
    tipsterId: session.tipsterId,
    participants: session.participants.map(({ id, nickname, joinedAt }) => ({
      id,
      nickname,
      joinedAt,
    })),
    turnId: session.turnId,
    language: session.language ?? "en",
    phase:
      session.status === "lobby"
        ? "lobby"
        : revealPending
          ? "guess"
          : game.phase,
    cards: cards.map(({ number, word }) => ({ number, word })),
    pile: game.pile,
    lives:
      revealPending && !game.lastResult?.correct ? game.lives + 1 : game.lives,
    turn: game.turn,
    clue:
      ["guess", "result", "finished"].includes(game.phase) && game.clue
        ? game.clue
        : game.phase === "handoff"
          ? game.clue
          : null,
    selectedGap: revealPending
      ? (game.lastResult?.guessedGap ?? null)
      : game.phase === "guess"
        ? game.selectedGap
        : null,
    deadlineUtc: game.deadline,
    result: revealPending ? null : publicResult(game.lastResult, game.current),
    revealAtUtc: session.revealAtUtc,
    lockedBy: session.lockedBy ?? null,
    nextSquid: session.nextSquid ?? null,
    serverTimeUtc: now,
    pendingReveal:
      revealPending && pendingResult
        ? {
            cards: game.cards.map(({ number, word }) => ({ number, word })),
            result: pendingResult,
            lives: game.lives,
            status: session.status,
          }
        : null,
  };
}

export function projectCaller(
  session: Session,
  participantId: string,
  now: number,
): CallerSnapshot {
  const snapshot: CallerSnapshot = projectPublic(session, now);
  if (
    participantId === session.tipsterId &&
    ["tip", "grace"].includes(session.game.phase) &&
    session.game.current !== null
  ) {
    snapshot.currentDraw = session.game.current;
  }
  return snapshot;
}

export function publicEvent(session: Session, now: number): PublicEvent {
  return { type: "game_updated", snapshot: projectPublic(session, now) };
}
