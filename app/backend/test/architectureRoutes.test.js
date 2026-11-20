const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../lib/routePolicy');
const { makeApp, listen } = require('./support/implementApp');

const ME = ['owner', 'example.com'].join('@');
const Q = 'inspire_database=main.inspire&warehouse_id=wh1&session_id=42&use_case_id=N01-U01';
const TABLE = '`main`.`inspire`.`__inspire_architectures`';
const ENDPOINTS = { endpoints: [{ name: 'team-chat', state: { ready: 'READY' }, task: 'llm/v1/chat' }] };
const reply = (content) => ({ choices: [{ message: { role: 'assistant', content } }] });
const DRAFT = {
  pattern: 'Batch scoring to an operational queue', summary: 'Score nightly, work the queue in an App.',
  components: [{ id: 'lakeflow_jobs', role: 'scores orders nightly' }, { id: 'model_serving', role: 'scores in real time' }, { id: 'unity_catalog', role: 'governs' }],
  flows: [{ from: 'lakeflow_jobs', to: 'model_serving', label: 'features' }],
  cost: { items: [{ id: 'lakeflow_jobs', usd_low: 20, usd_high: 200, basis: 'serverless jobs' }] },
};
const REVISED = { ...DRAFT, components: [{ id: 'lakeflow_jobs', role: 'scores orders nightly' }, { id: 'lakebase', role: 'holds the queue' }, { id: 'unity_catalog', role: 'governs' }],
  flows: [{ from: 'lakeflow_jobs', to: 'lakebase', label: 'scores' }] };
const FIX = [{ rule: 4, issue: 'no decision is needed in seconds', fix: 'score in batch and write to Lakebase' }];

function architectureApp(overrides = {}) {
  const asked = [];
  const saved = [];
  const answers = overrides.answers || [reply(JSON.stringify(DRAFT)), reply(JSON.stringify(FIX)), reply(JSON.stringify(REVISED))];
  const statements = {
    [`FROM ${TABLE} WHERE session_id = :sid`]: () => {
      if (overrides.readError) throw new Error(overrides.readError);
      return { rows: overrides.savedRows || [] };
    },
    [`INSERT INTO ${TABLE}`]: (_sql, parameters, token) => { saved.push({ parameters, token }); return { rows: [] }; },
  };
  const workspace = ({ token, path, method, body }) => {
    if (path === '/api/2.0/serving-endpoints') return [overrides.endpoints || ENDPOINTS];
    if (path.startsWith('/serving-endpoints/')) {
      asked.push({ token, path, method, body });
      if (overrides.invoke) return overrides.invoke(body);
      return [answers[Math.min(asked.length - 1, answers.length - 1)]];
    }
    return undefined;
  };
  const made = makeApp({
    forwardedToken: 'person-token',
    statements,
    workspace,
    useCase: { id: 'N01-U01', use_case: 'Rank open orders for follow-up', statement: 'Staff chase orders nightly', tables_involved: 'main.s.orders' },
    columns: [{ column_name: 'order_id', data_type: 'STRING', ordinal_position: 1 }, { column_name: 'due_date', data_type: 'DATE', ordinal_position: 2 }],
  });
  return { asked, saved, made };
}

async function withApp(overrides, run) {
  const ctx = architectureApp(overrides);
  const srv = await listen(ctx.made.app);
  try {
    await run(srv.url, ctx);
  } finally {
    await srv.close();
  }
}

async function call(base, url, { method = 'GET', body } = {}) {
  const resp = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'x-forwarded-email': ME }, body: body ? JSON.stringify(body) : undefined });
  return { status: resp.status, data: await resp.json() };
}

test('the routes are declared for any tracked person', () => {
  assert.equal(P.ROUTE_POLICY['GET /api/inspire/implement/architecture'].rule, 'any');
  assert.equal(P.ROUTE_POLICY['POST /api/inspire/implement/architecture'].rule, 'any');
});

test('designing drafts, reviews and revises with the person token, grounds the prompt in real columns, and saves the revised design', async () => {
  await withApp({}, async (url, { asked, saved, made }) => {
    const got = await call(url, `/api/inspire/implement/architecture?${Q}`, { method: 'POST', body: {} });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(asked.length, 3, 'architect, reviewer, revise');
    assert.ok(asked.every((a) => a.token === 'person-token' && a.path === '/serving-endpoints/team-chat/invocations'));
    const prompt = asked[0].body.messages[1].content;
    for (const part of ['main.s.orders', 'order_id (STRING)', 'due_date (DATE)', 'Rank open orders for follow-up']) assert.ok(prompt.includes(part), part);
    assert.match(asked[2].body.messages.at(-1).content, /score in batch and write to Lakebase/);
    // The revised design is the one shown and saved, not the draft.
    assert.deepEqual(got.data.design.components.map((c) => c.id), ['lakeflow_jobs', 'lakebase', 'unity_catalog']);
    assert.equal(got.data.design.review_fixes, 1);
    assert.deepEqual(got.data.design.sources, ['main.s.orders']);
    assert.equal(got.data.design.model, 'team-chat');
    assert.equal(saved.length, 1);
    const design = JSON.parse(saved[0].parameters.find((p) => p.name === 'design').value);
    assert.deepEqual(design.components.map((c) => c.id), ['lakeflow_jobs', 'lakebase', 'unity_catalog']);
    assert.deepEqual(saved[0].parameters.filter((p) => p.name !== 'design').map((p) => p.value), ['42', 'N01-U01', 'team-chat', ME]);
    assert.ok(made.sqlCalls.some((c) => c.sql.startsWith(`CREATE TABLE IF NOT EXISTS ${TABLE}`)));
  });
});

