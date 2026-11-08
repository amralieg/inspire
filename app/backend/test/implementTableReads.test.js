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

const { RUN_NO_SIGN_IN } = require('../lib/ucReads');
const cannotRead = (names) => `You can't read ${names}. Pick tables and files you can read, or ask their owner for access`;
const insertedSpec = (made) => JSON.parse(made.sqlCalls.find((c) => /^INSERT/.test(String(c.sql)) && String(c.sql).includes('__inspire_implement'))
  .parameters.find((p) => p.name === 'spec').value);
const DB = { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42' };
const tableChecks = (made) => made.fetches.filter((f) => f.path.startsWith('/api/2.1/unity-catalog/tables/'));
const wrote = (made) => made.sqlCalls.some((c) => /^(INSERT|UPDATE)/.test(String(c.sql)));
const ruleOut = (made) => {
  assert.equal(wrote(made), false, 'no version row is written');
  assert.equal(made.jobs.length, 0, 'no MVP run starts');
};

test('an MVP build drops a secondary table the person cannot read, says so, and is refused only when the primary table is unreadable (must-exclude)', async () => {
  const mine = { readableTables: { [PERSON_TOKEN]: ['main.s.orders'], tok: ['main.s.orders', 'main.s.returns_v2'] } };
  await withApp({ history: [], ...mine }, async (url, made) => {
    const plan = await call(url, '/api/inspire/implement/plan', { method: 'POST', body: { ...DB, spec: SPEC } });
    assert.equal(plan.status, 200, JSON.stringify(plan.data));
    assert.deepEqual(plan.data.warnings, ["Building without a table you can't read: main.s.returns_v2."]);
    const got = await call(url, '/api/inspire/implement/submit', { method: 'POST', body: { ...DB, spec: SPEC } });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.deepEqual(got.data.warnings, ["Building without a table you can't read: main.s.returns_v2."]);
    assert.equal(made.jobs.length, 1);
    const sent = insertedSpec(made);
    assert.deepEqual(sent.data.removed_tables, ['main.s.returns'], 'the original name of the swapped table is what the build leaves out');
    assert.deepEqual(sent.data.tables, {}, 'its swap is gone with it');
    assert.ok(tableChecks(made).every((f) => f.token === PERSON_TOKEN), 'checked as the person');
    assert.ok(tableChecks(made).some((f) => f.path === '/api/2.1/unity-catalog/tables/main.s.returns_v2'), 'the swapped table is checked in place of the one it replaces');
  });
  await withApp({ history: [], readableTables: { [PERSON_TOKEN]: ['main.s.returns_v2'] } }, async (url, made) => {
    const got = await call(url, '/api/inspire/implement/submit', { method: 'POST', body: { ...DB, spec: SPEC } });
    assert.deepEqual([got.status, got.data.unreadable], [403, ['main.s.orders']]);
    assert.equal(got.data.error, `${cannotRead('main.s.orders')}. It is the primary table, so Inspire cannot build without it.`);
    ruleOut(made);
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
    assert.deepEqual([got.status, got.data.error, got.data.unreadable], [403, cannotRead('main.s.returns_v2'), ['main.s.returns_v2']],
      'a re-run runs the built job as it is, so it cannot leave a table out');
    assert.ok(!made.fetches.some((f) => f.path === '/api/2.1/jobs/run-now'));
  });
  await withApp({ history: [built], readableTables: { [PERSON_TOKEN]: ['main.s.orders', 'main.s.returns_v2'] } }, async (url, made) => {
    const got = await call(url, `/api/inspire/implement/rerun?${Q}`, { method: 'POST', body: { overrides: {} } });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.ok(made.fetches.some((f) => f.path === '/api/2.1/jobs/run-now'));
  });
  const held = { ...BUILT, spec_version: 2, status: 'vibe_not_met' };
  await withApp({ history: [held, BUILT], readableTables: { [PERSON_TOKEN]: ['main.s.returns_v2'] } }, async (url, made) => {
    const spec = { ...SPEC, publish_held: 2, based_on_version: 2 };
    const got = await call(url, '/api/inspire/implement/publish?use_case_id=N01-U01', { method: 'POST', body: { ...DB, spec } });
    assert.deepEqual([got.status, got.data.unreadable], [403, ['main.s.orders']], JSON.stringify(got.data));
    ruleOut(made);
  });
});

test('a Genie Code notebook run checks only the chosen use cases\u2019 tables, not the whole Discover scope, before any flag is written (must-exclude)', async () => {
  const body = { ...DB, use_case_ids: ['N01-U01'], notebook_path: '/Shared/nb' };
  const generate = (url) => call(url, '/api/inspire/generate-genie', { method: 'POST', body });
  await withApp({ ucMetadata: 'main.s.orders,main.hr.salaries', readableTables: { [PERSON_TOKEN]: ['main.s.orders', 'main.s.returns'] } }, async (url, made) => {
    const got = await generate(url);
    assert.equal(got.status, 200, `a table elsewhere in the scope does not stop it: ${JSON.stringify(got.data)}`);
    assert.ok(!tableChecks(made).some((f) => f.path.includes('main.hr.salaries')), 'the rest of the scope is not checked');
    assert.deepEqual(tableChecks(made).map((f) => f.path).sort(), ['/api/2.1/unity-catalog/tables/main.s.orders', '/api/2.1/unity-catalog/tables/main.s.returns']);
  });
  await withApp({ ucMetadata: 'main.s.orders', readableTables: { [PERSON_TOKEN]: ['main.s.orders'] } }, async (url, made) => {
    const got = await generate(url);
    assert.deepEqual([got.status, got.data], [403, { error: cannotRead('main.s.returns'), unreadable: ['main.s.returns'] }]);
    assert.deepEqual([made.flagged, made.jobs], [[], []]);
  });
  await withApp({ ucMetadata: 'main.s.orders', ...APP_ONLY }, async (url, made) => {
    const got = await generate(url);
    assert.deepEqual([got.status, got.data], [401, { error: RUN_NO_SIGN_IN, unreadable: [] }]);
    assert.deepEqual([made.flagged, made.jobs], [[], []]);
  });
  await withApp({ ucMetadata: 'main.s.orders', readableTables: { [PERSON_TOKEN]: ['main.s.orders', 'main.s.returns'] } }, async (url, made) => {
    const got = await generate(url);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(made.jobs.length, 1);
  });
});

test('the readiness count of any table reads only with the person\u2019s token, in both discovery modes', async () => {
  const modes = { 'main.s.orders': 'Standard Discovery', 'main.hr.salaries': 'AI Enhanced Discovery' };
  const count = (url, table) => call(url, `/api/inspire/implement/readiness?${Q}`, { method: 'POST', body: { table, discovery_type: modes[table], columns: [] } });
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
      assert.equal(got.data.skipped, false, `${modes[table]} counts the rows before Genie starts`);
    }
    assert.deepEqual(counts(made), [PERSON_TOKEN, PERSON_TOKEN]);
  });
});

