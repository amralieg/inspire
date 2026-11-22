// REQ-434: the disclaimer is one constant, and every API answer that carries a calculated value carries it too (the data a download or export holds).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeApp, listen } = require('./support/implementApp');

const FULL = 'Estimated or calculated value, not a promised value. Databricks does not promise or guarantee this number. Specialist business value teams in your organization must validate every number before it is shared or used in a decision.';

test('one constant holds the full text, shared by the backend and the App', () => {
  const lib = require('../lib/valueDisclaimer.json');
  assert.equal(lib.full, FULL);
  assert.equal(lib.short, 'Estimated, not promised. Validate with your business value team.');
  const labels = fs.readFileSync(path.join(__dirname, '../../frontend/src/lib/valueLabels.js'), 'utf8');
  assert.match(labels, /valueDisclaimer\.json/, 'the App reads the same file');
  assert.ok(!labels.includes('Specialist business value teams'), 'the App holds no second copy of the words');
});

test('the Calculate answer and the measured per-year answer carry the disclaimer', async () => {
  const columns = [{ column_name: 'amount', data_type: 'DOUBLE', ordinal_position: 1 }, { column_name: 'order_date', data_type: 'DATE', ordinal_position: 2 }];
  const session = { business_name: 'Acme', discovery_type: 'Deep', catalogs: 'main', schemas_str: 's', tables_str: 'main.s.orders', inspire_database_name: 'main.inspire',
    generation_path: '/tmp/out', table_scope: JSON.stringify({}) };
  const made = makeApp({ forwardedToken: 'person-tok', session, columns,
    statements: { 'AS sampled': { rows: [{ currency: 'USD', stake: '1000', sampled: '100', eligible: '10000', days: '90' }] } } });
  const srv = await listen(made.app);
  try {
    const post = await fetch(`${srv.url}/api/inspire/value/estimate`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42', use_case_id: 'N01-U01', table: 'main.s.orders',
        answers: { money: { currency: 'per_currency', value: { method: 'column', column: 'amount', currency: 'USD' } }, kpi: { name: 'revenue', direction: 'increase' } } }) });
    assert.equal((await post.json()).disclaimer, FULL);
    const get = await fetch(`${srv.url}/api/inspire/value/yearly?inspire_database=main.inspire&warehouse_id=wh1&session_id=42`);
    assert.equal((await get.json()).disclaimer, FULL);
  } finally {
    await srv.close();
  }
});

test('the value routes of the server (run, estimates) put the disclaimer in their answers', () => {
  const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  for (const route of ["'/api/inspire/value'", "'/api/inspire/value/estimates'"]) {
    const at = src.indexOf(`app.get(${route}`);
    assert.ok(at > 0, route);
    const end = src.indexOf('\napp.', at + 10);
    assert.match(src.slice(at, end), /disclaimer/i, `${route} carries the disclaimer`);
  }
});
