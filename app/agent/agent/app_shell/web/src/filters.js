import { plural } from './hub.js';

export function initialFilterState(meta) {
  const state = { range: {}, sel: {} };
  (meta || []).forEach((f) => {
    if (f.type !== 'date_range') return;
    const preset = (f.presets || []).find((p) => p.id === f.default) || (f.presets || [])[0];
    state.range[f.id] = preset ? { preset: preset.id, from: preset.from, to: preset.to } : { preset: 'all', from: '', to: '' };
  });
  return state;
}

export function apiValues(state) {
  const out = {};
  Object.entries(state?.range || {}).forEach(([id, r]) => {
    if (r.preset !== 'all' && r.from && r.to) out[id] = { from: r.from, to: r.to };
  });
  Object.entries(state?.sel || {}).forEach(([id, values]) => {
    if (values?.length && !isSharedId(id)) out[id] = values;
  });
  return out;
}

export function choosePreset(state, filter, presetId) {
  const range = { ...state.range };
  if (presetId === 'custom') {
    const current = range[filter.id] || {};
    range[filter.id] = { preset: 'custom', from: current.from || filter.low || '', to: current.to || filter.high || '' };
  } else {
    const preset = (filter.presets || []).find((p) => p.id === presetId);
    range[filter.id] = preset ? { preset: preset.id, from: preset.from, to: preset.to } : { preset: 'all', from: '', to: '' };
  }
  return { ...state, range };
}

export function setRangeEdge(state, filterId, edge, value) {
  const current = state.range[filterId] || { preset: 'custom', from: '', to: '' };
  return { ...state, range: { ...state.range, [filterId]: { ...current, preset: 'custom', [edge]: value } } };
}

export function setSelection(state, filterId, values) {
  const sel = { ...state.sel };
  if (values?.length) sel[filterId] = values;
  else delete sel[filterId];
  return { ...state, sel };
}

export function toggleValue(state, filterId, value) {
  const current = state.sel[filterId] || [];
  const text = String(value);
  return setSelection(state, filterId, current.includes(text) ? current.filter((v) => v !== text) : [...current, text]);
}

export const knownChoices = (filter) => (Array.isArray(filter?.options) && !filter.lazy && !filter.searchable ? new Set(filter.options.map(String)) : null);

export const OPTION_MATCHES = 50;

export function matching(options, query) {
  const q = String(query || '').trim().toLowerCase();
  return (options || []).map(String).filter((v) => !q || v.toLowerCase().includes(q));
}

export const CHOICES_SHOWN = 200;

export const choicesHint = (count) => (count > CHOICES_SHOWN ? `Showing ${CHOICES_SHOWN} of ${plural(count, 'choice')}. Type to narrow them.` : '');

export function searchHint(filter, query, found) {
  if (!filter?.searchable) return '';
  const q = String(query || '').trim();
  if (!q && filter.lazy) {
    if (found.error) return `The choices could not load: ${found.error}`;
    if (found.busy || found.options == null) return 'Loading the choices…';
    return found.options.length >= OPTION_MATCHES ? `Showing the first ${plural(OPTION_MATCHES, 'choice')}. Type to search all of them.` : '';
  }
  if (!q) return `Showing the first ${plural((filter.options || []).length, 'choice')}. Type to search all of them.`;
  if (found.busy || found.q !== q) return 'Searching all the choices…';
  if (found.error) return `The search failed: ${found.error}`;
  if ((found.options || []).length >= OPTION_MATCHES) return `Showing the first ${OPTION_MATCHES} matches. Type more to narrow them.`;
  return '';
}

export function clearSelections(state) {
  return { ...state, sel: {} };
}

export const hasSelections = (state) => Object.values(state?.sel || {}).some((v) => v?.length);

export const RANGE_EDGES = { number_range: ['min', 'max'], date_range: ['from', 'to'] };

const filled = (v) => v != null && v !== '';

export function columnFilterOn(value) {
  if (Array.isArray(value)) return value.length > 0;
  return !!value && typeof value === 'object' && Object.values(value).some(filled);
}

