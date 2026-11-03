const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  INSPIRE_ENVIRONMENT_VERSION, inspireJobEnvironmentChange, inspireJobEnvironments, inspireTaskCompute,
} = require('../lib/inspireJobParams');
const { DEMO_GENERATED_TABLES, DEMO_KIND_SIGNAL_TABLES, triggerDemoDataPipeline } = require('../lib/demoDataPipeline');

const SERVERLESS = { environment_key: 'Default', disable_auto_optimization: true };
const ENVIRONMENTS = [{ environment_key: 'Default', spec: { environment_version: INSPIRE_ENVIRONMENT_VERSION } }];
const BACKEND = path.join(__dirname, '..');

function notebookEnvironmentVersion(text) {
  const meta = JSON.parse(text).metadata['application/vnd.databricks.v1+notebook'];
  return meta.environmentMetadata.environment_version;
}

function fakeFetch(created) {
  return async (host, token, url, opts = {}) => {
    if (url === '/api/2.0/clusters/list') return { ok: true, json: async () => ({ clusters: [] }) };
    if (url === '/api/2.1/jobs/create') {
      created.push(JSON.parse(opts.body));
      return { ok: true, json: async () => ({ job_id: 7 }) };
    }
    if (url === '/api/2.1/jobs/run-now') return { ok: true, json: async () => ({ run_id: 9 }) };
    throw new Error(`unexpected call ${url}`);
  };
}

async function demoRun(clusterId, extra = {}) {
  const created = [];
  const saved = { a: process.env.INSPIRE_CLUSTER_ID, b: process.env.INSPIRE_DEPLOY_CLUSTER_ID };
  delete process.env.INSPIRE_CLUSTER_ID;
  delete process.env.INSPIRE_DEPLOY_CLUSTER_ID;
  try {
    const result = await triggerDemoDataPipeline(fakeFetch(created), () => 'https://h/run', 'https://h', 't', {
      description: 'A retailer with stores and an online shop',
      businessName: 'Acme Retail',
      inspireDatabase: 'main._inspire',
      sessionId: '42',
      cluster_id: clusterId,
      resolveWorkspaceNotebookObjectPath: async (host, token, p) => p,
      ...extra,
    });
    assert.equal(created.length, 1);
    return { payload: created[0], result };
  } finally {
    if (saved.a !== undefined) process.env.INSPIRE_CLUSTER_ID = saved.a;
    if (saved.b !== undefined) process.env.INSPIRE_DEPLOY_CLUSTER_ID = saved.b;
  }
}

async function demoPayload(clusterId) {
  return (await demoRun(clusterId)).payload;
}

test('the demo job plants the kind tables unless the caller switches them off, and reports the tables it writes', async () => {
  const planted = await demoRun('');
  assert.equal(planted.payload.tasks[0].notebook_task.base_parameters.plant_kind_signals, 'yes');
  assert.deepEqual(planted.result.pipeline.demo_tables, { generated: DEMO_GENERATED_TABLES, kind_signal: DEMO_KIND_SIGNAL_TABLES });
  const off = await demoRun('', { plantKindSignals: false });
  assert.equal(off.payload.tasks[0].notebook_task.base_parameters.plant_kind_signals, 'no');
  assert.deepEqual(off.result.pipeline.demo_tables, { generated: DEMO_GENERATED_TABLES, kind_signal: 0 });
});

test('a serverless Inspire task runs once, without the automatic serverless retries', () => {
  for (const none of ['', null, undefined]) {
    assert.deepEqual(inspireTaskCompute(none), SERVERLESS);
  }
});

test('a task on a given cluster keeps that cluster and carries no serverless option', () => {
  const compute = inspireTaskCompute('0101-abc');
  assert.deepEqual(compute, { existing_cluster_id: '0101-abc' });
  assert.equal('disable_auto_optimization' in compute, false);
  assert.equal('environment_key' in compute, false);
});

test('both demo pipeline tasks run once on serverless and use the cluster when one is given', async () => {
  const serverless = await demoPayload('');
  assert.deepEqual(serverless.tasks.map((t) => t.task_key), ['generate_demo_data', 'inspire_discovery']);
  for (const task of serverless.tasks) {
    assert.equal(task.disable_auto_optimization, true, task.task_key);
    assert.equal(task.environment_key, 'Default', task.task_key);
    assert.equal(task.existing_cluster_id, undefined, task.task_key);
  }
  assert.deepEqual(serverless.environments, ENVIRONMENTS);
  const classic = await demoPayload('0101-abc');
  for (const task of classic.tasks) {
    assert.equal(task.existing_cluster_id, '0101-abc', task.task_key);
    assert.equal('disable_auto_optimization' in task, false, task.task_key);
  }
  assert.equal(classic.environments, undefined);
  assert.equal(serverless.tags.dbx_inspire_ai_session, '42');
  assert.equal(serverless.tags.dbx_inspire_ai_session_id, '42');
  assert.equal(serverless.tags.dbx_inspire_ai_run_type, 'demo_pipeline');
  assert.equal(serverless.tags.dbx_inspire_ai_type, 'demo_pipeline');
  assert.equal(serverless.tags.dbx_inspire_ai_business, 'Acme_Retail');
});

