const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./support/serverApp');

test.after(() => S.stopServer());

const PERSON = 'launcher@example.com';
const launch = async (runId) => {
  S.state.nextRunId = runId;
  const got = await S.request('POST', '/api/run', { person: PERSON, body: { params: { '00_business_name': 'Acme', '02_inspire_database': S.APP_DB, '14_session_id': `9${runId}`, '15_operation': 'Discover Use Cases' } } });
  assert.equal(got.status, 200, got.text.slice(0, 300));
};
const task = (runId, resultState) => ({ task_key: 'inspire_notebook', run_id: runId, notebook_task: { notebook_path: '/Shared/x/nb' },
  state: { life_cycle_state: 'TERMINATED', result_state: resultState, state_message: resultState === 'FAILED' ? 'Workload failed, see run output for details' : '' } });

test('a run whose notebook refused its inputs names the reason the notebook gave, without the exception class, so the Monitor never says only that the workload failed', async () => {
  S.reset({ notebookPresent: true, runStates: {}, runOutputs: { 8801: { error: 'ValueError: Validation failed with 1 error:\n\u274c Generation Path is required' } } });
  await launch(801);
  S.state.runStates[801] = { life_cycle_state: 'TERMINATED', result_state: 'FAILED', tasks: [task(8801, 'FAILED')] };
  const got = await S.request('GET', '/api/run/801', { person: PERSON });
  assert.equal(got.status, 200, got.text.slice(0, 300));
  assert.equal(got.data.tasks[0].error, 'Validation failed with 1 error:\n\u274c Generation Path is required');
  assert.equal(got.data.tasks[0].state_message, 'Workload failed, see run output for details');
});

test('a task that succeeded is never asked for its output, and a failed task whose output cannot be read keeps an empty reason (must-exclude)', async () => {
  S.reset({ notebookPresent: true, runStates: {}, runOutputs: {} });
  await launch(802);
  S.state.runStates[802] = { life_cycle_state: 'TERMINATED', result_state: 'SUCCESS', tasks: [task(8802, 'SUCCESS')] };
  const ok = await S.request('GET', '/api/run/802', { person: PERSON });
  assert.equal(ok.status, 200, ok.text.slice(0, 300));
  assert.equal('error' in ok.data.tasks[0], false);
  assert.deepEqual(S.state.calls.filter((c) => c.path === '/api/2.1/jobs/runs/get-output'), []);
  await launch(803);
  S.state.runStates[803] = { life_cycle_state: 'TERMINATED', result_state: 'FAILED', tasks: [task(8803, 'FAILED')] };
  const unread = await S.request('GET', '/api/run/803', { person: PERSON });
  assert.equal(unread.status, 200, unread.text.slice(0, 300));
  assert.equal(unread.data.tasks[0].error, '');
});
