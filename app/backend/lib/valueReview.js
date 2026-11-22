// REQ-472 / REQ-474: the LLM anchor (the likely yearly value of one use case, capped by the size of the business) and the LLM review of a
// plan's default value. Pure prompt builders and reply parsers; the route makes the model calls.
const { parseExactJson } = require('./exactJson');
const { replyContent } = require('./appFeedback');

const REVIEW_ROUNDS = 3;
const BUSINESS_SHARE = 0.01; // one use case is never worth more than 1% of what the business earns
const AGREE = 0.01; // a reviewer amount within 1% of the plan's value is an approval of it
const OPTION_ID = /^[a-z][a-z0-9_]{0,30}$/;
const TREND_LIMIT = 50;

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
    ' "economic_trend": null or {"likely": "option id", "options": [{"id": "snake_case_id", "label": "text", "pct": number, "why": "one line"}]}}',
    `low, high and typical are the yearly value in the run's currency (typical is the likely value); the generic range is ${range.low}-${range.high}, and one use case is worth at most 1% of what the whole business earns in a year.`,
    'business_revenue_estimate is your best estimate of the yearly revenue of the business named below (0 when you cannot tell).',
    'economic_trend is null unless the use case is sensitive to the macro economy; then give 2-4 options you name for it (for example a growing market and a bear market), each with pct, the change to the value in percent between -50 and 50, and set likely to the option you expect.',
  ].join('\n');
  const lines = useCaseLines(useCase, businessName);
  if (Number.isFinite(records) && records > 0) lines.push(`Records per year in the use case table: ${Math.round(records)}`);
  return [{ role: 'system', content: system }, { role: 'user', content: lines.join('\n') }];
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
    business_revenue_estimate: revenueKnown, reason: text(got.reason, 300), economic_trend: trendFrom(got.economic_trend),
  };
}

function reviewMessages({ useCase, businessName, anchor, amount, drivers }) {
  const system = [
    'You review the yearly value a plan gives one use case. Answer with one JSON object and nothing else:',
    '{"approved": true or false, "amount": number, "reason": "one line"}',
    'approved is true when the amount is a plausible yearly value for this use case and this business; otherwise give the amount you would approve in the run\'s currency.',
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

module.exports = { REVIEW_ROUNDS, capOf, anchorMessages, anchorFrom, trendFrom, reviewMessages, reviewFrom, onDriversOf, agrees, round2 };
