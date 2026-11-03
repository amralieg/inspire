const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startInspire } = require('./support/serverProcess');

const FIXTURE = require('../../frontend/test/ui/runSummary.json');
const SESSION = '`c`.`s`.`__inspire_session`';
const STEP = '`c`.`s`.`__inspire_step`';
const QUERY = 'inspire_database=c.s&warehouse_id=w1&session_id=42';
const SUMMARY = FIXTURE.results_json.executive_summary;

const STEP_ROWS = [
  ['1', 'Use Case Generation', 'Base', 'ended_success', JSON.stringify({
    prompt_name: 'BASE_USE_CASE_GEN_PROMPT', use_cases: [{ id: 'N01-U01', name: 'Predict churn', business_domain: 'Customer' }] })],
  ['2', 'Executive Readout', 'Building Executive Summary', 'ended_success', JSON.stringify({
    prompt_name: 'SUMMARY_GEN_PROMPT', entity_id: 'SUMMARY_GEN_PROMPT:Executive_Summary_English', response_chars: 40,
    rows: [{ Summary: '<p>Text the App must not read from a step row.</p>' }] })],
];

const asText = (v) => (typeof v === 'string' ? v : JSON.stringify(v));

function fakeWarehouse() {
  const state = { statements: [], session: null, completed: null };
  const answer = (sql) => {
    if (sql.startsWith('SELECT results_json, completed_on, session_id FROM')) {
      if (state.denied) return { failed: state.denied };
      if (state.pending) return { columns: ['results_json', 'completed_on', 'session_id'], rows: [[asText(state.pending), null, '42']] };
      return { columns: ['results_json', 'completed_on', 'session_id'], rows: state.completed ? [[asText(state.completed), '2026-10-31T10:00:00Z', '42']] : [] };
    }
    if (sql.startsWith(`SELECT results_json FROM ${SESSION}`)) {
      return { columns: ['results_json'], rows: state.session ? [[asText(state.session)]] : [] };
    }
    if (sql.includes(STEP)) return { columns: ['step_id', 'stage_name', 'step_name', 'status', 'result_json'], rows: STEP_ROWS };
    if (sql.startsWith('SELECT session_id, processing_status')) {
      return { columns: ['session_id', 'business_name', 'business_runs', 'business_rank', 'completed_percent'], rows: state.runs || [] };
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

async function startApp(warehouseUrl) {
  const inspire = await startInspire({ DATABRICKS_HOST: warehouseUrl, DATABRICKS_TOKEN: 'test-token', NODE_ENV: 'test' });
  return {
    get: async (route) => {
      const resp = await fetch(`${inspire.url}${route}`);
      return { status: resp.status, body: await resp.json() };
    },
    stop: inspire.stop,
  };
}

let warehouse;
let app;
test.before(async () => {
  warehouse = await fakeWarehouse();
  app = await startApp(warehouse.url);
});
test.after(async () => {
  if (app) await app.stop();
  if (warehouse) await new Promise((resolve) => warehouse.server.close(resolve));
});

const reset = (session, completed, { pending = null, denied = '' } = {}) => {
  warehouse.state.statements.length = 0;
  warehouse.state.session = session;
  warehouse.state.completed = completed;
  warehouse.state.pending = pending;
  warehouse.state.denied = denied;
};
const statements = () => warehouse.state.statements.map((s) => s.statement);

test('GET /api/inspire/results answers the summary results_json holds, from that one read', async () => {
  reset(null, { domains: [], title: 'Acme Use Cases Catalog', ...FIXTURE.results_json });
  const { status, body } = await app.get(`/api/inspire/results?${QUERY}`);
  assert.equal(status, 200);
  assert.equal(body.results.executive_summary, SUMMARY);
  assert.equal(body.results.title, 'Acme Use Cases Catalog');
  assert.equal(statements().length, 1, 'no second read for a summary');
  assert.equal(statements().some((sql) => sql.includes(STEP)), false);
});

test('GET /api/inspire/results answers a 19-digit session id the agent wrote as a JSON number byte for byte', async () => {
  const sid = '2222222222222222222';
  reset(null, `{"_source_session_id": ${sid}, "domains": [], "executive_summary": "Text"}`);
  const results = await app.get(`/api/inspire/results?${QUERY}`);
  assert.equal(results.status, 200);
  assert.equal(results.body.results._source_session_id, sid);
});

test('GET /api/inspire/results says whether the Inspire Database has the run, keeps an unfinished run unfinished, and answers 403 when the sign-in cannot read it', async () => {
  reset(null, null);
  const none = await app.get(`/api/inspire/results?${QUERY}`);
  assert.equal(none.status, 200);
  assert.deepEqual([none.body.results, none.body.found], [null, false], 'no row means no such run');
  assert.ok(statements()[0].endsWith('WHERE session_id = 42 LIMIT 1'), 'the run is looked up finished or not');
  reset(null, null, { pending: { executive_summary: 'Early summary', domains: [] } });
  const pending = await app.get(`/api/inspire/results?${QUERY}`);
  assert.deepEqual([pending.status, pending.body.results, pending.body.found], [200, null, true], 'an unfinished run is there, with no final results yet');
  reset(null, { domains: [] });
  const done = await app.get(`/api/inspire/results?${QUERY}`);
  assert.deepEqual([done.body.found, Array.isArray(done.body.results.domains)], [true, true]);
  reset(null, null, { denied: 'PERMISSION_DENIED: User does not have SELECT on Table `c`.`s`.`__inspire_session`.' });
  const denied = await app.get(`/api/inspire/results?${QUERY}`);
  assert.equal(denied.status, 403);
  assert.match(denied.body.error, /PERMISSION_DENIED/);
  reset(null, null, { denied: 'The SQL warehouse is stopped.' });
  const broken = await app.get(`/api/inspire/results?${QUERY}`);
  assert.equal(broken.status, 500, 'any other failure is not a missing permission');
  reset(null, null);
  const latest = await app.get('/api/inspire/results?inspire_database=c.s&warehouse_id=w1');
  assert.ok(statements()[0].includes("WHERE completed_on IS NOT NULL AND COALESCE(LOWER(processing_status), '') <> 'failed' ORDER BY completed_on DESC LIMIT 1"),
    'with no run named, the newest run that finished without failing');
  assert.equal(latest.body.results, null);
});

test('GET /api/inspire/results answers an empty summary for results_json without one and never looks in the step rows', async () => {
  reset(null, { ailogs_check: { passed: 8 }, discovery_type: 'Standard' });
  const { status, body } = await app.get(`/api/inspire/results?${QUERY}`);
  assert.equal(status, 200);
  assert.equal(body.results.executive_summary, '');
  assert.deepEqual(statements().filter((sql) => sql.includes(STEP)), []);
});

test('GET /api/inspire/step-results answers the summary from the session results_json, not from the step rows', async () => {
  reset(FIXTURE.results_json, null);
  const { status, body } = await app.get(`/api/inspire/step-results?${QUERY}`);
  assert.equal(status, 200);
  assert.equal(body.results.executive_summary, SUMMARY);
  assert.equal(body.results._use_case_count, 1);
  const read = warehouse.state.statements.find((s) => String(s.statement).startsWith(`SELECT results_json FROM ${SESSION}`));
  assert.ok(read, 'the progressive route reads the session row');
  assert.deepEqual(read.parameters, [{ name: 'sid', value: '42', type: 'BIGINT' }]);
});

test('GET /api/inspire/sessions lists 20 runs, or up to 1,000 with all=1 for Start, and says when the database holds more', async () => {
  reset(null, null);
  warehouse.state.runs = Array.from({ length: 21 }, (_, i) => [String(100 + i), 'Acme', '21', String(i + 1), '100']);
  const base = '/api/inspire/sessions?inspire_database=c.s&warehouse_id=w1';
  const short = await app.get(base);
  assert.equal(short.status, 200, JSON.stringify(short.body));
  assert.deepEqual([short.body.sessions.length, short.body.truncated], [20, true]);
  assert.ok(statements()[0].endsWith('ORDER BY create_at DESC LIMIT 21'), statements()[0]);
  reset(null, null);
  const all = await app.get(`${base}&all=1`);
  assert.deepEqual([all.body.sessions.length, all.body.truncated], [21, false]);
  assert.ok(statements()[0].endsWith('ORDER BY create_at DESC LIMIT 1001'), statements()[0]);
  reset(null, null);
  const other = await app.get(`${base}&all=yes`);
  assert.equal(other.body.sessions.length, 20, 'only all=1 asks for the long list');
  warehouse.state.runs = [];
});

test('GET /api/inspire/step-results answers no summary while results_json has none, whatever the step rows say', async () => {
  for (const session of [{}, null]) {
    reset(session, null);
    const { status, body } = await app.get(`/api/inspire/step-results?${QUERY}`);
    assert.equal(status, 200);
    assert.equal(body.results.executive_summary, '', JSON.stringify(session));
  }
});