export function columnValues(state, table) {
  const columns = state?.columns || {};
  return (table == null ? columns.list : columns.tables?.[table]) || {};
}

function withColumnValues(state, table, own) {
  const tables = { ...(state?.columns?.tables || {}) };
  if (table != null && Object.keys(own).length) tables[table] = own;
  else if (table != null) delete tables[table];
  return { ...state, columns: { list: table == null ? own : { ...(state?.columns?.list || {}) }, tables } };
}

export function withValue(values, column, value) {
  const own = { ...(values || {}) };
  if (columnFilterOn(value)) own[column] = value;
  else delete own[column];
  return own;
}

export const setColumnValue = (state, table, column, value) => withColumnValues(state, table, withValue(columnValues(state, table), column, value));

export const clearColumnValues = (state, table) => withColumnValues(state, table, {});

export const columnFiltersOn = (values) => Object.values(values || {}).filter(columnFilterOn).length;

export const apiColumns = (values) => Object.fromEntries(Object.entries(values || {}).filter(([, v]) => columnFilterOn(v)));

export function apiTables(state) {
  return Object.fromEntries(Object.entries(state?.columns?.tables || {}).map(([id, v]) => [id, apiColumns(v)]).filter(([, v]) => Object.keys(v).length));
}

export function rangeProblem(kind, low, high) {
  const [l, h] = [String(low ?? '').trim(), String(high ?? '').trim()];
  if (kind === 'number_range' && [l, h].some((t) => t && !Number.isFinite(Number(t)))) return 'Enter a number';
  if (l && h && (kind === 'number_range' ? Number(l) > Number(h) : l > h)) return 'The From value is above the To value';
  return '';
}

export function rangeValue(kind, low, high) {
  const [lo, hi] = RANGE_EDGES[kind];
  const read = (t) => (String(t ?? '').trim() === '' ? null : kind === 'number_range' ? Number(t) : String(t).trim());
  const out = { [lo]: read(low), [hi]: read(high) };
  return out[lo] == null && out[hi] == null ? null : out;
}

export function columnFilterText(filter, value) {
  if (!columnFilterOn(value)) return 'All';
  if (Array.isArray(value)) return value.length === 1 ? String(value[0]) : `${value.length} selected`;
  const [lo, hi] = RANGE_EDGES[filter.type] || [];
  const show = (v) => (filter.type === 'number_range' ? Number(v).toLocaleString('en-US') : String(v));
  if (filled(value[lo]) && filled(value[hi])) return `${show(value[lo])} to ${show(value[hi])}`;
  return filled(value[lo]) ? `from ${show(value[lo])}` : `up to ${show(value[hi])}`;
}

export function rangeLabel(filter, r) {
  if (!r) return '';
  if (r.preset === 'custom') return `${r.from} to ${r.to}`;
  return ((filter?.presets || []).find((p) => p.id === r.preset)?.label || 'All time').toLowerCase();
}

export const HIGH_CARDINALITY = 8;

const labelKey = (label) => String(label ?? '').trim().toLowerCase();

export const sharedLabelId = (label) => `label:${labelKey(label)}`;

export const isSharedId = (id) => String(id ?? '').startsWith('label:');

export function setSharedValues(state, aliases, id, values) {
  const pairs = Object.entries(aliases || {}).filter(([, v]) => v === id).map(([key]) => key.split('|'));
  return pairs.reduce((next, [table, column]) => setColumnValue(next, table === '' ? null : table, column, values), setSelection(state, id, values));
}

function pickColumns(meta) {
  return [...(meta?.columns?.list || []).map((f) => ({ ...f, table: null })),
    ...Object.entries(meta?.columns?.tables || {}).flatMap(([table, list]) => (list || []).map((f) => ({ ...f, table })))]
    .filter((f) => f.type === 'multi_select' && !f.action);
}

function sameLabelCounts(columns) {
  const counts = new Map();
  columns.forEach((f) => counts.set(labelKey(f.label), (counts.get(labelKey(f.label)) || 0) + 1));
  return counts;
}

