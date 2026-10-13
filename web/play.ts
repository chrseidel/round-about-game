import type { CallerSnapshot } from "../shared/protocol.ts";
import { renderBoard } from "./board.ts";
import {
  gapCommand,
  renderTurn,
  revealed,
  turnView,
  type TurnActions,
} from "./turn.ts";
import type { SessionCommand } from "../shared/protocol.ts";

const find = (id: string) => document.getElementById(id)!;

/** Lives shown last time, to animate a life that was just lost. */
let shownLives: number | null = null;

/** Renders header, circle and turn panel for a started session. */
export function renderPlay(
  latest: CallerSnapshot,
  participantId: string,
  draft: string,
  error: string,
  actions: TurnActions & { gap(command: SessionCommand): void },
  serverNow: number,
  lockingGap: number | null,
) {
  // Before the shared reveal this is the pre-lock view; from the target on,
  // the result carried in pendingReveal.
  const snapshot = revealed(latest, serverNow);
  find("roundLabel").textContent =
    `DRAW ${String(snapshot.turn).padStart(2, "0")}`;
  const lives = Math.max(0, snapshot.lives);
  const justLost = shownLives !== null && lives < shownLives;
  shownLives = lives;
  find("lifeText").textContent =
    lives === 0
      ? "OVERTIME"
      : `${lives} ${lives === 1 ? "life" : "lives"} left`;
  const hearts = find("lives");
  hearts.replaceChildren(
    ...Array.from({ length: 3 }, (_, index) => {
      const life = document.createElement("div");
      life.className = `life ${index >= lives ? "lost" : ""} ${justLost && index === lives ? "just-lost" : ""}`;
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
  const canChoose = gapCommand(snapshot, participantId, 0) !== null;
  renderBoard(
    {
      cards: snapshot.cards,
      phase: snapshot.phase,
      selectedGap: snapshot.selectedGap,
      lockedGap:
        lockingGap ?? (snapshot.pendingReveal ? snapshot.selectedGap : null),
      recent:
        snapshot.phase === "result" ? (snapshot.result?.number ?? null) : null,
      clue: snapshot.clue ?? "",
      pile: snapshot.pile,
    },
    canChoose
      ? (index) => {
          const command = gapCommand(snapshot, participantId, index);
          if (command) actions.gap(command);
        }
      : undefined,
  );
  renderTurn(
    turnView(snapshot, participantId, lockingGap !== null),
    draft,
    error,
    actions,
  );
  // The build-up bar fills for exactly the time left until the reveal.
  const fill = document.querySelector<HTMLElement>(".reveal-fill");
  if (fill && !fill.style.animationDuration && snapshot.revealAtUtc !== null)
    fill.style.animationDuration = `${Math.max(0, snapshot.revealAtUtc - serverNow)}ms`;
}
