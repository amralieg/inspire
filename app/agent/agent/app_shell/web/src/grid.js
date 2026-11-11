import { asDate, compareValues, isAmount, numberOf } from './format.js';
import { RANGE_EDGES, columnFilterOn } from './filters.js';

export const movableKeys = (columns) => columns.filter((c) => !c.fixed).map((c) => c.key);

export function savedOrder(natural, saved) {
  const known = new Set(natural);
  const kept = [...new Set((Array.isArray(saved) ? saved : []).filter((k) => known.has(k)))];
  if (!kept.length) return natural;
  const out = [...kept];
  natural.forEach((key, i) => {
    if (out.includes(key)) return;
    const before = natural.slice(0, i).reverse().find((k) => out.includes(k));
    out.splice(before == null ? 0 : out.indexOf(before) + 1, 0, key);
  });
  return out;
}

export function orderColumns(columns, saved) {
  const order = savedOrder(movableKeys(columns), saved);
  const by = new Map(columns.map((c) => [c.key, c]));
  let at = 0;
  return columns.map((c) => (c.fixed ? c : by.get(order[at++])));
}

export function moveKey(order, key, to) {
  if (!order.includes(key)) return order;
  const out = order.filter((k) => k !== key);
  out.splice(Math.max(0, Math.min(out.length, to)), 0, key);
  return out;
}

export const sameOrder = (a, b) => a.length === b.length && a.every((k, i) => k === b[i]);

export const columnName = (c) => (typeof c.label === 'string' && c.label ? c.label : c.title || String(c.key));

export function localKind(c) {
  if (c.fixed || c.filter === false) return '';
  if (c.filter) return c.filter;
  return c.date ? 'date_range' : c.num ? 'number_range' : 'multi_select';
}

export const cellValue = (c) => c.filterValue || c.sortValue || ((r) => r[c.key]);

const present = (v) => v != null && v !== '';

export function localFilters(columns, rows) {
  return columns.flatMap((c) => {
    const type = localKind(c);
    if (!type) return [];
    const filter = { column: c.key, type, label: columnName(c) };
    if (type !== 'multi_select') return [filter];
    const value = cellValue(c);
    const seen = new Set();
    (rows || []).forEach((r) => {
      const v = value(r);
      if (present(v)) seen.add(String(v));
    });
    return seen.size ? [{ ...filter, options: [...seen].sort(compareValues) }] : [];
  });
}

export function passes(filter, raw, picked) {
  if (!columnFilterOn(picked)) return true;
  if (filter.type === 'multi_select') return present(raw) && picked.includes(String(raw));
  const [lo, hi] = RANGE_EDGES[filter.type];
  if (!present(raw)) return false;
  if (filter.type === 'date_range') {
    const at = asDate(raw);
    if (!at) return false;
    const day = at.toISOString().slice(0, 10);
    return (!present(picked[lo]) || day >= String(picked[lo])) && (!present(picked[hi]) || day <= String(picked[hi]));
  }
  if (!isAmount(raw)) return false;
  const n = numberOf(raw);
  return (!present(picked[lo]) || n >= Number(picked[lo])) && (!present(picked[hi]) || n <= Number(picked[hi]));
}

export function searchRows(rows, columns, text) {
  const q = String(text ?? '').trim().toLowerCase();
  if (!q) return rows;
  const reads = columns.map((c) => cellValue(c));
  return rows.filter((r) => reads.some((read) => String(read(r) ?? '').toLowerCase().includes(q)));
}

export function filterRows(rows, columns, filters, values) {
  const live = filters.filter((f) => columnFilterOn(values?.[f.column]));
  if (!live.length) return rows;
  const by = new Map(columns.map((c) => [c.key, cellValue(c)]));
  return rows.filter((r) => live.every((f) => passes(f, by.get(f.column)(r), values[f.column])));
}
