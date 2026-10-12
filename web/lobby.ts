import type { PublicSnapshot } from "../shared/protocol.ts";

export type LobbyView = {
  players: string;
  canClaim: boolean;
  showStart: boolean;
  canStart: boolean;
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
  const tipster = snapshot.participants.find(
    (player) => player.id === snapshot.tipsterId,
  );
  const startHint =
    !isHost || !inLobby
      ? ""
      : !tipster
        ? "Someone needs to be the Tipster first."
        : snapshot.participants.length < 2
          ? "At least one Guesser needs to join first."
          : "";
  return {
    players: snapshot.participants
      .map((player) => {
        const marks = [
          player.id === snapshot.hostId && "host",
          player.id === snapshot.tipsterId && "Tipster",
          player.id === participantId && "you",
        ].filter(Boolean);
        return marks.length
          ? `${player.nickname} (${marks.join(", ")})`
          : player.nickname;
      })
      .join(" · "),
    canClaim: inLobby && !snapshot.tipsterId,
    showStart: isHost && inLobby,
    canStart: isHost && inLobby && !startHint,
    startHint,
    started:
      snapshot.status === "playing" && tipster
        ? `Game started. ${tipster.nickname} is the Tipster.`
        : null,
  };
}

export const LOBBY_HTML =
  '<div class="session-lobby"><h1>Round About</h1>' +
  '<p>Invite: <strong id="inviteCode"></strong> <button id="copyInvite" type="button">Copy invite link</button></p>' +
  '<p id="lobbyPlayers"></p><p id="lobbyStarted" hidden></p>' +
  '<div class="session-actions"><button id="claimTipster" type="button" hidden>Be the Tipster</button>' +
  '<button id="startGame" type="button" hidden>Start game</button></div>' +
  '<p id="startHint"></p><p id="commandError" role="alert"></p>' +
  '<p id="connectionStatus">Connecting…</p></div>';

/** Updates the lobby markup in place; text goes through textContent only. */
export function renderLobby(root: HTMLElement, view: LobbyView) {
  const find = (id: string) => root.querySelector<HTMLElement>(`#${id}`)!;
  find("lobbyPlayers").textContent = view.players;
  find("lobbyStarted").textContent = view.started ?? "";
  find("lobbyStarted").hidden = !view.started;
  find("claimTipster").hidden = !view.canClaim;
  find("startGame").hidden = !view.showStart;
  (find("startGame") as HTMLButtonElement).disabled = !view.canStart;
  find("startHint").textContent = view.startHint;
}
