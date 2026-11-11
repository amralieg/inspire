const test = require('node:test');
const assert = require('node:assert/strict');

const V = require('../lib/inspireValue');

const stake = (session, uc, kind, unit, amount, at = '2026-11-10 10:00:00', run = '9001', result = 'main.out.queue') => ({
  session_id: session, result_table: result, use_case_id: uc, run_id: run, record_key: null, kind,
  currency: kind === 'money' ? unit : null, unit: kind === 'money' ? null : unit, at_stake: amount, saved: null, recorded_at: at,
});
const saved = (session, uc, key, kind, unit, amount, at = '2026-11-10 11:00:00', result = 'main.out.queue') => ({
  session_id: session, result_table: result, use_case_id: uc, run_id: '9001', record_key: key, kind,
  currency: kind === 'money' ? unit : null, unit: kind === 'money' ? null : unit, at_stake: null, saved: amount, recorded_at: at,
});
const entry = (kind, unit, amount) => ({ kind, unit, amount });

test('two currencies in one run stay apart, never added together', () => {
  const rows = [stake('42', 'N01-U01', 'money', 'EUR', 1000), stake('42', 'N02-U01', 'money', 'USD', 500),
    saved('42', 'N01-U01', 'r1', 'money', 'EUR', 250), saved('42', 'N02-U01', 'r2', 'money', 'USD', 75)];
  const run = V.valueOfSession(rows);
  assert.deepEqual(run.run.at_stake, [entry('money', 'EUR', 1000), entry('money', 'USD', 500)]);
  assert.deepEqual(run.run.saved, [entry('money', 'EUR', 250), entry('money', 'USD', 75)]);
  assert.deepEqual(run.use_cases['N01-U01'].at_stake, [entry('money', 'EUR', 1000)]);
});

test('minutes become hours, days join hours only when hours are in the same total, weeks become days', () => {
  assert.deepEqual(V.totalOf([entry('time', 'hours', 5), entry('time', 'days', 2)]), [entry('time', 'hours', 53)]);
  assert.deepEqual(V.totalOf([entry('time', 'days', 2), entry('time', 'weeks', 1)]), [entry('time', 'days', 9)]);
  assert.deepEqual(V.totalOf([entry('time', 'minutes', 90)]), [entry('time', 'hours', 1.5)]);
  assert.deepEqual(V.totalOf([entry('time', 'days', 2)]), [entry('time', 'days', 2)], 'days alone keep their unit');
});

test('time units from different use cases of one run convert together and never mix with money or counts', () => {
  const rows = [stake('42', 'N01-U01', 'time', 'hours', 4), stake('42', 'N02-U01', 'time', 'days', 2),
    stake('42', 'N03-U01', 'money', 'EUR', 1000), stake('42', 'N04-U01', 'count', 'tickets', 7)];
  const run = V.valueOfSession(rows).run.at_stake;
  assert.deepEqual(run, [entry('money', 'EUR', 1000), entry('time', 'hours', 52), entry('count', 'tickets', 7)]);
});

test('count units never combine, even when their names match a time unit', () => {
  const rows = [stake('42', 'N01-U01', 'count', 'tickets', 3), stake('42', 'N02-U01', 'count', 'cases', 4),
    stake('42', 'N03-U01', 'count', 'tickets', 2)];
  assert.deepEqual(V.valueOfSession(rows).run.at_stake, [entry('count', 'cases', 4), entry('count', 'tickets', 5)]);
});

test('at stake is the latest run per use case, saved sums every save, and a cleared save leaves the total', () => {
  const rows = [
    stake('41', 'N01-U01', 'money', 'EUR', 100, '2026-11-09 10:00:00', '8001'),
    stake('42', 'N01-U01', 'money', 'EUR', 300, '2026-11-10 10:00:00', '9001'),
    saved('41', 'N01-U01', 'rec-a', 'money', 'EUR', 10, '2026-11-09 11:00:00'),
    saved('42', 'N01-U01', 'rec-b', 'money', 'EUR', 20, '2026-11-10 11:00:00'),
    saved('42', 'N01-U01', 'rec-c', 'money', 'EUR', 40, '2026-11-10 11:30:00'),
    saved('42', 'N01-U01', 'rec-c', 'money', 'EUR', 55, '2026-11-10 12:00:00'),
    saved('42', 'N01-U01', 'rec-b', 'money', 'EUR', null, '2026-11-10 12:30:00'),
  ];
  const session42 = V.valueOfSession(rows.filter((r) => r.session_id === '42'));
  assert.deepEqual(session42.run.at_stake, [entry('money', 'EUR', 300)]);
  assert.deepEqual(session42.run.saved, [entry('money', 'EUR', 55)], 'rec-b was cleared, rec-c replaced its earlier amount');
  const session41 = V.valueOfSession(rows.filter((r) => r.session_id === '41'));
  assert.deepEqual(session41.run.at_stake, [entry('money', 'EUR', 100)]);
  assert.deepEqual(session41.run.saved, [entry('money', 'EUR', 10)]);
});

