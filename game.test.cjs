const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { buildSync } = require('esbuild');

const source = buildSync({
  entryPoints: [require.resolve('./app.js')],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
}).outputFiles[0].text;

function game() {
  const nodes = new Map();
  const element = () => ({
    style: {}, classList: { toggle() {} }, dataset: {},
    replaceChildren() {}, append() {}, addEventListener() {},
    setAttribute() {}, querySelectorAll() { return []; },
  });
  const context = vm.createContext({
    console, Math, Date, setInterval: () => 1, clearInterval() {},
    document: {
      querySelector(selector) {
        if (!nodes.has(selector)) nodes.set(selector, element());
        return nodes.get(selector);
      },
      createElement: element,
    },
    window: { addEventListener() {} },
  });
  context.module = { exports: {} };
  vm.runInContext(source, context);
  const state = context.module.exports.state;
  const run = (code) => context.module.exports[code.replace(/\(\)$/, '')]();
  return { state, run };
}

test('three starting cards, twelve-card pile, unique draw numbers', () => {
  const { state } = game();
  assert.deepEqual(Array.from(state.cards, (card) => card.number), [0, 33, 66]);
  assert.equal(new Set(state.cards.map((card) => card.word)).size, 3);
  assert.equal(state.pile, 12);
  assert.equal(state.deck.length, 97);
  assert.equal(new Set(state.deck).size, 97);
});

test('a wrong placement still inserts card in correct position', () => {
  const { state, run } = game();
  Object.assign(state, { current: 83, clue: 'sweet', selectedGap: 0, phase: 'guess' });
  run('submitGuess()');
  assert.deepEqual(Array.from(state.cards, (card) => card.number), [0, 33, 66, 83]);
  assert.equal(state.cards[3].word, 'sweet');
  assert.equal(state.lastResult.correct, false);
  assert.equal(state.lastResult.lower.number, 66);
  assert.equal(state.lastResult.upper.number, 0);
  assert.equal(state.lives, 2);
});

test('failed last card draws replacement; correct replacement wins', () => {
  const { state, run } = game();
  Object.assign(state, { pile: 0, current: 83, clue: 'sweet', selectedGap: 0, phase: 'guess' });
  run('submitGuess()');
  run('nextTurn()');
  assert.equal(state.phase, 'ready');
  assert.equal(state.pile, 0);
  run('drawCard()');
  assert.equal(state.pile, 0);
  state.clue = 'replacement';
  const insertion = state.cards.findIndex((card) => card.number > state.current);
  state.selectedGap = (insertion === -1 ? state.cards.length : insertion) - 1;
  state.phase = 'guess';
  run('submitGuess()');
  run('nextTurn()');
  assert.equal(state.phase, 'finished');
  assert.equal(state.lastResult.correct, true);
});

test('third lost life enters overtime; fourth mistake loses', () => {
  const { state, run } = game();
  Object.assign(state, { lives: 1, current: 83, clue: 'sweet', selectedGap: 0, phase: 'guess' });
  run('submitGuess()');
  assert.equal(state.lives, 0);
  assert.equal(state.lastResult.lost, false);
  run('nextTurn()');
  assert.equal(state.phase, 'ready');
  Object.assign(state, { current: 55, clue: 'bridge', selectedGap: 0, phase: 'guess' });
  run('submitGuess()');
  assert.equal(state.lastResult.lost, true);
  run('nextTurn()');
  assert.equal(state.phase, 'finished');
});

test('no clue after grace discards card and replaces it in pile', () => {
  const { state, run } = game();
  Object.assign(state, { current: 83, pile: 11, phase: 'grace', lives: 1 });
  run('discardCard()');
  assert.equal(state.pile, 12);
  assert.equal(state.cards.length, 3);
  assert.equal(state.lives, 0);
  run('nextTurn()');
  assert.equal(state.phase, 'ready');
});

test('correct final placement wins even in overtime', () => {
  const { state, run } = game();
  Object.assign(state, { pile: 0, lives: 0, current: 83, clue: 'sweet', selectedGap: 2, phase: 'guess' });
  run('submitGuess()');
  run('nextTurn()');
  assert.equal(state.lastResult.correct, true);
  assert.equal(state.phase, 'finished');
  assert.equal(state.lives, 0);
});

test('running out of overtime discussion counts as wrong placement', () => {
  const { state, run } = game();
  Object.assign(state, { lives: 0, current: 83, clue: 'sweet', selectedGap: 2, phase: 'guess' });
  run('onDiscussionTimeUp()');
  assert.equal(state.lastResult.timedOut, true);
  assert.equal(state.lastResult.lost, true);
  assert.equal(state.cards.at(-1).number, 83);
});

test('a duplicate clue is blocked but a proper name is accepted', () => {
  const { state, run } = game();
  state.clue = state.cards[0].word.toLowerCase();
  assert.equal(run('validClue()'), false);
  state.clue = 'New York';
  assert.equal(run('validClue()'), true);
  state.clue = 'two words';
  assert.equal(run('validClue()'), false);
});

test('invalid clue explains what to fix', () => {
  const { state, run } = game();
  assert.equal(run('clueError()'), 'Enter a clue word.');
  state.clue = 'two words';
  assert.match(run('clueError()'), /one word/);
  state.clue = '50';
  assert.match(run('clueError()'), /No numbers/);
  state.clue = state.cards[0].word.toLowerCase();
  assert.match(run('clueError()'), /already in the circle/);
  state.clue = 'sweet';
  assert.equal(run('clueError()'), '');
});

test('tipster can send valid clue before countdown expires', () => {
  const { state, run } = game();
  Object.assign(state, { phase: 'tip', current: 83, clue: 'sweet', seconds: 16, timer: 1 });
  run('submitClue()');
  assert.equal(state.phase, 'handoff');
  assert.equal(state.timer, null);
  assert.equal(state.seconds, 16);
});

test('typed clue needs explicit submission before grace ends', () => {
  const { state, run } = game();
  Object.assign(state, { phase: 'tip', current: 83, clue: 'sweet' });
  run('onClueTimeUp()');
  assert.equal(state.phase, 'grace');
  assert.equal(state.seconds, 3);
  assert.equal(state.clue, 'sweet');
  run('submitClue()');
  assert.equal(state.phase, 'handoff');
});

test('unsubmitted valid clue is discarded after grace', () => {
  const { state, run } = game();
  Object.assign(state, { phase: 'tip', current: 83, clue: 'sweet', pile: 11 });
  run('onClueTimeUp()');
  run('discardCard()');
  assert.equal(state.phase, 'result');
  assert.equal(state.cards.length, 3);
  assert.equal(state.lives, 2);
  assert.equal(state.pile, 12);
});

test('invalid clue cannot be sent early or during grace period', () => {
  const { state, run } = game();
  Object.assign(state, { phase: 'tip', current: 83, clue: 'two words', seconds: 16 });
  run('submitClue()');
  assert.equal(state.phase, 'tip');
  state.phase = 'grace';
  state.clue = state.cards[0].word;
  run('submitClue()');
  assert.equal(state.phase, 'grace');
});
