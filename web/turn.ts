import type { CallerSnapshot, SessionCommand } from "../shared/protocol.ts";
import { DIAMOND_SVG } from "./art.ts";

export type TurnView = {
  heading: string;
  description: string;
  mode: "draw" | "write" | "wait" | "join" | "none";
  /** Text of the draw button. */
  drawLabel: string;
  secret: number | null;
  countdown: boolean;
  timerLabel: string;
  clue: string | null;
  /** Server time of a pending shared reveal, for the build-up bar. */
  revealAtUtc: number | null;
  tone: "good" | "bad" | null;
};

/** What the turn panel shows for one participant; the server decides the rules. */
export function turnView(
  snapshot: CallerSnapshot,
  participantId: string,
  locking = false,
): TurnView {
  const isTipster = participantId === snapshot.tipsterId;
  const tipster =
    snapshot.participants.find((player) => player.id === snapshot.tipsterId)
      ?.nickname ?? "The Tipster";
  const view = (
    heading: string,
    description: string,
    mode: TurnView["mode"] = "none",
    timerLabel = "",
  ): TurnView => ({
    heading,
    description,
    mode,
    secret: mode === "write" ? (snapshot.currentDraw ?? null) : null,
    countdown: Boolean(timerLabel) && snapshot.deadlineUtc !== null,
    timerLabel,
    clue: snapshot.clue,
    revealAtUtc: null,
    tone: null,
    drawLabel: snapshot.pile === 0 ? "Draw replacement" : "Draw card",
  });
  const host =
    snapshot.participants.find((player) => player.id === snapshot.hostId)
      ?.nickname ?? "The host";
  if (snapshot.nextSquid)
    return view("New game", `${host} started a new game.`, "join");
  if (snapshot.status === "won")
    return { ...view("You won!", "Last card placed correctly."), tone: "good" };
  if (snapshot.status === "lost")
    return { ...view("Game over", "Overtime ended."), tone: "bad" };
  if (snapshot.pendingReveal) {
    const locker =
      snapshot.lockedBy === participantId
        ? "You"
        : (snapshot.participants.find((p) => p.id === snapshot.lockedBy)
            ?.nickname ?? "The team");
    return {
      ...view("Locked in", `${locker} locked in. Revealing…`),
      revealAtUtc: snapshot.revealAtUtc,
    };
  }
  if (locking) return view("Locking in…", "");
  switch (snapshot.phase) {
    case "ready":
      return isTipster
        ? view("Your turn", "Draw a card when everyone is ready.", "draw")
        : view("Get ready", `Waiting for ${tipster} to draw.`, "wait");
    case "tip":
      return isTipster
        ? view(
            "Your card",
            "Connect the two words around your number. Press Send word in time.",
            "write",
            "Clue time",
          )
        : view(
            "Listen closely",
            `${tipster} is thinking of a word.`,
            "wait",
            "Clue time",
          );
    case "grace":
      return isTipster
        ? view(
            "Last chance",
            "3 seconds to send your word.",
            "write",
            "Final seconds",
          )
        : view("Listen closely", "Last seconds…", "wait", "Final seconds");
    case "guess":
      return isTipster
        ? view(
            "Team is guessing",
            `Your word: ${snapshot.clue}. The team is picking an exit.`,
            "none",
            "Discussion",
          )
        : view(
            "Pick the exit",
            snapshot.selectedGap === null
              ? `The clue is ${snapshot.clue}. Tap an exit to suggest it.`
              : "Tap the blinking exit again to lock it in, or tap another exit.",
            "none",
            "Discussion",
          );
    case "result": {
      // The game goes on: the Tipster draws next, everyone else waits.
      const next = (shown: TurnView): TurnView =>
        isTipster
          ? {
              ...shown,
              mode: "draw",
              drawLabel:
                snapshot.pile === 0 ? "Draw replacement" : "Draw next card",
            }
          : {
              ...shown,
              description: `${shown.description} Waiting for ${tipster} to draw the next card.`,
            };
      const result = snapshot.result;
      if (!result || result.discarded)
        return next(view("Card discarded", "Time ran out."));
      const word = (number?: number) =>
        snapshot.cards.find((card) => card.number === number)?.word ?? "";
      const placed = `${snapshot.clue}: ${result.number} sits between ${word(result.lower)} and ${word(result.upper)}.`;
      const after = result.lost
        ? " Overtime ended."
        : result.correct
          ? ""
          : " Life lost.";
      return next({
        ...view(
          result.correct
            ? "Correct!"
            : result.timedOut
              ? "Time ran out"
              : "Wrong exit",
          placed + after,
        ),
        tone: result.correct ? "good" : "bad",
      });
    }
    default:
      return view("", "");
  }
}

