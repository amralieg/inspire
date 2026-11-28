import { amountText, countText, moneyText } from './valueWizard.js';

// REQ-475/476: the formula of one driver as one line of words, from its own inputs: "8,352 times a year × 1 person × 1.8 hours saved × $104 an hour".
// No arithmetic of value lives here: the amount after "=" is the server's. One phrase per input id; an input without one reads "<number> <label>".
const plural = (n, one, many) => `${amountText(n)} ${Number(n) === 1 ? one : many}`;
const PHRASES = {
  events_per_year: (n) => `${countText(n)} times a year`,
  people: (n) => plural(n, 'person', 'people'),
  hours_saved: (n) => plural(n, 'hour saved', 'hours saved'),
  cost_per_hour: (n, c) => `${moneyText(c, n)} an hour`,
  headcount: (n) => plural(n, 'person', 'people'),
  cost_per_person_year: (n, c) => `${moneyText(c, n)} per person a year`,
  gain_pct: (n) => `${amountText(n)}% of their time back`,
  base_revenue_per_year: (n, c) => `${moneyText(c, n)} of revenue a year`,
  uplift_pct: (n) => `${amountText(n)}% uplift`,
  spend_per_year: (n, c) => `${moneyText(c, n)} of spend a year`,
  cut_pct: (n) => `${amountText(n)}% cut`,
  incidents_per_year: (n) => `${countText(n)} incidents a year`,
  cost_per_incident: (n, c) => `${moneyText(c, n)} per incident`,
  reduction_pct: (n) => `${amountText(n)}% avoided`,
};
export const TAKES_LONGER = 'The use case takes longer than today, so no time is saved.';

// An input's number: the typed one for an estimate, else the server's figure for a data input (last known).
const valueOf = (ask, typed, part) => {
  const v = ask.source === 'data' ? part?.inputs?.find((i) => i.id === ask.id)?.value : typed?.[ask.id];
  return v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
};

// { parts, longer }: one phrase per factor (null while a number is missing); longer is true when hours today are below hours with the use case.
export function factorsOf(driver, inputs, part, currency) {
  const nums = Object.fromEntries((driver?.asks || []).map((a) => [a.id, valueOf(a, inputs, part)]));
  if (driver?.id === 'time_saved' && nums.hours_saved === undefined && nums.hours_before !== undefined && nums.hours_after !== undefined) {
    if (nums.hours_before !== null && nums.hours_after !== null && nums.hours_after > nums.hours_before) return { parts: [], longer: true };
    nums.hours_saved = nums.hours_before === null || nums.hours_after === null ? null : nums.hours_before - nums.hours_after;
  }
  const parts = [];
  for (const a of driver?.asks || []) {
    if (a.id === 'hours_before' || a.id === 'hours_after') continue;
    parts.push(nums[a.id] === null ? null : (PHRASES[a.id] ? PHRASES[a.id](nums[a.id], currency) : `${amountText(nums[a.id])} ${a.label}`));
  }
  if (nums.hours_saved !== undefined && !(driver.asks || []).some((a) => a.id === 'hours_saved')) {
    const at = (driver.asks || []).findIndex((a) => a.id === 'hours_before');
    parts.splice(Math.max(0, at), 0, nums.hours_saved === null ? null : PHRASES.hours_saved(nums.hours_saved));
  }
  return { parts, longer: false };
}

// { text, longer }: text is the line before "="; empty while any number is missing.
export function formulaOf(driver, inputs, part, currency) {
  const { parts, longer } = factorsOf(driver, inputs, part, currency);
  if (longer) return { text: TAKES_LONGER, longer: true };
  return { text: parts.includes(null) ? '' : parts.join(' × '), longer: false };
}

// REQ-586a C: the App runner of the one value spec (app/shared/value_spec.schema.json). A line-for-line port of the agent's
// inspire_value_calculate; app/shared/value_spec_fixtures.json is the lock, so a drift turns both suites red. Pure: reads only the spec.
const VALUE_BUCKET = { revenue: 'cash', cost: 'cash', working_capital: 'cash', risk: 'cash', capacity: 'capacity', non_financial: 'non_financial' };
const VALUE_SOURCES = ['measured', 'owner', 'library', 'exploratory'];
const VALUE_TIERS = ['S', 'M', 'L'];
const VALUE_SCENARIOS = ['low', 'base', 'high'];
const VALUE_RANK = { low: 0, medium: 1, high: 2 };
const VALUE_SOURCE_CONFIDENCE = { measured: 'high', owner: 'medium', library: 'medium', exploratory: 'low' };
const VALUE_COST_LABEL = { measured: 'measured', owner: 'assumption', library: 'assumption', exploratory: 'exploratory' };
const has = (o, k) => o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const lowestLevel = (levels) => levels.reduce((a, b) => (VALUE_RANK[b] < VALUE_RANK[a] ? b : a));

