const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const lib = (name) => import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', name)).href);

const PAGE = 'app:page:decisions';
const WHO = ['lee', 'example.com'].join('@');

const ENTRIES = [
  { n: 1, requirement: 'Put the riskiest customers first', part: PAGE, where: 'records', status: 'met', evidence: 'The decision list sorts by risk', rounds: 1,
    tried: [], checks: [{ name: 'sorted by risk', passed: true }], published_anyway: null },
  { n: 2, requirement: 'Answer in euros', part: 'genie_space', where: '', status: 'not_met', evidence: 'The answers are in dollars', rounds: 3,
    tried: ['Asked Genie to answer in euros', 'Added a currency instruction', 'Converted the sample answers'], checks: [{ name: 'currency is EUR', passed: false }],
    published_anyway: null },
  { n: 3, requirement: 'A map by region', part: 'dashboard', where: 'first page', status: 'maybe', evidence: '', rounds: null, tried: 'not a list', checks: [null, { passed: true }] },
  'Count returns by week',
  null,
  { n: 0, requirement: '', part: 'notebook', status: 'not_met', evidence: 'The words were lost' },
];

const heldRow = (extra = {}) => ({
  session_id: '42', use_case_id: 'N01-U01', spec_version: 5, status: 'vibe_not_met',
  spec_json: { vibes: 'Put the riskiest customers first\nAnswer in euros\nA map by region', outputs: { genie_space_vibes: 'Answer in euros', [`${PAGE}_vibes`]: 'Put the riskiest customers first' } },
  asset_status: { checklist: ENTRIES, checklist_summary: { met: 1, total: 4 }, held: { parts: ['genie_space', PAGE, 'genie_space', ' '], reason: 'Genie could not answer in euros' },
    [PAGE]: { state: 'ready', name: 'Decisions' } },
  ...extra,
});

const built = (version, status = 'ready') => ({ spec_version: version, status, spec_json: { outputs: {} }, asset_status: {} });

const step = (version, status, payload, at, phase = 'Vibe checklist') => ({
  stage_name: 'Implement Use Cases', step_name: phase, status, message: '',
  result_json: ({ use_case_id: 'N01-U01', phase, spec_version: version, event_at: at, ...payload }),
});

test('a stored vibe checklist shows every entry with its words, part, place, met or not met, evidence, rounds, what was tried and the checks, and an entry with no words or an unknown status still shows, as not met', async () => {
  const P = await lib('mvpProgress.js');
  const list = P.vibeChecklist(null, heldRow());
  assert.deepEqual([list.live, list.version, list.total, list.met], [false, 5, 5, 1], 'five entries: a null entry is the only one left out');
  assert.deepEqual(list.entries.map((e) => [e.n, e.requirement, e.met]), [
    [1, 'Put the riskiest customers first', true], [2, 'Answer in euros', false], [3, 'A map by region', false], [4, 'Count returns by week', false], [5, '', false],
  ], 'an unknown status is never read as met, a plain string is an ask, and an entry with no number takes its place in the list');
  assert.deepEqual(list.entries[1].tried, ['Asked Genie to answer in euros', 'Added a currency instruction', 'Converted the sample answers']);
  assert.deepEqual([list.entries[0].checks, list.entries[2].checks, list.entries[2].tried], [[{ name: 'sorted by risk', passed: true }], [], []]);
  assert.equal(P.checklistHeadline(list), '1 of 5 vibe requirements met');
  assert.equal(P.checklistHeadline({ met: 0, total: 1 }), '0 of 1 vibe requirement met', 'the agent names one requirement for one ask');
  assert.equal(P.checklistHeadline({ met: 1, total: 1 }), '1 of 1 vibe requirement met');
  assert.equal(P.checklistHeadline({ met: 0, total: 0 }), '0 of 0 vibe requirements met');
  assert.equal(P.checklistHeadline({ met: 1, total: 2 }), '1 of 2 vibe requirements met');
  assert.equal(P.checklistHeadline({ met: 0, total: 0 }), '0 of 0 vibe requirements met');
  const assets = heldRow().asset_status;
  assert.deepEqual(list.entries.map((e) => P.checklistPlace(e, assets)), ['Decisions page, records', 'Genie Agent', 'Dashboard, first page', '', 'Notebook']);
  assert.deepEqual(list.entries.map(P.checklistRounds), ['Met after 1 round', 'Not met after 3 rounds', '', '', '']);
  assert.equal(P.vibeChecklist(null, heldRow({ asset_status: { checklist: JSON.stringify(ENTRIES.slice(0, 2)) } })), null,
    'the agent stores the list as a list inside the asset status, so JSON text there is not read as a checklist');
});