const ORDERS_COLUMNS = [{ column_name: 'order_id', data_type: 'STRING', ordinal_position: 1 }, { column_name: 'ref_code', data_type: 'STRING', ordinal_position: 2 },
  { column_name: 'cardNumber', data_type: 'STRING', ordinal_position: 3 }];
const PII_TAG = { catalog_name: 'main', schema_name: 's', table_name: 'orders', column_name: 'ref_code', tag_name: 'Data_Class', tag_value: 'PII' };
const tagReads = (made) => readsOf(made, /information_schema\.column_tags/);

test('the columns route returns each column\u2019s Unity Catalog tags, read once for the table, and marks a PII-tagged column with an innocent name as personal (must-exclude)', async () => {
  await withApp({ columnsByTable: { 'main.s.orders': ORDERS_COLUMNS }, columnTags: [PII_TAG] }, async (url, made) => {
    const got = await call(url, `/api/inspire/implement/columns?${Q}&table=main.s.orders`);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.deepEqual(got.data.columns.map((c) => [c.column_name, c.personal, c.tags]),
      [['order_id', false, {}], ['ref_code', true, { Data_Class: 'PII' }], ['cardNumber', true, {}]], 'untagged order_id stays allowed (must-keep)');
    assert.equal(got.data.tags_read, true);
    assert.equal(got.data.tags_note, undefined);
    assert.equal(tagReads(made).length, 1, 'one tag read for the table, no read per column');
    assert.deepEqual(tagReads(made).map((c) => c.token), [PERSON_TOKEN]);
  });
});

