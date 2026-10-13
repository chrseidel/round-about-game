import { apply, type Command, type Game } from "../game/rules.ts";
import type { Session, SessionStatus } from "./protocol.ts";

export type TimeoutMessage = {
  squid: string;
  turn: number;
  phase: "tip" | "grace" | "guess";
  deadline: number;
};

export type TimeoutDecision =
  | { action: "ignore" }
  | { action: "retry"; delaySeconds: number }
  | { action: "apply" };

const TIMEOUTS: Record<TimeoutMessage["phase"], Command["type"]> = {
  tip: "CLUE_TIMEOUT",
  grace: "GRACE_TIMEOUT",
  guess: "DISCUSSION_TIMEOUT",
};

function running(session: Session) {
  const { phase, deadline } = session.game;
  return session.status === "playing" && phase in TIMEOUTS && deadline !== null;
}

/**
 * Applies every timeout that is already due, so each request is judged by
 * the real time no matter when (or whether) a queued timeout arrives.
 */
export function reconcile(session: Session, now: number): Session {
  let game = session.game;
  while (
    session.status === "playing" &&
    game.phase in TIMEOUTS &&
    game.deadline !== null &&
    now >= game.deadline
  ) {
    const type = TIMEOUTS[game.phase as TimeoutMessage["phase"]];
    game = apply(game, { type } as Command, now);
  }
  return game === session.game
    ? session
    : {
        ...session,
        version: session.version + 1,
        game,
        status: finalStatus(game),
      };
}

/**
 * Whether a result ends the game: a lost result loses, a correct placement
 * of the last pile card wins (also in Overtime), anything else continues.
 */
export function finalStatus(game: Game): SessionStatus {
  if (game.lastResult?.lost) return "lost";
  if (game.lastResult?.correct && game.pile === 0) return "won";
  return "playing";
}

export function timeoutMessage(session: Session): TimeoutMessage | null {
  if (!running(session)) return null;
  return {
    squid: session.squid,
    turn: session.game.turn,
    phase: session.game.phase as TimeoutMessage["phase"],
    deadline: session.game.deadline!,
  };
}

/** Seconds to wait, rounded up, within SQS's 0–900 s delay range. */
export function timeoutDelay(deadline: number, now: number): number {
  return Math.min(900, Math.max(0, Math.ceil((deadline - now) / 1000)));
}

export function decideTimeout(
  message: TimeoutMessage,
  session: Session | null,
  now: number,
): TimeoutDecision {
  const current = session && timeoutMessage(session);
  if (
    !session ||
    session.expiresAt <= Math.floor(now / 1000) ||
    !current ||
    current.turn !== message.turn ||
    current.phase !== message.phase ||
    current.deadline !== message.deadline
  )
    return { action: "ignore" };
  return now < message.deadline
    ? { action: "retry", delaySeconds: timeoutDelay(message.deadline, now) }
    : { action: "apply" };
}
