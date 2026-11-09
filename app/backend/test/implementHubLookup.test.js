const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const I = require('../lib/inspireImplement');
const { makeApp, listen } = require('./support/implementApp');

const wizard = () => import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', 'implementWizard.js')).href);
const Q = 'inspire_database=main.inspire&warehouse_id=wh1&session_id=42&use_case_id=N01-U01';
const HUB = 'inspire-hub-acme';
const outputs = (extra = {}) => ({ app: true, app_access: 'sp', merge: { app: '', dashboard: '', genie_space: '' }, ...extra });
const row = (sid, uc, app, updated, extra = {}) => ({
  session_id: sid, use_case_id: uc, spec_version: 1, status: 'ready', updated_at: updated, asset_status: null, dashboard_id: null,
  genie_space_id: null, app_name: app, spec_json: JSON.stringify({ use_case_id: uc, use_case_name: `Case ${uc}`, outputs: outputs(extra) }),
});
const RECENT = Array.from({ length: 41 }, (_, i) => {
  const n = String(i + 10).padStart(2, '0');
  return row('42', `N${n}-U01`, `desk-${n}`, `2026-10-30T${String(i % 24).padStart(2, '0')}:00:00Z`, { app_placement: 'use_case' });
});
const HUB_ROWS = [row('7', 'N09-U01', HUB, '2026-09-01T00:00:00Z', { app_placement: 'business' }),
  row('7', 'N09-U02', HUB, '2026-09-02T00:00:00Z', { app_placement: 'business', merge: { app: HUB, dashboard: '', genie_space: '' } })];
const described = (name, uc, sid) => ({ name, description: `Inspire use case ${uc} (session ${sid}): Case ${uc}` });
const STATE = {
  registry: [...RECENT, ...HUB_ROWS],
  hubRows: HUB_ROWS,
  appsByName: Object.fromEntries([...RECENT.map((r) => [r.app_name, described(r.app_name, r.use_case_id, '42')]),
    [HUB, described(HUB, 'N09-U01', '7')]]),
  useCaseScope: [...RECENT, ...HUB_ROWS].map((r) => ({ session_id: r.session_id, use_case_id: r.use_case_id, business: 'Acme', domain: 'Customer' })),
};

async function targetsOf(state) {
  const { app, sqlCalls } = makeApp(state);
  const srv = await listen(app);
  try {
    const resp = await fetch(`${srv.url}/api/inspire/implement/merge-targets?${Q}`);
    return { status: resp.status, data: await resp.json(), sqlCalls };
  } finally {
    await srv.close();
  }
}

test('with 41 newer Apps the oldest App of all use cases of the business is still listed, and a new use case joins it', async () => {
  const got = await targetsOf(STATE);
  assert.equal(got.status, 200, JSON.stringify(got.data));
  const ids = got.data.targets.app.map((t) => t.id);
  assert.equal(ids.length, I.IMPLEMENT_MERGE_TARGET_CAP + 1, 'the picker keeps its cap, and the hub comes on top of it');
  assert.equal(ids[0], HUB);
  const hub = got.data.targets.app[0];
  assert.deepEqual([hub.placement, hub.use_cases.map((u) => u.business)], ['business', ['Acme', 'Acme']]);
  const w = await wizard();
  const uc = { id: 'N01-U01', Name: 'Predict churn', business_domain: 'Customer' };
  const spec = w.withAppAccess(w.withOutput(w.defaultSpecFromUseCase(uc, { businessName: 'Acme' }), 'app', true), 'sp');
  const scope = { business: 'Acme', domain: 'Customer', useCaseAppName: 'predict-churn' };
  const placed = w.withPlacementDefault(spec, got.data.targets, { ...scope, saved: 'business' });
  assert.equal(placed.outputs.merge.app, HUB);
  assert.notEqual(placed.outputs.app_name, `${HUB}-2`, 'a second App of all use cases is never made');
  const lookup = got.sqlCalls.find((c) => c.sql.includes('outputs.app_placement AS STRING'));
  assert.deepEqual(lookup.parameters, [{ name: 'sid', value: '42', type: 'BIGINT' }]);
});

test('without the direct lookup the capped list hides the old hub, which is what made a second one', async () => {
  const got = await targetsOf({ ...STATE, hubRows: [] });
  assert.ok(!got.data.targets.app.some((t) => t.id === HUB), 'the 40 most recent Apps leave the oldest out');
});

test('the hub lookup reads the tracking table by business directly, with no cap and no recency', () => {
  const { sql, parameters } = I.implementHubStatement('main', 'inspire', '42');
  assert.match(sql, /`main`\.`inspire`\.`__inspire_session`/);
  assert.match(sql, /m\.session_id = :sid/);
  assert.match(sql, /CAST\(a\.spec_json:outputs\.app_placement AS STRING\) = 'business' OR a\.app_name LIKE 'inspire-hub-%'/);
  assert.doesNotMatch(sql, /LIMIT/);
  assert.deepEqual(parameters, [{ name: 'sid', value: '42', type: 'BIGINT' }]);
  assert.match(I.implementRegistryStatement('`main`.`inspire`.`__inspire_implement`').sql, /LIMIT 5000$/, 'the picker list keeps its own bound');
});

test('hub entries come once, never the use case\'s own, only Apps of all use cases, and only the App a submitted spec names', () => {
  const rows = [...HUB_ROWS, row('7', 'N08-U01', 'fleet-desk', '2026-09-03T00:00:00Z', { app_placement: 'domain' }),
    row('42', 'N01-U01', 'inspire-hub-own', '2026-09-04T00:00:00Z', { app_placement: 'business' })].map(I.parseImplementRow);
  const opts = { sessionId: '42', useCaseId: 'N01-U01' };
  assert.deepEqual(I.withHubEntries([], rows, opts).map((e) => e.id), [HUB]);
  assert.deepEqual(I.withHubEntries([{ id: HUB, holders: [] }], rows, opts).map((e) => e.id), [HUB], 'a hub already listed stays where it is');
  assert.deepEqual(I.withHubEntries([], rows, { ...opts, only: { app: 'fleet-desk' } }), []);
  assert.deepEqual(I.withHubEntries([], rows, { ...opts, only: { app: HUB } }).map((e) => e.id), [HUB]);
});

test('the sessions Inspire reads business and domain for start with the hub, so a long list never leaves it unknown', () => {
  const many = Array.from({ length: 41 }, (_, i) => ({ id: `desk-${i}`, use_cases: [0, 1, 2].map((k) => ({ session_id: String(1000 + i * 3 + k) })) }));
  const hub = { id: HUB, placement: 'business', use_cases: [{ session_id: '7' }] };
  assert.ok(!I.scopeSessions([...many, hub]).includes('7'), 'more than 100 sessions leave the last App out');
  assert.equal(I.scopeSessions(I.hubsFirst([...many, hub]))[0], '7');
});

test('the backend and the wizard name the App of all use cases with the same prefix', async () => {
  const w = await wizard();
  assert.equal(I.IMPLEMENT_HUB_APP_PREFIX, w.HUB_APP_PREFIX);
});
