const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, listen } = require('./support/implementApp');
const R = require('../lib/groupingRule');
const GP = require('../lib/groupingProfile');
const RP = require('../lib/routePolicy');
const U = require('../lib/ucReads');

const PERSON = 'person-tok';
const INJECTED = 'seg`) AS x FROM main.hr.salaries; DROP TABLE main.sales.orders; --';
const ASK = { inspire_database: 'main.inspire', session_id: '42', use_case_id: 'N01-U01', warehouse_id: 'wh1' };
const COLUMNS = [['order_id', 'STRING'], ['region', 'STRING'], ['country', 'STRING'], ['city', 'STRING'], ['sku', 'STRING'], [INJECTED, 'STRING'],
  ['ragged', 'STRING'], ['order_date', 'DATE'], ['amount', 'DOUBLE'], ['notes', 'STRING']].map(([column_name, data_type], i) => ({ column_name, data_type,
  ordinal_position: i + 1 }));
const COUNTRIES = [['EMEA', 'France', 2000], ['EMEA', 'Germany', 1963], ['EMEA', 'Cyprus', 12], ['EMEA', 'Malta', 25], ['AMER', 'USA', 3000],
  ['AMER', 'Canada', 500], ['APAC', 'Japan', 2380], ['APAC', 'Fiji', 20], ['LATAM', 'Brazil', 70], ['MEA', 'UAE', 30]];
const REGIONS = [['EMEA', 4000], ['AMER', 3500], ['APAC', 2400], ['LATAM', 70], ['MEA', 30]];
const AT = { region: 0, country: 1, city: 2, sku: 3, injected: 4, ragged: 5 };

function stats(over = {}) {
  return { records: '10000', d0: '5', n0: '0', d1: '10', n1: '0', d2: '900', n2: '0', d3: '501', n3: '0', d4: '600', n4: '0', d5: '3', n5: '6000',
    recent: '850', ...over };
}

function sample() {
  const size = (at, groups) => ({ kind: 'size', coarse: String(at), fine: '-1', groups: String(groups), records: '10000' });
  const nests = [];
  for (let a = 0; a < 6; a += 1) {
    for (let b = 0; b < 6; b += 1) if (a !== b) nests.push({ kind: 'nest', coarse: String(a), fine: String(b), groups: a === 0 && b === 1 ? '1' : '2', records: '0' });
  }
  return [size(0, 5), size(1, 10), size(2, 900), size(3, 501), size(4, 600), size(5, 4), ...nests];
}

function values() {
  const rows = [...REGIONS.map(([v, n]) => ({ col: '0', value: v, records: String(n) })), ...COUNTRIES.map(([, v, n]) => ({ col: '1', value: v, records: String(n) }))];
  for (let i = 0; i < 501; i += 1) rows.push({ col: '3', value: `sku-${i}`, records: i < 481 ? '20' : '19' });
  rows.push({ col: '5', value: null, records: '6000' }, { col: '5', value: 'A', records: '2000' }, { col: '5', value: 'B', records: '1000' }, { col: '5', value: '', records: '1000' });
  return rows;
}

function runner(over = {}) {
  const answers = {
    'information_schema.table_constraints': [{ constraint_type: 'PRIMARY KEY', constraint_name: 'pk', column_name: 'order_id', ordinal_position: '1' },
      { constraint_type: 'FOREIGN KEY', constraint_name: 'fk', column_name: 'customer_id', ordinal_position: '1', ref_catalog: 'main', ref_schema: 'crm',
        ref_table: 'customers', ref_column: 'id' }],
    'information_schema.columns': (_sql, parameters) => ({ rows: (parameters || []).some((p) => p.name === 't' && p.value === 'customers') ? [] : COLUMNS,
      manifest: {} }),
    approx_count_distinct: [stats()],
    'WITH s AS (SELECT': sample(),
    'AS col, left(': values(),
    'AS p0': COUNTRIES.map(([p0, p1, n]) => ({ p0, p1, records: String(n) })),
    ...over,
  };
  return Object.fromEntries(Object.entries(answers).map(([needle, out]) => [needle, (sql, _p, token) => {
    if (token !== PERSON) throw new Error(`the App token must never read the use case table: ${sql}`);
    if (typeof out === 'function') return out(sql, _p);
    return { rows: out, manifest: {} };
  }]));
}

function profiled(over = {}, answers = {}) {
  return makeApp({ forwardedToken: PERSON, forwardedEmail: 'amr@x', useCase: { id: 'N01-U01', primary_table: 'main.sales.orders',
    tables_involved: 'main.sales.orders, main.sales.stores', analytics_technique: 'Anomaly Detection' }, statements: runner(answers), ...over });
}

