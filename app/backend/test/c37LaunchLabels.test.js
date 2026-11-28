// c37 (REQ-582, REQ-583): the launch labels the scope before a Let Inspire Decides run is submitted, and never blocks the launch.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./support/serverApp');

test.after(() => S.stopServer());

const ME = 'launcher@example.com';
const PARAMS = (election) => ({ '00_business_name': 'Acme', '01_uc_metadata': 'main.sales', '02_inspire_database': S.APP_DB, '04_table_election': election,
  '14_session_id': '7100', '15_operation': 'Discover Use Cases' });
const world = (extra = {}) => S.reset({ notebookPresent: true, ucSchemas: { main: ['sales'] }, gatewayModelIds: ['system.ai.claude-sonnet-4-6', 'system.ai.claude-haiku-4-5'],
  ucTables: { 'main.sales': [{ name: 'orders', comment: 'one row per order', columns: [{ name: 'id', type_text: 'bigint' }] }, { name: 'dim', columns: [] }] },
  gatewayChat: () => ({ data: { choices: [{ message: { content: '1|p|t\n2|p|m' } }] } }), ...extra });
const idx = (pred) => S.state.calls.findIndex(pred);
const chats = () => S.state.calls.filter((c) => c.path === '/ai-gateway/mlflow/v1/chat/completions');
const labelSql = (re) => (c) => c.path === '/api/2.0/sql/statements' && re.test(c.statement);
const launch = (election) => S.request('POST', '/api/run', { person: ME, body: { params: PARAMS(election) } });

test('Let Inspire Decides labels the tables with the cheapest model and writes them before the job is triggered', async () => {
  world();
  const got = await launch('Let Inspire Decides');
  assert.equal(got.status, 200, got.text.slice(0, 300));
  const chat = idx((c) => c.path === '/ai-gateway/mlflow/v1/chat/completions');
  const create = idx(labelSql(/CREATE TABLE IF NOT EXISTS main\.inspire\.__inspire_table_labels/));
  const insert = idx(labelSql(/INSERT INTO main\.inspire\.__inspire_table_labels/));
  const runNow = idx((c) => c.path === '/api/2.1/jobs/run-now');
  assert.ok(chat >= 0 && chat < create && create < insert && insert < runNow, `call order: ${[chat, create, insert, runNow]}`);
  assert.equal(JSON.parse(chats()[0].raw).model, 'system.ai.claude-haiku-4-5');
});

test('another election mode writes nothing and makes no model call (must-exclude)', async () => {
  world();
  const got = await launch('All Tables');
  assert.equal(got.status, 200, got.text.slice(0, 300));
  assert.equal(chats().length, 0);
  assert.equal(S.state.calls.filter(labelSql(/__inspire_table_labels/)).length, 0);
  assert.ok(idx((c) => c.path === '/api/2.1/jobs/run-now') >= 0);
});

test('a model 503 still launches, and no model label is written (only the user-named scope rows)', async () => {
  world({ gatewayChat: () => ({ status: 503, data: { error_code: 'TEMPORARILY_UNAVAILABLE', message: 'gateway 503' } }) });
  const got = await launch('Let Inspire Decides');
  assert.equal(got.status, 200, got.text.slice(0, 300));
  assert.ok(idx((c) => c.path === '/api/2.1/jobs/run-now') >= 0);
  assert.ok(S.state.calls.filter(labelSql(/INSERT INTO .*__inspire_table_labels/)).every((c) => !/app:system\.ai/.test(c.raw)));
});

test('a failed write of the labels still launches', async () => {
  world({ sqlHook: (sql) => (/__inspire_table_labels/.test(sql) ? { statement_id: 's1', status: { state: 'FAILED', error: { message: 'no CREATE TABLE here' } } } : null) });
  const got = await launch('Let Inspire Decides');
  assert.equal(got.status, 200, got.text.slice(0, 300));
  assert.ok(idx((c) => c.path === '/api/2.1/jobs/run-now') >= 0);
});

test('no Claude model on the gateway still launches with no model call', async () => {
  world({ gatewayModelIds: ['system.ai.gpt-5'] });
  const got = await launch('Let Inspire Decides');
  assert.equal(got.status, 200, got.text.slice(0, 300));
  assert.equal(chats().length, 0);
});
