// REQ-472 / REQ-474: the LLM anchor (the likely yearly value of one use case, capped by the size of the business) and the LLM review of a
// plan's default value. Pure prompt builders and reply parsers; the route makes the model calls.
const { parseExactJson } = require('./exactJson');
const { replyContent } = require('./appFeedback');

const REVIEW_ROUNDS = 3;
const BUSINESS_SHARE = 0.01; // one use case is never worth more than 1% of what the business earns
const AGREE = 0.01; // a reviewer amount within 1% of the plan's value is an approval of it
const OPTION_ID = /^[a-z][a-z0-9_]{0,30}$/;
const TREND_LIMIT = 50;
const RUN_SHARE = 0.03; // REQ-480: the whole run is never worth more than 3% of what the business earns in a year
const CASE_CEILING = 20000000; // with no revenue known, no single use case is counted above this
const RUN_REVIEW_ID = '__run_review__'; // the use_case_id of the run review row in the saved answers table

const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const num = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
const round2 = (n) => Math.round(n * 100) / 100;

function jsonOf(data) {
  try {
    const got = parseExactJson(replyContent(data).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
    return got && typeof got === 'object' && !Array.isArray(got) ? got : null;
  } catch {
    return null;
  }
}

const useCaseLines = (uc, businessName) => [['Use case', uc && (uc.use_case || uc.name || uc.id)], ['Statement', uc && uc.statement], ['Business value', uc && uc.business_value], ['Business', businessName]]
  .map(([k, v]) => [k, text(v, 600)]).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);

// Highest value one use case may have: the generic ceiling, or 1% of the business revenue the model estimated when that is smaller.
const capOf = (revenue, range) => (Number.isFinite(revenue) && revenue > 0 ? Math.min(range.high, BUSINESS_SHARE * revenue) : range.high);

function anchorMessages({ useCase, businessName, records, range }) {
  const system = [
    'You anchor the yearly value of one use case before it is planned. Answer with one JSON object and nothing else:',
    '{"low": number, "high": number, "typical": number, "business_revenue_estimate": number, "reason": "one line",',
    ' "economic_factors": [{"id": "snake_case_id", "label": "text", "why": "one line", "likely_pct": number, "min_pct": number, "max_pct": number}]}',
    `low, high and typical are the yearly value in the run's currency (typical is the likely value); the generic range is ${range.low}-${range.high}, and one use case is worth at most 1% of what the whole business earns in a year.`,
    'business_revenue_estimate is your best estimate of the yearly revenue of the business named below (0 when you cannot tell).',
    'economic_factors lists 4 to 6 outside signals that move the revenue this use case can win, only the ones relevant to this use case (an empty list when none is). Each is a kind of market or customer signal you name for it, for example a consumer confidence index, a customer satisfaction score, demand in the market, or prices of what customers buy.',
    'For each, pct is the change to that revenue in percent, between -50 and 50: min_pct is the worst downturn, max_pct the best uplift, likely_pct what you expect now (between them). The user can override every one.',
  ].join('\n');
  const lines = useCaseLines(useCase, businessName);
  if (Number.isFinite(records) && records > 0) lines.push(`Records per year in the use case table: ${Math.round(records)}`);
  return [{ role: 'system', content: system }, { role: 'user', content: lines.join('\n') }];
}

// D-uae-03b: the anchor named fewer than 4 factors; ask once more for further distinct ones, naming those already chosen.
const FACTOR_MIN = 4;
function factorTopUpMessages({ useCase, businessName, have }) {
  const system = [
    'You name further outside signals for one use case. Answer with one JSON object and nothing else:',
    '{"economic_factors": [{"id": "snake_case_id", "label": "text", "why": "one line", "likely_pct": number, "min_pct": number, "max_pct": number}]}',
    `economic_factors lists ${FACTOR_MIN - have.length} to ${FACTOR_MAX - have.length} more market or customer signals that move the revenue this use case can win, relevant to this use case and different from these ids already chosen: ${have.map((x) => x.id).join(', ')}. For example a consumer confidence index, a customer satisfaction score, demand in the market, or prices of what customers buy.`,
    'pct is the change to that revenue in percent, between -50 and 50: min_pct is the worst downturn, max_pct the best uplift, likely_pct what you expect now (between them).',
  ].join('\n');
  return [{ role: 'system', content: system }, { role: 'user', content: useCaseLines(useCase, businessName).join('\n') }];
}

// The anchor factors first, then the top-up ones; factorsFrom drops repeats and caps at FACTOR_MAX.
function factorsWithTopUp(have, data) {
  const got = jsonOf(data);
  return factorsFrom([...have, ...(got && Array.isArray(got.economic_factors) ? got.economic_factors : [])]);
}