test('the live Vibe checklist step fills the checklist before the record lands, the record wins once it lands, and a step of another version or phase never fills it', async () => {
  const P = await lib('mvpProgress.js');
  const building = { spec_version: 5, status: 'building_outputs', asset_status: {} };
  const first = [{ requirement: 'Answer in euros', status: 'not_met' }];
  const later = [{ requirement: 'Answer in euros', status: 'met', rounds: 2 }, { requirement: 'A map by region', status: 'not_met' }];
  const steps = [
    step(5, 'started', {}, '2026-10-31T04:00:00Z'),
    step(5, 'ended_success', { checklist: later, met: 1, total: 2 }, '2026-10-31T04:02:00Z'),
    step(5, 'started', { checklist: first, met: 0, total: 1 }, '2026-10-31T04:01:00Z'),
  ];
  const live = P.vibeChecklist(steps, building);
  assert.deepEqual([live.live, live.met, live.total, live.entries.map((e) => e.requirement)], [true, 1, 2, ['Answer in euros', 'A map by region']], 'the newest step with a list fills it');
  const landed = P.vibeChecklist(steps, { ...building, status: 'vibe_not_met', asset_status: { checklist: ENTRIES.slice(1, 2) } });
  assert.deepEqual([landed.live, landed.entries.map((e) => e.requirement)], [false, ['Answer in euros']], 'the stored record wins once it lands');
  assert.equal(P.vibeChecklist([step(4, 'ended_success', { checklist: later }, '2026-10-31T04:03:00Z')], building), null, 'a step of v4 never fills the checklist of v5');
  assert.equal(P.vibeChecklist([step(5, 'ended_success', { checklist: later }, '2026-10-31T04:03:00Z', 'Vibe')], building), null, 'the Vibe routing step is not the checklist');
  assert.equal(P.vibeChecklist([step(5, 'started', {}, '2026-10-31T04:03:00Z')], building), null, 'a step with no list yet fills nothing');
  assert.equal(P.vibeChecklist(null, { spec_version: 3, status: 'ready', asset_status: {} }), null, 'a version with no checklist shows none');
  assert.deepEqual(P.vibeChecklist(null, { spec_version: 3, status: 'ready', asset_status: { checklist: [] } }).entries, []);
});

test('a not met ask published anyway says who published it and when, and is no longer an ask to rephrase or publish', async () => {
  const P = await lib('mvpProgress.js');
  const at = '2026-10-31T05:00:00Z';
  const list = P.vibeChecklist(null, { spec_version: 6, status: 'ready_with_warnings', asset_status: { checklist: [
    { requirement: 'Answer in euros', status: 'not_met', published_anyway: { by: WHO, at } },
    { requirement: 'A map by region', status: 'not_met', published_anyway: null },
    { requirement: 'Rows first', status: 'met' },
  ] } });
  assert.equal(P.publishedAnywayText(list.entries[0]), `Published anyway by ${WHO} on ${new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`);
  assert.deepEqual([P.publishedAnywayText(list.entries[1]), P.publishedAnywayText(list.entries[2])], ['', '']);
  assert.equal(P.publishedAnywayText({ publishedAnyway: { by: '', at: '' } }), 'Published anyway');
  assert.deepEqual(P.notMetAsks(list).map((e) => e.requirement), ['A map by region'], 'neither a met ask nor one published anyway is open');
});

test('a held version names the live version before it, or that nothing is live yet, and the parts Publish anyway puts live; any other status is not held', async () => {
  const C = await lib('implementControl.js');
  const P = await lib('mvpProgress.js');
  const row = heldRow();
  const held = C.heldVersion(row, [row, built(4), built(3, 'failed')]);
  assert.deepEqual(held, { version: 5, before: 4, parts: ['Genie Agent', 'Decisions page'], reason: 'Genie could not answer in euros' });
  assert.equal(P.checklistHeadline(P.vibeChecklist(null, row)), '1 of 5 vibe requirements met');
  const first = C.heldVersion({ ...row, spec_version: 1, asset_status: {} }, [{ ...row, spec_version: 1 }]);
  assert.deepEqual(first, { version: 1, before: null, parts: [], reason: '' });
  assert.equal(C.heldVersion(row, [row, built(4, 'uninstalled'), built(3)]).before, null, 'after Uninstall all nothing is live');
  for (const status of ['ready', 'ready_with_warnings', 'failed', 'queued', 'uninstalled', '']) {
    assert.equal(C.heldVersion({ ...row, status }, [row]), null, `${status || 'no status'} is not held`);
  }
});


