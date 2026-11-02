const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../lib/inspireImplement');
const RP = require('../lib/routePolicy');
const { makeApp, listen } = require('./support/implementApp');

const OWNER = ['owner', 'example.com'].join('@');
const PERSON_TOKEN = 'person-token';
const SP = { userName: '5d1e7c3a-9b2f-4e6a-8c4d-1f2e3a4b5c6d', displayName: 'app-q7k2m9 inspire-ai', applicationId: '5d1e7c3a-9b2f-4e6a-8c4d-1f2e3a4b5c6d' };
const Q = 'inspire_database=main.inspire&warehouse_id=wh1&session_id=42&use_case_id=N01-U01';
const NO_SIGN_IN = 'Inspire looks for similar tables with your own sign-in, and this request carries none, so it suggests none';
const USE_CASE = { id: 'N01-U01', use_case: 'Predict churn', primary_table: 'main.s.orders', tables_involved: 'main.s.orders,main.s.returns', genie_instruction: '' };
const SPEC = {
  use_case_id: 'N01-U01', use_case_name: 'Predict churn', config: { warehouse_id: 'wh1', result_table: 'main.inspire.churn_out' },
  outputs: { dashboard: true }, data: { tables: { 'main.s.returns': 'main.s.returns_v2' } },
};
const BUILT = {
  session_id: '42', use_case_id: 'N01-U01', spec_version: 1, status: 'ready', created_by: OWNER, updated_at: '2026-10-21T04:00:00Z',
  spec_json: JSON.stringify(SPEC), asset_status: JSON.stringify({ dashboard: { state: 'ready', spec_version: 1 } }),
};
const V2 = { table_schema: 's', table_name: 'orders_v2', matched: '4', total: '4' };
const SECRET = { table_schema: 'hr', table_name: 'salaries', matched: '4', total: '4' };
const APP_ONLY = { me: SP, tokenKind: 'app', forwardedToken: '' };

async function withApp(overrides, run) {
  const made = makeApp({ useCase: USE_CASE, history: [BUILT], forwardedToken: PERSON_TOKEN, ...overrides });
  const srv = await listen(made.app);
  try {
    await run(srv.url, made);
  } finally {
    await srv.close();
  }
}

async function call(base, url, { method = 'GET', body } = {}) {
  const resp = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'x-forwarded-email': OWNER },
    body: body ? JSON.stringify(body) : undefined });
  return { status: resp.status, data: await resp.json() };
}

const swaps = (url, table = 'main.s.orders') => call(url, `/api/inspire/implement/swaps?${Q}`, { method: 'POST', body: { table, required_columns: [] } });
const swapReads = (made) => made.sqlCalls.filter((c) => String(c.sql).includes('WITH o AS'));
const readsOf = (made, pattern) => made.sqlCalls.filter((c) => pattern.test(String(c.sql)));
const columnReads = (made) => readsOf(made, /^SELECT column_name, data_type, ordinal_position FROM/);
const valueReads = (made) => readsOf(made, /^SELECT DISTINCT CAST/);

test('similar tables are looked up with the person\u2019s own token, so a table only the App can see never appears', async () => {
  const seen = { [PERSON_TOKEN]: [V2], tok: [V2, SECRET] };
  await withApp({ swapRowsByToken: seen }, async (url, made) => {
    const got = await swaps(url);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.deepEqual(got.data, { table: 'main.s.orders', swaps: [{ table: 'main.s.orders_v2', matched: 4, total: 4 }], why: '' });
    assert.deepEqual(swapReads(made).map((c) => c.token), [PERSON_TOKEN], 'read once, as the person');
  });
  await withApp({ swapRowsByToken: seen, forwardedToken: '' }, async (url, made) => {
    const got = await swaps(url);
    assert.deepEqual(got.data.swaps.map((s) => s.table), ['main.s.orders_v2', 'main.hr.salaries'], 'a request token of the person reads what that person sees');
    assert.deepEqual(swapReads(made).map((c) => c.token), ['tok']);
  });
});

test('with only the App\u2019s own token there are no suggestions, the reason says why, and nothing is read as the App', async () => {
  await withApp({ ...APP_ONLY, swapRowsByToken: { tok: [V2, SECRET] } }, async (url, made) => {
    const got = await swaps(url);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.deepEqual(got.data, { table: 'main.s.orders', swaps: [], why: NO_SIGN_IN });
    assert.equal(swapReads(made).length, 0);
    const bad = await swaps(url, 'not a table');
    assert.deepEqual([bad.status, bad.data.error], [400, "'not a table' must be catalog.schema.table"], 'a bad name is still refused first');
  });
});

