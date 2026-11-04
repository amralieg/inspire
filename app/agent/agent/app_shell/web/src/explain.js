import { compareValues, countOf, dayLabel, plainText } from './format.js';
import { cellValue } from './grid.js';
import { plural } from './hub.js';

export const EXPLAIN_TITLE_CHARS = 120;
export const EXPLAIN_CONTEXT_CHARS = 12000;
export const EXPLAIN_ROWS = 40;
export const EXPLAIN_CELL_CHARS = 160;
export const EXPLAIN_LINE_CHARS = 1000;
export const EXPLAIN_FIELDS = 40;
export const EXPLAIN_HISTORY = 10;
export const ASK_CHARS = 1000;
export const BUSY_TITLE = 'Genie is still answering';

export function cutText(text, n) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

function cell(value) {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  return cutText(typeof value === 'object' ? plainText(value) : value, EXPLAIN_CELL_CHARS);
}

const cells = (pairs) => Object.fromEntries(pairs.map(([k, v]) => [cutText(k, EXPLAIN_CELL_CHARS), cell(v)]));
const measureLabels = (chart) => (chart.y || []).map((y, i) => y.label || `Measure ${i + 1}`);

export function chartRow(chart, row) {
  const pairs = [];
  if (chart.type === 'scatter') pairs.push(['Group', row.x_label]);
  pairs.push([chart.x?.label || 'x', row.x]);
  if (chart.series) pairs.push(['Series', row.s]);
  measureLabels(chart).forEach((label, i) => pairs.push([label, row[`y${i}`]]));
  return cells(pairs);
}

export function chartContext(chart, result) {
  const rows = result?.rows || [];
  return {
    hint: chart.hint || '', type: chart.type, x: chart.x?.label || '', measures: measureLabels(chart),
    rows: rows.slice(0, EXPLAIN_ROWS).map((r) => chartRow(chart, r)), row_count: rows.length, truncated: !!result?.truncated,
  };
}

export const CHART_KINDS = { fan_chart: 'series' };
export const CHART_ITEM_KINDS = { process_map: 'process_step', map: 'site', graph: 'node', incrementality_waterfall: 'bridge_step' };
const LINKED_CHARTS = ['flow', 'graph'];

export const chartKind = (chart) => CHART_KINDS[chart.section] || 'chart';

export function chartItems(chart, result) {
  const kind = CHART_ITEM_KINDS[chart.section];
  const rows = result?.rows || [];
  if (!kind) return [];
  const ends = (r) => (LINKED_CHARTS.includes(chart.type) ? [r.x, r.s] : [r.x]).filter((v) => v != null && String(v).trim() !== '').map(String);
  const hint = [`Part of the chart "${chart.title}".`, chart.hint || ''].filter(Boolean).join(' ');
  return [...new Set(rows.flatMap(ends))].slice(0, EXPLAIN_ROWS).map((name) => {
    const own = rows.filter((r) => ends(r).includes(name));
    return { kind, title: name, context: { hint, rows: own.slice(0, EXPLAIN_ROWS).map((r) => chartRow(chart, r)), row_count: own.length } };
  });
}

export function barsContext({ hint, vertical, x, measure, filters }, bars) {
  const rows = (bars || []).map((b) => cells([[x, b.label], [measure, countOf(b.value)], ['Shown as', b.text]]));
  return { hint: hint || '', type: vertical ? 'bar' : 'horizontal_bar', x, measures: [measure], rows: rows.slice(0, EXPLAIN_ROWS), row_count: rows.length,
    truncated: false, filters: filters || '' };
}

function rangeWords(range) {
  return range?.from && range?.to ? `${dayLabel(range.from)} to ${dayLabel(range.to)}` : 'all time';
}

export function filterWords(filters, state) {
  const parts = [];
  (filters || []).forEach((f) => {
    if (f.type === 'date_range') {
      if (state?.range?.[f.id]) parts.push(`${f.label}: ${rangeWords(state.range[f.id])}`);
    } else if (state?.sel?.[f.id]?.length) {
      parts.push(`${f.label}: ${state.sel[f.id].join(', ')}`);
    }
  });
  return parts.join('; ');
}

const SHRINK = { chart: ['rows'], record: ['history', 'fields'] };
const shrinkOrder = (kind) => SHRINK[kind] || ['rows', 'fields'];

function cappedRows(context) {
  const rows = Array.isArray(context.rows) ? context.rows : [];
  return { rows: rows.slice(0, EXPLAIN_ROWS).map(version), row_count: compareValues(countOf(context.row_count), rows.length) > 0 ? countOf(context.row_count) : rows.length };
}

