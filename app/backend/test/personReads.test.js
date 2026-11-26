const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeWorkspace, startInspire } = require('./support/serverProcess');
const { NO_PERSON_TOKEN } = require('../lib/routePolicy');
const { INSPIRE_ENVIRONMENT_VERSION } = require('../lib/inspireJobParams');

const SP_TOKEN = 'sp-token';
const PERSON = 'person-token';
const PERSON_EMAIL = ['pat.lee', 'example.com'].join('@');
const APP_ENV = { NODE_ENV: 'production', DATABRICKS_CLIENT_ID: 'inspire-client', DATABRICKS_CLIENT_SECRET: 'inspire-secret', INSPIRE_WAREHOUSE_ID: 'wh' };
const { RUN_NO_APP_TOKEN } = require('../lib/ucReads');
const cannotRead = (names) => `The App can't read ${names}. Pick tables and files the App can read, or ask your data owner for access`; // file paths
const tableCannotRead = () => "The App can't read this source table. Pick tables the App can read, or ask your data owner for access";
const scopeOf = (workspace) => launched(workspace)[0].body.tasks[0].notebook_task.base_parameters['01_uc_metadata'];

const SEES = {
  // REQ-418: the App's service principal reads every source. `browseOnly` tables are listed for the App but cannot be read (a browse grant).
  [SP_TOKEN]: {
    catalogs: ['main', 'hr'],
    schemas: { main: ['s', 'secret', 'information_schema'], hr: ['p'] },
    tables: { 'main.s': ['orders', 'returns', 'salaries_view'], 'main.secret': ['ledger'], 'hr.p': ['salaries'], 'main.information_schema': ['tables'] },
    browseOnly: { 'main.s': ['salaries_view'], 'main.secret': ['ledger'] },
    files: ['/Shared/strategy.json', '/Volumes/main/s/v/strategy.json'],
  },
  [PERSON]: {
    catalogs: ['main'],
    schemas: { main: ['s', 'information_schema'] },
    tables: { 'main.s': ['orders', 'returns'], 'main.information_schema': ['tables'] },
    files: ['/Shared/strategy.json', '/Volumes/main/s/v/strategy.json'],
  },
};
const done = (column, values) => [200, { status: { state: 'SUCCEEDED' }, manifest: { schema: { columns: [{ name: column }] } },
  result: { data_array: values.map((v) => [v]) } }];

