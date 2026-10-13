import {
  PROTOCOL_VERSION,
  type CallerSnapshot,
  type CommandRequest,
  type ParticipantGrant,
  type PublicSnapshot,
  type SessionCommand,
} from "../shared/protocol.ts";

export type ApiConfig = { gameApiUrl: string };

export function normalizeCode(value: string): string {
  const code = value.includes("/s/")
    ? new URL(value).pathname.split("/s/")[1]?.split("/")[0]
    : value;
  const normalized = code?.trim().toUpperCase() ?? "";
  if (!/^[0-9A-HJKMNP-TV-Z]{12}$/.test(normalized))
    throw new Error("Enter a valid session code or invitation link.");
  return normalized;
}

/** The session code in an invite path (`/s/<code>`, trailing slash allowed). */
export function codeFromPath(pathname: string): string {
  const match = /^\/s\/([^/]+)\/?$/.exec(pathname);
  return match ? match[1]!.toUpperCase() : "";
}

export function storedParticipant(
  squid: string,
): { participantId: string; token: string } | null {
  try {
    const saved = sessionStorage.getItem(`round-about:${squid}`);
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
}

export function rememberParticipant(squid: string, grant: ParticipantGrant) {
  sessionStorage.setItem(
    `round-about:${squid}`,
    JSON.stringify({ participantId: grant.participantId, token: grant.token }),
  );
}

export class SessionApi {
  private readonly base: string;

  constructor(config: ApiConfig) {
    this.base = config.gameApiUrl.replace(/\/$/, "");
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(`${this.base}${path}`, init);
    const data = await response.json();
    if (!response.ok)
      throw Object.assign(
        new Error(data.message ?? "Session request failed."),
        {
          status: response.status,
          code: data.code as string | undefined,
          snapshot: data.snapshot as CallerSnapshot | undefined,
        },
      );
    return data as T;
  }

  host(nickname: string) {
    return this.request<ParticipantGrant>("/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nickname }),
    });
  }

  /** The host's "New session": a fresh session the old one points to. */
  newSession(replaces: string, token: string) {
    return this.request<ParticipantGrant>("/sessions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ replaces }),
    });
  }

  join(squid: string, nickname: string) {
    return this.request<ParticipantGrant>(
      `/sessions/${encodeURIComponent(squid)}/participants`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nickname }),
      },
    );
  }

  snapshot(squid: string, token: string) {
    return this.request<CallerSnapshot>(
      `/sessions/${encodeURIComponent(squid)}`,
      {
        headers: { authorization: `Bearer ${token}` },
      },
    );
  }

  command(
    squid: string,
    token: string,
    command: SessionCommand,
    latest: PublicSnapshot,
  ) {
    const body: CommandRequest = {
      protocolVersion: PROTOCOL_VERSION,
      turnId: latest.turnId,
      commandId: crypto.randomUUID(),
      expectedVersion: latest.version,
      command,
    };
    return this.request<CallerSnapshot>(
      `/sessions/${encodeURIComponent(squid)}/commands`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
  }
}
