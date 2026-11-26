// SEC-13 (c23 security audit): POST /api/inspire/feedback checks session visibility first, so it is no existence oracle and writes nothing for a hidden session.
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('./support/sec02World');

const { S } = W;
test.after(() => S.stopServer());

const writes = () => S.state.calls.filter((c) => /^\s*INSERT\b/i.test(c.statement || ''));
const body = (sid) => ({ inspire_database: S.APP_DB, warehouse_id: S.APP_WAREHOUSE, session_id: sid, status: 'liked', use_case_key: 'N01-U01' });

test('SEC-13: feedback on a session the person cannot see is refused with the same 403 as a session that does not exist, and writes nothing', async () => {
  await W.seed();
  const hidden = await S.request('POST', '/api/inspire/feedback', { person: W.READER, body: body(W.SECRET) });
  const absent = await S.request('POST', '/api/inspire/feedback', { person: W.READER, body: body('987654') });
  assert.equal(hidden.status, 403, hidden.text);
  assert.equal(absent.status, 403, absent.text);
  assert.equal(writes().length, 0, 'a feedback row was written for a hidden session');
});
