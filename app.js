import { renderBoard } from './web/board.ts';
import { renderPanel } from './web/panel.ts';
import { createGame, apply, clueError as validateClue, CLUE_SECONDS, GRACE_SECONDS, DISCUSSION_SECONDS } from './game/rules.ts';

const $ = (selector) => document.querySelector(selector);
const STARTING_WORDS = [
  'Lantern', 'Moss', 'Thunder', 'Velvet', 'Compass', 'Whisper', 'Marble', 'Festival',
  'Puddle', 'Orbit', 'Cinnamon', 'Feather', 'Midnight', 'Puzzle', 'Kite', 'Garden',
  'Echo', 'Blanket', 'Spark', 'Ocean', 'Dancing', 'Curious', 'Wild', 'Golden',
];
const state = { ...createGame(shuffle(STARTING_WORDS).slice(0, 3), shuffle(Array.from({ length: 99 }, (_, i) => i + 1).filter((number) => number !== 33 && number !== 66))), seconds: CLUE_SECONDS, timer: null };

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
  Object.assign(state, createGame(shuffle(STARTING_WORDS).slice(0, 3), shuffle(Array.from({ length: 99 }, (_, i) => i + 1).filter((number) => number !== 33 && number !== 66))), { seconds: CLUE_SECONDS });
  render();
}

function clueError() {
  return validateClue(state.clue, state.cards);
}

function validClue() {
  return !clueError();
}

function drawCard() {
  if (state.phase !== 'ready' || !state.deck.length) return;
  Object.assign(state, apply(state, { type: 'DRAW' }, Date.now()));
  state.seconds = CLUE_SECONDS;
  render();
  runTimer(CLUE_SECONDS, onClueTimeUp);
}

function runTimer(duration, onFinish) {
  stopTimer();
  state.seconds = duration;
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
  Object.assign(state, apply(state, { type: 'CLUE_TIMEOUT' }, Math.max(Date.now(), state.deadline)));
  state.seconds = GRACE_SECONDS;
  render();
  runTimer(GRACE_SECONDS, () => {
    if (state.phase === 'grace') discardCard();
  });
}

function discardCard() {
  stopTimer();
  Object.assign(state, apply(state, { type: 'GRACE_TIMEOUT' }, Math.max(Date.now(), state.deadline ?? 0)));
  render();
}

function submitClue() {
  if (!['tip', 'grace'].includes(state.phase) || !validClue()) {
    showClueError();
    return;
  }
  stopTimer();
  Object.assign(state, apply(state, { type: 'SUBMIT_CLUE', clue: state.clue }, Date.now()));
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
  Object.assign(state, apply(state, { type: 'BEGIN_GUESS' }, Date.now()));
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
  Object.assign(state, apply(state, { type: 'SELECT_GAP', index }, Date.now()));
  render();
}

function submitGuess(timedOut = false) {
  if (state.phase !== 'guess' || (state.selectedGap === null && !timedOut)) return;
  stopTimer();
  Object.assign(state, apply(state, { type: timedOut ? 'DISCUSSION_TIMEOUT' : 'LOCK_GAP' }, timedOut ? Math.max(Date.now(), state.deadline ?? 0) : Date.now()));
  render();
}

function nextTurn() {
  if (state.phase !== 'result') return;
  Object.assign(state, apply(state, { type: 'NEXT_TURN' }, Date.now()));
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
