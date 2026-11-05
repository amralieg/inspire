import { choosePreset, clearSelections, setColumnValue, setSelection } from './filters.js';
import { buildHash } from './links.js';

export const AGENT_OPEN = 'inspire-agent-open';
export const AGENT_CHANGED = 'inspire-agent-changed';
export const EMPTY_LOOK = Object.freeze({ sorts: {}, charts: {} });
const EMPTY_STATE = Object.freeze({ range: {}, sel: {} });

function withRange(state, action, meta) {
  if (action.preset) return choosePreset(state, (meta || []).find((f) => f.id === action.filter) || { id: action.filter, presets: [] }, action.preset);
  return { ...state, range: { ...state.range, [action.filter]: { preset: 'custom', from: action.from, to: action.to } } };
}

function lookWith(look, action) {
  if (action.type === 'sort') return { ...look, sorts: { ...look.sorts, [action.target]: { key: action.key, dir: action.dir } } };
  const own = { ...(look.charts[action.chart] || {}) };
  if (action.chart_type) own.type = action.chart_type;
  if (action.series) own.series = [...action.series];
  return { ...look, charts: { ...look.charts, [action.chart]: own } };
}

export function routeOf(action) {
  if (action.type === 'open_record') return buildHash(action.page, 'overview', null, [], action.record_key);
  if (action.type === 'navigate') return `#/${encodeURIComponent(action.page)}`;
  return '';
}

export function applyActions(view, actions, meta) {
  let state = view.state || EMPTY_STATE;
  let look = view.look || EMPTY_LOOK;
  let route = '';
  let open = null;
  (actions || []).forEach((a) => {
    if (a.type === 'filter') state = setSelection(state, a.filter, a.values);
    else if (a.type === 'range') state = withRange(state, a, meta);
    else if (a.type === 'clear_filters') state = { ...clearSelections(state), columns: { list: {}, tables: {} } };
    else if (a.type === 'column_filter') state = setColumnValue(state, null, a.column, a.values);
    else if (a.type === 'sort' || a.type === 'chart') look = lookWith(look, a);
    else if (a.type === 'navigate' || a.type === 'open_record') {
      route = routeOf(a);
      open = a.type === 'open_record' ? { pageId: a.page, recordKey: a.record_key } : null;
    }
  });
  return { state, look, route, open };
}

const VISIBLE_ROWS = 20;
const visible = new Map();
export const showVisible = (pageId, rows) => visible.set(pageId, (rows || []).slice(0, VISIBLE_ROWS).map((r) => Object.fromEntries(
  Object.entries(r || {}).filter(([k]) => !k.startsWith('_inspire_') || k === '_inspire_status'))));
export const visibleOf = (pageId) => visible.get(pageId) || [];

export const changesView = (actions) => (actions || []).some((a) => a.type !== 'navigate' && a.type !== 'open_record');

function seriesRows(rows, kept) {
  return rows.map((r) => {
    const out = Object.fromEntries(Object.entries(r).filter(([k]) => !/^y\d+$/.test(k)));
    kept.forEach((old, i) => { out[`y${i}`] = r[`y${old}`]; });
    return out;
  });
}

export function lookChart(chart, result, look) {
  if (!look) return { chart, result };
  const kept = look.series && Array.isArray(chart.y) ? chart.y.map((y, i) => (look.series.includes(y.label) ? i : -1)).filter((i) => i >= 0) : [];
  const shown = { ...chart, ...(look.type ? { type: look.type } : {}), ...(kept.length ? { y: kept.map((i) => chart.y[i]) } : {}) };
  if (!kept.length || !Array.isArray(result?.rows)) return { chart: shown, result };
  return { chart: shown, result: { ...result, rows: seriesRows(result.rows, kept) } };
}

export function suggestions(page, about, entity, done) {
  if (about) return [`Why is ${about.label} on the list?`, `Show the history of this ${entity}`, 'Are there others like this?', 'What happens if we do nothing?'];
  const asked = new Set((done || []).map((q) => String(q).trim().toLowerCase()));
  const own = (page?.questions || []).filter((q) => !asked.has(String(q).trim().toLowerCase()));
  const listed = page?.records ? [`Which ${entity}s should I act on first?`, `Show only the critical ${entity}s`] : [];
  return [...own.slice(0, 3), ...listed].slice(0, 4);
}

export function confirmText(confirm) {
  const n = confirm?.rows?.length || 0;
  return `${confirm?.label || 'Change'}: ${n} ${n === 1 ? 'record' : 'records'}`;
}