// FX-97: up to 6 market and customer factors, each a bounded change of the revenue part; anything unusable is dropped.
const FACTOR_MAX = 6;
function factorsFrom(raw) {
  const out = [];
  for (const f of Array.isArray(raw) ? raw : []) {
    if (!f || typeof f !== 'object' || !OPTION_ID.test(String(f.id)) || out.some((x) => x.id === f.id)) continue;
    const clamp = (n) => Math.max(-TREND_LIMIT, Math.min(TREND_LIMIT, n));
    const [lo, hi, likely] = [num(f.min_pct), num(f.max_pct), num(f.likely_pct)];
    if (![lo, hi, likely].every(Number.isFinite)) continue;
    const min = Math.min(clamp(lo), clamp(hi));
    const max = Math.max(clamp(lo), clamp(hi));
    out.push({ id: String(f.id), label: text(f.label, 60) || String(f.id).replace(/_/g, ' '), why: text(f.why, 200), likely_pct: Math.max(min, Math.min(max, clamp(likely))), min_pct: min, max_pct: max });
    if (out.length === FACTOR_MAX) break;
  }
  return out;
}

function trendFrom(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.options)) return null;
  const options = [];
  for (const o of raw.options) {
    const pct = num(o && o.pct);
    if (!o || !OPTION_ID.test(String(o.id)) || !Number.isFinite(pct) || options.some((x) => x.id === o.id)) continue;
    options.push({ id: String(o.id), label: text(o.label, 60) || String(o.id).replace(/_/g, ' '), pct: Math.max(-TREND_LIMIT, Math.min(TREND_LIMIT, pct)), why: text(o.why, 200) });
  }
  if (options.length < 2) return null;
  const kept = options.slice(0, 4);
  return { likely: kept.some((o) => o.id === raw.likely) ? String(raw.likely) : kept[0].id, options: kept };
}

// The anchor, or null when the reply is not usable. high is capped by the business; low is at least 1 and never above high.
function anchorFrom(data, range) {
  const got = jsonOf(data);
  if (!got) return null;
  const [low, high, typical] = [num(got.low), num(got.high), num(got.typical)];
  if (![low, high, typical].every(Number.isFinite) || high <= 0) return null;
  const revenue = num(got.business_revenue_estimate);
  const revenueKnown = Number.isFinite(revenue) && revenue > 0 ? revenue : 0;
  const cap = capOf(revenueKnown, range);
  const effectiveHigh = Math.min(high, cap);
  const effectiveLow = Math.min(Math.max(1, low), effectiveHigh);
  return {
    low: effectiveLow, high: effectiveHigh, typical: Math.min(effectiveHigh, Math.max(effectiveLow, typical)),
    business_revenue_estimate: revenueKnown, reason: text(got.reason, 300), economic_trend: trendFrom(got.economic_trend), economic_factors: factorsFrom(got.economic_factors),
  };
}

function reviewMessages({ useCase, businessName, anchor, amount, drivers }) {
  const system = [
    'You review the yearly value a plan gives one use case. Answer with one JSON object and nothing else:',
    '{"approved": true or false, "amount": number, "reason": "one line"}',
    'approved is true when the amount is a plausible yearly value for this use case and this business; otherwise give the amount you would approve in the run\'s currency.',
    'amount is always a value per year, never a weekly, monthly or per-record figure: convert to a year before you answer.',
  ].join('\n');
  const lines = useCaseLines(useCase, businessName);
  if (anchor) lines.push(`Anchor: low ${anchor.low}, high ${anchor.high}, likely ${anchor.typical} per year${anchor.reason ? ` (${anchor.reason})` : ''}`);
  lines.push(`Plan value per year: ${amount}`);
  for (const d of drivers || []) lines.push(`Driver on: ${d.label}: ${d.inputs.map((i) => `${i.label} ${i.default}`).join(', ')}`);
  return [{ role: 'system', content: system }, { role: 'user', content: lines.join('\n') }];
}

// { approved, amount, reason }, or null when the reply is not usable.
function reviewFrom(data) {
  const got = jsonOf(data);
  if (!got || typeof got.approved !== 'boolean') return null;
  const amount = num(got.amount);
  return { approved: got.approved, amount: Number.isFinite(amount) && amount >= 0 ? amount : null, reason: text(got.reason, 300) };
}

// The ON drivers of a plan with their estimate inputs, for the review prompt.
const onDriversOf = (plan) => (plan.drivers || []).filter((d) => d.on).map((d) => ({ label: d.label, inputs: d.asks.filter((a) => a.source === 'estimate').map((a) => ({ label: a.label, default: a.default })) }));

// True when the reviewer's amount is the plan's own value (within 1%): the reviewer has nothing to change.
const agrees = (amount, current) => Number.isFinite(amount) && Number.isFinite(current) && current > 0 && Math.abs(amount - current) <= AGREE * current;


// REQ-480: one model call reviews the whole run. Pure prompt builder, reply parser and limit; the route makes the call and saves the result.
const clamp01 = (n) => Math.min(1, Math.max(0, n));

