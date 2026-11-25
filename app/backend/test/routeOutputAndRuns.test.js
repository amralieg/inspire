const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./support/serverApp');

const APP_TOKEN = 'app-sp-token';
const NONOWNER = 'nonowner@example.com';
const BOSS = 'boss@example.com';
const OUT = '/Workspace/Users/launcher@example.com/inspire_out';

test.after(() => S.stopServer());

const tokensTo = (prefix) => [...new Set(S.state.calls.filter((c) => c.path.startsWith(prefix)).map((c) => c.token))];
const list = (path) => S.request('GET', `/api/workspace/list?path=${encodeURIComponent(path)}`, { person: NONOWNER });
const built = (uc, by) => ({ session_id: '1001', use_case_id: uc, spec_version: 1, status: 'ready', created_by: by, spec_json: { use_case_name: 'Payroll leak desk' } });
const launched = (sid, folder, checked = 'passed', db = S.APP_DB) => ({ run_id: `9${sid}`, inspire_database: db, session_id: sid, output_folder: folder, output_checked: checked });
const CHECKED = {
  sessionRows: { [S.APP_DB]: [{ session_id: '1001', generation_path: OUT, business_name: 'Acme' }, { session_id: '1002', generation_path: './../demos/', business_name: 'Acme' }, { session_id: '1004', generation_path: '/', business_name: 'Acme' }] },
  launches: [launched('1001', '/Users/launcher@example.com/inspire_out'), launched('1002', '/Shared/demos'), launched('1004', '/')],
};

test('SEC-02 (reverses REQ-418): the output folder of a session in the App database lists and downloads with the person’s own token', async () => {
  for (const path of [`${OUT}/acme`, `${OUT}/acme/docs`, '/Users/launcher@example.com//inspire_out/acme/report.pdf', '/Shared/demos/acme']) {
    S.reset(structuredClone(CHECKED));
    const got = await list(path);
    assert.equal(got.status, 200, `${path}: ${got.text}`);
    assert.deepEqual(tokensTo('/api/2.0/workspace/list'), [S.PERSON_TOKEN], path);
  }
  S.reset(structuredClone(CHECKED));
  const file = await S.request('GET', `/api/workspace/export?path=${encodeURIComponent(`${OUT}/acme/catalog.csv`)}`, { person: NONOWNER });
  assert.notEqual(file.status, 401, file.text);
  assert.deepEqual(tokensTo('/api/2.0/workspace/export'), [S.PERSON_TOKEN]);
});

// REQ-418 (D-SL-10B): the App's service principal browses every folder the same way, the run's own output and any other alike.
test('every workspace browse reads as the person, the run\u2019s own output subfolder and any other folder alike (SEC-02)', async () => {
  for (const path of [OUT, `${OUT}/`, `${OUT}/other_business`, `${OUT}/other_business/catalog.pdf`, `${OUT}/acme_implemented`, `${OUT}/acmex`,
    '/Workspace/Users/launcher@example.com', '/Shared/demos', '/Shared/demos/beta/x.csv', '/acme']) {
    S.reset(structuredClone(CHECKED));
    const got = await list(path);
    assert.equal(got.status, 200, `${path}: ${got.text}`);
    assert.deepEqual(tokensTo('/api/2.0/workspace/list'), [S.PERSON_TOKEN], path);
  }
});

test('a run whose own output subfolder is unknown browses as the person the same way (SEC-02)', async () => {
  for (const name of [undefined, null, '', '   ', 7]) {
    S.reset({ sessionRows: { [S.APP_DB]: [{ session_id: '1001', generation_path: OUT, business_name: name }] }, launches: [launched('1001', '/Users/launcher@example.com/inspire_out')] });
    for (const path of [OUT, `${OUT}/acme`, `${OUT}/_`]) {
      S.state.calls.length = 0;
      const got = await list(path);
      assert.equal(got.status, 200, `${JSON.stringify(name)} ${path}: ${got.text}`);
      assert.deepEqual(tokensTo('/api/2.0/workspace/list'), [S.PERSON_TOKEN], `${JSON.stringify(name)} ${path}`);
    }
  }
});

