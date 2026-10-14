import {
  codeFromPath,
  SessionApi,
  normalizeCode,
  rememberParticipant,
  storedParticipant,
} from "./session-api.ts";
import { GameEvents } from "./events.ts";
import {
  ENTRY_HTML,
  LOBBY_HTML,
  NO_SERVER_HTML,
  lobbyView,
  renderLobby,
} from "./lobby.ts";
import {
  catchUpDue,
  confirmsNewSession,
  mergePrivate,
  secondsLeft,
} from "./turn.ts";
import { renderPlay } from "./play.ts";
import { showEntry, showLobby } from "./scene.ts";
import { setupHowTo } from "./how-to.ts";
import { clueError } from "../game/rules.ts";
import type {
  CallerSnapshot,
  Language,
  ParticipantGrant,
  SessionCommand,
} from "../shared/protocol.ts";

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
  const entry = document.querySelector<HTMLDivElement>("#sessionEntry")!;
  entry.hidden = false;
  showEntry();
  if (!endpoint) {
    entry.innerHTML = NO_SERVER_HTML;
    return;
  }

  const api = new SessionApi({ gameApiUrl: endpoint });
  const squid = codeFromPath(location.pathname);
  const saved = squid && storedParticipant(squid);
  const nickname = localStorage.getItem("round-about:nickname") ?? "";
  let leaveCurrent = () => {};
  /** Leaves the current session and opens another one with a fresh seat. */
  const switchTo = (grant: ParticipantGrant) => {
    leaveCurrent();
    const next = grant.snapshot.squid;
    rememberParticipant(next, grant);
    history.replaceState(null, "", `/s/${next}`);
    entry.hidden = false;
    leaveCurrent = showSession(next, grant);
  };
  const showSession = (
    code: string,
    seat: { participantId: string; token: string },
  ): (() => void) => {
    entry.innerHTML = LOBBY_HTML;
    // A new session starts in the lobby view: the old board must not linger
    // (or stay clickable) under the new lobby.
    showLobby([]);
    const find = (id: string) => entry.querySelector<HTMLElement>(`#${id}`)!;
    find("inviteCode").textContent = code;
    const status = find("connectionStatus");
    const newGame = document.getElementById("newGameButton")!;
    const confirm = document.getElementById(
      "confirmDialog",
    ) as HTMLDialogElement;
    newGame.hidden = true;
    let latest: CallerSnapshot | null = null;
    let offset = 0;
    let draft = "";
    let error = "";
    let gapInFlight = false;
    let lockingGap: number | null = null;
    let revealTimer: ReturnType<typeof setTimeout> | undefined;
    let sawLobby = false;
    let starting = false;
    const render = () => {
      if (!latest) return;
      newGame.hidden =
        latest.hostId !== seat.participantId || Boolean(latest.nextSquid);
      if (latest.status === "lobby" && !latest.nextSquid) {
        sawLobby = true;
        renderLobby(entry, lobbyView(latest, seat.participantId));
        return;
      }
      // Players who watched the lobby see the light turn green and the
      // camera swing overhead; everyone else goes straight to the board.
      const lobby = entry.querySelector(".lobby");
      const animate = sawLobby && !entry.hidden && Boolean(lobby) && !starting;
      if (animate) {
        starting = true;
        lobby!.classList.add("starting");
      } else if (!starting) entry.hidden = true;
      const serverNow = Date.now() + offset;
      // Re-render exactly when the shared reveal is due.
      clearTimeout(revealTimer);
      if (
        latest.pendingReveal &&
        latest.revealAtUtc !== null &&
        serverNow < latest.revealAtUtc
      )
        revealTimer = setTimeout(render, latest.revealAtUtc - serverNow);
      renderPlay(
        latest,
        seat.participantId,
        draft,
        error,
        {
          draw: () => void send({ type: "DRAW" }),
          join: () => void join(),
          send: () => {
            error = clueError(draft, latest!.cards);
            if (error) render();
            else void send({ type: "SUBMIT_CLUE", clue: draft });
          },
          gap: (command) => {
            // One gap command at a time; the next click uses the confirmed state.
            if (gapInFlight) return;
            gapInFlight = true;
            // Show the locked look in the same frame as the tap.
            if (command.type === "LOCK_GAP") {
              lockingGap = command.index;
              render();
            }
            void send(command).finally(() => {
              gapInFlight = false;
              lockingGap = null;
              render();
            });
          },
          edit: (value) => {
            draft = value;
            error = value.trim() ? clueError(value, latest!.cards) : "";
            render();
          },
        },
        serverNow,
        lockingGap,
        {
          animate,
          done: () => {
            entry.hidden = true;
            sawLobby = false;
            starting = false;
          },
        },
      );
      tick();
    };
    // Every snapshot, public or private, goes through mergePrivate so the
    // Tipster's number survives public events for the same card.
    // When the last snapshot arrived, and the deadline already caught up on.
    let lastUpdateAt = Date.now();
    let caughtUpDeadline: number | null = null;
    const show = (snapshot: CallerSnapshot) => {
      lastUpdateAt = Date.now();
      if (latest && snapshot.turn !== latest.turn) draft = "";
      latest = mergePrivate(latest, snapshot);
      offset = latest.serverTimeUtc - Date.now();
      render();
    };
    const tick = () => {
      // Safety net for live events a sleeping phone missed.
      if (latest && document.visibilityState === "visible") {
        const due = catchUpDue(
          latest,
          Date.now() + offset,
          Date.now() - lastUpdateAt,
          caughtUpDeadline,
        );
        if (due === "deadline") caughtUpDeadline = latest.deadlineUtc;
        if (due) {
          lastUpdateAt = Date.now();
          events.catchUpNow();
        }
      }
      const timer = document.getElementById("timerValue");
      if (!timer || !latest) return;
      const seconds = secondsLeft(latest.deadlineUtc, offset, Date.now());
      timer.textContent = `0:${String(seconds).padStart(2, "0")}`;
      timer.classList.toggle("urgent", seconds <= 5);
      document.getElementById("timerRow")!.dataset.light =
        seconds > 10 ? "green" : seconds > 5 ? "amber" : "red";
    };
    const ticker = setInterval(tick, 200);
    window.addEventListener("resize", render);
    // Back from a locked screen, another app or a dead network: catch up now.
    const resume = () => {
      if (document.visibilityState === "visible") events.resume();
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("pageshow", resume);
    window.addEventListener("online", resume);
    const events = new GameEvents(
      { endpoint: eventsEndpoint!, squid: code, token: seat.token },
      show,
      () => api.snapshot(code, seat.token),
      (connected) => {
        status.textContent = connected ? "Connected" : "Reconnecting…";
        document.getElementById("liveBadge")!.hidden = connected;
      },
      () => {
        sessionStorage.removeItem(`round-about:${code}`);
        status.textContent = "This session has ended.";
        entry.hidden = false;
        showLobby([]);
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
    // Follow the host to the session the old one points to.
    const join = async () => {
      const me = latest?.participants.find((p) => p.id === seat.participantId);
      if (!latest?.nextSquid || !me) return;
      try {
        switchTo(await api.join(latest.nextSquid, me.nickname));
      } catch (failure) {
        error = (failure as Error).message;
        render();
      }
    };
    const startNewSession = async () => {
      try {
        switchTo(await api.newSession(code, seat.token));
      } catch (failure) {
        error = (failure as Error).message;
        render();
      }
    };
    // Assigned (not added) so a later session replaces these handlers.
    newGame.onclick = () => {
      if (latest && confirmsNewSession(latest, Date.now() + offset))
        confirm.showModal();
      else void startNewSession();
    };
    confirm.onclose = () => {
      if (confirm.returnValue === "confirm") void startNewSession();
    };
    if (eventsEndpoint) void events.connect();
    else status.textContent = "Live updates are not configured.";
    return () => {
      events.close();
      clearInterval(ticker);
      clearTimeout(revealTimer);
      window.removeEventListener("resize", render);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("pageshow", resume);
      window.removeEventListener("online", resume);
      document.getElementById("liveBadge")!.hidden = true;
    };
  };
  entry.innerHTML = ENTRY_HTML;
  const openHowTo = setupHowTo(
    document.getElementById("howToDialog") as HTMLDialogElement,
  );
  entry.querySelector("#howToButton")!.addEventListener("click", openHowTo);
  (entry.querySelector("#nickname") as HTMLInputElement).value = nickname;
  // Starting-word language: the last choice, else the browser's language.
  const language =
    localStorage.getItem("round-about:language") ??
    (navigator.language.toLowerCase().startsWith("de") ? "de" : "en");
  entry.querySelector<HTMLInputElement>(
    `input[name="language"][value="${language === "de" ? "de" : "en"}"]`,
  )!.checked = true;
  (entry.querySelector("#sessionCode") as HTMLInputElement).value = squid;
  if (saved) {
    try {
      await api.snapshot(squid, saved.token);
      leaveCurrent = showSession(squid, saved);
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
            ? await api.host(name, chosenLanguage())
            : await api.join(
                normalizeCode(
                  (entry.querySelector("#sessionCode") as HTMLInputElement)
                    .value,
                ),
                name,
              );
        localStorage.setItem("round-about:nickname", name);
        if (submitter.value === "host")
          localStorage.setItem("round-about:language", chosenLanguage());
        switchTo(grant);
      } catch (error) {
        message.textContent = (error as Error).message;
      }
    });
}

/** The starting-word language picked on the entry form. */
function chosenLanguage(): Language {
  return document.querySelector<HTMLInputElement>(
    'input[name="language"]:checked',
  )?.value === "de"
    ? "de"
    : "en";
}

void setupSessionEntry();