async function post(srv, body, signal) {
  const resp = await fetch(`${srv.url}/api/grouping/profile`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  return { status: resp.status, data: await resp.json() };
}

async function withApp(made, fn) {
  const srv = await listen(made.app);
  try {
    return await fn(srv);
  } finally {
    await srv.close();
  }
}

const tableReads = (calls) => calls.filter((c) => !c.sql.includes('__inspire_usecases') && !c.sql.includes('__inspire_implement'));

test('the profile reads the main table with the person token only, bounded, and answers the agreed shape', async () => {
  const made = profiled();
  await withApp(made, async (srv) => {
    const got = await post(srv, ASK);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    const d = got.data;
    assert.deepEqual(Object.keys(d), ['table', 'records', 'applies', 'qualifies', 'reason', 'standalone', 'columns', 'recommended', 'example', 'time_column', 'time_via', 'recent',
      'suggested_groups', 'group_column', 'group_sizes', 'groups_for', 'group_list', 'column_groups', 'first_run', 'default_scope', 'read_at', 'deep_suggestion']);
    assert.equal('prefill' in d, false, 'the profile carries no starting SQL, since Inspire runs no typed SQL');
    assert.deepEqual([d.table, d.records, d.applies, d.qualifies, d.standalone, d.deep_suggestion], ['main.sales.orders', 10000, true, true, false, null]);
    assert.equal(d.reason, 'Inspire recommends region, then country because Anomaly Detection works out what is normal inside each group, and country splits '
      + 'main.sales.orders into 10 groups.');
    assert.deepEqual(d.columns, [
      { name: 'region', type: 'STRING', distinct: 5, smallest: 30, largest: 4000, nulls: 0, parent: null },
      { name: 'country', type: 'STRING', distinct: 10, smallest: 12, largest: 3000, nulls: 0, parent: 'region' },
      { name: 'ragged', type: 'STRING', distinct: 3, smallest: 1000, largest: 7000, nulls: 6000, parent: null },
    ]);
    assert.deepEqual(d.recommended, ['region', 'country']);
    assert.deepEqual(d.example, { column: 'country', small_groups: [{ value: 'Malta', records: 25 }, { value: 'Cyprus', records: 12 }], moves_to: 'EMEA' });
    assert.deepEqual([d.time_column, d.time_via, d.recent], ['order_date', null, { days: 30, records: 850 }]);
    const part = (region, country) => [{ column: 'region', value: region }, { column: 'country', value: country }];
    assert.deepEqual(d.suggested_groups, [{ value: 'AMER / USA', records: 3000, kind: 'biggest', parts: part('AMER', 'USA') },
      { value: 'EMEA / Germany', records: 1963, kind: 'typical', parts: part('EMEA', 'Germany') }, { value: 'MEA / UAE', records: 30, kind: 'smallest', parts: part('MEA', 'UAE') }],
      'a nested grouping suggests AND groups: each names its region and its country');
    assert.equal(d.group_column, 'country');
    assert.ok(d.group_sizes.length > 0 && d.group_sizes.every((g) => g.records >= 30), 'whole groups are only groups of 30 records or more');
    assert.deepEqual(d.first_run, { all: 10000, groups: 4993, recent: 850, records: null });
    assert.equal(d.default_scope, 'records', 'more than 1,000 records, so the First run takes about 1,000 records in whole groups (decision 5B, 4A)');
    assert.equal(d.groups_for, 'region, country', 'with no Data groups asked, the groups listed are those of the recommended grouping');
    assert.equal(d.group_list.length, COUNTRIES.length, 'every group of the grouping is listed with its size, not only the suggested three');
    assert.deepEqual(d.group_list[0], { value: 'AMER / USA', records: 3000, parts: part('AMER', 'USA') });
    assert.ok(d.group_list.every((g, i) => i === 0 || d.group_list[i - 1].records >= g.records), 'largest group first');
    assert.deepEqual(Object.keys(d.column_groups), ['region', 'country', 'ragged']);
    assert.deepEqual(d.column_groups.region, REGIONS.map(([value, records]) => ({ value, records })).sort((a, b) => b.records - a.records));
    assert.ok(d.column_groups.ragged.every((g) => g.value != null), 'an empty value is no group to pick');
    assert.ok(!Number.isNaN(Date.parse(d.read_at)));
    const reads = tableReads(made.sqlCalls);
    assert.equal(reads.length, 8, reads.map((c) => c.sql.slice(0, 60)).join('\n'));
    assert.ok(reads.every((c) => c.token === PERSON), 'every read of the use case table is the person token');
    assert.ok(reads.every((c) => c.options.signal && c.options.byteLimit === GP.PROFILE_BYTE_LIMIT && c.options.rowLimit > 0 && c.options.waitTimeout === '10s'));
    assert.ok(made.sqlCalls.filter((c) => c.sql.includes('__inspire_usecases')).every((c) => c.token === 'tok'), 'the use case record is read with the App token');
    const stat = reads.find((c) => c.sql.includes('approx_count_distinct'));
    assert.match(stat.sql, /^WITH x AS \(SELECT date_sub\(MAX\(CAST\(`order_date` AS DATE\)\), 29\) AS inspire_since FROM `main`\.`sales`\.`orders`\) SELECT COUNT\(\*\) AS records, approx_count_distinct\(m\.`region`\) AS d0/);
    assert.match(stat.sql, /COUNT_IF\(CAST\(m\.`order_date` AS DATE\) >= x\.inspire_since\) AS recent FROM `main`\.`sales`\.`orders` m CROSS JOIN x$/,
      'the recent period ends at the newest date of the table, as the run reads it, not at today');
    assert.match(reads.find((c) => c.sql.startsWith('WITH s AS')).sql, /LIMIT 100000\)/, 'the coarse-to-fine check reads a bounded sample');
  });
});

