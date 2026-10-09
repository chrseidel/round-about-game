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

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
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

function gapName(index) {
  return `Between ${state.cards[index].word} and ${state.cards[(index + 1) % state.cards.length].word}`;
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
  if (validClue()) {
    state.phase = 'handoff';
    render();
  } else {
    state.phase = 'grace';
    state.seconds = GRACE_SECONDS;
    render();
    runTimer(GRACE_SECONDS, () => {
      if (state.phase === 'grace') discardCard();
    });
  }
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

function renderBoard() {
  const ring = $('#ringCards');
  const board = $('#board');
  ring.replaceChildren();
  const count = state.cards.length;
  const radius = Math.min(board.clientHeight * .39, (board.clientWidth - 84) / 2);
  state.cards.forEach((cardData, index) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI / count);
    const card = document.createElement('div');
    card.className = `ring-card ${[0, 33, 66].includes(cardData.number) ? 'is-anchor' : ''} ${state.recent === cardData.number ? 'is-recent' : ''}`;
    card.classList.toggle('compact', count > 9);
    card.innerHTML = `<span class="ring-number">${cardData.number === 0 ? '0/100' : cardData.number}</span><span class="ring-word">${escapeHtml(cardData.word)}</span>`;
    card.style.left = `calc(50% + ${Math.cos(angle) * radius}px)`;
    card.style.top = `calc(50% + ${Math.sin(angle) * radius}px)`;
    ring.append(card);

    const gapAngle = angle + Math.PI / count;
    const gap = document.createElement('button');
    gap.type = 'button';
    gap.className = `ring-gap ${state.selectedGap === index ? 'selected' : ''}`;
    gap.textContent = state.selectedGap === index ? '⌛' : '+';
    gap.title = gapName(index);
    gap.setAttribute('aria-label', gap.title);
    gap.disabled = state.phase !== 'guess';
    const gapRadius = radius + (board.clientWidth < 360 ? 23 : 29);
    gap.style.left = `calc(50% + ${Math.cos(gapAngle) * gapRadius}px)`;
    gap.style.top = `calc(50% + ${Math.sin(gapAngle) * gapRadius}px)`;
    gap.addEventListener('click', () => selectGap(index));
    ring.append(gap);
  });

  $('#boardMessage').innerHTML = state.phase === 'guess' ? `“${escapeHtml(state.clue.trim())}”` : 'Find the<br /><em>connection.</em>';
  $('#boardSubline').textContent = state.phase === 'guess' ? 'Choose a gap' : '';
  $('#pileCount').textContent = `${state.pile} ${state.pile === 1 ? 'CARD' : 'CARDS'} LEFT`;
}

