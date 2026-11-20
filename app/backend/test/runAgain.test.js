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

// REQ-418: the old run is read with the App's service principal, the identity every data read and launch uses.
const readsOf = () => S.state.calls.filter((c) => c.path === '/api/2.1/jobs/runs/get').map((c) => c.token);
const RUN_AGAIN_ERROR = (runId) => `Inspire could not read run ${runId} to run it again: the App needs CAN VIEW (or CAN MANAGE RUN) on job 5 in Databricks. `
  + "Ask an App manager or the job's owner to grant it, then try again.";

test('Run again reads the old run with the App\'s service principal, and launches it with the same identity (REQ-418)', async () => {
  const { runId, before } = await failedLaunch();
  const again = await S.request('POST', `/api/run/${runId}/again`, { person: ME, body: { session_id: '7200' } });
  assert.equal(again.status, 200, again.text.slice(0, 300));
  assert.deepEqual(readsOf(), [S.APP_TOKEN], 'the old run is read with the App token, never the person token');
  assert.equal(creates().length, before + 1);
  assert.deepEqual([...new Set(S.state.calls.filter((c) => c.path === '/api/2.1/jobs/run-now').map((c) => c.token))], [S.APP_TOKEN],
    'the launch keeps the App identity launchDiscover always uses');
});

test('when the App cannot view the old run\'s job, Run again names the job and the App\'s grant in plain words, with no API body (REQ-418)', async () => {
  const { runId, before } = await failedLaunch();
  S.state.runViewDenied = { tokens: [S.APP_TOKEN], jobId: '5' };
  const again = await S.request('POST', `/api/run/${runId}/again`, { person: ME, body: { session_id: '7200' } });
  assert.equal(again.status, 403, again.text.slice(0, 300));
  assert.equal(again.data.error, RUN_AGAIN_ERROR(runId));
  assert.doesNotMatch(again.text, /error_code|PERMISSION_DENIED|does not have/);
  const [grant] = again.data.permissions;
  assert.equal(grant.principal, S.APP_SP, 'the grant is for the App, not the person');
  // AUTO-4 (round 2): the job CLI line is a copyable step (Copy steps), so it is in `steps`, not in the plain `instructions` notes.
  assert.match(grant.steps.join('\n'), /\/api\/2\.0\/permissions\/jobs\/5/);
  assert.match(grant.steps.join('\n'), /CAN_VIEW/);
  assert.match(grant.steps.join('\n'), new RegExp(S.APP_SP));
  assert.equal(creates().length, before, 'no job starts');

  S.state.launches = [];
  const unnamed = await S.request('POST', `/api/run/${runId}/again`, { person: ME, body: { session_id: '7200' } });
  assert.equal(unnamed.status, 403, unnamed.text.slice(0, 300));
  assert.match(unnamed.data.error, /on the job of this run in Databricks\./);
  assert.doesNotMatch(unnamed.text, /error_code|PERMISSION_DENIED/);
  assert.match(unnamed.data.permissions[0].steps.join('\n'), /find the job of run/);
});

test('a Databricks answer other than a refusal on the read says so in plain words, without the API body (REQ-184)', async () => {
  const { runId, before } = await failedLaunch();
  S.state.runViewDenied = { tokens: [S.APP_TOKEN], jobId: '5', status: 404 };
  const again = await S.request('POST', `/api/run/${runId}/again`, { person: ME, body: { session_id: '7200' } });
  assert.equal(again.status, 404, again.text.slice(0, 300));
  assert.equal(again.data.error, `Inspire could not read run ${runId} to run it again: Run ${runId} does not exist.`);
  assert.doesNotMatch(again.text, /error_code|RESOURCE_DOES_NOT_EXIST|request_id/);
  assert.equal(creates().length, before);
});

test('the refusal sentence names the status in plain words for each answer and never carries an API body', () => {
  const { apiRefusalText } = require('../lib/apiRefusal');
  for (const status of [400, 403, 404, 429, 500]) {
    const text = apiRefusalText('read run 9', status);
    assert.match(text, /^Inspire could not read run 9: /);
    assert.doesNotMatch(text, /[{}"]|error_code|PERMISSION_DENIED/);
  }
  assert.match(apiRefusalText('read run 9', 403), /Ask an App manager/);
  assert.match(apiRefusalText('read run 9', 404), /cannot find it\.$/);
  assert.match(apiRefusalText('read run 9', 500), /HTTP 500\. Try again/);
});

test('the refusal carries the platform reason: its message, redacted and capped, never the JSON envelope or request id', () => {
  const { apiRefusalText, platformReasonOf } = require('../lib/apiRefusal');
  const body = JSON.stringify({ error_code: 'INVALID_PARAMETER_VALUE', message: 'Cluster configuration is invalid for this workspace. token=dapi0123456789abcdef0123', request_id: 'req-42' });
  assert.equal(platformReasonOf(body), 'Cluster configuration is invalid for this workspace. token=[redacted]'.replace(/\.$/, ''));
  assert.equal(apiRefusalText('create the job', 400, body), 'Inspire could not create the job: Cluster configuration is invalid for this workspace. token=[redacted].');
  assert.doesNotMatch(apiRefusalText('create the job', 400, body), /error_code|request_id|req-42|\{/);
  assert.equal(platformReasonOf('plain text reason'), 'plain text reason');
  assert.equal(platformReasonOf('{"error_code":"X"}'), '', 'JSON without a message adds no reason');
  assert.equal(platformReasonOf('{not json'), '', 'malformed JSON never reaches the person');
  assert.equal(platformReasonOf('x'.repeat(900)).length, 300, 'the reason is capped');
  const denied = apiRefusalText('read that file', 403, JSON.stringify({ message: 'User does not have READ on the folder.' }));
  assert.equal(denied, 'Inspire could not read that file: User does not have READ on the folder. Your sign-in or the App lacks a permission it needs. Ask an App manager to check the grants, then try again.');
});
