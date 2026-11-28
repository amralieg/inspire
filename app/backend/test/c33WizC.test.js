// c33 lane C acceptance (REQ-578, REQ-579): the match routes and the launch rule. Generate Use Cases is no longer a launch operation;
// Match Use Cases is, with 19_match_phase match|accept. match/start writes the inputs and launches the Match run; match/result reads inputs,
// the latest report per input and the latest decision per piece; match/decision appends one row; match/accept launches phase 2 in the
// same session. SQL is answered through state.sqlHook with every row (the route dedupes in JS). Written by the c33 planner; the lane C
// builder may not edit this file.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./support/serverApp');

test.after(() => S.stopServer());

const PERSON = 'l@example.com';
const statements = () => S.state.calls.filter((c) => c.statement).map((c) => c.statement);
const launches = () => Object.values(S.state.runJobs).map((job) => job.tasks.find((t) => t.notebook_task).notebook_task.base_parameters);
const DB = { inspire_database: S.APP_DB, warehouse_id: S.APP_WAREHOUSE };
const USE_CASES = [
  { input_no: 1, name: 'Forecast weekly demand', description: 'Predict units per store and week' },
  { input_no: 2, name: 'Reduce customer churn', description: '' },
];
const PARAMS = { '00_business_name': 'Example Co', '01_uc_metadata': 'main.sales', '04_table_election': 'All Tables', '05_discovery_type': 'Standard' };

test('REQ-579: match/start writes the inputs and launches a Match Use Cases run in phase match (must-fail on the base)', async () => {
  S.reset({ notebookPresent: true });
  const got = await S.request('POST', '/api/inspire/match/start', { person: PERSON, body: { ...DB, business_name: 'Example Co', use_cases: USE_CASES, params: PARAMS } });
  assert.equal(got.status, 200, got.text);
  assert.ok(got.data.session_id, 'a session id is minted');
  assert.ok(got.data.run_id, 'a run id comes back');
  assert.ok(statements().some((s) => /INSERT\s+INTO[\s\S]*__inspire_match_input/i.test(s)), 'the inputs are written to __inspire_match_input');
  const sent = launches();
  assert.equal(sent.length, 1);
  assert.equal(sent[0]['15_operation'], 'Match Use Cases');
  assert.equal(sent[0]['19_match_phase'], 'match');
  assert.equal(String(sent[0]['14_session_id']), String(got.data.session_id));
  assert.equal(sent[0]['01_uc_metadata'], 'main.sales');
  assert.equal(sent[0]['00_business_name'], 'Example Co');
});

test('REQ-578: match/start refuses no use cases, more than 50, or a use case with no name (must-fail on the base)', async () => {
  const many = Array.from({ length: 51 }, (_, i) => ({ input_no: i + 1, name: `Use case ${i + 1}`, description: '' }));
  for (const [label, use_cases] of [['none', []], ['51', many], ['blank name', [{ input_no: 1, name: '  ', description: 'x' }]]]) {
    S.reset({ notebookPresent: true });
    const got = await S.request('POST', '/api/inspire/match/start', { person: PERSON, body: { ...DB, business_name: 'Example Co', use_cases, params: PARAMS } });
    assert.equal(got.status, 400, `${label}: ${got.text}`);
    assert.deepEqual(launches(), [], label);
  }
});

test('REQ-578: POST /api/run refuses Generate Use Cases and a bad match phase, and takes Match Use Cases (must-fail on the base)', async () => {
  const base = { ...PARAMS, '02_inspire_database': S.APP_DB, '14_session_id': '9201' };
  S.reset({ notebookPresent: true });
  const generate = await S.request('POST', '/api/run', { person: PERSON, body: { params: { ...base, '15_operation': 'Generate Use Cases' } } });
  assert.equal(generate.status, 400, generate.text);
  S.reset({ notebookPresent: true });
  const badPhase = await S.request('POST', '/api/run', { person: PERSON, body: { params: { ...base, '15_operation': 'Match Use Cases', '19_match_phase': 'later' } } });
  assert.equal(badPhase.status, 400, badPhase.text);
  S.reset({ notebookPresent: true });
  const discover = await S.request('POST', '/api/run', { person: PERSON, body: { params: { ...base, '15_operation': 'Discover Use Cases' } } });
  assert.equal(discover.status, 200, `must-keep: ${discover.text}`);
  assert.equal(launches().length, 1);
});

