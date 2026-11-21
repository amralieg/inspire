// REQ-436: the case plan. The model only names the case, the filter, the groupings, the metrics and, per driver, which input comes from
// the data and which is an estimate; every name it gives is checked against the table columns and valueDrivers.json. The arithmetic is
// valueDriversCalc (the one formula implementation); this file builds the plan, the grouped SQL and the C4 yearly.
const VDC = require('./valueDriversCalc');
const { binder } = require('./scoreRefine');
const { parseExactJson } = require('./exactJson');
const { replyContent } = require('./appFeedback');
const VY = require('./valueYearly');

const DEF = VDC.DEFINITION;
const GROUP_MIN_RECORDS = 30;
const GROUP_MAX_GROUPS = 500;
const OTHER = 'Other';
const OPS = ['=', '!=', '>', '>=', '<', '<=', 'is_not_null'];
const AGGS = ['avg', 'sum_per_year'];
const NUMERIC = /^(tinyint|smallint|int|integer|bigint|long|float|double|decimal|numeric|short|byte)/i;
const VERBS = { time_saved: 'REDUCE COST', productivity: 'REDUCE COST', cost_cut: 'REDUCE COST', revenue_uplift: 'GROW REVENUE', risk_avoided: 'AVOID RISK' };
const DEFAULTS = {
  events_per_year: 1000, people: 1, hours_before: 2, hours_after: 1, cost_per_hour: 50, headcount: 10, cost_per_person_year: 60000, gain_pct: 10,
  base_revenue_per_year: 1000000, uplift_pct: 5, spend_per_year: 1000000, cut_pct: 10, incidents_per_year: 100, cost_per_incident: 1000, reduction_pct: 30,
};
const DATA_BY_DEFAULT = ['incidents_per_year', 'events_per_year'];
const DISCLAIMER = 'These figures are estimates built from the records Inspire counted and the numbers you confirm; they are not a forecast.';
const WHY = 'A starting figure to confirm or change.';
const ID_SHAPE = /^[a-z][a-z0-9_]{0,30}$/;

const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const round2 = (n) => Math.round(n * 100) / 100;
const nameOf = (c) => String(c.column_name ?? c.name ?? '');

function askOf(def, input, source) {
  const base = { id: input.id, label: input.label, kind: input.kind };
  if (source) return { ...base, ...source };
  if (DATA_BY_DEFAULT.includes(input.id)) return { ...base, source: 'data', metric: 'records' };
  return { ...base, source: 'estimate', default: DEFAULTS[input.id], why: WHY };
}

function baseGroupings(columns, asked) {
  const text_ = columns.filter((c) => !NUMERIC.test(String(c.data_type)) && !/^(date|timestamp)/i.test(String(c.data_type)));
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
  return { ...plan, drivers: plan.drivers.map((d) => ({ ...d, on: true })) };
}

// ---- the model call ----
function planMessages({ table, columns }) {
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
    'Percent inputs are 0-100. Mark a driver on only when the data supports it.',
  ].join('\n');
  const user = `Table: ${table}\nColumns: ${columns.map((c) => `${nameOf(c)} ${c.data_type}`).join(', ')}`;
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
        asked.set(input.id, askOf(def, input, { source: 'estimate', default: Number(a.default), why: text(a.why, 160) || WHY }));
      }
    }
    return { id: def.id, label: text(d.label, 60) || def.label, verb: VERBS[def.id], on: d.on === true, why: text(d.why, 200),
      asks: def.inputs.map((i) => asked.get(i.id) || askOf(def, i)) };
  });
  return plan;
}

// ---- the grouped SQL ----
function groupedSql(GP, scopes, plan, table, dateColumn) {
  const b = binder();
  const quote = (name) => `\`${String(name).replace(/`/g, '')}\``;
  return GP.statement(scopes, (ctx) => {
    const needed = [dateColumn, plan.grouping, ...plan.metrics.map((m) => m.column), plan.case_filter && plan.case_filter.column].filter(Boolean);
    const from = GP.previewFrom(table, ctx, needed);
    const f = plan.case_filter;
    const where = !f ? '' : f.op === 'is_not_null' ? ` WHERE ${quote(f.column)} IS NOT NULL` : ` WHERE ${quote(f.column)} ${f.op} ${b.bind(f.value)}`;
    const group = plan.grouping ? `COALESCE(CAST(${quote(plan.grouping)} AS STRING), '(blank)')` : "'All'";
    const metrics = plan.metrics.map((m) => `, ${m.agg === 'avg' ? 'AVG' : 'SUM'}(CAST(${quote(m.column)} AS DOUBLE)) AS m_${m.id}`).join('');
    return `SELECT ${group} AS g, COUNT(*) AS records, DATEDIFF(MAX(${quote(dateColumn)}), MIN(${quote(dateColumn)})) + 1 AS days${metrics} FROM ${from}${where}${plan.grouping ? ' GROUP BY 1' : ''}`;
  }, b.parameters);
}

