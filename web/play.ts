import type { CallerSnapshot } from "../shared/protocol.ts";
import { renderBoard } from "./board.ts";
import { renderTurn, turnView, type TurnActions } from "./turn.ts";

const find = (id: string) => document.getElementById(id)!;

/** Renders header, circle and turn panel for a started session. */
export function renderPlay(
  snapshot: CallerSnapshot,
  participantId: string,
  draft: string,
  error: string,
  actions: TurnActions,
) {
  find("roundLabel").textContent =
    `DRAW ${String(snapshot.turn).padStart(2, "0")}`;
  const lives = Math.max(0, snapshot.lives);
  find("lifeText").textContent =
    lives === 0
      ? "OVERTIME"
      : `${lives} ${lives === 1 ? "life" : "lives"} left`;
  const hearts = find("lives");
  hearts.replaceChildren(
    ...Array.from({ length: 3 }, (_, index) => {
      const life = document.createElement("div");
      life.className = `life ${index >= lives ? "lost" : ""}`;
      life.textContent = index >= lives ? "×" : "♥";
      return life;
    }),
  );
  hearts.setAttribute(
    "aria-label",
    lives === 0
      ? "Overtime: one wrong answer ends the game"
      : `${lives} lives remaining`,
  );
  renderBoard({
    cards: snapshot.cards,
    phase: snapshot.phase,
    selectedGap: snapshot.selectedGap,
    recent: null,
    clue: snapshot.clue ?? "",
    pile: snapshot.pile,
  });
  renderTurn(turnView(snapshot, participantId), draft, error, actions);
}