test('the next spec takes a rephrased ask out of the part and the held vibe, drops an emptied vibe, and reports an ask nothing holds', async () => {
  const W = await lib('implementWizard.js');
  const C = await lib('implementControl.js');
  const spec = { vibes: 'Put the riskiest customers first\nAnswer in euros\nA map by region', data: { notes: '' }, outputs: { genie_space_vibes: 'Answer in euros\nName the rows' } };
  const entries = [
    { kind: 'ask', text: 'Answer in euros, rounded to cents\nput the riskiest customers FIRST' },
    { kind: 'remove', id: 'genie_space', label: 'Genie Agent', text: 'answer in EUROS' },
    { kind: 'remove', id: C.MVP_VIBES_ID, label: 'vibe of v5', text: 'A map by region' },
    { kind: 'remove', id: 'dashboard', label: 'Dashboard', text: 'Nothing holds this' },
  ];
  const got = W.withCollectedVibes(spec, entries);
  assert.equal(got.spec.vibes, 'Put the riskiest customers first\nAnswer in euros, rounded to cents', 'a line the vibe already holds is not added twice');
  assert.equal(got.spec.outputs.genie_space_vibes, 'Name the rows');
  assert.deepEqual([got.added, got.removed, got.gone, got.spec.retry_outputs], [1, 2, ['Nothing holds this'], undefined], 'a whole output is rebuilt by its vibe, not a part retry');
  const emptied = W.withCollectedVibes({ vibes: 'A map by region', data: {}, outputs: {} }, [{ kind: 'remove', id: C.MVP_VIBES_ID, label: 'vibe of v5', text: 'A map by region' }]);
  assert.deepEqual(['vibes' in emptied.spec, emptied.removed], [false, 1], 'a vibe whose every ask is taken out is not sent');
  const untouched = W.withCollectedVibes({ data: {}, outputs: { dashboard_vibes: 'Weekly bars' } }, [{ kind: 'remove', id: 'dashboard', label: 'Dashboard', text: 'Weekly bars' }]);
  assert.deepEqual(['vibes' in untouched.spec, untouched.spec.outputs.dashboard_vibes, untouched.removed], [false, '', 1], 'a Remove on a built version works as before');
});

test('while a version is held, each tab shows the cards of the live version before it, with its asks, never the held version\'s', async () => {
  const C = await lib('implementControl.js');
  const live = {
    spec_version: 4, status: 'ready', change_classes: 'outputs', dashboard_id: 'd1', genie_space_id: 'g1',
    spec_json: { outputs: { dashboard: true, genie_space: true, dashboard_vibes: 'Weekly bars', genie_space_vibes: '' }, data: { notes: 'Last 90 days' } },
    asset_status: { dashboard: { state: 'ready', spec_version: 4 }, genie_space: { state: 'ready', spec_version: 2 }, notebook: { spec_version: 2 } },
  };
  const held = {
    ...heldRow(), dashboard_id: 'd1', genie_space_id: 'g1',
    spec_json: { vibes: 'Answer in euros', outputs: { dashboard: true, genie_space: true, dashboard_vibes: 'Weekly bars\nA map by region', genie_space_vibes: 'Answer in euros' },
      data: { notes: 'Last 90 days\nHeld note' } },
  };
  const cards = C.vibeCards([held, live], held);
  const byId = Object.fromEntries(cards.map((card) => [card.id, card]));
  assert.deepEqual(cards.map((card) => card.id), ['notebook', 'dashboard', 'genie_space']);
  assert.deepEqual([byId.dashboard.vibes, byId.genie_space.vibes, byId.notebook.vibes], ['Weekly bars', '', 'Last 90 days'], 'the asks the live v4 was built with');
  assert.deepEqual([byId.dashboard.live.version, byId.genie_space.live.version, byId.dashboard.building], [4, 2, null]);
  assert.deepEqual(C.vibeCards([{ ...held, spec_version: 1 }], { ...held, spec_version: 1 }), [], 'a held first build has no live card');
  assert.deepEqual(C.vibeCards([held, { ...live, spec_version: 3, status: 'uninstalled' }, { ...live, spec_version: 2 }], held), [], 'after Uninstall all nothing is live');
});

test('the Build summary counts a held MVP as held, never as ready or failed', async () => {
  const C = await lib('implementControl.js');
  const W = await lib('implementWizard.js');
  const useCases = [{ No: 'N01', Name: 'Held one' }, { No: 'N02', Name: 'Ready one' }, { No: 'N03', Name: 'Failed one' }];
  const latest = [{ use_case_id: 'N01', status: 'vibe_not_met' }, { use_case_id: 'N02', status: 'ready' }, { use_case_id: 'N03', status: 'failed' }];
  const got = C.buildSummary(W.implementGroups(useCases, latest, null).flatMap((g) => g.items));
  assert.deepEqual([got.mvps, got.ready, got.held, got.failed], [3, 1, 1, 1]);
});

test('an older checklist entry the judge marked as not doable reads as a plain missing ask, and Try again sends it back to Genie', async () => {
  const C = await lib('implementControl.js');
  const checks = C.vibeChecks([
    { ask: 'A map by region', status: 'missing', evidence: 'The result table has no region column', doable: false },
    { ask: 'Bars by week', status: 'done', evidence: 'The chart is a weekly bar chart', doable: true },
  ]);
  assert.deepEqual(checks, [
    { ask: 'A map by region', done: false, evidence: 'The result table has no region column' },
    { ask: 'Bars by week', done: true, evidence: 'The chart is a weekly bar chart' },
  ], 'no doable verdict is read');
  assert.deepEqual(C.missingAsks(checks), ['A map by region']);
  assert.equal(C.checksSummary(checks), 'You asked for 2 things. Done: 1 of 2.');
});
