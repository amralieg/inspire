// REQ-436: the case plan. The model only names the case, the filter, the groupings, the metrics and, per driver, which input comes from
// the data and which is an estimate; every name it gives is checked against the table columns and valueDrivers.json. The arithmetic is
// valueDriversCalc (the one formula implementation); this file builds the plan, the grouped SQL and the C4 yearly.
const VDC = require('./valueDriversCalc');
const { binder } = require('./sqlBinder');
const { parseExactJson } = require('./exactJson');
const { replyContent } = require('./appFeedback');
const VY = require('./valueYearly');
const { quoteColumn: quote } = require('./inspireImplement');
const GR = require('./groupingRule');
const VP = require('./valuePlausibility');
const VS = require('./valueScope');

const DEF = VDC.DEFINITION;
const { GROUP_MIN_RECORDS, GROUP_MAX_GROUPS } = GR;
const OTHER = 'Other';
const OPS = ['=', '!=', '>', '>=', '<', '<=', 'is_not_null'];
const AGGS = ['avg', 'sum_per_year'];
const NUMERIC = /^(tinyint|smallint|int|integer|bigint|long|float|double|decimal|numeric|short|byte)/i;
const VERBS = { time_saved: 'REDUCE COST', productivity: 'REDUCE COST', cost_cut: 'REDUCE COST', revenue_uplift: 'GROW REVENUE', risk_avoided: 'AVOID RISK' };
const DEFAULTS = {
  events_per_year: 1000, people: 1, hours_saved: 1, cost_per_hour: 50, headcount: 10, cost_per_person_year: 60000, gain_pct: 10,
  base_revenue_per_year: 1000000, uplift_pct: 5, spend_per_year: 1000000, cut_pct: 10, incidents_per_year: 100, cost_per_incident: 1000, reduction_pct: 30,
};
const DATA_BY_DEFAULT = ['incidents_per_year', 'events_per_year'];
const DISCLAIMER = 'These figures are estimates built from the records Inspire counted and the numbers you confirm; they are not a forecast.';
const ID_SHAPE = /^[a-z][a-z0-9_]{0,30}$/;

const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const round2 = (n) => Math.round(n * 100) / 100;
const nameOf = (c) => String(c.column_name ?? c.name ?? '');

function askOf(def, input, source) {
  const base = { id: input.id, label: input.label, kind: input.kind, help: input.help };
  if (source) return { ...base, ...source };
  if (DATA_BY_DEFAULT.includes(input.id)) return { ...base, source: 'data', metric: 'records' };
  return { ...base, source: 'estimate', default: DEFAULTS[input.id], why: '' };
}

function baseGroupings(columns, asked) {
  const dates = VY.dateColumnsOf(columns);
  const text_ = columns.filter((c) => !NUMERIC.test(String(c.data_type)) && !dates.includes(c));
  const first = asked && columns.find((c) => nameOf(c) === asked) ? asked : (text_[0] ? nameOf(text_[0]) : '');
  return first ? [{ column: first, label: `By ${first.replace(/_/g, ' ')}` }] : [];
}

function shell(columns, groupBy) {
  const groupings = baseGroupings(columns, groupBy);
  return { case_noun: 'record', case_filter: null, groupings, grouping: groupings[0] ? groupings[0].column : '', metrics: [],
    drivers: DEF.drivers.map((d) => ({ id: d.id, label: d.label, verb: VERBS[d.id], on: false, why: '', asks: d.inputs.map((i) => askOf(d, i)) })),
    model: null, disclaimer: DISCLAIMER };
}

function fallbackPlan(columns, groupBy = '') {
  const plan = shell(columns || [], groupBy);
  return plan;
}

// ---- the model call ----
// FX-34 (W16 D5): the plan is for one use case. Before, the prompt named only the table, so every use case on a table got the same plan
// and the same defaults, hence the same amount. PLAN_BASIS marks a plan made this way; a saved estimate without it is not shown as current.
const PLAN_BASIS = 'use_case';
const useCaseText = (uc) => {
  if (!uc || typeof uc !== 'object') return '';
  const lines = [['Use case', uc.use_case || uc.name || uc.id], ['Statement', uc.statement], ['Business value', uc.business_value]]
    .map(([k, v]) => [k, text(v, 600)]).filter(([, v]) => v);
  return lines.length ? `\n${lines.map(([k, v]) => `${k}: ${v}`).join('\n')}` : '';
};

