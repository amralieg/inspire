const test = require('node:test');
const assert = require('node:assert/strict');

const V = require('../lib/inspireValue');

let DatabaseSync = null;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  DatabaseSync = null;
}
const SKIP = DatabaseSync ? false : 'node:sqlite is not available in this Node';

const LEDGER_DDL = 'CREATE TABLE ledger_t (session_id TEXT, result_table TEXT, use_case_id TEXT, run_id TEXT, record_key TEXT, '
  + 'kind TEXT, currency TEXT, unit TEXT, at_stake REAL, saved REAL, recorded_at TEXT)';

function engine(ledger, sessions = []) {
  const db = new DatabaseSync(':memory:');
  db.exec(LEDGER_DDL);
  db.exec('CREATE TABLE sessions_t (session_id INTEGER, business_name TEXT, create_at TEXT)');
  const insert = db.prepare('INSERT INTO ledger_t VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const r of ledger) insert.run(...r);
  const insertSession = db.prepare('INSERT INTO sessions_t VALUES (?, ?, ?)');
  for (const s of sessions) insertSession.run(...s);
  return db;
}

// sqlite has no STRING type, so the one Spark-only cast is spelled TEXT for this engine; nothing else changes.
const onSqlite = (sql) => sql.replace(/AS STRING\)/g, 'AS TEXT)');
const rowsOf = (db, sql) => db.prepare(onSqlite(sql)).all();

const stake = (session, uc, kind, unit, amount, at, run = '9001', result = 'main.out.queue') => (
  [session, result, uc, run, null, kind, kind === 'money' ? unit : null, kind === 'money' ? null : unit, amount, null, at]);
const saved = (session, uc, key, kind, unit, amount, at, result = 'main.out.queue') => (
  [session, result, uc, '9001', key, kind, kind === 'money' ? unit : null, kind === 'money' ? null : unit, null, amount, at]);
const entry = (kind, unit, amount) => ({ kind, unit, amount });

test('a run keeps two currencies and two time units apart and converts only within one total', { skip: SKIP }, () => {
  const db = engine([
    stake('42', 'N01-U01', 'money', 'EUR', 1000, '2026-11-10 10:00:00'),
    stake('42', 'N02-U01', 'money', 'USD', 500, '2026-11-10 10:01:00'),
    stake('42', 'N03-U01', 'time', 'hours', 4, '2026-11-10 10:02:00'),
    stake('42', 'N04-U01', 'time', 'days', 2, '2026-11-10 10:03:00'),
    saved('42', 'N01-U01', 'rec-1', 'money', 'EUR', 250, '2026-11-10 11:00:00'),
    saved('42', 'N02-U01', 'rec-2', 'money', 'USD', 75, '2026-11-10 11:00:00'),
  ]);
  const run = V.valueOfSession(rowsOf(db, V.valueSessionSql('ledger_t', '42')));
  assert.deepEqual(run.run.at_stake, [entry('money', 'EUR', 1000), entry('money', 'USD', 500), entry('time', 'hours', 52)]);
  assert.deepEqual(run.run.saved, [entry('money', 'EUR', 250), entry('money', 'USD', 75)]);
  assert.equal(run.run.mvps_measured, 4);
  assert.deepEqual(run.use_cases['N01-U01'], { at_stake: [entry('money', 'EUR', 1000)], saved: [entry('money', 'EUR', 250)], measured: true });
});

test('the latest MVP run of a use case counts, a cleared save leaves the total, and a not measured use case has no entry', { skip: SKIP }, () => {
  const db = engine([
    stake('41', 'N01-U01', 'money', 'EUR', 100, '2026-11-09 10:00:00', '8001'),
    stake('42', 'N01-U01', 'money', 'EUR', 300, '2026-11-10 10:00:00', '9001'),
    stake('42', 'N07-U01', 'money', 'EUR', null, '2026-11-10 10:00:00', '9001'),
    saved('42', 'N01-U01', 'rec-b', 'money', 'EUR', 20, '2026-11-10 11:00:00'),
    saved('42', 'N01-U01', 'rec-b', 'money', 'EUR', null, '2026-11-10 12:30:00'),
    saved('42', 'N01-U01', 'rec-c', 'money', 'EUR', 40, '2026-11-10 11:30:00'),
    saved('42', 'N01-U01', 'rec-c', 'money', 'EUR', 55, '2026-11-10 12:00:00'),
  ]);
  const session42 = V.valueOfSession(rowsOf(db, V.valueSessionSql('ledger_t', '42')));
  assert.deepEqual(session42.run.at_stake, [entry('money', 'EUR', 300)]);
  assert.deepEqual(session42.run.saved, [entry('money', 'EUR', 55)], 'rec-b was cleared and rec-c kept its newest amount');
  assert.deepEqual(session42.use_cases['N07-U01'], { at_stake: [], saved: [], measured: false });
  assert.equal(session42.run.mvps_measured, 1);
  const session41 = V.valueOfSession(rowsOf(db, V.valueSessionSql('ledger_t', '41')));
  assert.deepEqual(session41.run.at_stake, [entry('money', 'EUR', 100)]);
});

