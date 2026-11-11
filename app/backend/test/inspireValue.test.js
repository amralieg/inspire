const test = require('node:test');
const assert = require('node:assert/strict');

const V = require('../lib/inspireValue');

const part = (kind, unit, amount) => ({ kind, unit, amount });
const entry = (kind, unit, amount) => ({ kind, unit, amount });

test('money stays per currency and is never added across currencies', () => {
  assert.deepEqual(V.totalOf([part('money', 'EUR', 1000), part('money', 'USD', 500), part('money', 'EUR', 250)]),
    [entry('money', 'EUR', 1250), entry('money', 'USD', 500)]);
});

test('minutes become hours, weeks become days, and days join hours only when hours are in the same total', () => {
  assert.deepEqual(V.totalOf([part('time', 'hours', 5), part('time', 'days', 2)]), [entry('time', 'hours', 53)]);
  assert.deepEqual(V.totalOf([part('time', 'days', 2), part('time', 'weeks', 1)]), [entry('time', 'days', 9)]);
  assert.deepEqual(V.totalOf([part('time', 'minutes', 90)]), [entry('time', 'hours', 1.5)]);
  assert.deepEqual(V.totalOf([part('time', 'days', 2)]), [entry('time', 'days', 2)], 'days alone keep their unit');
});

test('count units never combine with each other or with money or time', () => {
  assert.deepEqual(V.totalOf([part('count', 'tickets', 3), part('count', 'cases', 4), part('count', 'tickets', 2),
    part('money', 'EUR', 9), part('time', 'hours', 1)]),
  [entry('money', 'EUR', 9), entry('time', 'hours', 1), entry('count', 'cases', 4), entry('count', 'tickets', 5)]);
});

test('a part with no amount or no unit adds nothing, and an empty total is empty', () => {
  assert.deepEqual(V.totalOf([part('money', 'EUR', null), part('money', '', 5)]), []);
  assert.deepEqual(V.totalOf([]), []);
});

test('the session and runs routes read the aggregated rows, and a run reports its use cases measured count', () => {
  const session = V.valueOfSession([
    { part: 'stake', use_case_id: 'N01-U01', kind: 'money', currency: 'EUR', unit: null, amount: 1000, measured: 1 },
    { part: 'stake', use_case_id: 'N07-U01', kind: 'money', currency: 'EUR', unit: null, amount: null, measured: 0 },
    { part: 'saved', use_case_id: 'N01-U01', kind: 'money', currency: 'EUR', unit: null, amount: 250, measured: 0 },
  ]);
  assert.deepEqual(session.use_cases['N07-U01'], { at_stake: [], saved: [], measured: false });
  assert.deepEqual(session.run, { at_stake: [entry('money', 'EUR', 1000)], saved: [entry('money', 'EUR', 250)], mvps_measured: 1 });
  const runs = V.valueOfRuns([
    { part: 'stake', session_id: '42', kind: 'money', currency: 'USD', unit: null, amount: 300 },
    { part: 'stake', session_id: '42', kind: 'time', currency: null, unit: 'hours', amount: 2 },
    { part: 'measured', session_id: '42', kind: null, currency: null, unit: null, amount: 2 },
  ]);
  assert.deepEqual(runs.runs['42'], { at_stake: [entry('money', 'USD', 300), entry('time', 'hours', 2)], saved: [], mvps_measured: 2 });
});

test('the overall totals take the latest run of each business and count runs and businesses from the counts row', () => {
  const overall = V.overallValue([{ part: 'stake', kind: 'money', currency: 'EUR', unit: null, amount: 350 },
    { part: 'saved', kind: 'money', currency: 'EUR', unit: null, amount: 30 }], { runs: '3', businesses: '2' });
  assert.deepEqual(overall, { at_stake: [entry('money', 'EUR', 350)], saved: [entry('money', 'EUR', 30)], runs: 3, businesses: 2 });
});

test('the SQL for the value routes names the one ledger table and never reads rows without aggregating them', () => {
  const table = V.valueLedgerTable({ catalog: 'main', schema: 'inspire' });
  assert.equal(table, '`main`.`inspire`.`__inspire_value_ledger`');
  assert.match(V.valueSessionSql(table, '42'), /WHERE session_id = '42'/);
  assert.match(V.valueOverallSql(table, V.inspireSessionTable({ catalog: 'main', schema: 'inspire' })), /latest_sessions AS/);
  assert.match(V.sessionCountsSql(V.inspireSessionTable({ catalog: 'main', schema: 'inspire' })),
    /COUNT\(DISTINCT COALESCE\(business_name, ''\)\) AS businesses FROM `main`\.`inspire`\.`__inspire_session`$/);
});
