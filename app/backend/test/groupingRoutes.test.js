const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { makeApp, listen } = require('./support/implementApp');
const G = require('../lib/groupingSql');

const PERSON = 'person-tok';
const OWNER = 'owner@x';
const ME = 'amr@x';
const SQL = 'SELECT o.order_id, coalesce(c.segment, \'None\') AS group_name FROM main.sales.orders o LEFT JOIN main.crm.customers c ON o.cid = c.id';
const HIDDEN = 'SELECT o.order_id, s.band AS group_name FROM main.sales.orders o JOIN main.hr.salaries s ON o.rep = s.rep';
const DENIED = '[INSUFFICIENT_PERMISSIONS] Insufficient privileges: User does not have SELECT on Table \'main.hr.salaries\'.';
const ASK = { inspire_database: 'main.inspire', session_id: '42', use_case_id: 'N01-U01', warehouse_id: 'wh1', main_table: 'main.sales.orders', key_columns: ['order_id'] };
const SAVE = { ...ASK, result_table: 'main.sales.order_risk' };
const ASSUMPTIONS = '`main`.`sales`.`order_risk_assumptions`';
const BUILT_ASSUMPTIONS = '`main`.`out`.`built_risk_assumptions`';
const BUILT = { session_id: '42', use_case_id: 'N01-U01', spec_version: 1, status: 'ready', created_by: OWNER, updated_at: '2026-10-21T04:00:00Z',
  spec_json: JSON.stringify({ use_case_id: 'N01-U01', outputs: {}, config: { result_table: 'main.out.built_risk' } }) };

function warehouse(sql, _parameters, token) {
  if (token !== PERSON) throw new Error('the App token must never run a grouping SQL');
  if (sql.includes('main`.`hr`.`salaries') || sql.includes('main.hr.salaries')) throw new Error(DENIED);
  if (sql.endsWith('LIMIT 0')) return { rows: [], manifest: { schema: { columns: [{ name: 'order_id' }, { name: 'group_name' }] } } };
  if (sql.startsWith('SELECT group_name, COUNT(*) AS records')) {
    return { rows: [{ group_name: 'Enterprise', records: '700' }, { group_name: 'SMB', records: '480' }, { group_name: null, records: '20' }], manifest: {} };
  }
  if (sql.startsWith('WITH inspire_grouping AS')) {
    return { rows: [{ row_count: '1200', record_keys: '1200', group_count: '2', smallest_group: '480', small_groups: '0', null_groups: '20', no_group: '3' }], manifest: {} };
  }
  throw new Error(`unexpected grouping statement ${sql}`);
}

function grouped(over = {}) {
  return makeApp({ forwardedToken: PERSON, forwardedEmail: ME, statements: { 'AS group_name': warehouse }, ...over });
}

