import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { createGame } from "../../../game/rules.ts";
import { projectCaller, type Session } from "../../../shared/protocol.ts";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const MAX_PLAYERS = 12;
export const SESSION_SECONDS = 60 * 60 * 24;

export function squid(): string {
  return Array.from(randomBytes(12), (byte) => ALPHABET[byte & 31]).join("");
}

export function token(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function nickname(value: unknown): string {
  if (typeof value !== "string") throw new Error("Enter a nickname.");
  const trimmed = value.trim();
  if (
    trimmed.length < 2 ||
    trimmed.length > 24 ||
    !/^[\p{L}\p{N}][\p{L}\p{N} ._'-]*$/u.test(trimmed)
  ) {
    throw new Error(
      "Nickname must be 2–24 letters/numbers (spaces, dots, hyphens allowed).",
    );
  }
  return trimmed;
}

export function normalizeSquid(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!new RegExp(`^[${ALPHABET}]{12}$`).test(normalized))
    throw new Error("Invalid session code.");
  return normalized;
}

function shuffle<T>(values: T[]): T[] {
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randomBytes(4).readUInt32BE() % (i + 1);
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

const WORDS = [
  "Lantern",
  "Moss",
  "Thunder",
  "Velvet",
  "Compass",
  "Whisper",
  "Marble",
  "Festival",
  "Puddle",
  "Orbit",
  "Cinnamon",
  "Feather",
];

export function newSession(name: string, now: number) {
  const id = squid();
  const participantId = token();
  const credential = token();
  const numbers = Array.from({ length: 99 }, (_, index) => index + 1).filter(
    (number) => number !== 33 && number !== 66,
  );
  const session: Session = {
    squid: id,
    version: 1,
    status: "lobby",
    hostId: participantId,
    tipsterId: null,
    participants: [
      {
        id: participantId,
        nickname: name,
        tokenHash: hashToken(credential),
        joinedAt: now,
      },
    ],
    game: createGame(shuffle(WORDS).slice(0, 3), shuffle(numbers)),
    turnId: token(),
    revealAtUtc: null,
    expiresAt: Math.floor(now / 1000) + SESSION_SECONDS,
  };
  return { session, participantId, credential };
}

export function joinSession(session: Session, name: string, now: number) {
  if (session.expiresAt <= Math.floor(now / 1000))
    throw new Error("Session expired.");
  if (session.participants.length >= MAX_PLAYERS)
    throw new Error("Session is full.");
  if (
    session.participants.some(
      (participant) =>
        participant.nickname.toLocaleLowerCase() === name.toLocaleLowerCase(),
    )
  ) {
    throw new Error("Nickname is already taken in this session.");
  }
  const participantId = token();
  const credential = token();
  const next: Session = {
    ...session,
    version: session.version + 1,
    participants: [
      ...session.participants,
      {
        id: participantId,
        nickname: name,
        tokenHash: hashToken(credential),
        joinedAt: now,
      },
    ],
  };
  return {
    session: next,
    participantId,
    credential,
    snapshot: projectCaller(next, participantId, now),
  };
}

export function authenticate(
  session: Session,
  credential: string | undefined,
): string | null {
  if (!credential || credential.length > 256) return null;
  const candidate = Buffer.from(hashToken(credential), "hex");
  return (
    session.participants.find((participant) =>
      timingSafeEqual(candidate, Buffer.from(participant.tokenHash, "hex")),
    )?.id ?? null
  );
}

export class CommandError extends Error {
  constructor(
    readonly code: "FORBIDDEN" | "INVALID_PHASE" | "INVALID_INPUT",
    message: string,
  ) {
    super(message);
  }
}

/** First claim wins; a retry by the current Tipster changes nothing. */
export function claimTipster(session: Session, participantId: string): Session {
  if (session.tipsterId === participantId) return session;
  if (session.status !== "lobby")
    throw new CommandError("INVALID_PHASE", "The game has already started.");
  if (session.tipsterId) {
    const tipster = session.participants.find(
      (participant) => participant.id === session.tipsterId,
    );
    throw new CommandError(
      "INVALID_PHASE",
      `${tipster?.nickname ?? "Someone"} is already the Tipster.`,
    );
  }
  return { ...session, version: session.version + 1, tipsterId: participantId };
}

/** Host-only; a retry after a successful start changes nothing. */
export function startGame(session: Session, participantId: string): Session {
  if (participantId !== session.hostId)
    throw new CommandError("FORBIDDEN", "Only the host can start the game.");
  if (session.status === "playing") return session;
  if (session.status !== "lobby")
    throw new CommandError("INVALID_PHASE", "The game has already ended.");
  if (!session.tipsterId)
    throw new CommandError(
      "INVALID_PHASE",
      "Someone needs to be the Tipster first.",
    );
  if (session.participants.length < 2)
    throw new CommandError(
      "INVALID_PHASE",
      "At least one Guesser needs to join first.",
    );
  return { ...session, version: session.version + 1, status: "playing" };
}
