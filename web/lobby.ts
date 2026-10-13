import type { PublicSnapshot } from "../shared/protocol.ts";
import { CAR_COLORS, SIGN_SVG, TIPSTER_CAR, carSvg } from "./art.ts";

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

/** The lobby's roundabout: road, painted name and the sign on the island. */
const LOBBY_RING =
  '<div class="lobby-ring">' +
  '<svg class="lobby-road" viewBox="0 0 600 600" aria-hidden="true">' +
  '<rect x="-400" y="264" width="1400" height="72" class="road-fill"/>' +
  '<rect x="264" y="-400" width="72" height="1400" class="road-fill"/>' +
  '<circle cx="300" cy="300" r="262" class="road-surface" stroke-width="76"/>' +
  '<circle cx="300" cy="300" r="298" class="road-edge"/>' +
  '<circle cx="300" cy="300" r="262" class="lane-marking"/>' +
  '<circle cx="300" cy="300" r="222" class="island-grass"/>' +
  '<circle cx="300" cy="300" r="224" class="kerb kerb-white"/>' +
  '<circle cx="300" cy="300" r="224" class="kerb kerb-red"/>' +
  '<defs><path id="islandText" d="M 300 300 m -178 0 a 178 178 0 1 1 356 0 a 178 178 0 1 1 -356 0"/></defs>' +
  '<text class="painted"><textPath href="#islandText" startOffset="2%">ROUND ABOUT</textPath></text>' +
  '<text class="painted"><textPath href="#islandText" startOffset="52%">ROUND ABOUT</textPath></text>' +
  "</svg>" +
  `<div class="lobby-sign">${SIGN_SVG}</div>` +
  '<div class="cars" id="lobbyCars"></div></div>';

export const LOBBY_HTML =
  '<div class="lobby">' +
  LOBBY_RING +
  '<div class="lobby-side">' +
  '<section class="sign sign-blue invite" aria-label="Invite">' +
  '<div class="sign-inner"><p class="sign-label">Invite friends with this code</p>' +
  '<p class="invite-code" id="inviteCode"></p>' +
  '<button id="copyInvite" class="button light" type="button">Copy invite link</button></div></section>' +
  '<section class="sign sign-white tipster-sign" aria-label="Tipster">' +
  '<div class="tipster-row"><svg class="diamond" viewBox="0 0 54 54" aria-hidden="true"><polygon points="27,3 51,27 27,51 3,27"/><text x="27" y="34" text-anchor="middle">?</text></svg>' +
  '<div><p class="sign-title" id="tipsterTitle"></p><p class="sign-text" id="tipsterText"></p></div></div>' +
  '<button id="claimTipster" class="button amber" type="button" hidden>Be the Tipster</button></section>' +
  '<section class="sign sign-white start-sign" aria-label="Start">' +
  '<div class="traffic-light" id="lobbyLight" aria-hidden="true"><span class="lamp red"></span><span class="lamp amber"></span><span class="lamp green"></span></div>' +
  '<div class="start-body"><button id="startGame" class="button go" type="button" hidden>Start game</button>' +
  '<p class="sign-text" id="startHint"></p></div></section>' +
  '<p id="commandError" class="command-error" role="alert"></p>' +
  '<ul class="sr-only" id="lobbyPlayers" aria-label="Players"></ul>' +
  '<p id="lobbyStarted" hidden></p>' +
  '<p class="connection" id="connectionStatus">Connecting…</p>' +
  "</div></div>";

/** The first screen: nickname, game code, host or join. */
export const ENTRY_HTML =
  '<form id="sessionForm" class="entry">' +
  `<div class="entry-logo">${SIGN_SVG}<h1>Round About</h1></div>` +
  '<div class="sign sign-white entry-form">' +
  '<p class="sign-text">A word game for friends on a video call: one player gives clues, everyone else picks the exit.</p>' +
  '<label>Nickname<input id="nickname" maxlength="24" required autocomplete="nickname" /></label>' +
  '<label>Game code<input id="sessionCode" placeholder="Code or invite link" autocomplete="off" /></label>' +
  '<div class="session-actions"><button class="button primary" type="submit" name="action" value="host">Host a game</button>' +
  '<button class="button light" type="submit" name="action" value="join">Join a game</button></div>' +
  '<p id="sessionError" class="command-error" role="alert"></p></div></form>';

/** Shown when the page has no game server to talk to. */
export const NO_SERVER_HTML =
  '<div class="entry">' +
  `<div class="entry-logo">${SIGN_SVG}<h1>Round About</h1></div>` +
  '<div class="sign sign-white entry-form"><p class="sign-title">No game server is configured</p>' +
  '<p class="sign-text">This copy of the game cannot reach a backend. For local development, deploy a sandbox with <code>npx ampx sandbox</code>.</p></div></div>';

/** One lap of the lobby's cars; name tags counter-rotate in step. */
const LAP_MS = 48_000;
/** When the cars started circling, so a rebuilt ring continues the drive. */
const drivingSince = performance.now();

/** Updates the lobby markup in place; text goes through textContent only. */
export function renderLobby(root: HTMLElement, view: LobbyView) {
  const find = (id: string) => root.querySelector<HTMLElement>(`#${id}`)!;
  renderCars(find("lobbyCars"), view.cars);
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

/** Rebuilds the cars only when the players change, so the drive never jumps. */
function renderCars(container: HTMLElement, cars: LobbyCar[]) {
  const key = cars
    .map((car) => `${car.id}:${car.name}:${car.tipster}:${car.you}`)
    .join("|");
  if (container.dataset.key === key) return;
  const known = new Set((container.dataset.ids ?? "").split(" "));
  const firstRender = container.dataset.key === undefined;
  container.dataset.key = key;
  container.dataset.ids = cars.map((car) => car.id).join(" ");
  // The ring and its name tags are rebuilt together with the same offset,
  // so the tags' counter-rotation always matches the drive.
  const delay = `-${(performance.now() - drivingSince) % LAP_MS}ms`;
  const orbit = document.createElement("div");
  orbit.className = "orbit";
  orbit.style.animationDelay = delay;
  container.replaceChildren(orbit);
  orbit.append(
    ...cars.map((car, index) => {
      const angle = (index * 360) / Math.max(cars.length, 1) + 25;
      const place = document.createElement("div");
      place.className = "car";
      place.style.setProperty("--angle", `${angle}deg`);
      const body = document.createElement("div");
      body.className = `car-body ${!firstRender && !known.has(car.id) ? "arriving" : ""}`;
      body.innerHTML = carSvg(
        car.tipster ? TIPSTER_CAR : CAR_COLORS[index % CAR_COLORS.length]!,
        car.tipster,
      );
      const upright = document.createElement("div");
      upright.className = "upright";
      upright.style.animationDelay = delay;
      const tag = document.createElement("span");
      tag.className = `name-tag ${car.you ? "you" : ""}`;
      tag.textContent = car.tipster ? `${car.name} (Tipster)` : car.name;
      upright.append(tag);
      const label = document.createElement("div");
      label.className = "car-label";
      label.append(upright);
      place.append(body, label);
      return place;
    }),
  );
}
