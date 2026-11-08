const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeWorkspace, startInspire } = require('./support/serverProcess');
const { NO_PERSON_TOKEN } = require('../lib/routePolicy');
const { INSPIRE_ENVIRONMENT_VERSION } = require('../lib/inspireJobParams');

const SP_TOKEN = 'sp-token';
const PERSON = 'person-token';
const PERSON_EMAIL = ['pat.lee', 'example.com'].join('@');
const APP_ENV = { NODE_ENV: 'production', DATABRICKS_CLIENT_ID: 'inspire-client', DATABRICKS_CLIENT_SECRET: 'inspire-secret' };
const { RUN_NO_SIGN_IN } = require('../lib/ucReads');
const cannotRead = (names) => `You can't read ${names}. Pick tables and files you can read, or ask their owner for access`;
const scopeOf = (workspace) => launched(workspace)[0].body.tasks[0].notebook_task.base_parameters['01_uc_metadata'];

const SEES = {
  [SP_TOKEN]: {
    catalogs: ['main', 'hr'],
    schemas: { main: ['s', 'secret', 'information_schema'], hr: ['p'] },
    tables: { 'main.s': ['orders', 'returns', 'salaries_view'], 'main.secret': ['ledger'], 'hr.p': ['salaries'], 'main.information_schema': ['tables'] },
  },
  [PERSON]: {
    catalogs: ['main'],
    schemas: { main: ['s', 'information_schema'] },
    tables: { 'main.s': ['orders', 'returns'], 'main.information_schema': ['tables'] },
    files: ['/Users/pat/strategy.json', '/Volumes/main/s/v/strategy.json'],
  },
};
const done = (column, values) => [200, { status: { state: 'SUCCEEDED' }, manifest: { schema: { columns: [{ name: column }] } },
  result: { data_array: values.map((v) => [v]) } }];

function answer(call, broken = {}) {
  const url = new URL(`http://x${call.path}`);
  const sees = SEES[call.token];
  if (call.path === '/oidc/v1/token') return [200, { access_token: SP_TOKEN, expires_in: 3600 }];
  if (call.path.startsWith('/api/2.0/preview/scim/v2/Me')) return [200, call.token === SP_TOKEN ? { userName: 'sp', applicationId: 'sp' } : { userName: PERSON_EMAIL }];
  if (broken[url.pathname]) return broken[url.pathname];
  if (!sees) return [401, { message: 'Invalid access token' }];
  if (url.pathname === '/api/2.1/unity-catalog/catalogs') return [200, { catalogs: sees.catalogs.map((name) => ({ name })) }];
  if (url.pathname === '/api/2.1/unity-catalog/schemas') {
    const found = sees.schemas[url.searchParams.get('catalog_name')];
    return found ? [200, { schemas: found.map((name) => ({ name })) }] : [403, { error_code: 'PERMISSION_DENIED', message: 'User does not have USE CATALOG' }];
  }
  if (url.pathname === '/api/2.1/unity-catalog/tables') {
    const scope = `${url.searchParams.get('catalog_name')}.${url.searchParams.get('schema_name')}`;
    const found = sees.tables[scope];
    return found ? [200, { tables: found.map((name) => ({ name, full_name: `${scope}.${name}` })) }] : [403, { error_code: 'PERMISSION_DENIED', message: 'User does not have USE SCHEMA' }];
  }
  const one = /^\/api\/2\.1\/unity-catalog\/tables\/(.+)$/.exec(url.pathname);
  if (one) {
    const name = decodeURIComponent(one[1]);
    const [catalog, schema, table] = name.split('.');
    return (sees.tables[`${catalog}.${schema}`] || []).includes(table) ? [200, { full_name: name }]
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
  if (url.pathname === '/api/2.0/sql/statements' && /^SHOW CATALOGS/.test(String(call.body && call.body.statement))) return done('catalog', sees.catalogs);
  if (url.pathname === '/api/2.0/sql/statements' && /^SHOW SCHEMAS IN `([^`]+)`/.test(String(call.body && call.body.statement))) {
    return done('databaseName', sees.schemas[/^SHOW SCHEMAS IN `([^`]+)`/.exec(call.body.statement)[1]] || []);
  }
  if (url.pathname === '/api/2.0/sql/statements' && /^SHOW TABLES IN `([^`]+)`\.`([^`]+)`/.test(String(call.body && call.body.statement))) {
    const [, catalog, schema] = /^SHOW TABLES IN `([^`]+)`\.`([^`]+)`/.exec(call.body.statement);
    return done('tableName', sees.tables[`${catalog}.${schema}`] || []);
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
async function get(url, path, headers = signedIn) {
  const resp = await fetch(`${url}${path}`, { headers });
  return { status: resp.status, data: await resp.json() };
}
async function launch(url, params, headers = signedIn) {
  const resp = await fetch(`${url}/api/run`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ params: { '00_business_name': 'Acme', '02_inspire_database': 'main._inspire', ...params } }) });
  return { status: resp.status, data: await resp.json() };
}
const ucCalls = (workspace) => workspace.calls.filter((c) => c.path.startsWith('/api/2.1/unity-catalog') || c.path === '/api/2.0/sql/statements');
const launched = (workspace) => workspace.calls.filter((c) => c.path.startsWith('/api/2.1/jobs/'));

