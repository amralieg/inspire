const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../lib/launchLedger');
const S = require('./support/serverApp');

test.after(() => S.stopServer());

const LIST = `/api/inspire/sessions?inspire_database=${S.APP_DB}&warehouse_id=${S.APP_WAREHOUSE}&all=1`;
const runParams = (sid, business = 'Acme') => ({ params: { '00_business_name': business, '02_inspire_database': S.APP_DB, '14_session_id': sid, '15_operation': 'Discover Use Cases' } });
const launch = async (sid, runId, business) => {
  S.state.nextRunId = runId;
  const got = await S.request('POST', '/api/run', { person: 'launcher@example.com', body: runParams(sid, business) });
  assert.equal(got.status, 200, got.text.slice(0, 300));
};
const list = async (person = 'reader@example.com') => {
  const got = await S.request('GET', LIST, { person });
  assert.equal(got.status, 200, got.text.slice(0, 300));
  return got.data.sessions;
};

test('a run the App launched shows on Start as Starting before the agent writes its first row, with its business and run', async () => {
  S.reset({ notebookPresent: true, runStates: { 701: 'PENDING' } });
  await launch('7001', 701, 'Acme');
  const sessions = await list();
  assert.equal(sessions.length, 1);
  const [row] = sessions;
  assert.deepEqual([row.session_id, row.run_id, row.starting, row.business_name, row.completed_percent], ['7001', '701', true, 'Acme', 0]);
  assert.deepEqual([row.widget_values.business, row.widget_values.operation_mode, row.widget_values.inspire_database], ['Acme', 'Discover Use Cases', S.APP_DB]);
  assert.ok(row.create_at && row.last_updated);
  const reads = S.state.calls.filter((c) => c.path === '/api/2.1/jobs/runs/get');
  assert.deepEqual(reads.map((c) => [c.query, c.token]), [['?run_id=701', 'app-sp-token']], 'the recorded run is read with the App token, as GET /api/run does');
});

test('a starting run sits above the runs that already wrote rows, and leaves once its own row exists (must-exclude)', async () => {
  S.reset({ notebookPresent: true, runStates: { 702: 'RUNNING' }, sessionList: [{ session_id: '6001', business_name: 'Beta', completed_percent: 100, create_at: '2026-11-01T09:00:00Z', business_runs: 1, business_rank: 1 }] });
  await launch('7002', 702, 'Gamma');
  assert.deepEqual((await list()).map((s) => [s.session_id, Boolean(s.starting)]), [['7002', true], ['6001', false]]);
  S.state.sessionList.unshift({ session_id: '7002', business_name: 'Gamma', completed_percent: 3, create_at: '2026-11-02T10:01:00Z', business_runs: 1, business_rank: 1 });
  assert.deepEqual((await list()).map((s) => [s.session_id, Boolean(s.starting)]), [['7002', false], ['6001', false]], 'listed once, from its own row');
  S.state.sessionList.shift();
  S.state.knownSessions.push('7002');
  assert.deepEqual((await list()).map((s) => s.session_id), ['6001'], 'a row that exists beyond the list cap is not shown again as starting');
});

test('finished, unknown, regenerated, reopened, other-database and mismatched runs never show as starting (must-exclude)', async () => {
  for (const life of ['TERMINATED', 'TERMINATING', 'SKIPPED', 'INTERNAL_ERROR']) {
    S.reset({ notebookPresent: true, runStates: { 703: life } });
    await launch('7003', 703);
    assert.deepEqual(await list(), [], life);
  }
  S.reset({ notebookPresent: true, runStates: {} });
  await launch('7004', 704);
  assert.deepEqual(await list(), [], 'a run the workspace no longer knows');
  S.reset({ notebookPresent: true, runStates: { 705: 'PENDING' } });
  await launch('7005', 705);
  S.state.launches[0].run_type = 'genie_regen';
  assert.deepEqual(await list(), [], 'not a discovery run');
  S.state.launches[0].run_type = 'discovery';
  S.state.launches[0].opened_session = 'false';
  assert.deepEqual(await list(), [], 'a launch that reused a session that already existed');
  S.state.launches[0].opened_session = 'true';
  S.state.launches[0].inspire_database = 'other.inspire';
  assert.deepEqual(await list(), [], 'a run that writes to another Inspire database');
  S.state.calls.length = 0;
  const other = await S.request('GET', `/api/inspire/sessions?inspire_database=other.inspire&warehouse_id=${S.APP_WAREHOUSE}&all=1`, { person: 'reader@example.com' });
  assert.equal(other.status, 200, other.text.slice(0, 300));
  assert.deepEqual(other.data.sessions, [], 'a database the App does not own is read as the person, so its starting runs are not looked up as the App');
  assert.deepEqual(S.state.calls.filter((c) => c.token === 'app-sp-token' && !['auth', 'policy'].includes(c.category)).map((c) => c.path), []);
  S.state.launches[0].inspire_database = S.APP_DB;
  S.state.launches[0].session_id = '7999';
  assert.deepEqual(await list(), [], 'the run carries another session id than the ledger');
});

test('when the launch ledger cannot be read, Start still lists the runs that wrote rows', async () => {
  S.reset({ notebookPresent: true, runStates: { 706: 'PENDING' }, sessionList: [{ session_id: '6002', business_name: 'Beta', completed_percent: 100, create_at: '2026-11-01T09:00:00Z', business_runs: 1, business_rank: 1 }] });
  await launch('7006', 706);
  S.state.conflictOn = (sql) => (/AS run_id, session_id, launched_at/.test(sql) ? '[INSUFFICIENT_PERMISSIONS] the App cannot read its ledger' : '');
  assert.deepEqual((await list()).map((s) => s.session_id), ['6002']);
});

test('the starting statements filter in SQL, take only numeric session ids, and a run row needs a live state', () => {
  const table = L.launchTableName(S.APP_DB);
  const st = L.startingLaunchStatement(table, 'Main.Inspire');
  assert.match(st.sql, /WHERE inspire_database = :inspire_database AND run_type = 'discovery' AND opened_session AND launched_at > current_timestamp\(\) - INTERVAL 1 DAY ORDER BY launched_at DESC LIMIT 10$/);
  assert.deepEqual(st.parameters, [{ name: 'inspire_database', value: 'main.inspire', type: 'STRING' }]);
  assert.equal(L.startingLaunchStatement(table, 'not-a-db'), null);
  const seen = L.sessionsSeenStatement(S.APP_DB, ['7', 'x', '7', '8; DROP']);
  assert.match(seen.sql, /WHERE session_id IN \(:s0\)$/);
  assert.deepEqual(seen.parameters, [{ name: 's0', value: '7', type: 'BIGINT' }]);
  assert.equal(L.sessionsSeenStatement(S.APP_DB, ['x']), null);
  const live = { state: { life_cycle_state: 'QUEUED' }, tasks: [{ notebook_task: { base_parameters: { '00_business_name': 'Acme', '14_session_id': '9' } } }] };
  assert.equal(L.startingSessionRow({ run_id: '1', session_id: '9', launched_at: 't' }, live, S.APP_DB).business_name, 'Acme');
  assert.equal(L.startingSessionRow({ run_id: '1', session_id: '9' }, { state: {} }, S.APP_DB), null);
  assert.equal(L.startingSessionRow({ run_id: '1', session_id: '9' }, null, S.APP_DB), null);
});
