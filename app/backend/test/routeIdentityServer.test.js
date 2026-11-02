const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./support/serverApp');

const APP_TOKEN = 'app-sp-token';
const NONOWNER = 'nonowner@example.com';

test.after(() => S.stopServer());

const callsTo = (prefix) => S.state.calls.filter((c) => c.path.startsWith(prefix));
const tokensTo = (prefix) => [...new Set(callsTo(prefix).map((c) => c.token))];

test('a CAN_USE person who lists a workspace folder reaches the workspace with their own token, never the App token', async () => {
  S.reset();
  const got = await S.request('GET', '/api/workspace/list?path=%2FUsers%2Fsomeone-else%2Fprivate', { person: NONOWNER });
  assert.equal(got.status, 200, got.text);
  assert.ok(callsTo('/api/2.0/workspace/list').length > 0, 'the folder was listed');
  assert.deepEqual(tokensTo('/api/2.0/workspace/list'), [S.PERSON_TOKEN]);
});

test('a CAN_USE person who browses catalogs, schemas and tables, or reads columns, does it with their own token', async () => {
  S.reset();
  for (const [route, prefix] of [
    ['/api/catalogs', '/api/2.1/unity-catalog/catalogs'],
    ['/api/catalogs/main/schemas', '/api/2.1/unity-catalog/schemas'],
    ['/api/tables/main/sales', '/api/2.1/unity-catalog/tables'],
    ['/api/workspace/export?path=%2FUsers%2Fsomeone-else%2Fnotes.py', '/api/2.0/workspace/export'],
    ['/api/workspace/status?path=%2FUsers%2Fsomeone-else', '/api/2.0/workspace/get-status'],
    ['/api/warehouses', '/api/2.0/sql/warehouses'],
  ]) {
    S.reset();
    const got = await S.request('GET', route, { person: NONOWNER });
    assert.notEqual(got.status, 401, `${route}: ${got.text}`);
    assert.ok(callsTo(prefix).length > 0, `${route} reached ${prefix}`);
    assert.deepEqual(tokensTo(prefix), [S.PERSON_TOKEN], route);
  }
  S.reset();
  const columns = await S.request('GET', '/api/inspire/implement/columns?warehouse_id=wh1&table=hr.payroll.salaries', { person: NONOWNER });
  assert.equal(columns.status, 200, columns.text);
  assert.deepEqual(tokensTo('/api/2.0/sql/statements'), [S.PERSON_TOKEN]);
});

test('with no forwarded token a person route refuses with the reason and the fix, and reads nothing as the App', async () => {
  for (const route of ['/api/workspace/list?path=%2FUsers%2Fsomeone-else', '/api/catalogs', '/api/tables/main/sales',
    '/api/inspire/implement/values?warehouse_id=wh1&table=hr.payroll.salaries&column=name']) {
    S.reset();
    const got = await S.request('GET', route, { person: NONOWNER, userToken: false });
    assert.equal(got.status, 401, `${route}: ${got.text}`);
    assert.match(got.data.error, /your own sign-in/);
    assert.match(got.data.error, /re-run the Inspire installer/);
    assert.equal(got.data.policy.identity, 'person');
    assert.doesNotMatch(got.text, new RegExp(APP_TOKEN));
    assert.deepEqual(S.state.calls.filter((c) => !['auth', 'policy'].includes(c.category) && c.token === APP_TOKEN), [], `${route} read nothing as the App`);
  }
});

test('an App route still reads the App database with the App token; another database is read with the person token (must-exclude)', async () => {
  S.reset();
  const own = await S.request('GET', `/api/inspire/sessions?inspire_database=${S.APP_DB}&warehouse_id=${S.APP_WAREHOUSE}`, { person: NONOWNER });
  assert.equal(own.status, 200, own.text);
  assert.deepEqual(tokensTo('/api/2.0/sql/statements'), [APP_TOKEN]);
  S.reset();
  const other = await S.request('GET', `/api/inspire/sessions?inspire_database=hr.inspire&warehouse_id=${S.APP_WAREHOUSE}`, { person: NONOWNER });
  assert.equal(other.status, 200, other.text);
  assert.deepEqual(tokensTo('/api/2.0/sql/statements'), [S.PERSON_TOKEN]);
  S.reset();
  const health = await S.request('GET', '/api/health', { person: NONOWNER, userToken: false });
  assert.equal(health.status, 200, health.text);
});