export function groupsOf(meta) {
  const page = (meta?.filters || []).filter((f) => f.type === 'multi_select')
    .map((f) => ({ key: `page:${f.id}`, id: f.id, label: f.label, filter: f, table: null, column: null, page: true }));
  const named = new Set(page.map((g) => labelKey(g.label)));
  const columns = pickColumns(meta).filter((f) => !named.has(labelKey(f.label)));
  const counts = sameLabelCounts(columns);
  const seen = new Set();
  const columnGroups = columns.flatMap((f) => {
    const key = labelKey(f.label);
    if ((counts.get(key) || 0) < 2) {
      return [{ key: `col:${f.table ?? ''}:${f.column}`, id: f.column, label: f.label, filter: { ...f, id: f.column, which: f.table == null ? { column: f.column } : { table: f.table, column: f.column } },
        table: f.table ?? null, column: f.column, page: false }];
    }
    if (seen.has(key)) return [];
    seen.add(key);
    const id = sharedLabelId(f.label);
    return [{ key: id, id, label: f.label, filter: { ...f, id, which: { column: f.column } }, table: null, column: null, page: true,
      pairs: columns.filter((c) => labelKey(c.label) === key).map((c) => ({ table: c.table ?? null, column: c.column })) }];
  });
  const all = [...page, ...columnGroups];
  return all.map((g) => ({ ...g, high: !g.filter.grouping && (!!g.filter.searchable || !!g.filter.lazy || (g.filter.options || []).length > HIGH_CARDINALITY) }))
    .sort((a, b) => Number(a.high) - Number(b.high));
}


export function groupedByText(grouping) {
  const names = (grouping?.group_by || []).map((g) => g.label).filter(Boolean);
  return names.length ? `Grouped by ${names.join(', ')}` : '';
}

export function groupValues(state, group) {
  return group.page ? state?.sel?.[group.id] || [] : columnValues(state, group.table)[group.column] || [];
}

export function setGroupValues(state, group, values) {
  if (group.pairs) return group.pairs.reduce((next, { table, column }) => setColumnValue(next, table, column, values), setSelection(state, group.id, values));
  if (group.page) return setSelection(state, group.id, values);
  return setColumnValue(state, group.table, group.column, values);
}

export function clearGroups(state) {
  return { ...clearSelections(state), columns: { list: {}, tables: {} } };
}

export const groupsOn = (state, groups) => groups.some((g) => groupValues(state, g).length > 0);

export function groupAliases(meta) {
  const pages = new Map((meta?.filters || []).filter((f) => f.type === 'multi_select').map((f) => [labelKey(f.label), f.id]));
  const columns = pickColumns(meta);
  const counts = sameLabelCounts(columns);
  const out = {};
  columns.forEach((f) => {
    const key = labelKey(f.label);
    const id = pages.get(key) || ((counts.get(key) || 0) > 1 ? sharedLabelId(f.label) : null);
    if (id) out[`${f.table ?? ''}|${f.column}`] = id;
  });
  return out;
}

export function columnValuesIn(state, table, aliases) {
  const own = { ...columnValues(state, table) };
  Object.entries(aliases || {}).forEach(([key, id]) => {
    const [t, column] = key.split('|');
    if (t === String(table ?? '')) own[column] = state?.sel?.[id] || [];
  });
  return own;
}

export function setColumnValueIn(state, table, column, value, aliases) {
  const id = (aliases || {})[`${table ?? ''}|${column}`];
  if (isSharedId(id)) return setSharedValues(state, aliases, id, Array.isArray(value) ? value : []);
  if (id) return setSelection(state, id, Array.isArray(value) ? value : []);
  return setColumnValue(state, table, column, value);
}

export function clearColumnValuesIn(state, table, aliases) {
  const cleared = Object.entries(aliases || {}).reduce((next, [key, id]) => {
    const [t] = key.split('|');
    if (isSharedId(id)) return next.sel?.[id] ? setSharedValues(next, aliases, id, []) : next;
    return t === String(table ?? '') && next.sel?.[id] ? setSelection(next, id, []) : next;
  }, state);
  return clearColumnValues(cleared, table);
}
