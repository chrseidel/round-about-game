export type Card = { number: number; word: string };
export type Phase =
  "ready" | "tip" | "grace" | "handoff" | "guess" | "result" | "finished";
export type Result = {
  correct: boolean;
  lost: boolean;
  discarded: boolean;
  timedOut: boolean;
  lower?: Card;
  upper?: Card;
};
export type Game = {
  cards: Card[];
  deck: number[];
  pile: number;
  lives: number;
  turn: number;
  current: number | null;
  phase: Phase;
  selectedGap: number | null;
  clue: string;
  deadline: number | null;
  lastResult: Result | null;
  recent: number | null;
  discarded: number;
};
export type Command =
  | { type: "DRAW" }
  | { type: "SUBMIT_CLUE"; clue: string }
  | { type: "CLUE_TIMEOUT" }
  | { type: "GRACE_TIMEOUT" }
  | { type: "BEGIN_GUESS" }
  | { type: "SELECT_GAP"; index: number }
  | { type: "LOCK_GAP" }
  | { type: "DISCUSSION_TIMEOUT" }
  | { type: "NEXT_TURN" };

export const CLUE_SECONDS = 20;
export const GRACE_SECONDS = 3;
export const DISCUSSION_SECONDS = 20;

export function createGame(words: string[], numbers: number[]): Game {
  if (
    words.length !== 3 ||
    new Set(words.map((word) => word.toLowerCase())).size !== 3
  )
    throw new Error("Three unique starting words required");
  if (
    numbers.length !== 97 ||
    new Set(numbers).size !== 97 ||
    numbers.some(
      (number) =>
        !Number.isInteger(number) ||
        number < 1 ||
        number > 99 ||
        number === 33 ||
        number === 66,
    )
  ) {
    throw new Error("Deck must contain each unused number once");
  }
  return {
    cards: [0, 33, 66].map((number, i) => ({ number, word: words[i]! })),
    deck: [...numbers],
    pile: 12,
    lives: 3,
    turn: 1,
    current: null,
    phase: "ready",
    selectedGap: null,
    clue: "",
    deadline: null,
    lastResult: null,
    recent: null,
    discarded: 0,
  };
}

export function clueError(clue: string, cards: Card[]): string {
  const word = clue.trim();
  if (!word) return "Enter a clue word.";
  const oneWord = /^\p{L}+(?:['’\-]\p{L}+)*$/u.test(word);
  const properName = /^\p{Lu}[\p{L}'’-]*(?:\s+\p{Lu}[\p{L}'’-]*)+$/u.test(word);
  if (!oneWord && !properName)
    return "Use one word (or a capitalized proper name). No numbers or symbols.";
  if (cards.some((card) => card.word.toLowerCase() === word.toLowerCase()))
    return "That word is already in the circle. Choose another.";
  return "";
}

export function apply(game: Game, command: Command, now: number): Game {
  const state: Game = { ...game, cards: [...game.cards], deck: [...game.deck] };
  switch (command.type) {
    case "DRAW":
      if (state.phase !== "ready" || !state.deck.length)
        throw new Error("Cannot draw now");
      if (state.pile) state.pile--;
      state.current = state.deck.pop()!;
      state.clue = "";
      state.phase = "tip";
      state.deadline = now + CLUE_SECONDS * 1000;
      return state;
    case "SUBMIT_CLUE":
      if (
        !["tip", "grace"].includes(state.phase) ||
        state.deadline === null ||
        now >= state.deadline
      )
        throw new Error("Clue deadline passed");
      if (clueError(command.clue, state.cards))
        throw new Error(clueError(command.clue, state.cards));
      state.clue = command.clue.trim();
      state.phase = "handoff";
      state.deadline = null;
      return state;
    case "CLUE_TIMEOUT":
      if (
        state.phase !== "tip" ||
        state.deadline === null ||
        now < state.deadline
      )
        throw new Error("Clue time not elapsed");
      state.phase = "grace";
      state.deadline += GRACE_SECONDS * 1000;
      return state;
    case "GRACE_TIMEOUT":
      if (
        state.phase !== "grace" ||
        state.deadline === null ||
        now < state.deadline
      )
        throw new Error("Grace not elapsed");
      state.discarded++;
      state.lastResult = {
        discarded: true,
        correct: false,
        lost: state.lives === 0,
        timedOut: true,
      };
      state.lives--;
      state.pile++;
      state.current = null;
      state.phase = "result";
      state.deadline = null;
      return state;
    case "BEGIN_GUESS":
      if (state.phase !== "handoff") throw new Error("Cannot guess now");
      state.phase = "guess";
      state.deadline =
        state.lives === 0 ? now + DISCUSSION_SECONDS * 1000 : null;
      return state;
    case "SELECT_GAP":
      if (
        state.phase !== "guess" ||
        !Number.isInteger(command.index) ||
        command.index < 0 ||
        command.index >= state.cards.length
      )
        throw new Error("Invalid gap");
      if (state.deadline !== null && now >= state.deadline)
        throw new Error("Guess deadline passed");
      state.selectedGap = command.index;
      return state;
    case "LOCK_GAP":
    case "DISCUSSION_TIMEOUT": {
      const timedOut = command.type === "DISCUSSION_TIMEOUT";
      if (
        state.phase !== "guess" ||
        state.current === null ||
        (!timedOut && state.selectedGap === null)
      )
        throw new Error("Cannot lock gap");
      if (timedOut && (state.deadline === null || now < state.deadline))
        throw new Error("Guess time not elapsed");
      if (!timedOut && state.deadline !== null && now >= state.deadline)
        throw new Error("Guess deadline passed");
      const insertion = state.cards.findIndex(
        (card) => card.number > state.current!,
      );
      const target = insertion < 0 ? state.cards.length : insertion;
      const gap = (target - 1 + state.cards.length) % state.cards.length;
      const correct = !timedOut && state.selectedGap === gap;
      state.lastResult = {
        correct,
        discarded: false,
        timedOut,
        lost: !correct && state.lives === 0,
        lower: state.cards[gap],
        upper: state.cards[(gap + 1) % state.cards.length],
      };
      state.cards.splice(target, 0, {
        number: state.current,
        word: state.clue,
      });
      state.recent = state.current;
      if (!correct) state.lives--;
      state.selectedGap = null;
      state.phase = "result";
      state.deadline = null;
      return state;
    }
    case "NEXT_TURN":
      if (state.phase !== "result" || !state.lastResult)
        throw new Error("No result");
      if (
        state.lastResult.lost ||
        (state.lastResult.correct && state.pile === 0) ||
        !state.deck.length
      ) {
        state.phase = "finished";
      } else {
        state.phase = "ready";
        state.turn++;
        state.current = null;
        state.clue = "";
        state.selectedGap = null;
      }
      return state;
  }
}