// Rows of the grouped query -> { days, groups }. Groups under GROUP_MIN_RECORDS (and any past GROUP_MAX_GROUPS) go into "Other".
function groupsFrom(rows, plan) {
  const days = Math.max(0, ...rows.map((r) => Number(r.days) || 0));
  const raw = rows.map((r) => ({ g: String(r.g), records: Number(r.records) || 0, row: r })).sort((a, b) => b.records - a.records);
  const kept = raw.filter((r, i) => r.records >= GROUP_MIN_RECORDS && i < GROUP_MAX_GROUPS);
  const rest = raw.filter((r) => !kept.includes(r));
  const scale = (n) => round2(VY.extrapolate({ amount: n, sampled: 1, eligible: 1, days }) ?? 0);
  const metricOf = (m, set) => {
    const records = set.reduce((s, r) => s + r.records, 0);
    const col = `m_${m.id}`;
    if (m.agg === 'sum_per_year') return scale(set.reduce((s, r) => s + (Number(r.row[col]) || 0), 0));
    return records ? round2(set.reduce((s, r) => s + (Number(r.row[col]) || 0) * r.records, 0) / records) : 0;
  };
  const make = (g, set) => ({ g, records_per_year: scale(set.reduce((s, r) => s + r.records, 0)), metrics: Object.fromEntries(plan.metrics.map((m) => [m.id, metricOf(m, set)])) });
  const groups = kept.map((r) => make(r.g, [r]));
  if (rest.length) groups.push(make(OTHER, rest));
  return { days, groups };
}

// ---- the yearly (C4) ----
const dataAsksOf = (driver) => driver.asks.filter((a) => a.source === 'data');

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
  const parts = [];
  for (const d of drivers) {
    const mine = given[d.id] && typeof given[d.id] === 'object' ? given[d.id] : {};
    if (!(mine.on === undefined ? d.on : mine.on === true)) continue;
    const typed = mine.inputs && typeof mine.inputs === 'object' ? mine.inputs : {};
    const fixed = {};
    const shown = [];
    for (const ask of d.asks) {
      if (ask.source === 'data') continue;
      const raw = typed[ask.id] !== undefined && typed[ask.id] !== null && typed[ask.id] !== '' ? typed[ask.id] : ask.default;
      const n = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(n) || n < 0) errors[d.id] = `${d.label}: "${ask.label}" must be a number of 0 or more.`;
      else if (ask.kind === 'pct' && n > 100) errors[d.id] = `${d.label}: "${ask.label}" must be between 0 and 100.`;
      fixed[ask.id] = n;
    }
    if (!errors[d.id] && fixed.hours_after !== undefined && fixed.hours_before !== undefined && fixed.hours_after > fixed.hours_before) {
      errors[d.id] = `${d.label}: hours with the use case cannot be more than hours today.`;
    }
    if (errors[d.id]) continue;
    const dataAsks = dataAsksOf(d);
    const amount = round2(VDC.amountOverGroups(d.id, fixed, dataAsks, groups));
    parts.push({ id: d.id, label: d.label, verb: d.verb || VERBS[d.id], amount, per_group: dataAsks.length > 0,
      inputs: d.asks.map((ask) => ({ id: ask.id, label: ask.label, kind: ask.kind, source: ask.source,
        value: ask.source === 'data' ? round2(VDC.dataFigure(ask, groups)) : fixed[ask.id] })) });
  }
  if (Object.keys(errors).length) return { errors };
  const sum = parts.reduce((s, p) => s + p.amount, 0);
  const largest = parts.reduce((best, p) => (!best || p.amount > best.amount ? p : best), null);
  const calculated = Boolean(answers && answers.calculated);
  const grouping = (plan.groupings || []).find((g) => g.column === plan.grouping);
  return { yearly: {
    verb: largest ? largest.verb : 'VALUE AT STAKE', period: VY.PERIOD, estimated: !calculated, calculated, currency,
    total: { unit: currency, amount: round2((sum * attribution) / 100) },
    parts,
    groups: { grouping_label: grouping ? grouping.label : '', covered: groups.length, of: allGroups.length },
    case_noun: plan.case_noun || 'record', attribution_pct: attribution,
  } };
}

// The count behind C5 `stale`: records per year of the table under the plan's filter, and the days its date column covers.
function currentCountSql(GP, scopes, plan) {
  const b = binder();
  const quote = (name) => `\`${String(name).replace(/`/g, '')}\``;
  return GP.statement(scopes, (ctx) => {
    const f = plan.case_filter;
    const from = GP.previewFrom(plan.table, ctx, [plan.date_column, f && f.column].filter(Boolean));
    const where = !f ? '' : f.op === 'is_not_null' ? ` WHERE ${quote(f.column)} IS NOT NULL` : ` WHERE ${quote(f.column)} ${f.op} ${b.bind(f.value)}`;
    return `SELECT COUNT(*) AS records, DATEDIFF(MAX(${quote(plan.date_column)}), MIN(${quote(plan.date_column)})) + 1 AS days FROM ${from}${where}`;
  }, b.parameters);
}

// True when the records per year now differ from the saved plan's by more than 10%.
function isStale(plan, row) {
  const now = VY.extrapolate({ amount: Number(row && row.records), sampled: 1, eligible: 1, days: Number(row && row.days) });
  if (now === null) return false;
  const saved = (plan.groups || []).reduce((s, g) => s + (Number(g.records_per_year) || 0), 0);
  return saved === 0 ? now > 0 : Math.abs(now - saved) / saved > 0.1;
}

module.exports = { currentCountSql, isStale, planMessages, planFrom, fallbackPlan, groupedSql, groupsFrom, yearlyOf, GROUP_MIN_RECORDS, GROUP_MAX_GROUPS, DISCLAIMER };
