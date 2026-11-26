// SEC-03 (c23 security audit): a refusal never names a table the person's own token cannot list. The App lists the scope with its own token, so
// a name that came from that list reaches the person only when the person can see it; otherwise the refusal gives a count.
const test = require('node:test');
const assert = require('node:assert/strict');
const { launch } = require('./support/c23SecLaunch');
const W = require('./support/sec02World');

const { S } = W;
test.after(() => S.stopServer());

test('SEC-03: launch over a schema names only the lost tables the person can list, and counts the rest', async () => {
  const got = await launch({ tables: ['main.s.orders', 'main.s.secret_pay'], scope: 'main.s', personProbe: 'denied',
    deniedTables: ['main.s.orders', 'main.s.secret_pay'], browseTables: ['main.s.orders'] });
  assert.equal(got.status, 403, got.text);
  assert.ok(!/secret_pay/.test(got.text), `the refusal names a table the person cannot list: ${got.text}`);
  assert.ok(/main\.s\.orders/.test(got.text), `the table the person can list is still named: ${got.text}`);
  assert.equal(got.jobs.length, 0);
});

test('SEC-03: when the person can list none of the lost tables the refusal carries no names and no GRANT for them', async () => {
  const got = await launch({ tables: ['main.s.secret_pay'], scope: 'main.s', personProbe: 'denied', deniedTables: ['main.s.secret_pay'], browseTables: [] });
  assert.equal(got.status, 403, got.text);
  assert.ok(!/secret_pay/.test(got.text), `names leaked: ${got.text}`);
  assert.deepEqual(got.data.unreadable || [], []);
  assert.deepEqual(got.data.permissions || [], []);
});

test('SEC-03: a colleague who cannot list the tables of a hidden session gets no table names in the 403', async () => {
  await W.seed();
  const got = await S.request('GET', `/api/inspire/session?${W.DB}&session_id=${W.SECRET}`, { person: W.READER });
  assert.equal(got.status, 403, got.text);
  assert.ok(!/main\.s\.orders/.test(got.text), `the 403 names a table the reader cannot list: ${got.text}`);
});
