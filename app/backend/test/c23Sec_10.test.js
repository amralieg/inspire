// SEC-10 (c23 security audit): POST /api/inspire/ack checks that the person may see the session, and writes only to the default database.
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('./support/sec02World');

const { S } = W;
test.after(() => S.stopServer());

const updates = () => S.state.calls.filter((c) => /^\s*UPDATE\b/i.test(c.statement || ''));
const body = (extra = {}) => ({ inspire_database: S.APP_DB, warehouse_id: S.APP_WAREHOUSE, session_id: W.SECRET, ...extra });

test('SEC-10: a person who cannot see the session cannot acknowledge it, and nothing is written', async () => {
  await W.seed();
  const got = await S.request('POST', '/api/inspire/ack', { person: W.READER, body: body() });
  assert.equal(got.status, 403, got.text);
  assert.equal(updates().length, 0, 'the App ran an UPDATE for a session the caller cannot see');
});

test('SEC-10 control: the launcher acknowledges their own session in the default database', async () => {
  await W.seed();
  const got = await S.request('POST', '/api/inspire/ack', { person: W.LAUNCHER, body: body({ inspire_database: 'rival.team_db' }) });
  assert.equal(got.status, 200, got.text);
  assert.equal(updates().length, 1);
  assert.match(updates()[0].statement, /`main`\.`inspire`\.`__inspire_session`/);
});
