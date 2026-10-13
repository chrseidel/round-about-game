import {
  PROTOCOL_VERSION,
  type CommandRequest,
  type Session,
  type SessionCommand,
} from "../../../shared/protocol.ts";
import { reconcile } from "../../../shared/deadlines.ts";
import {
  chooseGap,
  claimTipster,
  CommandError,
  drawCard,
  lockGap,
  startGame,
  submitClue,
} from "./session.ts";

/** Validates the envelope; only the command's type is trusted from the body. */
export function parseCommandRequest(value: unknown): CommandRequest {
  const request = value as Partial<CommandRequest> | null;
  if (
    !request ||
    typeof request !== "object" ||
    request.protocolVersion !== PROTOCOL_VERSION ||
    typeof request.commandId !== "string" ||
    request.commandId.length > 64 ||
    !request.command ||
    typeof request.command !== "object" ||
    typeof request.command.type !== "string" ||
    (request.command.type === "SUBMIT_CLUE" &&
      typeof (request.command as { clue?: unknown }).clue !== "string") ||
    ((request.command.type === "CHOOSE_GAP" ||
      request.command.type === "LOCK_GAP") &&
      !Number.isInteger((request.command as { index?: unknown }).index)) ||
    (request.command.type === "LOCK_GAP" &&
      !Number.isInteger(request.expectedVersion))
  )
    throw new CommandError("INVALID_INPUT", "Invalid command.");
  return request as CommandRequest;
}

/** Applies due timeouts first, so a late command meets the expired state. */
export function applyCommand(
  session: Session,
  participantId: string,
  command: SessionCommand,
  expectedVersion: number,
  now: number,
): Session {
  const current = reconcile(session, now);
  switch (command.type) {
    case "CLAIM_TIPSTER":
      return claimTipster(current, participantId);
    case "START":
      return startGame(current, participantId);
    case "DRAW":
      return drawCard(current, participantId, now);
    case "SUBMIT_CLUE":
      return submitClue(current, participantId, command.clue, now);
    case "CHOOSE_GAP":
      return chooseGap(current, participantId, command.index);
    case "LOCK_GAP":
      // If reconcile expired the guess, lockGap refuses on the phase first.
      return lockGap(
        current,
        participantId,
        command.index,
        expectedVersion,
        now,
      );
    default:
      throw new CommandError("INVALID_INPUT", "Not available yet.");
  }
}

const REMEMBERED_COMMANDS = 20;

export function alreadyApplied(session: Session, commandId: string): boolean {
  return session.recentCommands?.includes(commandId) ?? false;
}

export function rememberCommand(session: Session, commandId: string): Session {
  return {
    ...session,
    recentCommands: [...(session.recentCommands ?? []), commandId].slice(
      -REMEMBERED_COMMANDS,
    ),
  };
}
