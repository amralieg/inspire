const VALUE_LEDGER_TABLE = '__inspire_value_ledger';
const INSPIRE_SESSION_TABLE = '__inspire_session';
const LEDGER_COLUMNS = 'session_id, result_table, use_case_id, run_id, record_key, kind, currency, unit, at_stake, saved, recorded_at';
const TIME_UNITS = ['minutes', 'hours', 'days', 'weeks'];
const KIND_ORDER = ['money', 'time', 'count'];

const qualified = (parsedDb, table) => `\`${parsedDb.catalog}\`.\`${parsedDb.schema}\`.\`${table}\``;
const valueLedgerTable = (parsedDb) => qualified(parsedDb, VALUE_LEDGER_TABLE);
const inspireSessionTable = (parsedDb) => qualified(parsedDb, INSPIRE_SESSION_TABLE);

const ledgerRows = (table, where) => `ledger_rows AS (SELECT ${LEDGER_COLUMNS} FROM ${table}${where ? ` WHERE ${where}` : ''})`;

function valueSessionSql(table, sessionId) {
  return `WITH ${ledgerRows(table, `session_id = '${sessionId}'`)}, `
    + 'stake AS (SELECT use_case_id, kind, currency, unit, at_stake, ROW_NUMBER() OVER (PARTITION BY result_table, use_case_id '
    + 'ORDER BY recorded_at DESC, run_id DESC) AS rn FROM ledger_rows WHERE record_key IS NULL), '
    + 'saved AS (SELECT use_case_id, kind, currency, unit, saved, ROW_NUMBER() OVER (PARTITION BY result_table, use_case_id, record_key '
    + 'ORDER BY recorded_at DESC, run_id DESC) AS rn FROM ledger_rows WHERE record_key IS NOT NULL) '
    + "SELECT 'stake' AS part, use_case_id, kind, currency, unit, SUM(at_stake) AS amount, "
    + 'MAX(CASE WHEN at_stake IS NOT NULL THEN 1 ELSE 0 END) AS measured FROM stake WHERE rn = 1 GROUP BY use_case_id, kind, currency, unit '
    + "UNION ALL SELECT 'saved' AS part, use_case_id, kind, currency, unit, SUM(saved) AS amount, 0 AS measured "
    + 'FROM saved WHERE rn = 1 AND saved IS NOT NULL GROUP BY use_case_id, kind, currency, unit';
}

function valueRunsSql(table) {
  return `WITH ${ledgerRows(table, '')}, `
    + 'stake AS (SELECT session_id, use_case_id, kind, currency, unit, at_stake, ROW_NUMBER() OVER (PARTITION BY session_id, result_table, '
    + 'use_case_id ORDER BY recorded_at DESC, run_id DESC) AS rn FROM ledger_rows WHERE record_key IS NULL), '
    + 'saved AS (SELECT session_id, kind, currency, unit, saved, ROW_NUMBER() OVER (PARTITION BY session_id, result_table, use_case_id, '
    + 'record_key ORDER BY recorded_at DESC, run_id DESC) AS rn FROM ledger_rows WHERE record_key IS NOT NULL) '
    + "SELECT 'stake' AS part, session_id, kind, currency, unit, SUM(at_stake) AS amount FROM stake WHERE rn = 1 "
    + 'GROUP BY session_id, kind, currency, unit '
    + "UNION ALL SELECT 'saved' AS part, session_id, kind, currency, unit, SUM(saved) AS amount FROM saved WHERE rn = 1 "
    + 'AND saved IS NOT NULL GROUP BY session_id, kind, currency, unit '
    + "UNION ALL SELECT 'measured' AS part, session_id, NULL AS kind, NULL AS currency, NULL AS unit, "
    + 'COUNT(DISTINCT use_case_id) AS amount FROM stake WHERE rn = 1 AND at_stake IS NOT NULL GROUP BY session_id';
}

function valueOverallSql(table, sessionsTable) {
  return `WITH latest_sessions AS (SELECT CAST(session_id AS STRING) AS session_id FROM (SELECT session_id, ROW_NUMBER() OVER `
    + `(PARTITION BY COALESCE(business_name, '') ORDER BY create_at DESC, session_id DESC) AS rn FROM ${sessionsTable}) ranked WHERE rn = 1), `
    + `${ledgerRows(table, '')}, `
    + 'stake AS (SELECT kind, currency, unit, at_stake, ROW_NUMBER() OVER (PARTITION BY session_id, result_table, use_case_id '
    + 'ORDER BY recorded_at DESC, run_id DESC) AS rn FROM ledger_rows WHERE record_key IS NULL '
    + 'AND session_id IN (SELECT session_id FROM latest_sessions)), '
    + 'saved AS (SELECT kind, currency, unit, saved, ROW_NUMBER() OVER (PARTITION BY session_id, result_table, use_case_id, record_key '
    + 'ORDER BY recorded_at DESC, run_id DESC) AS rn FROM ledger_rows WHERE record_key IS NOT NULL) '
    + "SELECT 'stake' AS part, kind, currency, unit, SUM(at_stake) AS amount FROM stake WHERE rn = 1 GROUP BY kind, currency, unit "
    + "UNION ALL SELECT 'saved' AS part, kind, currency, unit, SUM(saved) AS amount FROM saved WHERE rn = 1 AND saved IS NOT NULL "
    + 'GROUP BY kind, currency, unit';
}

