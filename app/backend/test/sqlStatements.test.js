const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fileNames } = require('./support/sourceFiles');
const {
  createExecuteSql,
  runWithRequestDeadline,
  readDeadline,
  PAGE_SQL_DEADLINE_MS,
  SLOW_WAREHOUSE_MESSAGE,
  isDeltaWriteConflict,
  CONFLICT_ATTEMPTS,
  CONFLICT_WINDOW_MS,
} = require('../lib/sqlStatements');

function warehouse(states, { submitMs = 0, cancelOk = true, rows = [['1']] } = {}) {
  let t = 0;
  const calls = [];
  const queue = [...states];
  const statement = (state) => ({
    statement_id: 's1',
    status: state === 'FAILED' ? { state, error: { message: 'TABLE_OR_VIEW_NOT_FOUND x' } } : { state },
    manifest: { schema: { columns: [{ name: 'x' }] } },
    result: { data_array: state === 'SUCCEEDED' ? rows : [] },
  });
  const dbFetch = async (_host, _token, apiPath, options = {}) => {
    calls.push({ apiPath, method: options.method || 'GET', at: t });
    if (calls.length > 5000) throw new Error('runaway: the statement was polled 5000 times without stopping');
    if (apiPath.endsWith('/cancel')) {
      if (cancelOk === 'throws') throw new Error('Cannot reach Databricks');
      return { ok: cancelOk, json: async () => ({}), text: async () => '' };
    }
    if (options.method === 'POST') t += submitMs;
    const state = queue.length > 1 ? queue.shift() : queue[0];
    return { ok: true, json: async () => statement(state), text: async () => '' };
  };
  const now = () => t;
  const sleep = async (ms) => { t += ms; };
  return { calls, now, executeSql: createExecuteSql(dbFetch, { now, sleep }), cancels: () => calls.filter((c) => c.apiPath.endsWith('/cancel')) };
}

const running = (n) => Array.from({ length: n }, () => 'RUNNING');

test('a page read the warehouse holds past the request deadline is cancelled and tells the user what to do', async () => {
  const w = warehouse(['RUNNING'], { submitMs: 50000 });
  await assert.rejects(
    runWithRequestDeadline(() => w.executeSql('h', 't', 'wh', 'SELECT * FROM x ORDER BY create_at DESC LIMIT 20'), PAGE_SQL_DEADLINE_MS, w.now),
    (err) => err.code === 'SQL_DEADLINE' && err.message === SLOW_WAREHOUSE_MESSAGE && err.statementId === 's1',
  );
  assert.equal(w.cancels().length, 1, 'the stuck statement is cancelled once');
  assert.equal(w.cancels()[0].method, 'POST');
  assert.equal(w.cancels()[0].apiPath, '/api/2.0/sql/statements/s1/cancel');
  assert.equal(w.calls.at(-1).apiPath, '/api/2.0/sql/statements/s1/cancel', 'nothing is polled after the cancel');
  assert.ok(w.now() <= PAGE_SQL_DEADLINE_MS + 2000, `the request ends by the deadline, not at the proxy cut-off (${w.now()} ms)`);
  assert.ok(w.now() < 300000);
});

test('the message names the deadline and a retry, and never a stack or statement text', () => {
  assert.match(SLOW_WAREHOUSE_MESSAGE, new RegExp(`within ${PAGE_SQL_DEADLINE_MS / 60000} minutes`));
  assert.match(SLOW_WAREHOUSE_MESSAGE, /Try again in a minute\.$/);
  assert.ok(PAGE_SQL_DEADLINE_MS < 300000, 'below the 300 s the Apps proxy allows a request');
});

test('a read that finishes before the deadline returns its rows and cancels nothing', async () => {
  const w = warehouse(['RUNNING', 'RUNNING', 'SUCCEEDED']);
  const result = await runWithRequestDeadline(() => w.executeSql('h', 't', 'wh', 'SELECT 1'), PAGE_SQL_DEADLINE_MS, w.now);
  assert.deepEqual(result.result.data_array, [['1']]);
  assert.equal(w.cancels().length, 0);
});

