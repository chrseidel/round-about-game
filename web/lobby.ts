import type { PublicSnapshot } from "../shared/protocol.ts";
import { DIAMOND_SVG } from "./art.ts";
import { showLobby } from "./scene.ts";

export type LobbyCar = {
  id: string;
  name: string;
  host: boolean;
  tipster: boolean;
  you: boolean;
};

export type LobbyView = {
  /** One car per player on the roundabout, in join order. */
  cars: LobbyCar[];
  tipsterTitle: string;
  tipsterText: string;
  canClaim: boolean;
  showStart: boolean;
  canStart: boolean;
  /** A Tipster and a Guesser are present: the traffic light is green. */
  ready: boolean;
  startHint: string;
  started: string | null;
};

/** What the lobby shows for one participant; the server re-checks every rule. */
export function lobbyView(
  snapshot: PublicSnapshot,
  participantId: string,
): LobbyView {
  const inLobby = snapshot.status === "lobby";
  const isHost = snapshot.hostId === participantId;
  const players = snapshot.participants;
  const tipster = players.find((player) => player.id === snapshot.tipsterId);
  const host =
    players.find((player) => player.id === snapshot.hostId)?.nickname ??
    "The host";
  const ready = Boolean(tipster) && players.length >= 2;
  const startHint = !inLobby
    ? ""
    : isHost
      ? !tipster
        ? "Someone needs to be the Tipster first."
        : players.length < 2
          ? "At least one Guesser needs to join first."
          : `${players.length} players on the road. Late arrivals join as Guessers.`
      : !tipster
        ? `${host} starts the game once someone takes the Tipster seat.`
        : players.length < 2
          ? `${host} starts the game once a Guesser joins.`
          : `Waiting for ${host} to start the game.`;
  return {
    cars: players.map((player) => ({
      id: player.id,
      name: player.nickname,
      host: player.id === snapshot.hostId,
      tipster: player.id === snapshot.tipsterId,
      you: player.id === participantId,
    })),
    tipsterTitle: !tipster
      ? "Nobody is the Tipster yet"
      : tipster.id === participantId
        ? "You are the Tipster"
        : `${tipster.nickname} is the Tipster`,
    tipsterText: !tipster
      ? "The Tipster sees the secret numbers and gives the clues."
      : tipster.id === participantId
        ? "You see the secret numbers and give one-word clues. Everyone else guesses."
        : `${tipster.nickname} sees the secret numbers and gives one-word clues. Everyone else guesses.`,
    canClaim: inLobby && !snapshot.tipsterId,
    showStart: isHost && inLobby,
    canStart: isHost && inLobby && ready,
    ready,
    startHint,
    started:
      snapshot.status === "playing" && tipster
        ? `Game started. ${tipster.nickname} is the Tipster.`
        : null,
  };
}

export const LOBBY_HTML =
  '<div class="lobby">' +
  '<div class="scene-spot" aria-hidden="true"></div>' +
  '<div class="lobby-side">' +
  '<section class="window window-blue invite" aria-label="Invite">' +
  '<p class="window-label">Invite friends with this code</p>' +
  '<p class="invite-code" id="inviteCode"></p>' +
  '<button id="copyInvite" class="button light" type="button">Copy invite link</button></section>' +
  '<section class="window tipster-window" aria-label="Tipster">' +
  `<div class="tipster-row"><span class="diamond-badge">${DIAMOND_SVG}<span>?</span></span>` +
  '<p class="window-title" id="tipsterTitle"></p></div>' +
  '<p class="window-text" id="tipsterText"></p>' +
  '<button id="claimTipster" class="button amber" type="button" hidden>Be the Tipster</button></section>' +
  '<section class="window start-window" aria-label="Start">' +
  '<div class="traffic-light" id="lobbyLight" aria-hidden="true"><span class="lamp red"></span><span class="lamp amber"></span><span class="lamp green"></span></div>' +
  '<div class="start-body"><button id="startGame" class="button go" type="button" hidden>Start game</button>' +
  '<p class="window-text" id="startHint"></p></div></section>' +
  '<p id="commandError" class="command-error" role="alert"></p>' +
  '<ul class="sr-only" id="lobbyPlayers" aria-label="Players"></ul>' +
  '<p id="lobbyStarted" hidden></p>' +
  '<p class="connection" id="connectionStatus">Connecting…</p>' +
  "</div></div>";

/** The first screen: nickname, game code, host or join. */
export const ENTRY_HTML =
  '<form id="sessionForm" class="lobby entry">' +
  '<div class="scene-spot" aria-hidden="true"></div>' +
  '<div class="lobby-side">' +
  '<h1 class="title">Round About</h1>' +
  '<div class="window entry-form">' +
  '<p class="window-text">A word game for friends on a video call: one player gives clues, everyone else picks the exit.</p>' +
  '<label>Nickname<input id="nickname" maxlength="24" required autocomplete="nickname" /></label>' +
  '<label>Game code<input id="sessionCode" placeholder="Code or invite link" autocomplete="off" /></label>' +
  '<div class="session-actions"><button class="button primary" type="submit" name="action" value="host">Host a game</button>' +
  '<button class="button light" type="submit" name="action" value="join">Join a game</button></div>' +
  '<p id="sessionError" class="command-error" role="alert"></p></div></div></form>';

/** Shown when the page has no game server to talk to. */
export const NO_SERVER_HTML =
  '<div class="lobby entry">' +
  '<div class="scene-spot" aria-hidden="true"></div>' +
  '<div class="lobby-side"><h1 class="title">Round About</h1>' +
  '<div class="window"><p class="window-title">No game server is configured</p>' +
  '<p class="window-text">This copy of the game cannot reach a backend. For local development, deploy a sandbox with <code>npx ampx sandbox</code>.</p></div></div></div>';

/** Updates the lobby markup in place; text goes through textContent only. */
export function renderLobby(root: HTMLElement, view: LobbyView) {
  const find = (id: string) => root.querySelector<HTMLElement>(`#${id}`)!;
  showLobby(
    view.cars.map((car) => ({
      id: car.id,
      name: car.name,
      tipster: car.tipster,
      you: car.you,
    })),
  );
  find("lobbyPlayers").replaceChildren(
    ...view.cars.map((car) => {
      const item = document.createElement("li");
      const marks = [
        car.host && "host",
        car.tipster && "Tipster",
        car.you && "you",
      ].filter(Boolean);
      item.textContent = marks.length
        ? `${car.name} (${marks.join(", ")})`
        : car.name;
      return item;
    }),
  );
  find("tipsterTitle").textContent = view.tipsterTitle;
  find("tipsterText").textContent = view.tipsterText;
  find("lobbyStarted").textContent = view.started ?? "";
  find("lobbyStarted").hidden = !view.started;
  find("claimTipster").hidden = !view.canClaim;
  find("startGame").hidden = !view.showStart;
  (find("startGame") as HTMLButtonElement).disabled = !view.canStart;
  find("startHint").textContent = view.startHint;
  find("lobbyLight").dataset.light = view.ready ? "green" : "red";
}