test('a review with no fixes keeps the draft and makes no third model call', async () => {
  await withApp({ answers: [reply(JSON.stringify(DRAFT)), reply('[]')] }, async (url, { asked }) => {
    const got = await call(url, `/api/inspire/implement/architecture?${Q}`, { method: 'POST', body: {} });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(asked.length, 2);
    assert.deepEqual(got.data.design.components.map((c) => c.id), ['lakeflow_jobs', 'model_serving', 'unity_catalog']);
  });
});

test('a reply with no design is a 502 and nothing is saved; no ready chat model is a 409 before any model call', async () => {
  await withApp({ answers: [reply('I would use a lakehouse.')] }, async (url, { saved }) => {
    const got = await call(url, `/api/inspire/implement/architecture?${Q}`, { method: 'POST', body: {} });
    assert.equal(got.status, 502);
    assert.match(got.data.error, /did not answer with the design/);
    assert.equal(saved.length, 0);
  });
  await withApp({ endpoints: { endpoints: [{ name: 'embed', state: { ready: 'READY' }, task: 'llm/v1/embeddings' }] } }, async (url, { asked, saved }) => {
    const got = await call(url, `/api/inspire/implement/architecture?${Q}`, { method: 'POST', body: {} });
    assert.equal(got.status, 409);
    assert.equal(asked.length, 0);
    assert.equal(saved.length, 0);
  });
});

test('reading returns no design before the first one, the saved design after, and refuses a bad use case id', async () => {
  await withApp({ readError: '[TABLE_OR_VIEW_NOT_FOUND] The table or view `main`.`inspire`.`__inspire_architectures` cannot be found.' }, async (url) => {
    const got = await call(url, `/api/inspire/implement/architecture?${Q}`);
    assert.deepEqual([got.status, got.data.design], [200, null]);
  });
  const savedRows = [{ design: JSON.stringify(REVISED), model: 'team-chat', created_at: '2026-11-20T10:00:00Z', created_by: ME }];
  await withApp({ savedRows }, async (url) => {
    const got = await call(url, `/api/inspire/implement/architecture?${Q}`);
    assert.equal(got.status, 200);
    assert.deepEqual(got.data.design.components.map((c) => c.id), ['lakeflow_jobs', 'lakebase', 'unity_catalog']);
    assert.equal(got.data.design.created_by, ME);
    const bad = await call(url, `/api/inspire/implement/architecture?${Q.replace('N01-U01', encodeURIComponent("x' OR 1=1"))}`);
    assert.equal(bad.status, 400);
  });
  await withApp({ readError: 'PERMISSION_DENIED: no SELECT' }, async (url) => {
    const got = await call(url, `/api/inspire/implement/architecture?${Q}`);
    assert.notEqual(got.status, 200, 'a real read failure is not reported as "no design yet"');
  });
});

test('a model that accepts only its default temperature is asked again without one; any other refusal is not retried (must-fail)', async () => {
  const refusal = [{ error: { message: "Unsupported value: 'temperature' does not support 0.0 with this model.", param: 'temperature' } }, 400];
  const answers = [reply(JSON.stringify(DRAFT)), reply('[]')];
  await withApp({ invoke: (body) => ('temperature' in body ? refusal : [answers.shift()]) }, async (url, { asked }) => {
    const got = await call(url, `/api/inspire/implement/architecture?${Q}`, { method: 'POST', body: {} });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.deepEqual(asked.map((a) => 'temperature' in a.body), [true, false, true, false], 'each call is refused once, then answered without a temperature');
  });
  await withApp({ invoke: () => [{ error: { message: 'PERMISSION_DENIED: no access to this endpoint' } }, 403] }, async (url, { asked }) => {
    const got = await call(url, `/api/inspire/implement/architecture?${Q}`, { method: 'POST', body: {} });
    assert.equal(got.status, 502);
    assert.equal(asked.length, 1, 'a refusal that is not about temperature is not retried');
  });
});
