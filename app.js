import { renderBoard } from './web/board.ts';
import { renderPanel } from './web/panel.ts';

const $ = (selector) => document.querySelector(selector);
const STARTING_WORDS = [
  'Lantern', 'Moss', 'Thunder', 'Velvet', 'Compass', 'Whisper', 'Marble', 'Festival',
  'Puddle', 'Orbit', 'Cinnamon', 'Feather', 'Midnight', 'Puzzle', 'Kite', 'Garden',
  'Echo', 'Blanket', 'Spark', 'Ocean', 'Dancing', 'Curious', 'Wild', 'Golden',
];
const PILE_SIZE = 12;
const CLUE_SECONDS = 20;
const GRACE_SECONDS = 3;
const DISCUSSION_SECONDS = 20;

const state = {
  cards: [], deck: [], pile: 12, lives: 3, turn: 1, current: null,
  phase: 'ready', selectedGap: null, clue: '', seconds: 20, timer: null,
  deadline: null, lastResult: null, recent: null, discarded: 0,
};

function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function stopTimer() {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
}

function startGame() {
  stopTimer();
  const [first, second, third] = shuffle(STARTING_WORDS);
  Object.assign(state, {
    cards: [{ number: 0, word: first }, { number: 33, word: second }, { number: 66, word: third }],
    deck: shuffle(Array.from({ length: 99 }, (_, i) => i + 1).filter((number) => number !== 33 && number !== 66)),
    pile: PILE_SIZE, lives: 3, turn: 1, current: null, phase: 'ready',
    selectedGap: null, clue: '', seconds: CLUE_SECONDS, deadline: null,
    lastResult: null, recent: null, discarded: 0,
  });
  render();
}

function clueError() {
  const clue = state.clue.trim();
  if (!clue) return 'Enter a clue word.';
  const oneWord = /^\p{L}+(?:['’\-]\p{L}+)*$/u.test(clue);
  const properName = /^\p{Lu}[\p{L}'’-]*(?:\s+\p{Lu}[\p{L}'’-]*)+$/u.test(clue);
  if (!oneWord && !properName) return 'Use one word (or a capitalized proper name). No numbers or symbols.';
  if (state.cards.some((card) => card.word.toLowerCase() === clue.toLowerCase())) {
    return 'That word is already in the circle. Choose another.';
  }
  return '';
}

function validClue() {
  return !clueError();
}

function drawCard() {
  if (state.phase !== 'ready' || !state.deck.length) return;
  if (state.pile > 0) state.pile--;
  state.current = state.deck.pop();
  state.clue = '';
  state.seconds = CLUE_SECONDS;
  state.phase = 'tip';
  render();
  runTimer(CLUE_SECONDS, onClueTimeUp);
}

function runTimer(duration, onFinish) {
  stopTimer();
  state.seconds = duration;
  state.deadline = Date.now() + duration * 1000;
  const tick = () => {
    state.seconds = Math.max(0, Math.ceil((state.deadline - Date.now()) / 1000));
    const display = $('#timerValue');
    if (display) {
      display.textContent = `0:${String(state.seconds).padStart(2, '0')}`;
      display.classList.toggle('urgent', state.seconds <= 5);
    }
    if (state.seconds === 0) {
      stopTimer();
      onFinish();
    }
  };
  state.timer = setInterval(tick, 200);
}

function onClueTimeUp() {
  if (state.phase !== 'tip') return;
  state.phase = 'grace';
  state.seconds = GRACE_SECONDS;
  render();
  runTimer(GRACE_SECONDS, () => {
    if (state.phase === 'grace') discardCard();
  });
}

function discardCard() {
  stopTimer();
  state.discarded++;
  const lost = state.lives === 0;
  state.lives--;
  state.pile++;
  state.lastResult = { discarded: true, lost, correct: false };
  state.current = null;
  state.phase = 'result';
  render();
}

function submitClue() {
  if (!['tip', 'grace'].includes(state.phase) || !validClue()) {
    showClueError();
    return;
  }
  stopTimer();
  state.phase = 'handoff';
  render();
}

function showClueError() {
  const error = clueError();
  const input = $('#clueInput');
  const note = $('#clueNote');
  if (!input || !note) return;
  input.setAttribute('aria-invalid', String(Boolean(error)));
  note.textContent = error;
}

function beginGuess() {
  if (state.phase !== 'handoff') return;
  state.phase = 'guess';
  render();
  if (state.lives === 0) runTimer(DISCUSSION_SECONDS, onDiscussionTimeUp);
}

function onDiscussionTimeUp() {
  if (state.phase !== 'guess') return;
  // In overtime the team must lock in its choice before the sand runs out.
  submitGuess(true);
}

function selectGap(index) {
  if (state.phase !== 'guess') return;
  state.selectedGap = index;
  render();
}

function submitGuess(timedOut = false) {
  if (state.phase !== 'guess' || (state.selectedGap === null && !timedOut)) return;
  stopTimer();
  const insertion = state.cards.findIndex((card) => card.number > state.current);
  const target = insertion === -1 ? state.cards.length : insertion;
  const gap = (target - 1 + state.cards.length) % state.cards.length;
  const lower = state.cards[gap];
  const upper = state.cards[(gap + 1) % state.cards.length];
  const correct = !timedOut && state.selectedGap === gap;
  const lost = !correct && state.lives === 0;
  state.lastResult = { correct, lower, upper, timedOut, lost, discarded: false };
  state.cards.splice(target, 0, { number: state.current, word: state.clue.trim() });
  state.recent = state.current;
  if (!correct) state.lives--;
  state.selectedGap = null;
  state.phase = 'result';
  render();
}

function nextTurn() {
  if (state.phase !== 'result') return;
  const { correct, lost } = state.lastResult;
  if (lost || (correct && state.pile === 0)) {
    state.phase = 'finished';
  } else if (state.deck.length === 0) {
    state.phase = 'finished';
  } else {
    state.turn++;
    state.current = null;
    state.clue = '';
    state.selectedGap = null;
    state.phase = 'ready';
  }
  render();
}

function render() {
  $('#roundLabel').textContent = `DRAW ${String(state.turn).padStart(2, '0')}`;
  $('#lifeText').textContent = state.lives <= 0 ? 'OVERTIME' : `${state.lives} ${state.lives === 1 ? 'life' : 'lives'} left`;
  $('#lives').innerHTML = Array.from({ length: 3 }, (_, i) => `<div class="life ${i >= state.lives ? 'lost' : ''}">${i >= state.lives ? '×' : '♥'}</div>`).join('');
  $('#lives').setAttribute('aria-label', state.lives <= 0 ? 'Overtime: one wrong answer ends the game' : `${state.lives} lives remaining`);
  renderBoard(state, selectGap);
  renderPanel(state, { drawCard, submitClue, beginGuess, submitGuess: () => submitGuess(), nextTurn, startGame, showClueError });
}

$('#newGameButton').addEventListener('click', () => {
  if (state.turn === 1 && state.phase === 'ready') return startGame();
  $('#confirmDialog').showModal();
});
$('#confirmDialog').addEventListener('close', () => { if ($('#confirmDialog').returnValue === 'confirm') startGame(); });
window.addEventListener('resize', () => renderBoard(state, selectGap));
startGame();

export { state, drawCard, submitClue, submitGuess, nextTurn, onClueTimeUp, discardCard, onDiscussionTimeUp, validClue, clueError, startGame };