test('columns and values of every table, the use case\u2019s own included, are read only with the person\u2019s token, and with none the picker gets the sign-in refusal and nothing is read', async () => {
  await withApp(APP_ONLY, async (url, made) => {
    for (const path of [`/api/inspire/implement/columns?${Q}&table=main.s.orders`, `/api/inspire/implement/columns?${Q}&table=main.hr.salaries`,
      `/api/inspire/implement/values?${Q}&table=main.s.orders&column=amount`, '/api/inspire/implement/values?warehouse_id=wh1&table=main.s.orders&column=amount']) {
      const got = await call(url, path);
      assert.deepEqual([got.status, got.data.error, got.data.policy && got.data.policy.identity], [401, RP.NO_PERSON_TOKEN, 'person'], path);
    }
    assert.deepEqual([...columnReads(made), ...valueReads(made)], [], 'nothing read as the App');
    assert.equal(made.sqlCalls.length, 0, 'not even the use case or its history');
  });
  await withApp({}, async (url, made) => {
    for (const table of ['main.s.orders', 'MAIN.S.RETURNS', 'main.hr.salaries']) {
      const got = await call(url, `/api/inspire/implement/columns?${Q}&table=${encodeURIComponent(table)}`);
      assert.equal(got.status, 200, `${table}: ${JSON.stringify(got.data)}`);
    }
    const values = await call(url, `/api/inspire/implement/values?${Q}&table=main.s.orders&column=amount`);
    assert.equal(values.status, 200, JSON.stringify(values.data));
    assert.deepEqual([...columnReads(made), ...valueReads(made)].map((c) => c.token), [PERSON_TOKEN, PERSON_TOKEN, PERSON_TOKEN, PERSON_TOKEN]);
  });
});

test('the swap lookup keeps its own no-sign-in reason', () => {
  assert.equal(I.IMPLEMENT_SWAPS_NO_SIGN_IN, NO_SIGN_IN);
});

const RUN_NO_SIGN_IN = 'Inspire checks with your own sign-in that you can read every table and file a run reads, and this request carries none, '
  + 'so it starts no run';
const cannotRead = (names) => `You cannot read ${names} with your own sign-in, and Inspire never reads for you what you cannot read: `
  + 'choose only tables and files you can read, or ask their owner for access';
