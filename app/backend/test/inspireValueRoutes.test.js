const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startInspire } = require('./support/serverProcess');

const LEDGER = '`c`.`s`.`__inspire_value_ledger`';
const SESSIONS = '`c`.`s`.`__inspire_session`';
const LEDGER_COLUMNS = ['session_id', 'result_table', 'use_case_id', 'run_id', 'record_key', 'kind', 'currency', 'unit', 'at_stake', 'saved', 'recorded_at'];
const SESSION_COLUMNS = ['session_id', 'business_name', 'create_at'];
const SESSION_QUERY = 'inspire_database=c.s&warehouse_id=w1';

const row = (session, uc, kind, unit, amount, at, run, key = null, result = 'main.out.queue') => [
  session, result, uc, run, key, kind, kind === 'money' ? unit : null, kind === 'money' ? null : unit,
  kind === 'money' && key != null ? null : amount, key != null ? amount : null, at,
];

function fakeWarehouse() {
  const state = { statements: [], ledger: [], sessions: [], missingLedger: false };
  const answer = (sql) => {
    if (sql.includes(`FROM ${LEDGER}`)) {
      if (state.missingLedger) return { failed: `[TABLE_OR_VIEW_NOT_FOUND] The table or view ${LEDGER} cannot be found.` };
      const session = (sql.match(/WHERE session_id = '(\d+)'/) || [])[1];
      const rows = session ? state.ledger.filter((r) => r[0] === session) : state.ledger;
      return { columns: LEDGER_COLUMNS, rows };
    }
    if (sql.startsWith(`SELECT session_id, business_name, create_at FROM ${SESSIONS}`)) {
      return { columns: SESSION_COLUMNS, rows: state.sessions };
    }
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

const reset = ({ ledger = [], sessions = [], missingLedger = false } = {}) => {
  warehouse.state.statements.length = 0;
  warehouse.state.ledger = ledger;
  warehouse.state.sessions = sessions;
  warehouse.state.missingLedger = missingLedger;
};

test('GET /api/inspire/value keeps two currencies and two time units of one run apart and answers the use case map and the run', async () => {
  reset({ ledger: [
    row('42', 'N01-U01', 'money', 'EUR', '1000', '2026-11-10 10:00:00', '9001'),
    row('42', 'N02-U01', 'money', 'USD', '500', '2026-11-10 10:01:00', '9001'),
    row('42', 'N03-U01', 'time', 'hours', '4', '2026-11-10 10:02:00', '9001'),
    row('42', 'N04-U01', 'time', 'days', '2', '2026-11-10 10:03:00', '9001'),
    row('42', 'N01-U01', 'money', 'EUR', '250', '2026-11-10 11:00:00', '9001', 'rec-1'),
    row('42', 'N02-U01', 'money', 'USD', '75', '2026-11-10 11:00:00', '9001', 'rec-2'),
  ] });
  const { status, body } = await app.get(`/api/inspire/value?inspire_database=c.s&warehouse_id=w1&session_id=42`);
  assert.equal(status, 200, JSON.stringify(body));
  assert.deepEqual(body.run.at_stake, [
    { kind: 'money', unit: 'EUR', amount: 1000 },
    { kind: 'money', unit: 'USD', amount: 500 },
    { kind: 'time', unit: 'hours', amount: 52 },
  ], 'hours and days of one run convert to hours; money stays per currency');
  assert.deepEqual(body.run.saved, [
    { kind: 'money', unit: 'EUR', amount: 250 },
    { kind: 'money', unit: 'USD', amount: 75 },
  ]);
  assert.equal(body.run.mvps_measured, 4);
  assert.deepEqual(body.use_cases['N01-U01'], {
    at_stake: [{ kind: 'money', unit: 'EUR', amount: 1000 }], saved: [{ kind: 'money', unit: 'EUR', amount: 250 }], measured: true,
  });
});

test('GET /api/inspire/value says a use case is not measured with no entry, and never reads a zero', async () => {
  reset({ ledger: [row('42', 'N07-U01', 'money', 'EUR', null, '2026-11-10 10:00:00', '9001')] });
  const { status, body } = await app.get(`/api/inspire/value?inspire_database=c.s&warehouse_id=w1&session_id=42`);
  assert.equal(status, 200);
  assert.deepEqual(body.use_cases['N07-U01'], { at_stake: [], saved: [], measured: false });
  assert.deepEqual(body.run, { at_stake: [], saved: [], mvps_measured: 0 });
});

test('GET /api/inspire/value answers an empty run when the ledger table does not exist yet', async () => {
  reset({ missingLedger: true });
  const { status, body } = await app.get(`/api/inspire/value?inspire_database=c.s&warehouse_id=w1&session_id=42`);
  assert.equal(status, 200);
  assert.deepEqual(body, { use_cases: {}, run: { at_stake: [], saved: [], mvps_measured: 0 } });
});

test('GET /api/inspire/value refuses a session id that is not numeric before any SQL is sent', async () => {
  reset();
  const { status, body } = await app.get(`/api/inspire/value?inspire_database=c.s&warehouse_id=w1&session_id=42;DROP`);
  assert.equal(status, 400);
  assert.equal(body.error, 'session_id must be numeric.');
  assert.equal(warehouse.state.statements.length, 0);
});

test('GET /api/inspire/value/overall counts at stake from the latest run of each business and saved from every run', async () => {
  reset({
    sessions: [['41', 'Acme', '2026-11-08 09:00:00'], ['42', 'Acme', '2026-11-10 09:00:00'], ['43', 'Globex', '2026-11-09 09:00:00']],
    ledger: [
      row('41', 'N01-U01', 'money', 'EUR', '100', '2026-11-08 10:00:00', '8001'),
      row('42', 'N01-U01', 'money', 'EUR', '300', '2026-11-10 10:00:00', '9001'),
      row('43', 'N09-U01', 'money', 'EUR', '50', '2026-11-09 10:00:00', '9002'),
      row('41', 'N01-U01', 'money', 'EUR', '10', '2026-11-08 11:00:00', '8001', 'a'),
      row('42', 'N01-U01', 'money', 'EUR', '20', '2026-11-10 11:00:00', '9001', 'b'),
    ],
  });
  const { status, body } = await app.get(`/api/inspire/value/overall?${SESSION_QUERY}`);
  assert.equal(status, 200, JSON.stringify(body));
  assert.deepEqual(body.at_stake, [{ kind: 'money', unit: 'EUR', amount: 350 }]);
  assert.deepEqual(body.saved, [{ kind: 'money', unit: 'EUR', amount: 30 }]);
  assert.equal(body.runs, 3);
  assert.equal(body.businesses, 2);
});
