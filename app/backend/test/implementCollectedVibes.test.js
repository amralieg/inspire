const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const I = require('../lib/inspireImplement');
const served = (spec, options) => I.validateImplementSpec(I.withInspireUrl(spec, 'https://inspire.example.com'), options);

const lib = (name) => import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', name)).href);

function memoryStorage(seed = {}) {
  const data = new Map(Object.entries(seed));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    raw: data,
  };
}

const SPEC = {
  use_case_id: 'N01-U01',
  use_case_name: 'Predict churn',
  config: { warehouse_id: 'wh1', result_table: 'main.inspire.churn_out' },
  data: { tables: {}, notes: '' },
  outputs: { dashboard: true, genie_space: true, app: true, app_name: 'churn-desk', app_access: 'sp', alert: false },
};

test('collected asks are kept per workspace, database, session and use case, and one use case never sees another one', async () => {
  const C = await lib('implementControl.js');
  const storage = memoryStorage();
  const mine = C.collectedScope('https://a.example.com', 'main.inspire', 42, 'N01-U01');
  const other = C.collectedScope('https://a.example.com', 'main.inspire', 42, 'N01-U02');
  const elsewhere = C.collectedScope('https://b.example.com', 'main.inspire', 42, 'N01-U01');
  assert.equal(mine, 'https://a.example.com|main.inspire|42|N01-U01');
  assert.equal(C.collectedScope(null, undefined, ' 7 ', 'X'), '||7|X');

  let entries = C.collectAsk([], '  Dark header ');
  entries = C.collectRemoval(entries, 'app:page:decisions', 'Decisions page', 'Rows first');
  assert.equal(C.saveCollectedVibes(mine, entries, storage), true);
  assert.equal(C.saveCollectedVibes(other, C.collectAsk([], 'Bigger bars'), storage), true);
  assert.deepEqual(C.loadCollectedVibes(mine, storage), [
    { kind: 'ask', text: 'Dark header' }, { kind: 'remove', id: 'app:page:decisions', label: 'Decisions page', text: 'Rows first' }]);
  assert.deepEqual(C.loadCollectedVibes(other, storage), [{ kind: 'ask', text: 'Bigger bars' }]);
  assert.deepEqual(C.loadCollectedVibes(elsewhere, storage), [], 'another workspace keeps its own');
});

test('asks are collected for the whole MVP once each, a held ask to take out once, dropping one lets it go, and saving nothing drops the use case', async () => {
  const C = await lib('implementControl.js');
  const storage = memoryStorage();
  const scope = C.collectedScope('h', 'd', 1, 'U');
  let entries = C.collectAsk([], 'first');
  entries = C.collectAsk(entries, 'weekly');
  entries = C.collectAsk(entries, ' FIRST ');
  assert.deepEqual(entries.map((e) => e.text), ['first', 'weekly'], 'the same ask twice is kept once, in the order typed');
  entries = C.collectRemoval(entries, 'dashboard', 'Dashboard', 'Arabic labels');
  entries = C.collectRemoval(entries, 'dashboard', 'Dashboard', ' arabic labels ');
  entries = C.collectRemoval(entries, 'app', 'App', 'Arabic labels');
  assert.deepEqual(entries.map((e) => [e.kind, e.id || '', e.text]),
    [['ask', '', 'first'], ['ask', '', 'weekly'], ['remove', 'dashboard', 'Arabic labels'], ['remove', 'app', 'Arabic labels']],
    'the same ask held by two parts is two removals');
  assert.equal(C.removingAsk(entries, 'dashboard', 'ARABIC LABELS')?.id, 'dashboard');
  assert.equal(C.removingAsk(entries, 'genie_space', 'Arabic labels'), null);
  entries = C.dropCollected(entries, { kind: 'remove', id: 'dashboard', text: 'Arabic labels' });
  entries = C.dropCollected(entries, { kind: 'ask', text: 'weekly' });
  assert.deepEqual(entries.map((e) => [e.kind, e.id || '', e.text]), [['ask', '', 'first'], ['remove', 'app', 'Arabic labels']]);
  assert.deepEqual(C.collectAsk(entries, '   '), entries, 'spaces are no ask');
  assert.deepEqual(C.collectRemoval(entries, '', 'App', 'x'), entries, 'a removal needs the part that holds the ask');
  C.saveCollectedVibes(scope, entries, storage);
  C.saveCollectedVibes(scope, [], storage);
  assert.deepEqual(JSON.parse(storage.raw.get(C.COLLECTED_VIBES_KEY)), {}, 'no empty list is left behind');
  assert.deepEqual(C.collectAsk(null, 'x'), [{ kind: 'ask', text: 'x' }]);
});

test('broken or foreign storage gives no asks and never throws, and a browser that cannot save says so', async () => {
  const C = await lib('implementControl.js');
  const scope = C.collectedScope('h', 'd', 1, 'U');
  for (const raw of ['not json', '[1,2]', 'null', '"text"', '{"h|d|1|U": "nope"}', '{"h|d|1|U": [null, {"id": 3, "text": "x"}, {"id": "app", "text": "  "}, {"kind": "other", "text": "x"}]}']) {
    assert.deepEqual(C.loadCollectedVibes(scope, memoryStorage({ [C.COLLECTED_VIBES_KEY]: raw })), [], raw);
  }
  assert.deepEqual(C.loadCollectedVibes(scope, null), [], 'no storage at all');
  const full = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } };
  assert.equal(C.saveCollectedVibes(scope, [{ kind: 'ask', text: 'x' }], full), false);
  assert.equal(C.saveCollectedVibes(scope, [{ kind: 'ask', text: 'x' }], null), false);
  const broken = memoryStorage({ [C.COLLECTED_VIBES_KEY]: 'not json' });
  assert.equal(C.saveCollectedVibes(scope, [{ kind: 'ask', text: 'x' }], broken), true);
  assert.deepEqual(C.loadCollectedVibes(scope, broken), [{ kind: 'ask', text: 'x' }], 'a broken store is replaced, not kept');
});

