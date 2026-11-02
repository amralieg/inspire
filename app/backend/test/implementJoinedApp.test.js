const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../lib/inspireImplement');
const C = require('../lib/implementControl');
const { makeApp, listen } = require('./support/implementApp');

const HUB = 'sales-hub';
const BUILDER = 'Inspire use case N01-U02 (session 42): Forecast demand';
const NOT_OURS = `the App named ${HUB} is no longer this use case's App`;
const SPEC = {
  use_case_id: 'N01-U01',
  use_case_name: 'Predict churn',
  config: { warehouse_id: 'wh1', result_table: 'main.inspire.churn_out' },
  outputs: { dashboard: true, app: true, app_name: HUB, genie_space: false, alert: false, merge: { app: HUB, dashboard: 'd9', genie_space: '' } },
};
const row = (version, { outputs = {}, asset_status = {}, ...extra } = {}) => ({
  session_id: '42', use_case_id: 'N01-U01', spec_version: version, status: 'ready', job_id: '77',
  spec_json: { ...SPEC, outputs: { ...SPEC.outputs, ...outputs } }, app_name: HUB, dashboard_id: 'd9', asset_status, ...extra,
});
const JOINED = row(2, { asset_status: { app: { state: 'ready', spec_version: 2, merged_into: HUB, page: 'n01_u01_s42' } } });
const ASKED = row(2, { asset_status: { app: { state: 'ready', spec_version: 2 } } });
const NEVER = row(2, { outputs: { merge: { app: '', dashboard: '', genie_space: '' } }, asset_status: { app: { state: 'ready', spec_version: 2 } } });
const TAKEN_OUT = row(3, { outputs: { app: false }, app_name: null,
  asset_status: { app: { state: 'released', merged_into: HUB, taken_out_of: HUB, stays_for: ['Forecast demand'] } } });
const HUB_APP = { name: HUB, description: BUILDER, url: 'https://sales-hub-1.aws.example.com', compute_status: { state: 'ACTIVE' }, app_status: { state: 'RUNNING' } };
const ok = (data) => ({ ok: true, status: 200, data });
const CTX = { useCaseId: 'N01-U01', sessionId: '42' };
const Q = 'inspire_database=main.inspire&warehouse_id=wh1&session_id=42&use_case_id=N01-U01';
const registry = (uc, name, extra) => ({
  session_id: '42', use_case_id: uc, spec_version: 1, status: 'ready', updated_at: '2026-10-26T00:00:00Z', asset_status: null,
  spec_json: JSON.stringify({ use_case_id: uc, use_case_name: name, outputs: { app: true, app_access: 'sp' } }), dashboard_id: null, genie_space_id: null, app_name: null,
  ...extra,
});
const REGISTRY = [
  { ...registry('N01-U01', 'Predict churn', { app_name: HUB, dashboard_id: 'd9' }), spec_version: 2 },
  registry('N01-U02', 'Forecast demand', { app_name: HUB, dashboard_id: 'd9' }),
  registry('N01-U03', 'Score leads', { app_name: HUB }),
];
const LIVE = {
  [`GET /api/2.0/apps/${HUB}`]: [HUB_APP], [`POST /api/2.0/apps/${HUB}/stop`]: [{}], [`POST /api/2.0/apps/${HUB}/start`]: [{}],
  'GET /api/2.1/jobs/get': [{ job_id: 77, settings: { tags: { dbx_inspire_ai_run_type: 'implement', dbx_inspire_ai_session_id: '42', dbx_inspire_ai_usecase_id: 'N01-U01' } } }],
  'GET /api/2.0/lakeview/dashboards/d9': [{ display_name: 'Sales board', lifecycle_state: 'ACTIVE' }], 'GET /api/2.0/lakeview/dashboards/d9/published': [{}],
  'DELETE /api/2.0/lakeview/dashboards/d9/published': [{}],
};

async function call(base, path, opts = {}) {
  const resp = await fetch(base + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: resp.status, data: await resp.json() };
}

async function withApp(overrides, fn) {
  const made = makeApp(overrides);
  const srv = await listen(made.app);
  try {
    await fn(srv.url, made);
  } finally {
    await srv.close();
  }
}

const wrote = (made, path) => made.fetches.some((f) => f.path === path && ['POST', 'DELETE'].includes(f.opts.method));
const logged = (made) => made.sqlCalls.some((c) => String(c.sql).startsWith('INSERT INTO `main`.`inspire`.`__inspire_control_log`'));