test('writes and DDL keep waiting past the deadline, so a commit is never cut off', async () => {
  for (const sql of [
    'INSERT INTO t VALUES (1)',
    'UPDATE t SET a = 1',
    'MERGE INTO t USING s ON t.id = s.id WHEN MATCHED THEN UPDATE SET *',
    'DELETE FROM t WHERE id = 1',
    'CREATE TABLE IF NOT EXISTS t (a INT)',
    'ALTER TABLE t ADD COLUMNS (b INT)',
  ]) {
    const w = warehouse([...running(200), 'SUCCEEDED']);
    const result = await runWithRequestDeadline(() => w.executeSql('h', 't', 'wh', sql), PAGE_SQL_DEADLINE_MS, w.now);
    assert.deepEqual(result.result.data_array, [['1']], sql);
    assert.equal(w.cancels().length, 0, sql);
    assert.ok(w.now() > PAGE_SQL_DEADLINE_MS, `${sql} ran past the deadline (${w.now()} ms)`);
  }
});

test('outside a request a read keeps waiting, so startup and background work are never cancelled', async () => {
  const w = warehouse([...running(200), 'SUCCEEDED']);
  const result = await w.executeSql('h', 't', 'wh', 'SELECT 1');
  assert.deepEqual(result.result.data_array, [['1']]);
  assert.equal(w.cancels().length, 0);
});

test('the deadline covers the whole request: a read that would start after it is refused without a statement', async () => {
  const w = warehouse(['SUCCEEDED']);
  let t = 0;
  const now = () => t;
  await runWithRequestDeadline(async () => {
    t = PAGE_SQL_DEADLINE_MS;
    await assert.rejects(
      createExecuteSql(async (...args) => { w.calls.push(args); return { ok: true, json: async () => ({}) }; }, { now })('h', 't', 'wh', 'SELECT 1'),
      (err) => err.code === 'SQL_DEADLINE' && err.statementId === null,
    );
  }, PAGE_SQL_DEADLINE_MS, now);
  assert.equal(w.calls.length, 0, 'no statement is submitted once the request is out of time');
});

test('two reads in one request share one deadline, so the second gets only the time left', async () => {
  const w = warehouse([...running(100), 'SUCCEEDED', ...running(1000)]);
  await assert.rejects(runWithRequestDeadline(async () => {
    await w.executeSql('h', 't', 'wh', 'SELECT 1');
    assert.ok(w.now() >= 200000, 'the first read used most of the time');
    await w.executeSql('h', 't', 'wh', 'SELECT 2');
  }, PAGE_SQL_DEADLINE_MS, w.now), (err) => err.code === 'SQL_DEADLINE');
  assert.ok(w.now() <= PAGE_SQL_DEADLINE_MS + 2000, `the request still ends by the deadline (${w.now()} ms)`);
  assert.equal(w.cancels().length, 1);
});

test('a cancel the warehouse refuses or cannot be reached for still ends the request with the same message', async () => {
  for (const cancelOk of [false, 'throws']) {
    const w = warehouse(['RUNNING'], { cancelOk });
    await assert.rejects(
      runWithRequestDeadline(() => w.executeSql('h', 't', 'wh', 'SELECT 1'), PAGE_SQL_DEADLINE_MS, w.now),
      (err) => err.code === 'SQL_DEADLINE' && err.message === SLOW_WAREHOUSE_MESSAGE,
    );
    assert.equal(w.cancels().length, 1);
  }
});

test('only statements that read get the deadline; anything else, or no request, keeps waiting', async () => {
  const reads = ['SELECT 1', 'select 1', '  WITH a AS (SELECT 1) SELECT * FROM a', 'SHOW CATALOGS', 'DESCRIBE TABLE t', 'DESC t', 'EXPLAIN SELECT 1', '\nSELECT 1'];
  const others = ['INSERT INTO t VALUES (1)', 'UPDATE t SET a = 1', 'MERGE INTO t USING s ON 1 = 1 WHEN MATCHED THEN DELETE', 'DELETE FROM t', 'CREATE SCHEMA s', 'ALTER TABLE t ADD COLUMNS (b INT)', 'DROP TABLE t', 'GRANT SELECT ON t TO u', '-- note\nSELECT 1', 'SELECTED_ROWS', '', null];
  await runWithRequestDeadline(async () => {
    await new Promise((r) => setTimeout(r, 1));
    for (const sql of reads) assert.equal(readDeadline(sql), 1000 + PAGE_SQL_DEADLINE_MS, JSON.stringify(sql));
    for (const sql of others) assert.equal(readDeadline(sql), null, JSON.stringify(sql));
  }, PAGE_SQL_DEADLINE_MS, () => 1000);
  assert.equal(readDeadline('SELECT 1'), null, 'no deadline outside a request');
});

