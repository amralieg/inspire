// REQ-578: the per-use-case Genie code notebook is an Implement output ("notebook"), not a Generate Use Cases run.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, listen } = require('./support/implementApp');
const labels = require('../lib/implementOutputLabels.json');

async function call(base, path, opts = {}) {
  const resp = await fetch(base + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: resp.status, data: await resp.json() };
}

const GENERATE = { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42', use_case_ids: ['N01-U01'], notebook_path: '/Shared/nb' };

test('the output label table names the notebook output', () => {
  assert.equal(labels.notebook, 'Notebook');
});

test('a notebook request launches an Implement version with outputs.notebook, never Generate Use Cases', async () => {
  const { app, jobs, sqlCalls, flagged } = makeApp();
  const srv = await listen(app);
  try {
    const got = await call(srv.url, '/api/inspire/generate-genie', { method: 'POST', body: GENERATE });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].jobType, 'implement');
    assert.equal(jobs[0].params['15_operation'], 'Implement Use Cases');
    assert.equal(jobs[0].params.inspire_implement_use_case, 'N01-U01');
    assert.ok(!JSON.stringify(jobs[0].params).includes('Generate Use Cases'));
    assert.deepEqual(flagged, [], 'no genie flag is set on the tracking table');
    const insert = sqlCalls.find((c) => String(c.sql).includes('INSERT INTO'));
    assert.ok(insert, 'a spec version row is written');
    const spec = JSON.parse(insert.parameters.find((p) => p.name === 'spec').value);
    assert.equal(spec.outputs.notebook, true);
    for (const name of ['dashboard', 'genie_space', 'app', 'alert']) assert.equal(spec.outputs[name], false, `${name} is not built`);
  } finally {
    await srv.close();
  }
});
