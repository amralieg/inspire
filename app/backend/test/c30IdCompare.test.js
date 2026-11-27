const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../lib/inspireImplement');
const { makeApp, listen } = require('./support/implementApp');

// REQ-569 leftover (c30_idcompare): every use case id compare accepts both forms (Nx-Ux saved, AIx-UCx asked, and the reverse),
// and still tells two different use cases apart.
const OWNER = ['owner', 'example.com'].join('@');
const QS = 'inspire_database=main.inspire&warehouse_id=wh1&session_id=42';
const PAIRS = [['N01-U02', 'AI01-UC02'], ['AI01-UC02', 'N01-U02']]; // [the id saved, the id asked]
const OTHERS = [['N01-U02', 'AI01-UC03'], ['AI01-UC02', 'N01-U03']]; // a different use case

for (const [saved, asked] of PAIRS) {
  test(`filterImplementSteps: asking ${asked} keeps the steps saved as ${saved} (payload, step name, sub step name)`, () => {
    const mk = (extra) => ({ stage_name: I.IMPLEMENT_OPERATION, step_name: 'Build', ...extra });
    const rows = [
      mk({ result_json: JSON.stringify({ use_case_id: saved }) }),
      mk({ step_name: `Build ${saved}`, result_json: 'not json' }),
      mk({ sub_step_name: `Spec ${saved}`, result_json: 'not json' }),
    ];
    assert.equal(I.filterImplementSteps(rows, asked).length, 3);
  });

  test(`registry: ${asked} owns the rows saved as ${saved}, so its own App is never offered as a merge target`, () => {
    const row = (sid, uc) => I.parseImplementRow({ session_id: sid, use_case_id: uc, spec_version: 1, status: 'ready', app_name: 'desk', spec_json: '{}' });
    const rows = [row('42', saved), row('7', 'N09-U09')];
    assert.deepEqual(I.mergeRegistry(rows, { sessionId: '42', useCaseId: asked }).app, []);
    const mine = I.sharedHolders(rows, { sessionId: '42', useCaseId: asked }).app;
    assert.ok(mine && mine.use_cases.length === 2, JSON.stringify(mine));
  });

  test(`resultTableHolderProblem: a holder saved as ${saved} is the same use case as ${asked}`, () => {
    assert.equal(I.resultTableHolderProblem('main.s.t', { session_id: '42', use_case_id: saved }, '42', asked), '');
  });

  test(`useCaseSchemaOwner: a schema held for ${saved} is ours for ${asked}`, () => {
    const owner = I.useCaseSchemaOwner({ exists: true, session: '42', useCase: saved }, { inspireDatabase: 'main.inspire', useCaseId: asked, sessionId: '42' });
    assert.equal(owner, 'ours');
  });
}

for (const [saved, asked] of OTHERS) {
  test(`different use case: ${asked} is not ${saved} (steps, registry, holder, schema)`, () => {
    const rows = [{ stage_name: I.IMPLEMENT_OPERATION, step_name: `Build ${saved}`, result_json: JSON.stringify({ use_case_id: saved }) }];
    assert.equal(I.filterImplementSteps(rows, asked).length, 0);
    const row = (sid, uc) => I.parseImplementRow({ session_id: sid, use_case_id: uc, spec_version: 1, status: 'ready', app_name: 'desk', spec_json: '{}' });
    assert.equal(I.mergeRegistry([row('42', saved), row('7', 'N09-U09')], { sessionId: '42', useCaseId: asked }).app.length, 1);
    assert.match(I.resultTableHolderProblem('main.s.t', { session_id: '42', use_case_id: saved }, '42', asked), /already holds the results/);
    assert.equal(I.useCaseSchemaOwner({ exists: true, session: '42', useCase: saved }, { inspireDatabase: 'main.inspire', useCaseId: asked, sessionId: '42' }), 'foreign');
  });
}

async function call(made, method, route, body) {
  const srv = await listen(made.app);
  try {
    const resp = await fetch(`${srv.url}${route}`, { method, headers: { 'Content-Type': 'application/json', 'x-forwarded-email': OWNER },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: resp.status, data: await resp.json() };
  } finally {
    await srv.close();
  }
}

const bound = (parameters, name) => ((parameters || []).find((p) => p.name === name) || {}).value;

for (const [saved, asked] of PAIRS) {
  test(`requireBuildSources: a spec saved for ${saved} is the spec of ${asked} (no 400 for a different form)`, async () => {
    const spec = { use_case_id: saved, use_case_name: 'Predict churn', config: { warehouse_id: 'wh1', result_table: 'main.inspire.churn_out' }, outputs: { dashboard: true } };
    const made = makeApp({ forwardedToken: 'person-tok' });
    const got = await call(made, 'POST', `/api/inspire/implement/grant-access?${QS}&use_case_id=${asked}&kind=source_tables`, { tables: ['main.s.orders'], spec });
    assert.doesNotMatch(String(got.data.error || ''), /the spec is for use case/, JSON.stringify(got.data));
  });

  test(`control log: ${asked} reads the log once, under the id the history holds (${saved})`, async () => {
    const spec = { use_case_id: saved, use_case_name: 'Predict churn', config: { warehouse_id: 'wh1', result_table: 'main.inspire.churn_out' }, outputs: { dashboard: true } };
    const history = [{ session_id: '42', use_case_id: saved, spec_version: 1, status: 'ready', created_by: OWNER, updated_at: '2026-10-21T04:00:00Z',
      spec_json: JSON.stringify(I.validateImplementSpec(I.withInspireUrl(spec, 'https://inspire.example.com')).spec) }];
    const made = makeApp({ history, statements: { 'FROM `main`.`inspire`.`__inspire_control_log` AS l': () => ({ rows: [] }) } });
    const got = await call(made, 'GET', `/api/inspire/implement/live?${QS}&use_case_id=${asked}`);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    const reads = made.sqlCalls.filter((c) => c.sql.includes('__inspire_control_log` AS l'));
    assert.deepEqual(reads.map((c) => bound(c.parameters, 'uc')), [saved]);
  });
}

for (const [saved, asked] of OTHERS) {
  test(`requireBuildSources: a spec for ${saved} is still refused for ${asked}`, async () => {
    const spec = { use_case_id: saved, use_case_name: 'Predict churn', config: { warehouse_id: 'wh1', result_table: 'main.inspire.churn_out' }, outputs: { dashboard: true } };
    const made = makeApp({ forwardedToken: 'person-tok' });
    const got = await call(made, 'POST', `/api/inspire/implement/grant-access?${QS}&use_case_id=${asked}&kind=source_tables`, { tables: ['main.s.orders'], spec });
    assert.equal(got.status, 400, JSON.stringify(got.data));
    assert.match(got.data.error, /the spec is for use case/);
  });
}
