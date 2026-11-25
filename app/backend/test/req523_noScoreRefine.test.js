// REQ-523: the score-refine feature is gone end to end. The two routes are not routes, and the SQL binder the value modules use still works.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, listen } = require('./support/implementApp');
const policy = require('../lib/routePolicy');

const BODY = { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42' };

test('REQ-523: POST /api/inspire/score-refine and /undo are not routes', async () => {
  const srv = await listen(makeApp({ forwardedToken: 'person-tok' }).app);
  try {
    for (const route of ['/api/inspire/score-refine', '/api/inspire/score-refine/undo']) {
      const resp = await fetch(`${srv.url}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...BODY, changes: [], use_case_ids: [] }) });
      assert.equal(resp.status, 404, `${route} answers 404`);
    }
  } finally {
    await srv.close();
  }
});

test('REQ-523: routePolicy has no score-refine entry', () => {
  const text = JSON.stringify(Object.keys(policy.POLICY || policy.ROUTE_POLICY || policy));
  assert.ok(!/score-refine/.test(text), 'no score-refine key in the route policy');
  assert.ok(!/score-refine/.test(require('fs').readFileSync(require.resolve('../lib/routePolicy'), 'utf8')), 'no score-refine text in routePolicy.js');
});

test('REQ-523 must-keep: valueAnswers and valueCasePlan still load and bind values', () => {
  const answers = require('../lib/valueAnswers');
  const plan = require('../lib/valueCasePlan');
  assert.ok(answers && plan);
  const fs = require('fs');
  const src = fs.readFileSync(require.resolve('../lib/valueAnswers'), 'utf8');
  const m = src.match(/require\('\.\/([A-Za-z]+)'\)\s*;?\s*\n/g) || [];
  assert.ok(!m.join('').includes('scoreRefine'), 'valueAnswers no longer reaches into scoreRefine');
  const { binder } = require(`../lib/${/const \{ binder \} = require\('\.\/(\w+)'\)/.exec(src)[1]}`);
  const b = binder();
  assert.equal(b.bind('x'), ':p0');
  assert.deepEqual(b.parameters.map((p) => p.value), ['x']);
});