function valueProblems(spec) {
  const problems = [];
  const ranges = {};
  let tiers = null;
  const { mechanism, flow_or_stock: stock } = spec;
  const bucket = typeof mechanism === 'string' && has(VALUE_BUCKET, mechanism) ? VALUE_BUCKET[mechanism] : null;
  if (bucket === null) problems.push('mechanism_unknown');
  if (stock !== 'flow' && stock !== 'stock') problems.push('flow_or_stock_unknown');
  const horizon = spec.horizon_years;
  if (!(isNum(horizon) && Number.isInteger(horizon) && horizon >= 1 && horizon <= 10)) problems.push('horizon_invalid');
  const measured = isObj(spec.measured) ? spec.measured : {};
  if (!(isNum(measured.exposure) && measured.exposure >= 0)) problems.push('exposure_invalid');
  const unit = measured.unit;
  if ((bucket === 'capacity' || bucket === 'non_financial') && !(typeof unit === 'string' && unit.trim())) problems.push('unit_missing');
  if (mechanism === 'working_capital' && stock === 'flow') problems.push('working_capital_needs_stock');
  const sourced = isObj(spec.sourced) ? spec.sourced : {};
  const names = ['effect', 'adoption', 'realization', ...(mechanism === 'revenue' ? ['margin'] : []), ...(mechanism === 'working_capital' ? ['carrying_cost_rate'] : [])];
  for (const name of names) {
    const item = sourced[name];
    if (item === undefined || item === null) {
      if (name === 'effect') problems.push('effect_missing');
      continue;
    }
    if (!VALUE_SOURCES.includes(item.source)) problems.push(`${name}_source_missing`);
    const trio = VALUE_SCENARIOS.map((k) => item[k]);
    if (!trio.every(isNum)) problems.push(`${name}_missing`);
    else if (!trio.every((p) => p >= 0 && p <= 1)) problems.push(`${name}_out_of_range`);
    else if (!(trio[0] <= trio[1] && trio[1] <= trio[2])) problems.push(`${name}_order`);
    else ranges[name] = { low: trio[0], base: trio[1], high: trio[2] };
  }
  if (spec.cost !== undefined && spec.cost !== null) {
    const cost = spec.cost;
    const held = isObj(cost.tiers) ? cost.tiers : {};
    const valid = VALUE_SOURCES.includes(cost.source) && VALUE_TIERS.every((t) => isObj(held[t])
      && ['implementation', 'recurring_per_year'].every((p) => isNum(held[t][p]) && held[t][p] >= 0));
    if (valid) tiers = Object.fromEntries(VALUE_TIERS.map((t) => [t, [held[t].implementation, held[t].recurring_per_year]]));
    else problems.push('cost_invalid');
  }
  return { problems, ranges, tiers, bucket };
}

function valueConfidence(spec, ranges, flags, hasCost) {
  const sourced = spec.sourced || {};
  const levels = Object.keys(ranges).filter((n) => has(sourced, n)).map((n) => VALUE_SOURCE_CONFIDENCE[sourced[n].source]);
  for (const n of ['adoption', 'realization']) if (flags.includes(`${n}_assumed_full`)) levels.push('low');
  const held = spec.measured?.confidence;
  const baseline = has(VALUE_RANK, held) ? held : flags.includes('period_missing') ? 'low' : 'high';
  const cost = hasCost ? spec.cost : null;
  const confidence = { baseline, effect: lowestLevel(levels), cost: cost ? VALUE_SOURCE_CONFIDENCE[cost.source] : null };
  const level = lowestLevel([confidence.baseline, confidence.effect, confidence.cost || 'low']);
  const gate = { level, headline: level !== 'low', weakest: Object.keys(confidence).filter((n) => (confidence[n] || 'low') === level).sort() };
  return { confidence, gate, cost: cost ? { source: cost.source, label: VALUE_COST_LABEL[cost.source], editable: true, tiers: cost.tiers } : null };
}

