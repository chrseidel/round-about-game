// Keep the existing browser game playable while the rule engine moves to game/.
import "../app.js";
import {
  SessionApi,
  normalizeCode,
  rememberParticipant,
  storedParticipant,
} from "./session-api.ts";
import { GameEvents } from "./events.ts";

// Keep the local prototype usable until the multiplayer board is wired up.
async function setupSessionEntry() {
  let endpoint: string | undefined;
  let eventsEndpoint: string | undefined;
  try {
    const response = await fetch("/amplify_outputs.json");
    if (response.ok) {
      const outputs = (await response.json()) as {
        custom?: { gameApiUrl?: string; gameEventsUrl?: string };
      };
      endpoint = outputs.custom?.gameApiUrl;
      eventsEndpoint = outputs.custom?.gameEventsUrl;
    }
  } catch {
    /* no sandbox configured */
  }
  if (!endpoint) return;

  const api = new SessionApi({ gameApiUrl: endpoint });
  const entry = document.querySelector<HTMLDivElement>("#sessionEntry")!;
  entry.hidden = false;
  const squid = location.pathname.startsWith("/s/")
    ? location.pathname.slice(3)
    : "";
  const saved = squid && storedParticipant(squid);
  const nickname = localStorage.getItem("round-about:nickname") ?? "";
  const showLobby = (code: string, token: string) => {
    entry.innerHTML =
      '<div class="session-lobby"><h1>Round About</h1><p>Invite: <strong id="inviteCode"></strong></p><p id="lobbyPlayers"></p><p id="connectionStatus">Connecting…</p></div>';
    entry.querySelector<HTMLElement>("#inviteCode")!.textContent = code;
    const status = entry.querySelector<HTMLElement>("#connectionStatus")!;
    const events = new GameEvents(
      { endpoint: eventsEndpoint!, squid: code, token },
      (snapshot) => {
        entry.querySelector<HTMLElement>("#lobbyPlayers")!.textContent =
          snapshot.participants.map((player) => player.nickname).join(", ");
      },
      () => api.snapshot(code, token),
      (connected) => {
        status.textContent = connected ? "Connected" : "Reconnecting…";
      },
      () => {
        sessionStorage.removeItem(`round-about:${code}`);
        status.textContent = "This session has ended.";
      },
    );
    if (eventsEndpoint) void events.connect();
    else status.textContent = "Live updates are not configured.";
  };
  entry.innerHTML = `<form id="sessionForm"><h1>Round About</h1><label>Nickname <input id="nickname" maxlength="24" required /></label><label>Session code <input id="sessionCode" placeholder="Code or invitation link" /></label><div class="session-actions"><button type="submit" name="action" value="host">Host session</button><button type="submit" name="action" value="join">Join session</button></div><p id="sessionError" role="alert"></p></form>`;
  (entry.querySelector("#nickname") as HTMLInputElement).value = nickname;
  (entry.querySelector("#sessionCode") as HTMLInputElement).value = squid;
  if (saved) {
    try {
      await api.snapshot(squid, saved.token);
      showLobby(squid, saved.token);
      return;
    } catch {
      sessionStorage.removeItem(`round-about:${squid}`);
    }
  }
  entry
    .querySelector<HTMLFormElement>("#sessionForm")!
    .addEventListener("submit", async (event) => {
      event.preventDefault();
      const submitter = (event as SubmitEvent).submitter as HTMLButtonElement;
      const name = (
        entry.querySelector("#nickname") as HTMLInputElement
      ).value.trim();
      const message = entry.querySelector<HTMLElement>("#sessionError")!;
      message.textContent = "";
      try {
        const grant =
          submitter.value === "host"
            ? await api.host(name)
            : await api.join(
                normalizeCode(
                  (entry.querySelector("#sessionCode") as HTMLInputElement)
                    .value,
                ),
                name,
              );
        localStorage.setItem("round-about:nickname", name);
        rememberParticipant(grant.snapshot.squid, grant);
        history.replaceState(null, "", `/s/${grant.snapshot.squid}`);
        showLobby(grant.snapshot.squid, grant.token);
      } catch (error) {
        message.textContent = (error as Error).message;
      }
    });
}

void setupSessionEntry();
