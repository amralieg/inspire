const { parseExactJson } = require('./exactJson');
const { idList } = require('./inspireValue');
// REQ-078: a use case with no measured value shows an estimate from a Measure rule, never a number invented without one.
// The estimate is the KPI baseline times the per-record amount of a fixed-amount rule. Column and equation rules, and no rule
// at all, give no number: the App says what to do instead.

const finite = (value) => Number.isFinite(Number(value)) && value !== null && value !== '';
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const usableFixed = (rule) => rule.money.value.method === 'fixed' && finite(rule.money.value.amount) && Number(rule.money.value.amount) > 0;

// The rule an estimate reads. The use case's own rule wins whenever it names a value, even a column or equation rule (then the
// estimate says "cannot" and what to set). Otherwise the best borrowed rule: a sibling with a usable fixed amount, else the first
// sibling that has a value. `rules` arrive in order (own first, then siblings sorted by estimatesFor), so the pick is stable.
function pickRule(rules) {
  const valued = rules.filter((rule) => rule && rule.money && rule.money.value);
  if (!valued.length || !valued[0].borrowed) return valued[0] || null;
  return valued.find(usableFixed) || valued[0];
}

// rules: [{ app, money, borrowed }] in order: the use case's own App first (borrowed false), then siblings in the same domain.
function estimateOf({ measured = false, baseline = null, rules = [] } = {}) {
  if (measured) return null;
  const ruled = pickRule(rules);
  if (!ruled) return { status: 'set_rule' };
  const { app, money, borrowed = false } = ruled;
  const value = money.value;
  if (value.method !== 'fixed') return { status: 'cannot', app, method: value.method, borrowed: Boolean(borrowed) };
  if (!finite(baseline) || Number(baseline) <= 0) return { status: 'no_baseline', app };
  const perRecord = Number(value.amount);
  if (!finite(perRecord) || perRecord <= 0) return { status: 'cannot', app, method: value.method, borrowed: Boolean(borrowed) };
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

// One estimate per use case. Rules come from the use case's own spec first, then the specs of its siblings in the same domain.
// The baseline is only ever the use case's own: an unbuilt use case has none, so it shows no number.
async function estimatesFor({ useCases, specs, measured, baselineOf }) {
  const domainOf = new Map(useCases.map((row) => [String(row.id), String(row.business_domain || '')]));
  const out = {};
  for (const row of useCases) {
    const id = String(row.id);
    const own = specs.get(id) || null;
    // Siblings sort by App name, then id, so the borrowed rule never depends on the order the SQL happened to return rows in.
    const siblingRules = [...specs.entries()]
      .filter(([other, spec]) => other !== id && spec && domainOf.get(other) === domainOf.get(id))
      .map(([other, spec]) => ({ app: String(spec.use_case_name || other), money: spec.money, borrowed: true, sid: other }))
      .sort((a, b) => byText(a.app, b.app) || byText(a.sid, b.sid));
    const ownRule = own && own.money ? [{ app: String(own.use_case_name || id), money: own.money, borrowed: false }] : [];
    const rules = [...ownRule, ...siblingRules].filter((rule) => rule.money);
    const isMeasured = Boolean((measured && measured[id] && measured[id].measured) || discoveredMeasured(row));
    const table = own && own.config && own.config.result_table;
    const baseline = isMeasured || !rules.length || !table ? null : await baselineOf(String(table), id);
    out[id] = estimateOf({ measured: isMeasured, baseline, rules });
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
