import type { CallerSnapshot, ParticipantGrant } from "../shared/protocol.ts";

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

export function storedParticipant(
  squid: string,
): { participantId: string; token: string } | null {
  try {
    const saved = sessionStorage.getItem(`one-round:${squid}`);
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
}

export function rememberParticipant(squid: string, grant: ParticipantGrant) {
  sessionStorage.setItem(
    `one-round:${squid}`,
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
      throw new Error(data.message ?? "Session request failed.");
    return data as T;
  }

  host(nickname: string) {
    return this.request<ParticipantGrant>("/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nickname }),
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
}
