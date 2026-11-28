// c36 UI lane (REQ-581, U4 in the agent/UI interface): the session row carries pending_artifacts, a JSON list of
// { kind: docs | genie_instructions | notebook | translation, use_case_id: string or null } the Discover run left for Implement.
// GET /api/inspire/results answers it beside the results as pending_artifacts (parsed, unknown kinds dropped, [] when empty, missing,
// not JSON, or the column does not exist on an older database). Written by the c36 spec writer; the builder may not edit this file.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./support/serverApp');

test.after(() => S.stopServer());

const PERSON = 'l@example.com';
const RESULTS = JSON.stringify({ title: 'Example Co', domains: [{ domain_name: 'Sales', use_cases: [{ No: 'N01-U01', Name: 'Forecast weekly demand' }] }] });
const PENDING = JSON.stringify([
  { kind: 'genie_instructions', use_case_id: 'N01-U01' },
  { kind: 'notebook', use_case_id: 'N01-U01' },
  { kind: 'docs', use_case_id: null },
  { kind: 'translation', use_case_id: null },
  { kind: 'something_else', use_case_id: null },
]);
// Answers the session row whether the route reads pending_artifacts in the results statement or in a statement of its own.
function sessionHook(pending, { columnMissing = false } = {}) {
  return (sql) => {
    if (!/__inspire_session/.test(sql) || !/^\s*SELECT\b/i.test(sql)) return null;
    if (/schemas_str, tables_str FROM/.test(sql)) return null;
    if (/pending_artifacts/.test(sql) && columnMissing) {
      return { statement_id: 's1', status: { state: 'FAILED', error: { message: '[UNRESOLVED_COLUMN.WITH_SUGGESTION] A column, variable, or function parameter with name `pending_artifacts` cannot be resolved.' } } };
    }
    if (/results_json/.test(sql)) {
      return S.sqlResult(['results_json', 'completed_on', 'session_id', 'pending_artifacts'], [[RESULTS, '2026-11-28T10:00:00Z', '1001', pending]]);
    }
    if (/pending_artifacts/.test(sql)) return S.sqlResult(['pending_artifacts', 'session_id'], [[pending, '1001']]);
    return null;
  };
}
const query = `/api/inspire/results?inspire_database=${S.APP_DB}&warehouse_id=${S.APP_WAREHOUSE}&session_id=1001`;

test('REQ-581 U4: GET /api/inspire/results answers the session pending_artifacts beside the results (must-fail on the base)', async () => {
  S.reset();
  S.state.sqlHook = sessionHook(PENDING);
  const got = await S.request('GET', query, { person: PERSON });
  assert.equal(got.status, 200, got.text);
  assert.ok(got.data.results, 'the results still come back');
  assert.deepEqual(got.data.pending_artifacts, [
    { kind: 'genie_instructions', use_case_id: 'N01-U01' },
    { kind: 'notebook', use_case_id: 'N01-U01' },
    { kind: 'docs', use_case_id: null },
    { kind: 'translation', use_case_id: null },
  ], 'parsed, known kinds only, use_case_id kept (null means the whole session)');
});

test('REQ-581 U4: an empty, missing or broken pending_artifacts, or an older database without the column, answers [] and the results (must-fail on the base)', async () => {
  for (const [label, pending, opts] of [['empty list', '[]', {}], ['null', null, {}], ['not json', 'not json', {}], ['no column', '[]', { columnMissing: true }]]) {
    S.reset();
    S.state.sqlHook = sessionHook(pending, opts);
    const got = await S.request('GET', query, { person: PERSON });
    assert.equal(got.status, 200, `${label}: ${got.text}`);
    assert.ok(got.data.results, `${label}: the results still come back`);
    assert.deepEqual(got.data.pending_artifacts, [], label);
  }
});