test('each request keeps its own deadline across awaits, and none leaks into the next', async () => {
  const seen = await Promise.all([1000, 5000].map((start) => runWithRequestDeadline(async () => {
    await new Promise((r) => setTimeout(r, start === 1000 ? 5 : 1));
    return readDeadline('SELECT 1');
  }, PAGE_SQL_DEADLINE_MS, () => start)));
  assert.deepEqual(seen, [1000 + PAGE_SQL_DEADLINE_MS, 5000 + PAGE_SQL_DEADLINE_MS]);
  assert.equal(readDeadline('SELECT 1'), null);
});

test('a failed statement still throws the warehouse message, and chunked results are joined in order', async () => {
  const failed = warehouse(['RUNNING', 'FAILED']);
  const warned = [];
  const warn = console.warn;
  console.warn = (line) => warned.push(String(line));
  try {
    await assert.rejects(failed.executeSql('h', 't', 'wh', 'SELECT 1'), /TABLE_OR_VIEW_NOT_FOUND x/);
  } finally {
    console.warn = warn;
  }
  assert.ok(warned.some((line) => line.includes('SQL failed: TABLE_OR_VIEW_NOT_FOUND x')), 'the App log says why a statement failed');
  const chunks = [];
  const dbFetch = async (_h, _t, apiPath) => {
    chunks.push(apiPath);
    if (apiPath.includes('/result/chunks/')) return { ok: true, json: async () => ({ data_array: [[apiPath.split('/').pop()]] }) };
    return { ok: true, json: async () => ({ statement_id: 's2', status: { state: 'SUCCEEDED' }, manifest: { total_chunk_count: 3, chunks: [{ chunk_index: 0 }, { chunk_index: 1 }, { chunk_index: 2 }], schema: { columns: [{ name: 'x' }] } }, result: { data_array: [['0']] } }) };
  };
  const result = await createExecuteSql(dbFetch)('h', 't', 'wh', 'SELECT 1');
  assert.deepEqual(result.result.data_array, [['0'], ['1'], ['2']]);
  assert.deepEqual(chunks.slice(1), ['/api/2.0/sql/statements/s2/result/chunks/1', '/api/2.0/sql/statements/s2/result/chunks/2']);
});

test('the server has one SQL runner, built from the module, and every token-checked request runs inside the deadline', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.ok(!/async function executeSql\(/.test(server), 'no second executeSql in server.js');
  assert.match(server, /const executeSql = createExecuteSql\(dbFetch\);/);
  const requireToken = server.slice(server.indexOf('async function requireToken('), server.indexOf('async function requireToken(') + 1200);
  assert.match(requireToken, /runWithRequestDeadline\(next\)/);
  assert.ok(!/\n\s+next\(\);/.test(requireToken), 'requireToken never calls next() outside the deadline');
  for (const file of ['implementRoutes.js', path.join('lib', 'demoDataService.js')]) {
    assert.ok(!/fetch\([^)]*\/api\/2\.0\/sql\/statements/.test(fs.readFileSync(path.join(__dirname, '..', file), 'utf8')), `${file} sends no statement of its own`);
  }
});

const CONFLICT = '[DELTA_CONCURRENT_APPEND.WITH_PARTITION_HINT] ConcurrentAppendException: Files were added to the root of the table by a concurrent update.';