function answer(call, broken = {}) {
  const url = new URL(`http://x${call.path}`);
  const sees = SEES[call.token];
  if (call.path === '/oidc/v1/token') return [200, { access_token: SP_TOKEN, expires_in: 3600 }];
  if (call.path.startsWith('/api/2.0/preview/scim/v2/Me')) return [200, call.token === SP_TOKEN ? { userName: 'sp', applicationId: 'sp' } : { userName: PERSON_EMAIL }];
  if (broken[url.pathname]) return typeof broken[url.pathname] === 'function' ? broken[url.pathname](call) : broken[url.pathname];
  if (!sees) return [401, { message: 'Invalid access token' }];
  if (url.pathname === '/api/2.1/unity-catalog/catalogs') return [200, { catalogs: sees.catalogs.map((name) => ({ name })) }];
  if (url.pathname === '/api/2.1/unity-catalog/schemas') {
    const found = sees.schemas[url.searchParams.get('catalog_name')];
    return found ? [200, { schemas: found.map((name) => ({ name })) }] : [403, { error_code: 'PERMISSION_DENIED', message: 'User does not have USE CATALOG' }];
  }
  if (url.pathname === '/api/2.1/unity-catalog/tables') {
    const scope = `${url.searchParams.get('catalog_name')}.${url.searchParams.get('schema_name')}`;
    const found = sees.tables[scope];
    const browse = url.searchParams.get('include_browse') === 'true';
    const hidden = (sees.browseOnly || {})[scope] || [];
    return found ? [200, { tables: found.filter((name) => browse || !hidden.includes(name)).map((name) => ({ name, full_name: `${scope}.${name}` })) }]
      : [403, { error_code: 'PERMISSION_DENIED', message: 'User does not have USE SCHEMA' }];
  }
  const one = /^\/api\/2\.1\/unity-catalog\/tables\/(.+)$/.exec(url.pathname);
  if (one) {
    const name = decodeURIComponent(one[1]);
    const [catalog, schema, table] = name.split('.');
    const scope = `${catalog}.${schema}`;
    const readable = (sees.tables[scope] || []).includes(table) && !((sees.browseOnly || {})[scope] || []).includes(table);
    return readable ? [200, { full_name: name }]
      : [403, { error_code: 'PERMISSION_DENIED', message: `User does not have SELECT on Table '${name}'.` }];
  }
  if (url.pathname.startsWith('/api/2.0/fs/files/')) {
    return (sees.files || []).includes(decodeURIComponent(url.pathname.slice('/api/2.0/fs/files'.length))) ? [200, {}] : [404, { error_code: 'NOT_FOUND' }];
  }
  if (url.pathname === '/api/2.0/workspace/get-status') {
    const asked = url.searchParams.get('path');
    if (asked === '/Shared/inspire/dbx_inspire_ai_agent') return [200, { object_type: 'NOTEBOOK', path: asked }];
    if ((sees.files || []).includes(asked)) return [200, { object_type: 'FILE', path: asked }];
    return null;
  }
  // SEC-02 (c23): a launch checks the person's own read with a LIMIT 0 on the warehouse; these tests are about what the App can read, so the person reads every table.
  if (url.pathname === '/api/2.0/sql/statements' && /LIMIT 0/.test(String(call.body && call.body.statement))) return [200, { status: { state: 'SUCCEEDED' }, manifest: { schema: { columns: [] } }, result: { data_array: [] } }];
  if (url.pathname === '/api/2.0/sql/statements' && /^SHOW CATALOGS/.test(String(call.body && call.body.statement))) return done('catalog', sees.catalogs);
  if (url.pathname === '/api/2.0/sql/statements' && /^SHOW SCHEMAS IN `([^`]+)`/.test(String(call.body && call.body.statement))) {
    return done('databaseName', sees.schemas[/^SHOW SCHEMAS IN `([^`]+)`/.exec(call.body.statement)[1]] || []);
  }
  if (url.pathname === '/api/2.0/sql/statements' && /^SHOW TABLES IN `([^`]+)`\.`([^`]+)`/.test(String(call.body && call.body.statement))) {
    const [, catalog, schema] = /^SHOW TABLES IN `([^`]+)`\.`([^`]+)`/.exec(call.body.statement);
    const scope = `${catalog}.${schema}`;
    // A browse-only table is not a table a picker can select, so SHOW TABLES leaves it out, as it does for the App's pickers.
    return done('tableName', (sees.tables[scope] || []).filter((name) => !((sees.browseOnly || {})[scope] || []).includes(name)));
  }
  if (url.pathname === '/api/2.1/jobs/create') return [200, { job_id: 7 }];
  if (url.pathname === '/api/2.1/jobs/run-now') return [200, { run_id: 99 }];
  return null;
}

async function withInspire(run, broken = {}) {
  const workspace = await fakeWorkspace((call) => answer(call, broken));
  let inspire = null;
  try {
    inspire = await startInspire({ DATABRICKS_HOST: workspace.url, NOTEBOOK_PATH: '/Shared/inspire/dbx_inspire_ai_agent', ...APP_ENV });
    await run(inspire.url, workspace);
  } finally {
    if (inspire) await inspire.stop();
    await workspace.close();
  }
}

