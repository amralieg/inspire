import { ATTRIBUTION } from './valueDrivers.js';
import { DEFAULT_CURRENCY } from './moneyDefaults.js';
import { valueChips } from './valueLedger.js';

// REQ-436: state, slider ranges and request helpers of the Calculate value wizard. No value formula lives here (D1): every amount is the
// server's reply to POST /api/inspire/value/preview; this file only shapes what is sent and what is shown.
export const CASE_PLAN_ROUTE = '/api/inspire/value/case-plan';
export const PREVIEW_ROUTE = '/api/inspire/value/preview';
export const PREVIEW_DEBOUNCE_MS = 150;
export const FALLBACK_NOTICE = 'Inspire could not read the data for this; the numbers are estimates you can change';
// REQ-448: with no AI model the plan starts with every value driver off, so nothing is invented; the reason comes from the server.
export const noModelNotice = (reason) => `No AI model planned this value${reason ? ` (${reason})` : ''}, so every value driver starts off. Turn on the ones that apply and set their numbers.`;
export const DRIVER_ICONS = { risk_avoided: '🛡️', time_saved: '⏱️', revenue_uplift: '📈', cost_cut: '🧾', productivity: '👥' };

// Round up to 1, 2, 5 or 10 times a power of ten.
const nice = (x) => {
  const e = 10 ** Math.floor(Math.log10(x));
  const m = x / e;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * e;
};
// The slider of one estimate ask: range from its kind and default; a typed value above the max grows the max.
export function sliderRange(kind, def, typed = 0) {
  const v = Number(def) > 0 ? Number(def) : 1;
  let range;
  if (kind === 'pct') range = { min: 0, max: ATTRIBUTION.max, step: 1 };
  else if (kind === 'hours') range = { min: 0, max: Math.max(8, nice(v * 3)), step: 0.25 };
  else if (kind === 'count') range = { min: 0, max: Math.max(10, nice(v * 3)), step: 1 };
  else { const max = nice(v * 3); range = { min: 0, max, step: max >= 1000 ? max / 200 : 1 }; }
  // A typed value above the max moves the max to the next round number with headroom, never to the typed value itself.
  const t = Number(typed);
  return Number.isFinite(t) && t > range.max && kind !== 'pct' ? { ...range, max: nice(t * 2) } : range;
}

// REQ-451: the unit of one ask, from the plan's own `unit` when it names one, else from its kind and id.
export function unitOf(ask, currency) {
  if (typeof ask?.unit === 'string' && ask.unit) return ask.unit;
  const id = String(ask?.id || '');
  if (ask?.kind === 'pct') return '%';
  if (ask?.kind === 'hours') return 'hours';
  if (ask?.kind === 'money') return `${currency || DEFAULT_CURRENCY}${/hour/.test(id) ? ' per hour' : /year/.test(id) ? ' per year' : ''}`;
  return /people|headcount|analyst/.test(id) ? 'people' : /year/.test(id) ? 'per year' : 'records';
}

export const estimateAsks = (driver) => (driver?.asks || []).filter((a) => a.source === 'estimate');
export const isBad = (ask, value) => !Number.isFinite(Number(value)) || value === '' || Number(value) < 0 || (ask.kind === 'pct' && Number(value) > 100);

// REQ-474: the economic trend starts unticked with the AI's likely option; a saved choice wins when its option still exists.
const trendOf = (trend, old) => {
  const ids = (trend.options || []).map((o) => o.id);
  return { on: Boolean(old?.on), option: ids.includes(old?.option) ? old.option : trend.likely };
};

