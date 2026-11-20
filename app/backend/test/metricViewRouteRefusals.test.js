// REQ-180, D-180A: the plan route refuses a metric view, and a table whose type cannot be read, by name, before any read of its
// rows. Plan reads the scope table's row count (the scope readiness count), a picked table swapped in (the owner table change)
// and the money rate table. Each refusal is a 400 with the plain line; a readable managed table still proceeds (pass-post guard).
const test = require('node:test');
const assert = require('node:assert/strict');
const MV = require('../lib/metricViews');
const I = require('../lib/inspireImplement');
const { makeApp, listen } = require('./support/implementApp');

const OWNER = ['owner', 'example.com'].join('@');
const PERSON_TOKEN = 'person-token';
const DB = { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42' };
const USE_CASE = { id: 'N01-U01', use_case: 'Predict churn', primary_table: 'main.s.orders', tables_involved: 'main.s.orders', genie_instruction: '' };
const SPEC = { use_case_id: 'N01-U01', use_case_name: 'Predict churn', config: { warehouse_id: 'wh1', result_table: 'main.inspire.churn_out' }, outputs: { dashboard: true } };
const RATE_TABLE = { table: 'main.fx.rates', currency_column: 'ccy', base_column: 'base_ccy', date_column: 'rate_date', rate_column: 'rate', load_column: 'loaded_at' };
const UNREADABLE_TYPE = { 'table_type FROM': { rows: [] } };
// Only the named table's type is unreadable; every other table is a managed table, so the rate table is the one refused.
const unreadableOnly = (table) => ({ 'table_type FROM': (_sql, parameters) => {
  const named = (parameters || []).find((p) => p.name === 't');
  return { rows: named && named.value === table ? [] : [{ table_type: 'MANAGED' }] };
} });

async function withApp(overrides, run) {
  const made = makeApp({ useCase: USE_CASE, forwardedToken: PERSON_TOKEN, forwardedEmail: OWNER, ...overrides });
  const srv = await listen(made.app);
  try {
    await run(srv.url, made);
  } finally {
    await srv.close();
  }
}

async function plan(url, spec = SPEC) {
  const resp = await fetch(`${url}/api/inspire/implement/plan`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...DB, spec }) });
  return { status: resp.status, data: await resp.json() };
}

// The statements that read a table's rows: any FROM the table, except the zero-row permission probe (SELECT * ... LIMIT 0), which
// reads no data. The information_schema type and column lookups name the catalog, not the table, so they never match.
const rowReadsOf = (made, table) => made.sqlCalls.filter((c) => String(c.sql).includes(`FROM ${table}`) && !/ LIMIT 0$/.test(String(c.sql)));
const countsOf = (made) => made.sqlCalls.filter((c) => /^SELECT COUNT\(\*\) AS row_count/.test(String(c.sql)));
// A built version by the owner: a picked table swapped in is an owner table change, read with the person's own sign-in.
const BUILT = { session_id: '42', use_case_id: 'N01-U01', spec_version: 1, status: 'ready', created_by: OWNER, updated_at: '2026-10-21T04:00:00Z',
  spec_json: JSON.stringify(I.validateImplementSpec(I.withInspireUrl(SPEC, 'https://inspire.example.com')).spec), notebook_path: '/W/impl/N01-U01',
  job_id: '77', dashboard_id: 'd1', asset_status: JSON.stringify({ dashboard: { state: 'ready', spec_version: 1 } }) };
const columnReads = (made) => made.sqlCalls.filter((c) => /^SELECT column_name, data_type, ordinal_position FROM/.test(String(c.sql)));
const UNKNOWN_LINE = /main\.s\.orders is not usable\. Inspire could not read this table's type/;
const ORDERS = '`main`.`s`.`orders`';

test('plan refuses a metric view scope table by name, before it counts its rows (fail-pre: the count ran)', async () => {
  await withApp({ metricViews: ['main.s.orders'] }, async (url, made) => {
    const got = await plan(url);
    assert.equal(got.status, 400, JSON.stringify(got.data));
    assert.equal(got.data.error, MV.metricViewRefusal('main.s.orders'), 'the named plain line, not a warning that the count failed');
    assert.deepEqual(countsOf(made), [], 'no row count ran on the metric view');
    assert.deepEqual(rowReadsOf(made, ORDERS), [], 'no statement read the metric view’s rows');
  });
});

test('plan refuses a scope table whose type cannot be read, by name, before it counts its rows (fail-pre: the count ran)', async () => {
  await withApp({ statements: UNREADABLE_TYPE }, async (url, made) => {
    const got = await plan(url);
    assert.equal(got.status, 400, JSON.stringify(got.data));
    assert.match(got.data.error, UNKNOWN_LINE);
    assert.deepEqual(countsOf(made), [], 'no row count ran on a table whose type is unknown');
    assert.deepEqual(rowReadsOf(made, ORDERS), []);
  });
});