test('the Launch pickers list catalogs, schemas and tables with the person\u2019s own token, so names only the App can see never appear', async () => {
  await withInspire(async (url, workspace) => {
    const catalogs = await get(url, '/api/catalogs?warehouse_id=wh');
    assert.equal(catalogs.status, 200, JSON.stringify(catalogs.data));
    assert.deepEqual(catalogs.data.catalogs.map((c) => c.name), ['main']);
    const schemas = await get(url, '/api/catalogs/main/schemas?warehouse_id=wh');
    assert.deepEqual(schemas.data.schemas.map((s) => s.full_name), ['main.information_schema', 'main.s']);
    const tables = await get(url, '/api/tables/main/s?warehouse_id=wh');
    assert.deepEqual(tables.data.tables.map((t) => t.full_name), ['main.s.orders', 'main.s.returns']);
    const hidden = await get(url, '/api/catalogs/hr/schemas');
    assert.deepEqual([hidden.status, hidden.data.schemas], [502, undefined], 'a catalog only the App can see answers what the person\u2019s own sign-in got');
    const calls = ucCalls(workspace);
    assert.ok(calls.length >= 7, `${calls.length} reads`);
    assert.deepEqual([...new Set(calls.map((c) => c.token))], [PERSON], 'every listing read is the person\u2019s');
    assert.ok(!calls.some((c) => c.path.includes('include_browse')), 'a picker never asks for tables the person may only browse');
  });
});

test('with no forwarded person token the pickers get the sign-in refusal and read nothing as the App', async () => {
  await withInspire(async (url, workspace) => {
    for (const path of ['/api/catalogs?warehouse_id=wh', '/api/catalogs/main/schemas', '/api/tables/main/s']) {
      const got = await get(url, path, {});
      assert.deepEqual([got.status, got.data.error, got.data.policy && got.data.policy.identity], [401, NO_PERSON_TOKEN, 'person'], path);
    }
    assert.deepEqual(ucCalls(workspace), []);
  });
});