// The answers a plan starts with (or a saved shape 2 answers restore): every driver's on flag and estimate defaults.
export function initialAnswers(plan, saved = null) {
  const keep = saved?.shape === 2 ? saved : null;
  return {
    shape: 2,
    currency: keep?.currency || DEFAULT_CURRENCY,
    attribution_pct: keep?.attribution_pct ?? ATTRIBUTION.default,
    grouping: plan.grouping,
    // REQ-473: value is over all records; a group left out by an older save has no box to tick it back, so none is left out.
    excluded_groups: [],
    drivers: Object.fromEntries((plan.drivers || []).map((d) => {
      const old = keep?.drivers?.[d.id];
      return [d.id, { on: old ? Boolean(old.on) : Boolean(d.on),
        inputs: Object.fromEntries(estimateAsks(d).map((a) => [a.id, Number.isFinite(Number(old?.inputs?.[a.id])) && old?.inputs?.[a.id] !== undefined ? Number(old.inputs[a.id]) : a.default])) }];
    })),
    ...(plan.economic_trend ? { economic_trend: trendOf(plan.economic_trend, keep?.economic_trend) } : {}),
    calculated: false,
  };
}
// A new plan (another grouping) keeps the numbers the person already set.
export const carryAnswers = (plan, previous) => {
  const fresh = initialAnswers(plan);
  const drivers = Object.fromEntries(Object.entries(fresh.drivers).map(([id, d]) => [id, previous.drivers[id] ? { on: previous.drivers[id].on, inputs: { ...d.inputs, ...previous.drivers[id].inputs } } : d]));
  return { ...fresh, currency: previous.currency, attribution_pct: previous.attribution_pct, drivers, ...(previous.economic_trend && fresh.economic_trend ? { economic_trend: trendOf(plan.economic_trend, previous.economic_trend) } : {}) };
};

// The plan as sent: each driver's on flag follows the answers, so the server and the page agree on what is counted.
export const bodyOf = (plan, answers, calculated = false) => ({
  plan: { ...plan, drivers: plan.drivers.map((d) => ({ ...d, on: Boolean(answers.drivers[d.id]?.on) })) },
  answers: { ...answers, calculated },
});
// The answers have a stable key, so the same numbers never send a second preview.
export const answersKey = (answers) => JSON.stringify({ ...answers, calculated: false });

export const driversOn = (plan, answers) => plan.drivers.filter((d) => answers.drivers[d.id]?.on);
export const partOf = (yearly, id) => (yearly?.parts || []).find((p) => p.id === id) || null;
export const moneyText = (unit, amount) => (Number.isFinite(Number(amount)) ? valueChips([{ kind: 'money', unit: unit || DEFAULT_CURRENCY, amount: Number(amount) }], 1).shown[0]?.text || '' : '');
export const totalText = (yearly) => (yearly?.total ? moneyText(yearly.total.unit, yearly.total.amount) : '');
// A count of records, rows or groups is whole.
export const countText = (n) => Math.round(Number(n)).toLocaleString('en-US');
export const amountText = (n) => (Number.isFinite(Number(n)) ? Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }) : '0');
// Rounded for show; a data figure is the server's value for the groups that are in.
export const figureText = (kind, value, currency) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return kind === 'money' ? moneyText(currency, n) : kind === 'pct' ? `${n.toFixed(1)}%` : kind === 'count' ? countText(n) : Number(n.toFixed(2)).toLocaleString('en-US');
};
export const recordsOf = (plan, answers) => (plan.groups || []).filter((g) => !answers.excluded_groups.includes(g.g)).reduce((s, g) => s + Number(g.records_per_year || 0), 0);

// REQ-472 (FX-62): the one line that says whether a model reviewed the plan's value. No review (an older server) says nothing.
export const reviewLineOf = (review) => {
  if (!review || typeof review !== 'object') return '';
  return review.approved ? `Reviewed by ${review.model}: ${review.reason}` : `Not approved by a model review: ${review.reason}. Saved as an estimate.`;
};
// REQ-474: the AI's likely value of the use case, one line.
export const likelyLineOf = (likely) => (likely && Number.isFinite(Number(likely.amount)) ? `Likely value (AI): ${moneyText(likely.currency, likely.amount)}${likely.reason ? `, ${likely.reason}` : ''}` : '');
