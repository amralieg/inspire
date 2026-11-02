const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const I = require('../lib/inspireImplement');
const C = require('../lib/implementControl');
const FIXTURE = require('./fixtures/implement_change_classes.json');

const lib = (name) => import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', name)).href);
const uninstallOf = (names, extra = {}) => ({ label: 'Remove from hub', target: 'hub', blocked: '', unknown: false,
  others: names.map(([use_case_id, name]) => ({ session_id: '42', use_case_id, name })), ...extra });
const STOP = { asset: 'app', action: 'stop', label: 'Stop the App' };

const holding = (names) => ({ app: { id: 'hub', use_cases: names.map((name) => ({ name })) } });

test('the backend prints every widget range as the wizard does, with two bounds joined by and', () => {
  const printed = FIXTURE.widget_ranges.allowed.filter(([, rule]) => rule);
  assert.ok(printed.some(([, , text]) => / and /.test(text)), 'the fixture holds a range with two bounds');
  for (const [text, rule, words] of printed) assert.equal(I.allowedText(rule), words, text);
  assert.equal(I.allowedText({ low: 0, high: null, whole: true }), 'whole number, at least 0');
  assert.equal(I.allowedText({ low: null, high: null, whole: false }), '');
});

test('the shared-control refusal names one, two and three use cases in full and caps four at two names', () => {
  const said = (names) => C.sharedControlProblem('app', 'stop', 'hub', holding(names), '');
  assert.equal(said(['A']), 'hub also holds the pages of A, and they stop with it; confirm to stop it for every use case in it');
  assert.equal(said(['A', 'B']), 'hub also holds the pages of A and B, and they stop with it; confirm to stop it for every use case in it');
  assert.equal(said(['A', 'B', 'C']), 'hub also holds the pages of A, B and C, and they stop with it; confirm to stop it for every use case in it');
  assert.equal(said(['A', 'B', 'C', 'D']), 'hub also holds the pages of A, B and 2 more use cases, and they stop with it; confirm to stop it for every use case in it');
  assert.equal(said([]), '');
});

test('the outputs a person unticked without deciding are named as one list, three of them as A, B and C', () => {
  const base = { use_case_id: 'N01-U01', use_case_name: 'Predict churn', config: { warehouse_id: 'wh1', result_table: 'main.inspire.churn_out' },
    outputs: { dashboard: true, genie_space: true, app: true, app_name: 'churn-desk', app_access: 'sp', alert: true, alert_recipients: ['owner@example.com'] } };
  const built = { spec_version: 1, status: 'ready', spec_json: base, asset_status: null, dashboard_id: 'd1', genie_space_id: 'g1', app_name: 'churn-desk' };
  const unticked = (outputs) => I.validateImplementSpec({ ...base, based_on_version: 1, outputs: { ...base.outputs, ...outputs } }).spec;
  const refusal = (outputs) => {
    try {
      I.planSubmission([built], unticked(outputs));
    } catch (err) {
      return [err.statusCode, err.message];
    }
    return null;
  };
  const tail = ', which you unticked; Inspire never deletes an output without asking';
  assert.deepEqual(refusal({ dashboard: false }), [400, `choose whether to delete or keep Dashboard${tail}`]);
  assert.deepEqual(refusal({ dashboard: false, app: false, genie_space: false }), [400, `choose whether to delete or keep Dashboard, Genie Agent and App${tail}`]);
});

test('joinAnd is the one list joiner of the backend', () => {
  assert.deepEqual([[], ['A'], ['A', 'B'], ['A', 'B', 'C']].map(I.joinAnd), ['', 'A', 'A and B', 'A, B and C']);
});