function conflictingWarehouse(conflicts, message = CONFLICT) {
  const submitted = [];
  const waits = [];
  let left = conflicts;
  const dbFetch = async (_h, _t, apiPath, options = {}) => {
    if (options.method === 'POST') submitted.push(JSON.parse(options.body).statement);
    const failed = left > 0;
    if (failed) left -= 1;
    const status = failed ? { state: 'FAILED', error: { message } } : { state: 'SUCCEEDED' };
    return { ok: true, json: async () => ({ statement_id: 's1', status, manifest: { schema: { columns: [{ name: 'n' }] } }, result: { data_array: failed ? [] : [['1']] } }) };
  };
  const executeSql = createExecuteSql(dbFetch, { sleep: async (ms) => { waits.push(ms); }, random: () => 0.5 });
  return { executeSql, submitted, waits };
}

test('a write Delta rejects for a concurrent change is sent again after a growing wait, and succeeds', async () => {
  const w = conflictingWarehouse(2);
  const sql = "UPDATE `c`.`s`.`__inspire_session` SET processing_status = 'done' WHERE session_id = 7 AND processing_status = 'ready'";
  const result = await w.executeSql('h', 't', 'wh', sql);
  assert.deepEqual(result.result.data_array, [['1']]);
  assert.deepEqual(w.submitted, [sql, sql, sql], 'the same statement, three times');
  assert.deepEqual(w.waits, [375, 750], 'the wait doubles with each attempt, plus jitter');
});

test('a conflict that never clears stops after the attempt cap and throws the warehouse message', async () => {
  const w = conflictingWarehouse(99);
  await assert.rejects(w.executeSql('h', 't', 'wh', 'INSERT INTO t VALUES (1)'), /DELTA_CONCURRENT_APPEND/);
  assert.equal(w.submitted.length, CONFLICT_ATTEMPTS);
  assert.equal(w.waits.length, CONFLICT_ATTEMPTS - 1);
  const total = w.waits.reduce((a, b) => a + b, 0);
  assert.ok(CONFLICT_ATTEMPTS >= 8 && total >= CONFLICT_WINDOW_MS / 2 && total <= 2 * CONFLICT_WINDOW_MS, `retries span about a minute: ${total}ms`);
  assert.ok(Math.max(...w.waits) <= 2 * 8000, 'no single wait is longer than the cap');
});

test('an error that is not a concurrent change is thrown at once, never sent again', async () => {
  const w = conflictingWarehouse(1, '[TABLE_OR_VIEW_NOT_FOUND] The table or view `c`.`s`.`t` cannot be found.');
  await assert.rejects(w.executeSql('h', 't', 'wh', 'UPDATE t SET a = 1'), /TABLE_OR_VIEW_NOT_FOUND/);
  assert.equal(w.submitted.length, 1);
  assert.deepEqual(w.waits, []);
});

test('every Delta concurrent-change error counts as a conflict, and nothing else does', () => {
  for (const message of [CONFLICT, '[DELTA_CONCURRENT_DELETE_READ] ConcurrentDeleteReadException', 'io.delta.exceptions.ConcurrentTransactionException',
    '[DELTA_CONCURRENT_WRITE] ConcurrentWriteException', '[DELTA_METADATA_CHANGED] MetadataChangedException', 'ProtocolChangedException',
    'ConcurrentDeleteDeleteException']) {
    assert.equal(isDeltaWriteConflict(message), true, message);
  }
  for (const message of ['[TABLE_OR_VIEW_NOT_FOUND] x', 'PERMISSION_DENIED', 'MAX_CONCURRENT_RUNS_REACHED', 'MAXIMUM_CONCURRENT_RUNS_REACHED',
    '[DELTA_UNSUPPORTED_ROW_LEVEL_CHANGES] x', '', null, undefined]) {
    assert.equal(isDeltaWriteConflict(message), false, String(message));
  }
});

