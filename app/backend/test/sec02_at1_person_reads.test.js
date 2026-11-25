// SEC-02 AT1 (F2, F3, F5, F10; REQ-518): every route that returns data or metadata from customer tables, Volumes or workspace files reads
// with the signed-in person's own token. With no person token the route answers 401 and never falls back to the App's service principal.
const test = require('node:test');
const assert = require('node:assert/strict');
const RP = require('../lib/routePolicy');
const W = require('./support/sec02World');

const { S } = W;
test.after(() => S.stopServer());

// Each data-read route the policy table declares. All must be person identity (requireToken then sets req.dbToken to the person's token
// and answers 401 without one).
const DATA_READ_ROUTES = [
  'GET /api/workspace/list', 'GET /api/workspace/export', 'GET /api/workspace/status',
  'GET /api/catalogs', 'GET /api/catalogs/:catalog/schemas', 'GET /api/tables/:catalog/:schema',
  'GET /api/inspire/implement/columns', 'GET /api/inspire/implement/table-lookup', 'GET /api/inspire/implement/values',
  'POST /api/relationships', 'POST /api/data-management/columns', 'POST /api/inspire/implement/swaps',
  'POST /api/inspire/implement/readiness', 'POST /api/inspire/implement/group-counts',
  'POST /api/money/currency-rates', 'POST /api/money/value-preview', 'POST /api/money/rate-sample',
  'POST /api/inspire/value/estimate', 'POST /api/inspire/value/case-plan', 'POST /api/inspire/value/scope', 'POST /api/inspire/value/filter',
  'PUT /api/inspire/value/answers', 'POST /api/grouping/profile', 'GET /api/inspire/implement/principals',
];

test('AT1: the policy declares every data-read route as person identity, with the scopes it needs', () => {
  const app = DATA_READ_ROUTES.filter((key) => RP.identityFor(key) !== 'person');
  assert.deepEqual(app, [], `AT1: ${app.length}/${DATA_READ_ROUTES.length} data-read routes still read as the App service principal (identity 'app'): ${app.join(', ')}`);
  assert.deepEqual(RP.undeclaredIdentity(DATA_READ_ROUTES), [], 'AT1: each person route lists the OAuth scopes it needs');
  const sp = DATA_READ_ROUTES.filter((key) => /service principal/.test(String((RP.ROUTE_POLICY[key] || {}).why || '')));
  assert.deepEqual(sp, [], `AT1: no data-read route is justified as an App read: ${sp.join(', ')}`);
});

const Q = W.DB;
const BODY = { session_id: W.SECRET, use_case_id: 'N01-U01', inspire_database: S.APP_DB };
// [label, method, path, body, what the data calls must touch]
const ROUTES = [
  ['catalogs', 'GET', `/api/catalogs?warehouse_id=${S.APP_WAREHOUSE}`, null, /unity-catalog\/catalogs|SHOW CATALOGS/i],
  ['schemas', 'GET', `/api/catalogs/main/schemas?warehouse_id=${S.APP_WAREHOUSE}`, null, /unity-catalog\/schemas|SCHEMAS/i],
  ['tables', 'GET', `/api/tables/main/s?warehouse_id=${S.APP_WAREHOUSE}`, null, /unity-catalog\/tables|TABLES/i],
  ['volume list', 'GET', '/api/workspace/list?path=/Volumes/main/s/files', null, /\/fs\/directories\/Volumes/],
  ['volume file', 'GET', '/api/workspace/export?path=/Volumes/main/s/files/orders.csv', null, /\/fs\/files\/Volumes/],
  ['workspace folder', 'GET', '/api/workspace/list?path=/Shared/demos', null, /\/workspace\/list/],
  ['columns', 'GET', `/api/inspire/implement/columns?table=${encodeURIComponent(W.TABLE)}&warehouse_id=${S.APP_WAREHOUSE}`, null, /orders|information_schema|unity-catalog\/tables/],
  ['values', 'GET', `/api/inspire/implement/values?table=${encodeURIComponent(W.TABLE)}&column=region&warehouse_id=${S.APP_WAREHOUSE}`, null, /orders/],
  ['currency rates', 'POST', `/api/money/currency-rates?${Q}`, { ...BODY, table: W.TABLE, currency_column: 'currency', base: 'USD' }, /orders/],
  ['value preview', 'POST', `/api/money/value-preview?${Q}`, { ...BODY, table: W.TABLE, value: { method: 'column', column: 'amount', currency: 'USD' } }, /orders/],
  ['rate sample', 'POST', `/api/money/rate-sample?${Q}`, { ...BODY, table: W.TABLE, currency_column: 'currency', rate_column: 'rate' }, /orders/],
  ['principals', 'GET', '/api/inspire/implement/principals?q=an', null, /scim\/v2\/(Users|Groups)/],
];

for (const [label, method, path, body, touches] of ROUTES) {
  test(`AT1 ${label}: the read goes with the person's own token, never the App's`, async () => {
    await W.seed({ files: { '/Volumes/main/s/files/orders.csv': 'region,amount\nnorth,10\n' } });
    const got = await S.request(method, path, { person: W.COLLEAGUE, body: body || undefined });
    const data = W.dataCalls().filter((c) => touches.test(`${c.path} ${c.statement}`));
    assert.ok(data.length > 0, `AT1 ${label}: the route made no data read at all (status ${got.status}): ${got.text.slice(0, 300)}\n${W.describe(S.state.calls)}`);
    assert.deepEqual(W.describe(W.asApp(data)), '', `AT1 ${label}: Not implemented: these reads went with the App service principal token:\n${W.describe(W.asApp(data))}`);
  });

  test(`AT1 ${label}: with no person token the route answers 401 and reads nothing as the App`, async () => {
    await W.seed({ files: { '/Volumes/main/s/files/orders.csv': 'region,amount\nnorth,10\n' } });
    const got = await S.request(method, path, { person: W.COLLEAGUE, body: body || undefined, userToken: false });
    const leaked = W.asApp(W.dataCalls());
    assert.deepEqual(W.describe(leaked), '', `AT1 ${label}: Not implemented: with no person token the App read as its service principal (fail open):\n${W.describe(leaked)}`);
    assert.equal(got.status, 401, `AT1 ${label}: answers ${got.status}, not 401, with no person token: ${got.text.slice(0, 200)}`);
    assert.ok(!/north,10|orders\.csv/.test(got.text) || /sign in/i.test(got.text), `AT1 ${label}: no file content without a person token`);
  });
}

test('AT1 CUJ1 control: a person who can read lists catalogs and opens a workspace folder (200)', async () => {
  await W.seed();
  const list = await S.request('GET', '/api/workspace/list?path=/Shared/demos', { person: W.COLLEAGUE });
  assert.notEqual(list.status, 401, list.text.slice(0, 200));
  const cats = await S.request('GET', `/api/catalogs?warehouse_id=${S.APP_WAREHOUSE}`, { person: W.COLLEAGUE });
  assert.equal(cats.status, 200, cats.text.slice(0, 200));
});