test('an App another use case built reads as this use case\'s App once this use case joined it, and names who built it', () => {
  const joined = I.appStatusFrom(ok(HUB_APP), { ...CTX, history: [JOINED] });
  assert.equal(joined.ok, true, JSON.stringify(joined));
  assert.equal(joined.name, HUB);
  assert.equal(joined.compute_state, 'ACTIVE');
  assert.deepEqual(joined.built_by, { use_case_id: 'N01-U02', session_id: '42', name: 'Forecast demand' });
  assert.equal(I.appStatusFrom(ok(HUB_APP), { ...CTX, history: [ASKED] }).ok, true, 'the merge target in the spec that holds the App is a join too');
  const own = I.appStatusFrom(ok({ ...HUB_APP, description: 'Inspire use case N01-U01 (session 42): Predict churn' }), { ...CTX, history: [JOINED] });
  assert.equal(own.ok, true);
  assert.equal(own.built_by, undefined, 'the App this use case built names no other builder');
});

test('an App this use case never joined, was taken out of, or that Inspire did not build still reads as not this use case\'s App', () => {
  assert.deepEqual(I.appStatusFrom(ok(HUB_APP), { ...CTX, history: [NEVER] }), { ok: false, error: NOT_OURS });
  assert.deepEqual(I.appStatusFrom(ok(HUB_APP), { ...CTX, history: [TAKEN_OUT, JOINED] }), { ok: false, error: NOT_OURS },
    'the newest record of the App says it was taken out, so the older join no longer counts');
  assert.deepEqual(I.appStatusFrom(ok({ ...HUB_APP, description: 'A tool the team built by hand' }), { ...CTX, history: [JOINED] }), { ok: false, error: NOT_OURS },
    'an App with no Inspire owner tag is never a join, whatever the record says');
  assert.deepEqual(I.appStatusFrom(ok({ ...HUB_APP, name: 'other-hub' }), { ...CTX, history: [JOINED] }),
    { ok: false, error: "the App named other-hub is no longer this use case's App" }, 'a join counts only for the App it names');
  assert.deepEqual(I.appStatusFrom(ok(HUB_APP), CTX), { ok: false, error: NOT_OURS }, 'with no record to read, only the builder passes');
});

test('the live status and the status of a use case that joined a shared App read the App, with who built it and who else holds it', async () => {
  await withApp({ history: [JOINED], registry: REGISTRY, responses: LIVE }, async (url) => {
    const live = await call(url, `/api/inspire/implement/live?${Q}`);
    assert.equal(live.status, 200, JSON.stringify(live.data));
    assert.equal(live.data.assets.app.ok, true, JSON.stringify(live.data.assets.app));
    assert.equal(live.data.assets.app.built_by.name, 'Forecast demand');
    assert.deepEqual(live.data.shared.app.use_cases.map((u) => u.name), ['Forecast demand', 'Score leads']);
    const status = await call(url, `/api/inspire/implement/status?${Q}`);
    assert.equal(status.status, 200, JSON.stringify(status.data));
    assert.equal(status.data.app_status.ok, true, JSON.stringify(status.data.app_status));
    assert.equal(status.data.app_status.built_by.use_case_id, 'N01-U02');
  });
});

test('stopping or starting a shared App is refused until the person confirms, and the refusal names every use case whose pages go with it', async () => {
  await withApp({ history: [JOINED], registry: REGISTRY, responses: LIVE }, async (url, made) => {
    const refused = await call(url, `/api/inspire/implement/control?${Q}`, { method: 'POST', body: { asset: 'app', action: 'stop' } });
    assert.equal(refused.status, 409, JSON.stringify(refused.data));
    assert.equal(refused.data.error, `Inspire did not stop the App: ${HUB} also holds the pages of Forecast demand and Score leads, and they stop with it; `
      + 'confirm to stop it for every use case in it');
    assert.equal(wrote(made, `/api/2.0/apps/${HUB}/stop`), false, 'nothing was stopped');
    assert.equal(logged(made), false, 'and nothing was recorded as done');
    const start = await call(url, `/api/inspire/implement/control?${Q}`, { method: 'POST', body: { asset: 'app', action: 'start' } });
    assert.equal(start.status, 409);
    assert.match(start.data.error, /and they start with it; confirm to start it for every use case in it$/);
    const stopped = await call(url, `/api/inspire/implement/control?${Q}`, { method: 'POST', body: { asset: 'app', action: 'stop', confirm_shared: true } });
    assert.equal(stopped.status, 200, JSON.stringify(stopped.data));
    assert.equal(stopped.data.message, 'Stop the App: done');
    assert.equal(wrote(made, `/api/2.0/apps/${HUB}/stop`), true);
  });
});

