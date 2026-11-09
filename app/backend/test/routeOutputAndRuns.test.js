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
  sessionRows: { [S.APP_DB]: [{ session_id: '1001', generation_path: OUT }, { session_id: '1002', generation_path: './../demos/' }, { session_id: '1004', generation_path: '/' }] },
  launches: [launched('1001', '/Users/launcher@example.com/inspire_out'), launched('1002', '/Shared/demos'), launched('1004', '/')],
};

test('the output folder of a session in the App database lists and downloads with the App token, so every App user sees what the App produced', async () => {
  for (const path of [OUT, `${OUT}/acme`, '/Users/launcher@example.com//inspire_out/acme/report.pdf', '/Shared/demos/acme']) {
    S.reset(structuredClone(CHECKED));
    const got = await list(path);
    assert.equal(got.status, 200, `${path}: ${got.text}`);
    assert.deepEqual(tokensTo('/api/2.0/workspace/list'), [APP_TOKEN], path);
  }
  S.reset(structuredClone(CHECKED));
  const file = await S.request('GET', `/api/workspace/export?path=${encodeURIComponent(`${OUT}/acme/catalog.csv`)}`, { person: NONOWNER });
  assert.notEqual(file.status, 401, file.text);
  assert.deepEqual(tokensTo('/api/2.0/workspace/export'), [APP_TOKEN]);
});

test('a .. escape out of an output folder is refused before any token is chosen (must-exclude)', async () => {
  for (const path of [`${OUT}/../private`, `${OUT}/acme/../../private`, `${OUT}/./acme`]) {
    S.reset(structuredClone(CHECKED));
    const got = await list(path);
    assert.equal(got.status, 400, `${path}: ${got.text}`);
    assert.deepEqual(S.state.calls.filter((c) => c.category === 'action'), [], path);
  }
});

test('a sibling folder, a prefix trick, a root folder and another database session all read with the person token (must-exclude)', async () => {
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

test('a session in the App database whose launch record has no passed write check reads with the person token (must-exclude)', async () => {
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
  const own = await S.request('GET', '/api/run/501', { person: NONOWNER });
  assert.equal(own.status, 200, own.text);
  assert.deepEqual(tokensTo('/api/2.1/jobs/runs/get'), [APP_TOKEN]);
});

test('the cluster list route is gone', async () => {
  S.reset();
  const got = await S.request('GET', '/api/clusters', { person: NONOWNER });
  assert.equal(got.status, 404, got.text);
  assert.deepEqual(S.state.calls.filter((c) => c.path.startsWith('/api/2.0/clusters')), []);
});
