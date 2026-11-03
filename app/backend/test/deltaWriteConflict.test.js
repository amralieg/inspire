const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./support/serverApp');

test.after(() => S.stopServer());

const CONFLICT = '[DELTA_CONCURRENT_APPEND.WITH_PARTITION_HINT] ConcurrentAppendException: Files were added by a concurrent update.';

test('acknowledgements that race the agent on the session table all succeed: a write Delta rejects for a concurrent change is sent again', async () => {
  const failedOnce = new Set();
  S.reset({
    conflictOn: (sql) => {
      const sid = (/WHERE session_id = (\d+)/.exec(sql) || [])[1];
      if (!/^UPDATE\b/.test(sql) || !sid || Number(sid) % 2 || failedOnce.has(sid)) return '';
      failedOnce.add(sid);
      return CONFLICT;
    },
  });
  const sessions = Array.from({ length: 24 }, (_, i) => String(7000 + i));
  const answers = await Promise.all(sessions.map((sid) => S.request('POST', '/api/inspire/ack', {
    body: { inspire_database: S.APP_DB, warehouse_id: S.APP_WAREHOUSE, session_id: sid },
  })));
  assert.deepEqual(answers.map((a) => a.status), sessions.map(() => 200), answers.map((a) => a.text).join('\n').slice(0, 400));
  assert.equal(failedOnce.size, 12, 'half of the acknowledgements met a concurrent change first');
  const updates = S.state.calls.filter((c) => /^UPDATE\b/.test(c.statement) && c.statement.includes('__inspire_session'));
  assert.equal(updates.length, 36, 'each conflicted acknowledgement is sent twice, the others once');
});

test('a launch record written while the ledger is busy is kept, so the launcher can still cancel the run', async () => {
  let launchConflicts = 0;
  S.reset({
    notebookPresent: true,
    conflictOn: (sql) => (/^\s*INSERT INTO\b/i.test(sql) && sql.includes('__inspire_launch') && launchConflicts++ < 2 ? CONFLICT : ''),
  });
  const got = await S.request('POST', '/api/run', {
    person: 'launcher@example.com', body: { params: { '00_business_name': 'Acme', '02_inspire_database': S.APP_DB, '14_session_id': '7100' } },
  });
  assert.equal(got.status, 200, got.text.slice(0, 300));
  assert.equal(got.data.launcher_recorded, true, got.text.slice(0, 300));
  assert.equal(S.state.launches.length, 1);
  assert.equal(launchConflicts, 3, 'two conflicts, then the insert that landed');
});
