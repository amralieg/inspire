const test = require('node:test');
const assert = require('node:assert/strict');
const { runAsPerson, discoveryLaunchPlan } = require('../lib/inspireJobParams');
const { triggerDemoDataPipeline } = require('../lib/demoDataPipeline');

function withEnv(values, run) {
  const saved = {};
  for (const key of Object.keys(values)) {
    saved[key] = process.env[key];
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
  return Promise.resolve().then(run).finally(() => {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });
}

test('run-as-me is on only when INSPIRE_RUN_AS_PERSON is 1, and off by default', () => {
  assert.equal(runAsPerson({}), false);
  assert.equal(runAsPerson({ INSPIRE_RUN_AS_PERSON: '0' }), false);
  assert.equal(runAsPerson({ INSPIRE_RUN_AS_PERSON: ' 1 ' }), true);
});

test('default mode still creates the job for each launch, as before', () => {
  assert.deepEqual(discoveryLaunchPlan({ runAs: false, jobType: 'discovery', installedJobId: '77' }), { mode: 'create' });
  assert.deepEqual(discoveryLaunchPlan({ runAs: false, jobType: 'implement', installedJobId: '' }), { mode: 'create' });
});

test('run-as-me starts the installed discovery job with run-now and never plans a create', () => {
  assert.deepEqual(discoveryLaunchPlan({ runAs: true, jobType: 'discovery', installedJobId: '77' }), { mode: 'run-now', jobId: '77' });
});

test('run-as-me refuses a per-run job type instead of creating it as the App', () => {
  for (const jobType of ['implement', 'genie_regen']) {
    assert.throws(() => discoveryLaunchPlan({ runAs: true, jobType, installedJobId: '77' }),
      (err) => err.statusCode === 409 && err.message.includes(`the ${jobType} job`));
  }
});

test('run-as-me without an installed discovery job says to run the installer, and never creates one', () => {
  assert.throws(() => discoveryLaunchPlan({ runAs: true, jobType: 'discovery', installedJobId: '  ' }),
    (err) => err.statusCode === 500 && err.message.includes('INSPIRE_JOB_ID_DISCOVER'));
});

test('run-as-me refuses the demo pipeline before any workspace call', async () => {
  const calls = [];
  const dbFetch = async (...args) => { calls.push(args); throw new Error('must not be called'); };
  await withEnv({ INSPIRE_RUN_AS_PERSON: '1' }, async () => {
    await assert.rejects(triggerDemoDataPipeline(dbFetch, () => '', 'https://h', 't', {
      description: 'd', businessName: 'b', inspireDatabase: 'main._inspire', sessionId: '1',
    }), (err) => err.statusCode === 409 && /demo pipeline job is not installed/.test(err.message));
  });
  assert.deepEqual(calls, []);
});

test('getToken hands a request the forwarded user token in run-as-me mode; default mode is unchanged (no App credentials are set in this test, so it returns the forwarded token as before)', async () => {
  const { getToken } = require('../server');
  const req = { headers: { 'x-forwarded-access-token': 'person-token-abc' } };
  await withEnv({ INSPIRE_RUN_AS_PERSON: '1', NODE_ENV: 'production', DATABRICKS_TOKEN: undefined }, () => {
    assert.equal(getToken(req), 'person-token-abc');
  });
  await withEnv({ INSPIRE_RUN_AS_PERSON: undefined, NODE_ENV: 'production', DATABRICKS_TOKEN: undefined }, () => {
    assert.equal(getToken(req), 'person-token-abc');
  });
});
