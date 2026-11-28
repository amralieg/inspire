// c36 UI lane (REQ-581, U3 in the agent/UI interface): the App reads <inspire_db>.__inspire_candidates for one session through
// GET /api/inspire/candidates?inspire_database&warehouse_id&session_id and answers
//   { candidates: [{ candidate_id, state, merged_into, provisional_rank, name, history, event_at }] }
// one row per candidate_id (the latest event_at wins), ordered by provisional_rank (no rank last), then candidate_id. name is the latest
// history entry's name (or candidate_id when none); history is history_json parsed to an array ([] when it does not parse). A database
// with no candidate table yet answers an empty list, not an error. SQL is answered through state.sqlHook with every row (the route
// dedupes in JS). Written by the c36 spec writer; the builder may not edit this file.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./support/serverApp');
const P = require('../lib/routePolicy');

test.after(() => S.stopServer());

const PERSON = 'l@example.com';
const COLUMNS = ['session_id', 'candidate_id', 'state', 'merged_into', 'provisional_rank', 'history_json', 'event_at'];
const hist = (...steps) => JSON.stringify(steps.map(([state, stage, name]) => ({ state, stage, at: '2026-11-28T09:00:00Z', ...(name ? { name } : {}) })));
const ROWS = [
  // c-a: eligible, then selected later: the later row wins.
  ['1001', 'c-a', 'eligible', null, '2', hist(['proposed', 'Use Cases Generation', 'Forecast weekly demand'], ['eligible', 'Scoring', 'Forecast weekly demand']), '2026-11-28T09:10:00Z'],
  ['1001', 'c-a', 'selected', null, '1', hist(['eligible', 'Scoring', 'Forecast weekly demand'], ['selected', 'Final Gate', 'Forecast weekly demand']), '2026-11-28T09:20:00Z'],
  // c-b: an older measured row arrives after a newer eligible one in the answer: the newer event_at still wins.
  ['1001', 'c-b', 'eligible', null, '2', hist(['eligible', 'Scoring', 'Reduce customer churn']), '2026-11-28T09:15:00Z'],
  ['1001', 'c-b', 'measured', null, null, hist(['measured', 'Scoring', 'Reduce customer churn']), '2026-11-28T09:05:00Z'],
  // c-c: merged into c-a; history that does not parse answers [] and the name falls back to the id.
  ['1001', 'c-c', 'merged', 'c-a', null, 'not json', '2026-11-28T09:12:00Z'],
  // c-d: eligible with rank 3.
  ['1001', 'c-d', 'eligible', null, '3', hist(['eligible', 'Scoring', 'Score supplier risk']), '2026-11-28T09:16:00Z'],
];
function candidateHook(rows = ROWS) {
  return (sql) => {
    if (!/__inspire_candidates/.test(sql)) return null;
    if (!/^\s*(SELECT|WITH)\b/i.test(sql)) return null;
    return S.sqlResult(COLUMNS, rows);
  };
}
const query = (extra = '&session_id=1001') => `/api/inspire/candidates?inspire_database=${S.APP_DB}&warehouse_id=${S.APP_WAREHOUSE}${extra}`;
const candidateStatements = () => S.state.calls.filter((c) => c.statement && /__inspire_candidates/.test(c.statement));

