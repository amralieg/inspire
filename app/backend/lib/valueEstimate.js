// REQ-078: a use case with no measured value shows an estimate from a Measure rule, never a number invented without one.
// The estimate is the KPI baseline times the per-record amount of a fixed-amount rule. Column and equation rules, and no rule
// at all, give no number: the App says what to do instead.

const finite = (value) => Number.isFinite(Number(value)) && value !== null && value !== '';

// rules: [{ app, money }] in order of preference: the use case's own App first, then the App of a sibling in the same domain.
function estimateOf({ measured = false, baseline = null, rules = [] } = {}) {
  if (measured) return null;
  const ruled = rules.find((rule) => rule && rule.money && rule.money.value);
  if (!ruled) return { status: 'set_rule' };
  const { app, money } = ruled;
  const value = money.value;
  if (value.method !== 'fixed') return { status: 'cannot', app, method: value.method };
  if (!finite(baseline) || Number(baseline) <= 0) return { status: 'no_baseline', app };
  const perRecord = Number(value.amount);
  if (!finite(perRecord) || perRecord <= 0) return { status: 'cannot', app, method: value.method };
  const currency = value.currency !== undefined ? value.currency : (money.base || '');
  return { status: 'estimated', app, currency, per_record: perRecord, baseline: Number(baseline), amount: Math.round(Number(baseline) * perRecord * 100) / 100 };
}

// Totals keep measured money and estimated money apart, per currency; an estimate is never summed into a measured total.
function totalsOf(estimates) {
  const estimated = {};
  for (const e of estimates) {
    if (!e || e.status !== 'estimated') continue;
    estimated[e.currency] = Math.round(((estimated[e.currency] || 0) + e.amount) * 100) / 100;
  }
  return { estimated };
}

// The rows the estimate route reads. Each takes already-qualified table names; ids are validated by the caller.
function useCasesSql(table, sid) {
  return `SELECT id, business_domain FROM ${table} WHERE session_id = ${sid}`;
}

// The latest spec of every use case in the session, which carries its Measure rule (money) and its result table (config).
function latestSpecsSql(table, sid) {
  return 'WITH named AS (SELECT use_case_id, CAST(spec_json AS STRING) AS spec, '
    + `ROW_NUMBER() OVER (PARTITION BY use_case_id ORDER BY spec_version DESC) AS latest FROM ${table} WHERE session_id = ${sid}) `
    + 'SELECT use_case_id, spec FROM named WHERE latest = 1';
}

// The KPI baseline a use case was measured at, in its own result table's summary (written when its App measures the KPI).
function baselineSql(summaryTable) {
  return `SELECT kpi_baseline FROM ${summaryTable} WHERE use_case_id = :uc ORDER BY updated_at DESC NULLS LAST LIMIT 1`;
}

function parseSpec(raw) {
  if (raw && typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(String(raw || 'null'));
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
    const siblingRules = [...specs.entries()]
      .filter(([other, spec]) => other !== id && spec && domainOf.get(other) === domainOf.get(id))
      .map(([other, spec]) => ({ app: String(spec.use_case_name || other), money: spec.money }));
    const ownRule = own && own.money ? [{ app: String(own.use_case_name || id), money: own.money }] : [];
    const rules = [...ownRule, ...siblingRules].filter((rule) => rule.money);
    const isMeasured = Boolean(measured && measured[id] && measured[id].measured);
    const table = own && own.config && own.config.result_table;
    const baseline = isMeasured || !rules.length || !table ? null : await baselineOf(String(table), id);
    out[id] = estimateOf({ measured: isMeasured, baseline, rules });
  }
  return { use_cases: out, totals: totalsOf(Object.values(out)) };
}

module.exports = { estimateOf, totalsOf, useCasesSql, latestSpecsSql, baselineSql, parseSpec, estimatesFor };
