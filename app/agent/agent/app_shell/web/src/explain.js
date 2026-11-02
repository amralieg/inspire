import { compareValues, countOf, dayLabel, plainText } from './format.js';

export const EXPLAIN_TITLE_CHARS = 120;
export const EXPLAIN_CONTEXT_CHARS = 12000;
export const EXPLAIN_ROWS = 40;
export const EXPLAIN_CELL_CHARS = 160;
export const EXPLAIN_FIELDS = 40;
export const EXPLAIN_HISTORY = 10;
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

function capped(kind, context) {
  if (kind === 'chart') {
    const rows = Array.isArray(context.rows) ? context.rows : [];
    return { ...context, rows: rows.slice(0, EXPLAIN_ROWS), row_count: compareValues(countOf(context.row_count), rows.length) > 0 ? countOf(context.row_count) : rows.length };
  }
  return {
    ...context, fields: cells(Object.entries(context.fields || {}).slice(0, EXPLAIN_FIELDS)),
    history: (Array.isArray(context.history) ? context.history : []).slice(0, EXPLAIN_HISTORY).map(version),
  };
}

function version(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? cells(Object.entries(value)) : cell(value);
}

const entries = (value) => (Array.isArray(value) ? value : Object.entries(value));
const dropLast = (value) => (Array.isArray(value) ? value.slice(0, -1) : Object.fromEntries(Object.entries(value).slice(0, -1)));

export function explainBody(kind, page, title, context) {
  const out = capped(kind, context || {});
  for (const key of kind === 'chart' ? ['rows'] : ['history', 'fields']) {
    while (JSON.stringify(out).length > EXPLAIN_CONTEXT_CHARS && entries(out[key]).length) out[key] = dropLast(out[key]);
  }
  return { kind, page, title: cutText(title, EXPLAIN_TITLE_CHARS), context: out };
}
