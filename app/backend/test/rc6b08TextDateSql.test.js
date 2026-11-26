// RC6-B-08 follow-up: a STRING column used as the date column is read through a safe parse at every SQL site (a value that does not parse is
// NULL and ignored, never a SQL error); when no row parses, the route answers with the clean "no date column" skip. One date-column detector
// for every value path: the scope window takes the same columns as the case plan.
const test = require('node:test');
const assert = require('node:assert/strict');
const VY = require('../lib/valueYearly');
const VS = require('../lib/valueScope');
const { makeApp, listen } = require('./support/implementApp');

const col = (column_name, data_type, ordinal_position = 1) => ({ column_name, data_type, ordinal_position });
const SALES = 'main.s.sales';
const TEXT_DATED = [col('amount', 'DOUBLE', 1), col('region', 'STRING', 2), col('dateTime', 'STRING', 3)];
const SESSION = { business_name: 'Acme', discovery_type: 'Deep', catalogs: 'main', schemas_str: 's', tables_str: SALES, inspire_database_name: 'main.inspire',
  generation_path: '/out', table_scope: JSON.stringify({}) };
const BODY = { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42', use_case_id: 'N01-U01', table: SALES };
const ANSWERS = { money: { currency: 'per_currency', value: { method: 'column', column: 'amount', currency: 'USD' } }, kpi: { name: 'revenue', direction: 'increase' } };

// Every read of `dateTime` in the SQL is inside TRY_CAST: once those are taken out, the column is not named anywhere else.
function assertSafe(sql) {
  assert.match(sql, /TRY_CAST\(`dateTime` AS (TIMESTAMP|DATE)\)/, sql);
  assert.doesNotMatch(sql.replace(/TRY_CAST\(`dateTime` AS (TIMESTAMP|DATE)\)/g, ''), /`dateTime`/, sql);
}

async function call(made, route, body, method = 'POST') {
  const srv = await listen(made.app);
  try {
    const resp = await fetch(`${srv.url}${route}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: resp.status, data: await resp.json().catch(() => ({})) };
  } finally {
    await srv.close();
  }
}
const appWith = (statements, columns = TEXT_DATED, extra = {}) => makeApp({ forwardedToken: 'person-tok', session: SESSION, columns, statements, ...extra });
const datedCalls = (made) => made.sqlCalls.filter((c) => c.sql.includes('dateTime'));

test('estimate: the sample SQL reads a STRING dateTime through a safe parse', async () => {
  const made = appWith({ 'AS sampled': { rows: [{ currency: 'USD', stake: '1000', sampled: '100', eligible: '10000', days: '90' }] } });
  const got = await call(made, '/api/inspire/value/estimate', { ...BODY, answers: ANSWERS });
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.ok(datedCalls(made).length >= 1);
  for (const c of datedCalls(made)) assertSafe(c.sql);
});

test('estimate: a STRING dateTime where no row parses is the clean skip that names the table and the columns checked', async () => {
  const made = appWith({ 'AS sampled': { rows: [{ currency: 'USD', stake: '1000', sampled: '100', eligible: '10000', days: null }] } });
  const got = await call(made, '/api/inspire/value/estimate', { ...BODY, answers: ANSWERS });
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.equal(got.data.yearly.period_assumed, true);
  assert.equal(got.data.yearly.period_days, 365);
});

test('case-plan: the grouped and population SQL read a STRING dateTime through a safe parse; none parsing is the clean skip', async () => {
  const made = appWith({ ' AS g': { rows: [{ g: 'All', records: '0' }] }, 'AS records': { rows: [{ records: '0', days: null }] } });
  const got = await call(made, '/api/inspire/value/case-plan', BODY);
  assert.ok(datedCalls(made).length >= 2, `grouped and population SQL: ${datedCalls(made).length}`);
  for (const c of datedCalls(made)) assertSafe(c.sql);
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.equal(got.data.plan.period_assumed, true);
  assert.equal(got.data.plan.period_days, 365);
  assert.equal(got.data.plan.days, 365);
});

test('case-plan: a scope window on a STRING dateTime is accepted and its SQL is a safe parse', async () => {
  const made = appWith({ ' AS g': { rows: [{ g: 'All', records: '10' }] }, 'AS records': { rows: [{ records: '10', days: '30' }] } });
  const scope = { phrase: 'last month', filters: [], window: { column: 'dateTime', start: '2026-01-01', end: '2026-01-31' } };
  const got = await call(made, '/api/inspire/value/case-plan', { ...BODY, scope });
  assert.doesNotMatch(String(got.data.error || ''), /scope window must name a date column/);
  assert.ok(datedCalls(made).length >= 1);
  for (const c of datedCalls(made)) assertSafe(c.sql);
});

test('scope: the records-found SQL reads a STRING dateTime (chosen and candidate) through a safe parse', async () => {
  const made = appWith({ 'rows_total': { rows: [{ rows_total: '10', dated_rows: '0', first_day: null, last_day: null, c0_first: null, c0_last: null }] } });
  const got = await call(made, '/api/inspire/value/scope', BODY);
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.ok(datedCalls(made).length >= 1);
  for (const c of datedCalls(made)) assertSafe(c.sql);
});

test('measured path: the eligible SQL reads a STRING dateTime through a safe parse', async () => {
  const spec = JSON.stringify({ use_case_name: 'Churn App', config: { result_table: 'main.s.sales_out' } });
  const made = appWith({
    '__inspire_value_ledger': { rows: [{ part: 'stake', use_case_id: 'N01-U01', kind: 'money', currency: 'USD', unit: null, amount: '1000', measured: '1' }] },
    'PARTITION BY use_case_id ORDER BY spec_version': { rows: [{ use_case_id: 'N01-U01', spec }] },
    'SELECT id, primary_table FROM': { rows: [{ id: 'N01-U01', primary_table: SALES }] },
    'AS eligible': { rows: [{ eligible: '10000', days: '90' }] },
  }, TEXT_DATED, { moneySummary: [{ records: '100', kpi_name: 'revenue', kpi_direction: 'increase', kpi_unit: 'USD', impact_kind: 'money' }] });
  const got = await call(made, '/api/inspire/value/yearly?inspire_database=main.inspire&warehouse_id=wh1&session_id=42', null, 'GET');
  assert.equal(got.status, 200, JSON.stringify(got.data));
  const eligible = made.sqlCalls.filter((c) => c.sql.includes('AS eligible'));
  assert.equal(eligible.length, 1);
  assertSafe(eligible[0].sql);
});

test('one detector: the scope-window columns of a table dated only by a STRING dateTime are the case-plan detector\'s', () => {
  const detector = VY.dateColumnsOf(TEXT_DATED).map((c) => c.column_name);
  assert.deepEqual(detector, ['dateTime']);
  const w = VS.checkWindow({ column: 'dateTime', last_n: 3, unit: 'month' }, TEXT_DATED);
  assert.equal(w.ok, true);
  assert.deepEqual(w.window, { column: 'dateTime', last_n: 3, unit: 'month' });
  const near = VS.checkWindow({ column: 'date_time', last_n: 3, unit: 'month' }, TEXT_DATED);
  assert.deepEqual(near.unmatched[0].close, detector);
  const scope = VS.checkScope({ filters: [], window: { column: 'dateTime', start: '2026-01-01', end: '2026-01-31' } }, TEXT_DATED);
  assert.equal(scope.ok, true, scope.reason);
  assert.equal(scope.scope.window.column, 'dateTime');
  assert.equal(VS.checkScope({ filters: [], window: { column: 'region', start: '2026-01-01' } }, TEXT_DATED).ok, false);
});

test('a STRING date column is never the default grouping of a case plan', () => {
  const VCP = require('../lib/valueCasePlan');
  const plan = VCP.fallbackPlan([col('dateTime', 'STRING', 1), col('region', 'STRING', 2), col('amount', 'DOUBLE', 3)], '');
  assert.equal(plan.grouping, 'region');
});