test('the Build page words a shared App or dashboard from the one part-word list, for every action and every holder', async () => {
  const W = await lib('implementControl.js');
  const two = uninstallOf([['N01-U02', 'Forecast demand'], ['N01-U03', 'Score leads']]);
  assert.equal(W.sharedControlText(STOP, two), "Inspire stops hub for every use case in it: the pages of Forecast demand and Score leads stop with this use case's pages.");
  assert.equal(W.sharedControlText({ asset: 'app', action: 'start' }, two),
    "Inspire starts hub for every use case in it: the pages of Forecast demand and Score leads start with this use case's pages.");
  assert.equal(W.sharedControlText({ asset: 'dashboard', action: 'unpublish' }, two),
    "Inspire unpublishes hub for every use case in it: the pages of Forecast demand and Score leads are unpublished with this use case's pages.");
  assert.equal(W.sharedControlText({ asset: 'dashboard', action: 'publish' }, two),
    "Inspire publishes hub for every use case in it: the pages of Forecast demand and Score leads are published with this use case's pages.");
  assert.equal(W.sharedControlText(STOP, uninstallOf([], { unknown: true })),
    'Inspire could not check whether other use cases hold pages in hub. If one does, its pages stop with it too.');
  const builder = { use_case_id: 'N01-U02', session_id: '42', name: 'Forecast demand' };
  assert.equal(W.sharedNote('app', two, builder), "This use case's pages are part of hub, which Forecast demand built. It also holds the pages of Score leads.");
  assert.equal(W.sharedNote('app', uninstallOf([['N01-U02', 'Forecast demand']]), builder), "This use case's pages are part of hub, which Forecast demand built.");
  assert.equal(W.sharedNote('app', uninstallOf([]), { use_case_id: 'N01-U02', session_id: '42', name: '' }), "This use case's pages are part of hub, which N01-U02 built.");
  assert.equal(W.sharedNote('dashboard', two, null), 'hub also holds the pages of Forecast demand and Score leads.');
  assert.equal(W.sharedNote('dashboard', uninstallOf([]), null), '');
  assert.equal(W.sharedNote('genie_space', two, null), '', 'a Genie Agent has no control to confirm, so its tab says nothing more');
  assert.equal(W.sharedNote('app', null, builder), '');
});

test('the Build page asks the shared confirm only for an App or dashboard that others hold or that Inspire could not check', async () => {
  const W = await lib('implementControl.js');
  const two = uninstallOf([['N01-U02', 'Forecast demand']]);
  assert.equal(W.sharedControlAsks(STOP, two), true);
  assert.equal(W.sharedControlAsks({ asset: 'dashboard', action: 'unpublish' }, two), true);
  assert.equal(W.sharedControlAsks(STOP, uninstallOf([], { unknown: true })), true);
  assert.equal(W.sharedControlAsks(STOP, uninstallOf([])), false, 'an App nobody else holds acts at once');
  assert.equal(W.sharedControlAsks(STOP, null), false, 'the demo has no uninstall, and its controls are off');
  assert.equal(W.sharedControlAsks({ asset: 'job', action: 'cancel' }, two), false);
  assert.equal(W.sharedControlAsks({ asset: 'build', action: 'cancel' }, two), false);
});

test('the backend joins every list through joinAnd and keeps no copy of its own', () => {
  const root = path.resolve(__dirname, '..');
  const files = ['.', 'lib'].flatMap((dir) => fs.readdirSync(path.join(root, dir)).filter((f) => f.endsWith('.js')).map((f) => path.join(dir, f)));
  const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
  const copies = files.flatMap((file) => [...read(file).matchAll(/\.slice\(0, -1\)\.join\(', '\)/g)].map(() => file));
  assert.deepEqual(copies, [path.join('lib', 'inspireImplement.js')], 'every list joins through joinAnd');
  assert.deepEqual(files.filter((file) => /function (namesText|andList)\b/.test(read(file))), []);
});

test('the frontend says which part of a shared output it means from the one part-word list', () => {
  const root = path.resolve(__dirname, '..', '..', 'frontend', 'src');
  const files = fs.readdirSync(root, { recursive: true }).filter((f) => /\.(js|jsx)$/.test(f));
  const holding = (pattern) => files.filter((f) => pattern.test(fs.readFileSync(path.join(root, f), 'utf8')));
  assert.deepEqual(holding(/tables, instructions and sample questions/), [path.join('lib', 'implementControl.js')]);
  assert.deepEqual(holding(/this use case's pages|holds the pages of|hold pages in|the pages of \$\{/), [], 'every shared sentence takes its part word from SHARED_PART_WORDS');
});
