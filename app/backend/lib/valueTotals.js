// REQ-439 (C6): run and all-runs value totals that include the values saved through Calculate. Per use case: the latest saved answers
// (shape 2 calculated or estimated, an older shape estimated), else the rule estimate, else none. Amounts add only inside one currency.
const VA = require('./valueAnswers');
const { idList } = require('./inspireValue');
const VP = require('./valuePlausibility');
const OV = require('./valueOverlap');

const round2 = (n) => Math.round(n * 100) / 100;
const finite = (v) => v !== null && v !== undefined && v !== '' && typeof v !== 'boolean' && Number.isFinite(Number(v));
const FALLBACK_VERB = 'VALUE AT STAKE';

// The latest saved answers of the run: valueAnswers.latestSql is the one place that picks the newest version (undo rows included).
const answersSql = (table, sessionId) => VA.latestSql(table, sessionId);

// The run list for the all-runs read: newest first, one row past the cap so the caller can tell the list was cut.
const sessionsSql = (sessionTable, cap) => `SELECT CAST(session_id AS STRING) AS session_id, business_name, CAST(create_at AS STRING) AS create_at FROM ${sessionTable} ORDER BY create_at DESC LIMIT ${Number(cap) + 1}`;

// sid is one run id, or a list of run ids (rows then carry session_id).
const tablesSql = (usecasesTable, sid) => (Array.isArray(sid)
  ? `SELECT CAST(session_id AS STRING) AS session_id, id, primary_table FROM ${usecasesTable} WHERE session_id IN (${idList(sid)})`
  : `SELECT id, primary_table FROM ${usecasesTable} WHERE session_id = ${sid}`);

// REQ-440: the money of a measured yearly ({verb, entries: [{kind, unit, amount}]}): its first money entry, or null when it has none.
function measuredOf(yearly) {
  const entry = yearly && Array.isArray(yearly.entries) ? yearly.entries.find((e) => e && e.kind === 'money' && finite(e.amount)) : null;
  return entry ? { status: 'measured', verb: String(yearly.verb || FALLBACK_VERB), amount: Number(entry.amount), currency: String(entry.unit || '') } : null;
}

// The overlap keys and the plausibility check ride on the entry without being part of the reply (non-enumerable); mergeRuns reads them back.
const withHidden = (entry, keys) => Object.defineProperty(entry, 'keys', { value: keys, enumerable: false, writable: true });
function flagged(entry) {
  const check = VP.checkOf({ currency: entry.currency, total: { unit: entry.currency, amount: entry.amount }, parts: entry.parts || [] });
  if (check.outside) entry.check = check;
  return entry;
}

// One use case: {status, verb, amount, currency}. saved = VA.versionOf(row) or null; estimate = the valueEstimate entry or null;
// measured = the measured yearly of the use case's MVP or null (it wins over both).
function useCaseOf({ saved = null, estimate = null, measured = null, hasTable = true, table = '' } = {}) {
  const money = measuredOf(measured);
  if (money) return withHidden(flagged(money), OV.wholeKeys(table, 'measured', 'measured', money.currency, money.amount));
  const yearly = saved && saved.yearly;
  const amount = yearly && yearly.total && yearly.total.amount;
  if (finite(amount)) {
    const shape2 = Boolean(saved.answers && saved.answers.shape === 2);
    const calculated = shape2 && Boolean(yearly.calculated ?? saved.answers.calculated);
    const currency = String(yearly.currency ?? (saved.answers && saved.answers.currency) ?? yearly.total.unit ?? '');
    const verb = String(yearly.verb || (yearly.parts && yearly.parts[0] && yearly.parts[0].verb) || FALLBACK_VERB);
    const entry = { status: calculated ? 'calculated' : 'estimated', verb, amount: Number(amount), currency };
    const check = yearly.check && yearly.check.outside ? yearly.check : VP.checkOf({ currency, total: { unit: currency, amount: Number(amount) }, parts: yearly.parts || [] });
    if (check.outside) entry.check = check;
    // Shape 2 is keyed by its plan's table and parts; an older shape by its table and the money rule it saved. Neither known: counted whole.
    const money = saved.answers && saved.answers.money && saved.answers.money.value;
    const keys = shape2 ? OV.savedKeys(saved, currency) : (money ? OV.wholeKeys(table, 'saved', JSON.stringify(money) + String(saved.answers.lost_filter || ''), currency, Number(amount)) : null);
    return withHidden(entry, keys);
  }
  if (estimate && estimate.status === 'estimated' && finite(estimate.amount)) {
    const currency = String(estimate.currency || '');
    const entry = { status: 'estimated', verb: FALLBACK_VERB, amount: Number(estimate.amount), currency };
    return withHidden(flagged(entry), OV.estimateKeys(estimate, currency, Number(estimate.amount)));
  }
  return { status: hasTable ? 'none' : 'no_data', verb: '', amount: null, currency: '' };
}

const COUNTED = ['calculated', 'estimated', 'measured'];