async function post(srv, path, body) {
  const resp = await fetch(`${srv.url}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
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

const groupingCalls = (sqlCalls) => sqlCalls.filter((c) => c.sql.includes('AS group_name'));
const stored = (made, table = ASSUMPTIONS) => made.sqlCalls.filter((c) => c.sql.includes(table));

test('a preview runs the checked SQL wrapped, with the person token only, capped, and answers the 10 largest groups, the totals and the pass rules', async () => {
  const made = grouped();
  await withApp(made, async (srv) => {
    const got = await post(srv, '/api/grouping/preview', { ...ASK, sql: `${SQL} -- the segments\n;` });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(got.data.sql, SQL);
    assert.deepEqual(got.data.tables, ['main.crm.customers', 'main.sales.orders']);
    assert.equal(got.data.hash, crypto.createHash('sha256').update(SQL).digest('hex'));
    assert.deepEqual(got.data.top.map((r) => [r.group_name, r.records]), [['Enterprise', 700], ['SMB', 480], [null, 20]]);
    assert.equal(got.data.text, 'Showing all 2 groups.');
    assert.equal(got.data.ok, true);
    assert.deepEqual(got.data.totals, { rows: 1200, record_keys: 1200, groups: 2, smallest_group: 480, small_groups: 0, null_groups: 20, no_group: 3 });
    const runs = groupingCalls(made.sqlCalls);
    assert.deepEqual(runs.map((c) => c.token), [PERSON, PERSON, PERSON]);
    assert.ok(runs.every((c) => c.sql.includes(`(${SQL}\n)`)), 'every statement wraps the checked SQL, comments removed, with a new line before )');
    assert.ok(runs.every((c) => c.options.rowLimit === G.GROUPING_ROW_LIMIT && c.options.byteLimit === G.GROUPING_BYTE_LIMIT && c.options.signal));
    assert.ok(runs.every((c) => c.parameters === null), 'no parameters');
  });
});

test('a CAN_USE person cannot preview a table they cannot read: 403 with the platform reason, and nothing else runs (must-exclude)', async () => {
  const made = grouped();
  await withApp(made, async (srv) => {
    const got = await post(srv, '/api/grouping/preview', { ...ASK, sql: HIDDEN });
    assert.equal(got.status, 403);
    assert.equal(got.data.error, `${G.GROUPING_DENIED}: ${DENIED}`);
    assert.equal(groupingCalls(made.sqlCalls).length, 1, 'the shape read failed, so the top and totals never ran');
  });
});

test('a preview without the person token is a 401 and runs nothing, even though the App has its own token', async () => {
  const made = grouped({ forwardedToken: '', tokenKind: 'app' });
  await withApp(made, async (srv) => {
    const got = await post(srv, '/api/grouping/preview', { ...ASK, sql: SQL });
    assert.deepEqual([got.status, got.data.error], [401, G.GROUPING_NO_SIGN_IN]);
    assert.deepEqual(made.sqlCalls, []);
  });
});

test('a refused SQL is a 400 with the check text and runs nothing (must-exclude for writes, other statements and outside reads)', async () => {
  for (const [sql, rule] of [['DELETE FROM main.sales.orders', 'first_keyword'], [`${SQL}; DROP TABLE main.sales.orders`, 'statements'],
    [`${SQL} WHERE secret('a', 'b') = 'x'`, 'function'], ["SELECT order_id, 'a' AS group_name FROM read_files('/Volumes/x')", 'function'],
    ['SELECT order_id, g AS group_name FROM sales.orders', 'table_name'], ["SELECT order_id, '${x}' AS group_name FROM main.sales.orders", 'substitution']]) {
    const made = grouped();
    await withApp(made, async (srv) => {
      const got = await post(srv, '/api/grouping/preview', { ...ASK, sql });
      assert.equal(got.status, 400, sql);
      assert.equal(got.data.refused.rule, rule, sql);
      assert.equal(got.data.error, G.checkGroupingSql(sql).text);
      assert.deepEqual(made.sqlCalls, [], sql);
    });
  }
});

test('the main table must be read by the SQL and named as catalog.schema.table, and key columns must be plain names', async () => {
  for (const [over, said] of [[{ main_table: 'main.sales.orders WHERE 1 = 1' }, /^main_table must name/], [{ main_table: 'main.sales.returns' }, /does not read main\.sales\.returns/],
    [{ key_columns: ['group_name'] }, /^key_columns must list/], [{ key_columns: [] }, /^key_columns must list/]]) {
    const made = grouped();
    await withApp(made, async (srv) => {
      const got = await post(srv, '/api/grouping/preview', { ...ASK, ...over, sql: SQL });
      assert.equal(got.status, 400);
      assert.match(got.data.error, said);
      assert.deepEqual(made.sqlCalls, []);
    });
  }
});

test('a SQL that returns no group_name or no key column is a 400 that names what is missing', async () => {
  const made = grouped({ statements: { 'LIMIT 0': (sql, p, token) => (token === PERSON ? { rows: [], manifest: { schema: { columns: [{ name: 'order_id' }, { name: 'segment' }] } } } : null) } });
  await withApp(made, async (srv) => {
    const got = await post(srv, '/api/grouping/preview', { ...ASK, sql: SQL });
    assert.equal(got.status, 400);
    assert.equal(got.data.error, 'The grouping SQL returns no column named group_name; return one row per record with the record key column order_id and group_name.');
  });
});

test('a preview past 120 seconds is a 504 that says Inspire stopped it', async () => {
  const made = grouped({ statements: { 'LIMIT 0': () => { throw Object.assign(new Error('slow'), { code: 'SQL_DEADLINE' }); } } });
  await withApp(made, async (srv) => {
    const got = await post(srv, '/api/grouping/preview', { ...ASK, sql: SQL });
    assert.equal(got.status, 504);
    assert.match(got.data.error, /did not finish within 120 seconds, so Inspire stopped it/);
  });
});

test('saving re-runs the check with the person token, then stores the exact SQL, its tables, hash, checker and time as the run settings the agent reads', async () => {
  const made = grouped({ history: [] });
  await withApp(made, async (srv) => {
    const got = await post(srv, '/api/grouping/save', { ...SAVE, sql: `/* mine */ ${SQL};` });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    const { setting } = got.data;
    assert.deepEqual({ ...setting, group_sql_checked_at: 'when' }, { group_by: 'custom', group_sql: SQL, group_sql_tables: ['main.crm.customers', 'main.sales.orders'],
      group_sql_hash: crypto.createHash('sha256').update(SQL).digest('hex'), group_sql_checked_by: ME, group_sql_checked_at: 'when', main_table: 'main.sales.orders',
      key_columns: ['order_id'] });
    assert.equal(got.data.result_table, 'main.sales.order_risk');
    const shape = groupingCalls(made.sqlCalls);
    assert.deepEqual(shape.map((c) => [c.token, c.sql]), [[PERSON, G.groupingShapeSql(SQL)]]);
    assert.equal(stored(made).length, 2, 'one create and one insert');
    assert.deepEqual(stored(made).map((c) => c.token), [PERSON, PERSON], 'the result table settings are written with the person token');
    assert.ok(stored(made).every((c) => c.options && c.options.signal), 'the writes stop when the caller leaves');
    assert.equal(stored(made)[0].sql, G.groupingSettingsCreateSql(G.groupingSettingsTable('main.sales.order_risk')));
    const insert = stored(made)[1];
    assert.ok(insert.sql.startsWith(`INSERT INTO ${ASSUMPTIONS} (use_case_id, name, value, changed_by, changed_at, note, text_value) VALUES`));
    const value = (name) => insert.parameters.find((p) => p.name === name).value;
    assert.deepEqual(G.GROUPING_SETTINGS.map((_n, i) => value(`v${i}`)),
      [SQL, JSON.stringify(setting.group_sql_tables), setting.group_sql_hash, ME, setting.group_sql_checked_at]);
    assert.deepEqual([value('use_case_id'), value('changed_by'), value('changed_at')], ['N01-U01', ME, setting.group_sql_checked_at]);
    assert.equal(made.sqlCalls.filter((c) => c.sql.includes('__inspire_grouping')).length, 0, 'no side table that no run reads');
  });
});

test('before the first build a save must name the result table, and a bad one stores nothing (must-refuse)', async () => {
  for (const result_table of [undefined, '', 'main.sales', 'main.sales.out; DROP TABLE main.sales.orders']) {
    const made = grouped({ history: [] });
    await withApp(made, async (srv) => {
      const got = await post(srv, '/api/grouping/save', { ...ASK, result_table, sql: SQL });
      assert.equal(got.status, 400, String(result_table));
      assert.match(got.data.error, /^result_table must name the use case result table/);
      assert.deepEqual(groupingCalls(made.sqlCalls), [], 'the SQL never ran');
      assert.deepEqual(stored(made), []);
    });
  }
});

test('a CAN_USE person cannot save a SQL that reads a table they cannot read, and nothing is stored (must-exclude)', async () => {
  const made = grouped({ history: [] });
  await withApp(made, async (srv) => {
    const got = await post(srv, '/api/grouping/save', { ...SAVE, sql: HIDDEN });
    assert.equal(got.status, 403);
    assert.equal(got.data.error, `${G.GROUPING_DENIED}: ${DENIED}`);
    assert.deepEqual(stored(made), []);
  });
});

test('once the use case is built, only the people who may change its run settings can save a grouping; its owner can, into the built result table', async () => {
  const other = grouped({ history: [BUILT] });
  await withApp(other, async (srv) => {
    const got = await post(srv, '/api/grouping/save', { ...ASK, sql: SQL });
    assert.equal(got.status, 403);
    assert.match(got.data.error, /^Only the owners of this use case can change its settings/);
    assert.equal(groupingCalls(other.sqlCalls).length, 0, 'the SQL never ran for a person who may not change the settings');
    assert.deepEqual(stored(other, BUILT_ASSUMPTIONS), []);
  });
  const owner = grouped({ history: [BUILT], forwardedEmail: OWNER });
  await withApp(owner, async (srv) => {
    const got = await post(srv, '/api/grouping/save', { ...ASK, sql: SQL });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(got.data.setting.group_sql_checked_by, OWNER);
    assert.equal(got.data.result_table, 'main.out.built_risk');
    assert.equal(stored(owner, BUILT_ASSUMPTIONS).length, 2);
  });
  const moved = grouped({ history: [BUILT], forwardedEmail: OWNER });
  await withApp(moved, async (srv) => {
    const got = await post(srv, '/api/grouping/save', { ...SAVE, sql: SQL });
    assert.equal(got.status, 409, 'a built use case keeps its grouping next to its own result table (must-refuse)');
    assert.match(got.data.error, /writes its results to main\.out\.built_risk, so its grouping is saved there and not in main\.sales\.order_risk/);
    assert.deepEqual(groupingCalls(moved.sqlCalls), []);
    assert.deepEqual([...stored(moved), ...stored(moved, BUILT_ASSUMPTIONS)], []);
  });
});

test('a save past 120 seconds is a 504 that says Inspire stopped it, and stores nothing', async () => {
  const made = grouped({ history: [], statements: { 'LIMIT 0': () => { throw Object.assign(new Error('slow'), { code: 'SQL_DEADLINE' }); } } });
  await withApp(made, async (srv) => {
    const got = await post(srv, '/api/grouping/save', { ...SAVE, sql: SQL });
    assert.equal(got.status, 504);
    assert.match(got.data.error, /did not finish within 120 seconds, so Inspire stopped it/);
    assert.deepEqual(stored(made), []);
  });
});

for (const route of ['preview', 'save']) {
  test(`when the caller leaves a ${route}, the running read gets the cancel signal and nothing is stored`, { timeout: 10000 }, async () => {
    let release;
    let reached;
    const waiting = new Promise((resolve) => { reached = resolve; });
    const made = grouped({ history: [], statements: { 'LIMIT 0': () => new Promise((resolve) => { release = resolve; reached(); }) } });
    await withApp(made, async (srv) => {
      const leave = new AbortController();
      const asked = fetch(`${srv.url}/api/grouping/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...SAVE, sql: SQL }), signal: leave.signal }).catch((err) => err);
      let timer;
      await Promise.race([waiting, new Promise((_r, reject) => { timer = setTimeout(() => reject(new Error('the check read never started')), 5000); })])
        .finally(() => clearTimeout(timer));
      leave.abort();
      const signal = made.sqlCalls.find((c) => c.sql.endsWith('LIMIT 0')).options.signal;
      for (let i = 0; i < 200 && !signal.aborted; i += 1) await new Promise((r) => setTimeout(r, 5));
      assert.equal(signal.aborted, true);
      release({ rows: [], manifest: { schema: { columns: [{ name: 'order_id' }, { name: 'group_name' }] } } });
      assert.equal((await asked).name, 'AbortError');
      for (let i = 0; i < 20; i += 1) await new Promise((r) => setTimeout(r, 5));
      assert.deepEqual(stored(made), [], 'a caller who left saves nothing');
      assert.equal(made.sqlCalls.filter((c) => c.sql.startsWith('SELECT group_name') || c.sql.startsWith('WITH inspire_grouping')).length, 0);
    });
  });
}

test('saving without the person token is a 401 and stores nothing, and a refused SQL is a 400 that stores nothing', async () => {
  const none = grouped({ forwardedToken: '', tokenKind: 'app', history: [] });
  await withApp(none, async (srv) => {
    const got = await post(srv, '/api/grouping/save', { ...SAVE, sql: SQL });
    assert.deepEqual([got.status, got.data.error], [401, G.GROUPING_NO_SIGN_IN]);
    assert.deepEqual(none.sqlCalls, []);
  });
  const refused = grouped({ history: [] });
  await withApp(refused, async (srv) => {
    const got = await post(srv, '/api/grouping/save', { ...SAVE, sql: 'UPDATE main.sales.orders SET region = 1' });
    assert.equal(got.status, 400);
    assert.equal(got.data.refused.rule, 'first_keyword');
    assert.deepEqual(refused.sqlCalls, []);
  });
});