export type IslandView = {
  kind: "logo" | "thinking" | "secret" | "clue";
  title: string;
  text: string;
};

/**
 * What the roundabout's centre island shows. Only the Tipster's own snapshot
 * carries currentDraw, so the secret never reaches a Guesser's island.
 */
export function islandView(
  snapshot: CallerSnapshot,
  participantId: string,
): IslandView {
  const isTipster = participantId === snapshot.tipsterId;
  const tipster =
    snapshot.participants.find((player) => player.id === snapshot.tipsterId)
      ?.nickname ?? "The Tipster";
  const thinking = snapshot.phase === "tip" || snapshot.phase === "grace";
  if (thinking && isTipster && snapshot.currentDraw !== undefined)
    return {
      kind: "secret",
      title: "Your secret number",
      text: String(snapshot.currentDraw),
    };
  if (thinking)
    return {
      kind: "thinking",
      title: `${tipster} is thinking`,
      text: "of a word",
    };
  if (
    snapshot.clue &&
    (snapshot.phase === "guess" || snapshot.phase === "result")
  )
    return {
      kind: "clue",
      title: isTipster ? "Your clue" : `${tipster}'s clue`,
      text: snapshot.clue,
    };
  return { kind: "logo", title: "", text: "" };
}

/** Accessible name of the exit after card `index` (the last one wraps to 0/100). */
export function exitLabel(
  cards: { number: number; word: string }[],
  index: number,
): string {
  const sign = (card: { number: number; word: string }) =>
    `${card.number === 0 ? "0/100" : card.number} ${card.word}`;
  return `Exit between ${sign(cards[index]!)} and ${sign(cards[(index + 1) % cards.length]!)}`;
}

/** Index of the correct exit in the pre-reveal circle, while a reveal is pending. */
export function correctExit(snapshot: CallerSnapshot): number | null {
  const lower = snapshot.pendingReveal?.result.lower;
  if (lower === undefined) return null;
  const index = snapshot.cards.findIndex((card) => card.number === lower);
  return index === -1 ? null : index;
}

/**
 * Keeps the newest snapshot, carrying the Tipster's private number across
 * public events for the same card. The number only arrives in the Tipster's
 * own HTTP responses, which can land after the event with the same version.
 */
export function mergePrivate(
  previous: CallerSnapshot | null,
  next: CallerSnapshot,
): CallerSnapshot {
  if (!previous) return next;
  if (next.version < previous.version) return previous;
  if (
    next.currentDraw === undefined &&
    previous.currentDraw !== undefined &&
    next.turn === previous.turn &&
    (next.phase === "tip" || next.phase === "grace")
  )
    return { ...next, currentDraw: previous.currentDraw };
  return next;
}

/**
 * What a click on a gap means for this player: Guessers choose a gap, and a
 * click on the gap already shown as the team's selection locks it.
 */
export function gapCommand(
  snapshot: CallerSnapshot,
  participantId: string,
  index: number,
): SessionCommand | null {
  if (
    participantId === snapshot.tipsterId ||
    snapshot.phase !== "guess" ||
    snapshot.pendingReveal
  )
    return null;
  return index === snapshot.selectedGap
    ? { type: "LOCK_GAP", index }
    : { type: "CHOOSE_GAP", index };
}

/**
 * What to show at a given server time: before the shared reveal the
 * pre-lock view, from the target on the result carried in pendingReveal.
 */
export function revealed(
  snapshot: CallerSnapshot,
  serverNow: number,
): CallerSnapshot {
  const pending = snapshot.pendingReveal;
  if (
    !pending ||
    snapshot.revealAtUtc === null ||
    serverNow < snapshot.revealAtUtc
  )
    return snapshot;
  return {
    ...snapshot,
    phase: "result",
    cards: pending.cards,
    result: pending.result,
    lives: pending.lives,
    status: pending.status,
    selectedGap: null,
    pendingReveal: null,
  };
}

/**
 * Whether starting a new session interrupts a running game. Uses the
 * revealed state: after a reveal the raw snapshot still says "playing".
 */