function planMessages({ table, columns, useCase = null }) {
  const system = [
    'You plan how to put a value per year on one use case over one data table. Answer with one JSON object and nothing else:',
    '{"case_noun": "singular lower case noun for one record, e.g. fraud case",',
    ' "case_filter": {"column": "name", "op": "= | != | > | >= | < | <= | is_not_null", "value": "text"} or null,',
    ' "groupings": [{"column": "name", "label": "By region"}],',
    ' "metrics": [{"id": "short_id", "label": "text", "column": "numeric column", "agg": "avg | sum_per_year"}],',
    ' "drivers": [{"id": "driver id", "label": "name for this case", "on": true, "why": "one line", "asks": [',
    '   {"id": "input id", "source": "data", "metric": "metric id or records"} or {"id": "input id", "source": "estimate", "default": number, "why": "one line"}]}]}',
    'Use only the listed columns, the driver ids and the input ids below. records means the number of records per year in the group.',
    `Drivers and inputs: ${DEF.drivers.map((d) => `${d.id} (${d.inputs.map((i) => `${i.id}:${i.kind}`).join(', ')})`).join('; ')}`,
    'For time_saved ask hours_saved: the hours the use case takes off each time, one number. Percent inputs are 0-100. Mark a driver on only when the data supports it.',
    'Plan for the use case named below: its filter, drivers and estimates fit what it does, not the table in general. The user\'s own input always wins.',
  ].join('\n');
  const user = `Table: ${table}\nColumns: ${columns.map((c) => `${nameOf(c)} ${c.data_type}`).join(', ')}${useCaseText(useCase)}`;
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

// The model reply as a full plan (without groups); the fallback plan when the reply is not usable JSON.
function planFrom(data, columns, groupBy = '') {
  let got;
  try {
    got = parseExactJson(replyContent(data).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
  } catch {
    return fallbackPlan(columns, groupBy);
  }
  if (!got || typeof got !== 'object' || Array.isArray(got)) return fallbackPlan(columns, groupBy);
  const known = new Map(columns.map((c) => [nameOf(c), c]));
  const plan = shell(columns, groupBy);
  const noun = text(got.case_noun, 40).toLowerCase();
  if (noun) plan.case_noun = noun;
  const f = got.case_filter;
  if (f && typeof f === 'object' && known.has(String(f.column)) && OPS.includes(f.op) && (f.op === 'is_not_null' || (f.value !== undefined && f.value !== null && text(f.value, 200) !== ''))) {
    plan.case_filter = f.op === 'is_not_null' ? { column: f.column, op: f.op, value: null } : { column: f.column, op: f.op, value: text(f.value, 200) };
  }
  const groupings = (Array.isArray(got.groupings) ? got.groupings : []).filter((g) => g && known.has(String(g.column)))
    .map((g) => ({ column: String(g.column), label: text(g.label, 60) || `By ${String(g.column).replace(/_/g, ' ')}` })).slice(0, 5);
  if (groupings.length) {
    plan.groupings = groupings;
    plan.grouping = (groupBy && groupings.find((g) => g.column === groupBy) ? groupBy : groupings[0].column);
  }
  const metrics = [];
  for (const m of Array.isArray(got.metrics) ? got.metrics : []) {
    const col = m && known.get(String(m.column));
    if (!col || !NUMERIC.test(String(col.data_type)) || !AGGS.includes(m.agg) || !ID_SHAPE.test(String(m.id)) || metrics.some((x) => x.id === m.id) || m.id === 'records') continue;
    metrics.push({ id: m.id, label: text(m.label, 60) || m.id, column: nameOf(col), agg: m.agg });
  }
  plan.metrics = metrics.slice(0, 8);
  const metricIds = new Set(['records', ...plan.metrics.map((m) => m.id)]);
  const given = new Map((Array.isArray(got.drivers) ? got.drivers : []).filter((d) => d && DEF.drivers.some((x) => x.id === d.id)).map((d) => [d.id, d]));
  plan.drivers = DEF.drivers.map((def) => {
    const d = given.get(def.id) || {};
    const asked = new Map();
    for (const a of Array.isArray(d.asks) ? d.asks : []) {
      const input = a && def.inputs.find((i) => i.id === a.id);
      if (!input || asked.has(input.id) || (a.kind !== undefined && a.kind !== input.kind)) continue;
      if (a.source === 'data' && metricIds.has(String(a.metric))) asked.set(input.id, askOf(def, input, { source: 'data', metric: String(a.metric) }));
      else if (a.source === 'estimate' && Number.isFinite(Number(a.default)) && a.default !== null && a.default !== '' && Number(a.default) >= 0 && (input.kind !== 'pct' || Number(a.default) <= 100)) {
        asked.set(input.id, askOf(def, input, { source: 'estimate', default: Number(a.default), why: text(a.why, 160) }));
      }
    }
    return { id: def.id, label: text(d.label, 60) || def.label, verb: VERBS[def.id], on: d.on === true, why: text(d.why, 200),
      asks: def.inputs.map((i) => asked.get(i.id) || askOf(def, i)) };
  });
  return plan;
}

// ---- the grouped SQL ----
// The plan may have come back from the browser (saved answers), so the filter is checked again here: a known operator on a column name.
function filterSql(f, b) {
  if (!f || typeof f !== 'object' || !OPS.includes(f.op) || !String(f.column || '').trim()) return '';
  if (f.op === 'is_not_null') return ` WHERE ${quote(f.column)} IS NOT NULL`;
  return f.value === undefined || f.value === null ? '' : ` WHERE ${quote(f.column)} ${f.op} ${b.bind(f.value)}`;
}

// The filter and the dated rows: a row with no date counts toward neither the records nor the days (D4).
// REQ-507: the chosen scope (plan.scope: filters and a window of absolute days) adds its bound conditions; its values are bound into `b`'s list.
// RC6-B-08: a date kept as text (textDate) is read through the safe parse, so a row whose value does not parse is not dated.
function whereOf(f, b, dateColumn, scope = null, textDate = false) {
  const base = filterSql(f, b);
  const dated = `${VY.dateRead(quote(dateColumn), textDate)} IS NOT NULL`;
  const chosen = VS.scopeClauses(scope);
  b.parameters.push(...chosen.parameters);
  const all = [...chosen.where, dated].join(' AND ');
  return base ? `${base} AND ${all}` : ` WHERE ${all}`;
}

function groupedSql(GP, scopes, plan, table, dateColumn, textDate = false) {
  const b = binder();
  return GP.statement(scopes, (ctx) => {
    const needed = [dateColumn, plan.grouping, ...plan.metrics.map((m) => m.column), plan.case_filter && plan.case_filter.column, ...VS.scopeColumns(plan.scope)].filter(Boolean);
    const from = GP.previewFrom(table, ctx, needed);
    const f = plan.case_filter;
    const where = whereOf(f, b, dateColumn, plan.scope, textDate);
    const group = plan.grouping ? `COALESCE(CAST(${quote(plan.grouping)} AS STRING), '(blank)')` : "'All'";
    const metrics = plan.metrics.filter((m) => ID_SHAPE.test(String(m.id))).map((m) => `, ${m.agg === 'avg' ? 'AVG' : 'SUM'}(CAST(${quote(m.column)} AS DOUBLE)) AS m_${m.id}`).join('');
    return `SELECT ${group} AS g, COUNT(*) AS records${metrics} FROM ${from}${where}${plan.grouping ? ' GROUP BY 1 ORDER BY records DESC' : ''} LIMIT ${GROUP_MAX_GROUPS}`;
  }, b.parameters);
}

// Rows of the grouped query and the population ({ records, days } of the whole filtered table, from currentCountSql) -> { days, groups }.
// Groups under GROUP_MIN_RECORDS go into "Other", which also holds every record the row list left out, so the total is the population's.
function groupsFrom(rows, plan, population) {
  const days = Math.max(0, Number(population && population.days) || 0);
  const raw = rows.map((r) => ({ g: String(r.g), records: Number(r.records) || 0, row: r })).sort((a, b) => b.records - a.records);
  const kept = raw.filter((r, i) => r.records >= GROUP_MIN_RECORDS && i < GROUP_MAX_GROUPS);
  const rest = raw.filter((r) => !kept.includes(r));
  const total = Number(population && population.records) || 0;
  const cutOff = Math.max(0, total - raw.reduce((s, r) => s + r.records, 0));
  const scale = (n) => round2(VY.extrapolate({ amount: n, sampled: 1, eligible: 1, days }) ?? 0);
  const metricOf = (m, set) => {
    const records = set.reduce((s, r) => s + r.records, 0);
    const col = `m_${m.id}`;
    if (m.agg === 'sum_per_year') return scale(set.reduce((s, r) => s + (Number(r.row[col]) || 0), 0));
    return records ? round2(set.reduce((s, r) => s + (Number(r.row[col]) || 0) * r.records, 0) / records) : 0;
  };
  const make = (g, set, extra = 0) => ({ g, records_per_year: scale(set.reduce((s, r) => s + r.records, 0) + extra), metrics: Object.fromEntries(plan.metrics.map((m) => [m.id, metricOf(m, set)])) });
  const groups = kept.map((r) => make(r.g, [r]));
  if (rest.length || cutOff) groups.push(make(OTHER, rest, cutOff));
  return { days, groups };
}

// ---- the yearly (C4) ----
const dataAsksOf = (driver) => driver.asks.filter((a) => a.source === 'data');

const isRevenuePart = (p) => p.id === 'revenue_uplift' || p.verb === VERBS.revenue_uplift;
const isFactorPart = (p) => p.id === 'economic_trend' || /^factor_/.test(p.id);
const FACTOR_LIMIT = 50;
// FX-97: the plan's factors (the old single economic_trend of a stored plan reads as one factor bounded by its options).
function factorsOfPlan(plan) {
  if (plan && Array.isArray(plan.economic_factors) && plan.economic_factors.length) return plan.economic_factors.filter((f) => f && ID_SHAPE.test(String(f.id)));
  const options = plan && plan.economic_trend && Array.isArray(plan.economic_trend.options) ? plan.economic_trend.options : [];
  if (!options.length) return [];
  const pcts = options.map((o) => Number(o.pct));
  const likely = options.find((o) => o.id === plan.economic_trend.likely) || options[0];
  return [{ id: 'economic_trend', label: 'Economic trend', why: likely.why || '', likely_pct: Number(likely.pct), min_pct: Math.min(...pcts), max_pct: Math.max(...pcts) }];
}
// The ticked factors of the answers as {id, label, pct}, each pct clamped to the factor's own bounds. An unknown factor or option is an error.
function factorEffects(plan, answers, errors) {
  const effects = [];
  const asked = answers && answers.economic_factors && typeof answers.economic_factors === 'object' ? answers.economic_factors : {};
  const known = factorsOfPlan(plan);
  for (const [id, a] of Object.entries(asked)) {
    if (!a || a.on !== true) continue;
    const f = known.find((x) => x.id === id);
    if (!f) { errors.economic_factors = `"${id}" is not a market or customer factor of this plan.`; continue; }
    const lo = Math.max(-FACTOR_LIMIT, Number(f.min_pct));
    const hi = Math.min(FACTOR_LIMIT, Number(f.max_pct));
    const raw = Number.isFinite(Number(a.pct)) && a.pct !== '' && a.pct !== null ? Number(a.pct) : Number(f.likely_pct);
    effects.push({ id: id === 'economic_trend' ? id : `factor_${id}`, label: f.label, pct: Math.max(lo, Math.min(hi, raw)) });
  }
  const old = answers && answers.economic_trend && typeof answers.economic_trend === 'object' ? answers.economic_trend : null;
  if (old && old.on === true && !(asked.economic_trend && typeof asked.economic_trend === 'object')) {
    const option = ((plan && plan.economic_trend && plan.economic_trend.options) || []).find((o) => o.id === old.option);
    if (!option) errors.economic_trend = `"${old.option}" is not an economic trend option of this plan.`;
    else effects.push({ id: 'economic_trend', label: option.label, pct: Number(option.pct) });
  }
  return effects;
}

// { yearly } or { errors: { <driver id | 'currency'>: message } }. Pure arithmetic: no SQL.
function yearlyOf(plan, answers) {
  const drivers = Array.isArray(plan && plan.drivers) ? plan.drivers.filter((d) => DEF.drivers.some((x) => x.id === d.id) && Array.isArray(d.asks)) : [];
  const allGroups = Array.isArray(plan && plan.groups) ? plan.groups : [];
  const given = answers && answers.drivers && typeof answers.drivers === 'object' ? answers.drivers : {};
  const excluded = new Set(Array.isArray(answers && answers.excluded_groups) ? answers.excluded_groups.map(String) : []);
  const groups = allGroups.filter((g) => !excluded.has(String(g.g)));
  const errors = {};
  const currency = String((answers && answers.currency) ?? '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) errors.currency = 'Choose the currency of the value as a three-letter code such as USD.';
  const a = DEF.attribution;
  const attribution = answers && answers.attribution_pct !== undefined && answers.attribution_pct !== null && answers.attribution_pct !== '' ? Number(answers.attribution_pct) : a.default;
  if (!Number.isFinite(attribution) || attribution < a.min || attribution > a.max) errors.attribution_pct = `"${a.label}" must be a number between ${a.min} and ${a.max}.`;
  // C24 (P247): "tune values from the data Inspire processed" (default on). Off: a data ask is priced once from its generic estimate, not from the counted records.
  const tuned = !(answers && answers.tune_from_data === false);
  const parts = [];
  for (const d of drivers) {
    const mine = given[d.id] && typeof given[d.id] === 'object' ? given[d.id] : {};
    if (!(mine.on === undefined ? d.on : mine.on === true)) continue;
    const typed = mine.inputs && typeof mine.inputs === 'object' ? mine.inputs : {};
    const fixed = {};
    const shown = [];
    for (const ask of d.asks) {
      if (ask.source === 'data' && tuned) continue;
      const raw = typed[ask.id] !== undefined && typed[ask.id] !== null && typed[ask.id] !== '' ? typed[ask.id] : (ask.source === 'data' ? DEFAULTS[ask.id] : ask.default);
      const n = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(n) || n < 0) errors[d.id] = `${d.label}: "${ask.label}" must be a number of 0 or more.`;
      else if (ask.kind === 'pct' && n > 100) errors[d.id] = `${d.label}: "${ask.label}" must be between 0 and 100.`;
      fixed[ask.id] = n;
    }
    if (errors[d.id]) continue;
    const dataAsks = tuned ? dataAsksOf(d) : [];
    const amount = round2(VDC.amountOverGroups(d.id, fixed, dataAsks, groups));
    parts.push({ id: d.id, label: d.label, verb: d.verb || VERBS[d.id], amount, per_group: dataAsks.length > 0,
      inputs: d.asks.map((ask) => ({ id: ask.id, label: ask.label, kind: ask.kind, source: tuned ? ask.source : 'estimate',
        value: ask.source === 'data' && tuned ? round2(VDC.dataFigure(ask, groups, ((plan.metrics || []).find((m) => m.id === ask.metric) || {}).agg)) : fixed[ask.id] })) });
  }
  // FX-97: market and customer factors move the revenue part only (after the credit share); a plan with no revenue kind on ignores them.
  const revenue = parts.filter(isRevenuePart).reduce((s, p) => s + p.amount, 0);
  const effects = revenue > 0 ? factorEffects(plan, answers, errors) : [];
  if (Object.keys(errors).length) return { errors };
  const sum = parts.reduce((s, p) => s + p.amount, 0);
  const largest = parts.reduce((best, p) => (!best || p.amount > best.amount ? p : best), null);
  const before = round2((sum * attribution) / 100);
  const revenueShare = (revenue * attribution) / 100;
  let total = before;
  for (const e of effects) {
    const amount = round2((revenueShare * e.pct) / 100);
    total = round2(total + amount);
    parts.push({ id: e.id, label: e.label, pct: e.pct, amount, per_group: false, inputs: [] });
  }
  const calculated = Boolean(answers && answers.calculated);
  const grouping = (plan.groupings || []).find((g) => g.column === plan.grouping);
  const yearly = {
    verb: largest ? largest.verb : 'VALUE AT STAKE', period: VY.PERIOD, estimated: !calculated, calculated, currency,
    total: { unit: currency, amount: total },
    parts,
    groups: { grouping_label: grouping ? grouping.label : '', covered: groups.length, of: allGroups.length },
    case_noun: plan.case_noun || 'record', attribution_pct: attribution, tuned_from_data: tuned,
  };
  return { yearly: { ...yearly, check: VP.checkOf(yearly) } };
}

// REQ-472: the plan with every money estimate input of the ON drivers scaled so its default yearly lands on `target` (the plan carries its groups).
// Drivers with no money estimate input (priced from the data) stay as they are. Null when the plan has no value to scale or no way to reach the target.
function scaleToTarget(plan, target, currency = 'USD') {
  const got = yearlyOf(plan, { currency });
  if (!got.yearly || !(target > 0)) return null;
  const attribution = got.yearly.attribution_pct;
  const scalable = (d) => d.on && d.asks.some((a) => a.source === 'estimate' && a.kind === 'money');
  const ids = new Set(plan.drivers.filter(scalable).map((d) => d.id));
  const parts = got.yearly.parts.filter((p) => !isFactorPart(p));
  const movable = parts.filter((p) => ids.has(p.id)).reduce((s, p) => s + p.amount, 0);
  const fixed = parts.filter((p) => !ids.has(p.id)).reduce((s, p) => s + p.amount, 0);
  const factor = movable > 0 && attribution > 0 ? ((target * 100) / attribution - fixed) / movable : 0;
  if (!(factor > 0)) return null;
  const drivers = plan.drivers.map((d) => (ids.has(d.id)
    ? { ...d, asks: d.asks.map((a) => (a.source === 'estimate' && a.kind === 'money' ? { ...a, default: Math.round(a.default * factor * 10000) / 10000 } : a)) }
    : d));
  return { ...plan, drivers };
}

// The count behind C5 `stale`: records per year of the table under the plan's filter, and the days its date column covers.
function currentCountSql(GP, scopes, plan) {
  const b = binder();
  return GP.statement(scopes, (ctx) => {
    const f = plan.case_filter;
    const from = GP.previewFrom(plan.table, ctx, [plan.date_column, f && f.column, ...VS.scopeColumns(plan.scope)].filter(Boolean));
    const where = whereOf(f, b, plan.date_column, plan.scope, plan.date_text === true);
    const d = VY.dateRead(quote(plan.date_column), plan.date_text === true);
    return `SELECT COUNT(*) AS records, DATEDIFF(MAX(${d}), MIN(${d})) + 1 AS days FROM ${from}${where}`;
  }, b.parameters);
}

// True when the records per year now differ from the saved plan's by more than 10%.
function isStale(plan, row) {
  const now = VY.extrapolate({ amount: Number(row && row.records), sampled: 1, eligible: 1, days: Number(row && row.days) });
  if (now === null) return false;
  const saved = (plan.groups || []).reduce((s, g) => s + (Number(g.records_per_year) || 0), 0);
  return saved === 0 ? now > 0 : Math.abs(now - saved) / saved > 0.1;
}

module.exports = { PLAN_BASIS, currentCountSql, isStale, planMessages, planFrom, fallbackPlan, groupedSql, groupsFrom, yearlyOf, scaleToTarget, GROUP_MIN_RECORDS, GROUP_MAX_GROUPS, DISCLAIMER };
