import {
  PROTOCOL_VERSION,
  type CommandRequest,
  type Session,
  type SessionCommand,
} from "../../../shared/protocol.ts";
import { claimTipster, CommandError, startGame } from "./session.ts";

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
    typeof request.command.type !== "string"
  )
    throw new CommandError("INVALID_INPUT", "Invalid command.");
  return request as CommandRequest;
}

export function applyCommand(
  session: Session,
  participantId: string,
  command: SessionCommand,
): Session {
  switch (command.type) {
    case "CLAIM_TIPSTER":
      return claimTipster(session, participantId);
    case "START":
      return startGame(session, participantId);
    default:
      throw new CommandError("INVALID_INPUT", "Not available yet.");
  }
}
