type Card = { number: number; word: string };
type Result = {
  correct: boolean;
  lower?: Card;
  upper?: Card;
  discarded: boolean;
  timedOut?: boolean;
  lost: boolean;
};
type PanelState = {
  phase: string;
  pile: number;
  current: number | null;
  seconds: number;
  clue: string;
  lives: number;
  selectedGap: number | null;
  lastResult: Result | null;
};
type Actions = {
  drawCard: () => void;
  submitClue: () => void;
  beginGuess: () => void;
  submitGuess: () => void;
  nextTurn: () => void;
  startGame: () => void;
  showClueError: () => void;
};
const $ = (selector: string) =>
  document.querySelector(selector)! as HTMLElement;
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );

export function renderPanel(state: PanelState, actions: Actions) {
  const heading = $("#turnHeading");
  const description = $("#turnDescription");
  const content = $("#turnContent");
  if (state.phase === "ready") {
    heading.textContent = "Ready?";
    description.textContent = state.pile
      ? "Pass the screen to the Tipster."
      : "Draw a replacement card.";
    content.innerHTML = `<button class="button primary" id="drawButton" type="button">${state.pile ? "Draw card" : "Draw replacement"}</button>`;
    $("#drawButton").addEventListener("click", actions.drawCard);
  } else if (state.phase === "tip" || state.phase === "grace") {
    const grace = state.phase === "grace";
    heading.textContent = grace ? "Last chance" : "Your card";
    description.textContent = grace
      ? "3 seconds to send your word."
      : "Connect the two words around your number. Press Send word in time.";
    content.innerHTML = `<div class="secret-card"><span class="secret-label">TIPSTER ONLY</span><span class="secret-number">${state.current}</span></div><div class="timer-row"><span class="timer-label">${grace ? "FINAL SECONDS" : "CLUE TIME"}</span><span class="timer-value ${state.seconds <= 5 ? "urgent" : ""}" id="timerValue">0:${String(state.seconds).padStart(2, "0")}</span></div><label class="field-label" for="clueInput">ONE-WORD CLUE</label><input class="clue-input" id="clueInput" maxlength="40" placeholder="Type privately..." value="${escapeHtml(state.clue)}" autocomplete="off" aria-describedby="clueNote" aria-invalid="false" /><p class="stage-note" id="clueNote" role="alert"></p><button class="button primary" id="sayButton" type="button">Send word</button>`;
    const input = $("#clueInput") as HTMLInputElement;
    input.addEventListener("input", () => {
      state.clue = input.value;
      actions.showClueError();
    });
    if (grace || state.clue.trim()) actions.showClueError();
    $("#sayButton").addEventListener("click", actions.submitClue);
  } else if (state.phase === "handoff") {
    heading.textContent = "Say your word";
    description.textContent = "Then hand the screen to the team.";
    content.innerHTML = `<div class="clue-display">“${escapeHtml(state.clue.trim())}”</div><button class="button primary" id="guessButton" type="button">Let the team guess</button>`;
    $("#guessButton").addEventListener("click", actions.beginGuess);
  } else if (state.phase === "guess") {
    heading.textContent = "Place the hourglass";
    description.textContent =
      state.lives === 0
        ? "Overtime · one miss ends the game."
        : "Tap a gap in the circle.";
    content.innerHTML = `${state.lives === 0 ? `<div class="timer-row"><span class="timer-label">DISCUSSION</span><span class="timer-value ${state.seconds <= 5 ? "urgent" : ""}" id="timerValue">0:${String(state.seconds).padStart(2, "0")}</span></div>` : ""}<button class="button coral" id="placeButton" type="button" ${state.selectedGap === null ? "disabled" : ""}>Reveal card</button>`;
    $("#placeButton").addEventListener("click", actions.submitGuess);
  } else if (state.phase === "result") {
    const { correct, lower, upper, discarded, timedOut, lost } =
      state.lastResult!;
    heading.textContent = discarded
      ? "Card discarded"
      : correct
        ? "Correct!"
        : "Wrong gap";
    description.textContent = lost
      ? "Overtime ended."
      : discarded
        ? "Life lost. Draw a replacement."
        : correct
          ? "Card joins the circle."
          : timedOut
            ? "Time ran out. Card joins its correct gap."
            : "Life lost. Card joins its correct gap.";
    content.innerHTML = `${discarded ? "" : `<div class="result-card">${escapeHtml(state.clue.trim())} · ${state.current}<strong>${escapeHtml(lower!.word)} → ${escapeHtml(upper!.word)}</strong></div>`}<button class="button ${correct ? "primary" : "coral"}" id="nextButton" type="button">${lost || (correct && state.pile === 0) ? "See result" : "Next turn"}</button>`;
    $("#nextButton").addEventListener("click", actions.nextTurn);
  } else {
    const won = state.lastResult!.correct && state.pile === 0;
    heading.textContent = won ? "You won!" : "Game over";
    description.textContent = won
      ? "Last card placed correctly."
      : "Wrong placement in Overtime.";
    content.innerHTML = `<button class="button primary" id="againButton" type="button">Play again</button>`;
    $("#againButton").addEventListener("click", actions.startGame);
  }
}
