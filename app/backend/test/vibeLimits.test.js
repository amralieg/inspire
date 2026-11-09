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

const SOURCE_SAFE = [
  'Clean up the raw data labels on the charts so they are easier to read', 'Clean up the labels', 'Clean the source data before charting it',
  'Update the labels from the source data', 'Update the chart titles to match the source table names', 'Drop the raw data column from the table on the App page',
  'Delete the raw data tile from the page', 'Insert a chart of the source data rows by month', 'Show the original records next to the scores',
  'Add a filter on the underlying table', 'Overwrite the chart colors with the brand palette', 'Remove the source data note from the footer',
  'Truncate long raw data labels to 20 characters', 'Alter the source table chart to a line chart', 'Update the raw data preview to show 20 rows',
  'Modify the source records chart to sort by date', 'Erase the original values legend from the chart', 'Update the chart to read the raw records',
  'Drop the source rows count KPI', 'Clean up the underlying data quality section', 'Delete the source tables list from the App page',
];
const SOURCE_UNSAFE = [
  'Delete the source rows', 'Drop the raw table', 'Update the source data', 'Overwrite the original records with the cleaned values',
  'Delete all of the raw data', 'Erase the underlying records every night', 'Purge raw rows older than a year', 'Wipe the raw data first',
  'Insert the scores into samples.tpch.lineitem', 'update main.sales.orders set flag = 1', 'Drop the raw data table',
  'Remove duplicate rows from the source table', 'Delete rows in the raw data where amount is null', 'Alter the source table to add a score column',
  'Update the original data so null zips become 00000', 'Truncate the underlying table before each run', 'Overwrite the source data.',
];

test('the source-data refusal needs an action on the source data itself, so asks about labels, charts or tiles that name it pass', () => {
  for (const ask of SOURCE_SAFE) assert.equal(L.vibeAskLimit(ask), null, ask);
  for (const ask of SOURCE_UNSAFE) assert.deepEqual(L.vibeAskLimit(ask), { kind: 'refused', reason: L.VIBE_WRITES_SOURCE }, ask);
  assert.deepEqual(L.vibeRefusals(SOURCE_SAFE), []);
  assert.equal(L.vibeRefusals([...SOURCE_SAFE, ...SOURCE_UNSAFE]).length, SOURCE_UNSAFE.length);
});

test('an ask held in both the MVP vibes and a part vibes is read once, so a refusal names each unsafe ask once', () => {
  const del = 'delete source rows from samples.tpch.lineitem';
  const call = 'call https://api.exchangerate.host for the rates';
  const spec = { vibes: `${del}\n${call}`, outputs: { notebook_vibes: `${del}\n${call}`, dashboard_vibes: ` ${call.toUpperCase()} ` } };
  assert.deepEqual(L.specVibeAsks(spec), [del, call]);
  const text = L.vibeRefusalText(L.vibeRefusals(L.specVibeAsks(spec)));
  assert.equal(text.split(del).length - 1, 1);
  assert.equal(text.split(call).length - 1, 1);
  const ready = [{ spec_version: 1, status: 'ready', spec_json: VALID, asset_status: null }];
  const built = I.validateImplementSpec({ ...JSON.parse(JSON.stringify(VALID)), vibes: `${del}\n${call}`, vibe_previous: 'keep', based_on_version: 1,
    outputs: { ...VALID.outputs, dashboard_vibes: `${del}\n${call}` } }).spec;
  assert.throws(() => I.planSubmission(ready, built), (err) => err.statusCode === 400 && err.message.split(del).length === 2 && err.message.split(call).length === 2);
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

test('an ask Inspire does not build never holds the Rebuild: it is taken out, named, and the rest of the vibes are sent', async () => {
  const w = await wizard();
  const spec = { vibes: 'delete source rows from samples.tpch.lineitem\nAdd a region filter', data: { notes: 'call https://x.example.com' }, outputs: { app: true, app_vibes: 'Truncate the raw data\nDark header' } };
  assert.deepEqual(w.vibesProblems(spec), []);
  const sent = w.withoutSkippedAsks(spec);
  assert.deepEqual([sent.vibes, sent.data.notes, sent.outputs.app_vibes], ['Add a region filter', '', 'Dark header']);
  assert.match(w.skippedAsksText(spec), /^Inspire builds without these 3 asks: /);
  assert.ok(w.skippedAsksText(spec).includes(L.VIBE_WRITES_SOURCE));
  assert.equal(w.skippedAsksText({ vibes: 'make it better' }), '');
  assert.equal(w.withoutSkippedAsks({ vibes: 'make it better' }).vibes, 'make it better', 'a vague ask is sent as written');
});

test('a long unbroken ask is checked for an email in well under a second and an email still is not an outside call', () => {
  const started = Date.now();
  assert.equal(L.vibeAskLimit('e'.repeat(200000)), null);
  assert.ok(Date.now() - started < 1000, `took ${Date.now() - started} ms`);
  assert.equal(L.vibeAskLimit(`${'e'.repeat(50)} mail the list to ops.team+alerts@example.com daily`), null);
  assert.equal(L.vibeAskLimit('fetch rates from api.example.com').reason, L.VIBE_OUTSIDE_CALL);
});