function runReviewMessages({ businessName, revenue, useCases }) {
  const system = [
    'You review the yearly value of every use case of one run, together, and answer with one JSON object and nothing else:',
    '{"run_total": number, "scales": {"<use case id>": number between 0 and 1}, "reason": "one plain line"}',
    'run_total is the realistic yearly value of the whole run in the run\'s currency; it must not be more than the sum of the amounts.',
    'scales gives each use case the share of its amount that is worth counting: 1 keeps it whole, 0.5 keeps half, 0 counts none of it. Use cases that overlap, share one pool of money or count the same gain twice get a scale below 1.',
    'The total must look believable next to the size of the business. When the business\'s yearly revenue is given, one run is rarely worth more than a few percent of it.',
    'Explicit inputs from the user (amounts a person typed or measured) win over your own view: do not scale those down for plausibility alone.',
    'reason is one short plain sentence that names the main cause of any reduction.',
  ].join('\n');
  const lines = [`Business: ${text(businessName, 200) || 'not named'}`];
  if (Number.isFinite(revenue) && revenue > 0) lines.push(`Yearly revenue of the business: ${Math.round(revenue)}`);
  for (const c of useCases) lines.push(`Use case ${c.id}: ${text(c.name, 200)} | kind: ${text(c.kind, 60)} | per year: ${Math.round(c.amount)}${c.currency ? ` ${c.currency}` : ''}`);
  return [{ role: 'system', content: system }, { role: 'user', content: lines.join('\n') }];
}

// { total, scales, reason }, or null when the reply is not usable.
function runReviewFrom(data) {
  const got = jsonOf(data);
  if (!got) return null;
  const total = num(got.run_total);
  const scales = {};
  if (got.scales && typeof got.scales === 'object' && !Array.isArray(got.scales)) {
    for (const [id, v] of Object.entries(got.scales)) if (Number.isFinite(num(v))) scales[id] = clamp01(num(v));
  }
  if (!Number.isFinite(total) && !Object.keys(scales).length) return null;
  return { total: Number.isFinite(total) && total >= 0 ? total : null, scales, reason: text(got.reason, 300) };
}

// useCases: [{id, name, kind, amount, currency}]; ask(messages) answers the model reply or null (no model, or it failed).
// { ai_checked, reason, counted: {id: amount}, scales: {id: 0..1}, counted_total, limit }. The raw amounts are never changed.
async function reviewRun({ businessName, revenue, useCases, ask }) {
  const known = Number.isFinite(revenue) && revenue > 0 ? revenue : 0;
  const cases = useCases.filter((c) => Number.isFinite(Number(c.amount)) && Number(c.amount) > 0).map((c) => ({ ...c, amount: Number(c.amount) }));
  let reply = null;
  if (cases.length) {
    try { reply = runReviewFrom(await ask(runReviewMessages({ businessName, revenue: known, useCases: cases }))); } catch { reply = null; }
  }
  const counted = {};
  for (const c of cases) counted[c.id] = c.amount * (reply && Number.isFinite(reply.scales[c.id]) ? reply.scales[c.id] : 1);
  const shrink = (to) => {
    const sum = Object.values(counted).reduce((s, v) => s + v, 0);
    if (sum > to) for (const id of Object.keys(counted)) counted[id] = sum > 0 ? (counted[id] * to) / sum : 0;
  };
  if (reply && reply.total !== null) shrink(reply.total);
  // The hard limit, with or without a model.
  let limit = null;
  if (known) { limit = known * RUN_SHARE; shrink(limit); } else for (const id of Object.keys(counted)) counted[id] = Math.min(counted[id], CASE_CEILING);
  const scales = {};
  for (const c of cases) { counted[c.id] = round2(counted[c.id]); scales[c.id] = c.amount > 0 ? Math.min(1, counted[c.id] / c.amount) : 1; }
  return { ai_checked: Boolean(reply), reason: reply ? reply.reason : '', counted, scales, counted_total: round2(Object.values(counted).reduce((s, v) => s + v, 0)), limit };
}

// The saved review of a run, from the latest answers rows (the row of RUN_REVIEW_ID), or null for a run that was never reviewed.
function savedReviewOf(answerRows, versionOf) {
  const row = (answerRows || []).find((r) => String(r.use_case_id) === RUN_REVIEW_ID);
  const got = row && versionOf(row).answers;
  const r = got && got.review;
  return r && typeof r === 'object' && r.scales ? { ai_checked: Boolean(r.ai_checked), reason: text(r.reason, 300), scales: r.scales } : null;
}

module.exports = { RUN_SHARE, CASE_CEILING, RUN_REVIEW_ID, runReviewMessages, runReviewFrom, reviewRun, savedReviewOf, REVIEW_ROUNDS, capOf, anchorMessages, anchorFrom, FACTOR_MIN, factorTopUpMessages, factorsWithTopUp, trendFrom, factorsFrom, reviewMessages, reviewFrom, onDriversOf, agrees, round2 };
