// c37 (REQ-582, REQ-583 U8 v2): the App labels the scope top-down before a Let Inspire Decides run: catalogs dev|prod, then schemas
// of prod catalogs, then tables of prod schemas (`<n>|<p|d>|<t|m|r|x>`), with the cheapest gateway Claude model, 300 tables a call,
// at most 16 calls at once, and writes <inspire_db>.__inspire_table_labels before the run is submitted.
// Must-fail: backend/lib/appTableLabels.js does not exist before c37. Must-keep: a model error never blocks a launch (the rows are
// left out and the agent classifies them), dev scopes are never listed, and what the user named is never labelled dev (user input wins).
const test = require('node:test');
const assert = require('node:assert/strict');

const L = require('../lib/appTableLabels');

const col = (i) => ({ name: `c${i}`, type: 'string' });
const table = (fqn, n = 3, comment = '') => ({ fqn, comment, columns: Array.from({ length: n }, (_, i) => col(i)) });

test('the cheapest gateway Claude model is chosen from the listed models, newest of the cheapest family', () => {
  assert.equal(L.pickLabelModel(['system.ai.claude-opus-4-1', 'system.ai.claude-sonnet-4-6', 'system.ai.claude-haiku-4-5', 'system.ai.claude-haiku-3-5']), 'system.ai.claude-haiku-4-5');
  assert.equal(L.pickLabelModel(['system.ai.claude-sonnet-4-6', 'system.ai.claude-opus-4-1']), 'system.ai.claude-sonnet-4-6');
  assert.equal(L.pickLabelModel(['system.ai.gpt-5', 'system.ai.llama-4']), null, 'no Claude model: no labels, the agent classifies');
});

