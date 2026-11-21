// REQ-448 (D1, D2, D4): the records and the days of a case plan come from the whole filtered population, not from the grouped rows.
const test = require('node:test');
const assert = require('node:assert/strict');
const GP = require('../lib/groupingProfile');
const VCP = require('../lib/valueCasePlan');
const { makeApp, listen } = require('./support/implementApp');

const COLUMNS = [
  { column_name: 'region', data_type: 'STRING', ordinal_position: 1 }, { column_name: 'event_date', data_type: 'DATE', ordinal_position: 2 },
];
const withGrouping = () => ({ ...VCP.fallbackPlan(COLUMNS, 'region'), grouping: 'region' });

test('groupsFrom uses the population: 5,000 key-like rows still scale over the real 6,200 days', () => {
  const rows = Array.from({ length: 5000 }, (_, i) => ({ g: `k${i}`, records: '1', days: '1' }));
  const got = VCP.groupsFrom(rows, withGrouping(), { records: 300000, days: 6200 });
  assert.equal(got.days, 6200);
  assert.equal(got.groups.length, 1);
  assert.equal(got.groups[0].g, 'Other');
  assert.equal(got.groups[0].records_per_year, 17661.29);
});

test('the grouped SQL and the population SQL both skip rows with no date; the grouped SQL is ordered, capped and has no DATEDIFF', () => {
  const plan = { ...withGrouping(), table: 'c.s.t', date_column: 'event_date' };
  const grouped = VCP.groupedSql(GP, {}, plan, 'c.s.t', 'event_date');
  const population = VCP.currentCountSql(GP, {}, plan);
  assert.match(grouped.sql, /`event_date` IS NOT NULL/);
  assert.match(population.sql, /`event_date` IS NOT NULL/);
  assert.match(grouped.sql, /ORDER BY records DESC LIMIT 500/);
  assert.doesNotMatch(grouped.sql, /DATEDIFF/);
});

test('case-plan route: more than 5,000 groups cannot change the record count or the days', async () => {
  const many = { rows: Array.from({ length: 5001 }, (_, i) => ({ g: `k${i}`, records: '1', days: '1' })) };
  const made = makeApp({ forwardedToken: 'person-tok', columns: COLUMNS,
    session: { business_name: 'Acme', discovery_type: 'Deep', catalogs: 'main', schemas_str: 's', tables_str: 'main.s.t', inspire_database_name: 'main.inspire', generation_path: '/tmp/out', table_scope: JSON.stringify({}) },
    responses: { 'GET /api/2.0/serving-endpoints': [{}] },
    statements: { 'AS records': (sql) => (sql.includes(' AS g') ? many : { rows: [{ records: '300000', days: '6200' }] }) } });
  const srv = await listen(made.app);
  try {
    const resp = await fetch(`${srv.url}/api/inspire/value/case-plan`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-email': 'p@example.com' },
      body: JSON.stringify({ inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42', use_case_id: 'N01-U01', table: 'main.s.t' }) });
    const data = await resp.json();
    assert.equal(resp.status, 200, JSON.stringify(data));
    assert.equal(data.plan.days, 6200);
    const sum = data.plan.groups.reduce((s, g) => s + g.records_per_year, 0);
    assert.equal(Math.round(sum * 100) / 100, 17661.29);
  } finally {
    await srv.close();
  }
});