test('when the tags cannot be read the columns route falls back to the name rule and says so', async () => {
  await withApp({ columnsByTable: { 'main.s.orders': ORDERS_COLUMNS }, tagsError: '[INSUFFICIENT_PERMISSIONS] no USE on column_tags' }, async (url) => {
    const got = await call(url, `/api/inspire/implement/columns?${Q}&table=main.s.orders`);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.deepEqual(got.data.columns.map((c) => [c.column_name, c.personal]), [['order_id', false], ['ref_code', false], ['cardNumber', true]]);
    assert.deepEqual([got.data.tags_read, got.data.tags_note],
      [false, 'Inspire could not read the Unity Catalog tags of this table, so only column names are checked for personal data']);
  });
});

test('an MVP run is refused when its chosen result key is a PII-tagged column or a personal name, and starts with an untagged ordinary key', async () => {
  const readable = { readableTables: { [PERSON_TOKEN]: ['main.s.orders', 'main.s.returns_v2'] } };
  const keyed = (ref) => ({ ...SPEC, data: { ...SPEC.data, column_roles: { entity_id: ref } } });
  await withApp({ history: [], ...readable, columnTags: [PII_TAG] }, async (url, made) => {
    const got = await call(url, '/api/inspire/implement/submit', { method: 'POST', body: { ...DB, spec: keyed('main.s.orders.ref_code') } });
    assert.deepEqual([got.status, got.data.error], [400, I.personalKeyProblem('main.s.orders.ref_code')]);
    ruleOut(made);
  });
  await withApp({ history: [], ...readable }, async (url, made) => {
    const got = await call(url, '/api/inspire/implement/submit', { method: 'POST', body: { ...DB, spec: keyed('main.s.orders.cardNumber') } });
    assert.deepEqual([got.status, got.data.error], [400, I.personalKeyProblem('main.s.orders.cardNumber')], 'the name rule refuses before any read');
    ruleOut(made);
  });
  await withApp({ history: [], ...readable, columnTags: [PII_TAG] }, async (url, made) => {
    const got = await call(url, '/api/inspire/implement/submit', { method: 'POST', body: { ...DB, spec: keyed('main.s.orders.order_id') } });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(made.jobs.length, 1, 'an untagged ordinary key is allowed (must-keep)');
  });
});

test('an MVP run is refused when the result key Inspire picked itself is PII-tagged or a personal name, with no key chosen by the person (must-exclude)', async () => {
  const readable = { readableTables: { [PERSON_TOKEN]: ['main.s.orders', 'main.s.returns_v2'] } };
  const picked = (ref) => ({ ...USE_CASE, elite_assessment: JSON.stringify({ entity_key_column: ref }) });
  await withApp({ history: [], ...readable, columnTags: [PII_TAG], useCase: picked('main.s.orders.ref_code') }, async (url, made) => {
    const got = await call(url, '/api/inspire/implement/submit', { method: 'POST', body: { ...DB, spec: SPEC } });
    assert.deepEqual([got.status, got.data.error], [400, I.personalKeyProblem('main.s.orders.ref_code')]);
    ruleOut(made);
  });
  await withApp({ history: [], ...readable, useCase: picked('main.s.orders.cardNumber') }, async (url, made) => {
    const got = await call(url, '/api/inspire/implement/submit', { method: 'POST', body: { ...DB, spec: SPEC } });
    assert.deepEqual([got.status, got.data.error], [400, I.personalKeyProblem('main.s.orders.cardNumber')]);
    ruleOut(made);
  });
  await withApp({ history: [], ...readable, columnTags: [PII_TAG], useCase: picked('main.s.returns.order_id') }, async (url, made) => {
    const got = await call(url, '/api/inspire/implement/submit', { method: 'POST', body: { ...DB, spec: SPEC } });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(made.jobs.length, 1, 'an untagged key Inspire picked is allowed (must-keep)');
  });
  assert.equal(I.resultKeyRef(SPEC, picked('main.s.returns.order_id')), 'main.s.returns_v2.order_id', 'the picked key follows a swapped table');
});
