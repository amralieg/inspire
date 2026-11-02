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
const BUILT = { session_id: '42', use_case_id: 'N01-U01', spec_version: 1, status: 'ready', created_by: OWNER, updated_at: '2026-10-21T04:00:00Z',
  spec_json: JSON.stringify({ use_case_id: 'N01-U01', outputs: {} }) };

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

test('saving re-runs the check with the person token, then stores the exact SQL, its tables, hash, checker and time with the App token', async () => {
  const made = grouped({ history: [] });
  await withApp(made, async (srv) => {
    const got = await post(srv, '/api/grouping/save', { ...ASK, sql: `/* mine */ ${SQL};` });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    const { setting } = got.data;
    assert.deepEqual({ ...setting, group_sql_checked_at: 'when' }, { group_by: 'custom', group_sql: SQL, group_sql_tables: ['main.crm.customers', 'main.sales.orders'],
      group_sql_hash: crypto.createHash('sha256').update(SQL).digest('hex'), group_sql_checked_by: ME, group_sql_checked_at: 'when', main_table: 'main.sales.orders',
      key_columns: ['order_id'] });
    const shape = groupingCalls(made.sqlCalls);
    assert.deepEqual(shape.map((c) => [c.token, c.sql]), [[PERSON, G.groupingShapeSql(SQL)]]);
    const insert = made.sqlCalls.find((c) => c.sql.startsWith('INSERT INTO `main`.`inspire`.`__inspire_grouping`'));
    assert.equal(insert.token, 'tok', 'the tracking table is written with the App token');
    const value = (name) => insert.parameters.find((p) => p.name === name).value;
    assert.deepEqual([value('group_sql'), value('group_sql_hash'), value('group_sql_checked_by'), value('group_sql_checked_at')],
      [SQL, setting.group_sql_hash, ME, setting.group_sql_checked_at]);
    assert.ok(made.sqlCalls.some((c) => c.sql.startsWith('CREATE TABLE IF NOT EXISTS `main`.`inspire`.`__inspire_grouping`')));
  });
});

test('a CAN_USE person cannot save a SQL that reads a table they cannot read, and nothing is stored (must-exclude)', async () => {
  const made = grouped({ history: [] });
  await withApp(made, async (srv) => {
    const got = await post(srv, '/api/grouping/save', { ...ASK, sql: HIDDEN });
    assert.equal(got.status, 403);
    assert.equal(got.data.error, `${G.GROUPING_DENIED}: ${DENIED}`);
    assert.equal(made.sqlCalls.filter((c) => c.sql.includes('__inspire_grouping')).length, 0);
  });
});

test('once the use case is built, only the people who may change its run settings can save a grouping; its owner can', async () => {
  const other = grouped({ history: [BUILT] });
  await withApp(other, async (srv) => {
    const got = await post(srv, '/api/grouping/save', { ...ASK, sql: SQL });
    assert.equal(got.status, 403);
    assert.match(got.data.error, /^Only the owners of this use case can change its settings/);
    assert.equal(groupingCalls(other.sqlCalls).length, 0, 'the SQL never ran for a person who may not change the settings');
    assert.equal(other.sqlCalls.filter((c) => c.sql.includes('__inspire_grouping')).length, 0);
  });
  const owner = grouped({ history: [BUILT], forwardedEmail: OWNER });
  await withApp(owner, async (srv) => {
    const got = await post(srv, '/api/grouping/save', { ...ASK, sql: SQL });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(got.data.setting.group_sql_checked_by, OWNER);
  });
});

test('saving without the person token is a 401 and stores nothing, and a refused SQL is a 400 that stores nothing', async () => {
  const none = grouped({ forwardedToken: '', tokenKind: 'app', history: [] });
  await withApp(none, async (srv) => {
    const got = await post(srv, '/api/grouping/save', { ...ASK, sql: SQL });
    assert.deepEqual([got.status, got.data.error], [401, G.GROUPING_NO_SIGN_IN]);
    assert.deepEqual(none.sqlCalls, []);
  });
  const refused = grouped({ history: [] });
  await withApp(refused, async (srv) => {
    const got = await post(srv, '/api/grouping/save', { ...ASK, sql: 'UPDATE main.sales.orders SET region = 1' });
    assert.equal(got.status, 400);
    assert.equal(got.data.refused.rule, 'first_keyword');
    assert.deepEqual(refused.sqlCalls, []);
  });
});