test('a serverless job carries the one App environment version, and a job on a given cluster carries none', () => {
  for (const none of ['', null, undefined]) {
    assert.deepEqual(inspireJobEnvironments(none), { environments: ENVIRONMENTS });
  }
  assert.deepEqual(inspireJobEnvironments('0101-abc'), {});
  assert.equal(JSON.stringify(inspireJobEnvironments('')).includes('client'), false, 'the legacy client field is not sent');
});

test('an existing job changes only the version of each environment it has, keeps its keys and dependencies, and names what it was on', () => {
  assert.deepEqual(inspireJobEnvironmentChange({ environments: [{ environment_key: 'Default', spec: { client: '1' } }] }),
    { environments: ENVIRONMENTS, from: '1' });
  const pinned = { environment_key: 'tools', spec: { environment_version: '2', dependencies: ['/Volumes/main/s/v/tool.whl'] } };
  assert.deepEqual(inspireJobEnvironmentChange({ environments: [{ environment_key: 'Default', spec: { client: '1' } }, pinned] }), {
    environments: [ENVIRONMENTS[0], { environment_key: 'tools', spec: { environment_version: INSPIRE_ENVIRONMENT_VERSION, dependencies: ['/Volumes/main/s/v/tool.whl'] } }],
    from: '1, 2',
  });
  assert.equal(inspireJobEnvironmentChange({ environments: ENVIRONMENTS }), null, 'a job already on the App version is left alone');
  const withDependencies = [{ environment_key: 'Default', spec: { environment_version: INSPIRE_ENVIRONMENT_VERSION, dependencies: ['x==1'] } }];
  assert.equal(inspireJobEnvironmentChange({ environments: withDependencies }), null);
  for (const settings of [undefined, null, {}, { environments: [] }, { tasks: [{ existing_cluster_id: '0101-abc' }] }]) {
    assert.equal(inspireJobEnvironmentChange(settings), null, JSON.stringify(settings));
  }
  assert.deepEqual(inspireJobEnvironmentChange({ environments: [{ environment_key: 'Default' }] }), { environments: ENVIRONMENTS, from: 'with no version' });
});

test('the App runs jobs on the serverless environment version the bundled agent notebook is pinned to', () => {
  const bundled = Buffer.from(require('../notebook_bundle.js'), 'base64').toString('utf8');
  assert.equal(notebookEnvironmentVersion(bundled), INSPIRE_ENVIRONMENT_VERSION, 'notebook_bundle.js');
  const notebook = path.join(BACKEND, '..', 'dbx_inspire_ai_agent.ipynb');
  assert.equal(notebookEnvironmentVersion(fs.readFileSync(notebook, 'utf8')), INSPIRE_ENVIRONMENT_VERSION, notebook);
  const other = JSON.stringify({ metadata: { 'application/vnd.databricks.v1+notebook': { environmentMetadata: { environment_version: '3' } } } });
  assert.notEqual(notebookEnvironmentVersion(other), INSPIRE_ENVIRONMENT_VERSION, 'the check tells a different pin apart');
});

test('every job the App creates takes its task compute from inspireTaskCompute and its environment from inspireJobEnvironments', () => {
  const sources = [path.join(BACKEND, 'server.js'), path.join(BACKEND, 'implementRoutes.js')].concat(
    fs.readdirSync(path.join(BACKEND, 'lib')).map((name) => path.join(BACKEND, 'lib', name)),
  );
  const creators = sources.filter((file) => fs.readFileSync(file, 'utf8').includes("'/api/2.1/jobs/create'"));
  assert.deepEqual(creators.map((file) => path.basename(file)).sort(), ['demoDataPipeline.js', 'server.js']);
  for (const file of creators) {
    const source = fs.readFileSync(file, 'utf8');
    assert.match(source, /inspireTaskCompute\((cluster_id|resolvedClusterId)\)/, file);
    assert.match(source, /\.\.\.inspireJobEnvironments\((cluster_id|resolvedClusterId)\)/, file);
    assert.doesNotMatch(source, /\{ environment_key: 'Default' \}/, file);
  }
  const LEGACY = /\bclient:\s*['"`]|\benvironment_version:\s*['"`]|\benvironments:\s*\[/;
  assert.ok(LEGACY.test("spec: { client: '1' }") && LEGACY.test("environments: [{ environment_key: 'Default' }]"), 'the probe catches a job environment written in place');
  const inPlace = sources.filter((file) => path.basename(file) !== 'inspireJobParams.js' && LEGACY.test(fs.readFileSync(file, 'utf8')));
  assert.deepEqual(inPlace, [], 'no launch site writes its own job environment');
  const server = fs.readFileSync(path.join(BACKEND, 'server.js'), 'utf8');
  const start = server.indexOf('async function triggerInspireNotebookJob');
  const create = server.slice(start, server.indexOf("'/api/2.1/jobs/create'", start));
  assert.match(create, /\.\.\.inspireTaskCompute\(cluster_id\)/);
  assert.doesNotMatch(create, /existing_cluster_id/);
  const bundle = fs.readFileSync(path.join(BACKEND, '..', 'databricks.yml'), 'utf8');
  assert.match(bundle, /- task_key: inspire_notebook\n(?: {10}.*\n)*? {10}disable_auto_optimization: true\n/);
});
