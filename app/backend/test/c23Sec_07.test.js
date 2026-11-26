// SEC-07 (c23 security audit, server part): the Inspire database a request names is honoured only for an App manager. Anyone else gets the
// App's default database, so one person cannot read or write another install's tracking tables.
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('./support/sec02World');

const { S } = W;
test.after(() => S.stopServer());

const OTHER = 'rival.team_db';
const touched = () => S.state.calls.filter((c) => /__inspire_/.test(c.statement || ''));
const names = (db) => touched().filter((c) => c.statement.replace(/`/g, '').includes(db));

test('SEC-07: a person who is not a manager listing sessions with another inspire_database reads only the default database', async () => {
  await W.seed();
  const got = await S.request('GET', `/api/inspire/sessions?inspire_database=${OTHER}&warehouse_id=${S.APP_WAREHOUSE}`, { person: W.LAUNCHER });
  assert.equal(got.status, 200, got.text);
  assert.equal(names(OTHER).length, 0, `a tracking table of another database was read: ${names(OTHER).map((c) => c.statement.slice(0, 120)).join(' | ')}`);
  assert.ok(names(S.APP_DB).length > 0, 'the default database was read instead');
});

test('SEC-07: the database in a POST body is replaced the same way', async () => {
  await W.seed();
  await S.request('POST', '/api/inspire/ack', { person: W.LAUNCHER, body: { inspire_database: OTHER, warehouse_id: S.APP_WAREHOUSE, session_id: W.SECRET } });
  assert.equal(names(OTHER).length, 0, `another database was written or read: ${names(OTHER).map((c) => c.statement.slice(0, 120)).join(' | ')}`);
});

test('SEC-07 control: an App manager still chooses the database', async () => {
  await W.seed();
  S.state.managers = [W.LAUNCHER];
  await S.request('GET', `/api/inspire/sessions?inspire_database=${OTHER}&warehouse_id=${S.APP_WAREHOUSE}`, { person: W.LAUNCHER });
  assert.ok(names(OTHER).length > 0, 'the manager read the database they named');
});
