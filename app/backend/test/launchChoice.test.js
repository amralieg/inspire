const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./support/serverApp');
const LC = require('../lib/launchChoice');

test.after(() => S.stopServer());

const OWN = '/Shared/inspire-test-app/dbx_inspire_ai_agent';
const PLANTED = '/Shared/planted/dbx_inspire_ai_agent';
const BOSS = 'boss@example.com';
const body = (extra = {}, params = {}) => ({ params: { '00_business_name': 'Acme', '02_inspire_database': S.APP_DB, '14_session_id': '7001', ...params }, ...extra });
const task = () => (S.state.createdJob && S.state.createdJob.tasks && S.state.createdJob.tasks[0]) || null;
const submitted = () => S.state.calls.filter((c) => c.path.startsWith('/api/2.1/jobs/'));

test('a person who is not an App manager cannot make the App run a notebook they planted, or run on a cluster they picked', async () => {
  S.reset({ notebookPresent: true });
  const got = await S.request('POST', '/api/run', { body: body({ notebook_path: PLANTED, cluster_id: '0101-planted' }) });
  assert.equal(got.status, 200, got.text);
  assert.equal(task().notebook_task.notebook_path, OWN, 'the job runs the App notebook, never the planted one (must-exclude)');
  assert.equal(task().existing_cluster_id, undefined, 'the job never runs on the cluster the person picked (must-exclude)');
  assert.ok(task().environment_key, 'the job runs on serverless');
  assert.ok(got.data.warnings.some((w) => w.includes(`not ${PLANTED}`) && w.includes('only an App manager')), got.text);
  assert.ok(got.data.warnings.some((w) => w.includes('not cluster 0101-planted')), got.text);
});

test('the App notebook, under either path form, and the configured cluster run as asked, with no warning', async () => {
  for (const asked of [OWN, `/Workspace${OWN}`, '']) {
    S.reset({ notebookPresent: true });
    const got = await S.request('POST', '/api/run', { body: body({ notebook_path: asked }) });
    assert.equal(got.status, 200, got.text);
    assert.equal(task().notebook_task.notebook_path.replace(/^\/Workspace/, ''), OWN, asked);
    assert.equal((got.data.warnings || []).filter((w) => w.includes('only an App manager')).length, 0, asked);
  }
});

test('an App manager may run another notebook and pick a cluster', async () => {
  S.reset({ notebookPresent: true, managers: [BOSS] });
  const got = await S.request('POST', '/api/run', { person: BOSS, body: body({ notebook_path: PLANTED, cluster_id: '0101-chosen' }) });
  assert.equal(got.status, 200, got.text);
  assert.equal(task().notebook_task.notebook_path, PLANTED);
  assert.equal(task().existing_cluster_id, '0101-chosen');
});

test('Genie Code regeneration and a build use the same rule, so no route lets a person run a planted notebook as the App', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const sources = ['server.js', 'implementRoutes.js'].map((f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')).join('\n');
  const calls = [...sources.matchAll(/await triggerInspireNotebookJob\([^)]*?\{([\s\S]*?)\}\);/g)].map((m) => m[1]);
  assert.equal(calls.length, 4, 'discover, Genie Code, build and document rebuilds launch notebook jobs');
  for (const call of calls) assert.match(call, /asker: req/, call);
});

test('launch refuses a build or an operation it does not start, so the Build page owner check cannot be skipped', async () => {
  for (const [label, params, says] of [
    ['an implement operation', { '15_operation': 'Implement Use Case' }, 'starts from the Build page'],
    ['a build use case id', { inspire_implement_use_case: 'N01-U01', inspire_implement_spec_version: '3' }, 'takes no inspire_implement_use_case, inspire_implement_spec_version'],
  ]) {
    S.reset({ notebookPresent: true });
    const got = await S.request('POST', '/api/run', { body: body({}, params) });
    assert.equal(got.status, 403, `${label}: ${got.text}`);
    assert.ok(got.data.error.includes(says), `${label}: ${got.data.error}`);
    assert.deepEqual(submitted(), [], label);
  }
  S.reset({ notebookPresent: true });
  assert.equal((await S.request('POST', '/api/run', { body: body({}, { '15_operation': 'Discover Use Cases' }) })).status, 200);
});

test('a person cannot run Discover or Generate on a session somebody else launched, while its launcher and an App manager can', async () => {
  const seed = { notebookPresent: true, managers: [BOSS], knownSessions: ['7001'], ledgerSessions: ['7001'], sessionLaunchers: { 7001: 'owner@example.com' } };
  for (const operation of ['Discover Use Cases', 'Generate Use Cases']) {
    S.reset(seed);
    const got = await S.request('POST', '/api/run', { person: 'taker@example.com', body: body({}, { '15_operation': operation }) });
    assert.equal(got.status, 403, `${operation}: ${got.text}`);
    assert.ok(got.data.error.includes('Session 7001 already exists and owner@example.com launched it'), got.data.error);
    assert.deepEqual(submitted(), [], operation);
  }
  for (const person of ['OWNER@example.com', BOSS]) {
    S.reset(seed);
    const got = await S.request('POST', '/api/run', { person, body: body({}, { '15_operation': 'Generate Use Cases' }) });
    assert.equal(got.status, 200, `${person}: ${got.text}`);
  }
  S.reset({ notebookPresent: true, knownSessions: ['7001'] });
  const orphan = await S.request('POST', '/api/run', { person: 'taker@example.com', body: body() });
  assert.equal(orphan.status, 403, orphan.text);
  assert.ok(orphan.data.error.includes('Inspire has no record of who launched it'), orphan.data.error);
});

test('the launch rules decide the same way in isolation', () => {
  assert.deepEqual(LC.ownLaunch({ notebookPath: '/Workspace/Shared/x/nb', clusterId: '' }, { notebooks: ['/Shared/x/nb'] }).warnings, []);
  assert.equal(LC.ownLaunch({ notebookPath: '/Shared/x/../y/nb' }, { notebooks: ['/Shared/x/nb'] }).notebookPath, '', 'a dot-dot path is not the App notebook (must-exclude)');
  assert.equal(LC.ownLaunch({ clusterId: 'c1' }, { clusters: ['c1'] }).clusterId, 'c1');
  assert.equal(LC.ownLaunch({ clusterId: 'c2' }, { clusters: ['c1', ''] }).clusterId, '');
  assert.equal(LC.ownLaunch({ clusterId: 'c2' }, { clusters: [undefined] }).clusterId, '', 'no configured cluster admits none (must-exclude)');
  assert.equal(LC.launchParamsProblem({ '15_operation': 'Generate Use Cases' }), '');
  assert.equal(LC.sessionLaunchProblem('1', { fresh: false, launcher: 'a@b.c', person: 'A@B.C', manager: false }), '');
  assert.notEqual(LC.sessionLaunchProblem('1', { fresh: false, launcher: '', person: 'a@b.c', manager: false }), '');
});
