const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const GC = require('../lib/genieCodeCheck');
const { makeApp, listen } = require('./support/implementApp');

const CODEX = '/ai-gateway/codex/v1';
const MLFLOW = '/ai-gateway/mlflow/v1';

function gateway({ codex = [], claude = [], answers = {}, listStatus = 200, throws = {} } = {}) {
  const calls = [];
  const fetchJson = async (p, opts = {}) => {
    const method = opts.method || 'GET';
    const model = opts.body ? JSON.parse(opts.body).model : '';
    calls.push([method, p, model]);
    if (throws[`${p}|${model}`]) throw new Error(throws[`${p}|${model}`]);
    if (method === 'GET') {
      if (listStatus !== 200) return { ok: false, status: listStatus, data: { message: 'Not Found' } };
      return p.includes('/anthropic/') ? { ok: true, status: 200, data: { object: 'list', data: claude.map((id) => ({ id })) } }
        : { ok: true, status: 200, data: { models: codex.map((slug) => ({ slug })) } };
    }
    const status = answers[`${p}|${model}`] ?? 404;
    return status === 200 ? { ok: true, status, data: { object: 'response' } }
      : { ok: false, status, data: { error_code: status === 403 ? 'PERMISSION_DENIED' : status === 404 ? 'RESOURCE_DOES_NOT_EXIST' : 'TEMPORARILY_UNAVAILABLE', message: `HTTP ${status} from the gateway` } };
  };
  return { calls, fetchJson, probes: () => calls.filter(([m]) => m === 'POST').map(([, p, model]) => `${p}|${model}`) };
}

test('the Codex route wins when its first model answers, and the Anthropic route is never asked', async () => {
  const gw = gateway({ codex: ['system.ai.kimi-k3'], answers: { [`${CODEX}/responses|gpt-5.6-sol`]: 200 } });
  const verdict = await GC.createGenieCodeCheck()('https://h', 't', gw.fetchJson);
  assert.deepEqual(verdict, { available: true, route: 'Codex route', model: 'gpt-5.6-sol', reason: '', fix: '' });
  assert.deepEqual(gw.probes(), [`${CODEX}/responses|gpt-5.6-sol`]);
  assert.ok(!gw.calls.some(([, p]) => p.includes('/anthropic/')));
});

test('an empty Codex list falls through to the newest Claude Sonnet or Opus the Anthropic route lists, called through MLflow', async () => {
  const gw = gateway({
    claude: ['system.ai.claude-haiku-4-5', 'system.ai.claude-sonnet-4-5', 'system.ai.claude-opus-4-7', 'system.ai.claude-sonnet-4-6'],
    answers: { [`${MLFLOW}/responses|system.ai.claude-sonnet-4-6`]: 200 },
  });
  const verdict = await GC.createGenieCodeCheck()('https://h', 't', gw.fetchJson);
  assert.deepEqual([verdict.available, verdict.route, verdict.model], [true, 'Anthropic route', 'system.ai.claude-sonnet-4-6']);
  assert.deepEqual(gw.probes(), [`${CODEX}/responses|gpt-5.6-sol`, `${MLFLOW}/responses|system.ai.claude-opus-4-7`,
    `${MLFLOW}/responses|system.ai.claude-sonnet-4-6`], 'the hardcoded Codex model is only probed, Claude goes newest first');
});

test('gpt-oss models are never probed or chosen on either route, even when they are the only ones listed', async () => {
  const oss = ['system.ai.gpt-oss-120b', 'databricks-gpt-oss-20b', 'GPT_OSS_large'];
  const gw = gateway({ codex: oss, claude: [...oss, 'system.ai.claude-sonnet-4-6'],
    answers: Object.fromEntries([CODEX, MLFLOW].flatMap((b) => oss.map((m) => [`${b}/responses|${m}`, 200]))) });
  const verdict = await GC.createGenieCodeCheck()('https://h', 't', gw.fetchJson);
  assert.deepEqual(gw.probes(), [`${CODEX}/responses|gpt-5.6-sol`, `${MLFLOW}/responses|system.ai.claude-sonnet-4-6`]);
  assert.equal(verdict.available, false);
  const only = gateway({ codex: oss, claude: oss, answers: Object.fromEntries(oss.map((m) => [`${MLFLOW}/responses|${m}`, 200])) });
  const none = await GC.createGenieCodeCheck()('https://h', 't', only.fetchJson);
  assert.equal(none.available, false);
  assert.ok(!only.probes().some((p) => /oss/i.test(p)));
  const ok = gateway({ codex: ['system.ai.kimi-k3'], answers: { [`${CODEX}/responses|system.ai.kimi-k3`]: 200 } });
  assert.equal((await GC.createGenieCodeCheck()('https://h', 't', ok.fetchJson)).model, 'system.ai.kimi-k3', 'other listed models still qualify');
});

