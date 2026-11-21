// REQ-439 (C6): run and all-runs value totals that include the values saved through Calculate. Per use case: the latest saved answers
// (shape 2 calculated or estimated, an older shape estimated), else the rule estimate, else none. Amounts add only inside one currency.
const VA = require('./valueAnswers');

const round2 = (n) => Math.round(n * 100) / 100;
const finite = (v) => v !== null && v !== undefined && v !== '' && typeof v !== 'boolean' && Number.isFinite(Number(v));
const FALLBACK_VERB = 'VALUE AT STAKE';

// The latest saved answers of the run: valueAnswers.latestSql is the one place that picks the newest version (undo rows included).
const answersSql = (table, sessionId) => VA.latestSql(table, sessionId);

// The run list for the all-runs read: newest first, one row past the cap so the caller can tell the list was cut.
const sessionsSql = (sessionTable, cap) => `SELECT CAST(session_id AS STRING) AS session_id, business_name, CAST(create_at AS STRING) AS create_at FROM ${sessionTable} ORDER BY create_at DESC LIMIT ${Number(cap) + 1}`;

const tablesSql = (usecasesTable, sid) => `SELECT id, primary_table FROM ${usecasesTable} WHERE session_id = ${sid}`;

// One use case: {status, verb, amount, currency}. saved = VA.versionOf(row) or null; estimate = the valueEstimate entry or null.
function useCaseOf({ saved = null, estimate = null, hasTable = true } = {}) {
  const yearly = saved && saved.yearly;
  const amount = yearly && yearly.total && yearly.total.amount;
  if (finite(amount)) {
    const shape2 = Boolean(saved.answers && saved.answers.shape === 2);
    const calculated = shape2 && Boolean(yearly.calculated ?? saved.answers.calculated);
    const currency = String(yearly.currency ?? (saved.answers && saved.answers.currency) ?? yearly.total.unit ?? '');
    const verb = String(yearly.verb || (yearly.parts && yearly.parts[0] && yearly.parts[0].verb) || FALLBACK_VERB);
    return { status: calculated ? 'calculated' : 'estimated', verb, amount: Number(amount), currency };
  }
  if (estimate && estimate.status === 'estimated' && finite(estimate.amount)) {
    return { status: 'estimated', verb: FALLBACK_VERB, amount: Number(estimate.amount), currency: String(estimate.currency || '') };
  }
  return { status: hasTable ? 'none' : 'no_data', verb: '', amount: null, currency: '' };
}

// Add up use cases per currency: calculated and estimated apart, amount their sum.
function totalsOf(entries) {
  const byCurrency = new Map();
  for (const e of entries) {
    if (e.status !== 'calculated' && e.status !== 'estimated') continue;
    const row = byCurrency.get(e.currency) || { currency: e.currency, amount: 0, calculated: 0, estimated: 0 };
    row[e.status] = round2(row[e.status] + e.amount);
    row.amount = round2(row.calculated + row.estimated);
    byCurrency.set(e.currency, row);
  }
  return [...byCurrency.values()].sort((a, b) => (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0));
}

function summarize(useCases) {
  const entries = Object.values(useCases);
  const count = (status) => entries.filter((e) => e.status === status).length;
  const verbs = new Map();
  for (const e of entries) {
    if (e.status !== 'calculated' && e.status !== 'estimated') continue;
    const key = `${e.currency}\u0000${e.verb}`;
    const row = verbs.get(key) || { currency: e.currency, verb: e.verb, amount: 0 };
    row.amount = round2(row.amount + e.amount);
    verbs.set(key, row);
  }
  return {
    totals: totalsOf(entries), n: entries.length, n_calculated: count('calculated'), n_estimated: count('estimated'),
    n_none: entries.length - count('calculated') - count('estimated'), by_verb: [...verbs.values()],
  };
}

// The runs added up for the all-runs badge: same currency only.
function mergeRuns(runs) {
  const entries = [];
  for (const run of runs) {
    for (const t of run.totals) {
      entries.push({ status: 'calculated', currency: t.currency, amount: t.calculated });
      entries.push({ status: 'estimated', currency: t.currency, amount: t.estimated });
    }
  }
  return { totals: totalsOf(entries), n_calculated: runs.reduce((s, r) => s + r.n_calculated, 0), n_estimated: runs.reduce((s, r) => s + r.n_estimated, 0) };
}

// useCases: [{id}] of the run; savedOf: Map id -> versionOf; estimates: {id: estimate}; noTable: Set of ids without a primary table.
function runOf({ ids, saved, estimates, noTable }) {
  const useCases = {};
  for (const id of ids) useCases[id] = useCaseOf({ saved: saved.get(id) || null, estimate: estimates[id] || null, hasTable: !noTable.has(id) });
  return { run: summarize(useCases), use_cases: useCases };
}

module.exports = { answersSql, sessionsSql, tablesSql, useCaseOf, totalsOf, summarize, mergeRuns, runOf };
