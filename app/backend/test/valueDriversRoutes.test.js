// REQ-435: the estimate route with drivers (driver-only and mixed with the data part).
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, listen } = require('./support/implementApp');

const ORDERS = 'main.s.orders';
const SESSION = { business_name: 'Acme', discovery_type: 'Deep', catalogs: 'main', schemas_str: 's', tables_str: ORDERS, inspire_database_name: 'main.inspire',
  generation_path: '/tmp/out', table_scope: JSON.stringify({}) };
const COLUMNS = [{ column_name: 'amount', data_type: 'DOUBLE', ordinal_position: 1 }, { column_name: 'order_date', data_type: 'DATE', ordinal_position: 2 }];
const BODY = { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42', use_case_id: 'N01-U01', table: ORDERS };
const SAMPLE = { rows: [{ currency: 'USD', stake: '1000', sampled: '100', eligible: '10000', days: '90' }] };
const COST_CUT = { spend_per_year: 500000, cut_pct: 10 };
const MONEY = { currency: 'per_currency', value: { method: 'column', column: 'amount', currency: 'USD' } };

async function call(made, answers, extra = {}) {
  const srv = await listen(made.app);
  try {
    const resp = await fetch(`${srv.url}/api/inspire/value/estimate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...BODY, ...extra, answers }) });
    return { status: resp.status, data: await resp.json() };
  } finally {
    await srv.close();
  }
}
const appWith = () => makeApp({ forwardedToken: 'person-tok', session: SESSION, columns: COLUMNS, statements: { 'AS sampled': SAMPLE } });
const sampled = (made) => made.sqlCalls.filter((c) => c.sql.includes('AS sampled'));

test('A3: drivers with no money run no sample SQL and answer the total, with no basis', async () => {
  const made = appWith();
  const got = await call(made, { drivers: { cost_cut: COST_CUT }, currency: 'AED', attribution_pct: 100 });
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.equal(sampled(made).length, 0);
  const { yearly } = got.data;
  assert.equal(yearly.total.amount, 50000);
  assert.equal(yearly.total.unit, 'AED');
  assert.equal(yearly.basis, null);
  assert.equal(yearly.verb, 'VALUE AT STAKE');
  assert.equal(yearly.estimated, true);
  assert.deepEqual(yearly.entries, [{ kind: 'money', unit: 'AED', amount: 50000 }]);
  assert.deepEqual(yearly.parts.map((p) => [p.source, p.id, p.amount]), [['assumption', 'cost_cut', 50000]]);
  assert.ok(String(got.data.disclaimer || '').length > 20, 'the disclaimer is present');
});

test('attribution scales the driver-only total', async () => {
  const got = await call(appWith(), { drivers: { cost_cut: COST_CUT }, currency: 'AED', attribution_pct: 50 });
  assert.equal(got.status, 200);
  assert.equal(got.data.yearly.total.amount, 25000);
  assert.equal(got.data.yearly.attribution_pct, 50);
});

test('A4: a data part in USD with the answer currency AED is refused and nothing is sampled', async () => {
  const made = appWith();
  const got = await call(made, { money: MONEY, drivers: { cost_cut: COST_CUT }, currency: 'AED' });
  assert.equal(got.status, 400, JSON.stringify(got.data));
  assert.match(String(got.data.error), /USD/);
  assert.match(String(got.data.error), /AED/);
  assert.equal(sampled(made).length, 0);
});

test('mixed: the data part and the drivers add up in one currency', async () => {
  const made = appWith();
  const got = await call(made, { money: MONEY, drivers: { cost_cut: COST_CUT }, currency: 'USD', attribution_pct: 100 });
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.equal(sampled(made).length, 1);
  const { yearly } = got.data;
  assert.ok(Math.abs(yearly.parts.find((p) => p.id === 'data').amount - 405555.56) < 1);
  assert.ok(Math.abs(yearly.total.amount - 455555.56) < 1, `got ${yearly.total.amount}`);
  assert.deepEqual(yearly.basis, { sampled_records: 100, eligible_records: 10000, days: 90 });
});

test('A2: a bad driver answer is a 400 and nothing is sampled', async () => {
  for (const answers of [
    { drivers: { cost_cut: { spend_per_year: -5, cut_pct: 10 } }, currency: 'AED' },
    { drivers: { cost_cut: { spend_per_year: 5 } }, currency: 'AED' },
    { drivers: { cost_cut: { spend_per_year: 5, cut_pct: 101 } }, currency: 'AED' },
    { drivers: { cost_cut: COST_CUT }, currency: 'AED', attribution_pct: 150 },
    { drivers: { nope: { a: 1 } }, currency: 'AED' },
    { drivers: { cost_cut: COST_CUT } },
  ]) {
    const made = appWith();
    const got = await call(made, answers);
    assert.equal(got.status, 400, JSON.stringify(answers));
    assert.ok(String(got.data.error).length > 10);
    assert.equal(sampled(made).length, 0);
  }
});

test('an answer with neither money nor drivers is still refused', async () => {
  const got = await call(appWith(), { kpi: { name: 'revenue' } });
  assert.equal(got.status, 400);
});
