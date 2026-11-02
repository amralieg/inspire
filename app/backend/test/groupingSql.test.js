const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const G = require('../lib/groupingSql');
const { createExecuteSql } = require('../lib/sqlStatements');
const FIXTURE = require('./fixtures/implement_grouping_sql_cases.json');

const CONTRACT_KEYWORDS = ('INSERT UPDATE DELETE MERGE DROP CREATE ALTER TRUNCATE REPLACE GRANT REVOKE COPY REFRESH OPTIMIZE VACUUM CALL EXECUTE EXEC SET '
  + 'RESET USE MSCK REPAIR CACHE UNCACHE ANALYZE LOAD PUT GET REMOVE LIST DECLARE BEGIN COMMIT ROLLBACK').split(' ');
const CONTRACT_FUNCTIONS = ('secret try_secret http_request ai_query vector_search read_files read_kafka read_kinesis read_pubsub read_pulsar read_statestore '
  + 'remote_query java_method reflect identifier').split(' ');
const sha = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

test('the App gives every shared grouping SQL case the verdict, offset, text, tables and output SQL the agent gives', () => {
  for (const c of FIXTURE.cases) {
    const got = G.checkGroupingSql(c.sql);
    if (c.ok) {
      assert.deepEqual(got, { ok: true, sql: c.sql_out, tables: c.tables, hash: sha(c.sql_out), rule: '', at: null, text: '' }, c.id);
      assert.deepEqual(G.checkGroupingSql(got.sql), got, `${c.id}: checking the stored SQL gives the same answer`);
    } else {
      assert.deepEqual(got, { ok: false, sql: '', tables: [], hash: '', rule: c.rule, at: c.at, text: c.text }, c.id);
    }
  }
});

test('the shared cases are at least 80, half or more must be refused, and every rule is exercised', () => {
  const refused = FIXTURE.cases.filter((c) => !c.ok);
  assert.ok(FIXTURE.cases.length >= 80 && refused.length * 2 >= FIXTURE.cases.length);
  assert.deepEqual([...new Set(refused.map((c) => c.rule))].sort(), ['character', 'empty', 'first_keyword', 'function', 'keyword', 'number', 'parameter',
    'parentheses', 'script', 'statements', 'substitution', 'table_function', 'table_name', 'too_long', 'unterminated']);
  assert.equal(FIXTURE.max_chars, G.GROUPING_SQL_MAX_CHARS);
});

test('every word and function the contract refuses is refused, and the same text inside a string or a comment is not', () => {
  for (const word of [...CONTRACT_KEYWORDS, 'TABLE']) {
    assert.ok(G.REFUSED_KEYWORDS.has(word), word);
    assert.equal(G.checkGroupingSql(`SELECT k, g AS group_name FROM a.b.c WHERE ${word.toLowerCase()}`).rule, 'keyword', word);
    assert.equal(G.checkGroupingSql(`SELECT k, '${word}' AS group_name FROM a.b.c -- ${word}`).ok, true, word);
  }
  for (const name of [...CONTRACT_FUNCTIONS, 'ai_mask', 'try_reflect', 'to_avro', 'from_protobuf']) {
    assert.equal(G.checkGroupingSql(`SELECT k, ${name}(g) AS group_name FROM a.b.c`).rule, 'function', name);
    assert.equal(G.checkGroupingSql(`SELECT k, ${name} AS group_name FROM a.b.c`).ok, true, `${name} as a column`);
  }
});

test('the preview statements wrap the checked SQL as a subquery with a new line before the closing parenthesis', () => {
  const sql = 'SELECT o.order_id, o.region AS group_name FROM main.sales.orders o';
  assert.equal(G.groupingTopSql(sql), `SELECT group_name, COUNT(*) AS records FROM (${sql}\n) GROUP BY 1 ORDER BY 2 DESC LIMIT 10`);
  assert.equal(G.groupingShapeSql(sql), `SELECT * FROM (${sql}\n) LIMIT 0`);
  const totals = G.groupingTotalsSql(sql, G.groupingMainTable('main.sales.orders'), ['order_id', 'line`no']);
  assert.ok(totals.startsWith(`WITH inspire_grouping AS (SELECT * FROM (${sql}\n)), `));
  assert.match(totals, /COUNT\(DISTINCT `order_id`, `line``no`\)/);
  assert.match(totals, /FROM `main`\.`sales`\.`orders` m WHERE NOT EXISTS \(SELECT 1 FROM inspire_grouping g WHERE g\.`order_id` <=> m\.`order_id` AND g\.`line``no` <=> m\.`line``no`\)\) AS no_group$/);
  assert.equal(G.checkGroupingSql(totals).ok, true, 'what Inspire wraps around a checked SQL passes the same check');
});

