const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const I = require('../lib/inspireImplement');

const lib = (name) => import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', name)).href);

const ASK = 'Add a bar chart of trips by hour of day (0-23) to the App page, under Key numbers, titled Trips by pickup hour';
const REASON = 'the built App page has no chart titled Trips by pickup hour';
const spec = (outputs) => ({ outputs: { dashboard: false, genie_space: false, app: true, alert: false, ...outputs }, data: {} });
const row = (version, status, assets, outputs = {}, extra = {}) => ({
  session_id: '42', use_case_id: 'N02-U01', spec_version: version, status, created_by: 'someone', updated_at: `2026-11-0${version}T04:00:00Z`,
  spec_json: spec(outputs), job_id: '7', app_name: 'taxi-geo', app_url: 'https://taxi-geo.example.com', app_id: 'taxi-geo', asset_status: assets,
  ...extra,
});
const LIVE = row(4, 'ready', { notebook: { spec_version: 1, state: 'ready' }, app: { state: 'ready', spec_version: 4 } });
const HELD = row(5, 'vibe_not_met', {
  notebook: { spec_version: 1, state: 'ready' }, app: { state: 'ready', spec_version: 5 },
  checklist: [{ n: 1, requirement: ASK, part: 'app', status: 'not_met', evidence: REASON }], checklist_summary: { met: 0, total: 1 },
}, { app_vibes: ASK });

test('a held version keeps its not-met asks in the drawer as waiting with their reason', async () => {
  const C = await lib('implementControl.js');
  const cards = C.vibeCards([HELD, LIVE], HELD);
  const app = cards.find((card) => card.id === 'app');
  assert.ok(app, 'the App card is listed');
  assert.deepEqual(app.waiting, [{ ask: ASK, evidence: REASON, listed: false }]);
  const ready = C.vibeCards([LIVE], LIVE).find((card) => card.id === 'app');
  assert.deepEqual(ready.waiting, [], 'a ready version with every ask met has nothing waiting');
});

test('a Genie data stop is not offered a plain retry; other failures are', async () => {
  const W = await lib('implementWizard.js');
  const stop = row(1, 'failed', {}, {}, { status_message: 'Genie stopped the build: The outcome this use case predicts cannot be derived from the available data.' });
  assert.equal(W.dataStopped(stop), true);
  assert.match(W.DATA_STOP_HINT, /Change the ask/);
  assert.equal(W.dataStopped(row(1, 'failed', {}, {}, { status_message: 'the preview run did not write usable rows: SQL error' })), false);
  assert.equal(W.dataStopped(row(1, 'ready', {}, {}, { status_message: 'Genie stopped the build: x' })), false);
});

test('the status names the run of a failed build so the panel can link it', () => {
  assert.equal(I.implementBuildRunId(row(2, 'failed', {}, {}, { implement_run_id: '4650191', status_message: 'Genie stopped the build: x' })),
    '4650191');
  assert.equal(I.implementBuildRunId(row(2, 'failed', {}, {}, { implement_run_id: null })), null);
  assert.equal(I.implementBuildRunId(row(2, 'ready', {}, {}, { implement_run_id: '1' })), null, 'a ready build needs no run lookup');
  assert.equal(I.implementBuildRunId(row(2, 'filling', {}, {}, { implement_run_id: '1' })), null, 'a running build is read by the stall check');
  const ended = row(2, 'failed', {}, {}, { implement_run_id: '8398833',
    status_message: 'the run building v2 ended (CANCELED: Run cancelled by user) while v2 was still filling' });
  assert.equal(I.implementBuildRunId(ended), null, 'the stall check already reads the run of a cancelled build');
});
