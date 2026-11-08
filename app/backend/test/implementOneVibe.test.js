const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const I = require('../lib/inspireImplement');

const lib = (name) => import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', name)).href);

const PAGE = 'app:page:decisions';
const CHART = 'dashboard:w1a2b3c4';
const REBUILD_NEEDS_CHOICE = 'vibe_previous must be keep or remove, because this use case has a built version: it says what happens to the version before this vibe';

const BASE = {
  use_case_id: 'N01-U01',
  use_case_name: 'Predict churn',
  config: { warehouse_id: 'wh1', result_table: 'main.inspire.churn_out' },
  outputs: { dashboard: true, genie_space: true, app: true, app_name: 'churn-desk', app_access: 'sp', alert: true, alert_recipients: ['owner@example.com'], inspire_url: 'https://inspire.example.com' },
};

function clean(top = {}) {
  const out = I.validateImplementSpec({ ...JSON.parse(JSON.stringify(BASE)), ...top });
  assert.deepEqual(out.errors, [], JSON.stringify(top));
  return out.spec;
}

const live = (version) => ({ state: 'ready', spec_version: version });

function row(version, status = 'ready', extra = {}) {
  return {
    session_id: '42', use_case_id: 'N01-U01', spec_version: version, status, spec_json: JSON.parse(JSON.stringify(BASE)),
    notebook_path: '/W/impl/N01-U01', job_id: '77', dashboard_id: 'd1', genie_space_id: 'g1', app_name: 'churn-desk', alert_id: 'a1',
    asset_status: { dashboard: live(version), genie_space: live(version), app: live(version), alert: live(version), notebook: live(version) },
    ...extra,
  };
}

const uninstalled = (version) => row(version, I.IMPLEMENT_UNINSTALLED, {
  notebook_path: null, job_id: null, dashboard_id: null, genie_space_id: null, app_name: null, alert_id: null,
  asset_status: { dashboard: { state: 'deleted' }, genie_space: { state: 'deleted' }, app: { state: 'deleted' }, alert: { state: 'deleted' }, notebook: { state: 'deleted' } },
});

const HISTORIES = [
  ['no version yet', [], null],
  ['a built version', [row(1)], 1],
  ['a failed rebuild after a built version', [row(2, 'failed'), row(1)], 1],
  ['a version building after a built one', [row(2, 'building_outputs'), row(1)], 1],
  ['an uninstalled MVP', [uninstalled(2), row(1)], null],
  ['a failed build after an uninstall', [row(3, 'failed'), uninstalled(2), row(1)], null],
  ['a build after an uninstall', [row(3, 'ready_with_warnings'), uninstalled(2), row(1)], 3],
  ['a history read out of order', [row(1), row(3, 'failed'), row(2, 'ready')], 2],
];

test('a first build takes a vibe with no choice for the version before, and a rebuild with no choice keeps the built version live', async () => {
  const W = await lib('implementWizard.js');
  const vibe = 'Put the riskiest customers first';
  const first = I.validateImplementSpec({ ...JSON.parse(JSON.stringify(BASE)), vibes: vibe });
  assert.deepEqual([first.errors, first.spec.vibes, Object.hasOwn(first.spec, 'vibe_previous')], [[], vibe, false]);
  assert.deepEqual(I.validateImplementSpec({ ...BASE, vibes: vibe, vibe_previous: 'later' }).errors,
    ["vibe_previous 'later' must be keep or remove: it says what happens to the version before this vibe"], 'a word that is not keep or remove is still refused');
  assert.deepEqual(I.validateImplementSpec({ ...BASE, vibe_previous: 'keep' }).errors, ['vibe_previous needs vibes: it says what happens to the version before a vibe']);

  for (const [name, history, built] of HISTORIES) {
    assert.equal(I.previousBuilt(history)?.spec_version ?? null, built, `backend: ${name}`);
    assert.equal(W.builtVersion(history), built, `wizard: ${name}`);
    const settled = history.filter((r) => !I.IMPLEMENT_ACTIVE_STATUSES.includes(r.status));
    const based = settled.length ? Math.max(...settled.map((r) => r.spec_version)) : null;
    const asked = { ...clean({ vibes: vibe }), based_on_version: based };
    if (built === null) {
      assert.doesNotThrow(() => I.planSubmission(settled, asked), `a first build takes the vibe alone: ${name}`);
      assert.deepEqual(W.sectionErrors('vibes', { ...asked }, { built }), [], `wizard: ${name}`);
    } else {
      assert.throws(() => I.planSubmission(settled, asked), (err) => err.statusCode === 400 && err.message === REBUILD_NEEDS_CHOICE, `backend refuses: ${name}`);
      assert.deepEqual(W.sectionErrors('vibes', { ...asked }, { built }), [], `wizard never waits on the choice: ${name}`);
      const defaulted = I.withVibePreviousDefault(history, asked);
      assert.equal(defaulted.vibe_previous, 'keep', `the route keeps v${built} live when no choice came: ${name}`);
      assert.doesNotThrow(() => I.planSubmission(settled, defaulted), `the defaulted ask builds: ${name}`);
      assert.equal(I.withVibePreviousDefault(history, { ...asked, vibe_previous: 'remove' }).vibe_previous, 'remove', `a choice made is kept: ${name}`);
      for (const choice of ['keep', 'remove']) {
        assert.doesNotThrow(() => I.planSubmission(settled, { ...clean({ vibes: vibe, vibe_previous: choice }), based_on_version: based }), `${choice}: ${name}`);
        assert.deepEqual(W.sectionErrors('vibes', { ...asked, vibe_previous: choice }, { built }), [], `wizard ${choice}: ${name}`);
      }
    }
  }
  assert.deepEqual(W.sectionErrors('vibes', { ...clean(), vibes: '' }, { built: 4 }), [], 'an empty box needs no choice');
  assert.deepEqual(W.sectionErrors('vibes', { ...clean(), vibes: 'x'.repeat(2001) }, { built: null }), ['the MVP vibes are 2,001 characters; at most 2,000 are allowed']);
});

