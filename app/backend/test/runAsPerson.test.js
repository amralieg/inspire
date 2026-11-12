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

test('getToken in run-as-me hands a request the forwarded user token, even when App credentials exist', () => {
  const { tokenFor } = require('../server');
  const req = { headers: { 'x-forwarded-access-token': 'person-token-abc' } };
  const withSp = { production: true, serviceToken: '', spCredentials: true, spTokenFresh: true, spTokenCached: 'sp-token', runAs: true };
  assert.equal(tokenFor(req, withSp), 'person-token-abc');
});

test('getToken outside run-as-me keeps the App token ahead of the forwarded token, as before', () => {
  const { tokenFor } = require('../server');
  const req = { headers: { 'x-forwarded-access-token': 'person-token-abc' } };
  const base = { production: true, serviceToken: '', spCredentials: true, runAs: false };
  assert.equal(tokenFor(req, { ...base, spTokenFresh: true, spTokenCached: 'sp-token' }), 'sp-token');
  assert.equal(tokenFor(req, { ...base, spTokenFresh: false, spTokenCached: 'sp-token-old' }), 'sp-token-old');
  assert.equal(tokenFor(req, { ...base, spTokenFresh: false, spTokenCached: '', serviceToken: 'static-token' }), 'static-token');
});

test('getToken with no App credentials falls back to the forwarded token, and to nothing without one', () => {
  const { tokenFor } = require('../server');
  const req = { headers: { 'x-forwarded-access-token': 'person-token-abc' } };
  assert.equal(tokenFor(req, { production: true, serviceToken: '', spCredentials: false, spTokenFresh: false, spTokenCached: '', runAs: false }), 'person-token-abc');
  assert.equal(tokenFor({ headers: {} }, { production: true, serviceToken: '', spCredentials: true, spTokenFresh: false, spTokenCached: '', runAs: false }), null);
});

test('a rerun in run-as-me never changes the installed job settings, and a default rerun still aligns them', async () => {
  const { alignJobSettingsUnlessRunAs } = require('../implementRoutes');
  const calls = [];
  const align = async (host, token, jobId) => { calls.push([host, token, jobId]); return 'aligned'; };
  assert.equal(await alignJobSettingsUnlessRunAs(align, 'h', 't', '77', { INSPIRE_RUN_AS_PERSON: '1' }), '');
  assert.deepEqual(calls, []);
  assert.equal(await alignJobSettingsUnlessRunAs(align, 'h', 't', '77', {}), 'aligned');
  assert.deepEqual(calls, [['h', 't', '77']]);
});