test('overall at stake counts only the latest run of each business, and saved counts every run', () => {
  const sessions = [
    { session_id: '41', business_name: 'Acme', create_at: '2026-11-08 09:00:00' },
    { session_id: '42', business_name: 'Acme', create_at: '2026-11-10 09:00:00' },
    { session_id: '43', business_name: 'Globex', create_at: '2026-11-09 09:00:00' },
  ];
  const rows = [
    stake('41', 'N01-U01', 'money', 'EUR', 100, '2026-11-08 10:00:00', '8001'),
    stake('42', 'N01-U01', 'money', 'EUR', 300, '2026-11-10 10:00:00', '9001'),
    stake('43', 'N09-U01', 'money', 'EUR', 50, '2026-11-09 10:00:00', '9002'),
    saved('41', 'N01-U01', 'a', 'money', 'EUR', 10, '2026-11-08 11:00:00'),
    saved('42', 'N01-U01', 'b', 'money', 'EUR', 20, '2026-11-10 11:00:00'),
  ];
  const overall = V.overallValue(sessions, rows);
  assert.deepEqual(overall.at_stake, [entry('money', 'EUR', 350)], 'the older Acme run (100) is not added to its latest (300)');
  assert.deepEqual(overall.saved, [entry('money', 'EUR', 30)]);
  assert.equal(overall.runs, 3);
  assert.equal(overall.businesses, 2);
});

test('a use case with no measured stake has no entry and measured false, never a zero', () => {
  const rows = [stake('42', 'N01-U01', 'money', 'EUR', null), stake('42', 'N02-U01', 'money', 'EUR', 40)];
  const value = V.valueOfSession(rows);
  assert.deepEqual(value.use_cases['N01-U01'], { at_stake: [], saved: [], measured: false });
  assert.deepEqual(value.use_cases['N02-U01'], { at_stake: [entry('money', 'EUR', 40)], saved: [], measured: true });
  assert.equal(value.run.mvps_measured, 1);
  assert.deepEqual(value.run.at_stake, [entry('money', 'EUR', 40)]);
});

test('a latest run that stopped measuring makes the use case not measured even when an earlier run measured it', () => {
  const rows = [stake('42', 'N01-U01', 'money', 'EUR', 90, '2026-11-09 10:00:00', '8001'),
    stake('42', 'N01-U01', 'money', 'EUR', null, '2026-11-10 10:00:00', '9001')];
  const value = V.valueOfSession(rows);
  assert.equal(value.use_cases['N01-U01'].measured, false);
  assert.deepEqual(value.use_cases['N01-U01'].at_stake, []);
  assert.deepEqual(value.run, { at_stake: [], saved: [], mvps_measured: 0 });
});

test('an empty ledger is an empty run and an empty database, with nothing measured', () => {
  assert.deepEqual(V.valueOfSession([]), { use_cases: {}, run: { at_stake: [], saved: [], mvps_measured: 0 } });
  assert.equal('stakeParts' in V.valueOfSession([stake('42', 'N01-U01', 'money', 'EUR', 1)]), false, 'the route never sends internal parts');
  assert.deepEqual(V.overallValue([], []), { at_stake: [], saved: [], runs: 0, businesses: 0 });
});

test('the session query names one run and the overall query reads every row and every session', () => {
  const table = V.valueLedgerTable({ catalog: 'main', schema: 'inspire' });
  assert.equal(table, '`main`.`inspire`.`__inspire_value_ledger`');
  assert.match(V.valueSessionSql(table, '42'), /WHERE session_id = '42'$/);
  assert.equal(V.valueOverallSql(table).includes('WHERE'), false);
  assert.match(V.sessionsSql(V.inspireSessionTable({ catalog: 'main', schema: 'inspire' })), /business_name, create_at FROM `main`\.`inspire`\.`__inspire_session`$/);
});