test('the summary of a build after an uninstall reads as a first build, as the agent plans it, even when a failed version came after the uninstall', () => {
  const plan = I.planSubmission([row(3, 'failed'), uninstalled(2), row(1)], { ...clean(), based_on_version: 3 });
  assert.deepEqual([plan.summary.classes, plan.summary.refill], [['initial'], true]);
  const rebuild = I.planSubmission([row(2, 'failed'), row(1)], { ...clean({ data: { run_profile: 'full' } }), based_on_version: 2 });
  assert.deepEqual(rebuild.summary.classes, ['data'], 'with no uninstall the version built before is still the one compared');
});

test('the wizard sends the choice for the version before only with a vibe on a rebuild', async () => {
  const W = await lib('implementWizard.js');
  const base = { ...clean(), vibes: 'Answer in euros', vibe_previous: 'keep' };
  assert.deepEqual([W.sentSpec(base, null, 2).vibes, W.sentSpec(base, null, 2).vibe_previous], ['Answer in euros', 'keep']);
  assert.equal(Object.hasOwn(W.sentSpec(base, null, null), 'vibe_previous'), false, 'a first build has no version before');
  const empty = W.sentSpec({ ...base, vibes: '  ' }, null, 2);
  assert.deepEqual([Object.hasOwn(empty, 'vibes'), Object.hasOwn(empty, 'vibe_previous')], [false, false], 'no vibe, no choice');
  for (const sent of [W.sentSpec(base, null, null), W.sentSpec(base, null, 2), W.sentSpec({ ...base, vibes: '' }, null, 2)]) {
    assert.deepEqual(I.validateImplementSpec(sent).errors, [], JSON.stringify([sent.vibes, sent.vibe_previous]));
  }
});

const HELD = {
  data: { notes: 'Count returns by week\nScore on the last 90 days' },
  outputs: {
    dashboard_vibes: 'Put the weekly trend first\nArabic labels',
    app_vibes: 'Dark header',
    genie_space_vibes: 'Answer in euros',
    alert_vibes: 'Only email me when a row is new',
    [`${PAGE}_vibes`]: 'Rows to act on first\nA filter by region',
    [`${CHART}_vibes`]: 'Bars by week',
    ai_reasoning_vibes: 'Name the two columns behind each decision',
    value_formula_vibes: 'Use the net margin',
  },
};

function heldLatest(version = 3) {
  const spec = clean();
  return {
    spec_version: version, status: 'ready',
    spec_json: { ...spec, vibes: 'Put the riskiest customers first', vibe_previous: 'keep', data: { ...spec.data, ...HELD.data }, outputs: { ...spec.outputs, ...HELD.outputs } },
  };
}

