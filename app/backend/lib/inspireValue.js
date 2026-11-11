const VALUE_LEDGER_TABLE = '__inspire_value_ledger';
const INSPIRE_SESSION_TABLE = '__inspire_session';
const LEDGER_SELECT = 'session_id, result_table, use_case_id, run_id, record_key, kind, currency, unit, at_stake, saved, recorded_at';
const TIME_UNITS = ['minutes', 'hours', 'days', 'weeks'];
const KIND_ORDER = ['money', 'time', 'count'];

const qualified = (parsedDb, table) => `\`${parsedDb.catalog}\`.\`${parsedDb.schema}\`.\`${table}\``;
const valueLedgerTable = (parsedDb) => qualified(parsedDb, VALUE_LEDGER_TABLE);
const inspireSessionTable = (parsedDb) => qualified(parsedDb, INSPIRE_SESSION_TABLE);

function valueSessionSql(table, sessionId) {
  return `SELECT ${LEDGER_SELECT} FROM ${table} WHERE session_id = '${sessionId}'`;
}

function valueOverallSql(table) {
  return `SELECT ${LEDGER_SELECT} FROM ${table}`;
}

function sessionsSql(table) {
  return `SELECT session_id, business_name, create_at FROM ${table}`;
}

function finite(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function partOf(row, measure) {
  const kind = String(row.kind || '');
  return { kind, unit: kind === 'money' ? String(row.currency || '') : String(row.unit || ''), amount: finite(row[measure]) };
}

function moment(value) {
  const time = Date.parse(String(value || '').replace(' ', 'T'));
  return Number.isNaN(time) ? 0 : time;
}

function newerThan(a, b) {
  if (a.at !== b.at) return a.at > b.at;
  return String(a.tie).padStart(24, '0') > String(b.tie).padStart(24, '0');
}

function latestBy(rows, keyOf) {
  const latest = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    const candidate = { at: moment(row.recorded_at), tie: row.run_id, row };
    const current = latest.get(key);
    if (!current || newerThan(candidate, current)) latest.set(key, candidate);
  }
  return [...latest.values()].map((c) => c.row);
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

function valueParts(rows) {
  const stakeRows = rows.filter((r) => r.record_key == null);
  const savedRows = rows.filter((r) => r.record_key != null);
  const useCaseStakes = new Map();
  const useCaseSaves = new Map();
  const bucket = (map, id) => {
    if (!map.has(id)) map.set(id, []);
    return map.get(id);
  };
  const stakeParts = [];
  const savedParts = [];
  const stakeLatest = latestBy(stakeRows, (r) => `${r.result_table}\u0000${r.use_case_id}`);
  for (const row of stakeLatest) {
    const part = partOf(row, 'at_stake');
    const id = String(row.use_case_id);
    bucket(useCaseStakes, id);
    if (part.amount != null) {
      useCaseStakes.get(id).push(part);
      stakeParts.push(part);
    }
  }
  const savedLatest = latestBy(savedRows, (r) => `${r.result_table}\u0000${r.use_case_id}\u0000${r.record_key}`);
  for (const row of savedLatest) {
    const part = partOf(row, 'saved');
    if (part.amount == null) continue;
    const id = String(row.use_case_id);
    bucket(useCaseSaves, id).push(part);
    savedParts.push(part);
  }
  const ids = new Set([...useCaseStakes.keys(), ...useCaseSaves.keys()]);
  const use_cases = {};
  let mvps_measured = 0;
  for (const id of [...ids].sort()) {
    const stake = useCaseStakes.get(id) || [];
    const measured = stake.length > 0;
    if (measured) mvps_measured += 1;
    use_cases[id] = { at_stake: totalOf(stake), saved: totalOf(useCaseSaves.get(id) || []), measured };
  }
  return { use_cases, run: { at_stake: totalOf(stakeParts), saved: totalOf(savedParts), mvps_measured }, stakeParts, savedParts };
}

function valueOfSession(rows) {
  const { use_cases, run } = valueParts(rows);
  return { use_cases, run };
}

function newerSession(a, b) {
  return newerThan({ at: moment(a.create_at), tie: a.session_id }, { at: moment(b.create_at), tie: b.session_id });
}

function overallValue(sessions, rows) {
  const bySession = new Map();
  for (const row of rows) {
    const id = String(row.session_id);
    if (!bySession.has(id)) bySession.set(id, []);
    bySession.get(id).push(row);
  }
  const latestOfBusiness = new Map();
  for (const session of sessions) {
    const business = String(session.business_name ?? '');
    const current = latestOfBusiness.get(business);
    if (!current || newerSession(session, current)) latestOfBusiness.set(business, session);
  }
  const atStake = [];
  const saved = [];
  for (const session of sessions) {
    const value = valueParts(bySession.get(String(session.session_id)) || []);
    if (latestOfBusiness.get(String(session.business_name ?? '')) === session) atStake.push(...value.stakeParts);
    saved.push(...value.savedParts);
  }
  return { at_stake: totalOf(atStake), saved: totalOf(saved), runs: sessions.length, businesses: latestOfBusiness.size };
}

module.exports = {
  valueLedgerTable, inspireSessionTable, valueSessionSql, valueOverallSql, sessionsSql, valueOfSession, overallValue, totalOf,
};