const signedIn = { 'x-forwarded-access-token': PERSON, 'x-forwarded-email': PERSON_EMAIL };
// A non-JSON answer names its status and the start of its body, so a recurrence says what answered instead of a bare parse error.
const jsonOf = async (resp, what) => {
  const text = await resp.text();
  try { return JSON.parse(text); } catch (err) { throw new Error(`${what}: HTTP ${resp.status} answered non-JSON: ${text.slice(0, 200)}`); }
};
async function get(url, path, headers = signedIn) {
  const resp = await fetch(`${url}${path}`, { headers });
  return { status: resp.status, data: await jsonOf(resp, `GET ${path}`) };
}
async function launch(url, params, headers = signedIn) {
  const resp = await fetch(`${url}/api/run`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ params: { '00_business_name': 'Acme', '02_inspire_database': 'main._inspire', '11_generation_path': '/Shared/demos', ...params } }) });
  return { status: resp.status, data: await jsonOf(resp, 'POST /api/run') };
}
const ucCalls = (workspace) => workspace.calls.filter((c) => c.path.startsWith('/api/2.1/unity-catalog') || c.path === '/api/2.0/sql/statements');
const launched = (workspace) => workspace.calls.filter((c) => c.path.startsWith('/api/2.1/jobs/'));

// SEC-02 (REQ-518, reverses REQ-418): the pickers list with the person's own token, so each person sees what they can read.
test('the Launch pickers list catalogs, schemas and tables with the person’s own token, so each person sees only what they can read', async () => {
  await withInspire(async (url, workspace) => {
    const catalogs = await get(url, '/api/catalogs?warehouse_id=wh');
    assert.equal(catalogs.status, 200, JSON.stringify(catalogs.data));
    assert.deepEqual(catalogs.data.catalogs.map((c) => c.name), ['main']);
    const schemas = await get(url, '/api/catalogs/main/schemas?warehouse_id=wh');
    assert.deepEqual(schemas.data.schemas.map((s) => s.full_name), ['main.information_schema', 'main.s']);
    const tables = await get(url, '/api/tables/main/s?warehouse_id=wh');
    assert.deepEqual(tables.data.tables.map((t) => t.full_name), ['main.s.orders', 'main.s.returns']);
    const unseen = await get(url, '/api/catalogs/nowhere/schemas');
    assert.deepEqual([unseen.status, unseen.data.schemas], [403, undefined], 'a catalog the person cannot see answers the status they got, never 502');
    const calls = ucCalls(workspace);
    assert.ok(calls.length >= 6, `${calls.length} reads`);
    // The only App-token reads are the App's own grant checks (effective-permissions, SEC-01 W4 pickable probes); every listing read is the person's own token.
    const asApp = calls.filter((c) => c.token !== PERSON);
    assert.ok(asApp.every((c) => c.path === '/api/2.0/sql/statements' || c.path.startsWith('/api/2.1/unity-catalog/effective-permissions/')), `App reads: ${JSON.stringify(asApp.map((c) => c.path))}`);
    assert.ok(calls.filter((c) => !c.path.startsWith('/api/2.0/sql/statements') && !c.path.includes('effective-permissions')).every((c) => c.token === PERSON), 'every listing read is the person’s own token');
    assert.ok(!calls.some((c) => c.path.includes('include_browse')), 'a picker never asks for tables the App may only browse');
  });
});

test('with no forwarded person token the pickers answer 401 and read nothing as the App (SEC-02)', async () => {
  await withInspire(async (url, workspace) => {
    for (const path of ['/api/catalogs?warehouse_id=wh', '/api/catalogs/main/schemas', '/api/tables/main/s']) {
      const got = await get(url, path, {});
      assert.equal(got.status, 401, `${path}: ${JSON.stringify(got.data)}`);
    }
    assert.deepEqual(ucCalls(workspace).filter((c) => c.token === SP_TOKEN), [], 'nothing is read as the App');
  });
});