test('a .. escape out of an output folder is refused before any token is chosen (must-exclude)', async () => {
  for (const path of [`${OUT}/../private`, `${OUT}/acme/../../private`, `${OUT}/./acme`]) {
    S.reset(structuredClone(CHECKED));
    const got = await list(path);
    assert.equal(got.status, 400, `${path}: ${got.text}`);
    assert.deepEqual(S.state.calls.filter((c) => c.category === 'action'), [], path);
  }
});

test('a sibling folder, a prefix trick, a root folder and another database session all browse as the person (SEC-02)', async () => {
  for (const path of [`${OUT}x`, `${OUT}_other/secret`, '/Workspace/Users/launcher@example.com',
    '/Users/someone-else/inspire_out', '/Workspace/Users/hr@example.com/hr_out/payroll']) {
    S.reset({
      sessionRows: { [S.APP_DB]: [...CHECKED.sessionRows[S.APP_DB]], 'hr.inspire': [{ session_id: '2001', generation_path: '/Workspace/Users/hr@example.com/hr_out' }] },
      launches: [...CHECKED.launches, launched('2001', '/Users/hr@example.com/hr_out', 'passed', 'hr.inspire')],
    });
    const got = await list(path);
    assert.equal(got.status, 200, `${path}: ${got.text}`);
    assert.deepEqual(tokensTo('/api/2.0/workspace/list'), [S.PERSON_TOKEN], path);
  }
});

test('a session in the App database whose launch record has no passed write check browses as the person too (SEC-02)', async () => {
  const cases = [
    ['released main or the notebook: no launch record', { sessionRows: { [S.APP_DB]: [{ session_id: '1003', generation_path: '/Users/old@example.com/released_out' }] }, launches: [] }],
    ['a launch record without a passed check', { sessionRows: { [S.APP_DB]: [{ session_id: '1003', generation_path: '/Users/old@example.com/released_out' }] },
      launches: [launched('1003', '/Users/old@example.com/released_out', '')] }],
    ['a launch record with a check value Inspire never writes', { sessionRows: { [S.APP_DB]: [{ session_id: '1003', generation_path: '/Users/old@example.com/released_out' }] },
      launches: [launched('1003', '/Users/old@example.com/released_out', 'true')] }],
    ['a passed check on another folder than the session records', { sessionRows: { [S.APP_DB]: [{ session_id: '1003', generation_path: '/Users/old@example.com/released_out' }] },
      launches: [launched('1003', '/Users/old@example.com/elsewhere')] }],
  ];
  for (const [label, seed] of cases) {
    S.reset(seed);
    const got = await list('/Users/old@example.com/released_out/acme');
    assert.equal(got.status, 200, `${label}: ${got.text}`);
    assert.deepEqual(tokensTo('/api/2.0/workspace/list'), [S.PERSON_TOKEN], label);
  }
});

test('preflight and output-check are refused to a person who may not build the use case, under the build rule', async () => {
  for (const route of ['/api/inspire/implement/preflight', '/api/inspire/implement/output-check']) {
    S.reset({ managers: [BOSS], history: [built('N01-U01', 'builder@example.com')] });
    const q = new URLSearchParams({ session_id: '1001', warehouse_id: S.APP_WAREHOUSE, inspire_database: S.APP_DB, use_case_id: 'N01-U01', result_table: 'hr.payroll.out', table: 'hr.payroll.out' });
    const got = await S.request('GET', `${route}?${q}`, { person: NONOWNER });
    assert.equal(got.status, 403, `${route}: ${got.text}`);
    assert.equal(got.data.policy.rule, 'owners');
    assert.match(got.data.error, /^Only an owner of Payroll leak desk, or an App manager, can check/);
    assert.doesNotMatch(got.data.error, /N01-U01/, 'the refusal names the use case, never its id');
    assert.deepEqual(S.state.calls.filter((c) => c.category === 'action'), [], `${route} read nothing before the refusal`);
  }
});

