// SEC-02 (F6 class, REQ-518): GET /api/run/:runId answers a run's state and its failed tasks' error text, which can quote the data the run
// read. It goes through the same session check as the run output: a person who may not see the session gets 403 and no runs/get call.
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('./support/sec02World');

const { S } = W;
test.after(() => S.stopServer());

test('run status of a hidden session is refused with 403 before any runs/get call', async () => {
  await W.seed();
  const got = await S.request('GET', '/api/run/777', { person: W.READER });
  assert.equal(got.status, 403, `/api/run/777 answers ${got.status} to ${W.READER}, who may not see session ${W.SECRET}: ${got.text.slice(0, 240)}`);
  assert.equal(got.data && got.data.request, 'person', `the refusal is the person's Request for Access: ${got.text.slice(0, 240)}`);
  const reads = S.state.calls.filter((c) => c.path === '/api/2.1/jobs/runs/get');
  assert.equal(reads.length, 0, `the run was read before (or without) the session check: ${W.describe(reads)}`);
});

test('control: the launcher reads the status of their own run', async () => {
  await W.seed();
  const got = await S.request('GET', '/api/run/777', { person: W.LAUNCHER });
  assert.notEqual(got.status, 403, `the launcher is refused their own run: ${got.text.slice(0, 240)}`);
});