test('a run skips a chosen table the person cannot read and says so, is refused only when none is readable, and starts when every table is readable (must-exclude)', async () => {
  await withInspire(async (url, workspace) => {
    const skipped = await launch(url, { '01_uc_metadata': 'main.s.orders,hr.p.salaries' });
    assert.equal(skipped.status, 200, JSON.stringify(skipped.data));
    assert.deepEqual(skipped.data.warnings, ["Skipped 1 table you can't read: hr.p.salaries."]);
    assert.deepEqual(skipped.data.skipped_tables, ['hr.p.salaries']);
    assert.equal(scopeOf(workspace), 'main.s.orders', 'the run reads only what the person can read');
  });
  await withInspire(async (url, workspace) => {
    const refused = await launch(url, { '01_uc_metadata': 'hr.p.salaries' });
    assert.equal(refused.status, 403, JSON.stringify(refused.data));
    assert.deepEqual(refused.data, { error: cannotRead('hr.p.salaries'), unreadable: ['hr.p.salaries'] });
    assert.deepEqual(launched(workspace), [], 'no job is created');
    const ok = await launch(url, { '01_uc_metadata': ' main.s.orders ,\u3000main.s.returns\x85' });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.equal(ok.data.run_id, 99);
    const reads = workspace.calls.filter((c) => /^\/api\/2\.1\/unity-catalog\/tables\//.test(c.path));
    assert.deepEqual(reads.map((c) => `${c.token} ${c.path}`).sort(), [
      `${PERSON} /api/2.1/unity-catalog/tables/hr.p.salaries`,
      `${PERSON} /api/2.1/unity-catalog/tables/main.s.orders`, `${PERSON} /api/2.1/unity-catalog/tables/main.s.returns`],
      'each chosen table is checked with the person\u2019s token, after the same strip the agent does');
    assert.equal(ok.data.warnings, undefined, 'nothing skipped, nothing to say');
    assert.deepEqual(launched(workspace).map((c) => [c.path, c.token]), [['/api/2.1/jobs/create', SP_TOKEN], ['/api/2.1/jobs/run-now', SP_TOKEN]]);
    const created = launched(workspace)[0].body;
    assert.deepEqual(created.environments, [{ environment_key: 'Default', spec: { environment_version: INSPIRE_ENVIRONMENT_VERSION } }]);
    assert.deepEqual(created.tasks.map((t) => t.environment_key), ['Default'], 'the run starts on the serverless environment version the agent notebook is pinned to');
  });
});

test('a whole schema or catalog runs on the tables the person can read, names the skipped ones from what the App sees, and is refused only when none is readable', async () => {
  await withInspire(async (url, workspace) => {
    const schema = await launch(url, { '01_uc_metadata': 'main.s' });
    assert.equal(schema.status, 200, JSON.stringify(schema.data));
    assert.deepEqual(schema.data.warnings, ["Skipped 1 table you can't read: main.s.salaries_view."]);
    assert.equal(scopeOf(workspace), 'main.s.orders,main.s.returns', 'a browse-only table is left out of the run');
    const listed = workspace.calls.filter((c) => c.path.startsWith('/api/2.1/unity-catalog/tables?'));
    assert.deepEqual(listed.map((c) => [c.token, new URL(`http://x${c.path}`).searchParams.get('include_browse')]), [[SP_TOKEN, 'true'], [PERSON, null]],
      'the App lists every table it can see in the schema, the person only what they can read');
  });
  await withInspire(async (url, workspace) => {
    const catalog = await launch(url, { '01_uc_metadata': 'main' });
    assert.equal(catalog.status, 200, JSON.stringify(catalog.data));
    assert.deepEqual(catalog.data.warnings, ["Skipped 2 tables you can't read: main.s.salaries_view and main.secret.ledger."]);
    assert.equal(scopeOf(workspace), 'main.s.orders,main.s.returns');
    assert.ok(!workspace.calls.some((c) => c.path.includes('schema_name=information_schema')), 'the catalog\u2019s information_schema is not a table the run reads');
  });
  await withInspire(async (url, workspace) => {
    const hidden = await launch(url, { '01_uc_metadata': 'hr' });
    assert.deepEqual([hidden.status, hidden.data.unreadable], [403, ['hr.p.salaries']]);
    assert.deepEqual(launched(workspace), []);
    const readable = await launch(url, { '01_uc_metadata': 'main.information_schema' });
    assert.equal(readable.status, 200, JSON.stringify(readable.data));
    assert.equal(scopeOf(workspace), 'main.information_schema', 'a scope with nothing to skip is sent as typed');
  });
});

test('a strategy or use case file the person cannot read refuses the run, and one they can read lets it start', async () => {
  await withInspire(async (url, workspace) => {
    const tables = { '01_uc_metadata': 'main.s.orders' };
    const workspaceFile = await launch(url, { ...tables, '10_strategic_context': '/Workspace/Users/someone/strategy.json' });
    assert.deepEqual([workspaceFile.status, workspaceFile.data], [403, { error: cannotRead('/Workspace/Users/someone/strategy.json'),
      unreadable: ['/Workspace/Users/someone/strategy.json'] }]);
    const volumeFile = await launch(url, { ...tables, '10_strategic_context': ' /Volumes/hr/p/v/strategy.json' });
    assert.deepEqual(volumeFile.data.unreadable, ['/Volumes/hr/p/v/strategy.json']);
    const useCases = await launch(url, { '01_uc_metadata': '/Volumes/hr/p/v/use_cases.json' });
    assert.deepEqual(useCases.data.unreadable, ['/Volumes/hr/p/v/use_cases.json']);
    assert.deepEqual(launched(workspace), []);
    const inline = await launch(url, { ...tables, '10_strategic_context': '{"levels": []}' });
    assert.equal(inline.status, 200, 'a strategy written in the box is not a file');
    const mine = await launch(url, { ...tables, '10_strategic_context': '/Workspace/Users/pat/strategy.json' });
    assert.equal(mine.status, 200, JSON.stringify(mine.data));
    const volume = await launch(url, { ...tables, '10_strategic_context': '/Volumes/main/s/v/strategy.json' });
    assert.equal(volume.status, 200, JSON.stringify(volume.data));
    const checks = workspace.calls.filter((c) => /strategy|use_cases/.test(decodeURIComponent(c.path)));
    assert.deepEqual([...new Set(checks.map((c) => c.token))], [PERSON]);
    assert.ok(checks.some((c) => c.method === 'HEAD' && c.path === '/api/2.0/fs/files/Volumes/main/s/v/strategy.json'));
    assert.ok(checks.some((c) => c.path === `/api/2.0/workspace/get-status?path=${encodeURIComponent('/Users/pat/strategy.json')}`));
  });
});

test('with no forwarded person token no run starts, and a check the workspace cannot answer still starts the run and says what was not checked', async () => {
  await withInspire(async (url, workspace) => {
    const none = await launch(url, { '01_uc_metadata': 'main.s.orders' }, {});
    assert.deepEqual([none.status, none.data], [401, { error: RUN_NO_SIGN_IN, unreadable: [] }]);
    assert.deepEqual(launched(workspace), []);
  });
  await withInspire(async (url, workspace) => {
    const down = await launch(url, { '01_uc_metadata': 'main.s.orders' });
    assert.equal(down.status, 200, JSON.stringify(down.data));
    assert.deepEqual(down.data.warnings, ['Inspire could not check that you can read main.s.orders (metastore unavailable), so the run reads it as picked.']);
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
  assert.equal(U.skippedTablesText(many), `Skipped 13 tables you can't read: ${many.slice(0, 10).join(', ')} and 3 more.`);
  for (const text of [U.RUN_NO_SIGN_IN, U.WRITE_NO_SIGN_IN, U.runUnreadableText(['a.b.c'])]) {
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
    const cut = await launch(url, { '01_uc_metadata': 'main.s' });
    assert.equal(cut.status, 200, JSON.stringify(cut.data));
    assert.deepEqual(cut.data.warnings, ['Inspire could not check that you can read main.s (main.s holds more tables than the 200 Inspire can list), so the run reads it as picked.']);
    assert.equal(scopeOf(workspace), 'main.s', 'an unchecked schema is sent as typed, never cut down to the tables that were listed');
  }, { '/api/2.1/unity-catalog/tables': endless('tables', 'orders') });
  await withInspire(async (url) => {
    const whole = await get(url, '/api/catalogs');
    assert.equal(whole.data.truncated, false, 'a list that ends is never called cut');
  });
});
