const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startInspire } = require('./support/serverProcess');

const LEDGER = '`c`.`s`.`__inspire_value_ledger`';
const SESSIONS = '`c`.`s`.`__inspire_session`';
const QUERY = 'inspire_database=c.s&warehouse_id=w1';
const SESSION_COLUMNS = ['part', 'use_case_id', 'kind', 'currency', 'unit', 'amount', 'measured'];
const RUN_COLUMNS = ['part', 'session_id', 'kind', 'currency', 'unit', 'amount'];
const TOTAL_COLUMNS = ['part', 'kind', 'currency', 'unit', 'amount'];
const COUNT_COLUMNS = ['runs', 'businesses'];

const SESSION_ROWS = [
  ['stake', 'N01-U01', 'money', 'EUR', null, '1000', '1'],
  ['stake', 'N02-U01', 'money', 'USD', null, '500', '1'],
  ['stake', 'N03-U01', 'time', null, 'hours', '4', '1'],
  ['stake', 'N04-U01', 'time', null, 'days', '2', '1'],
  ['stake', 'N07-U01', 'money', 'EUR', null, null, '0'],
  ['saved', 'N01-U01', 'money', 'EUR', null, '250', '0'],
  ['saved', 'N02-U01', 'money', 'USD', null, '75', '0'],
];
const RUN_ROWS = [
  ['stake', '41', 'money', 'EUR', null, '100'],
  ['stake', '42', 'money', 'USD', null, '300'],
  ['stake', '42', 'time', null, 'hours', '2'],
  ['saved', '42', 'time', null, 'hours', '1'],
  ['measured', '41', null, null, null, '1'],
  ['measured', '42', null, null, null, '2'],
];
const TOTAL_ROWS = [['stake', 'money', 'EUR', null, '350'], ['saved', 'money', 'EUR', null, '30']];
// REQ-078: the use cases of the session with their domains, and each built use case's latest spec (its Measure rule and result table).
const USE_CASE_ROWS = [['N01-U01', 'Sales'], ['N01-U02', 'Sales'], ['N05-U01', 'Sales'], ['N07-U01', 'Finance']];
const SALES_RULE = { use_case_name: 'Sales App', money: { currency: 'convert', base: 'AED', value: { method: 'fixed', amount: 50, currency: 'AED' } } };
const SPEC_ROWS = [
  ['N01-U01', JSON.stringify({ ...SALES_RULE, config: { result_table: 'c.s.orders' } })],
  ['N05-U01', JSON.stringify({ use_case_name: 'Sales App', money: SALES_RULE.money, config: { result_table: 'c.s.orders' } })],
];

function fakeWarehouse() {
  const state = { statements: [], missingLedger: false };
  const answer = (sql) => {
    if (sql.includes(`FROM ${LEDGER}`) && state.missingLedger) {
      return { failed: `[TABLE_OR_VIEW_NOT_FOUND] The table or view ${LEDGER} cannot be found.` };
    }
    if (sql.includes('SELECT DISTINCT CAST(session_id')) return { columns: ['session_id'], rows: [['42'], ['43']] };
    if (sql.includes('SELECT id, business_domain FROM')) return { columns: ['id', 'business_domain'], rows: USE_CASE_ROWS };
    if (sql.includes('PARTITION BY use_case_id ORDER BY spec_version')) return { columns: ['use_case_id', 'spec'], rows: SPEC_ROWS };
    if (sql.includes('_summary` WHERE use_case_id')) return { columns: ['kpi_baseline'], rows: [['120']] };
    if (sql.includes("'measured' AS part")) return { columns: RUN_COLUMNS, rows: RUN_ROWS };
    if (sql.includes("WHERE session_id = '")) return { columns: SESSION_COLUMNS, rows: SESSION_ROWS };
    if (sql.includes('latest_sessions AS')) return { columns: TOTAL_COLUMNS, rows: TOTAL_ROWS };
    if (sql.includes('COUNT(DISTINCT COALESCE')) return { columns: COUNT_COLUMNS, rows: [['3', '2']] };
    return { columns: ['x'], rows: [] };
  };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const sent = body ? JSON.parse(body) : {};
      state.statements.push(sent);
      const { columns, rows, failed } = answer(String(sent.statement || ''));
      res.setHeader('Content-Type', 'application/json');
      if (failed) {
        res.end(JSON.stringify({ statement_id: `s${state.statements.length}`, status: { state: 'FAILED', error: { message: failed } } }));
        return;
      }
      res.end(JSON.stringify({ statement_id: `s${state.statements.length}`, status: { state: 'SUCCEEDED' },
        manifest: { schema: { columns: columns.map((name) => ({ name })) }, total_chunk_count: 1 }, result: { data_array: rows } }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, state, url: `http://127.0.0.1:${server.address().port}` })));
}

let warehouse;
let app;
test.before(async () => {
  warehouse = await fakeWarehouse();
  const inspire = await startInspire({ DATABRICKS_HOST: warehouse.url, DATABRICKS_TOKEN: 'test-token', NODE_ENV: 'test' });
  app = {
    get: async (route) => {
      const resp = await fetch(`${inspire.url}${route}`);
      return { status: resp.status, body: await resp.json() };
    },
    stop: inspire.stop,
  };
});
test.after(async () => {
  if (app) await app.stop();
  if (warehouse) await new Promise((resolve) => warehouse.server.close(resolve));
});

const reset = ({ missingLedger = false } = {}) => {
  warehouse.state.statements.length = 0;
  warehouse.state.missingLedger = missingLedger;
};
const statements = () => warehouse.state.statements.map((s) => s.statement);