test('the table prompt numbers every table, caps columns at 40, is industry-agnostic and says the user input wins', () => {
  const p = L.tablePrompt([table('main.sales.orders', 45, 'one row per order'), table('main.sales.status_codes', 2)]);
  assert.match(p, /^1\. main\.sales\.orders \| comment: one row per order \| columns \(45\): c0 string, .*c39 string \+5 more$/m);
  assert.doesNotMatch(p, /c40 string/);
  assert.match(p, /^2\. main\.sales\.status_codes \| columns \(2\): c0 string, c1 string$/m);
  assert.match(p, /<number>\|<p\|d>\|<t\|m\|r\|x>/);
  assert.match(p, /industry-agnostic/i);
  assert.match(p, /user's explicit input wins/i);
});

test('table replies parse env then role; junk, out-of-range and repeated lines are ignored; a missing line stays unlabelled', () => {
  const batch = [table('a.s.t1'), table('a.s.t2'), table('a.s.t3')];
  const got = L.parseTables('1|p|t\n 2 | D | M \n2|p|r\n9|p|t\nnoise\n', batch);
  assert.deepEqual(got, {
    'a.s.t1': { env: 'prod', label: 'transactional' },
    'a.s.t2': { env: 'dev', label: 'master' },
  });
  assert.deepEqual(L.parseTables('1|p|x', batch)['a.s.t1'], { env: 'prod', label: 'technical' });
  assert.deepEqual(L.parseEnv('1|d\n2|p\n3|q', ['dev_cat', 'main', 'x']), { dev_cat: 'dev', main: 'prod' });
});

function fakeScope() {
  const listed = { schemas: [], tables: [] };
  const scope = {
    catalogs: [{ name: 'main', comment: '' }, { name: 'sandbox_dev', comment: 'developer playground' }],
    schemasOf: async (cat) => { listed.schemas.push(cat); return cat === 'main' ? [{ name: 'sales' }, { name: 'scratch' }] : [{ name: 'x' }]; },
    tablesOf: async (cat, sch) => {
      listed.tables.push(`${cat}.${sch}`);
      return sch === 'sales' ? Array.from({ length: 650 }, (_, i) => table(`${cat}.${sch}.t${i}`)) : [table(`${cat}.${sch}.tmp`)];
    },
  };
  return { scope, listed };
}

// A model that answers env for catalogs/schemas by name and labels every table prod transactional, counting parallel calls.
function fakeModel({ failTableCall = -1 } = {}) {
  const seen = { calls: 0, tableCalls: 0, inFlight: 0, maxInFlight: 0, sizes: [] };
  const callModel = async ({ model, prompt }) => {
    assert.equal(model, 'system.ai.claude-haiku-4-5');
    seen.calls += 1; seen.inFlight += 1; seen.maxInFlight = Math.max(seen.maxInFlight, seen.inFlight);
    await new Promise((r) => setTimeout(r, 5));
    seen.inFlight -= 1;
    const lines = [...prompt.matchAll(/^(\d+)\. (\S+)/gm)];
    if (/<p\|d>\|<t\|m\|r\|x>/.test(prompt)) {
      const k = seen.tableCalls++;
      seen.sizes.push(lines.length);
      if (k === failTableCall) throw new Error('gateway 503');
      return lines.map(([, n]) => `${n}|p|t`).join('\n');
    }
    return lines.map(([, n, name]) => `${n}|${/dev|scratch/.test(name) ? 'd' : 'p'}`).join('\n');
  };
  return { callModel, seen };
}

test('labelling runs top-down: dev catalogs and dev schemas are never listed, tables go 300 a call, at most 16 calls at once', async () => {
  const { scope, listed } = fakeScope();
  const { callModel, seen } = fakeModel();
  const out = await L.labelScope({ ...scope, userNamed: {}, model: 'system.ai.claude-haiku-4-5', callModel });
  assert.deepEqual(listed.schemas, ['main'], 'a dev catalog is never listed');
  assert.deepEqual(listed.tables, ['main.sales'], 'a dev schema is never listed');
  assert.deepEqual(seen.sizes.sort((a, b) => b - a), [300, 300, 50]);
  assert.ok(seen.maxInFlight <= 16);
  const by = (lvl) => out.rows.filter((r) => r.level === lvl);
  assert.deepEqual(by('catalog').map((r) => [r.object_fqn, r.env, r.label]), [['main', 'prod', null], ['sandbox_dev', 'dev', null]]);
  assert.deepEqual(by('schema').map((r) => [r.object_fqn, r.env]), [['main.sales', 'prod'], ['main.scratch', 'dev']]);
  assert.equal(by('table').length, 650);
  assert.ok(by('table').every((r) => r.env === 'prod' && r.label === 'transactional' && r.source === 'app:system.ai.claude-haiku-4-5'));
});

test('must-keep: a failed table call leaves only its tables unlabelled and never throws', async () => {
  const { scope } = fakeScope();
  const { callModel } = fakeModel({ failTableCall: 0 });
  const out = await L.labelScope({ ...scope, userNamed: {}, model: 'system.ai.claude-haiku-4-5', callModel });
  assert.equal(out.rows.filter((r) => r.level === 'table').length, 350);
  assert.equal(out.errors.length, 1);
  assert.match(out.errors[0], /gateway 503/);
});

test('must-keep (user input wins): a catalog or schema the user named is prod, written as the user\'s, and never sent to the model', async () => {
  const { scope, listed } = fakeScope();
  const { callModel, seen } = fakeModel();
  const out = await L.labelScope({ ...scope, userNamed: { catalogs: ['sandbox_dev'], schemas: ['main.scratch'] }, model: 'system.ai.claude-haiku-4-5', callModel });
  const cat = out.rows.find((r) => r.level === 'catalog' && r.object_fqn === 'sandbox_dev');
  assert.deepEqual([cat.env, cat.source], ['prod', 'user']);
  const sch = out.rows.find((r) => r.level === 'schema' && r.object_fqn === 'main.scratch');
  assert.deepEqual([sch.env, sch.source], ['prod', 'user']);
  assert.ok(listed.schemas.includes('sandbox_dev') && listed.tables.includes('main.scratch'));
  assert.ok(seen.calls > 0);
});

test('the labels table has the U8 v2 columns and every insert binds session_id as BIGINT with parameters', () => {
  const rows = [
    { level: 'catalog', object_fqn: 'main', env: 'prod', label: null, confidence: null, source: 'app:m' },
    { level: 'table', object_fqn: "main.s.o'rders", env: 'prod', label: 'master', confidence: null, source: 'app:m' },
  ];
  const stmts = L.labelsTableStatements('main.inspire', '42', rows);
  assert.match(stmts[0].sql, /CREATE TABLE IF NOT EXISTS main\.inspire\.__inspire_table_labels \(\s*session_id BIGINT,\s*level STRING,\s*object_fqn STRING,\s*env STRING,\s*label STRING,\s*confidence DOUBLE,\s*source STRING,\s*labelled_at TIMESTAMP\s*\)/);
  const inserts = stmts.slice(1);
  assert.ok(inserts.length >= 1);
  for (const s of inserts) {
    assert.match(s.sql, /INSERT INTO main\.inspire\.__inspire_table_labels/);
    assert.match(s.sql, /CAST\(:session_id AS BIGINT\)/);
    assert.doesNotMatch(s.sql, /o'rders|'42'/, 'values are bound, never inlined');
  }
  assert.throws(() => L.labelsTableStatements('main.inspire', '42; DROP', rows), /numeric Inspire session id/);
  assert.throws(() => L.labelsTableStatements('bad name', '42', rows), /catalog\.schema/);
});