test('with both routes empty or refusing, the check names every model tried and the admin fix, and offers I will build it myself', async () => {
  const gw = gateway({ claude: ['system.ai.claude-opus-4-7'], answers: { [`${MLFLOW}/responses|system.ai.claude-opus-4-7`]: 403 } });
  const verdict = await GC.createGenieCodeCheck()('https://h', 't', gw.fetchJson);
  assert.equal(verdict.available, false);
  assert.equal(verdict.reason, GC.GENIE_CODE_NO_MODEL
    .replace('{tried}', `2 models: gpt-5.6-sol through the Codex route: ${GC.GENIE_CODE_MODEL_MISSING}; `
      + `system.ai.claude-opus-4-7 through the Anthropic route: ${GC.GENIE_CODE_MODEL_DENIED}; the Codex route lists no model`)
    .replace('{choices}', GC.GENIE_CODE_NO_MODEL_CHOICES));
  assert.match(verdict.reason, /choose I will build it myself and run the notebook yourself/);
  assert.match(verdict.fix, /^Ask a workspace admin to serve a model to Genie Code through Unity Gateway/);
  assert.doesNotMatch(`${verdict.reason} ${verdict.fix}`, /contact|ticket|support/i);
  const none = await GC.createGenieCodeCheck()('https://h', 't', gateway({ listStatus: 404 }).fetchJson);
  assert.match(none.reason, /the Codex route and the Anthropic route list no model/);
});

test('a busy or unreachable gateway is not a verdict: it never blocks the build', async () => {
  const busy = gateway({ answers: { [`${CODEX}/responses|gpt-5.6-sol`]: 503 } });
  const verdict = await GC.createGenieCodeCheck()('https://h', 't', busy.fetchJson);
  assert.deepEqual([verdict.available, verdict.reason], [null, GC.GENIE_CODE_UNCHECKED]);
  const thrown = gateway({ throws: { [`${CODEX}/responses|gpt-5.6-sol`]: 'The operation was aborted due to timeout' } });
  assert.equal((await GC.createGenieCodeCheck()('https://h', 't', thrown.fetchJson)).available, null);
  assert.deepEqual(GC.genieCodeLine(verdict), { ok: true, detail: GC.GENIE_CODE_UNCHECKED, unchecked: true });
});

test('the check stops at its deadline instead of probing every listed model', async () => {
  let clock = 0;
  const gw = gateway({ codex: ['a', 'b'] });
  const slow = async (p, opts) => { clock += 9000; return gw.fetchJson(p, opts); };
  const verdict = await GC.createGenieCodeCheck({ now: () => clock })('https://h', 't', slow);
  assert.equal(verdict.available, null);
  assert.ok(gw.probes().length <= 1, gw.probes().join(', '));
});

test('a route that answered is reused for a while; a failed check is asked again next time', async () => {
  let clock = 0;
  const check = GC.createGenieCodeCheck({ now: () => clock });
  const ok = gateway({ answers: { [`${CODEX}/responses|gpt-5.6-sol`]: 200 } });
  await check('https://h', 't', ok.fetchJson);
  await check('https://h', 't', ok.fetchJson);
  assert.equal(ok.probes().length, 1, 'the second wizard open reuses the answer');
  await check('https://h', 'other-token', ok.fetchJson);
  assert.equal(ok.probes().length, 2, 'another identity is checked on its own');
  clock += 11 * 60 * 1000;
  await check('https://h', 't', ok.fetchJson);
  assert.equal(ok.probes().length, 3, 'the answer expires');
  const refused = gateway();
  const first = await check('https://h2', 't', refused.fetchJson);
  const second = await check('https://h2', 't', refused.fetchJson);
  assert.equal(first.available, false);
  assert.equal(second.available, false);
  assert.equal(refused.probes().length, 2, 'a failure is never cached');
});

test('the listing parser reads both the Codex slugs and the Anthropic ids', () => {
  assert.deepEqual(GC.listedModels({ models: [{ slug: 'a' }, { slug: ' ' }] }), ['a']);
  assert.deepEqual(GC.listedModels({ object: 'list', data: [{ id: 'b', type: 'model' }, { id: 'b' }] }), ['b']);
  assert.deepEqual(GC.listedModels(null), []);
});

test('only a build that runs Genie needs Genie Code: an uninstall or a rollback does not', () => {
  assert.equal(GC.needsGenieCode({ outputs: { dashboard: true } }), true);
  assert.equal(GC.needsGenieCode({ uninstall: true }), false);
  assert.equal(GC.needsGenieCode({ rollback_outputs: { dashboard: 2 } }), false);
  assert.equal(GC.needsGenieCode({ rollback_outputs: {} }), true);
});