test('the main table is one catalog.schema.table name and nothing else, quoted part by part', () => {
  assert.deepEqual(G.groupingMainTable('Main.Sales.Orders'), { canonical: 'main.sales.orders', sql: '`Main`.`Sales`.`Orders`' });
  assert.deepEqual(G.groupingMainTable('`main`.`my.schema`.`o``x`'), { canonical: 'main.`my.schema`.`o``x`', sql: '`main`.`my.schema`.`o``x`' });
  for (const bad of ['main.sales.orders WHERE 1 = 1', 'main.sales.orders m', 'sales.orders', 'a.b.c.d', 'a.b.c; DROP TABLE a.b.c', "a.b.'c'", 'a .b.c',
    'a.b.c -- x', '', null, 'a.b\u00a0.c', 'main.sales.`orders']) {
    assert.equal(G.groupingMainTable(bad), null, String(bad));
  }
});

test('key columns are 1 to 8 different names, never group_name, and carry no control character', () => {
  assert.deepEqual(G.groupingKeyColumns(['order_id', 'Line No']), ['order_id', 'Line No']);
  for (const bad of [[], ['a', 'A'], ['group_name'], ['a', ''], ['a\u0000b'], Array.from({ length: 9 }, (_, i) => `k${i}`), 'order_id', null, ['x'.repeat(256)]]) {
    assert.equal(G.groupingKeyColumns(bad), null, JSON.stringify(bad));
  }
});

test('the preview passes only one row per record and 2 to 500 groups, and says how many of how many it shows', () => {
  const totals = (over) => ({ row_count: '1200', record_keys: '1200', group_count: '12', smallest_group: '31', small_groups: '0', null_groups: '0', no_group: '0', ...over });
  const pass = G.groupingPreviewView([{ group_name: 'EMEA', records: '400' }], totals({}));
  assert.equal(pass.ok, true);
  assert.equal(pass.text, 'Showing the 10 largest of 12 groups.');
  assert.deepEqual(pass.rules.map((r) => [r.id, r.ok]), [['one_row_per_record', true], ['group_count', true], ['small_groups', true], ['no_group', true]]);
  assert.equal(G.groupingPreviewView([], totals({ row_count: '1300' })).ok, false, 'two rows for one record');
  assert.equal(G.groupingPreviewView([], totals({ group_count: '1' })).ok, false, 'one group');
  assert.equal(G.groupingPreviewView([], totals({ group_count: '501' })).ok, false, '501 groups');
  assert.equal(G.groupingPreviewView([], totals({ group_count: '500' })).ok, true, '500 groups');
  assert.equal(G.groupingPreviewView([], totals({ group_count: '2' })).ok, true, '2 groups');
  assert.equal(G.groupingPreviewView([], totals({ group_count: '3' })).text, 'Showing all 3 groups.');
  const small = G.groupingPreviewView([], totals({ small_groups: '2', null_groups: '5', no_group: '7' }));
  assert.equal(small.rules[2].text, '2 groups have fewer than 30 records and combine into Other groups.');
  assert.equal(small.rules[3].text, '12 records fall in No group: 5 with no group_name and 7 with no row.');
  const long = G.groupingPreviewView([{ group_name: 'x'.repeat(500), records: '3' }, { group_name: null, records: '1' }], totals({}));
  assert.deepEqual([long.top[0].group_name.length, long.top[0].cut, long.top[1].group_name], [203, true, null]);
});