function renderPanel() {
  const heading = $('#turnHeading');
  const description = $('#turnDescription');
  const content = $('#turnContent');
  if (state.phase === 'ready') {
    heading.textContent = 'Ready?';
    description.textContent = state.pile ? 'Pass the screen to the Tipster.' : 'Draw a replacement card.';
    content.innerHTML = `<button class="button primary" id="drawButton" type="button">${state.pile ? 'Draw card' : 'Draw replacement'}</button>`;
    $('#drawButton').addEventListener('click', drawCard);
  } else if (state.phase === 'tip' || state.phase === 'grace') {
    const grace = state.phase === 'grace';
    heading.textContent = grace ? 'Last chance' : 'Your card';
    description.textContent = grace ? '3 seconds to give a word.' : 'Connect the two words around your number.';
    content.innerHTML = `<div class="secret-card"><span class="secret-label">TIPSTER ONLY</span><span class="secret-number">${state.current}</span></div><div class="timer-row"><span class="timer-label">${grace ? 'FINAL SECONDS' : 'CLUE TIME'}</span><span class="timer-value ${state.seconds <= 5 ? 'urgent' : ''}" id="timerValue">0:${String(state.seconds).padStart(2, '0')}</span></div><label class="field-label" for="clueInput">ONE-WORD CLUE</label><input class="clue-input" id="clueInput" maxlength="40" placeholder="Type privately..." value="${escapeHtml(state.clue)}" autocomplete="off" aria-describedby="clueNote" aria-invalid="false" /><p class="stage-note" id="clueNote" role="alert"></p><button class="button primary" id="sayButton" type="button">Send word</button>`;
    const input = $('#clueInput');
    input.addEventListener('input', (event) => {
      state.clue = event.target.value;
      showClueError();
    });
    if (grace || state.clue.trim()) showClueError();
    $('#sayButton').addEventListener('click', submitClue);
  } else if (state.phase === 'handoff') {
    heading.textContent = 'Say your word';
    description.textContent = 'Then hand the screen to the team.';
    content.innerHTML = `<div class="clue-display">“${escapeHtml(state.clue.trim())}”</div><button class="button primary" id="guessButton" type="button">Let the team guess</button>`;
    $('#guessButton').addEventListener('click', beginGuess);
  } else if (state.phase === 'guess') {
    heading.textContent = 'Place the hourglass';
    description.textContent = state.lives === 0 ? 'Overtime · one miss ends the game.' : 'Tap a gap in the circle.';
    content.innerHTML = `${state.lives === 0 ? `<div class="timer-row"><span class="timer-label">DISCUSSION</span><span class="timer-value ${state.seconds <= 5 ? 'urgent' : ''}" id="timerValue">0:${String(state.seconds).padStart(2, '0')}</span></div>` : ''}<button class="button coral" id="placeButton" type="button" ${state.selectedGap === null ? 'disabled' : ''}>Reveal card</button>`;
    $('#placeButton').addEventListener('click', () => submitGuess());
  } else if (state.phase === 'result') {
    const { correct, lower, upper, discarded, timedOut, lost } = state.lastResult;
    heading.textContent = discarded ? 'Card discarded' : correct ? 'Correct!' : 'Wrong gap';
    description.textContent = lost ? 'Overtime ended.' : discarded ? 'Life lost. Draw a replacement.' : correct ? 'Card joins the circle.' : timedOut ? 'Time ran out. Card joins its correct gap.' : 'Life lost. Card joins its correct gap.';
    content.innerHTML = `${discarded ? '' : `<div class="result-card">${escapeHtml(state.clue.trim())} · ${state.current}<strong>${escapeHtml(lower.word)} → ${escapeHtml(upper.word)}</strong></div>`}<button class="button ${correct ? 'primary' : 'coral'}" id="nextButton" type="button">${lost || (correct && state.pile === 0) ? 'See result' : 'Next turn'}</button>`;
    $('#nextButton').addEventListener('click', nextTurn);
  } else {
    const won = state.lastResult.correct && state.pile === 0;
    heading.textContent = won ? 'You won!' : 'Game over';
    description.textContent = won ? 'Last card placed correctly.' : 'Wrong placement in Overtime.';
    content.innerHTML = `<button class="button primary" id="againButton" type="button">Play again</button>`;
    $('#againButton').addEventListener('click', startGame);
  }
}

function render() {
  $('#roundLabel').textContent = `DRAW ${String(state.turn).padStart(2, '0')}`;
  $('#lifeText').textContent = state.lives <= 0 ? 'OVERTIME' : `${state.lives} ${state.lives === 1 ? 'life' : 'lives'} left`;
  $('#lives').innerHTML = Array.from({ length: 3 }, (_, i) => `<div class="life ${i >= state.lives ? 'lost' : ''}">${i >= state.lives ? '×' : '♥'}</div>`).join('');
  $('#lives').setAttribute('aria-label', state.lives <= 0 ? 'Overtime: one wrong answer ends the game' : `${state.lives} lives remaining`);
  renderBoard();
  renderPanel();
}

$('#newGameButton').addEventListener('click', () => {
  if (state.turn === 1 && state.phase === 'ready') return startGame();
  $('#confirmDialog').showModal();
});
$('#confirmDialog').addEventListener('close', () => { if ($('#confirmDialog').returnValue === 'confirm') startGame(); });
window.addEventListener('resize', renderBoard);
startGame();