test('plan still counts and proceeds for a readable managed scope table (pass-post guard)', async () => {
  await withApp({ readinessRows: [{ row_count: '1200' }] }, async (url, made) => {
    const got = await plan(url);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.deepEqual(got.data.warnings, []);
    const counts = countsOf(made);
    assert.equal(counts.length, 1, 'the scope table is counted once');
    assert.equal(counts[0].token, 'tok', 'counted with the App service principal token, the same for every person (REQ-418)');
  });
});

test('plan refuses a metric view as the money rate table, by name, before any rate read (fail-pre: plan let it through)', async () => {
  const spec = { ...SPEC, money: { currency: 'convert', base: 'AED', rate_table: RATE_TABLE } };
  await withApp({ metricViews: ['main.fx.rates'] }, async (url, made) => {
    const got = await plan(url, spec);
    assert.equal(got.status, 400, JSON.stringify(got.data));
    assert.equal(got.data.error, MV.metricViewRefusal('main.fx.rates'));
    assert.deepEqual(rowReadsOf(made, '`main`.`fx`.`rates`'), [], 'the rate table rows are never read');
  });
});

test('plan refuses a money rate table whose type cannot be read, by name (fail-pre: plan let it through)', async () => {
  const spec = { ...SPEC, money: { currency: 'convert', base: 'AED', rate_table: RATE_TABLE } };
  await withApp({ statements: unreadableOnly('rates') }, async (url, made) => {
    const got = await plan(url, spec);
    assert.equal(got.status, 400, JSON.stringify(got.data));
    assert.match(got.data.error, /rates is not usable\. Inspire could not read this table's type/);
    assert.deepEqual(rowReadsOf(made, '`main`.`fx`.`rates`'), []);
  });
});

test('plan still proceeds with a readable managed rate table (pass-post guard)', async () => {
  const spec = { ...SPEC, money: { currency: 'convert', base: 'AED', rate_table: RATE_TABLE } };
  await withApp({}, async (url) => {
    const got = await plan(url, spec);
    assert.equal(got.status, 200, JSON.stringify(got.data));
  });
});

test('plan refuses a metric view swapped in for a picked table, by name, before any column of it is read (fail-pre: plan let it through)', async () => {
  await withApp({ history: [BUILT], metricViews: ['main.s.orders_v2'], me: { userName: OWNER, displayName: 'Owner' } }, async (url, made) => {
    const got = await plan(url, { ...SPEC, data: { tables: { 'main.s.orders': 'main.s.orders_v2' } } });
    assert.equal(got.status, 400, JSON.stringify(got.data));
    assert.equal(got.data.error, MV.metricViewRefusal('main.s.orders_v2'));
    assert.deepEqual(columnReads(made), [], 'no column of the metric view is read');
  });
});

test('plan refuses a picked table swapped in whose type cannot be read, by name, before any column of it is read (fail-pre)', async () => {
  await withApp({ history: [BUILT], statements: unreadableOnly('orders_v2'), me: { userName: OWNER, displayName: 'Owner' } }, async (url, made) => {
    const got = await plan(url, { ...SPEC, data: { tables: { 'main.s.orders': 'main.s.orders_v2' } } });
    assert.equal(got.status, 400, JSON.stringify(got.data));
    assert.match(got.data.error, /orders_v2 is not usable\. Inspire could not read this table's type/);
    assert.deepEqual(columnReads(made), []);
  });
});

test('plan still reads a readable managed table swapped in for a picked table (pass-post guard)', async () => {
  await withApp({ history: [BUILT], me: { userName: OWNER, displayName: 'Owner' } }, async (url, made) => {
    const got = await plan(url, { ...SPEC, data: { tables: { 'main.s.orders': 'main.s.orders_v2' } } });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(got.data.summary.table_change_error, undefined);
    assert.ok(columnReads(made).length >= 1, 'the swapped-in managed table is read as before');
  });
});

// The submit path runs the same plan checks (prepareSubmission), so a readable managed rate table still builds. This guards the
// rate-table check from refusing every rate table: the check must name the table, not the rate-table object.
test('submit builds with a readable managed rate table, so the rate table check refuses only a metric view or unreadable type (regression guard)', async () => {
  const spec = { ...SPEC, money: { currency: 'convert', base: 'AED', rate_table: RATE_TABLE } };
  await withApp({ columns: [{ column_name: 'order_id', data_type: 'STRING', ordinal_position: 1 }] }, async (url, made) => {
    const resp = await fetch(`${url}/api/inspire/implement/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...DB, spec }) });
    const got = await resp.json();
    assert.equal(resp.status, 200, JSON.stringify(got));
    assert.equal(made.jobs.length, 1, 'the build started');
  });
});

// settings/run only proxies to the built App (no table read in this backend). The profiled main table is read by the Data groups
// profile route, which takes the same refusal before its first read, so the profile route carries the route-level check.
const PROFILE_Q = 'inspire_database=main.inspire&warehouse_id=wh1&session_id=42&use_case_id=N01-U01';
async function profile(url, table) {
  const resp = await fetch(`${url}/api/grouping/profile?${PROFILE_Q}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ table, scope_days: 30 }) });
  return { status: resp.status, data: await resp.json() };
}
const profileReads = (made) => made.sqlCalls.filter((c) => /approx_count_distinct|FROM `main`\.`s`\.`orders`/.test(String(c.sql))
  && !/ LIMIT 0$/.test(String(c.sql)));

test('the Data groups profile refuses a metric view as the profiled main table, by name, before any read (fail-pre)', async () => {
  await withApp({ metricViews: ['main.s.orders'] }, async (url, made) => {
    const got = await profile(url, 'main.s.orders');
    assert.equal(got.status, 400, JSON.stringify(got.data));
    assert.equal(got.data.error, MV.metricViewRefusal('main.s.orders'));
    assert.deepEqual(profileReads(made), [], 'no row of the metric view is read for groups');
  });
});

test('the Data groups profile refuses a main table whose type cannot be read, by name, before any read (fail-pre)', async () => {
  await withApp({ statements: UNREADABLE_TYPE }, async (url, made) => {
    const got = await profile(url, 'main.s.orders');
    assert.equal(got.status, 400, JSON.stringify(got.data));
    assert.match(got.data.error, UNKNOWN_LINE);
    assert.deepEqual(profileReads(made), []);
  });
});

test('the Data groups profile reads a readable managed main table (pass-post guard)', async () => {
  await withApp({}, async (url, made) => {
    const got = await profile(url, 'main.s.orders');
    assert.notEqual(got.status, 400, JSON.stringify(got.data));
    assert.ok(profileReads(made).length >= 1, 'the managed table is profiled as before');
  });
});

// A failed type lookup is classified once: a denial, a missing object or no type is permanent (one try, the named not-usable
// refusal); a busy workspace (HTTP 503) is retried once, and a lookup that stays busy is retryable, never shown as not usable.
const BUSY_LINE = /Inspire could not check the type of main\.s\.orders right now/;
const busyOnce = (calls) => ({ 'table_type FROM': () => {
  calls.n += 1;
  if (calls.n === 1) throw new Error('SQL failed (503): Service Unavailable');
  return { rows: [{ table_type: 'MANAGED' }] };
} });

test('a denied type lookup is permanent: one try, then the Permission Required payload (403), with no retry (REQ-313)', async () => {
  const calls = { n: 0 };
  const statements = { 'table_type FROM': () => {
    calls.n += 1;
    throw new Error('SQL failed (403): [PERMISSION_DENIED] User does not have USE CATALOG on Catalog main.');
  } };
  await withApp({ statements }, async (url, made) => {
    const got = await plan(url);
    assert.equal(got.status, 403, JSON.stringify(got.data));
    assert.ok(Array.isArray(got.data.permissions) && got.data.permissions.length > 0, 'the grants the person needs are named');
    assert.equal(calls.n, 1, 'a permanent denial is never retried');
    assert.deepEqual(countsOf(made), []);
  });
});

test('a busy type lookup that answers on the retry proceeds (the one retry is real)', async () => {
  const calls = { n: 0 };
  await withApp({ statements: busyOnce(calls), readinessRows: [{ row_count: '1200' }] }, async (url, made) => {
    const got = await plan(url);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(calls.n, 2, 'one busy answer, then one retry');
    assert.equal(countsOf(made).length, 1, 'the table is counted once the lookup answers');
  });
});

test('a type lookup still busy after the one retry is retryable with the plain line, never shown as not usable (fail-pre: it was not classified)', async () => {
  const calls = { n: 0 };
  const statements = { 'table_type FROM': () => {
    calls.n += 1;
    throw new Error('SQL failed (503): Service Unavailable');
  } };
  await withApp({ statements }, async (url, made) => {
    const got = await plan(url);
    assert.equal(got.status, 503, JSON.stringify(got.data));
    assert.match(got.data.error, BUSY_LINE);
    assert.doesNotMatch(got.data.error, /is not usable/, 'a busy workspace is not a verdict on the table');
    assert.equal(calls.n, 2, 'exactly one retry');
    assert.deepEqual(countsOf(made), []);
  });
});