test('GET /api/inspire/value answers the use case map and the run from the aggregated rows, keeping money and time apart', async () => {
  reset();
  const { status, body } = await app.get(`/api/inspire/value?${QUERY}&session_id=42`);
  assert.equal(status, 200, JSON.stringify(body));
  assert.deepEqual(body.run.at_stake, [
    { kind: 'money', unit: 'EUR', amount: 1000 }, { kind: 'money', unit: 'USD', amount: 500 }, { kind: 'time', unit: 'hours', amount: 52 },
  ]);
  assert.deepEqual(body.run.saved, [{ kind: 'money', unit: 'EUR', amount: 250 }, { kind: 'money', unit: 'USD', amount: 75 }]);
  assert.equal(body.run.mvps_measured, 4);
  assert.deepEqual(body.use_cases['N07-U01'], { at_stake: [], saved: [], measured: false });
  assert.equal(statements().length, 1, 'one statement per route');
});

test('GET /api/inspire/value/runs answers each run with its own totals and measured count', async () => {
  reset();
  const { status, body } = await app.get(`/api/inspire/value/runs?${QUERY}`);
  assert.equal(status, 200, JSON.stringify(body));
  assert.deepEqual(body, {
    runs: {
      41: { at_stake: [{ kind: 'money', unit: 'EUR', amount: 100 }], saved: [], mvps_measured: 1 },
      42: { at_stake: [{ kind: 'money', unit: 'USD', amount: 300 }, { kind: 'time', unit: 'hours', amount: 2 }],
        saved: [{ kind: 'time', unit: 'hours', amount: 1 }], mvps_measured: 2 },
    },
  });
  assert.equal(statements().length, 1);
});

test('GET /api/inspire/value/overall answers the latest-run totals, the saved totals and the run and business counts', async () => {
  reset();
  const { status, body } = await app.get(`/api/inspire/value/overall?${QUERY}`);
  assert.equal(status, 200, JSON.stringify(body));
  assert.deepEqual(body, { at_stake: [{ kind: 'money', unit: 'EUR', amount: 350 }], saved: [{ kind: 'money', unit: 'EUR', amount: 30 }],
    runs: 3, businesses: 2 });
});

test('no value route reads the raw ledger rows: every statement aggregates in SQL', async () => {
  reset();
  await app.get(`/api/inspire/value?${QUERY}&session_id=42`);
  await app.get(`/api/inspire/value/runs?${QUERY}`);
  await app.get(`/api/inspire/value/overall?${QUERY}`);
  const sent = statements();
  assert.equal(sent.length, 4);
  for (const sql of sent) assert.match(sql, /GROUP BY|COUNT\(/);
});

test('a missing ledger table answers empty totals, not an error, on every value route', async () => {
  reset({ missingLedger: true });
  assert.deepEqual((await app.get(`/api/inspire/value?${QUERY}&session_id=42`)).body,
    { use_cases: {}, run: { at_stake: [], saved: [], mvps_measured: 0 } });
  assert.deepEqual((await app.get(`/api/inspire/value/runs?${QUERY}`)).body, { runs: {} });
  const overall = await app.get(`/api/inspire/value/overall?${QUERY}`);
  assert.equal(overall.status, 200);
  assert.deepEqual(overall.body, { at_stake: [], saved: [], runs: 3, businesses: 2 });
});

test('a session id that is not numeric is refused before any SQL is sent', async () => {
  reset();
  const { status, body } = await app.get(`/api/inspire/value?${QUERY}&session_id=42;DROP`);
  assert.equal(status, 400);
  assert.equal(body.error, 'session_id must be numeric.');
  assert.equal(statements().length, 0);
});

test('GET /api/inspire/value/estimates: measured use cases are never estimated, an unbuilt sibling gets no number, a built one gets its own baseline', async () => {
  reset();
  const { status, body } = await app.get(`/api/inspire/value/estimates?${QUERY}&session_id=42`);
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.use_cases['N01-U01'], null, 'measured');
  assert.deepEqual(body.use_cases['N01-U02'], { status: 'no_baseline', app: 'Sales App' }, 'unbuilt sibling takes the App rule, no number');
  assert.deepEqual(body.use_cases['N05-U01'], { status: 'estimated', app: 'Sales App', currency: 'AED', per_record: 50, baseline: 120, amount: 6000 });
  assert.deepEqual(body.use_cases['N07-U01'], { status: 'set_rule' }, 'no rule in its domain: ask for one, no number');
  assert.deepEqual(body.totals, { estimated: { AED: 6000 } }, 'estimates are totalled apart from measured money');
  const baselineReads = statements().filter((sql) => sql.includes('_summary` WHERE use_case_id'));
  assert.equal(baselineReads.length, 1, 'the baseline is read only for the built, unmeasured use case');
});

test('GET /api/inspire/value/estimates with no session answers every run by session id, and the total over them, per currency', async () => {
  reset();
  const { status, body } = await app.get(`/api/inspire/value/estimates?${QUERY}`);
  assert.equal(status, 200, JSON.stringify(body));
  assert.deepEqual(Object.keys(body.runs).sort(), ['42', '43']);
  assert.deepEqual(body.runs['42'].totals, { estimated: { AED: 6000 } });
  assert.deepEqual(body.runs['43'].use_cases['N05-U01'], { status: 'estimated', app: 'Sales App', currency: 'AED', per_record: 50, baseline: 120, amount: 6000 });
  assert.deepEqual(body.totals, { estimated: { AED: 12000 } }, 'the banner total is the sum of the runs, estimates still apart from measured money');
});