test('setup verify is refused to a person who is not an App manager, and runs for a manager', async () => {
  S.reset({ managers: [BOSS] });
  const refused = await S.request('POST', '/api/setup/verify', { person: NONOWNER, body: { warehouse_id: S.APP_WAREHOUSE, inspire_database: 'hr.private' } });
  assert.equal(refused.status, 403, refused.text);
  assert.equal(refused.data.policy.rule, 'managers');
  assert.deepEqual(S.state.calls.filter((c) => c.path.startsWith('/api/2.1/unity-catalog')), [], 'no catalog was probed for a non-manager');
  S.reset({ managers: [BOSS] });
  const allowed = await S.request('POST', '/api/setup/verify', { person: BOSS, body: { warehouse_id: S.APP_WAREHOUSE, inspire_database: S.APP_DB } });
  assert.equal(allowed.status, 200, allowed.text);
  S.reset({ managers: [BOSS] });
  await S.request('POST', '/api/setup/verify', { person: BOSS, body: { warehouse_id: '../../preview/scim/v2/Users?filter=x', inspire_database: S.APP_DB } });
  const asked = S.state.calls.map((c) => c.path);
  assert.ok(asked.includes('/api/2.0/sql/warehouses/..%2F..%2Fpreview%2Fscim%2Fv2%2FUsers%3Ffilter%3Dx'), asked.join(' | '));
  assert.deepEqual(asked.filter((p) => p.startsWith('/api/2.0/preview/scim/v2/Users')), [], 'a warehouse id cannot walk the App token to another API');
});

test('a tenant id typed into the sign-in form stays one path segment of the Microsoft token address (must-exclude)', async () => {
  S.reset({});
  await S.request('POST', '/api/auth/sp-token', { body: { client_id: 'c', client_secret: 's', tenant_id: '../common/../x?y=1', databricks_host: 'https://workspace.example.com' } });
  const asked = S.state.calls.map((c) => c.path);
  assert.ok(asked.includes('/..%2Fcommon%2F..%2Fx%3Fy%3D1/oauth2/v2.0/token'), asked.join(' | '));
});

test('run status and output answer only for runs recorded in the App database; any other run id is refused with the reason', async () => {
  for (const route of ['/api/run/777', '/api/run/777/output']) {
    S.reset({ launchers: { 501: 'launcher@example.com' } });
    const got = await S.request('GET', route, { person: NONOWNER });
    assert.equal(got.status, 403, `${route}: ${got.text}`);
    assert.equal(got.data.policy.rule, 'recorded');
    assert.match(got.data.error, /^Inspire shows only runs it launched and recorded in its own database, and it has no record of run 777/);
    assert.deepEqual(S.state.calls.filter((c) => c.path.startsWith('/api/2.1/jobs')), [], `${route} never asked the Jobs API`);
  }
  S.reset({ launchers: { 501: 'launcher@example.com' } });
  // SEC-02 (5ff80186c): run status goes through the session check, so a person who did not launch the run no longer reads it; the launcher does.
  const own = await S.request('GET', '/api/run/501', { person: 'launcher@example.com' });
  assert.equal(own.status, 200, own.text);
  assert.deepEqual(tokensTo('/api/2.1/jobs/runs/get'), [APP_TOKEN]);
});

test('a Databricks refusal on a run read answers in plain words and never sends the API body (REQ-184 sweep)', async () => {
  S.reset({ launchers: { 501: 'launcher@example.com' }, runStates: {} });
  const got = await S.request('GET', '/api/run/501', { person: 'launcher@example.com' });
  assert.equal(got.status, 404, got.text);
  assert.equal(got.data.error, 'Inspire could not read run 501: Run 501 does not exist.');
  assert.doesNotMatch(got.text, /error_code|RESOURCE_DOES_NOT_EXIST|request_id/);
});

test('a refused workspace file download answers in plain words and never sends the API body (REQ-184 sweep)', async () => {
  S.reset({ sessionRows: { [S.APP_DB]: [{ session_id: '1001', generation_path: OUT, business_name: 'Acme' }] }, launches: [launched('1001', '/Users/launcher@example.com/inspire_out')], exportDenied: true });
  const got = await S.request('GET', `/api/workspace/export?path=${encodeURIComponent(`${OUT}/acme/catalog.csv`)}`, { person: NONOWNER });
  assert.equal(got.status, 403, got.text);
  assert.equal(got.data.error, 'Inspire could not read that file: raw workspace detail. Your sign-in or the App lacks a permission it needs. Ask an App manager to check the grants, then try again.');
  assert.doesNotMatch(got.text, /error_code|PERMISSION_DENIED/);
});

test('the cluster list route is gone', async () => {
  S.reset();
  const got = await S.request('GET', '/api/clusters', { person: NONOWNER });
  assert.equal(got.status, 404, got.text);
  assert.deepEqual(S.state.calls.filter((c) => c.path.startsWith('/api/2.0/clusters')), []);
});
