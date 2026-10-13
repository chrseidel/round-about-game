import {
  SessionApi,
  normalizeCode,
  rememberParticipant,
  storedParticipant,
} from "./session-api.ts";
import { GameEvents } from "./events.ts";
import { LOBBY_HTML, lobbyView, renderLobby } from "./lobby.ts";
import { mergePrivate, secondsLeft } from "./turn.ts";
import { renderPlay } from "./play.ts";
import { clueError } from "../game/rules.ts";
import type { CallerSnapshot, SessionCommand } from "../shared/protocol.ts";

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
  // Without a backend, keep the single-screen prototype playable.
  if (!endpoint) {
    await import("../app.js");
    return;
  }

  const api = new SessionApi({ gameApiUrl: endpoint });
  const entry = document.querySelector<HTMLDivElement>("#sessionEntry")!;
  entry.hidden = false;
  const squid = location.pathname.startsWith("/s/")
    ? location.pathname.slice(3)
    : "";
  const saved = squid && storedParticipant(squid);
  const nickname = localStorage.getItem("round-about:nickname") ?? "";
  const showSession = (
    code: string,
    seat: { participantId: string; token: string },
  ) => {
    entry.innerHTML = LOBBY_HTML;
    const find = (id: string) => entry.querySelector<HTMLElement>(`#${id}`)!;
    find("inviteCode").textContent = code;
    const status = find("connectionStatus");
    document.getElementById("newGameButton")!.hidden = true;
    let latest: CallerSnapshot | null = null;
    let offset = 0;
    let draft = "";
    let error = "";
    const render = () => {
      if (!latest) return;
      if (latest.status === "lobby") {
        renderLobby(entry, lobbyView(latest, seat.participantId));
        return;
      }
      entry.hidden = true;
      renderPlay(latest, seat.participantId, draft, error, {
        draw: () => void send({ type: "DRAW" }),
        send: () => {
          error = clueError(draft, latest!.cards);
          if (error) render();
          else void send({ type: "SUBMIT_CLUE", clue: draft });
        },
        edit: (value) => {
          draft = value;
          error = value.trim() ? clueError(value, latest!.cards) : "";
          render();
        },
      });
      tick();
    };
    // Every snapshot, public or private, goes through mergePrivate so the
    // Tipster's number survives public events for the same card.
    const show = (snapshot: CallerSnapshot) => {
      if (latest && snapshot.turn !== latest.turn) draft = "";
      latest = mergePrivate(latest, snapshot);
      offset = latest.serverTimeUtc - Date.now();
      render();
    };
    const tick = () => {
      const timer = document.getElementById("timerValue");
      if (!timer || !latest) return;
      const seconds = secondsLeft(latest.deadlineUtc, offset, Date.now());
      timer.textContent = `0:${String(seconds).padStart(2, "0")}`;
      timer.classList.toggle("urgent", seconds <= 5);
    };
    setInterval(tick, 200);
    window.addEventListener("resize", render);
    const events = new GameEvents(
      { endpoint: eventsEndpoint!, squid: code, token: seat.token },
      show,
      () => api.snapshot(code, seat.token),
      (connected) => {
        status.textContent = connected ? "Connected" : "Reconnecting…";
      },
      () => {
        sessionStorage.removeItem(`round-about:${code}`);
        status.textContent = "This session has ended.";
        entry.hidden = false;
      },
    );
    const receive = (snapshot: CallerSnapshot) => {
      events.apply(snapshot);
      show(snapshot);
    };
    const send = async (
      command: SessionCommand,
      button?: HTMLButtonElement,
    ) => {
      if (!latest) return;
      const lobbyError = find("commandError");
      lobbyError.textContent = "";
      error = "";
      if (button) button.disabled = true;
      try {
        receive(await api.command(code, seat.token, command, latest));
      } catch (failure) {
        const message = (failure as Error).message;
        if (latest.status === "lobby") lobbyError.textContent = message;
        else error = message;
        const snapshot = (failure as { snapshot?: CallerSnapshot }).snapshot;
        if (snapshot) receive(snapshot);
      } finally {
        if (button) button.disabled = false;
        render();
      }
    };
    const claim = find("claimTipster") as HTMLButtonElement;
    const start = find("startGame") as HTMLButtonElement;
    claim.addEventListener("click", () =>
      send({ type: "CLAIM_TIPSTER" }, claim),
    );
    start.addEventListener("click", () => send({ type: "START" }, start));
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
      showSession(squid, saved);
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
        showSession(grant.snapshot.squid, grant);
      } catch (error) {
        message.textContent = (error as Error).message;
      }
    });
}

void setupSessionEntry();