test('unpublishing a shared dashboard asks for the same confirm, and an App nobody else holds stops as it always did', async () => {
  await withApp({ history: [JOINED], registry: REGISTRY, responses: LIVE }, async (url, made) => {
    const refused = await call(url, `/api/inspire/implement/control?${Q}`, { method: 'POST', body: { asset: 'dashboard', action: 'unpublish' } });
    assert.equal(refused.status, 409);
    assert.equal(refused.data.error, 'Inspire did not unpublish the dashboard: d9 also holds the pages of Forecast demand, and they are unpublished with it; '
      + 'confirm to unpublish it for every use case in it');
    assert.equal(wrote(made, '/api/2.0/lakeview/dashboards/d9/published'), false);
    const done = await call(url, `/api/inspire/implement/control?${Q}`, { method: 'POST', body: { asset: 'dashboard', action: 'unpublish', confirm_shared: true } });
    assert.equal(done.status, 200, JSON.stringify(done.data));
  });
  const alone = REGISTRY.slice(0, 1);
  await withApp({ history: [JOINED], registry: alone, responses: LIVE }, async (url, made) => {
    const stopped = await call(url, `/api/inspire/implement/control?${Q}`, { method: 'POST', body: { asset: 'app', action: 'stop' } });
    assert.equal(stopped.status, 200, JSON.stringify(stopped.data));
    assert.equal(wrote(made, `/api/2.0/apps/${HUB}/stop`), true);
  });
});

test('when Inspire cannot read who else holds the App, a stop waits for a confirm that says so', async () => {
  await withApp({ history: [JOINED], registryError: 'warehouse is stopped', responses: LIVE }, async (url, made) => {
    const refused = await call(url, `/api/inspire/implement/control?${Q}`, { method: 'POST', body: { asset: 'app', action: 'stop' } });
    assert.equal(refused.status, 409);
    assert.equal(refused.data.error, 'Inspire did not stop the App: Inspire could not check whether other use cases hold pages in it (warehouse is stopped); '
      + 'confirm to stop it anyway');
    assert.equal(wrote(made, `/api/2.0/apps/${HUB}/stop`), false);
    assert.equal((await call(url, `/api/inspire/implement/control?${Q}`, { method: 'POST', body: { asset: 'app', action: 'stop', confirm_shared: true } })).status, 200);
  });
});

test('the shared-control refusal reads the holders W3\'s registry already returns, and asks nothing of a job, a build or a lone asset', () => {
  const shared = { app: { id: HUB, use_cases: [{ name: 'A' }, { use_case_id: 'N09-U09' }, { name: 'C' }, { name: 'D' }] }, dashboard: null, genie_space: null };
  assert.equal(C.sharedControlProblem('app', 'stop', HUB, shared, ''),
    `${HUB} also holds the pages of A, N09-U09 and 2 more use cases, and they stop with it; confirm to stop it for every use case in it`);
  assert.equal(C.sharedControlProblem('app', 'stop', HUB, { app: null }, ''), '');
  assert.equal(C.sharedControlProblem('job', 'cancel', '77', shared, 'boom'), '', 'a job is never shared');
  assert.equal(C.sharedControlProblem('build', 'cancel', '9', shared, ''), '');
  assert.equal(C.sharedControlProblem('dashboard', 'publish', 'd9', { dashboard: { id: 'd9', use_cases: [{ name: 'A' }] } }, ''),
    'd9 also holds the pages of A, and they are published with it; confirm to publish it for every use case in it');
});

test('a join counts only for the App it was made with, never for an App of the same name made again later', () => {
  const made = { ...HUB_APP, create_time: '2026-10-29T10:00:00Z' };
  const joinedThen = (created) => row(2, { asset_status: { app: { state: 'ready', spec_version: 2, merged_into: HUB, page: 'n01_u01_s42', created } } });
  assert.deepEqual(I.appStatusFrom(ok(made), { ...CTX, history: [joinedThen('2026-10-01T10:00:00Z')] }),
    { ok: false, error: `the App named ${HUB} was deleted and made again after this use case joined it, so this use case is not in it` });
  assert.equal(I.appStatusFrom(ok(made), { ...CTX, history: [joinedThen('2026-10-29T10:00:00Z')] }).ok, true, 'the App it joined still counts');
  assert.equal(I.appStatusFrom(ok(made), { ...CTX, history: [JOINED] }).ok, true, 'a join recorded without a time still counts');
  assert.equal(I.appStatusFrom(ok(HUB_APP), { ...CTX, history: [joinedThen('2026-10-01T10:00:00Z')] }).ok, true,
    'an App read without its time is not judged');
});
