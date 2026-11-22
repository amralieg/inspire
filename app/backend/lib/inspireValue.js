const VALUE_LEDGER_TABLE = '__inspire_value_ledger';
const LEDGER_COLUMNS = 'session_id, result_table, use_case_id, run_id, record_key, kind, currency, unit, at_stake, saved, recorded_at';
const TIME_UNITS = ['minutes', 'hours', 'days', 'weeks'];
const KIND_ORDER = ['money', 'time', 'count'];

const qualified = (parsedDb, table) => `\`${parsedDb.catalog}\`.\`${parsedDb.schema}\`.\`${table}\``;
const valueLedgerTable = (parsedDb) => qualified(parsedDb, VALUE_LEDGER_TABLE);

const ledgerRows = (table, where) => `ledger_rows AS (SELECT ${LEDGER_COLUMNS} FROM ${table}${where ? ` WHERE ${where}` : ''})`;

// A list of run ids (numeric only, validated by the caller) reads every run in one statement: the rows carry session_id and the
// latest-row ranking is per run. A single id keeps the single-run statement.
const idList = (ids, quote) => ids.map((id) => {
  if (!/^\d+$/.test(String(id))) throw new Error('session ids must be numeric');
  return quote ? `'${id}'` : String(id);
}).join(', ');

function valueSessionSql(table, sessionId) {
  const many = Array.isArray(sessionId);
  const sid = many ? 'session_id, ' : '';
  const part = many ? 'session_id, ' : '';
  return `WITH ${ledgerRows(table, many ? `session_id IN (${idList(sessionId, true)})` : `session_id = '${sessionId}'`)}, `
    + `stake AS (SELECT ${sid}use_case_id, kind, currency, unit, at_stake, ROW_NUMBER() OVER (PARTITION BY ${part}result_table, use_case_id `
    + 'ORDER BY recorded_at DESC, run_id DESC) AS rn FROM ledger_rows WHERE record_key IS NULL), '
    + `saved AS (SELECT ${sid}use_case_id, kind, currency, unit, saved, ROW_NUMBER() OVER (PARTITION BY ${part}result_table, use_case_id, record_key `
    + 'ORDER BY recorded_at DESC, run_id DESC) AS rn FROM ledger_rows WHERE record_key IS NOT NULL) '
    + `SELECT 'stake' AS part, ${sid}use_case_id, kind, currency, unit, SUM(at_stake) AS amount, `
    + `MAX(CASE WHEN at_stake IS NOT NULL THEN 1 ELSE 0 END) AS measured FROM stake WHERE rn = 1 GROUP BY ${sid}use_case_id, kind, currency, unit `
    + `UNION ALL SELECT 'saved' AS part, ${sid}use_case_id, kind, currency, unit, SUM(saved) AS amount, 0 AS measured `
    + `FROM saved WHERE rn = 1 AND saved IS NOT NULL GROUP BY ${sid}use_case_id, kind, currency, unit`;
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

module.exports = {
  valueLedgerTable, idList, valueSessionSql, valueOfSession, totalOf, qualified,
};
