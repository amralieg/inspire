// REQ-433: Apply writes the refined scores through the use case table and keeps the old score and the reason in history; Undo restores them.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, listen } = require('./support/implementApp');

const BODY = { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42' };
const CHANGE = { use_case_id: 'N01-U02', score: 9.05, from: 8.5, reason: 'Worth 3x Predict churn (9.0), so it moves just above it.' };

async function call(made, route, body) {
  const srv = await listen(made.app);
  try {
    const resp = await fetch(`${srv.url}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: resp.status, data: await resp.json() };
  } finally {
    await srv.close();
  }
}
const appWith = () => makeApp({ forwardedToken: 'person-tok' });
const writes = (made, needle) => made.sqlCalls.filter((c) => c.sql.includes(needle));
const bound = (call) => Object.fromEntries((call.parameters || []).map((p) => [p.name, p.value]));

test('Apply stores the refined score on the use case row and binds every value', async () => {
  const made = appWith();
  const got = await call(made, '/api/inspire/score-refine', { ...BODY, changes: [CHANGE] });
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.deepEqual(got.data.applied.map((a) => [a.use_case_id, a.score, a.from]), [['N01-U02', 9.05, 8.5]]);
  const update = made.sqlCalls.find((c) => c.sql.startsWith('UPDATE') && c.sql.includes('__inspire_usecases') && c.sql.includes('refined_score'));
  assert.ok(update, 'one UPDATE of refined_score on the use case row');
  assert.match(update.sql, /WHERE session_id = 42 AND id = :p\d+/);
  assert.ok(Object.values(bound(update)).includes(9.05) || Object.values(bound(update)).includes('9.05'), 'the score is a bound value');
  assert.ok(!update.sql.includes('9.05'), 'never spliced into the SQL');
});

test('Apply keeps the old score and the reason in history, one row for each change', async () => {
  const made = appWith();
  await call(made, '/api/inspire/score-refine', { ...BODY, changes: [CHANGE, { ...CHANGE, use_case_id: 'N01-U03', score: 9.1, from: 8 }] });
  const rows = writes(made, '__inspire_score_history').filter((c) => c.sql.includes('INSERT'));
  assert.equal(rows.length, 2);
  const first = Object.values(bound(rows[0])).map(String);
  assert.ok(first.includes('8.5') && first.includes('9.05') && first.some((v) => v.includes('Worth 3x')), `history carries from, to and the reason: ${first}`);
  assert.ok(first.includes('apply'));
});

test('Apply refuses a bad request and writes nothing', async () => {
  for (const changes of [undefined, [], [{ ...CHANGE, score: 10.5 }], [{ ...CHANGE, score: 'high' }], [{ ...CHANGE, score: -1 }], [{ ...CHANGE, use_case_id: "x'; DROP" }],
    Array.from({ length: 51 }, () => CHANGE)]) {
    const made = appWith();
    const got = await call(made, '/api/inspire/score-refine', { ...BODY, ...(changes === undefined ? {} : { changes }) });
    assert.equal(got.status, 400, JSON.stringify(changes)?.slice(0, 80));
    assert.equal(writes(made, 'refined_score').filter((c) => c.sql.startsWith('UPDATE')).length, 0);
  }
  const noSession = await call(appWith(), '/api/inspire/score-refine', { ...BODY, session_id: 'abc', changes: [CHANGE] });
  assert.equal(noSession.status, 400);
});

test('Undo clears the refined score so the first score stands again, and records the undo in history', async () => {
  const made = appWith();
  const got = await call(made, '/api/inspire/score-refine/undo', { ...BODY, use_case_ids: ['N01-U02'] });
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.deepEqual(got.data.restored, ['N01-U02']);
  const update = made.sqlCalls.find((c) => c.sql.startsWith('UPDATE') && c.sql.includes('refined_score'));
  assert.ok(update && /refined_score = NULL/.test(update.sql), update?.sql);
  const history = writes(made, '__inspire_score_history').find((c) => c.sql.includes('INSERT'));
  assert.ok(history && Object.values(bound(history)).includes('undo'));
});

test('Undo refuses an empty or malformed list', async () => {
  for (const ids of [undefined, [], 'N01-U02', ["a b"]]) {
    const got = await call(appWith(), '/api/inspire/score-refine/undo', { ...BODY, ...(ids === undefined ? {} : { use_case_ids: ids }) });
    assert.equal(got.status, 400, JSON.stringify(ids));
  }
});
