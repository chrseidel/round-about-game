// Keep the existing browser game playable while the rule engine moves to game/.
import "../app.js";
import {
  SessionApi,
  normalizeCode,
  rememberParticipant,
  storedParticipant,
} from "./session-api.ts";
import { GameEvents } from "./events.ts";
import { LOBBY_HTML, lobbyView, renderLobby } from "./lobby.ts";
import type { PublicSnapshot, SessionCommand } from "../shared/protocol.ts";

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
  const showLobby = (
    code: string,
    seat: { participantId: string; token: string },
  ) => {
    entry.innerHTML = LOBBY_HTML;
    const find = (id: string) => entry.querySelector<HTMLElement>(`#${id}`)!;
    find("inviteCode").textContent = code;
    const status = find("connectionStatus");
    let latest: PublicSnapshot | null = null;
    const render = () =>
      latest && renderLobby(entry, lobbyView(latest, seat.participantId));
    const events = new GameEvents(
      { endpoint: eventsEndpoint!, squid: code, token: seat.token },
      (snapshot) => {
        latest = snapshot;
        render();
      },
      () => api.snapshot(code, seat.token),
      (connected) => {
        status.textContent = connected ? "Connected" : "Reconnecting…";
      },
      () => {
        sessionStorage.removeItem(`round-about:${code}`);
        status.textContent = "This session has ended.";
      },
    );
    const send = async (button: HTMLButtonElement, command: SessionCommand) => {
      if (!latest) return;
      const error = find("commandError");
      error.textContent = "";
      button.disabled = true;
      try {
        events.apply(await api.command(code, seat.token, command, latest));
      } catch (failure) {
        error.textContent = (failure as Error).message;
        const snapshot = (failure as { snapshot?: PublicSnapshot }).snapshot;
        if (snapshot) events.apply(snapshot);
      } finally {
        button.disabled = false;
        render();
      }
    };
    const claim = find("claimTipster") as HTMLButtonElement;
    const start = find("startGame") as HTMLButtonElement;
    claim.addEventListener("click", () =>
      send(claim, { type: "CLAIM_TIPSTER" }),
    );
    start.addEventListener("click", () => send(start, { type: "START" }));
    find("copyInvite").addEventListener("click", async () => {
      const link = `${location.origin}/s/${code}`;
      try {
        await navigator.clipboard.writeText(link);
        find("copyInvite").textContent = "Copied";
      } catch {
        find("inviteCode").textContent = link;
      }
    });
    if (eventsEndpoint) void events.connect();
    else status.textContent = "Live updates are not configured.";
  };
  entry.innerHTML = `<form id="sessionForm"><h1>Round About</h1><label>Nickname <input id="nickname" maxlength="24" required /></label><label>Session code <input id="sessionCode" placeholder="Code or invitation link" /></label><div class="session-actions"><button type="submit" name="action" value="host">Host session</button><button type="submit" name="action" value="join">Join session</button></div><p id="sessionError" role="alert"></p></form>`;
  (entry.querySelector("#nickname") as HTMLInputElement).value = nickname;
  (entry.querySelector("#sessionCode") as HTMLInputElement).value = squid;
  if (saved) {
    try {
      await api.snapshot(squid, saved.token);
      showLobby(squid, saved);
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
        showLobby(grant.snapshot.squid, grant);
      } catch (error) {
        message.textContent = (error as Error).message;
      }
    });
}

void setupSessionEntry();
