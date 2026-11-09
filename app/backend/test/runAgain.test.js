const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./support/serverApp');
const LC = require('../lib/launchChoice');

test.after(() => S.stopServer());

const ME = 'launcher@example.com';
const BOSS = 'manager@example.com';
const PARAMS = { '00_business_name': 'Acme', '02_inspire_database': S.APP_DB, '14_session_id': '7100', '15_operation': 'Discover Use Cases' };
const creates = () => S.state.calls.filter((c) => c.path === '/api/2.1/jobs/create');

async function failedLaunch(state = { life_cycle_state: 'TERMINATED', result_state: 'FAILED' }, params = PARAMS) {
  S.reset({ notebookPresent: true, managers: [BOSS], runStates: {} });
  const first = await S.request('POST', '/api/run', { person: ME, body: { params } });
  assert.equal(first.status, 200, first.text.slice(0, 300));
  S.state.runStates[first.data.run_id] = state;
  S.state.launchers[first.data.run_id] = ME;
  return { runId: first.data.run_id, firstJob: S.state.createdJob, before: creates().length };
}

test('the person who launched a failed Discover run runs it again with the same settings in a new session', async () => {
  const { runId, firstJob, before } = await failedLaunch();
  const again = await S.request('POST', `/api/run/${runId}/again`, { person: ME, body: { session_id: '7200' } });
  assert.equal(again.status, 200, again.text.slice(0, 300));
  assert.equal(creates().length, before + 1);
  const task = S.state.createdJob.tasks[0].notebook_task;
  assert.deepEqual(task.base_parameters, { ...firstJob.tasks[0].notebook_task.base_parameters, '14_session_id': '7200' });
  assert.equal(task.notebook_path, firstJob.tasks[0].notebook_task.notebook_path);
});

test('a run that has not ended, or ended well, is not run again and starts no job (must-exclude)', async () => {
  for (const [state, said] of [[{ life_cycle_state: 'RUNNING' }, /has not ended yet/], [{ life_cycle_state: 'TERMINATED', result_state: 'SUCCESS' }, /ended well/]]) {
    const { runId, before } = await failedLaunch(state);
    const again = await S.request('POST', `/api/run/${runId}/again`, { person: ME, body: { session_id: '7200' } });
    assert.equal(again.status, 409, again.text.slice(0, 300));
    assert.match(again.data.error, said);
    assert.equal(creates().length, before);
  }
});

test('only the launcher or an App manager runs a run again, and a bad session id is refused before Databricks is asked', async () => {
  const { runId, before } = await failedLaunch();
  const other = await S.request('POST', `/api/run/${runId}/again`, { person: 'other@example.com', body: { session_id: '7200' } });
  assert.equal(other.status, 403, other.text.slice(0, 300));
  assert.match(other.data.error, new RegExp(`^Only the person who launched run ${runId}, or an App manager, can run it again\\.`));
  const bad = await S.request('POST', `/api/run/${runId}/again`, { person: ME, body: { session_id: '12; DROP' } });
  assert.equal(bad.status, 400);
  assert.equal(creates().length, before);
  const boss = await S.request('POST', `/api/run/${runId}/again`, { person: BOSS, body: { session_id: '7300' } });
  assert.equal(boss.status, 200, boss.text.slice(0, 300));
});

test('a run whose settings hold a build of a use case is refused, since Launch never builds one (must-exclude)', async () => {
  const { runId, before } = await failedLaunch();
  S.state.runStates[runId] = { life_cycle_state: 'TERMINATED', result_state: 'FAILED', tasks: [{ task_key: 'inspire_notebook',
    notebook_task: { notebook_path: '/Workspace/x', base_parameters: { ...PARAMS, inspire_implement_use_case: 'N01-U01' } } }] };
  const again = await S.request('POST', `/api/run/${runId}/again`, { person: ME, body: { session_id: '7200' } });
  assert.equal(again.status, 403, again.text.slice(0, 300));
  assert.match(again.data.error, /Launch does not build a use case/);
  assert.equal(creates().length, before);
});

test('runAgainOf reads the notebook and settings of an ended run and names why it cannot otherwise', () => {
  const ended = { life_cycle_state: 'INTERNAL_ERROR' };
  const task = { task_key: 't', existing_cluster_id: 'c1', notebook_task: { notebook_path: '/n', base_parameters: { '00_business_name': 'Acme', '14_session_id': '1' } } };
  assert.deepEqual(LC.runAgainOf({ state: ended, tasks: [task] }, '9', '2'),
    { params: { '00_business_name': 'Acme', '14_session_id': '2' }, notebook_path: '/n', cluster_id: 'c1' });
  assert.match(LC.runAgainOf({ state: ended, tasks: [] }, '9', '2').problem, /^Run 9 names no notebook/);
  assert.match(LC.runAgainOf({ state: ended, tasks: [{ notebook_task: { notebook_path: '/n', base_parameters: [] } }] }, '9', '2').problem, /no business name/);
  assert.match(LC.runAgainOf({}, '9', '2').problem, /has not ended yet/);
  assert.match(LC.runAgainOf(null, '9', '2').problem, /has not ended yet/);
});
