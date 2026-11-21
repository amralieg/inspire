import { ATTRIBUTION } from './valueDrivers.js';
import { DEFAULT_CURRENCY } from './moneyDefaults.js';
import { valueChips } from './valueLedger.js';

// REQ-436: state, slider ranges and request helpers of the Calculate value wizard. No value formula lives here (D1): every amount is the
// server's reply to POST /api/inspire/value/preview; this file only shapes what is sent and what is shown.
export const CASE_PLAN_ROUTE = '/api/inspire/value/case-plan';
export const PREVIEW_ROUTE = '/api/inspire/value/preview';
export const PREVIEW_DEBOUNCE_MS = 150;
export const FALLBACK_NOTICE = 'Inspire could not read the data for this; the numbers are estimates you can change';
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
  const t = Number(typed);
  return Number.isFinite(t) && t > range.max ? { ...range, max: t } : range;
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

// The answers a plan starts with (or a saved shape 2 answers restore): every driver's on flag and estimate defaults.
export function initialAnswers(plan, saved = null) {
  const keep = saved?.shape === 2 ? saved : null;
  const groups = new Set((plan.groups || []).map((g) => g.g));
  return {
    shape: 2,
    currency: keep?.currency || DEFAULT_CURRENCY,
    attribution_pct: keep?.attribution_pct ?? ATTRIBUTION.default,
    grouping: plan.grouping,
    excluded_groups: (keep?.excluded_groups || []).filter((g) => groups.has(g)),
    drivers: Object.fromEntries((plan.drivers || []).map((d) => {
      const old = keep?.drivers?.[d.id];
      return [d.id, { on: old ? Boolean(old.on) : Boolean(d.on),
        inputs: Object.fromEntries(estimateAsks(d).map((a) => [a.id, Number.isFinite(Number(old?.inputs?.[a.id])) && old?.inputs?.[a.id] !== undefined ? Number(old.inputs[a.id]) : a.default])) }];
    })),
    calculated: false,
  };
}
// A new plan (another grouping) keeps the numbers the person already set.
export const carryAnswers = (plan, previous) => {
  const fresh = initialAnswers(plan);
  const drivers = Object.fromEntries(Object.entries(fresh.drivers).map(([id, d]) => [id, previous.drivers[id] ? { on: previous.drivers[id].on, inputs: { ...d.inputs, ...previous.drivers[id].inputs } } : d]));
  return { ...fresh, currency: previous.currency, attribution_pct: previous.attribution_pct, drivers };
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
export const countText = (n) => Number(n).toLocaleString('en-US');
// Rounded for show; a data figure is the server's value for the groups that are in.
export const figureText = (kind, value, currency) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return kind === 'money' ? moneyText(currency, n) : kind === 'pct' ? `${n.toFixed(1)}%` : countText(Number(n.toFixed(2)));
};
export const recordsOf = (plan, answers) => (plan.groups || []).filter((g) => !answers.excluded_groups.includes(g.g)).reduce((s, g) => s + Number(g.records_per_year || 0), 0);
