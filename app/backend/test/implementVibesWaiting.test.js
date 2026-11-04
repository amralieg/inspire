const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const lib = (name) => import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', name)).href);

const PAGE = 'app:page:n02_u01';
const ASK = 'Add a bar chart of trips by hour of day (0-23) to the App page, under Key numbers, titled Trips by pickup hour';
const REASON = 'built and checked, but not published: Genie built it in v3 and its checks passed, but publishing the App failed, so the live '
  + 'App does not have it and the ask waits for the next build: no filter reaches chart trips_by_pickup_hour (dataset hourly_pickups)';

const spec = (outputs) => ({ outputs: { dashboard: false, genie_space: false, app: true, alert: false, ...outputs }, data: {} });
const row = (version, status, assets, outputs = {}) => ({
  session_id: '42', use_case_id: 'N02-U01', spec_version: version, status, created_by: 'someone', updated_at: `2026-11-0${version}T04:00:00Z`,
  spec_json: spec(outputs), job_id: '7', app_name: 'taxi-geo', app_url: 'https://taxi-geo.example.com', asset_status: assets,
});
const CHECKLIST = (status, extra = {}) => ({ checklist: [{ n: 1, requirement: ASK, part: 'app', status, evidence: status === 'met' ? 'the chart is there' : REASON, ...extra }],
  checklist_summary: { met: status === 'met' ? 1 : 0, total: 1 } });
const V3 = (status, extra) => row(3, 'ready_with_warnings', {
  notebook: { spec_version: 1, state: 'ready' }, app: { state: 'failed', spec_version: 3, error: 'the v3 App no longer passes its checks' },
  [PAGE]: { state: 'failed', spec_version: 3, title: 'Trips', vibes_checks: [{ ask: ASK, status: status === 'met' ? 'done' : 'missing', evidence: REASON }] },
  ...CHECKLIST(status, extra) }, { [`${PAGE}_vibes`]: ASK });

test('the badge, the history and the counts read the agent verdict: a version whose vibe ask was not met never reads as ready', async () => {
  const W = await lib('implementWizard.js');
  const C = await lib('implementControl.js');
  const missed = V3('not_met');
  assert.deepEqual(W.openVibeAsks(missed), [{ requirement: ASK, part: 'app', evidence: REASON }]);
  assert.deepEqual(W.implementState(missed), { group: 'unmet', label: 'MVP vibes not met', tone: 'warning', kind: 'mvp' });
  assert.equal(W.historyStatus(missed, missed), 'built, but a vibe ask was not met');
  assert.equal(W.mvpBucketOf(W.implementState(missed)), 'held', 'the Vibes not met filter lists it');
  const summary = C.buildSummary([{ state: W.implementState(missed), latest: missed }]);
  assert.deepEqual([summary.ready, summary.unmet], [0, 1]);
  const [attention] = W.implementGroups([{ No: 'N02-U01', Name: 'Taxi' }], [missed], null).filter((g) => g.id === 'attention');
  assert.equal(attention.items.length, 1, 'it needs attention, it is not ready');

  const met = V3('met');
  assert.equal(W.implementState(met).label, 'MVP ready with warnings');
  assert.equal(W.historyStatus(met, met), 'ready_with_warnings');
  const anyway = V3('not_met', { published_anyway: { by: 'someone', at: '2026-11-04T10:00:00Z' } });
  assert.equal(W.implementState(anyway).label, 'MVP ready with warnings', 'a version published anyway is the user choice');
  const fixed = V3('not_met', { kind: 'self_fix' });
  assert.equal(W.implementState(fixed).label, 'MVP ready with warnings', 'a put-back element is no ask');
});

test('Built with marks an ask the agent found not met as waiting with its reason, and keeps a met ask as built', async () => {
  const C = await lib('implementControl.js');
  const missed = V3('not_met');
  const cards = C.vibeCards([missed, row(2, 'ready', { notebook: { spec_version: 1, state: 'ready' }, app: { state: 'ready', spec_version: 2 },
    [PAGE]: { state: 'ready', spec_version: 2, title: 'Trips' } })], missed);
  const page = cards.find((card) => card.id === PAGE);
  assert.ok(page, 'the App page card is listed');
  assert.deepEqual(page.waiting, [{ ask: ASK, evidence: REASON, listed: true }]);
  assert.deepEqual(C.waitingAsks([{ requirement: 'Show the trips by zone', part: PAGE, evidence: 'not done' }], PAGE, 'app', ASK),
    [{ ask: 'Show the trips by zone', evidence: 'not done', listed: false }], 'an ask the checklist split differently still shows as waiting');
  const met = V3('met');
  const metPage = C.vibeCards([met], met).find((card) => card.id === PAGE);
  assert.deepEqual(metPage ? metPage.waiting : [], []);
});
