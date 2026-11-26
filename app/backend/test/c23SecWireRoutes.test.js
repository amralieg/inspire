// c23 sec_wire: the manager check and the pinned warehouse, through the real server in this process.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./support/serverApp');

test.after(() => S.stopServer());

// 1. The manager check reaches the implement routes: a manager keeps the database and warehouse named.
test('item 1: a manager naming another warehouse on an implement route reaches it (isManager is wired into registerImplementRoutes)', async () => {
  S.reset({ managers: ['boss@example.com'] });
  await S.request('GET', '/api/inspire/value/answers/history?inspire_database=main.inspire&warehouse_id=wh-chosen&session_id=6001&use_case_id=N01-U01', { person: 'boss@example.com' });
  const onChosen = S.state.calls.filter((c) => c.raw.includes('"warehouse_id":"wh-chosen"'));
  assert.ok(onChosen.length > 0, `the manager's warehouse was pinned to the default: ${JSON.stringify(S.state.calls.map((c) => c.raw.slice(0, 80)))}`);
});

// 3. The session check reads the scope on the App's warehouse for a non-manager, never the caller's.
test('item 3: a non-manager naming another warehouse does not move the session scope read off the App warehouse', async () => {
  S.reset({});
  await S.request('GET', '/api/inspire/results?inspire_database=main.inspire&session_id=6001&warehouse_id=wh-foreign', { person: 'nonowner@example.com' });
  const scopeReads = S.state.calls.filter((c) => /tables_str FROM/.test(c.statement) && /__inspire_session/.test(c.statement));
  assert.ok(scopeReads.length > 0, 'the session scope was read');
  assert.ok(scopeReads.every((c) => !c.raw.includes('wh-foreign')), `a scope read ran on the caller's warehouse: ${scopeReads.map((c) => c.raw.slice(0, 150)).join(' | ')}`);
});