test('a run skips a chosen table the App cannot read and says so, is refused only when none is readable, and starts when every table is readable (must-exclude)', async () => {
  await withInspire(async (url, workspace) => {
    const skipped = await launch(url, { '01_uc_metadata': 'main.s.orders,main.s.missing' });
    assert.equal(skipped.status, 200, JSON.stringify(skipped.data));
    assert.deepEqual(skipped.data.warnings, ["Skipped 1 table the App can't read."]);
    assert.deepEqual(skipped.data.warning_details, ["Tables the App can't read: main.s.missing"], 'the ids sit under Details');
    assert.deepEqual(skipped.data.skipped_tables, ['main.s.missing']);
    assert.equal(scopeOf(workspace), 'main.s.orders', 'the run reads only what the App can read');
  });
  await withInspire(async (url, workspace) => {
    const refused = await launch(url, { '01_uc_metadata': 'main.s.missing' });
    assert.equal(refused.status, 403, JSON.stringify(refused.data));
    assert.deepEqual(refused.data, { error: tableCannotRead(), unreadable: ['main.s.missing'] });
    assert.deepEqual(launched(workspace), [], 'no job is created');
    const ok = await launch(url, { '01_uc_metadata': ' main.s.orders ,　main.s.returns\x85' });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.equal(ok.data.run_id, '99');
    const reads = workspace.calls.filter((c) => /^\/api\/2\.1\/unity-catalog\/tables\//.test(c.path));
    assert.deepEqual(reads.map((c) => `${c.token} ${c.path}`).sort(), [
      `${SP_TOKEN} /api/2.1/unity-catalog/tables/main.s.missing`,
      `${SP_TOKEN} /api/2.1/unity-catalog/tables/main.s.orders`, `${SP_TOKEN} /api/2.1/unity-catalog/tables/main.s.returns`],
      'each chosen table is checked with the App’s token, after the same strip the agent does');
    assert.equal(ok.data.warnings, undefined, 'nothing skipped, nothing to say');
    assert.deepEqual(launched(workspace).map((c) => [c.path, c.token]), [['/api/2.1/jobs/create', SP_TOKEN], ['/api/2.1/jobs/run-now', SP_TOKEN]]);
    const created = launched(workspace)[0].body;
    assert.deepEqual(created.environments, [{ environment_key: 'Default', spec: { environment_version: INSPIRE_ENVIRONMENT_VERSION } }]);
    assert.deepEqual(created.tasks.map((t) => t.environment_key), ['Default'], 'the run starts on the serverless environment version the agent notebook is pinned to');
  });
});

test('a whole schema or catalog runs on the tables the App can read, names the skipped ones, and is refused only when none is readable', async () => {
  await withInspire(async (url, workspace) => {
    const schema = await launch(url, { '01_uc_metadata': 'main.s' });
    assert.equal(schema.status, 200, JSON.stringify(schema.data));
    assert.deepEqual(schema.data.warnings, ["Skipped 1 table the App can't read."]);
    assert.deepEqual(schema.data.warning_details, ["Tables the App can't read: main.s.salaries_view"]);
    assert.equal(scopeOf(workspace), 'main.s.orders,main.s.returns', 'a browse-only table is left out of the run');
    const listed = workspace.calls.filter((c) => c.path.startsWith('/api/2.1/unity-catalog/tables?'));
    assert.ok(listed.some((c) => c.token === SP_TOKEN && new URL(`http://x${c.path}`).searchParams.get('include_browse') === 'true'),
      'the App lists the schema with its browse-only tables included, so each one is checked');
    assert.deepEqual([...new Set(listed.map((c) => c.token))], [SP_TOKEN], 'every schema listing is the App\u2019s');
  });
  await withInspire(async (url, workspace) => {
    const catalog = await launch(url, { '01_uc_metadata': 'main' });
    assert.equal(catalog.status, 200, JSON.stringify(catalog.data));
    assert.deepEqual(catalog.data.warnings, ["Skipped 2 tables the App can't read."]);
    assert.deepEqual(catalog.data.warning_details, ["Tables the App can't read: main.s.salaries_view and main.secret.ledger"]);
    assert.equal(scopeOf(workspace), 'main.s.orders,main.s.returns');
    assert.ok(!workspace.calls.some((c) => c.path.includes('schema_name=information_schema')), 'the catalog’s information_schema is not a table the run reads');
  });
  await withInspire(async (url, workspace) => {
    const unreadable = await launch(url, { '01_uc_metadata': 'main.secret' });
    assert.deepEqual([unreadable.status, unreadable.data.unreadable], [403, ['main.secret.ledger']], 'a schema with nothing readable is refused');
    assert.deepEqual(launched(workspace), []);
    const readable = await launch(url, { '01_uc_metadata': 'main.information_schema' });
    assert.equal(readable.status, 200, JSON.stringify(readable.data));
    assert.equal(scopeOf(workspace), 'main.information_schema', 'a scope with nothing to skip is sent as typed');
  });
});

test('a strategy or use case file the App cannot read refuses the run, and one the App can read lets it start (REQ-418)', async () => {
  await withInspire(async (url, workspace) => {
    const tables = { '01_uc_metadata': 'main.s.orders' };
    const hidden = await launch(url, { ...tables, '10_strategic_context': '/Workspace/Users/someone/strategy.json' });
    assert.deepEqual([hidden.status, hidden.data], [403, { error: cannotRead('/Workspace/Users/someone/strategy.json'),
      unreadable: ['/Workspace/Users/someone/strategy.json'] }]);
    const volumeHidden = await launch(url, { ...tables, '10_strategic_context': ' /Volumes/hr/p/v/strategy.json' });
    assert.deepEqual(volumeHidden.data.unreadable, ['/Volumes/hr/p/v/strategy.json']);
    const useCases = await launch(url, { '01_uc_metadata': '/Volumes/hr/p/v/use_cases.json' });
    assert.deepEqual(useCases.data.unreadable, ['/Volumes/hr/p/v/use_cases.json']);
    assert.deepEqual(launched(workspace), []);
    const inline = await launch(url, { ...tables, '10_strategic_context': '{"levels": []}' });
    assert.equal(inline.status, 200, 'a strategy written in the box is not a file');
    const mine = await launch(url, { ...tables, '10_strategic_context': '/Workspace/Shared/strategy.json' });
    assert.equal(mine.status, 200, JSON.stringify(mine.data));
    const volume = await launch(url, { ...tables, '10_strategic_context': '/Volumes/main/s/v/strategy.json' });
    assert.equal(volume.status, 200, JSON.stringify(volume.data));
    const checks = workspace.calls.filter((c) => /strategy|use_cases/.test(decodeURIComponent(c.path)));
    assert.deepEqual([...new Set(checks.map((c) => c.token))], [SP_TOKEN], 'every file check is the App’s');
    assert.ok(checks.some((c) => c.method === 'HEAD' && c.path === '/api/2.0/fs/files/Volumes/main/s/v/strategy.json'));
    assert.ok(checks.some((c) => c.path === `/api/2.0/workspace/get-status?path=${encodeURIComponent('/Shared/strategy.json')}`));
  });
});

// SEC-02 (c23, D-c23-02): with no forwarded person token the person's read cannot be checked, so the run is refused and says to sign in; it never starts as the App.
test('with no forwarded person token the run is refused and says to sign in, and a check of the App the workspace cannot answer still starts the run and says what was not checked', async () => {
  await withInspire(async (url, workspace) => {
    const none = await launch(url, { '01_uc_metadata': 'main.s.orders' }, {});
    assert.equal(none.status, 403, JSON.stringify(none.data));
    assert.match(none.data.error, /Sign in to the workspace and open Inspire through its Apps URL/);
    assert.deepEqual(launched(workspace), [], 'no job is created');
  });
  await withInspire(async (url, workspace) => {
    const down = await launch(url, { '01_uc_metadata': 'main.s.orders' });
    assert.equal(down.status, 200, JSON.stringify(down.data));
    assert.deepEqual(down.data.warnings, ['Inspire could not check that the App can read main.s.orders (metastore unavailable), so the run reads it as picked.']);
    assert.equal(scopeOf(workspace), 'main.s.orders');
  }, { '/api/2.1/unity-catalog/tables/main.s.orders': [500, { message: 'metastore unavailable' }] });
});

test('the run reads are parsed as the agent parses UC Metadata and the strategic context', () => {
  const U = require('../lib/ucReads');
  assert.deepEqual(U.ucMetadataParts(' main , main.s ,main.s.orders,, a.b.c.d ,\ufeffx\u2028'), { path: '', catalogs: ['main', '\ufeffx'], schemas: ['main.s'], tables: ['main.s.orders'] });
  assert.deepEqual(U.ucMetadataParts('\x1c /Volumes/a/b/c/u.json\x85'), { path: '/Volumes/a/b/c/u.json', catalogs: [], schemas: [], tables: [] });
  assert.deepEqual(U.ucMetadataParts(''), { path: '', catalogs: [], schemas: [], tables: [] });
  assert.deepEqual(U.discoverReads({ '01_uc_metadata': 'main.s', '10_strategic_context': '\u00a0/Users/a/s.json' }),
    { catalogs: [], schemas: ['main.s'], tables: [], files: ['/Users/a/s.json'] });
  assert.deepEqual(U.discoverReads({ '01_uc_metadata': '/Users/a/u.json', '10_strategic_context': '{}' }), { catalogs: [], schemas: [], tables: [], files: ['/Users/a/u.json'] });
  const many = Array.from({ length: 13 }, (_, i) => `main.s.t${i}`);
  assert.equal(U.runUnreadableText(many), cannotRead(`${many.slice(0, 10).join(', ')} and 3 more`));
  assert.equal(U.runUnreadableText(['a.b.c']), cannotRead('a.b.c'));
  assert.equal(U.skippedTablesText(many), "Skipped 13 tables the App can't read.");
  assert.equal(U.skippedTablesDetail(many), `Tables the App can't read: ${many.slice(0, 10).join(', ')} and 3 more`);
  for (const text of [U.RUN_NO_APP_TOKEN, U.runUnreadableText(['a.b.c']), U.runUnreadableTablesText(['a.b', 'a.c'])]) {
    assert.ok(text.split(/\s+/).length <= 20, `${text} is at most 20 words`);
  }
});

test('a picker list Unity Catalog cuts says it was cut, unless the warehouse listed the rest, and a run on a cut list starts and says what was not checked', async () => {
  const endless = (key, name) => [200, { [key]: [{ name }], next_page_token: 'more' }];
  await withInspire(async (url, workspace) => {
    const cut = await get(url, '/api/catalogs');
    assert.deepEqual([cut.status, cut.data.catalogs.map((c) => c.name), cut.data.truncated], [200, ['main'], true]);
    assert.equal(ucCalls(workspace).filter((c) => c.path.startsWith('/api/2.1/unity-catalog/catalogs')).length, 40, 'the list stops at 40 pages');
    const filled = await get(url, '/api/catalogs?warehouse_id=wh');
    assert.deepEqual([filled.data.catalogs.map((c) => c.name), filled.data.truncated], [['main', 'zeta'], false]);
  }, { '/api/2.1/unity-catalog/catalogs': endless('catalogs', 'main'), '/api/2.0/sql/statements': done('catalog', ['main', 'zeta']) });
  await withInspire(async (url, workspace) => {
    const tables = await get(url, '/api/tables/main/s');
    assert.equal(tables.data.truncated, true);
    // SEC-02 (c23): a scope too big to list in full cannot have the person's read checked, so the run is refused, never sent as typed.
    const cut = await launch(url, { '01_uc_metadata': 'main.s' });
    assert.equal(cut.status, 403, JSON.stringify(cut.data));
    assert.match(cut.data.error, /could not check that you can read every table of this scope, so the run did not start/);
    assert.deepEqual(launched(workspace), [], 'no job is created');
  }, { '/api/2.1/unity-catalog/tables': endless('tables', 'orders') });
  await withInspire(async (url) => {
    const whole = await get(url, '/api/catalogs');
    assert.equal(whole.data.truncated, false, 'a list that ends is never called cut');
  });
});

test('a scope of more than 200 tables is checked in full: all readable launches, one denied table is refused and named (SEC-02, no cut scope)', async () => {
  const names = Array.from({ length: 250 }, (_, i) => `t${String(i).padStart(3, '0')}`);
  const listing = (call) => {
    const url = new URL(`http://x${call.path}`);
    if (url.searchParams.get('schema_name') !== 's') return [403, { error_code: 'PERMISSION_DENIED' }];
    return [200, { tables: names.map((name) => ({ name, full_name: `main.s.${name}` })) }];
  };
  await withInspire(async (url, workspace) => {
    const big = await launch(url, { '01_uc_metadata': 'main.s' });
    assert.equal(big.status, 200, JSON.stringify(big.data));
    assert.equal(launched(workspace).length > 0, true, 'the job was created');
  }, { '/api/2.1/unity-catalog/tables': listing });
  const denied = (call) => (/LIMIT 0/.test(String(call.body && call.body.statement)) && call.token === PERSON && /main\.s\.t100/.test(String(call.body.statement).replace(/`/g, ''))
    ? [400, { status: { state: 'FAILED', error: { message: "[INSUFFICIENT_PERMISSIONS] User does not have SELECT on Table 'main.s.t100'." } } }] : null);
  await withInspire(async (url, workspace) => {
    const one = await launch(url, { '01_uc_metadata': 'main.s' });
    assert.equal(one.status, 403, JSON.stringify(one.data));
    assert.match(one.data.error, /main\.s\.t100/);
    assert.deepEqual(launched(workspace), [], 'no job is created');
  }, { '/api/2.1/unity-catalog/tables': (call) => (denied(call) || listing(call)), '/api/2.0/sql/statements': (call) => (denied(call)
      || (/LIMIT 0/.test(String(call.body && call.body.statement)) ? [200, { status: { state: 'SUCCEEDED' }, manifest: { schema: { columns: [] } }, result: { data_array: [] } }] : null)),
  '/api/2.1/unity-catalog/tables/main.s.t100': [200, { full_name: 'main.s.t100' }] });
});

test('a whole catalog list reads in pages of 1,000, skips the warehouse when Unity Catalog answered in full, and hides the internal __ catalogs (must-exclude)', async () => {
  const many = Array.from({ length: 2500 }, (_, i) => ({ name: `c${String(i).padStart(4, '0')}` }));
  const paged = (call) => {
    const url = new URL(`http://x${call.path}`);
    const size = Number(url.searchParams.get('max_results'));
    const from = Number(url.searchParams.get('page_token') || 0);
    const rows = [{ name: '__databricks_internal' }, ...many].slice(from, from + size);
    const next = from + size < many.length + 1 ? String(from + size) : '';
    return [200, { catalogs: rows, ...(next ? { next_page_token: next } : {}) }];
  };
  await withInspire(async (url, workspace) => {
    const got = await get(url, '/api/catalogs?warehouse_id=wh');
    assert.equal(got.status, 200, JSON.stringify(got.data).slice(0, 300));
    assert.equal(got.data.catalogs.length, 2500);
    assert.ok(!got.data.catalogs.some((c) => c.name.startsWith('__')), 'no internal catalog in the picker');
    assert.deepEqual([got.data.truncated, got.data.source], [false, 'rest']);
    const listed = workspace.calls.filter((c) => c.path.startsWith('/api/2.1/unity-catalog/catalogs'));
    assert.equal(listed.length, 3, 'three pages of 1,000');
    assert.ok(listed.every((c) => c.path.includes('max_results=1000')));
    assert.equal(workspace.calls.filter((c) => c.path === '/api/2.0/sql/statements').length, 0, 'a full list never waits on the warehouse');
  }, { '/api/2.1/unity-catalog/catalogs': paged });
});

test('table reads say this source table or N source tables and never name the id in the sentence; the ids stay in unreadable (must-exclude for files)', () => {
  const U = require('../lib/ucReads');
  assert.equal(U.runUnreadableTablesText(['hr.p.salaries']), tableCannotRead());
  assert.equal(U.runUnreadableTablesText(['main.s.a', 'main.s.b']),
    "The App can't read 2 source tables. Pick tables the App can read, or ask your data owner for access");
  assert.doesNotMatch(U.runUnreadableTablesText(['main.s.a', 'main.s.b']), /main\.s\./);
  assert.equal(U.runUnreadableText(['/Workspace/Users/someone/strategy.json']), cannotRead('/Workspace/Users/someone/strategy.json'));
});