export function confirmsNewSession(
  snapshot: CallerSnapshot,
  serverNow: number,
): boolean {
  return revealed(snapshot, serverNow).status === "playing";
}

/** Whole seconds left on the server's clock, given the browser's clock offset. */
export function secondsLeft(
  deadlineUtc: number | null,
  offsetMs: number,
  now: number,
): number {
  if (deadlineUtc === null) return 0;
  return Math.max(0, Math.ceil((deadlineUtc - (now + offsetMs)) / 1000));
}

export type TurnActions = {
  draw(): void;
  join(): void;
  send(): void;
  edit(value: string): void;
};

const find = (id: string) => document.getElementById(id)!;

/**
 * Renders the turn panel. The word field is rebuilt only when the card
 * changes, so typing (focus, caret, draft) survives live updates.
 */
export function renderTurn(
  view: TurnView,
  draft: string,
  error: string,
  actions: TurnActions,
) {
  find("turnHeading").textContent = view.heading;
  if (view.tone) find("turnHeading").dataset.tone = view.tone;
  else delete find("turnHeading").dataset.tone;
  find("turnDescription").textContent = view.description;
  const content = find("turnContent");
  const key = `${view.mode}:${view.secret ?? ""}:${view.timerLabel}:${view.revealAtUtc ?? ""}:${view.drawLabel}:${view.clue ?? ""}`;
  if (content.dataset.key !== key) {
    content.dataset.key = key;
    content.replaceChildren();
    if (view.revealAtUtc !== null) {
      const bar = element("div", "reveal-progress");
      bar.append(element("div", "reveal-fill"));
      content.append(bar);
    }
    // Phones: the island is too narrow, so the secret and the clue show here.
    if (view.secret !== null) {
      const secret = element("div", "panel-secret narrow-only");
      const diamond = element("span", "secret-diamond");
      diamond.innerHTML = DIAMOND_SVG;
      diamond.append(element("span", "secret-number", String(view.secret)));
      secret.append(
        diamond,
        element("span", "", "Your secret number. Only you see it."),
      );
      content.append(secret);
    } else if (view.clue && view.mode !== "join") {
      const clue = element("p", "panel-clue narrow-only", "Clue: ");
      clue.append(element("strong", "", view.clue));
      content.append(clue);
    }
    if (view.mode === "draw") {
      const button = element("button", "button primary", view.drawLabel);
      button.id = "drawButton";
      button.addEventListener("click", actions.draw);
      content.append(button);
    }
    if (view.mode === "join") {
      const button = element("button", "button primary", "Join");
      button.id = "joinButton";
      button.addEventListener("click", actions.join);
      content.append(button);
    }
    if (view.countdown) {
      // The secret number itself sits on the roundabout's island.
      const row = element("div", "timer-row");
      row.id = "timerRow";
      const light = element("span", "traffic-light");
      light.setAttribute("aria-hidden", "true");
      light.append(
        element("span", "lamp red"),
        element("span", "lamp amber"),
        element("span", "lamp green"),
      );
      const value = element("span", "timer-value", "");
      value.id = "timerValue";
      row.append(light, element("span", "timer-label", view.timerLabel), value);
      content.append(row);
    }
    if (view.mode === "write") {
      const label = element("label", "field-label", "Your one-word clue");
      label.setAttribute("for", "clueInput");
      const input = document.createElement("input");
      input.className = "clue-input";
      input.id = "clueInput";
      input.maxLength = 40;
      input.placeholder = "Only you see what you type";
      input.autocomplete = "off";
      input.value = draft;
      input.addEventListener("input", () => actions.edit(input.value));
      const note = element("p", "stage-note", "");
      note.id = "clueNote";
      note.setAttribute("role", "alert");
      const send = element("button", "button primary", "Send word");
      send.id = "sayButton";
      send.addEventListener("click", actions.send);
      content.append(label, input, note, send);
    } else {
      // Command errors (e.g. a stale lock) show here outside the word field.
      const note = element("p", "stage-note", "");
      note.id = "clueNote";
      note.setAttribute("role", "alert");
      content.append(note);
    }
  }
  const note = document.getElementById("clueNote");
  if (note) note.textContent = error;
  document
    .getElementById("clueInput")
    ?.setAttribute("aria-invalid", String(Boolean(error)));
}

function element(tag: string, className: string, text?: string) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  if (tag === "button") (node as HTMLButtonElement).type = "button";
  return node;
}
