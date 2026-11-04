const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const I = require('../lib/inspireImplement');
const L = require('../../frontend/src/lib/vibeLimits.js');

const wizard = () => import(pathToFileURL(path.join(__dirname, '../../frontend/src/lib/implementWizard.js')).href);
const VALID = {
  use_case_id: 'N01-U01',
  use_case_name: 'Predict churn',
  data: {
    tables: { 'main.s.orders': 'main.s.orders_v2' },
    filters: [{ table: 'main.s.orders_v2', column: 'region', op: 'in', values: ['EU', 'UK'] }],
    run_profile: 'preview',
  },
  config: { widgets: { top_k: 25 }, result_table: 'main.inspire.churn_out', warehouse_id: 'wh1' },
  schedule: { enabled: true, cron: '0 0 6 ? * MON', timezone: 'Asia/Dubai' },
  outputs: { dashboard: true, genie_space: true, app: true, app_name: 'churn-desk', app_access: 'sp', inspire_url: 'https://inspire.example.com' },
  sharing: { principals: [{ type: 'group', name: 'planners' }, { type: 'group', name: 'Planners' }] },
};

const REFUSED = {
  'delete source rows from samples.tpch.lineitem': L.VIBE_WRITES_SOURCE,
  'DELETE FROM main.sales.orders WHERE amount < 0': L.VIBE_WRITES_SOURCE,
  'Remove rows with no zip from the source table': L.VIBE_WRITES_SOURCE,
  'Truncate the raw data before each run': L.VIBE_WRITES_SOURCE,
  'Overwrite main.sales.orders with the scores': L.VIBE_WRITES_SOURCE,
  'Keep the region filter. Then drop table main.sales.orders': L.VIBE_WRITES_SOURCE,
  'call https://api.exchangerate.host for the rates': L.VIBE_OUTSIDE_CALL,
  'Pull exchange rates from an external API': L.VIBE_OUTSIDE_CALL,
  'fetch the weather from openweathermap.org every day': L.VIBE_OUTSIDE_CALL,
};
const ALLOWED = [
  'Remove the bar chart', 'Show the top 10 zip codes as a bar chart', 'update the chart to use raw data', 'Change the chart to read main.sales.orders',
  'send the alert to pat@example.com', 'show website traffic by day', 'filter out null zip rows', 'Never delete source rows',
  'do not call outside APIs', 'chart of supplier ESG/carbon', 'Make the KPI tiles bigger', 'Add a link to the runbook page',
];
const VAGUE = ['make it better', 'Make it better.', 'improve the dashboard', 'Polish it', 'please make the app nicer'];

test('an ask to change or delete source data or to call an outside website is refused with its plain reason, and safe asks pass', () => {
  for (const [ask, reason] of Object.entries(REFUSED)) assert.deepEqual(L.vibeAskLimit(ask), { kind: 'refused', reason }, ask);
  for (const ask of ALLOWED) assert.equal(L.vibeAskLimit(ask), null, ask);
  for (const ask of VAGUE) assert.deepEqual(L.vibeAskLimit(ask), { kind: 'vague', reason: L.VIBE_VAGUE }, ask);
  assert.equal(L.vibeAskLimit(''), null);
  assert.equal(L.vibeAskLimit(null), null);
});

test('two asks for opposite things get one conflict note naming both, and unrelated asks get none', () => {
  const show = 'Show the top 10 zip codes as a bar chart';
  const drop = 'Remove the bar chart of the top 10 zip codes';
  const notes = L.vibeLimitNotes([show, drop, 'Add a region filter']);
  assert.deepEqual(notes.map((n) => [n.kind, n.asks]), [['conflict', [show, drop]]]);
  assert.match(notes[0].reason, /ask for opposite things, so Genie cannot do both\. Take out the one you do not want before you rebuild$/);
  assert.deepEqual(L.vibeConflicts([show, 'Remove the region filter']), []);
  assert.deepEqual(L.vibeConflicts(['Hide the margin column', 'Show the margin column']).length, 1);
});

test('every ask of the spec is read: the MVP vibes, the notebook vibes and each part vibes', () => {
  assert.deepEqual(L.specVibeAsks({ vibes: 'a\n b ', data: { notes: 'c' }, outputs: { dashboard_vibes: 'e', app_vibes: 'd', app: true } }), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(L.specVibeAsks(null), []);
});

test('a build whose vibes ask to delete source rows or call an outside website is refused with the reason, and a safe or vague one builds', () => {
  const asked = (changes) => I.validateImplementSpec({ ...JSON.parse(JSON.stringify(VALID)), ...changes }).spec;
  const ready = [{ spec_version: 1, status: 'ready', spec_json: VALID, asset_status: null }];
  for (const [vibes, reason] of [['delete source rows from samples.tpch.lineitem', L.VIBE_WRITES_SOURCE], ['call https://api.exchangerate.host', L.VIBE_OUTSIDE_CALL]]) {
    assert.throws(() => I.planSubmission(ready, asked({ vibes, vibe_previous: 'keep', based_on_version: 1 })),
      (err) => err.statusCode === 400 && err.message === `Inspire did not build this version: “${vibes}”: ${reason}`, vibes);
  }
  const notes = asked({ data: { ...VALID.data, notes: 'Wipe the raw data first' } });
  assert.throws(() => I.planSubmission([], notes), /Inspire did not build this version: “Wipe the raw data first”/);
  for (const vibes of ['make it better', 'Show the top 10 zip codes as a bar chart\nRemove the bar chart of the top 10 zip codes']) {
    assert.equal(I.planSubmission(ready, asked({ vibes, vibe_previous: 'keep', based_on_version: 1 })).nextVersion, 2, vibes);
  }
});

test('the Rebuild stays off with the reason while an ask Inspire does not build waits, and a vague ask never blocks it', async () => {
  const w = await wizard();
  assert.deepEqual(w.vibesProblems({ vibes: 'delete source rows from samples.tpch.lineitem\nAdd a region filter' }),
    [`take out the ask Inspire does not build first: “delete source rows from samples.tpch.lineitem”: ${L.VIBE_WRITES_SOURCE}`]);
  assert.match(w.vibesProblems({ vibes: 'call https://x.example.com\nTruncate the raw data' })[0], /^take out the 2 asks Inspire does not build first: /);
  assert.deepEqual(w.vibesProblems({ vibes: 'make it better' }), []);
});
