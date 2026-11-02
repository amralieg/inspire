const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../lib/inspireImplement');
const { makeApp, listen } = require('./support/implementApp');

const OWNER = ['owner', 'example.com'].join('@');
const PERSON = ['pat.lee', 'example.com'].join('@');
const SP = { userName: '5d1e7c3a-9b2f-4e6a-8c4d-1f2e3a4b5c6d', displayName: 'app-q7k2m9 inspire-ai', applicationId: '5d1e7c3a-9b2f-4e6a-8c4d-1f2e3a4b5c6d' };
const DB = { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42' };
const Q = 'inspire_database=main.inspire&warehouse_id=wh1&session_id=42&use_case_id=N01-U01';
const NOT_KNOWN = 'Inspire could not tell who you are, so it cannot check that you own this MVP';
const BASE = {
  use_case_id: 'N01-U01',
  use_case_name: 'Predict churn',
  config: { warehouse_id: 'wh1', result_table: 'main.inspire.churn_out', widgets: { act_now_share: '0.05' } },
  outputs: { dashboard: true },
};
const MODEL = [{ name: 'act_now_share', label: 'Act now share', group: 'flagging', kind: 'percent', low: 0, high: 1, allowed: '0 to 1', source: 'widget',
  default: '0.05', reason: "Inspire's default", applies: 'run' }];
const WIDGETS = [{ name: 'act_now_share', type: 'text', default: '0.05', allowed: '0 to 1' }];

const builtRow = (createdBy, extra = {}) => ({
  session_id: '42', use_case_id: 'N01-U01', spec_version: 1, status: 'ready', created_by: createdBy, updated_at: '2026-10-21T04:00:00Z',
  spec_json: JSON.stringify(I.validateImplementSpec(I.withInspireUrl(BASE, 'https://inspire.example.com')).spec), notebook_path: '/W/impl/N01-U01', job_id: '77', dashboard_id: 'd1',
  genie_widgets: JSON.stringify(WIDGETS),
  asset_status: JSON.stringify({ dashboard: { state: 'ready', spec_version: 1 }, notebook: { state: 'ready', spec_version: 1, result_history: 1 }, settings: MODEL }),
  ...extra,
});

async function withApp(overrides, run) {
  const made = makeApp({ me: SP, tokenKind: 'app', ...overrides });
  const srv = await listen(made.app);
  try {
    await run(srv.url, made);
  } finally {
    await srv.close();
  }
}

async function call(base, url, { method = 'GET', body, headers = {} } = {}) {
  const resp = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: resp.status, data: await resp.json() };
}

const insertedBy = (made) => made.sqlCalls.filter((c) => String(c.sql).includes('INSERT INTO') && (c.parameters || []).some((p) => p.name === 'spec'))
  .map((c) => c.parameters.find((p) => p.name === 'by').value);
const settingsEdit = { ...BASE, based_on_version: 1, config: { ...BASE.config, widgets: { act_now_share: '0.1' } } };

test('on an App that runs as its service principal, the wizard and the spec row name the person the forwarded headers name, also by preferred user name alone', async () => {
  await withApp({}, async (url, made) => {
    const headers = { 'x-forwarded-preferred-username': PERSON };
    const context = await call(url, `/api/inspire/implement/context?${Q}`, { headers });
    assert.deepEqual(context.data.me, { username: PERSON, display_name: PERSON, source: 'forwarded_headers' });
    const got = await call(url, '/api/inspire/implement/submit', { method: 'POST', headers, body: { ...DB, spec: BASE } });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.deepEqual(insertedBy(made), [PERSON]);
  });
});

test('on an App that runs as its service principal with no forwarded person, the wizard names nobody and no version is recorded as the service principal\u2019s', async () => {
  await withApp({}, async (url, made) => {
    const context = await call(url, `/api/inspire/implement/context?${Q}`);
    assert.deepEqual(context.data.me, { username: '', display_name: '', source: 'service_principal', service_principal: SP.displayName });
    const got = await call(url, '/api/inspire/implement/submit', { method: 'POST', body: { ...DB, spec: BASE } });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.deepEqual(insertedBy(made), [''], 'the version names nobody as its asker, so no later owners check can match the service principal');
  });
});

test('an owners-only change refuses when only the service principal is known, even on a version an older build recorded as the service principal\u2019s', async () => {
  await withApp({ history: [builtRow(SP.userName)] }, async (url, made) => {
    const plan = await call(url, '/api/inspire/implement/plan', { method: 'POST', body: { ...DB, spec: settingsEdit } });
    assert.deepEqual([plan.status, plan.data.error], [403, NOT_KNOWN]);
    const submit = await call(url, '/api/inspire/implement/submit', { method: 'POST', body: { ...DB, spec: settingsEdit } });
    assert.deepEqual([submit.status, submit.data.error], [403, NOT_KNOWN]);
    assert.deepEqual([insertedBy(made), made.jobs.length], [[], 0]);
  });
  await withApp({ history: [builtRow(OWNER)] }, async (url) => {
    const owner = await call(url, '/api/inspire/implement/plan', { method: 'POST', headers: { 'x-forwarded-preferred-username': OWNER }, body: { ...DB, spec: settingsEdit } });
    assert.equal(owner.status, 200, JSON.stringify(owner.data));
    assert.deepEqual(owner.data.summary.classes, ['settings']);
  });
});

test('Publish anyway is not offered when only the service principal is known, even for a version recorded as the service principal\u2019s', async () => {
  const held = builtRow(SP.userName, { spec_version: 2, status: 'vibe_not_met', asset_status: JSON.stringify({ held: { parts: ['dashboard'], reason: 'r' } }) });
  await withApp({ history: [held, builtRow(OWNER)] }, async (url) => {
    const got = await call(url, `/api/inspire/implement/status?${Q}`);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(got.data.can_publish_held, false);
  });
  await withApp({ history: [{ ...held, created_by: PERSON }, builtRow(OWNER)] }, async (url) => {
    const got = await call(url, `/api/inspire/implement/status?${Q}`, { headers: { 'x-forwarded-preferred-username': PERSON } });
    assert.equal(got.data.can_publish_held, true, 'the person who asked for it, named by the forwarded headers');
  });
});

test('the permission checks still name the identity that ran them, the service principal, and never the person', async () => {
  await withApp({ accessError: 'PERMISSION_DENIED: You do not have CAN_USE on warehouse wh1' }, async (url) => {
    const got = await call(url, `/api/inspire/implement/preflight?${Q}&result_table=main.inspire.churn_out`, { headers: { 'x-forwarded-email': PERSON } });
    assert.equal(got.data.identity, SP.userName);
  });
});