test('the backend check and the agent build share their paths, first model, probe and words', () => {
  const notebook = path.resolve(__dirname, '..', '..', 'agent', 'agent', 'dbx_inspire_ai_agent.ipynb');
  const names = ['UNITY_GATEWAY_CODEX_PATH', 'UNITY_GATEWAY_ANTHROPIC_PATH', 'UNITY_GATEWAY_MLFLOW_PATH', 'GENIE_CODE_MODEL',
    'GENIE_CODE_MODEL_CHECK', 'GENIE_CODE_NO_MODEL', 'GENIE_CODE_ADMIN_FIX', 'GENIE_CODE_NO_MODEL_CHOICES', 'GENIE_CODE_MODEL_MISSING',
    'GENIE_CODE_MODEL_DENIED', 'GENIE_CODE_UNFIT_MODEL_PATTERN', 'GENIE_CODE_GATEWAYS'];
  const script = `
import ast, json, sys
source = "".join(json.load(open(sys.argv[1]))["cells"][1]["source"])
names = json.loads(sys.argv[2])
ns = {}
for node in ast.parse(source).body:
    if isinstance(node, ast.Assign) and len(node.targets) == 1 and getattr(node.targets[0], "id", "") in names:
        exec(compile(ast.Module([node], []), "cell", "exec"), ns)
print(json.dumps({name: ns[name] for name in names}))
`;
  const agent = JSON.parse(execFileSync('python3', ['-c', script, notebook, JSON.stringify(names)], { encoding: 'utf8' }));
  for (const name of names.filter((n) => n !== 'GENIE_CODE_GATEWAYS')) assert.deepEqual(GC[name], agent[name], name);
  assert.deepEqual(GC.GENIE_CODE_GATEWAYS.map(({ route, models, base, first }) => ({ route, models, base, first })),
    agent.GENIE_CODE_GATEWAYS.map(({ route, models, base, first }) => ({ route, models, base, first })));
});

async function withApp(overrides, run) {
  const made = makeApp(overrides);
  const srv = await listen(made.app);
  try {
    await run(srv.url, made);
  } finally {
    await srv.close();
  }
}

async function call(base, p, opts = {}) {
  const resp = await fetch(base + p, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: resp.status, data: await resp.json() };
}

const Q = 'inspire_database=main.inspire&warehouse_id=wh1&session_id=42&use_case_id=N01-U01';
const NO_GENIE = { gateway: { answer: () => [{ error_code: 'RESOURCE_DOES_NOT_EXIST', message: 'no such model' }, 404] } };
const SPEC = { use_case_id: 'N01-U01', use_case_name: 'Predict churn', config: { warehouse_id: 'wh1', result_table: 'main.inspire.churn_out' }, outputs: { dashboard: true } };

test('the wizard context and the preflight carry the Genie Code verdict, and a missing route fails the preflight', async () => {
  await withApp(NO_GENIE, async (url) => {
    const context = await call(url, `/api/inspire/implement/context?${Q}`);
    assert.equal(context.status, 200, JSON.stringify(context.data));
    assert.equal(context.data.features.genie_code.available, false);
    const pre = await call(url, `/api/inspire/implement/preflight?${Q}&result_table=main.inspire.churn_out`);
    assert.equal(pre.status, 200, JSON.stringify(pre.data));
    assert.equal(pre.data.checks.genie_code.ok, false);
    assert.match(pre.data.checks.genie_code.detail, /^Genie Code is not available in this workspace/);
    assert.equal(pre.data.ok, false);
  });
  await withApp({}, async (url) => {
    const pre = await call(url, `/api/inspire/implement/preflight?${Q}&result_table=main.inspire.churn_out`);
    assert.deepEqual(pre.data.checks.genie_code, { ok: true, detail: 'Genie Code builds with gpt-5.6-sol through the Codex route' });
  });
});

test('submit refuses a build Genie Code cannot run before it writes or launches anything, and lets it through once a route answers', async () => {
  await withApp(NO_GENIE, async (url, made) => {
    const got = await call(url, '/api/inspire/implement/submit', {
      method: 'POST', body: { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42', spec: SPEC },
    });
    assert.equal(got.status, 409, JSON.stringify(got.data));
    assert.match(got.data.error, /^Genie Code is not available in this workspace/);
    assert.equal(got.data.genie_code.available, false);
    assert.equal(made.jobs.length, 0);
    assert.ok(!made.sqlCalls.some((c) => String(c.sql).includes('INSERT INTO')));
  });
  await withApp({}, async (url, made) => {
    const got = await call(url, '/api/inspire/implement/submit', {
      method: 'POST', body: { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42', spec: SPEC },
    });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(made.jobs.length, 1);
  });
});
