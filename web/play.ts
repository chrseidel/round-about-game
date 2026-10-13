import type { CallerSnapshot } from "../shared/protocol.ts";
import { CONE_SVG } from "./art.ts";
import { renderBoard } from "./board.ts";
import {
  correctExit,
  exitLabel,
  gapCommand,
  islandView,
  renderTurn,
  revealed,
  turnView,
  type TurnActions,
} from "./turn.ts";
import type { SessionCommand } from "../shared/protocol.ts";

const find = (id: string) => document.getElementById(id)!;

/** Lives shown last time, to tip over a cone for a life that was just lost. */
let shownLives: number | null = null;

/** Renders header, roundabout and turn panel for a started session. */
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
  find("roundLabel").textContent = `Draw ${snapshot.turn}`;
  find("pileCount").textContent =
    snapshot.pile === 0
      ? "No cards left"
      : `${snapshot.pile} ${snapshot.pile === 1 ? "card" : "cards"} to go`;
  const lives = Math.max(0, snapshot.lives);
  const overtime = lives === 0 && snapshot.status === "playing";
  const justLost = shownLives !== null && lives < shownLives;
  shownLives = lives;
  find("lifeText").textContent = overtime ? "Overtime" : "Lives";
  document.querySelector(".play-panel")!.classList.toggle("overtime", overtime);
  const cones = find("lives");
  cones.replaceChildren(
    ...Array.from({ length: 3 }, (_, index) => {
      const cone = document.createElement("span");
      cone.className = `life ${index >= lives ? "lost" : ""} ${justLost && index === lives ? "just-lost" : ""}`;
      cone.innerHTML = CONE_SVG;
      return cone;
    }),
  );
  cones.setAttribute(
    "aria-label",
    lives === 0
      ? "Overtime: one more miss ends the game"
      : `${lives} of 3 lives left`,
  );
  const canChoose = gapCommand(snapshot, participantId, 0) !== null;
  const lockedGap =
    lockingGap ?? (snapshot.pendingReveal ? snapshot.selectedGap : null);
  const to = snapshot.pendingReveal ? correctExit(snapshot) : null;
  renderBoard(
    {
      cards: snapshot.cards,
      phase: snapshot.phase,
      selectedGap: snapshot.selectedGap,
      lockedGap,
      recent:
        snapshot.phase === "result" ? (snapshot.result?.number ?? null) : null,
      island: islandView(snapshot, participantId),
      overtime,
      exitLabels: snapshot.cards.map((_, index) =>
        exitLabel(snapshot.cards, index),
      ),
    },
    canChoose
      ? (index) => {
          const command = gapCommand(snapshot, participantId, index);
          if (command) actions.gap(command);
        }
      : undefined,
    lockedGap !== null && to !== null && snapshot.revealAtUtc !== null
      ? {
          from: lockedGap,
          to,
          revealAtUtc: snapshot.revealAtUtc,
          durationMs: snapshot.revealAtUtc - serverNow,
        }
      : null,
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