const DB = { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42' };
const tableChecks = (made) => made.fetches.filter((f) => f.path.startsWith('/api/2.1/unity-catalog/tables/'));
const wrote = (made) => made.sqlCalls.some((c) => /^(INSERT|UPDATE)/.test(String(c.sql)));
const ruleOut = (made) => {
  assert.equal(wrote(made), false, 'no version row is written');
  assert.equal(made.jobs.length, 0, 'no MVP run starts');
};

test('an MVP run starts only when the person can read every source table with their own token, and is refused naming the others', async () => {
  const mine = { readableTables: { [PERSON_TOKEN]: ['main.s.orders'], tok: ['main.s.orders', 'main.s.returns_v2'] } };
  await withApp({ history: [], ...mine }, async (url, made) => {
    const got = await call(url, '/api/inspire/implement/submit', { method: 'POST', body: { ...DB, spec: SPEC } });
    assert.deepEqual([got.status, got.data], [403, { unreadable: ['main.s.returns_v2'], error: cannotRead('main.s.returns_v2') }]);
    ruleOut(made);
    assert.deepEqual(tableChecks(made).map((f) => `${f.token} ${f.path}`).sort(),
      [`${PERSON_TOKEN} /api/2.1/unity-catalog/tables/main.s.orders`, `${PERSON_TOKEN} /api/2.1/unity-catalog/tables/main.s.returns_v2`],
      'the swapped table is checked in place of the one it replaces, as the person');
  });
  await withApp({ history: [], readableTables: { [PERSON_TOKEN]: ['main.s.orders', 'MAIN.S.RETURNS_V2'] } }, async (url, made) => {
    const got = await call(url, '/api/inspire/implement/submit', { method: 'POST', body: { ...DB, spec: SPEC } });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(made.jobs.length, 1);
  });
  await withApp({ history: [], ...APP_ONLY }, async (url, made) => {
    const got = await call(url, '/api/inspire/implement/submit', { method: 'POST', body: { ...DB, spec: SPEC } });
    assert.deepEqual([got.status, got.data], [401, { unreadable: [], error: RUN_NO_SIGN_IN }]);
    ruleOut(made);
    assert.deepEqual(tableChecks(made), [], 'nothing is checked as the App');
  });
});

test('a re-run and Publish anyway are refused the same way, before run-now or a version row', async () => {
  const built = { ...BUILT, job_id: 77, genie_widgets: JSON.stringify([{ name: 'top_k', type: 'text', default: '25', allowed: 'whole number, at least 1' }]) };
  await withApp({ history: [built], readableTables: { [PERSON_TOKEN]: ['main.s.orders'] } }, async (url, made) => {
    const got = await call(url, `/api/inspire/implement/rerun?${Q}`, { method: 'POST', body: { overrides: {} } });
    assert.deepEqual([got.status, got.data.error, got.data.unreadable], [403, cannotRead('main.s.returns_v2'), ['main.s.returns_v2']]);
    assert.ok(!made.fetches.some((f) => f.path === '/api/2.1/jobs/run-now'));
  });
  await withApp({ history: [built], readableTables: { [PERSON_TOKEN]: ['main.s.orders', 'main.s.returns_v2'] } }, async (url, made) => {
    const got = await call(url, `/api/inspire/implement/rerun?${Q}`, { method: 'POST', body: { overrides: {} } });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.ok(made.fetches.some((f) => f.path === '/api/2.1/jobs/run-now'));
  });
  const held = { ...BUILT, spec_version: 2, status: 'vibe_not_met' };
  await withApp({ history: [held, BUILT], readableTables: { [PERSON_TOKEN]: ['main.s.orders'] } }, async (url, made) => {
    const spec = { ...SPEC, publish_held: 2, based_on_version: 2 };
    const got = await call(url, '/api/inspire/implement/publish?use_case_id=N01-U01', { method: 'POST', body: { ...DB, spec } });
    assert.deepEqual([got.status, got.data.unreadable], [403, ['main.s.returns_v2']], JSON.stringify(got.data));
    ruleOut(made);
  });
});

test('a Genie Code notebook run reads the session\u2019s UC Metadata, so it starts only when the person can read it, before any flag is written', async () => {
  const body = { ...DB, use_case_ids: ['N01-U01'], notebook_path: '/Shared/nb' };
  const generate = (url) => call(url, '/api/inspire/generate-genie', { method: 'POST', body });
  await withApp({ ucMetadata: 'main.s.orders,main.hr.salaries', readableTables: { [PERSON_TOKEN]: ['main.s.orders'] } }, async (url, made) => {
    const got = await generate(url);
    assert.deepEqual([got.status, got.data], [403, { error: cannotRead('main.hr.salaries'), unreadable: ['main.hr.salaries'] }]);
    assert.deepEqual([made.flagged, made.jobs], [[], []]);
  });
  await withApp({ ucMetadata: 'main.s.orders', ...APP_ONLY }, async (url, made) => {
    const got = await generate(url);
    assert.deepEqual([got.status, got.data], [401, { error: RUN_NO_SIGN_IN, unreadable: [] }]);
    assert.deepEqual([made.flagged, made.jobs], [[], []]);
  });
  await withApp({ ucMetadata: 'main.s.orders', readableTables: { [PERSON_TOKEN]: ['main.s.orders'] } }, async (url, made) => {
    const got = await generate(url);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(made.jobs.length, 1);
  });
});

test('the readiness count of any table reads only with the person\u2019s token', async () => {
  const count = (url, table) => call(url, `/api/inspire/implement/readiness?${Q}`, { method: 'POST', body: { table, discovery_type: 'Deep', columns: [] } });
  const counts = (made) => readsOf(made, /^SELECT COUNT\(\*\) AS row_count/).map((c) => c.token);
  await withApp(APP_ONLY, async (url, made) => {
    for (const table of ['main.s.orders', 'main.hr.salaries']) {
      const got = await count(url, table);
      assert.deepEqual([got.status, got.data.error], [401, RP.NO_PERSON_TOKEN], table);
    }
    assert.deepEqual(counts(made), [], 'nothing counted as the App');
  });
  await withApp({}, async (url, made) => {
    for (const table of ['main.s.orders', 'main.hr.salaries']) {
      const got = await count(url, table);
      assert.equal(got.status, 200, JSON.stringify(got.data));
    }
    assert.deepEqual(counts(made), [PERSON_TOKEN, PERSON_TOKEN]);
  });
});