test('First run lists the groups of the Data groups the person chose, and never of a column the profile did not keep (must-exclude)', async () => {
  for (const [groupBy, want] of [['region', 'region'], [' Region ', 'region'], ['country, region', 'country, region'], ['nope', 'region, country'],
    ['region, nope', 'region, country'], ['all', 'region, country'], ['sku', 'region, country']]) {
    const made = profiled();
    await withApp(made, async (srv) => {
      const got = await post(srv, { ...ASK, group_by: groupBy });
      assert.equal(got.status, 200, JSON.stringify(got.data));
      assert.equal(got.data.groups_for, want, groupBy);
      assert.deepEqual(got.data.recommended, ['region', 'country'], 'the recommendation stays what Inspire recommends, whatever the person chose');
      const finest = want.split(', ').pop();
      assert.ok(got.data.group_list.every((g) => g.parts.length === want.split(', ').length && g.parts[g.parts.length - 1].column === finest), groupBy);
      assert.equal(got.data.group_column, finest, 'a sample in whole groups takes whole groups of the chosen Data groups');
      const paths = tableReads(made.sqlCalls).filter((c) => c.sql.includes('AS p0'));
      assert.equal(paths.length, want.includes(',') ? 1 : 0, `${groupBy}: the combined groups are read only for a grouping of more than one column`);
    });
  }
  const one = profiled();
  await withApp(one, async (srv) => {
    const got = await post(srv, { ...ASK, group_by: 'region' });
    assert.deepEqual(got.data.group_list.map((g) => g.value), REGIONS.map(([v, n]) => [v, n]).sort((a, b) => b[1] - a[1]).map(([v]) => v));
    assert.deepEqual(got.data.suggested_groups.map((g) => g.parts[0].column), got.data.suggested_groups.map(() => 'region'));
    assert.equal(got.data.example, null, 'the example of the recommended grouping needs its combined groups, which this read did not take, so none is made up');
  });
});

test('a Deep discovery grouping on the use case comes back with the profile, and never for a technique that does not group (must-exclude)', async () => {
  const deep = { id: 'N01-U01', primary_table: 'main.sales.orders', analytics_technique: 'Anomaly Detection', suggested_group_by: ' stores.region , store_id, store_id',
    record_level: ' order_id ' };
  await withApp(profiled({ useCase: deep }), async (srv) => {
    const got = await post(srv, ASK);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.deepEqual(got.data.deep_suggestion, { columns: ['stores.region', 'store_id'], record_level: 'order_id' });
    assert.deepEqual(got.data.recommended, ['region', 'country'], 'the build-time profile is still read and answered beside it');
  });
  await withApp(profiled({ useCase: { ...deep, analytics_technique: 'Sentiment Analysis' } }), async (srv) => {
    assert.equal((await post(srv, ASK)).data.deep_suggestion, null);
  });
  assert.deepEqual(GP.deepSuggestionOf({ analytics_technique: 'Forecasting', suggested_group_by: 'store_id', record_level: '' }),
    { columns: ['store_id'], record_level: null });
  for (const empty of [{ ...deep, suggested_group_by: '' }, { ...deep, suggested_group_by: null }, { ...deep, suggested_group_by: 'all' },
    { ...deep, suggested_group_by: 'custom' }, null, undefined]) {
    assert.equal(GP.deepSuggestionOf(empty), null, JSON.stringify(empty));
  }
});

test('with only the App token the profile is a 401 with the shared sign-in answer and reads nothing (must-refuse)', async () => {
  const made = profiled({ forwardedToken: '', tokenKind: 'app' });
  await withApp(made, async (srv) => {
    const got = await post(srv, ASK);
    assert.equal(got.status, 401);
    assert.deepEqual(got.data, RP.noPersonTokenBody());
    assert.deepEqual(made.sqlCalls, []);
  });
});