test('the runs route groups by run and keeps each run its own currencies and units', { skip: SKIP }, () => {
  const db = engine([
    stake('41', 'N01-U01', 'money', 'EUR', 100, '2026-11-08 10:00:00', '8001'),
    stake('42', 'N01-U01', 'money', 'USD', 300, '2026-11-10 10:00:00', '9001'),
    stake('42', 'N02-U01', 'time', 'days', 1, '2026-11-10 10:00:00', '9001'),
    stake('42', 'N03-U01', 'time', 'hours', 2, '2026-11-10 10:00:00', '9001'),
    saved('42', 'N02-U01', 'rec-1', 'time', 'hours', 1, '2026-11-10 11:00:00'),
  ]);
  const runs = V.valueOfRuns(rowsOf(db, V.valueRunsSql('ledger_t'))).runs;
  assert.deepEqual(Object.keys(runs), ['41', '42']);
  assert.deepEqual(runs['41'], { at_stake: [entry('money', 'EUR', 100)], saved: [], mvps_measured: 1 });
  assert.deepEqual(runs['42'], {
    at_stake: [entry('money', 'USD', 300), entry('time', 'hours', 26)], saved: [entry('time', 'hours', 1)], mvps_measured: 3,
  });
});

test('overall at stake counts only the latest run of each business, saved counts every run, and counts come from the session table', { skip: SKIP }, () => {
  const sessions = [[41, 'Acme', '2026-11-08 09:00:00'], [42, 'Acme', '2026-11-10 09:00:00'], [43, 'Globex', '2026-11-09 09:00:00']];
  const db = engine([
    stake('41', 'N01-U01', 'money', 'EUR', 100, '2026-11-08 10:00:00', '8001'),
    stake('42', 'N01-U01', 'money', 'EUR', 300, '2026-11-10 10:00:00', '9001'),
    stake('43', 'N09-U01', 'money', 'EUR', 50, '2026-11-09 10:00:00', '9002'),
    saved('41', 'N01-U01', 'a', 'money', 'EUR', 10, '2026-11-08 11:00:00'),
    saved('42', 'N01-U01', 'b', 'money', 'EUR', 20, '2026-11-10 11:00:00'),
  ], sessions);
  const totals = rowsOf(db, V.valueOverallSql('ledger_t', 'sessions_t'));
  const counts = rowsOf(db, V.sessionCountsSql('sessions_t'))[0];
  const overall = V.overallValue(totals, counts);
  assert.deepEqual(overall.at_stake, [entry('money', 'EUR', 350)], 'the older Acme run (100) is not added to its latest (300)');
  assert.deepEqual(overall.saved, [entry('money', 'EUR', 30)]);
  assert.equal(overall.runs, 3);
  assert.equal(overall.businesses, 2);
});

test('an empty ledger and an empty session table give empty totals', { skip: SKIP }, () => {
  const db = engine([], []);
  assert.deepEqual(V.valueOfSession(rowsOf(db, V.valueSessionSql('ledger_t', '42'))), { use_cases: {}, run: { at_stake: [], saved: [], mvps_measured: 0 } });
  assert.deepEqual(V.valueOfRuns(rowsOf(db, V.valueRunsSql('ledger_t'))), { runs: {} });
  assert.deepEqual(V.overallValue(rowsOf(db, V.valueOverallSql('ledger_t', 'sessions_t')), rowsOf(db, V.sessionCountsSql('sessions_t'))[0]),
    { at_stake: [], saved: [], runs: 0, businesses: 0 });
});

test('every value query aggregates in SQL: no statement returns the raw ledger rows', () => {
  for (const sql of [V.valueSessionSql('t', '42'), V.valueRunsSql('t'), V.valueOverallSql('t', 's')]) {
    assert.match(sql, /GROUP BY/);
    assert.match(sql, /ROW_NUMBER\(\) OVER/);
    assert.doesNotMatch(sql, /^SELECT .* FROM t\s*$/);
  }
  assert.match(V.valueRunsSql('t'), /WHERE rn = 1/);
});