test('the next version the wizard or Vibe/Add/Remove Features builds carries the notebook asks and every part\'s asks the latest version holds, and never the vibe it was built with', async () => {
  const W = await lib('implementWizard.js');
  const latest = heldLatest();
  const fallback = W.defaultSpecFromUseCase({ use_case_id: 'N01-U01', Name: 'Predict churn' }, { warehouseId: 'wh1', inspireDatabase: 'main.inspire', sessionId: '42' });
  for (const [name, next] of [['the wizard', W.specFromLatest(latest, fallback)], ['a Build page action', W.nextSpecFrom(latest, { schedule: { enabled: false } })]]) {
    assert.equal(next.data.notes, HELD.data.notes, `${name}: the notebook asks`);
    for (const [key, value] of Object.entries(HELD.outputs)) assert.equal(next.outputs[key], value, `${name}: ${key}`);
    assert.deepEqual([Object.hasOwn(next, 'vibes'), Object.hasOwn(next, 'vibe_previous')], [false, false], `${name}: the vibe was one version's`);
    const checked = I.validateImplementSpec(next);
    assert.deepEqual(checked.errors, [], name);
    assert.equal(checked.spec.data.notes, HELD.data.notes, `${name}: the backend keeps the notebook asks`);
    for (const [key, value] of Object.entries(HELD.outputs)) assert.equal(checked.spec.outputs[key], value, `${name}: the backend keeps ${key}`);
  }
  const { spec } = W.withCollectedVibes(W.specFromLatest(latest, fallback), [{ kind: 'ask', text: 'Label each bar with its count' }]);
  assert.equal(spec.vibes, 'Label each bar with its count');
  assert.equal(spec.outputs.dashboard_vibes, HELD.outputs.dashboard_vibes, 'a new ask never rewrites what a part holds; the agent routes it');
  assert.equal(spec.data.notes, HELD.data.notes);
});

test('Remove on a held ask takes only that ask out of its part in the next spec, a part is rebuilt for it, and an ask no part holds any more is reported', async () => {
  const W = await lib('implementWizard.js');
  const start = W.specFromLatest(heldLatest(), W.defaultSpecFromUseCase({ use_case_id: 'N01-U01' }, { warehouseId: 'wh1', inspireDatabase: 'main.inspire', sessionId: '42' }));
  const entries = [
    { kind: 'remove', id: 'dashboard', label: 'Dashboard', text: 'Arabic labels' },
    { kind: 'remove', id: PAGE, label: 'Decisions page', text: 'Rows to act on first' },
    { kind: 'remove', id: 'notebook', label: 'notebook', text: 'Count returns by week' },
    { kind: 'remove', id: 'ai_reasoning', label: 'AI reasoning', text: 'Name the two columns behind each decision' },
    { kind: 'remove', id: 'dashboard', label: 'Dashboard', text: 'Show the last 12 weeks' },
    { kind: 'ask', text: '  Answer in Arabic  ' },
    { kind: 'ask', text: 'answer in arabic' },
  ];
  const got = W.withCollectedVibes(start, entries);
  assert.deepEqual([got.added, got.removed, got.gone], [1, 4, ['Show the last 12 weeks']]);
  assert.equal(got.spec.outputs.dashboard_vibes, 'Put the weekly trend first');
  assert.equal(got.spec.outputs[`${PAGE}_vibes`], 'A filter by region');
  assert.equal(got.spec.outputs.ai_reasoning_vibes, '');
  assert.equal(got.spec.data.notes, 'Score on the last 90 days');
  assert.equal(got.spec.vibes, 'Answer in Arabic', 'one ask, once, as typed');
  for (const id of ['app_vibes', 'genie_space_vibes', 'alert_vibes', `${CHART}_vibes`, 'value_formula_vibes']) assert.equal(got.spec.outputs[id], HELD.outputs[id], `${id} is left as it was`);
  assert.deepEqual(got.spec.retry_outputs, [PAGE, 'ai_reasoning'], 'a part whose asks changed is rebuilt on its own; a whole output or the notebook needs no retry');
  assert.equal(W.collectedVibesText(got),
    'The ask you collected is in the box below. Check it, then build. Inspire also takes out the 4 earlier asks you removed. Not taken out: “Show the last 12 weeks”, because no part holds it any more.');
  assert.equal(W.collectedVibesText({ added: 2, removed: 1, gone: [] }),
    'The 2 asks you collected are in the box below. Check them, then build. Inspire also takes out the earlier ask you removed.');
  assert.equal(W.collectedVibesText({ added: 0, removed: 0, gone: [] }), '');

  const built = row(3, 'ready', {
    spec_json: heldLatest().spec_json,
    asset_status: { dashboard: live(3), genie_space: live(3), app: live(3), alert: live(3), notebook: live(3), [PAGE]: live(3), [CHART]: live(3), ai_reasoning: live(3), value_formula: live(3) },
  });
  const sent = I.validateImplementSpec({ ...W.sentSpec(got.spec, null, 3), vibe_previous: 'remove' });
  assert.deepEqual(sent.errors, []);
  const plan = I.planSubmission([built], sent.spec);
  assert.ok(plan.summary.classes.includes('data'), 'a notebook ask taken out rebuilds the notebook');

  const alone = W.withCollectedVibes(start, [{ kind: 'remove', id: 'dashboard', label: 'Dashboard', text: 'Put the weekly trend first' }]);
  assert.deepEqual([alone.spec.retry_outputs, Object.hasOwn(alone.spec, 'vibes')], [undefined, false], 'a removal alone sends no vibe and no retry');
  assert.equal(I.validateImplementSpec(W.sentSpec(alone.spec, null, 3)).errors.length, 0);
});