test('a column name that carries SQL stays one quoted name in every statement (must-refuse)', async () => {
  const made = profiled();
  await withApp(made, async (srv) => {
    assert.equal((await post(srv, ASK)).status, 200);
    const asked = tableReads(made.sqlCalls).filter((c) => c.sql.includes('salaries'));
    assert.ok(asked.length >= 2, 'the statistics and the sample name the column');
    for (const c of asked) {
      assert.ok(c.sql.includes('`seg``) AS x FROM main.hr.salaries; DROP TABLE main.sales.orders; --`'), c.sql);
      const outside = c.sql.replace(/`(?:[^`]|``)*`/g, '');
      assert.doesNotMatch(outside, /;|DROP|salaries|--/, outside);
    }
    assert.ok(!made.sqlCalls.some((c) => /^\s*DROP/i.test(c.sql)));
  });
});

test('a column of 501 groups and one of about 900 are left out, and the second is never counted exactly (must-exclude)', async () => {
  const made = profiled();
  await withApp(made, async (srv) => {
    const got = await post(srv, ASK);
    const names = got.data.columns.map((c) => c.name);
    assert.ok(!names.includes('sku') && !names.includes('city') && !got.data.recommended.includes('sku'));
    const exact = tableReads(made.sqlCalls).find((c) => c.sql.includes('AS col, left('));
    assert.match(exact.sql, /GROUP BY m\.`sku`/, 'about 501 approximate values is counted exactly and then refused at 501');
    assert.doesNotMatch(exact.sql, /`city`/, 'about 900 approximate values is never grouped over the whole table');
    assert.ok(exact.options.rowLimit >= GP.PROFILE_VALUE_ROWS);
  });
});

test('a column with more than half its records empty is listed but never recommended (must-exclude)', () => {
  const base = { table: 'main.sales.orders', technique: 'Predictive Modeling', columns: [{ column_name: 'ragged', data_type: 'STRING' }], candidates: ['ragged'],
    sample: [{ kind: 'size', coarse: '0', fine: '-1', groups: '3', records: '10000' }], paths: null, time: null, days: 30, keys: { primary: [], joins: [] },
    joins: [], readAt: 'now', values: [{ col: '0', value: 'A', records: '2000' }, { col: '0', value: 'B', records: '2000' }, { col: '0', value: null, records: '6000' }] };
  const heavy = GP.profileView({ ...base, stats: { records: '10000', d0: '2', n0: '6000' } });
  assert.deepEqual([heavy.columns.map((c) => c.name), heavy.recommended, heavy.applies, heavy.qualifies], [['ragged'], [], true, false]);
  assert.match(heavy.reason, /^Inspire recommends the whole data as one group because no column of main\.sales\.orders or of a table it joins splits it into 2 to 500 groups/);
  const filled = GP.profileView({ ...base, stats: { records: '10000', d0: '2', n0: '4000' } });
  assert.deepEqual([filled.recommended, filled.qualifies], [['ragged'], true], 'the same column at 40% empty is recommended');
});

test('a person who cannot read the table gets a 403 that says so plainly, and nothing more runs', async () => {
  const hidden = profiled({}, { 'information_schema.columns': [] });
  await withApp(hidden, async (srv) => {
    const got = await post(srv, ASK);
    assert.deepEqual([got.status, got.data.error], [403, `${U.runUnreadableText(['main.sales.orders'])}.`]);
    assert.ok(!tableReads(hidden.sqlCalls).some((c) => c.sql.includes('approx_count_distinct')));
  });
  const denied = profiled({}, { approx_count_distinct: () => { throw new Error('[INSUFFICIENT_PERMISSIONS] User does not have SELECT on Table main.sales.orders.'); } });
  await withApp(denied, async (srv) => {
    const got = await post(srv, ASK);
    assert.deepEqual([got.status, got.data.error], [403, `${U.runUnreadableText(['main.sales.orders'])}.`]);
    assert.doesNotMatch(got.data.error, /INSUFFICIENT|\n/);
    assert.ok(!tableReads(denied.sqlCalls).some((c) => c.sql.includes('AS col, left(')));
  });
});

test('reads past the 60 second deadline are a 504 that says Inspire stopped', async () => {
  const made = profiled({}, { approx_count_distinct: () => { throw Object.assign(new Error('slow'), { code: 'SQL_DEADLINE' }); } });
  await withApp(made, async (srv) => {
    const got = await post(srv, ASK);
    assert.equal(got.status, 504);
    assert.equal(got.data.error, 'Inspire read main.sales.orders for Data groups for 60 seconds with no answer, so it stopped; try again once the warehouse is running.');
  });
});

test('when the caller leaves, the running read gets the cancel signal', { timeout: 10000 }, async () => {
  let release;
  let reached;
  const waiting = new Promise((resolve) => { reached = resolve; });
  const made = profiled({}, { approx_count_distinct: () => new Promise((resolve) => { release = resolve; reached(); }) });
  await withApp(made, async (srv) => {
    const leave = new AbortController();
    const asked = post(srv, ASK, leave.signal).catch((err) => err);
    let timer;
    await Promise.race([waiting, new Promise((_r, reject) => { timer = setTimeout(() => reject(new Error('the statistics read never started')), 5000); })])
      .finally(() => clearTimeout(timer));
    leave.abort();
    const signal = made.sqlCalls.find((c) => c.sql.includes('approx_count_distinct')).options.signal;
    for (let i = 0; i < 200 && !signal.aborted; i += 1) await new Promise((r) => setTimeout(r, 5));
    assert.equal(signal.aborted, true);
    release({ rows: [stats()], manifest: {} });
    assert.equal((await asked).name, 'AbortError');
  });
});

test('a small table runs everything, and a standalone technique with no group and no time column first runs on 1,000 records', async () => {
  const small = profiled({}, { approx_count_distinct: [stats({ records: '900' })] });
  await withApp(small, async (srv) => assert.equal((await post(srv, ASK)).data.default_scope, 'records', 'a small table never runs everything by default (must-exclude)'));
  const alone = profiled({ useCase: { id: 'N01-U01', primary_table: 'main.sales.orders', analytics_technique: 'Sentiment Analysis' } },
    { 'information_schema.columns': COLUMNS.filter((c) => c.data_type !== 'DATE'), 'AS col, left(': [] });
  await withApp(alone, async (srv) => {
    const got = await post(srv, ASK);
    assert.deepEqual([got.data.standalone, got.data.applies, got.data.qualifies, got.data.time_column, got.data.recent, got.data.suggested_groups],
      [true, false, false, null, null, []]);
    assert.deepEqual(got.data.first_run, { all: 10000, groups: null, recent: null, records: 1000 });
    assert.equal(got.data.default_scope, 'records');
    assert.match(got.data.reason, /^Data groups do not apply: Sentiment Analysis looks at each record on its own/);
  });
});

test('a built use case is profiled on the table its build swapped in, and bad input reads nothing', async () => {
  const swapped = profiled({ history: [{ session_id: '42', use_case_id: 'N01-U01', spec_version: 1, status: 'ready', created_by: 'amr@x',
    spec_json: JSON.stringify({ use_case_id: 'N01-U01', data: { tables: { 'Main.Sales.Orders': 'main.sales.orders_v2' } } }) }] });
  await withApp(swapped, async (srv) => {
    const got = await post(srv, ASK);
    assert.equal(got.data.table, 'main.sales.orders_v2', JSON.stringify(got.data));
    assert.ok(tableReads(swapped.sqlCalls).filter((c) => c.sql.includes('approx_count_distinct')).every((c) => c.sql.includes('`orders_v2`')));
  });
  for (const [body, said] of [[{ ...ASK, scope_days: 0 }, /^scope_days must be/], [{ ...ASK, scope_days: 'x' }, /^scope_days must be/],
    [{ ...ASK, session_id: 'abc' }, /^session_id must be/], [{ ...ASK, use_case_id: 'a b' }, /^That use case id is not one Inspire made/]]) {
    const made = profiled();
    await withApp(made, async (srv) => {
      const got = await post(srv, body);
      assert.equal(got.status, 400, JSON.stringify(body));
      assert.match(got.data.error, said);
      assert.deepEqual(made.sqlCalls, []);
    });
  }
  const none = profiled({ useCase: { id: 'N01-U01', primary_table: 'orders', analytics_technique: 'Anomaly Detection' } });
  await withApp(none, async (srv) => {
    const got = await post(srv, ASK);
    assert.equal(got.status, 400);
    assert.equal(got.data.error, 'Use case N01-U01 names no main table as catalog.schema.table, so Inspire cannot read it for Data groups.');
    assert.deepEqual(tableReads(none.sqlCalls), []);
  });
});

test('the profile helpers follow the agent: category columns only, the event date as time column, three suggested groups and a key guess', () => {
  assert.deepEqual(R.groupingCandidates(COLUMNS, { entity_id: 'main.sales.orders.order_id', segment: 'main.sales.orders.ragged' }, 'main.sales.orders'),
    ['ragged', 'region', 'country', 'city', 'sku', INJECTED]);
  assert.deepEqual(R.timeSourceOf('', COLUMNS), { column: 'order_date', via: null });
  assert.deepEqual(R.timeSourceOf(R.namedTimeColumn({ event_date: 'main.sales.orders.shipped' }, {}, 'main.sales.orders'),
    [...COLUMNS, { column_name: 'shipped', data_type: 'TIMESTAMP' }]), { column: 'shipped', via: null });
  assert.equal(R.timeSourceOf('', [{ column_name: 'a', data_type: 'STRING' }]), null);
  assert.deepEqual(R.suggestedGroups([{ value: 'a', records: 29 }, { value: 'b', records: 40 }]), [{ value: 'b', records: 40, kind: 'biggest' }],
    'a group under 30 records is never suggested');
  assert.equal(GP.scopeDaysOf(undefined), 30);
  assert.equal(GP.scopeDaysOf(3651), null);
});

const WS = 'samples.tpcds_sf1.web_sales';
const DD = 'samples.tpcds_sf1.date_dim';
const WS_COLUMNS = { web_sales: [['ws_sold_date_sk', 'INT'], ['ws_ship_date_sk', 'INT'], ['ws_warehouse_sk', 'INT'], ['ws_ext_ship_cost', 'DECIMAL(7,2)']],
  date_dim: [['d_date_sk', 'INT'], ['d_date_id', 'STRING'], ['d_date', 'DATE']] };
const WS_JOINS = JSON.stringify(['ws_sold_date_sk', 'ws_ship_date_sk'].map((column) => ({ table: WS, column, ref_table: DD, ref_column: 'd_date_sk', source: 'inferred' })));
const WS_ELITE = JSON.stringify({ time_column: `${WS}.ws_ship_date_sk`, time_via_join: { key: `${WS}.ws_ship_date_sk`, table: DD, column: `${DD}.d_date`,
  join: `${WS}.ws_ship_date_sk = ${DD}.d_date_sk` } });

function webSales({ records, recent = '21000', keys = '30', joins = WS_JOINS, elite = WS_ELITE } = {}) {
  const columns = (sql, parameters) => ({ rows: (WS_COLUMNS[(parameters || []).find((p) => p.name === 't').value] || [])
    .map(([column_name, data_type], i) => ({ column_name, data_type, ordinal_position: i + 1 })), manifest: {} });
  return profiled({ useCase: { id: 'N01-U01', primary_table: WS, tables_involved: `${WS}, ${DD}`, analytics_technique: 'Optimization', table_joins: joins,
    elite_assessment: elite } }, {
    'information_schema.table_constraints': [],
    'information_schema.columns': columns,
    approx_count_distinct: [{ records: String(records), recent, recent_keys: keys, d0: '0', n0: '0' }],
  });
}

for (const [records, expected] of [[999, 'records'], [1000, 'records'], [1001, 'records'], [718931, 'records']]) {
  test(`a fact table dated only through its date table offers a recent period, and ${records.toLocaleString('en-US')} records default to ${expected}, never recent or everything`,
    async () => {
      const made = webSales({ records });
      await withApp(made, async (srv) => {
        const got = await post(srv, ASK);
        assert.equal(got.status, 200, JSON.stringify(got.data));
        const d = got.data;
        assert.deepEqual([d.records, d.time_column, d.time_via, d.recent], [records, 'ws_ship_date_sk', { table: DD, key: 'd_date_sk', date: 'd_date' },
          { days: 30, records: 21000 }]);
        assert.deepEqual(d.first_run, { all: records, groups: null, recent: 21000, records: null });
        assert.equal(d.default_scope, expected);
        const stat = tableReads(made.sqlCalls).find((c) => c.sql.includes('approx_count_distinct'));
        assert.equal(stat.sql, 'WITH x AS (SELECT MAX(CAST(r.`d_date` AS DATE)) AS inspire_newest FROM `samples`.`tpcds_sf1`.`web_sales` m JOIN '
          + '`samples`.`tpcds_sf1`.`date_dim` r ON m.`ws_ship_date_sk` = r.`d_date_sk`), k AS (SELECT DISTINCT r.`d_date_sk` AS inspire_key FROM '
          + '`samples`.`tpcds_sf1`.`date_dim` r CROSS JOIN x WHERE CAST(r.`d_date` AS DATE) >= date_sub(x.inspire_newest, 29) AND CAST(r.`d_date` AS DATE) '
          + '<= x.inspire_newest AND r.`d_date_sk` IS NOT NULL), kc AS (SELECT COUNT(*) AS inspire_keys FROM k) SELECT COUNT(*) AS records, '
          + "approx_count_distinct(m.`ws_warehouse_sk`) AS d0, COUNT_IF(m.`ws_warehouse_sk` IS NULL OR TRIM(CAST(m.`ws_warehouse_sk` AS STRING)) = '') AS n0, "
          + 'COUNT(k.inspire_key) AS recent, MAX(kc.inspire_keys) AS recent_keys FROM `samples`.`tpcds_sf1`.`web_sales` m CROSS JOIN kc LEFT JOIN k '
          + 'ON m.`ws_ship_date_sk` = k.inspire_key');
        const asked = tableReads(made.sqlCalls).filter((c) => c.sql.includes('information_schema.columns')).map((c) => c.parameters[1].value);
        assert.deepEqual(asked, ['web_sales', 'date_dim'], 'the one date table the keys join is read for its columns, once');
      });
    });
}

test('the profile answers about 1,000 records as the first run whatever the table holds, never everything, as the agent does (must-exclude)', () => {
  assert.equal(R.FIRST_RUN_DEFAULT, 'records');
  const base = { table: 'main.sales.orders', technique: 'Anomaly Detection', columns: [], candidates: [], sample: [], values: [], paths: null, time: null, days: 30 };
  for (const records of [undefined, null, '', 0, 12, 999, 1000, 1001, 5000000]) {
    assert.equal(GP.profileView({ ...base, stats: { records } }).default_scope, 'records', String(records));
  }
});

test('a date key with no dated join, or one whose period covers more than 10,000 keys, is no recent period (must-exclude)', async () => {
  for (const made of [webSales({ records: 718931, joins: '[]' }), webSales({ records: 718931, keys: '10001' })]) {
    await withApp(made, async (srv) => {
      const got = await post(srv, ASK);
      assert.equal(got.status, 200, JSON.stringify(got.data));
      assert.deepEqual([got.data.time_column, got.data.time_via, got.data.recent, got.data.first_run.recent], [null, null, null, null]);
      assert.equal(got.data.default_scope, 'records', 'with no group and no period, the first 1,000 records run first with a plain note (must-exclude: never all)');
    });
  }
  const kept = webSales({ records: 718931, keys: '10000' });
  await withApp(kept, async (srv) => {
    const d = (await post(srv, ASK)).data;
    assert.deepEqual([d.time_column, d.default_scope], ['ws_ship_date_sk', 'records'], '10,000 keys is still a recent period to pick, never the default');
  });
});

const STAR_COLUMNS = {
  store_sales: [['ss_sold_date_sk', 'int'], ['ss_item_sk', 'int'], ['ss_customer_sk', 'int'], ['ss_store_sk', 'int'], ['ss_ticket_number', 'bigint'],
    ['ss_quantity', 'int'], ['ss_net_paid', 'decimal(7,2)'], ['ss_sales_price', 'decimal(7,2)']],
  web_sales: [['ws_sold_date_sk', 'int'], ['ws_item_sk', 'int'], ['ws_bill_customer_sk', 'int'], ['ws_order_number', 'bigint'], ['ws_net_paid', 'decimal(7,2)']],
  item: [['i_item_sk', 'int'], ['i_category', 'string'], ['i_brand', 'string'], ['i_item_desc', 'string']],
  customer: [['c_customer_sk', 'int'], ['c_email_address', 'string'], ['c_first_name', 'string'], ['c_birth_country', 'string']],
  store: [['s_store_sk', 'int']],
  date_dim: [['d_date_sk', 'int'], ['d_date', 'date']],
};
const STAR_RECORDS = 2880404;
const STAR_GROUPS = { ss_store_sk: 6, i_category: 10, ss_item_sk: 18000, ss_customer_sk: 99000, ws_item_sk: 18000, ws_bill_customer_sk: 99000, i_brand: 7 };
const starName = (expr) => /`([^`]+)`\)?$/.exec(expr)[1];
const starSizes = (name) => Array.from({ length: Math.min(STAR_GROUPS[name] || 0, 600) }, (_v, i) => ({
  value: name === 'i_category' ? ['Books', 'Children', 'Electronics', 'Home', 'Jewelry', 'Men', 'Music', 'Shoes', 'Sports', 'Women'][i] : String(i + 1),
  records: String(Math.floor(STAR_RECORDS / STAR_GROUPS[name])),
}));

function starSales(fact) {
  const at = (p) => p === 'store_sales' ? 'ss' : 'ws';
  const fk = (column, ref, refColumn) => ({ constraint_type: 'FOREIGN KEY', constraint_name: `fk_${column}`, column_name: column, ordinal_position: '1',
    ref_catalog: 'main', ref_schema: 'retail', ref_table: ref, ref_column: refColumn });
  const constraints = fact === 'store_sales'
    ? [{ constraint_type: 'PRIMARY KEY', constraint_name: 'pk', column_name: 'ss_ticket_number', ordinal_position: '1' }, fk('ss_sold_date_sk', 'date_dim', 'd_date_sk'),
      fk('ss_item_sk', 'item', 'i_item_sk'), fk('ss_customer_sk', 'customer', 'c_customer_sk'), fk('ss_store_sk', 'store', 's_store_sk')]
    : [{ constraint_type: 'PRIMARY KEY', constraint_name: 'pk', column_name: 'ws_order_number', ordinal_position: '1' }, fk('ws_sold_date_sk', 'date_dim', 'd_date_sk'),
      fk('ws_item_sk', 'item', 'i_item_sk'), fk('ws_bill_customer_sk', 'customer', 'c_customer_sk')];
  const columns = (_sql, parameters) => ({ rows: (STAR_COLUMNS[(parameters || []).find((p) => p.name === 't').value] || [])
    .map(([column_name, data_type], i) => ({ column_name, data_type, ordinal_position: i + 1 })), manifest: {} });
  const stats = (sql) => {
    const row = { records: String(STAR_RECORDS), recent: '0', recent_keys: '30' };
    for (const [, expr, i] of sql.matchAll(/approx_count_distinct\(((?:m|g\d+)\.`[^`]+`)\) AS d(\d+)/g)) {
      Object.assign(row, { [`d${i}`]: String(STAR_GROUPS[starName(expr)] || 0), [`n${i}`]: '0' });
    }
    return { rows: [row], manifest: {} };
  };
  const sample = (sql) => {
    const names = [...sql.matchAll(/((?:m|g\d+)\.`[^`]+`) AS c(\d+)/g)].map(([, expr]) => starName(expr));
    const rows = names.map((name, i) => ({ kind: 'size', coarse: String(i), fine: '-1', groups: String(STAR_GROUPS[name] || 0), records: '100000' }));
    names.forEach((_a, i) => names.forEach((_b, j) => { if (i !== j) rows.push({ kind: 'nest', coarse: String(i), fine: String(j), groups: '2', records: '0' }); }));
    return { rows, manifest: {} };
  };
  const values = (sql) => ({ rows: [...sql.matchAll(/SELECT (\d+) AS col, left\(CAST\(((?:m|g\d+)\.`[^`]+`) AS STRING\)/g)]
    .flatMap(([, i, expr]) => starSizes(starName(expr)).map((g) => ({ col: i, ...g }))), manifest: {} });
  const tags = { rows: [{ catalog_name: 'main', schema_name: 'retail', table_name: 'item', column_name: 'i_brand', tag_name: 'class', tag_value: 'pii' }], manifest: {} };
  const table = `main.retail.${fact}`;
  const technique = 'Forecasting';
  return profiled({ useCase: { id: 'N01-U01', primary_table: table, tables_involved: `${table}, main.retail.item`, analytics_technique: technique,
    use_case: `Forecast weekly sales by item category for each ${fact === 'store_sales' ? 'store' : 'web order'}`, table_joins: '[]', elite_assessment: '{}' } }, {
    'information_schema.table_constraints': constraints,
    'information_schema.columns': columns,
    'information_schema.column_tags': () => tags,
    approx_count_distinct: stats,
    'WITH s AS (SELECT': sample,
    'AS col, left(': values,
    'AS p0': [],
  });
}

test('a star fact table shows the Grouping step, offers its store key and the item category it joins, and never a key, a measure or a person', async () => {
  const made = starSales('store_sales');
  await withApp(made, async (srv) => {
    const got = await post(srv, ASK);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    const d = got.data;
    assert.equal(d.applies, true, 'the step shows for a forecast on a star fact table');
    const shown = d.columns.map((c) => c.name);
    assert.ok(shown.includes('ss_store_sk'), `the store key is offered: ${shown}`);
    assert.ok(shown.includes('item.i_category'), `the item category one join away is offered: ${shown}`);
    assert.deepEqual(d.columns.find((c) => c.name === 'item.i_category').join, { table: 'main.retail.item', key: 'ss_item_sk', ref_column: 'i_item_sk' });
    for (const never of ['ss_ticket_number', 'ss_net_paid', 'ss_sales_price', 'ss_quantity', 'ss_item_sk', 'ss_customer_sk', 'ss_sold_date_sk']) {
      assert.ok(!shown.includes(never), `${never} is never offered (must-exclude)`);
    }
    const stat = tableReads(made.sqlCalls).find((c) => c.sql.includes('approx_count_distinct')).sql;
    assert.doesNotMatch(stat, /ss_ticket_number|ss_net_paid|ss_sales_price|ss_quantity/, 'the primary key and the measures are never profiled (must-exclude)');
    assert.doesNotMatch(stat, /c_email_address|c_first_name|c_birth_country|i_brand|i_item_desc/,
      'a joined personal column, by name or by tag, and a free-text column are never profiled (must-exclude)');
    assert.match(stat, /LEFT JOIN \(SELECT `i_item_sk` AS inspire_key, MAX\(`i_category`\) AS `i_category` FROM `main`\.`retail`\.`item` GROUP BY `i_item_sk`\) g\d+ ON m\.`ss_item_sk` = g\d+\.inspire_key/,
      'the joined column is counted over fact rows, each item row read once');
    assert.deepEqual(d.recommended, ['ss_store_sk']);
    assert.equal(d.default_scope, 'records', 'a star-schema forecast runs first on about 1,000 records in whole groups, never on everything');
    assert.equal(d.group_column, 'ss_store_sk');
    assert.ok(d.group_sizes.length > 0 && d.group_sizes.every((g) => g.records >= 30), 'whole groups of the store key, never a cut group');
    assert.ok(d.suggested_groups.length > 0 && d.suggested_groups.every((g) => g.parts[0].column === 'ss_store_sk'));
  });
});

test('a fact table with no category of its own recommends the category it joins', async () => {
  const made = starSales('web_sales');
  await withApp(made, async (srv) => {
    const d = (await post(srv, ASK)).data;
    assert.deepEqual([d.applies, d.qualifies, d.recommended], [true, true, ['item.i_category']]);
    assert.deepEqual(d.suggested_groups[0].parts[0].join, { table: 'main.retail.item', key: 'ws_item_sk', ref_column: 'i_item_sk' });
    assert.equal(d.group_column, 'item.i_category');
    assert.equal(d.default_scope, 'records');
  });
});

test('a standalone technique on a star fact table hides the Grouping step', async () => {
  const made = starSales('store_sales');
  made.state.useCase.analytics_technique = 'Sentiment Analysis';
  await withApp(made, async (srv) => {
    const d = (await post(srv, ASK)).data;
    assert.deepEqual([d.applies, d.qualifies, d.standalone], [false, false, true]);
  });
});

test('a Deep discovery grouping the profile can size becomes the one recommendation, so the example, the groups and the first run all describe it (must-exclude: an unsized one changes nothing)', () => {
  const values = [...['east', 'west', 'north', 'south'].map((v, i) => ({ col: '0', value: v, records: String(1000 + i * 100) })),
    ...['visa', 'amex', 'mastercard'].map((v, i) => ({ col: '1', value: v, records: String(1400 + i * 50) }))];
  const base = { table: 'main.sales.orders', technique: 'Anomaly Detection', candidates: ['region', 'payment'], paths: null, time: null, days: 30,
    columns: [{ column_name: 'region', data_type: 'STRING' }, { column_name: 'payment', data_type: 'STRING' }], keys: { primary: [], joins: [] }, joins: [], readAt: 'now',
    sample: [{ kind: 'size', coarse: '0', fine: '-1', groups: '4', records: '4600' }, { kind: 'size', coarse: '1', fine: '-1', groups: '3', records: '4600' }],
    values, stats: { records: '4600', d0: '4', n0: '0', d1: '3', n1: '0' } };
  const own = GP.profileView(base);
  assert.deepEqual([own.recommended, own.group_column], [['payment'], 'payment']);
  const deep = GP.profileView({ ...base, deep: ['Region'] });
  assert.deepEqual([deep.recommended, deep.group_column], [['region'], 'region']);
  assert.deepEqual(deep.group_sizes.map((g) => g.value), ['south', 'north', 'west', 'east']);
  assert.ok(deep.suggested_groups.length && deep.suggested_groups.every((g) => g.parts[0].column === 'region'), JSON.stringify(deep.suggested_groups));
  assert.equal(deep.first_run.groups, deep.suggested_groups.reduce((sum, g) => sum + g.records, 0));
  for (const unsized of [['sku'], ['region', 'sku'], ['region', 'Region'], []]) {
    const kept = GP.profileView({ ...base, deep: unsized });
    assert.deepEqual([kept.recommended, kept.group_column, kept.first_run.groups], [own.recommended, own.group_column, own.first_run.groups], JSON.stringify(unsized));
  }
});

test('the profile reads the main table picked in the wizard, not the one of the last build', async () => {
  const made = profiled();
  await withApp(made, async (srv) => {
    const picked = await post(srv, { ...ASK, table: 'main.sales.orders_v2' });
    assert.equal(picked.status, 200, JSON.stringify(picked.data));
    assert.equal(picked.data.table, 'main.sales.orders_v2', 'the MVP Test Run counts the table the Data step counts');
    assert.equal((await post(srv, ASK)).data.table, 'main.sales.orders', 'with no table picked, the use case main table is read');
    const bad = await post(srv, { ...ASK, table: 'main.sales.`x`; DROP TABLE y' });
    assert.equal(bad.status, 400, 'a table that is not catalog.schema.table is refused (must-exclude)');
  });
});

test('a technique Data groups do not apply to recommends no grouping and no example, yet keeps whole groups for its First run (must-exclude)', async () => {
  const made = profiled({ useCase: { id: 'N01-U01', primary_table: 'main.sales.orders', tables_involved: 'main.sales.orders', analytics_technique: 'Optimization' } });
  await withApp(made, async (srv) => {
    const got = await post(srv, ASK);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    const d = got.data;
    assert.deepEqual([d.applies, d.qualifies, d.recommended, d.example], [false, false, [], null]);
    assert.match(d.reason, /^Data groups do not apply: Optimization does not work out what is normal inside groups/);
    assert.equal(d.group_column, 'country', 'a technique that reads records together still samples its First run in whole groups');
    assert.ok(d.group_sizes.length > 0);
  });
  const grouped = profiled();
  await withApp(grouped, async (srv) => {
    const got = await post(srv, ASK);
    assert.deepEqual([got.data.applies, got.data.recommended], [true, ['region', 'country']], 'a technique Data groups apply to keeps its recommendation');
  });
});
