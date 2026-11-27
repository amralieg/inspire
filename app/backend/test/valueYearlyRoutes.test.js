// REQ-432: the Calculate estimate and the measured per-year value, through the real routes with a fake warehouse.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, listen } = require('./support/implementApp');

const ORDERS = 'main.s.orders';
const SESSION = { business_name: 'Acme', discovery_type: 'Deep', catalogs: 'main', schemas_str: 's', tables_str: ORDERS, inspire_database_name: 'main.inspire',
  generation_path: '/tmp/out', table_scope: JSON.stringify({}) };
const COLUMNS = [{ column_name: 'amount', data_type: 'DOUBLE', ordinal_position: 1 }, { column_name: 'order_date', data_type: 'DATE', ordinal_position: 2 }];
const BODY = { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42', use_case_id: 'N01-U01', table: ORDERS };
const ANSWERS = { money: { currency: 'per_currency', value: { method: 'column', column: 'amount', currency: 'USD' } }, kpi: { name: 'revenue', direction: 'increase' } };
// 100 sampled records worth 1,000 over 90 days of data, 10,000 eligible records.
const SAMPLE = { rows: [{ currency: 'USD', stake: '1000', sampled: '100', eligible: '10000', days: '90' }] };

async function call(made, method, route, body) {
  const srv = await listen(made.app);
  try {
    const resp = await fetch(`${srv.url}${route}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: resp.status, data: await resp.json() };
  } finally {
    await srv.close();
  }
}
const appWith = (statements, columns = COLUMNS) => makeApp({ forwardedToken: 'person-tok', session: SESSION, columns, statements });

test('Calculate: the estimate samples the table once, extrapolates by record count and annualizes (about 405,556 a year)', async () => {
  const made = appWith({ 'AS sampled': SAMPLE });
  const got = await call(made, 'POST', '/api/inspire/value/estimate', { ...BODY, answers: ANSWERS });
  assert.equal(got.status, 200, JSON.stringify(got.data));
  const { yearly } = got.data;
  assert.equal(yearly.verb, 'INCREASE REVENUE');
  assert.equal(yearly.period, 'Per Year');
  assert.equal(yearly.estimated, true);
  assert.equal(yearly.entries.length, 1);
  assert.deepEqual([yearly.entries[0].kind, yearly.entries[0].unit], ['money', 'USD']);
  assert.ok(Math.abs(yearly.entries[0].amount - 405555.56) < 1, `got ${yearly.entries[0].amount}`);
  assert.deepEqual(yearly.basis, { sampled_records: 100, eligible_records: 10000, days: 90 });
  assert.equal(made.sqlCalls.filter((c) => c.sql.includes('AS sampled')).length, 1, 'one SQL estimate, no job and no build');
});

test('Calculate refuses a request with no answers (400) and runs no estimate', async () => {
  for (const answers of [undefined, {}, { money: {} }, { money: { currency: 'per_currency' } }]) {
    const made = appWith({ 'AS sampled': SAMPLE });
    const got = await call(made, 'POST', '/api/inspire/value/estimate', { ...BODY, ...(answers === undefined ? {} : { answers }) });
    assert.equal(got.status, 400, JSON.stringify(answers));
    assert.ok(!made.sqlCalls.some((c) => c.sql.includes('AS sampled')), 'nothing was read');
  }
});

test('Calculate never answers 0 for a value it could not measure: no rows is a refusal with a reason; no date column (REQ-558) answers one assumed year, said so', async () => {
  const none = await call(appWith({ 'AS sampled': { rows: [] } }), 'POST', '/api/inspire/value/estimate', { ...BODY, answers: ANSWERS });
  assert.ok(none.status >= 400 && none.status < 500, `got ${none.status}`);
  assert.equal(none.data.yearly, undefined);
  assert.ok(String(none.data.error || '').length > 10, 'the reason is one sentence');
  // REQ-558 (lib/valueYearly.js periodOf, test/c25NoDate.test.js): no date column no longer refuses; the sample is scaled over one assumed year.
  const noDate = await call(appWith({ 'AS sampled': SAMPLE }, [COLUMNS[0]]), 'POST', '/api/inspire/value/estimate', { ...BODY, answers: ANSWERS });
  assert.equal(noDate.status, 200, JSON.stringify(noDate.data));
  assert.deepEqual(noDate.data.yearly, { verb: 'INCREASE REVENUE', period: 'Per Year', estimated: true, entries: [{ kind: 'money', unit: 'USD', amount: 100000 }],
    basis: { sampled_records: 100, eligible_records: 10000, days: 365 }, period_days: 365, period_assumed: true });
  assert.equal(noDate.data.error, undefined);
});

test('the measured path scales the MVP value the same way: per scored record, to all eligible records, to a year', async () => {
  const spec = JSON.stringify({ use_case_name: 'Churn App', config: { result_table: 'main.s.orders_out' } });
  const made = makeApp({
    forwardedToken: 'person-tok', session: SESSION, columns: COLUMNS,
    moneySummary: [{ records: '100', kpi_name: 'revenue', kpi_direction: 'increase', kpi_unit: 'USD', impact_kind: 'money' }],
    statements: {
      '__inspire_value_ledger': { rows: [
        { part: 'stake', use_case_id: 'N01-U01', kind: 'money', currency: 'USD', unit: null, amount: '1000', measured: '1' },
        { part: 'stake', use_case_id: 'N07-U01', kind: 'money', currency: 'USD', unit: null, amount: null, measured: '0' },
      ] },
      'PARTITION BY use_case_id ORDER BY spec_version': { rows: [{ use_case_id: 'N01-U01', spec }] },
      'SELECT id, primary_table FROM': { rows: [{ id: 'N01-U01', primary_table: ORDERS }, { id: 'N07-U01', primary_table: ORDERS }] },
      'AS eligible': { rows: [{ eligible: '10000', days: '90' }] },
    },
  });
  const got = await call(made, 'GET', '/api/inspire/value/yearly?inspire_database=main.inspire&warehouse_id=wh1&session_id=42');
  assert.equal(got.status, 200, JSON.stringify(got.data));
  const one = got.data.use_cases['N01-U01'];
  assert.equal(one.verb, 'INCREASE REVENUE');
  assert.ok(Math.abs(one.entries[0].amount - 405555.56) < 1, JSON.stringify(one));
  assert.deepEqual(one.basis, { sampled_records: 100, eligible_records: 10000, days: 90 });
  assert.equal(got.data.use_cases['N07-U01'], undefined, 'a use case with no measured value has no per-year value, never 0');
});
