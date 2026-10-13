import type { CallerSnapshot, SessionCommand } from "../shared/protocol.ts";

export type TurnView = {
  heading: string;
  description: string;
  mode: "draw" | "write" | "wait" | "none";
  secret: number | null;
  countdown: boolean;
  timerLabel: string;
  clue: string | null;
};

/** What the turn panel shows for one participant; the server decides the rules. */
export function turnView(
  snapshot: CallerSnapshot,
  participantId: string,
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
  });
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
            "CLUE TIME",
          )
        : view(
            "Listen closely",
            `${tipster} is thinking of a word.`,
            "wait",
            "CLUE TIME",
          );
    case "grace":
      return isTipster
        ? view(
            "Last chance",
            "3 seconds to send your word.",
            "write",
            "FINAL SECONDS",
          )
        : view("Listen closely", "Last seconds…", "wait", "FINAL SECONDS");
    case "guess":
      return isTipster
        ? view(
            "Team is guessing",
            `Your word: ${snapshot.clue}. The team is guessing.`,
            "none",
            "DISCUSSION",
          )
        : view(
            "Choose a gap.",
            snapshot.selectedGap === null
              ? `The word is ${snapshot.clue}.`
              : "Tap ⌛ again to lock it in.",
            "none",
            "DISCUSSION",
          );
    case "result": {
      const result = snapshot.result;
      if (!result || result.discarded)
        return view("Card discarded", "Time ran out.");
      const word = (number?: number) =>
        snapshot.cards.find((card) => card.number === number)?.word ?? "";
      const placed = `${snapshot.clue} · ${result.number} sits between ${word(result.lower)} and ${word(result.upper)}.`;
      const after = result.lost
        ? " Overtime ended."
        : result.correct
          ? ""
          : " Life lost.";
      return view(
        result.correct
          ? "Correct!"
          : result.timedOut
            ? "Time ran out"
            : "Wrong gap",
        placed + after,
      );
    }
    default:
      return view("", "");
  }
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
  if (participantId === snapshot.tipsterId || snapshot.phase !== "guess")
    return null;
  return index === snapshot.selectedGap
    ? { type: "LOCK_GAP", index }
    : { type: "CHOOSE_GAP", index };
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
  find("turnDescription").textContent = view.description;
  const content = find("turnContent");
  const key = `${view.mode}:${view.secret ?? ""}:${view.timerLabel}`;
  if (content.dataset.key !== key) {
    content.dataset.key = key;
    content.replaceChildren();
    if (view.mode === "draw") {
      const button = element("button", "button primary", "Draw card");
      button.id = "drawButton";
      button.addEventListener("click", actions.draw);
      content.append(button);
    }
    if (view.mode === "write") {
      const card = element("div", "secret-card");
      card.append(
        element("span", "secret-label", "TIPSTER ONLY"),
        element("span", "secret-number", String(view.secret ?? "…")),
      );
      content.append(card);
    }
    if (view.countdown) {
      const row = element("div", "timer-row");
      const value = element("span", "timer-value", "");
      value.id = "timerValue";
      row.append(element("span", "timer-label", view.timerLabel), value);
      content.append(row);
    }
    if (view.mode === "write") {
      const label = element("label", "field-label", "ONE-WORD CLUE");
      label.setAttribute("for", "clueInput");
      const input = document.createElement("input");
      input.className = "clue-input";
      input.id = "clueInput";
      input.maxLength = 40;
      input.placeholder = "Type privately...";
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