test('REQ-581 U3: GET /api/inspire/candidates answers one row per candidate, the latest event_at wins, ordered by provisional rank (must-fail on the base)', async () => {
  S.reset();
  S.state.sqlHook = candidateHook();
  const got = await S.request('GET', query(), { person: PERSON });
  assert.equal(got.status, 200, got.text);
  assert.ok(Array.isArray(got.data.candidates), 'answers a candidates list');
  assert.deepEqual(got.data.candidates.map((c) => [c.candidate_id, c.state, c.provisional_rank]),
    [['c-a', 'selected', 1], ['c-b', 'eligible', 2], ['c-d', 'eligible', 3], ['c-c', 'merged', null]],
    'one row per candidate (latest event_at), ranked first, unranked last');
  const byId = Object.fromEntries(got.data.candidates.map((c) => [c.candidate_id, c]));
  assert.equal(byId['c-c'].merged_into, 'c-a', 'a merged candidate names the candidate it was merged into');
  assert.equal(byId['c-a'].merged_into ?? null, null);
  assert.equal(byId['c-b'].name, 'Reduce customer churn', 'the name comes from the latest history entry');
  assert.equal(byId['c-c'].name, 'c-c', 'no name in the history: the id stands in');
  assert.deepEqual(byId['c-c'].history, [], 'history that does not parse answers an empty list');
  assert.deepEqual(byId['c-a'].history.map((h) => h.state), ['eligible', 'selected'], 'history_json is parsed');
  assert.ok(byId['c-a'].event_at, 'event_at is answered');
  const sent = candidateStatements();
  assert.equal(sent.length, 1, 'one read of the candidate table');
  assert.match(sent[0].statement, /`main`\.`inspire`\.`__inspire_candidates`/, 'reads the table in the Inspire database asked for');
  const bound = ((JSON.parse(sent[0].raw || '{}').parameters) || []).some((p) => String(p.value) === '1001') || /session_id\s*=\s*1001\b/.test(sent[0].statement);
  assert.ok(bound, 'the read is limited to the session asked for');
});

test('REQ-581 U3: a database with no candidate table answers an empty list; an empty table answers an empty list (must-fail on the base)', async () => {
  S.reset();
  S.state.sqlHook = (sql) => (/__inspire_candidates/.test(sql)
    ? { statement_id: 's1', status: { state: 'FAILED', error: { message: '[TABLE_OR_VIEW_NOT_FOUND] The table or view `main`.`inspire`.`__inspire_candidates` cannot be found.' } } } : null);
  const missing = await S.request('GET', query(), { person: PERSON });
  assert.equal(missing.status, 200, `no candidate table yet is an empty list, not an error: ${missing.text}`);
  assert.deepEqual(missing.data.candidates, []);
  S.reset();
  S.state.sqlHook = candidateHook([]);
  const empty = await S.request('GET', query(), { person: PERSON });
  assert.equal(empty.status, 200, empty.text);
  assert.deepEqual(empty.data.candidates, []);
});

test('REQ-581 U3: candidates refuses a missing or non-numeric session id and a bad database name; another SQL failure is an error (must-fail on the base)', async () => {
  for (const [label, extra] of [['no session', ''], ['text session', '&session_id=abc'], ['injected session', '&session_id=1%20OR%201%3D1']]) {
    S.reset();
    S.state.sqlHook = candidateHook();
    const got = await S.request('GET', query(extra), { person: PERSON });
    assert.equal(got.status, 400, `${label}: ${got.text}`);
    assert.equal(candidateStatements().length, 0, `${label}: nothing is read`);
  }
  S.reset();
  const badDb = await S.request('GET', `/api/inspire/candidates?inspire_database=nodot&warehouse_id=${S.APP_WAREHOUSE}&session_id=1001`, { person: PERSON });
  assert.equal(badDb.status, 400, badDb.text);
  S.reset();
  S.state.sqlHook = (sql) => (/__inspire_candidates/.test(sql) ? { statement_id: 's1', status: { state: 'FAILED', error: { message: '[INSUFFICIENT_PERMISSIONS] User does not have SELECT on the table.' } } } : null);
  const denied = await S.request('GET', query(), { person: PERSON });
  assert.ok(denied.status >= 400, `a refusal is not hidden as an empty list: ${denied.status} ${denied.text}`);
});

test('REQ-581 U3: the candidates route has a read entry in the route policy like its neighbours (must-fail on the base)', () => {
  const entry = P.ROUTE_POLICY['GET /api/inspire/candidates'];
  assert.ok(entry, 'GET /api/inspire/candidates is in the policy table');
  assert.deepEqual({ rule: entry.rule, identity: entry.identity }, { rule: P.ROUTE_POLICY['GET /api/inspire/match/result'].rule, identity: P.ROUTE_POLICY['GET /api/inspire/match/result'].identity },
    'the same read rule as match/result');
});