// calculateValue(spec): joint low/base/high scenarios, gross and net per S/M/L cost tier, break-even effect and the 1% line.
export function calculateValue(spec) {
  spec = isObj(spec) ? spec : {};
  const { problems, ranges, tiers, bucket } = valueProblems(spec);
  if (problems.length) {
    return { ok: false, problems: [...problems].sort(), flags: [], bucket, unit: null, period: null, annual_exposure: null, balance: null,
      one_percent: null, scenarios: null, break_even_effect: null, confidence: null, gate: null, cost: null };
  }
  const mechanism = spec.mechanism;
  const stock = spec.flow_or_stock === 'stock';
  const horizon = Math.trunc(spec.horizon_years);
  const measured = spec.measured;
  const exposure = Number(measured.exposure);
  const flags = [];
  for (const name of ['adoption', 'realization']) {
    if (!ranges[name]) {
      ranges[name] = { low: 1, base: 1, high: 1 };
      flags.push(`${name}_assumed_full`);
    }
  }
  const cash = bucket === 'cash';
  const currency = spec.currency;
  const hasCurrency = typeof currency === 'string' && /^[A-Z]{3}$/.test(currency);
  if (cash && !hasCurrency) flags.push('currency_missing');
  if (mechanism === 'revenue' && !ranges.margin) flags.push('margin_missing');
  if (mechanism === 'working_capital' && !ranges.carrying_cost_rate) flags.push('carrying_cost_missing');
  if (tiers === null) flags.push('cost_missing');
  const unit = cash ? (hasCurrency ? currency : null) : (measured.unit ?? null);
  let annual = null;
  let balance = null;
  let period;
  const days = measured.period_days;
  if (stock) {
    balance = exposure;
    period = 'balance';
    if (mechanism !== 'working_capital') flags.push('stock_not_annual');
  } else if (isNum(days) && days > 0) {
    annual = (exposure * 365) / days;
    period = 'year';
  } else {
    period = 'data period';
    flags.push('period_missing');
  }
  const amount = annual !== null ? annual : balance !== null ? balance : exposure;
  const onePercent = cash && !hasCurrency ? null : {
    value: 0.01 * amount, unit, per: period,
    meaning: `1% of the observed ${stock ? 'balance' : 'exposure'} per ${period}, shown as a size reference, not a forecast`,
  };
  const priced = cash && hasCurrency && !['margin_missing', 'carrying_cost_missing', 'stock_not_annual', 'period_missing'].some((f) => flags.includes(f));
  const scenarios = {};
  for (const key of VALUE_SCENARIOS) {
    const share = ranges.effect[key] * ranges.adoption[key] * ranges.realization[key];
    const row = { change: null, gross_annual: null, gross_horizon: null, one_off_release: null, net: null };
    if (mechanism === 'working_capital') {
      row.one_off_release = hasCurrency ? balance * share : null;
      if (priced) row.gross_annual = balance * share * ranges.carrying_cost_rate[key];
    } else if (!flags.includes('stock_not_annual')) {
      row.change = amount * share;
      if (priced) row.gross_annual = row.change * (mechanism === 'revenue' ? ranges.margin[key] : 1);
    }
    if (row.gross_annual !== null) {
      row.gross_horizon = row.gross_annual * horizon;
      if (tiers) row.net = Object.fromEntries(VALUE_TIERS.map((t) => [t, row.gross_horizon - tiers[t][0] - tiers[t][1] * horizon]));
    }
    scenarios[key] = row;
  }
  let breakEven = null;
  if (priced && tiers) {
    const multiplier = mechanism === 'revenue' ? ranges.margin.base : mechanism === 'working_capital' ? ranges.carrying_cost_rate.base : 1;
    const divisor = amount * ranges.adoption.base * ranges.realization.base * multiplier * horizon;
    breakEven = Object.fromEntries(VALUE_TIERS.map((t) => [t, divisor > 0 ? (tiers[t][0] + tiers[t][1] * horizon) / divisor : null]));
  }
  if (scenarios.base.net && Object.values(scenarios.base.net).some((n) => n < 0)) flags.push('net_negative');
  const { confidence, gate, cost } = valueConfidence(spec, ranges, flags, tiers !== null);
  return { ok: true, problems: [], flags: [...flags].sort(), bucket, unit, period, annual_exposure: annual, balance, one_percent: onePercent,
    scenarios, break_even_effect: breakEven, confidence, gate, cost };
}