const cappedFields = (context) => ({ fields: cells(Object.entries(context.fields || {}).slice(0, EXPLAIN_FIELDS)) });

function capped(kind, context) {
  if (kind === 'chart') return { ...context, ...cappedRows(context) };
  if (kind === 'record') {
    return { ...context, ...cappedFields(context), history: (Array.isArray(context.history) ? context.history : []).slice(0, EXPLAIN_HISTORY).map(version) };
  }
  const lines = Object.fromEntries(['hint', 'filters'].filter((key) => typeof context[key] === 'string').map((key) => [key, cutText(context[key], EXPLAIN_LINE_CHARS)]));
  return { ...context, ...lines, ...cappedFields(context), ...(context.rows ? cappedRows(context) : {}) };
}

export function tableContext(hint, rows, fields, count = rows.length) {
  return { hint, rows: rows.slice(0, EXPLAIN_ROWS).map(fields), row_count: count };
}

export function fieldsOf(row, columns) {
  return Object.fromEntries(columns.map((c) => [typeof c.label === 'string' && c.label ? c.label : c.key, cellValue(c)(row)]).filter(([, v]) => v !== undefined));
}

function version(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? cells(Object.entries(value)) : cell(value);
}

const entries = (value) => (Array.isArray(value) ? value : Object.entries(value));
const dropLast = (value) => (Array.isArray(value) ? value.slice(0, -1) : Object.fromEntries(Object.entries(value).slice(0, -1)));

export function explainBody(kind, page, title, context, question = '') {
  const out = capped(kind, context || {});
  for (const key of shrinkOrder(kind)) {
    while (out[key] && JSON.stringify(out).length > EXPLAIN_CONTEXT_CHARS && entries(out[key]).length) out[key] = dropLast(out[key]);
  }
  const asked = cutText(question, ASK_CHARS);
  return { kind, page, title: cutText(title, EXPLAIN_TITLE_CHARS), context: out, ...(asked ? { question: asked } : {}) };
}

export const SUGGESTIONS = {
  chart: ['What stands out in this chart?', 'What drives the biggest change here?', 'What should we do about it?'],
  record: ['Why is this row here?', 'Are there others like it?', 'What should we do about it?'],
  kpi: ['Why is this number where it is?', 'What moved it most?', 'Is this good or bad for us?'],
  text: ['What does this mean for us?', 'Which numbers back this up?'],
  controls: ['What do these filters leave out?', 'Which filter changes the picture most?'],
  table: ['What stands out in this table?', 'Which rows need attention first?'],
  series: ['Why is this series forecast this way?', 'How accurate was it before?', 'What could push it off the forecast?'],
  scenario: ['What has to be true to reach the target?', 'Which lever matters most?', 'How likely is the downside?'],
  segment: ['What sets this segment apart?', 'Who moved into it lately?', 'What should we offer it?'],
  recommendation: ['Why is this offered?', 'How did offers like it do before?', 'What else could we offer?'],
  bridge_step: ['What is behind this step?', 'Which units drive it most?', 'Is it a plan change or a real change?'],
  effect: ['Is this effect real?', 'What did it net after cost?', 'Should we scale, keep or stop it?'],
  process_step: ['Why do cases wait here?', 'Which cases are at risk of breach?', 'What would speed this step up?'],
  site: ['Why does this site rank here?', 'How does it compare with nearby sites?', 'What risk does it carry?'],
  node: ['Why does this node matter?', 'Who is it linked to?', 'Does it look like part of a ring?'],
};

export function receives(context) {
  const parts = ['its name'];
  const fields = Object.keys(context?.fields || {}).length;
  const rows = Math.max(Number(countOf(context?.row_count)) || 0, (context?.rows || []).length);
  if (fields) parts.push(plural(fields, 'value'));
  if (rows) parts.push(plural(rows, 'row'));
  if (context?.filters) parts.push('the page filters');
  return `${parts.slice(0, -1).join(', ')}${parts.length > 1 ? ' and ' : ''}${parts[parts.length - 1]}`;
}

export function scoped(context, filters) {
  const both = [filters, context?.filters].filter(Boolean).join('; ');
  return { ...(context || {}), ...(both ? { filters: both } : {}) };
}

export function rowTitle(row, columns) {
  const first = columns.find((c) => row[c.key] != null && row[c.key] !== '');
  return first ? plainText(row[first.key]) : 'this row';
}
