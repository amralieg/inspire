// c28_nodate (REQ-558): every value path answers for a table with no date column, a text date where nothing parses, and a good date column.
// The good date column is the must-keep: its own span of days scales the sample and is never marked as assumed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, listen } = require('./support/implementApp');

const col = (column_name, data_type, ordinal_position = 1) => ({ column_name, data_type, ordinal_position });
const SALES = 'main.s.sales';
const NO_DATE = [col('amount', 'DOUBLE', 1), col('region', 'STRING', 2)];
const TEXT_DATED = [col('amount', 'DOUBLE', 1), col('region', 'STRING', 2), col('dateTime', 'STRING', 3)];
const GOOD_DATE = [col('amount', 'DOUBLE', 1), col('region', 'STRING', 2), col('order_date', 'DATE', 3)];
const SESSION = { business_name: 'Acme', discovery_type: 'Deep', catalogs: 'main', schemas_str: 's', tables_str: SALES, inspire_database_name: 'main.inspire',
  generation_path: '/out', table_scope: JSON.stringify({}) };
const BODY = { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42', use_case_id: 'N01-U01', table: SALES };
const ANSWERS = { money: { currency: 'per_currency', value: { method: 'column', column: 'amount', currency: 'USD' } }, kpi: { name: 'revenue', direction: 'increase' } };

async function post(made, route, body) {
  const srv = await listen(made.app);
  try {
    const resp = await fetch(`${srv.url}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: resp.status, data: await resp.json().catch(() => ({})) };
  } finally {
    await srv.close();
  }
}
const appWith = (statements, columns) => makeApp({ forwardedToken: 'person-tok', session: SESSION, columns, statements });
const SAMPLE = (days) => ({ 'AS sampled': { rows: [{ currency: 'USD', stake: '1000', sampled: '100', eligible: '10000', days }] } });
const COUNTS = (days) => ({ ' AS g': { rows: [{ g: 'All', records: '500' }] }, 'AS records': { rows: [{ records: '500', days }] } });

test('estimate, a good date column: its own 730 days scale the sample, nothing assumed', async () => {
  const got = await post(appWith(SAMPLE('730'), GOOD_DATE), '/api/inspire/value/estimate', { ...BODY, answers: ANSWERS });
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.equal(Math.round(got.data.yearly.entries[0].amount), 50000);
  assert.equal(got.data.yearly.basis.days, 730);
  assert.ok(!got.data.yearly.period_assumed, 'a real date column is never marked as an assumed period');
});

test('case-plan, a good date column: its own 90 days, nothing assumed', async () => {
  const got = await post(appWith(COUNTS('90'), GOOD_DATE), '/api/inspire/value/case-plan', BODY);
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.equal(got.data.plan.days, 90);
  assert.ok(!got.data.plan.period_assumed, 'a real date column is never marked as an assumed period');
});

test('case-plan, no date column: answers 200 with one assumed year', async () => {
  const got = await post(appWith(COUNTS(null), NO_DATE), '/api/inspire/value/case-plan', BODY);
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.equal(got.data.plan.days, 365);
  assert.equal(got.data.plan.period_assumed, true);
});

test('case-plan, no date column: the period the person gave scales the counts', async () => {
  const got = await post(appWith(COUNTS(null), NO_DATE), '/api/inspire/value/case-plan', { ...BODY, period_days: 90 });
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.equal(got.data.plan.days, 90);
  assert.equal(got.data.plan.period_assumed, false);
});

for (const [name, columns] of [['no date column', NO_DATE], ['a text date where no value parses', TEXT_DATED], ['a good date column', GOOD_DATE]]) {
  test(`scope, ${name}: answers 200 with facts`, async () => {
    const got = await post(appWith({}, columns), '/api/inspire/value/scope', BODY);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(got.data.facts.table, SALES);
  });
}

// The measured path (GET /value/yearly, also the "measured" status of /value/totals): the MVP's stake per scored record scaled to every eligible
// record and a year. No date column or a text date where nothing parses answers one assumed year, never an absent use case.
async function measured(columns, eligibleRow, query = '') {
  const spec = JSON.stringify({ use_case_name: 'Churn App', config: { result_table: 'main.s.sales_out' } });
  const made = makeApp({
    forwardedToken: 'person-tok', session: SESSION, columns,
    moneySummary: [{ records: '100', kpi_name: 'revenue', kpi_direction: 'increase', kpi_unit: 'USD', impact_kind: 'money' }],
    statements: {
      '__inspire_value_ledger': { rows: [{ part: 'stake', use_case_id: 'N01-U01', kind: 'money', currency: 'USD', unit: null, amount: '1000', measured: '1' }] },
      'PARTITION BY use_case_id ORDER BY spec_version': { rows: [{ use_case_id: 'N01-U01', spec }] },
      'SELECT id, primary_table FROM': { rows: [{ id: 'N01-U01', primary_table: SALES }] },
      'AS eligible': { rows: [eligibleRow] },
    },
  });
  const srv = await listen(made.app);
  try {
    const resp = await fetch(`${srv.url}/api/inspire/value/yearly?inspire_database=main.inspire&warehouse_id=wh1&session_id=42${query}`);
    return { status: resp.status, data: await resp.json(), made };
  } finally {
    await srv.close();
  }
}

for (const [name, columns, row] of [['no date column', NO_DATE, { eligible: '10000' }], ['a text date where no value parses', TEXT_DATED, { eligible: '10000', days: null }]]) {
  test(`measured yearly, ${name}: one assumed year, never absent`, async () => {
    const got = await measured(columns, row);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    const one = got.data.use_cases['N01-U01'];
    assert.ok(one, 'the use case is present');
    // 1000 over 100 scored records, to 10000 eligible records, over 365 assumed days = 100,000 a year.
    assert.equal(Math.round(one.entries[0].amount), 100000);
    assert.equal(one.basis.days, 365);
  });
}

test('measured yearly, a good date column: its own 90 days scale the value', async () => {
  const got = await measured(GOOD_DATE, { eligible: '10000', days: '90' });
  assert.equal(got.status, 200, JSON.stringify(got.data));
  const one = got.data.use_cases['N01-U01'];
  assert.equal(Math.round(one.entries[0].amount), Math.round(1000 / 100 * 10000 * 365 / 90));
  assert.equal(one.basis.days, 90);
});
