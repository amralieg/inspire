// SEC-08 (c23 security audit, server part): the hosted-page session check takes the tables the page really reads (a third argument { tables }).
// A non-empty list is checked in place of the session scope; an empty list falls back to the scope.
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('./support/sec02World');

const { S } = W;
test.after(() => S.stopServer());

const asReader = () => {
  S.state.person = W.READER;
  return { headers: { 'x-forwarded-email': W.READER, 'x-forwarded-access-token': S.PERSON_TOKEN }, dbHost: 'https://workspace.example.com',
    query: { inspire_database: S.APP_DB, warehouse_id: S.APP_WAREHOUSE }, body: {} };
};

test('SEC-08: a page whose tables include one the viewer cannot read is hidden even when the session scope is readable', async () => {
  await W.seed();
  const { sessionHidden } = require('../server');
  assert.equal(await sessionHidden(asReader(), W.OPEN), null, 'control: the open session scope is readable by the reader');
  const hidden = await sessionHidden(asReader(), W.OPEN, { tables: [W.TABLE] });
  assert.ok(hidden && hidden.status === 403, `the tables of the page decide, not the session scope: ${JSON.stringify(hidden)}`);
});

test('SEC-08: an empty tables list falls back to the session scope', async () => {
  await W.seed();
  const { sessionHidden } = require('../server');
  assert.equal(await sessionHidden(asReader(), W.OPEN, { tables: [] }), null);
  const hiddenScope = await sessionHidden(asReader(), W.SECRET, { tables: [] });
  assert.ok(hiddenScope && hiddenScope.status === 403, 'the session scope still hides the secret session');
});
