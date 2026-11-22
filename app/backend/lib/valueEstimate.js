const { parseExactJson } = require('./exactJson');
const { idList } = require('./inspireValue');
// REQ-078: a use case with no measured value shows an estimate from a Measure rule, never a number invented without one.
// The estimate is the KPI baseline times the per-record amount of a fixed-amount rule. Column and equation rules, and no rule
// at all, give no number: the App says what to do instead.

const finite = (value) => Number.isFinite(Number(value)) && value !== null && value !== '';


// FX-48 (REQ-448, REQ-431): the rule an estimate reads is the use case's own, never a sibling's. A borrowed rate gave unrelated
// use cases the same figure (W17 D42). With no rule of its own the use case shows no number.
function pickRule(rules) {
  return rules.find((rule) => rule && rule.money && rule.money.value) || null;
}

// rules: [{ app, money }]: the use case's own App rule.
function estimateOf({ measured = false, baseline = null, rules = [] } = {}) {
  if (measured) return null;
  const ruled = pickRule(rules);
  if (!ruled) return { status: 'set_rule' };
  const { app, money } = ruled;
  const value = money.value;
  if (value.method !== 'fixed') return { status: 'cannot', app, method: value.method, borrowed: false };
  if (!finite(baseline) || Number(baseline) <= 0) return { status: 'no_baseline', app };
  const perRecord = Number(value.amount);
  if (!finite(perRecord) || perRecord <= 0) return { status: 'cannot', app, method: value.method, borrowed: false };
  const currency = value.currency !== undefined ? value.currency : (money.base || '');
  return { status: 'estimated', app, currency, per_record: perRecord, baseline: Number(baseline), amount: Math.round(Number(baseline) * perRecord * 100) / 100 };
}

// Totals keep measured money and estimated money apart, per currency; an estimate is never summed into a measured total.
function totalsOf(estimates) {
  const estimated = {};
  const seen = new Set();
  for (const e of estimates) {
    if (!e || e.status !== 'estimated') continue;
    // REQ-454: one rule over one baseline is one pool of money, counted once.
    const key = `${e.currency}|${e.app}|${e.per_record}|${e.baseline}`;
    if (seen.has(key)) continue;
    seen.add(key);
    estimated[e.currency] = Math.round(((estimated[e.currency] || 0) + e.amount) * 100) / 100;
  }
  return { estimated };
}

// The rows the estimate route reads. Each takes already-qualified table names; ids are validated by the caller.
// sid is one run id, or a list of run ids: the list form reads every run in one statement and each row carries its session_id.
const listed = (sid) => Array.isArray(sid);
function useCasesSql(table, sid) {
  return listed(sid)
    ? `SELECT CAST(session_id AS STRING) AS session_id, id, business_domain, CAST(value_estimate AS STRING) AS value_estimate FROM ${table} WHERE session_id IN (${idList(sid)})`
    : `SELECT id, business_domain, CAST(value_estimate AS STRING) AS value_estimate FROM ${table} WHERE session_id = ${sid}`;
}

// The latest spec of every use case in the session, which carries its Measure rule (money) and its result table (config).
function latestSpecsSql(table, sid) {
  const many = listed(sid);
  return `WITH named AS (SELECT ${many ? 'CAST(session_id AS STRING) AS session_id, ' : ''}use_case_id, CAST(spec_json AS STRING) AS spec, `
    + `ROW_NUMBER() OVER (PARTITION BY ${many ? 'session_id, ' : ''}use_case_id ORDER BY spec_version DESC) AS latest FROM ${table} WHERE session_id ${many ? `IN (${idList(sid)})` : `= ${sid}`}) `
    + `SELECT ${many ? 'session_id, ' : ''}use_case_id, spec FROM named WHERE latest = 1`;
}

// The KPI baseline a use case was measured at, in its own result table's summary (written when its App measures the KPI).
function baselineSql(summaryTable) {
  return `SELECT kpi_baseline FROM ${summaryTable} WHERE use_case_id = :uc ORDER BY updated_at DESC NULLS LAST LIMIT 1`;
}

// Discover writes each use case's own value estimate on its row. Status "measured" means its KPI query read a money total, so the
// figure is measured (the value ledger may not hold it yet) and no rule estimate may replace it.
function discoveredMeasured(row) {
  const raw = row && row.value_estimate;
  const parsed = raw && typeof raw === 'object' ? raw : parseSpec(raw);
  return Boolean(parsed && parsed.status === 'measured');
}

function parseSpec(raw) {
  if (raw && typeof raw === 'object') return raw;
  try {
    const parsed = parseExactJson(String(raw || 'null'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

// One estimate per use case, from its own spec's rule and its own baseline. A use case with no rule of its own is "set a rule",
// with no baseline read. When two use cases have the same rule and baseline, the later one says which it shares with.
async function estimatesFor({ useCases, specs, measured, baselineOf }) {
  const out = {};
  const firstOf = new Map();
  for (const row of useCases) {
    const id = String(row.id);
    const own = specs.get(id) || null;
    const rules = own && own.money ? [{ app: String(own.use_case_name || id), money: own.money }] : [];
    const isMeasured = Boolean((measured && measured[id] && measured[id].measured) || discoveredMeasured(row));
    const table = own && own.config && own.config.result_table;
    const baseline = isMeasured || !rules.length || !table ? null : await baselineOf(String(table), id);
    const estimate = estimateOf({ measured: isMeasured, baseline, rules });
    if (estimate && estimate.status === 'estimated') {
      const key = `${estimate.currency}|${estimate.app}|${estimate.per_record}|${estimate.baseline}`;
      if (firstOf.has(key)) estimate.shares_with = firstOf.get(key);
      else firstOf.set(key, id);
    }
    out[id] = estimate;
  }
  return { use_cases: out, totals: totalsOf(Object.values(out)) };
}

// Every session that has use cases, for the all-runs read (the banner and the Start cards).
// The runs the Start list shows, newest first: the cap plus one row, so the caller can tell the list was cut.
function sessionsSql(sessionTable, cap) {
  return `SELECT CAST(session_id AS STRING) AS session_id FROM ${sessionTable} ORDER BY create_at DESC LIMIT ${Number(cap) + 1}`;
}

// Totals from several runs, added per currency. Estimated money stays estimated; it is only ever added to other estimates.
function mergeTotals(list) {
  const estimated = {};
  for (const totals of list) {
    for (const [code, amount] of Object.entries((totals && totals.estimated) || {})) {
      estimated[code] = Math.round(((estimated[code] || 0) + Number(amount)) * 100) / 100;
    }
  }
  return { estimated };
}

module.exports = { estimateOf, totalsOf, useCasesSql, latestSpecsSql, baselineSql, parseSpec, discoveredMeasured, estimatesFor, sessionsSql, mergeTotals };
