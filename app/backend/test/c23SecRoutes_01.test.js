// c23 SEC-07 (route part) + SEC-01 (planted record path) + SEC-18: the target of a tracked write or read is the App's own database and warehouse
// unless the caller is an App manager; hosted pages are only taken from the default Inspire database; the partial-catalog ask names only what is missing.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, listen } = require('./support/implementApp');
const { partialPermission } = require('../lib/spCatalogs');

const DEFAULTS = { inspireDatabase: 'main.inspire', warehouseId: 'wh-default' };
const FOREIGN = 'other.inspire';
const QS = (db, wh) => `inspire_database=${db}&warehouse_id=${wh}&session_id=42&use_case_id=N01-U01`;

async function hit(app, url, init) {
  const srv = await listen(app);
  try {
    const resp = await fetch(`${srv.url}${url}`, init);
    return { status: resp.status, data: await resp.json().catch(() => null) };
  } finally {
    await srv.close();
  }
}
const touched = (calls, needle) => calls.filter((c) => c.sql.includes(needle));

test('SEC-07: a non-manager asking for another database and warehouse reads the default ones (GET, query)', async () => {
  const made = makeApp({ runDefaults: DEFAULTS, manager: false, forwardedToken: 'person-tok', history: [] });
  await hit(made.app, `/api/inspire/value/answers/history?${QS(FOREIGN, 'wh-foreign')}`);
  assert.ok(made.sqlCalls.length > 0, 'the route ran a statement');
  assert.equal(touched(made.sqlCalls, '`other`').length, 0, 'no statement names the caller-chosen catalog');
  assert.ok(made.sqlCalls.every((c) => c.warehouse === 'wh-default'), `every statement ran on the default warehouse: ${JSON.stringify(made.sqlCalls.map((c) => c.warehouse))}`);
});

test('SEC-07: a non-manager undo of value answers (an App-identity write) writes to the default database and warehouse (body)', async () => {
  const history = [{ version: '2', answers: '{"a":2}', yearly: '{}' }, { version: '1', answers: '{"a":1}', yearly: '{}' }];
  const made = makeApp({ runDefaults: DEFAULTS, manager: false, forwardedToken: 'person-tok',
    statements: { __inspire_value_answers: (sql) => ({ rows: sql.startsWith('INSERT') || sql.includes('CREATE') ? [] : history }) } });
  const got = await hit(made.app, '/api/inspire/value/answers/undo?session_id=42&use_case_id=N01-U01', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ inspire_database: FOREIGN, warehouse_id: 'wh-foreign' }) });
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.ok(touched(made.sqlCalls, 'INSERT').length > 0, 'the write ran');
  assert.equal(touched(made.sqlCalls, '`other`').length, 0);
  assert.ok(made.sqlCalls.every((c) => c.warehouse === 'wh-default'));
});

test('SEC-07: a manager keeps the database and warehouse they name', async () => {
  const made = makeApp({ runDefaults: DEFAULTS, manager: true, forwardedToken: 'person-tok', history: [] });
  await hit(made.app, `/api/inspire/value/answers/history?${QS(FOREIGN, 'wh-foreign')}`);
  assert.ok(touched(made.sqlCalls, '`other`').length > 0, 'the manager reaches the database they named');
  assert.ok(made.sqlCalls.some((c) => c.warehouse === 'wh-foreign'));
});

test('SEC-07: a deps without isManager treats everyone as a non-manager (fail closed)', async () => {
  const made = makeApp({ runDefaults: DEFAULTS, forwardedToken: 'person-tok', history: [], noIsManager: true });
  await hit(made.app, `/api/inspire/value/answers/history?${QS(FOREIGN, 'wh-foreign')}`);
  assert.equal(touched(made.sqlCalls, '`other`').length, 0);
});

test('SEC-01: /api/run/pages never registers pages from a database other than the default one, even for a manager', async () => {
  const listed = [];
  const hostedRun = { useReader() {}, setListed: (...a) => listed.push(a), stateOf: () => null };
  const made = makeApp({ runDefaults: DEFAULTS, manager: true, hostedRun, forwardedToken: 'person-tok', registry: [] });
  const got = await hit(made.app, `/api/run/pages?inspire_database=${FOREIGN}&warehouse_id=wh1`);
  assert.equal(listed.length, 0, 'a foreign database registers nothing in the hosted registry');
  assert.equal(touched(made.sqlCalls, '`other`').length, 0, 'and reads nothing from it');
  assert.deepEqual(got.data && got.data.pages, []);
});

test('SEC-01: /api/run/pages still registers the default database pages', async () => {
  const listed = [];
  const hostedRun = { useReader() {}, setListed: (...a) => listed.push(a), stateOf: () => null };
  const made = makeApp({ runDefaults: DEFAULTS, manager: true, hostedRun, forwardedToken: 'person-tok', registry: [] });
  await hit(made.app, `/api/run/pages?inspire_database=${DEFAULTS.inspireDatabase}&warehouse_id=wh1`);
  assert.equal(listed.length, 1);
});

test('SEC-18: the partial-catalog ask names only the picked catalogs, each missing grant once', () => {
  const cat = (name, missing) => ({ name, partial: { missing } });
  const catalogs = [cat('a', ['GRANT USE CATALOG ON CATALOG `a` TO `sp`']), cat('b', ['GRANT SELECT ON CATALOG `b` TO `sp`']), cat('c', ['GRANT SELECT ON CATALOG `c` TO `sp`']),
    { name: 'd' }];
  const only = partialPermission(catalogs, 'sp', ['b']);
  assert.deepEqual(only.statements, ['GRANT SELECT ON CATALOG `b` TO `sp`']);
  const dup = partialPermission([cat('a', ['G1', 'G1']), cat('b', ['G1'])], 'sp', ['a', 'b']);
  assert.deepEqual(dup.statements, ['G1']);
  assert.equal(partialPermission(catalogs, 'sp', ['d']), null, 'a picked catalog that misses nothing asks for nothing');
});