test('the asks a part holds read one per line, with blank lines and spaces left out', async () => {
  const W = await lib('implementWizard.js');
  assert.deepEqual(W.heldAsks('  Dark header \n\n Rows first\r\nA map  '), ['Dark header', 'Rows first', 'A map']);
  assert.deepEqual([W.heldAsks(''), W.heldAsks(null), W.heldAsks(undefined)], [[], [], []]);
});

test('the Build page collects asks for the whole MVP, once each, and a held ask to take out, and reads what an older page kept per asset', async () => {
  const C = await lib('implementControl.js');
  let entries = C.collectAsk([], '  Answer in euros ');
  entries = C.collectAsk(entries, 'answer in EUROS');
  entries = C.collectAsk(entries, '   ');
  assert.deepEqual(entries, [{ kind: 'ask', text: 'Answer in euros' }], 'one ask once; spaces are no ask');
  entries = C.collectRemoval(entries, 'dashboard', 'Dashboard', 'Arabic labels');
  entries = C.collectRemoval(entries, 'dashboard', 'Dashboard', 'Arabic labels');
  assert.equal(entries.length, 2);
  assert.equal(C.vibeFeaturesLabel(entries), 'Vibe/Add/Remove Features (2)');
  assert.equal(C.vibeFeaturesLabel([]), 'Vibe/Add/Remove Features (0)');
  assert.equal(C.rebuildLabel(entries), 'Rebuild with 2 vibes');
  assert.equal(C.rebuildLabel(entries.slice(0, 1)), 'Rebuild with 1 vibe');
  assert.equal(C.rebuildLabel([]), 'Rebuild');
  entries = C.dropCollected(entries, entries[1]);
  assert.deepEqual(entries, [{ kind: 'ask', text: 'Answer in euros' }]);

  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  storage.setItem(C.COLLECTED_VIBES_KEY, JSON.stringify({ s: [
    { id: PAGE, label: 'Decisions page', text: 'Put the rows to act on first' },
    { id: 'notebook', label: 'notebook', text: 'Count returns by week' },
    { kind: 'ask', text: 'Answer in euros' },
    { kind: 'remove', id: 'dashboard', label: 'Dashboard', text: 'Arabic labels' },
    { kind: 'remove', id: '', label: '', text: 'no part' },
    { kind: 'ask', text: '' },
    'junk',
  ] }));
  assert.deepEqual(C.loadCollectedVibes('s', storage), [
    { kind: 'ask', text: 'Decisions page: Put the rows to act on first' },
    { kind: 'ask', text: 'Notebook: Count returns by week' },
    { kind: 'ask', text: 'Answer in euros' },
    { kind: 'remove', id: 'dashboard', label: 'Dashboard', text: 'Arabic labels' },
  ], 'a vibe an older page kept for one asset becomes an ask that names it, so the router sends it there');
  assert.equal(C.collectVibe, undefined, 'the per-asset collector is gone');
});

test('the Vibes step note and the outputs Genie does not build say there is one box for the whole MVP', async () => {
  const W = await lib('implementWizard.js');
  assert.match(W.VIBES_STEP_NOTE, /^Tell Genie what you want in your own words\. Your asks win over Inspire's defaults\. /);
  assert.match(W.VIBES_STEP_NOTE, /one box for the whole MVP/);
  assert.doesNotMatch(W.VIBES_STEP_NOTE, /Each box/);
  assert.equal(W.vibesSkippedText({ outputs: { dashboard: true, genie_space: true, app: true, alert: false } }),
    'Genie builds only what you picked in the Delivery step, so an ask for the Alert is not done. To vibe it, go Back to Delivery and pick it.');
  assert.equal(W.vibesEntries, undefined, 'no box per asset');
});