test('the server and implement routes write only through the one runner, with no second retry wrapper', () => {
  for (const file of ['server.js', 'implementRoutes.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.doesNotMatch(src, /executeSqlWithDeltaRetry|isDeltaConcurrentWriteConflict/, file);
  }
});

function columnAddSites(source) {
  const sites = [];
  let owner = '<module>';
  for (const line of source.split('\n')) {
    const named = line.match(/^\s*(?:async\s+)?function\s+(\w+)\s*\(|^\s*(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>/);
    if (named && !/^\s/.test(line)) owner = named[1] || named[2];
    const code = line.replace(/\/\/.*$/, '');
    if (/^\s*(\/\*\*?|\*)/.test(code)) continue;
    if (/\bALTER\s+TABLE\b.*\bADD\b|['"`]\s*ADD\s+COLUMNS?\s+\S/i.test(code)) sites.push(owner);
  }
  return sites;
}

test('the backend adds a column to a table only in ensureTableColumns, which keeps a column another writer added', () => {
  const root = path.join(__dirname, '..');
  const files = ['server.js', 'implementRoutes.js', 'stripAiDisclaimer.js', 'dbx_generate_demo_data.py',
    ...fileNames(path.join(root, 'lib')).filter((f) => f.endsWith('.js')).map((f) => path.join('lib', f))];
  const found = Object.fromEntries(files.map((f) => [f, columnAddSites(fs.readFileSync(path.join(root, f), 'utf8'))]).filter(([, s]) => s.length));
  assert.deepEqual(found, { 'server.js': ['ensureTableColumns', 'ensureTableColumns'] });
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.match(server, /if \(isAlterAddColumnAlreadyExistsError\(msg\)\) \{\s*return;/, 'a column already there counts as added');
  assert.ok(isDeltaWriteConflict('[DELTA_METADATA_CHANGED] MetadataChangedException: The metadata of the Delta table has been changed by a concurrent update.'),
    'executeSql tries a concurrent schema change again, so the next ALTER sees the column already there');
});

test('the backend column-add sweep catches a raw ALTER written any way and leaves other text', () => {
  for (const planted of [
    'async function migrate(t) {\n  await executeSql(h, k, w, `ALTER TABLE ${t} ADD COLUMNS (x STRING)`);\n}',
    'function migrate(t) {\n  return "alter table " + t + " add column x STRING";\n}',
    'const migrate = async (t) => {\n  const sql = "ALTER TABLE " + t +\n    " ADD COLUMN x STRING";\n};',
  ]) assert.ok(columnAddSites(planted).length, planted);
  for (const clean of [
    '/** True if ALTER TABLE ADD COLUMN failed only because the column is already present. */',
    "console.log(`   📌 Added column ${colName} (${i === 0 ? 'ADD COLUMN' : 'ADD COLUMNS'})`);",
    'const sql = `ALTER TABLE ${t} SET TBLPROPERTIES (a = 1)`;',
  ]) assert.deepEqual(columnAddSites(clean), [], clean);
});

test('a statement run inside a use case carries its query tags, and one outside carries none', async () => {
  const { createExecuteSql, runWithQueryTags } = require('../lib/sqlStatements');
  const bodies = [];
  const dbFetch = async (_h, _t, apiPath, options = {}) => {
    if (options.method === 'POST') bodies.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ statement_id: 's', status: { state: 'SUCCEEDED' }, result: { data_array: [] } }), text: async () => '' };
  };
  const executeSql = createExecuteSql(dbFetch, { sleep: async () => {} });
  await runWithQueryTags({ dbx_inspire_ai_usecase_id: ' N01-U01 ', dbx_inspire_ai_session_id: '42', dbx_inspire_ai_app_name: '', dbx_inspire_ai_asset: 'x'.repeat(300) },
    () => executeSql('h', 't', 'wh', 'SELECT 1'));
  await executeSql('h', 't', 'wh', 'SELECT 2');
  assert.deepEqual(bodies[0].query_tags, [
    { key: 'dbx_inspire_ai_usecase_id', value: 'N01-U01' },
    { key: 'dbx_inspire_ai_session_id', value: '42' },
    { key: 'dbx_inspire_ai_asset', value: 'x'.repeat(128) },
  ]);
  assert.equal('query_tags' in bodies[1], false);
});

test('the implement routes run every statement inside their query-tag scope', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'implementRoutes.js'), 'utf8');
  assert.match(src, /app\.use\('\/api\/inspire\/implement', \(req, res, next\) => runWithQueryTags\(\{/);
  assert.match(src, /dbx_inspire_ai_usecase_id: q\(req, 'use_case_id'\)/);
});
