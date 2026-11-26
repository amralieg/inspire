// c25_nodate (REQ-558, RC7-B-03 class): a table with no usable date never dead-ends a value path. The period the person gave (period_days,
// 1..36500) or one assumed year scales the sample and the counts, and the answer says which. Three sites: the money sample, the same with a
// text date where no value parses, and the Kinds counts with a text date where no value parses.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, listen } = require('./support/implementApp');

const col = (column_name, data_type, ordinal_position = 1) => ({ column_name, data_type, ordinal_position });
const SALES = 'main.s.sales';
const NO_DATE = [col('amount', 'DOUBLE', 1), col('region', 'STRING', 2), col('franchiseID', 'BIGINT', 3)];
const TEXT_DATED = [col('amount', 'DOUBLE', 1), col('region', 'STRING', 2), col('dateTime', 'STRING', 3)];
const SESSION = { business_name: 'Acme', discovery_type: 'Deep', catalogs: 'main', schemas_str: 's', tables_str: SALES, inspire_database_name: 'main.inspire',
  generation_path: '/out', table_scope: JSON.stringify({}) };
const BODY = { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42', use_case_id: 'N01-U01', table: SALES };
const ANSWERS = { money: { currency: 'per_currency', value: { method: 'column', column: 'amount', currency: 'USD' } }, kpi: { name: 'revenue', direction: 'increase' } };

async function call(made, route, body) {
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
const COUNTS = { ' AS g': { rows: [{ g: 'All', records: '500' }] }, 'AS records': { rows: [{ records: '500', days: null }] } };

for (const [name, columns, days] of [['no date column', NO_DATE, null], ['a text date where no value parses', TEXT_DATED, null]]) {
  test(`estimate, ${name}: answers 200 with one assumed year`, async () => {
    const made = appWith(SAMPLE(days), columns);
    const got = await call(made, '/api/inspire/value/estimate', { ...BODY, answers: ANSWERS });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    // 1000 over 100 sampled, scaled to 10000 records, over 365 assumed days = 100,000 a year.
    assert.equal(Math.round(got.data.yearly.entries[0].amount), 100000);
    assert.equal(got.data.yearly.period_days, 365);
    assert.equal(got.data.yearly.period_assumed, true);
  });

  test(`estimate, ${name}: the period the person gave scales the sample`, async () => {
    const made = appWith(SAMPLE(days), columns);
    const got = await call(made, '/api/inspire/value/estimate', { ...BODY, answers: ANSWERS, period_days: 730 });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(Math.round(got.data.yearly.entries[0].amount), 50000);
    assert.equal(got.data.yearly.period_days, 730);
    assert.equal(got.data.yearly.period_assumed, false);
  });
}

test('case-plan, a text date where no value parses: counts answer 200 with one assumed year', async () => {
  const made = appWith(COUNTS, TEXT_DATED);
  const got = await call(made, '/api/inspire/value/case-plan', BODY);
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.equal(got.data.plan.days, 365);
  assert.equal(got.data.plan.period_days, 365);
  assert.equal(got.data.plan.period_assumed, true);
});

test('case-plan, a text date where no value parses: the period the person gave scales the counts', async () => {
  const made = appWith(COUNTS, TEXT_DATED);
  const got = await call(made, '/api/inspire/value/case-plan', { ...BODY, period_days: 90 });
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.equal(got.data.plan.days, 90);
  assert.equal(got.data.plan.period_days, 90);
  assert.equal(got.data.plan.period_assumed, false);
});