// Add up use cases per currency: calculated, estimated and measured apart, amount their sum. A currency with no measured money has no
// measured key, so a run without a measured use case answers as before.
function totalsOf(entries) {
  const byCurrency = new Map();
  for (const e of entries) {
    if (!COUNTED.includes(e.status)) continue;
    const row = byCurrency.get(e.currency) || { currency: e.currency, amount: 0, calculated: 0, estimated: 0 };
    row[e.status] = round2((row[e.status] || 0) + e.amount);
    row.amount = round2(row.calculated + row.estimated + (row.measured || 0));
    byCurrency.set(e.currency, row);
  }
  return [...byCurrency.values()].sort((a, b) => (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0));
}

// Decides what counts, and writes it on the entries: an estimate outside the usual range is listed in excluded and not counted (REQ-448);
// of the values that share a pool of money one is counted (REQ-454). Returns the entries as they add up: [{ status, currency, verb, amount }].
function countable(useCases) {
  const excluded = new Map();
  const items = [];
  for (const [id, e] of Object.entries(useCases)) {
    if (!COUNTED.includes(e.status)) continue;
    if (e.status === 'estimated' && e.check && e.check.outside) {
      e.counted = false;
      const row = excluded.get(e.currency) || { currency: e.currency, amount: 0, n: 0 };
      row.amount = round2(row.amount + e.amount);
      row.n += 1;
      excluded.set(e.currency, row);
      continue;
    }
    items.push({ id, e, status: e.status, currency: e.currency, amount: e.amount, keys: e.keys || null });
  }
  const got = OV.dedupe(items);
  let shared = 0;
  const counted = [];
  for (const item of items) {
    const r = got.get(item);
    if (r.keyed && r.counted <= 0 && item.amount > 0) {
      item.e.counted = false;
      item.e.overlap = { counted: false, with: r.with, not_counted: item.amount };
      shared += 1;
      continue;
    }
    if (r.shared.length) item.e.overlap = { counted: true, shared_with: r.shared };
    counted.push({ status: item.status, currency: item.currency, verb: item.e.verb, amount: round2(r.counted) });
  }
  return { counted, excluded: [...excluded.values()], shared };
}

function summarize(useCases) {
  const entries = Object.values(useCases);
  const count = (status) => entries.filter((e) => e.status === status).length;
  const { counted, excluded, shared } = countable(useCases);
  const verbs = new Map();
  for (const e of counted) {
    const key = `${e.currency}\u0000${e.verb}`;
    const row = verbs.get(key) || { currency: e.currency, verb: e.verb, amount: 0 };
    row.amount = round2(row.amount + e.amount);
    verbs.set(key, row);
  }
  return {
    totals: totalsOf(counted), n: entries.length, n_calculated: count('calculated'), n_estimated: count('estimated'),
    n_measured: count('measured'), n_none: entries.length - count('calculated') - count('estimated') - count('measured'), by_verb: [...verbs.values()],
    n_shared: shared, excluded,
  };
}

// The runs added up for the all-runs badge: same currency only. useCasesByRun (each run's use_cases, as runOf returns them) lets the same pool
// of money in two runs count once; without it the run totals are added as they are.
function mergeRuns(runs, useCasesByRun = null) {
  const counts = { n_calculated: runs.reduce((s, r) => s + r.n_calculated, 0), n_estimated: runs.reduce((s, r) => s + r.n_estimated, 0),
    n_measured: runs.reduce((s, r) => s + (r.n_measured || 0), 0) };
  if (Array.isArray(useCasesByRun) && useCasesByRun.length === runs.length) {
    const all = {};
    useCasesByRun.forEach((cases, i) => { for (const [id, e] of Object.entries(cases || {})) all[`${i}:${id}`] = e; });
    return { totals: totalsOf(countable(all).counted), ...counts };
  }
  const entries = [];
  for (const run of runs) {
    for (const t of run.totals) {
      entries.push({ status: 'calculated', currency: t.currency, amount: t.calculated });
      entries.push({ status: 'estimated', currency: t.currency, amount: t.estimated });
      if (t.measured !== undefined) entries.push({ status: 'measured', currency: t.currency, amount: t.measured });
    }
  }
  return { totals: totalsOf(entries), ...counts };
}

// useCases: [{id}] of the run; savedOf: Map id -> versionOf; estimates: {id: estimate}; measured: {id: measured yearly}; noTable: Set of ids
// without a primary table.
function runOf({ ids, saved, estimates, measured = {}, noTable, tables = {} }) {
  const useCases = {};
  for (const id of ids) useCases[id] = useCaseOf({ saved: saved.get(id) || null, estimate: estimates[id] || null, measured: measured[id] || null, hasTable: !noTable.has(id), table: tables[id] || '' });
  return { run: summarize(useCases), use_cases: useCases };
}

module.exports = { answersSql, sessionsSql, tablesSql, useCaseOf, totalsOf, summarize, mergeRuns, runOf };
