const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { runAsPerson, launchPlanFor } = require('../lib/inspireJobParams');
const { demoPipelineSpec, demoRunParameters } = require('../lib/demoDataPipeline');
const { buildRunAsJobSpecs, OUT } = require('../../scripts/emit-run-as-job-specs');
const { tokenFor } = require('../server');

test('run-as-me is on only when INSPIRE_RUN_AS_PERSON is 1, and off by default', () => {
  assert.equal(runAsPerson({}), false);
  assert.equal(runAsPerson({ INSPIRE_RUN_AS_PERSON: '0' }), false);
  assert.equal(runAsPerson({ INSPIRE_RUN_AS_PERSON: ' 1 ' }), true);
});

test('default mode still creates the job for each launch, as before', () => {
  assert.deepEqual(launchPlanFor({ runAs: false, jobType: 'discovery', env: {} }), { mode: 'create' });
  assert.deepEqual(launchPlanFor({ runAs: false, jobType: 'implement', env: {} }), { mode: 'create' });
});

test('run-as-me starts the installed job of each type with run-now and never plans a create', () => {
  const env = { INSPIRE_JOB_ID_DISCOVER: '71', INSPIRE_JOB_ID_IMPLEMENT: '72', INSPIRE_JOB_ID_GENIE: '73', INSPIRE_JOB_ID_DEMO: '74' };
  assert.deepEqual(launchPlanFor({ runAs: true, jobType: 'discovery', env }), { mode: 'run-now', jobId: '71' });
  assert.deepEqual(launchPlanFor({ runAs: true, jobType: 'implement', env }), { mode: 'run-now', jobId: '72' });
  assert.deepEqual(launchPlanFor({ runAs: true, jobType: 'genie_regen', env }), { mode: 'run-now', jobId: '73' });
  assert.deepEqual(launchPlanFor({ runAs: true, jobType: 'demo_pipeline', env }), { mode: 'run-now', jobId: '74' });
});

test('run-as-me with a missing installed job says to run the installer, and never creates one', () => {
  assert.throws(() => launchPlanFor({ runAs: true, jobType: 'implement', env: {} }),
    (err) => err.statusCode === 500 && err.message.includes('INSPIRE_JOB_ID_IMPLEMENT'));
  assert.throws(() => launchPlanFor({ runAs: true, jobType: 'nope', env: {} }), (err) => err.statusCode === 500);
});

test('the installer spec file is the one the App builds from: a drift is a failing test', () => {
  assert.deepEqual(JSON.parse(fs.readFileSync(OUT, 'utf8')), buildRunAsJobSpecs());
});

test('the demo pipeline per-run payload and the install-time job share one task builder', () => {
  const literal = demoPipelineSpec({ description: 'd', business: 'b', catalog: 'c', inspireDb: 'c.s', sid: '42', demoSchema: 'x',
    warehouse: 'wh', appSp: 'sp', plantKindSignals: 'yes', discovery: 'Standard Discovery', generationPath: '/g' },
  { generateNotebookPath: '/gen', inspireNotebookPath: '/inspire', clusterSpec: {} });
  assert.equal(literal.tasks.length, 2);
  assert.equal(literal.tasks[0].notebook_task.notebook_path, '/gen');
  assert.equal(literal.tasks[1].depends_on[0].task_key, 'generate_demo_data');
  assert.equal(literal.tasks[0].notebook_task.base_parameters.session_id, '42');
});

test('getToken in run-as-me hands a request the forwarded user token, even when App credentials exist', () => {
  const req = { headers: { 'x-forwarded-access-token': 'person-token-abc' } };
  const withSp = { production: true, serviceToken: '', spCredentials: true, spTokenFresh: true, spTokenCached: 'sp-token', runAs: true };
  assert.equal(tokenFor(req, withSp), 'person-token-abc');
});

test('getToken outside run-as-me keeps the App token ahead of the forwarded token, as before', () => {
  const req = { headers: { 'x-forwarded-access-token': 'person-token-abc' } };
  const base = { production: true, serviceToken: '', spCredentials: true, runAs: false };
  assert.equal(tokenFor(req, { ...base, spTokenFresh: true, spTokenCached: 'sp-token' }), 'sp-token');
  assert.equal(tokenFor(req, { ...base, spTokenFresh: false, spTokenCached: 'sp-token-old' }), 'sp-token-old');
  assert.equal(tokenFor(req, { ...base, spTokenFresh: false, spTokenCached: '', serviceToken: 'static-token' }), 'static-token');
});

test('getToken with no App credentials falls back to the forwarded token, and to nothing without one', () => {
  const req = { headers: { 'x-forwarded-access-token': 'person-token-abc' } };
  assert.equal(tokenFor(req, { production: true, serviceToken: '', spCredentials: false, spTokenFresh: false, spTokenCached: '', runAs: false }), 'person-token-abc');
  assert.equal(tokenFor({ headers: {} }, { production: true, serviceToken: '', spCredentials: true, spTokenFresh: false, spTokenCached: '', runAs: false }), null);
});

