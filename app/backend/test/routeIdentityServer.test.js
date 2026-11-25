const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./support/serverApp');

// REQ-418 / D-SL-10B: Inspire reads as its App's service principal. The person's token is kept for who-did-what routes only.
const APP_TOKEN = 'app-sp-token';
const NONOWNER = 'nonowner@example.com';

test.after(() => S.stopServer());

const callsTo = (prefix) => S.state.calls.filter((c) => c.path.startsWith(prefix));
const tokensTo = (prefix) => [...new Set(callsTo(prefix).map((c) => c.token))];

const PERSON_TOKEN = S.PERSON_TOKEN;

test('SEC-02 (reverses REQ-418): a CAN_USE person who lists a workspace folder reads it with their own token, never the App token', async () => {
  S.reset();
  const got = await S.request('GET', '/api/workspace/list?path=%2FUsers%2Fsomeone-else%2Fprivate', { person: NONOWNER });
  assert.equal(got.status, 200, got.text);
  assert.ok(callsTo('/api/2.0/workspace/list').length > 0, 'the folder was listed');
  assert.deepEqual(tokensTo('/api/2.0/workspace/list'), [PERSON_TOKEN]);
});

test('SEC-02 (reverses REQ-418): a CAN_USE person who browses catalogs, schemas and tables, or reads columns, does it with their own token; warehouses stay the App', async () => {
  for (const [route, prefix, token] of [
    ['/api/catalogs', '/api/2.1/unity-catalog/catalogs', PERSON_TOKEN],
    ['/api/catalogs/main/schemas', '/api/2.1/unity-catalog/schemas', PERSON_TOKEN],
    ['/api/tables/main/sales', '/api/2.1/unity-catalog/tables', PERSON_TOKEN],
    ['/api/workspace/export?path=%2FUsers%2Fsomeone-else%2Fnotes.py', '/api/2.0/workspace/export', PERSON_TOKEN],
    ['/api/workspace/status?path=%2FUsers%2Fsomeone-else', '/api/2.0/workspace/get-status', PERSON_TOKEN],
    ['/api/warehouses', '/api/2.0/sql/warehouses', APP_TOKEN],
  ]) {
    S.reset();
    const got = await S.request('GET', route, { person: NONOWNER });
    assert.notEqual(got.status, 401, `${route}: ${got.text}`);
    assert.ok(callsTo(prefix).length > 0, `${route} reached ${prefix}`);
    assert.deepEqual(tokensTo(prefix), [token], route);
  }
  S.reset({ tableColumns: { 'hr.payroll.salaries': ['employee_id', 'salary'] } });
  const columns = await S.request('GET', '/api/inspire/implement/columns?warehouse_id=wh1&table=hr.payroll.salaries', { person: NONOWNER });
  assert.equal(columns.status, 200, columns.text);
  assert.deepEqual(tokensTo('/api/2.0/sql/statements'), [PERSON_TOKEN]);
});

test('SEC-02: with no forwarded token the data routes refuse 401 and read nothing as the App; the App routes still read as the App, and a person route refuses with the reason and the fix', async () => {
  for (const route of ['/api/workspace/list?path=%2FUsers%2Fsomeone-else', '/api/catalogs', '/api/tables/main/sales',
    '/api/inspire/implement/values?warehouse_id=wh1&table=hr.payroll.salaries&column=name']) {
    S.reset({ tableColumns: { 'hr.payroll.salaries': ['name'] } });
    const got = await S.request('GET', route, { person: NONOWNER, userToken: false });
    assert.equal(got.status, 401, `${route}: ${got.text}`);
    assert.deepEqual(S.state.calls.filter((c) => !['auth', 'policy'].includes(c.category) && c.token === APP_TOKEN), [], `${route} read nothing as the App`);
  }
  S.reset();
  const warehouses = await S.request('GET', '/api/warehouses', { person: NONOWNER, userToken: false });
  assert.equal(warehouses.status, 200, warehouses.text);
  assert.ok(S.state.calls.filter((c) => !['auth', 'policy'].includes(c.category) && c.token === APP_TOKEN).length > 0, 'an App route reads as the App');
  S.reset();
  const who = await S.request('POST', '/api/access-request', { person: NONOWNER, userToken: false, body: { statements: [] } });
  assert.equal(who.status, 401, who.text);
  assert.match(who.data.error, /your own sign-in/);
  assert.match(who.data.error, /re-run the Inspire installer/);
  assert.equal(who.data.policy.identity, 'person');
  assert.doesNotMatch(who.text, new RegExp(APP_TOKEN));
  assert.deepEqual(S.state.calls.filter((c) => !['auth', 'policy'].includes(c.category) && c.token === APP_TOKEN
    && c.path.startsWith('/api/3.0/rfa')), [], 'the person route read nothing as the App');
});

test('an App route reads the App database with the App token, and so does another database (REQ-418: the person never reads for tracking routes)', async () => {
  S.reset();
  const own = await S.request('GET', `/api/inspire/sessions?inspire_database=${S.APP_DB}&warehouse_id=${S.APP_WAREHOUSE}`, { person: NONOWNER });
  assert.equal(own.status, 200, own.text);
  assert.deepEqual(tokensTo('/api/2.0/sql/statements'), [APP_TOKEN]);
  S.reset();
  const other = await S.request('GET', `/api/inspire/sessions?inspire_database=hr.inspire&warehouse_id=${S.APP_WAREHOUSE}`, { person: NONOWNER });
  assert.equal(other.status, 200, other.text);
  assert.deepEqual(tokensTo('/api/2.0/sql/statements'), [APP_TOKEN], 'a database the App cannot read is refused by the App, never read as the person');
  S.reset();
  const health = await S.request('GET', '/api/health', { person: NONOWNER, userToken: false });
  assert.equal(health.status, 200, health.text);
});