const INPUT_COLUMNS = ['session_id', 'input_no', 'name', 'description', 'event_at'];
const REPORT_COLUMNS = ['session_id', 'input_no', 'report_json', 'verdict', 'confidence', 'event_at'];
const DECISION_COLUMNS = ['session_id', 'input_no', 'piece_no', 'decision', 'event_at'];
const report = (input_no, verdict, confidence) => JSON.stringify({ input_no, name: USE_CASES[input_no - 1].name, verdict, confidence, pieces: [] });
function matchHook({ inputs = true, reports = true } = {}) {
  return (sql) => {
    if (!/^\s*(SELECT|WITH)\b/i.test(sql)) return null;
    if (/__inspire_match_input/.test(sql)) return S.sqlResult(INPUT_COLUMNS, inputs ? USE_CASES.map((u) => ['1001', String(u.input_no), u.name, u.description, '2026-11-28T09:00:00Z']) : []);
    if (/__inspire_match_decision/.test(sql)) return S.sqlResult(DECISION_COLUMNS, [
      ['1001', '1', '1', 'keep', '2026-11-28T10:00:00Z'], ['1001', '1', '1', 'drop', '2026-11-28T10:09:00Z'], ['1001', '1', '2', 'use_known_data', '2026-11-28T10:01:00Z']]);
    if (/__inspire_match\b/.test(sql)) return S.sqlResult(REPORT_COLUMNS, reports ? [
      ['1001', '2', report(2, 'none', 10), 'none', '10', '2026-11-28T09:05:00Z'],
      ['1001', '1', report(1, 'partial', 50), 'partial', '50', '2026-11-28T09:02:00Z'],
      ['1001', '1', report(1, 'full', 90), 'full', '90', '2026-11-28T09:08:00Z']] : []);
    return null;
  };
}
const resultQuery = (extra = '') => `/api/inspire/match/result?inspire_database=${S.APP_DB}&warehouse_id=${S.APP_WAREHOUSE}&session_id=1001${extra}`;

test('REQ-579: match/result answers the inputs, the latest report per input in input order, and the latest decision per piece (must-fail on the base)', async () => {
  S.reset();
  S.state.sqlHook = matchHook();
  const got = await S.request('GET', resultQuery(), { person: PERSON });
  assert.equal(got.status, 200, got.text);
  assert.equal(got.data.state, 'done', 'every input has a report');
  assert.deepEqual(got.data.inputs.map((i) => [i.input_no, i.name]), [[1, USE_CASES[0].name], [2, USE_CASES[1].name]]);
  assert.deepEqual(got.data.reports.map((r) => [r.input_no, r.verdict, r.confidence]), [[1, 'full', 90], [2, 'none', 10]], 'the newer report for input 1 wins');
  const decisions = got.data.decisions.map((d) => [d.input_no, d.piece_no, d.decision]).sort();
  assert.deepEqual(decisions, [[1, 1, 'drop'], [1, 2, 'use_known_data']], 'one decision per piece, the latest');
});

test('REQ-579: match/result is state none for a session with no match input, and running while a report is missing (must-fail on the base)', async () => {
  S.reset();
  S.state.sqlHook = matchHook({ inputs: false, reports: false });
  const none = await S.request('GET', resultQuery(), { person: PERSON });
  assert.equal(none.status, 200, none.text);
  assert.equal(none.data.state, 'none');
  assert.deepEqual(none.data.inputs, []);
  S.reset({ runStates: { 801: { life_cycle_state: 'RUNNING' } } });
  S.state.sqlHook = matchHook({ reports: false });
  const running = await S.request('GET', resultQuery('&run_id=801'), { person: PERSON });
  assert.equal(running.status, 200, running.text);
  assert.equal(running.data.state, 'running');
  assert.equal(running.data.inputs.length, 2, 'the inputs show from the start of the run');
  S.reset();
  S.state.sqlHook = (sql) => (/__inspire_match/.test(sql) ? { statement_id: 's1', status: { state: 'FAILED', error: { message: '[TABLE_OR_VIEW_NOT_FOUND] __inspire_match_input' } } } : null);
  const missing = await S.request('GET', resultQuery(), { person: PERSON });
  assert.equal(missing.status, 200, `no match table yet is state none, not an error: ${missing.text}`);
  assert.equal(missing.data.state, 'none');
});

const LAUNCHED = { notebookPresent: true, knownSessions: ['1001'], ledgerSessions: ['1001'], sessionLaunchers: { 1001: PERSON } };

test('REQ-579: match/decision appends one row and refuses an unknown decision (must-fail on the base)', async () => {
  S.reset(LAUNCHED);
  const ok = await S.request('POST', '/api/inspire/match/decision', { person: PERSON, body: { ...DB, session_id: '1001', input_no: 2, piece_no: 1, decision: 'use_known_data' } });
  assert.equal(ok.status, 200, ok.text);
  assert.deepEqual(ok.data, { ok: true });
  assert.equal(statements().filter((s) => /INSERT\s+INTO[\s\S]*__inspire_match_decision/i.test(s)).length, 1);
  for (const bad of [{ decision: 'maybe' }, { piece_no: 'x' }, { input_no: 0 }]) {
    S.reset(LAUNCHED);
    const got = await S.request('POST', '/api/inspire/match/decision', { person: PERSON, body: { ...DB, session_id: '1001', input_no: 2, piece_no: 1, decision: 'keep', ...bad } });
    assert.equal(got.status, 400, `${JSON.stringify(bad)}: ${got.text}`);
    assert.equal(statements().filter((s) => /__inspire_match_decision/.test(s) && /INSERT/i.test(s)).length, 0);
  }
});

test('REQ-579: match/accept launches phase accept in the same session (must-fail on the base)', async () => {
  S.reset(LAUNCHED);
  const got = await S.request('POST', '/api/inspire/match/accept', { person: PERSON, body: { ...DB, session_id: '1001', params: PARAMS } });
  assert.equal(got.status, 200, got.text);
  const sent = launches();
  assert.equal(sent.length, 1);
  assert.equal(sent[0]['15_operation'], 'Match Use Cases');
  assert.equal(sent[0]['19_match_phase'], 'accept');
  assert.equal(String(sent[0]['14_session_id']), '1001');
  assert.equal(String(got.data.session_id), '1001');
  assert.ok(got.data.run_id);
});