test('run-as-me: the App has no token of its own for SQL, so an SQL call never gets the App principal', async () => {
  const { appOwnToken } = require('../server');
  const saved = process.env.INSPIRE_RUN_AS_PERSON;
  process.env.INSPIRE_RUN_AS_PERSON = '1';
  try {
    assert.equal(await appOwnToken(), null);
  } finally {
    if (saved === undefined) delete process.env.INSPIRE_RUN_AS_PERSON;
    else process.env.INSPIRE_RUN_AS_PERSON = saved;
  }
});

test('run-as-me: source-access reads use the person\'s forwarded token; default mode keeps refusing a person token as the App', async () => {
  const { createSourceAccess } = require('../lib/sourceAccess');
  const { PERSON_TOKEN } = require('../lib/requestPerson');
  const noApp = async () => null;
  const access = createSourceAccess({ executeSql: async () => [], sqlResultToObjects: () => [], dbFetch: async () => ({}), appToken: noApp });
  const req = { dbHost: 'h', dbToken: 'person-token', dbTokenKind: PERSON_TOKEN };
  const saved = process.env.INSPIRE_RUN_AS_PERSON;
  try {
    process.env.INSPIRE_RUN_AS_PERSON = '1';
    assert.equal(await access.appTokenOf(req), 'person-token');
    delete process.env.INSPIRE_RUN_AS_PERSON;
    assert.equal(await access.appTokenOf(req), '');
  } finally {
    if (saved === undefined) delete process.env.INSPIRE_RUN_AS_PERSON;
    else process.env.INSPIRE_RUN_AS_PERSON = saved;
  }
});

test('static: no SQL call in the backend takes the App\'s own token as its token argument', () => {
  const fs = require('fs');
  const path = require('path');
  const files = ['server.js', 'implementRoutes.js', ...fs.readdirSync(path.join(__dirname, '..', 'lib')).filter((f) => f.endsWith('.js')).map((f) => path.join('lib', f))];
  const offenders = [];
  for (const file of files) {
    const lines = fs.readFileSync(path.join(__dirname, '..', file), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (/(executeSql|launchSql|sqlRows|sqlStatement)\s*\(/.test(line) && /appOwnToken|appToken\(\)|appTokenOf/.test(line)) offenders.push(`${file}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, []);
});

test('run-as-me: the App write check runs with the person\'s token; default mode uses the App token only', async () => {
  const { appWriteTokenOf } = require('../server');
  const req = { dbToken: 'person-token' };
  const saved = process.env.INSPIRE_RUN_AS_PERSON;
  try {
    process.env.INSPIRE_RUN_AS_PERSON = '1';
    assert.equal(await appWriteTokenOf(req), 'person-token');
    delete process.env.INSPIRE_RUN_AS_PERSON;
    assert.equal(await appWriteTokenOf(req), '');
  } finally {
    if (saved === undefined) delete process.env.INSPIRE_RUN_AS_PERSON;
    else process.env.INSPIRE_RUN_AS_PERSON = saved;
  }
});

test('REQ-113: run-as-me with no person token gets no token at all, never the App service principal or the static token', () => {
  const req = { headers: {} };
  const app = { production: true, serviceToken: 'static-token', spCredentials: true, spTokenFresh: true, spTokenCached: 'sp-token', runAs: true };
  assert.equal(tokenFor(req, app), null);
  assert.equal(tokenFor(req, { ...app, serviceToken: '' }), null);
});

test('REQ-113: the demo job runs as the person and passes no App principal in run-as-me, and keeps the App principal in default mode', () => {
  const values = { description: 'd', business: 'b', catalog: 'c', inspireDb: 'c.s', sid: '42', demoSchema: 'x',
    warehouse: 'wh', appSp: '', plantKindSignals: 'yes', discovery: 'Standard Discovery', generationPath: '/g' };
  const runAs = demoPipelineSpec({ ...values, runAs: true }, { generateNotebookPath: '/gen', inspireNotebookPath: '/inspire', clusterSpec: {} });
  assert.equal(runAs.tasks[0].notebook_task.base_parameters.run_as_person, '1');
  assert.equal(runAs.tasks[0].notebook_task.base_parameters.app_sp_application_id, '');
  assert.equal(demoRunParameters({ ...values, runAs: true }).run_as_person, '1');
  const dflt = demoPipelineSpec({ ...values, appSp: 'sp-1' }, { generateNotebookPath: '/gen', inspireNotebookPath: '/inspire', clusterSpec: {} });
  assert.equal(dflt.tasks[0].notebook_task.base_parameters.run_as_person, '');
  assert.equal(dflt.tasks[0].notebook_task.base_parameters.app_sp_application_id, 'sp-1');
});

test('REQ-113: the implement job in run-as-me carries the run-as flag and no App principal, and the flag survives the notebook sanitizer', () => {
  const I = require('../lib/inspireImplement');
  const JP = require('../lib/inspireJobParams');
  const runAs = I.implementJobParams({}, 'N01-U01', 3, '', true);
  assert.equal(runAs.inspire_run_as_person, '1');
  assert.equal(runAs.inspire_app_client_id, '');
  assert.equal(JP.sanitizeInspireNotebookJobParams({ ...runAs }).inspire_run_as_person, '1');
  assert.equal(I.implementJobParams({}, 'N01-U01', 3, 'insp-client-1').inspire_run_as_person, '');
});
