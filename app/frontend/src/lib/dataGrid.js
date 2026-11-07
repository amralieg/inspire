export const GRID_CAPS = { grids: 100, keys: 100, chars: 200 };
export const CHOICES_SHOWN = 200;
export const GRID_ORDER_KEY = 'inspire.grid_columns';

const NUMBER_TEXT = /^[-+]?(\d{1,3}(,\d{3})+|\d+)?(\.\d+)?%?$/;
const DAY_TEXT = /^\d{4}-\d{2}-\d{2}/;

export const present = (v) => v != null && String(v).trim() !== '';

export function numberOf(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value ?? '').trim();
  if (!text || !/\d/.test(text) || !NUMBER_TEXT.test(text)) return null;
  const n = Number(text.replace(/[,%]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function dayOf(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
  const text = String(value ?? '').trim();
  return DAY_TEXT.test(text) ? text.slice(0, 10) : '';
}

const NUMBER_FIRST = /^[-+]?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?%?(\s+\D+)?$/;

export function numericColumn(c, rows, kind) {
  if (kind === 'number') return true;
  if (kind !== 'text') return false;
  const seen = (rows || []).map(cellOf(c)).filter(present);
  return seen.length > 0 && seen.every((v) => NUMBER_FIRST.test(String(v).trim()));
}

export const columnName = (c) => (typeof c.label === 'string' && c.label ? c.label : String(c.key));

export const cellOf = (c) => c.value || ((row) => row[c.key]);

export function columnKind(c, rows) {
  if (c.kind) return c.kind;
  const value = cellOf(c);
  const seen = (rows || []).map(value).filter(present);
  if (!seen.length) return 'text';
  if (seen.every((v) => numberOf(v) != null)) return 'number';
  if (seen.every((v) => dayOf(v))) return 'date';
  return 'text';
}

const textOf = (v) => (present(v) ? String(v).trim() : '');

export function compareCells(a, b, kind) {
  const left = present(a);
  const right = present(b);
  if (!left || !right) return left === right ? 0 : left ? -1 : 1;
  if (kind === 'number') return numberOf(a) - numberOf(b);
  if (kind === 'date') return dayOf(a) < dayOf(b) ? -1 : dayOf(a) > dayOf(b) ? 1 : 0;
  return textOf(a).localeCompare(textOf(b), 'en', { numeric: true, sensitivity: 'base' });
}

export function sortRows(rows, column, dir, kind) {
  if (!column || !dir) return rows;
  const value = cellOf(column);
  return rows
    .map((row, at) => ({ row, at, v: value(row) }))
    .sort((x, y) => {
      const blank = present(x.v) - present(y.v);
      if (blank) return -blank;
      return compareCells(x.v, y.v, kind) * dir || x.at - y.at;
    })
    .map((x) => x.row);
}

export const nextSort = (sort, key, kind) => {
  const first = kind === 'number' || kind === 'date' ? -1 : 1;
  if (sort?.key !== key) return { key, dir: first };
  return sort.dir === first ? { key, dir: -first } : null;
};

export const filterable = (c) => !c.fixed && c.filter !== false;

export function choicesOf(rows, c) {
  const value = cellOf(c);
  const seen = new Set();
  (rows || []).forEach((row) => {
    const v = textOf(value(row));
    if (v) seen.add(v);
  });
  return [...seen].sort((a, b) => compareCells(a, b, 'text'));
}

export function filterOn(picked) {
  if (!picked) return false;
  if (Array.isArray(picked.values)) return picked.values.length > 0;
  return present(picked.min) || present(picked.max) || present(picked.from) || present(picked.to);
}

export function passes(kind, raw, picked) {
  if (!filterOn(picked)) return true;
  if (!present(raw)) return false;
  if (Array.isArray(picked.values)) return picked.values.includes(textOf(raw));
  if (kind === 'number') {
    const n = numberOf(raw);
    if (n == null) return false;
    return (!present(picked.min) || n >= Number(picked.min)) && (!present(picked.max) || n <= Number(picked.max));
  }
  const day = dayOf(raw);
  if (!day) return false;
  return (!present(picked.from) || day >= picked.from) && (!present(picked.to) || day <= picked.to);
}

export function filterRows(rows, columns, kinds, filters) {
  const live = columns.filter((c) => filterable(c) && filterOn(filters?.[c.key]));
  if (!live.length) return rows;
  return rows.filter((row) => live.every((c) => passes(kinds[c.key], cellOf(c)(row), filters[c.key])));
}

export const filtersOn = (filters) => Object.values(filters || {}).filter(filterOn).length;

export function toggleChoice(picked, choice) {
  const values = Array.isArray(picked?.values) ? picked.values : [];
  const next = values.includes(choice) ? values.filter((v) => v !== choice) : [...values, choice];
  return { values: next };
}

export function narrowChoices(choices, query) {
  const q = String(query || '').trim().toLowerCase();
  const kept = q ? choices.filter((c) => c.toLowerCase().includes(q)) : choices;
  return { shown: kept.slice(0, CHOICES_SHOWN), count: kept.length };
}

export function choicesHint(count) {
  return count > CHOICES_SHOWN ? `Showing ${CHOICES_SHOWN} of ${count.toLocaleString('en-US')} choices. Type to narrow them.` : '';
}

export function filterText(c, kind, picked) {
  if (!filterOn(picked)) return '';
  const name = columnName(c);
  if (Array.isArray(picked.values)) {
    return picked.values.length === 1 ? `${name} is ${picked.values[0]}` : `${name} is one of ${picked.values.length} values`;
  }
  const [lo, hi] = kind === 'number' ? [picked.min, picked.max] : [picked.from, picked.to];
  if (present(lo) && present(hi)) return `${name} from ${lo} to ${hi}`;
  return present(lo) ? `${name} from ${lo}` : `${name} up to ${hi}`;
}

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

export function orderColumns(columns, order) {
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

const shortText = (v) => typeof v === 'string' && v.length > 0 && v.length <= GRID_CAPS.chars;

function readOrders(storage) {
  try {
    const all = JSON.parse(storage?.getItem(GRID_ORDER_KEY) || '{}');
    return all && typeof all === 'object' && !Array.isArray(all) ? all : {};
  } catch {
    return {};
  }
}

export function loadColumnOrder(grid, storage = globalThis.localStorage) {
  if (!shortText(grid)) return null;
  const saved = readOrders(storage)[grid];
  return Array.isArray(saved) ? [...new Set(saved.filter(shortText))].slice(0, GRID_CAPS.keys) : null;
}

export function saveColumnOrder(grid, order, storage = globalThis.localStorage) {
  if (!shortText(grid)) return false;
  const all = readOrders(storage);
  delete all[grid];
  const keys = [...new Set((order || []).filter(shortText))].slice(0, GRID_CAPS.keys);
  if (keys.length) all[grid] = keys;
  const kept = Object.fromEntries(Object.entries(all).filter(([k, v]) => shortText(k) && Array.isArray(v)).slice(-GRID_CAPS.grids));
  try {
    storage.setItem(GRID_ORDER_KEY, JSON.stringify(kept));
    return true;
  } catch {
    return false;
  }
}