function sessionCountsSql(sessionsTable) {
  return `SELECT COUNT(*) AS runs, COUNT(DISTINCT COALESCE(business_name, '')) AS businesses FROM ${sessionsTable}`;
}

function finite(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function partOf(row) {
  const kind = String(row.kind || '');
  return { kind, unit: kind === 'money' ? String(row.currency || '') : String(row.unit || ''), amount: finite(row.amount) };
}

function round(value) {
  return Math.round(value * 1e6) / 1e6;
}

function totalOf(parts) {
  const money = new Map();
  const time = new Map();
  const count = new Map();
  const add = (map, unit, amount) => map.set(unit, (map.get(unit) || 0) + amount);
  for (const part of parts) {
    if (part.amount == null || !part.unit) continue;
    if (part.kind === 'money') add(money, part.unit, part.amount);
    else if (part.kind === 'time') add(time, part.unit, part.amount);
    else if (part.kind === 'count') add(count, part.unit, part.amount);
  }
  if (time.has('weeks')) {
    add(time, 'days', time.get('weeks') * 7);
    time.delete('weeks');
  }
  if (time.has('minutes')) {
    add(time, 'hours', time.get('minutes') / 60);
    time.delete('minutes');
  }
  if (time.has('days') && time.has('hours')) {
    add(time, 'hours', time.get('days') * 24);
    time.delete('days');
  }
  const unitOrder = (unit) => (TIME_UNITS.indexOf(unit) === -1 ? TIME_UNITS.length : TIME_UNITS.indexOf(unit));
  const entries = [];
  for (const [unit, amount] of [...money].sort(([a], [b]) => a.localeCompare(b))) entries.push({ kind: 'money', unit, amount: round(amount) });
  for (const [unit, amount] of [...time].sort(([a], [b]) => unitOrder(a) - unitOrder(b) || a.localeCompare(b))) {
    entries.push({ kind: 'time', unit, amount: round(amount) });
  }
  for (const [unit, amount] of [...count].sort(([a], [b]) => a.localeCompare(b))) entries.push({ kind: 'count', unit, amount: round(amount) });
  return entries.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
}

function valueOfSession(rows) {
  const useCases = new Map();
  const stakeParts = [];
  const savedParts = [];
  const useCaseOf = (id) => {
    if (!useCases.has(id)) useCases.set(id, { stake: [], saved: [], measured: false });
    return useCases.get(id);
  };
  for (const row of rows) {
    const id = String(row.use_case_id);
    const part = partOf(row);
    if (row.part === 'stake') {
      const current = useCaseOf(id);
      if (Number(row.measured) === 1) current.measured = true;
      if (part.amount != null) {
        current.stake.push(part);
        stakeParts.push(part);
      }
    } else if (row.part === 'saved' && part.amount != null) {
      useCaseOf(id).saved.push(part);
      savedParts.push(part);
    }
  }
  const use_cases = {};
  let mvps_measured = 0;
  for (const id of [...useCases.keys()].sort()) {
    const current = useCases.get(id);
    if (current.measured) mvps_measured += 1;
    use_cases[id] = { at_stake: totalOf(current.stake), saved: totalOf(current.saved), measured: current.measured };
  }
  return { use_cases, run: { at_stake: totalOf(stakeParts), saved: totalOf(savedParts), mvps_measured } };
}

function valueOfRuns(rows) {
  const runs = new Map();
  const bucket = (id) => {
    if (!runs.has(id)) runs.set(id, { stake: [], saved: [], mvps_measured: 0 });
    return runs.get(id);
  };
  for (const row of rows) {
    const id = String(row.session_id);
    const part = partOf(row);
    if (row.part === 'measured') bucket(id).mvps_measured = finite(row.amount) || 0;
    else if (part.amount != null && row.part === 'stake') bucket(id).stake.push(part);
    else if (part.amount != null && row.part === 'saved') bucket(id).saved.push(part);
  }
  const out = {};
  for (const id of [...runs.keys()].sort()) {
    const current = runs.get(id);
    out[id] = { at_stake: totalOf(current.stake), saved: totalOf(current.saved), mvps_measured: current.mvps_measured };
  }
  return { runs: out };
}

function overallValue(rows, counts) {
  const stake = rows.filter((r) => r.part === 'stake').map(partOf);
  const saved = rows.filter((r) => r.part === 'saved').map(partOf);
  return {
    at_stake: totalOf(stake),
    saved: totalOf(saved),
    runs: Number((counts || {}).runs) || 0,
    businesses: Number((counts || {}).businesses) || 0,
  };
}

module.exports = {
  valueLedgerTable, inspireSessionTable, valueSessionSql, valueRunsSql, valueOverallSql, sessionCountsSql,
  valueOfSession, valueOfRuns, overallValue, totalOf,
};