test('the saved check is written as the run settings the agent reads, with parameters only, never with the SQL spliced into the statement', () => {
  const table = G.groupingSettingsTable('Main.sales.Results');
  assert.equal(table.sql, '`Main`.`sales`.`Results_assumptions`');
  assert.equal(G.groupingSettingsTable('main.`we``ird`.out').sql, '`main`.`we``ird`.`out_assumptions`');
  for (const bad of ['main.sales', 'main.sales.out; DROP TABLE x', '', 'a.b.c.d']) assert.equal(G.groupingSettingsTable(bad), null, bad);
  const sql = "SELECT k, ':x'' ; DROP' AS group_name FROM a.b.c";
  const insert = G.groupingSettingsInsert(table, { useCaseId: 'N01-U01', sql, tables: ['a.b.c'], hash: sha(sql), checkedBy: 'amr@x', checkedAt: '2026-11-01T12:00:00.000Z' });
  assert.ok(!insert.sql.includes('DROP') && !insert.sql.includes('a.b.c') && !insert.sql.includes('amr@x'));
  assert.equal(insert.sql, 'INSERT INTO `Main`.`sales`.`Results_assumptions` (use_case_id, name, value, changed_by, changed_at, note, text_value) VALUES '
    + G.GROUPING_SETTINGS.map((name, i) => `(:use_case_id, '${name}', NULL, :changed_by, :changed_at, :note, :v${i})`).join(', '));
  const value = (name) => insert.parameters.find((p) => p.name === name);
  assert.deepEqual(G.GROUPING_SETTINGS.map((_n, i) => value(`v${i}`).value), [sql, '["a.b.c"]', sha(sql), 'amr@x', '2026-11-01T12:00:00.000Z']);
  assert.deepEqual([value('use_case_id').value, value('changed_by').value, value('changed_at').type, value('note').value],
    ['N01-U01', 'amr@x', 'TIMESTAMP', G.GROUPING_SAVED_NOTE]);
  assert.equal(G.groupingSettingsCreateSql(table), 'CREATE TABLE IF NOT EXISTS `Main`.`sales`.`Results_assumptions` (use_case_id STRING, name STRING, '
    + 'value DOUBLE, changed_by STRING, changed_at TIMESTAMP, note STRING, text_value STRING)');
});

test('the run settings, the assumptions table and its columns are the ones the bundled agent reads', () => {
  const cells = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'dbx_inspire_ai_agent.ipynb'), 'utf8')).cells;
  const source = cells.map((c) => [].concat(c.source).join('')).join('\n');
  const columns = /^INSPIRE_ASSUMPTION_COLUMNS = \(([\s\S]*?\))\)\n/m.exec(source);
  assert.ok(columns, 'the bundled agent declares INSPIRE_ASSUMPTION_COLUMNS');
  assert.deepEqual([...columns[1].matchAll(/\("(\w+)", "(\w+)"\)/g)].map((m) => [m[1], m[2]]), G.GROUPING_ASSUMPTION_COLUMNS);
  assert.equal(/^INSPIRE_ASSUMPTIONS_SUFFIX = "(\w+)"$/m.exec(source)?.[1], '_assumptions');
  const settings = /^INSPIRE_GROUP_SQL_SETTINGS = \(([^)]*)\)$/m.exec(source);
  if (settings) assert.deepEqual([...settings[1].matchAll(/"(\w+)"/g)].map((m) => m[1]), G.GROUPING_SETTINGS);
});

test('the one SQL runner sends row and byte caps when asked and cancels a running statement when the caller stops', async () => {
  const calls = [];
  let polls = 0;
  const stop = new AbortController();
  const dbFetch = async (_host, _token, path, opts = {}) => {
    calls.push({ path, body: opts.body ? JSON.parse(opts.body) : null, method: opts.method || 'GET' });
    if (path === '/api/2.0/sql/statements') return { ok: true, json: async () => ({ statement_id: 's1', status: { state: 'RUNNING' } }) };
    if (path.endsWith('/cancel')) return { ok: true, json: async () => ({}) };
    polls += 1;
    if (polls === 2) stop.abort();
    return { ok: true, json: async () => ({ statement_id: 's1', status: { state: 'RUNNING' } }) };
  };
  const executeSql = createExecuteSql(dbFetch, { sleep: async () => {} });
  await assert.rejects(executeSql('h', 't', 'w', 'SELECT 1', null, { rowLimit: 100, byteLimit: 1048576, waitTimeout: '10s', signal: stop.signal }),
    (err) => err.code === 'SQL_CANCELLED');
  assert.deepEqual(calls[0].body, { warehouse_id: 'w', statement: 'SELECT 1', wait_timeout: '10s', on_wait_timeout: 'CONTINUE', disposition: 'INLINE',
    format: 'JSON_ARRAY', row_limit: 100, byte_limit: 1048576 });
  assert.deepEqual(calls.filter((c) => c.path.endsWith('/cancel')).map((c) => c.method), ['POST']);
  const plain = [];
  const runner = createExecuteSql(async (_h, _t, path, opts = {}) => {
    plain.push(opts.body ? JSON.parse(opts.body) : null);
    return { ok: true, json: async () => ({ statement_id: 's2', status: { state: 'SUCCEEDED' }, result: { data_array: [] } }) };
  });
  await runner('h', 't', 'w', 'SELECT 1');
  assert.deepEqual(Object.keys(plain[0]).sort(), ['disposition', 'format', 'on_wait_timeout', 'statement', 'wait_timeout', 'warehouse_id'], 'callers that ask for nothing get the old body');
  assert.equal(plain[0].wait_timeout, '50s');
});