test('the wizard puts every collected ask in its one box, once and trimmed, and leaves each part its held asks', async () => {
  const W = await lib('implementWizard.js');
  const spec = JSON.parse(JSON.stringify({ ...SPEC, vibes: 'Dark header', outputs: { ...SPEC.outputs, app_vibes: 'Dark header', genie_space_vibes: '' } }));
  const entries = [
    { kind: 'ask', text: 'Add a CSV export' },
    { kind: 'ask', text: '  Answer in Arabic  ' },
    { kind: 'ask', text: 'dark header' },
    { kind: 'ask', text: '   ' },
    { kind: 'ask', text: 'Rows first,\n  then a map by region' },
  ];
  const { spec: next, added, removed, gone } = W.withCollectedVibes(spec, entries);
  assert.deepEqual([added, removed, gone], [3, 0, []], 'an empty ask and one the box already holds are not counted');
  assert.equal(next.vibes, 'Dark header\nAdd a CSV export\nAnswer in Arabic\nRows first,\nthen a map by region');
  assert.deepEqual([next.outputs.app_vibes, next.outputs.genie_space_vibes, next.data.notes], ['Dark header', '', ''], 'the parts keep what they hold');
  assert.equal(spec.vibes, 'Dark header', 'the spec it starts from is not changed');
  assert.deepEqual(W.withCollectedVibes(next, entries).added, 0, 'opening Vibe/Add/Remove Features again adds nothing twice');
  assert.deepEqual(served(next).errors, [], 'the backend takes the box as the wizard sends it');
  assert.deepEqual(W.withCollectedVibes(SPEC, null), { spec: { ...SPEC, data: { ...SPEC.data }, outputs: { ...SPEC.outputs } }, added: 0, removed: 0, gone: [] });
  assert.equal(W.collectedVibesText({ added: 3 }), 'The 3 asks you collected are in the box below. Check them, then build.');
  assert.equal(W.collectedVibesText({ removed: 1 }), 'Inspire takes out the earlier ask you removed.');
  assert.equal(W.collectedVibesText({ gone: ['a', 'b'] }), 'Not taken out: “a” and “b”, because no part holds them any more.');
});

test('collected asks that make the box too long are caught by the wizard check before they are sent', async () => {
  const W = await lib('implementWizard.js');
  const spec = JSON.parse(JSON.stringify(SPEC));
  const { spec: next } = W.withCollectedVibes(spec, [{ kind: 'ask', text: 'a'.repeat(1990) }, { kind: 'ask', text: 'b'.repeat(20) }]);
  assert.deepEqual(W.vibesProblems(next), ['the MVP vibes are 2,011 characters; at most 2,000 are allowed'], 'the asks are joined by a line, which counts too');
  assert.deepEqual(served(next).errors, ['the MVP vibes are 2,011 characters; at most 2,000 are allowed'], 'and the backend refuses it the same way');
});

test('pane widths: the rail clamps to 240-520 px from 320, the drawer to 400-1100 px from 640, each under its own key, and both survive a broken store', async () => {
  const W = await lib('paneWidth.js');
  const r = (v) => W.paneWidth(W.RAIL_WIDTH, v);
  assert.deepEqual([r(100), r(600), r('300.4'), r(''), r(null), r('wide')], [240, 520, 300, 320, 320, 320]);
  const d = (v) => W.paneWidth(W.DRAWER_WIDTH, v);
  assert.deepEqual([d(100), d(5000), d('700.6'), d(undefined)], [400, 1100, 701, 640]);
  const store = memoryStorage();
  assert.equal(W.loadPaneWidth(W.RAIL_WIDTH, store), 320, 'nothing stored yet');
  assert.equal(W.savePaneWidth(W.RAIL_WIDTH, 9999, store), true);
  assert.equal(W.loadPaneWidth(W.RAIL_WIDTH, store), 520, 'a stored width is clamped on the way in');
  assert.equal(W.loadPaneWidth(W.DRAWER_WIDTH, store), 640, 'must-exclude: the rail width never sizes the drawer');
  store.setItem('inspire.implement_rail_width', '-5');
  assert.equal(W.loadPaneWidth(W.RAIL_WIDTH, store), 240, 'and on the way out');
  W.savePaneWidth(W.DRAWER_WIDTH, 900, store);
  assert.equal(store.getItem('inspire.drawer_width'), '900');
  const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); } };
  assert.equal(W.loadPaneWidth(W.RAIL_WIDTH, broken), 320);
  assert.equal(W.savePaneWidth(W.DRAWER_WIDTH, 400, broken), false);
  assert.equal(W.loadPaneWidth(W.DRAWER_WIDTH, null), 640);
  assert.equal(W.savePaneWidth(W.RAIL_WIDTH, 400, null), false);
  assert.deepEqual(['ArrowLeft', 'ArrowRight', 'Home', 'End', 'a'].map((k) => W.resizeKeyWidth(W.RAIL_WIDTH, 320, k)), [304, 336, 240, 520, undefined]);
  assert.deepEqual(['ArrowLeft', 'ArrowRight'].map((k) => W.resizeKeyWidth(W.DRAWER_WIDTH, 640, k, -1)), [672, 608], 'a drawer on the right grows to the left');
});
