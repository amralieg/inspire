import { RANGE_EDGES, columnFilterOn, columnFilterText, columnValues, initialFilterState, rangeLabel } from './filters.js';

export const VIEWS_KEY = 'inspire-app-views';
export const VIEW_NAME_MAX = 60;
export const VIEWS_PER_PAGE = 20;
export const LINK_STALE = 'Some filters in this link no longer apply';
export const VIEW_STALE = 'Some filters in this view no longer apply';
export const UNKNOWN_PAGE = 'This link points to a use case that is not in this App';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const SHOWN_VALUES = 5;

const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

function decodePart(text) {
  try { return decodeURIComponent(text); } catch { return text; }
}

export function parseHash(hash) {
  const body = String(hash || '').replace(/^#\/?/, '');
  const cut = body.indexOf('?');
  const query = new URLSearchParams(cut < 0 ? '' : body.slice(cut + 1));
  const v = query.get('v');
  const f = query.get('f');
  return { route: decodePart(cut < 0 ? body : body.slice(0, cut)), v, f, rec: query.get('rec'), changed: query.get('changed') === '1', present: v != null || f != null };
}

export const OPEN_PARAM = 'open';
const OPEN_ROUTE = /^[A-Za-z0-9_-]{1,64}$/;

export function openedLink({ pathname = '', search = '', hash = '' } = {}) {
  const query = new URLSearchParams(search);
  if (!query.has(OPEN_PARAM)) return '';
  const route = query.get(OPEN_PARAM);
  query.delete(OPEN_PARAM);
  const rest = query.toString();
  return `${pathname}${rest ? `?${rest}` : ''}${OPEN_ROUTE.test(route) ? `#/${route}` : hash}`;
}

export function withoutRecord(hash) {
  const text = String(hash || '');
  const cut = text.indexOf('?');
  if (cut < 0) return text;
  const query = new URLSearchParams(text.slice(cut + 1));
  if (!query.has('rec')) return text;
  query.delete('rec');
  const rest = query.toString();
  return `${text.slice(0, cut)}${rest ? `?${rest}` : ''}`;
}

export function withRecord(hash, key) {
  const text = withoutRecord(hash) || '#/';
  const cut = text.indexOf('?');
  const query = new URLSearchParams(cut < 0 ? '' : text.slice(cut + 1));
  query.set('rec', String(key));
  return `${cut < 0 ? text : text.slice(0, cut)}?${query.toString()}`;
}

function toBase64Url(text) {
  let binary = '';
  new TextEncoder().encode(text).forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text) {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new Error('not base64url');
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4));
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

export function encodeFilters(compact) {
  return toBase64Url(JSON.stringify(compact));
}

export function decodeFilters(text) {
  try {
    const value = JSON.parse(fromBase64Url(String(text)));
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}

function columnScopes(columns) {
  return [[null, columns?.list || []], ...Object.entries(columns?.tables || {})];
}

function compactColumns(state, columns) {
  const l = {};
  const t = {};
  columnScopes(columns).forEach(([table, list]) => {
    const values = columnValues(state, table);
    const kept = {};
    list.forEach((f) => {
      const value = values[f.column];
      if (!columnFilterOn(value)) return;
      kept[f.column] = Array.isArray(value) ? [...value] : RANGE_EDGES[f.type].map((edge) => (value[edge] == null || value[edge] === '' ? null : value[edge]));
    });
    if (!Object.keys(kept).length) return;
    if (table == null) Object.assign(l, kept);
    else t[table] = kept;
  });
  const out = {};
  if (Object.keys(l).length) out.l = l;
  if (Object.keys(t).length) out.t = t;
  return out;
}

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

function edgesFrom(filter, value) {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const fits = filter.type === 'date_range' ? isDay : finite;
  if (!value.every((v) => v == null || fits(v)) || value.every((v) => v == null)) return null;
  const [low, high] = value;
  if (low != null && high != null && low > high) return null;
  const [lo, hi] = RANGE_EDGES[filter.type];
  return { [lo]: low ?? null, [hi]: high ?? null };
}

function restoreColumns(compact, columns) {
  if (compact == null) return { columns: null, dropped: false };
  if (!isObject(compact)) return { columns: null, dropped: true };
  let dropped = Object.keys(compact).some((key) => key !== 'l' && key !== 't');
  const out = { list: {}, tables: {} };
  const scopes = new Map(columnScopes(columns).map(([table, list]) => [table, new Map(list.map((f) => [f.column, f]))]));
  const parts = [[null, compact.l ?? {}], ...(isObject(compact.t) ? Object.entries(compact.t) : [])];
  if (compact.t != null && !isObject(compact.t)) dropped = true;
  parts.forEach(([table, values]) => {
    const known = scopes.get(table);
    if (!known || !isObject(values)) {
      dropped = true;
      return;
    }
    const kept = {};
    Object.entries(values).forEach(([column, value]) => {
      const f = known.get(column);
      if (!f) {
        dropped = true;
        return;
      }
      if (f.type === 'multi_select') {
        const chosen = valuesFrom(f, value);
        if (!chosen || chosen.length !== new Set(value).size) dropped = true;
        if (chosen?.length) kept[column] = chosen;
        return;
      }
      const range = edgesFrom(f, value);
      if (range) kept[column] = range;
      else dropped = true;
    });
    if (table == null) out.list = kept;
    else if (Object.keys(kept).length) out.tables[table] = kept;
  });
  return { columns: out, dropped };
}

export function compactState(state, filters, columns) {
  const defaults = initialFilterState(filters);
  const r = {};
  const s = {};
  (filters || []).forEach((f) => {
    if (f.type === 'date_range') {
      const range = state?.range?.[f.id];
      if (!range) return;
      if (range.preset === 'custom') {
        if (range.from && range.to) r[f.id] = [range.from, range.to];
      } else if (range.preset !== defaults.range[f.id]?.preset) {
        r[f.id] = range.preset;
      }
    } else if (f.type === 'multi_select') {
      const values = state?.sel?.[f.id];
      if (values?.length) s[f.id] = [...values];
    }
  });
  const out = {};
  if (Object.keys(r).length) out.r = r;
  if (Object.keys(s).length) out.s = s;
  const c = compactColumns(state, columns);
  if (Object.keys(c).length) out.c = c;
  return out;
}

function isDay(text) {
  if (typeof text !== 'string' || !DAY.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

const dayOf = (value) => (value ? String(value).slice(0, 10) : '');

function rangeFrom(filter, value) {
  if (typeof value === 'string') {
    const preset = (filter.presets || []).find((p) => p.id === value);
    return preset ? { preset: preset.id, from: preset.from, to: preset.to } : null;
  }
  if (!Array.isArray(value) || value.length !== 2 || !value.every(isDay)) return null;
  const [from, to] = value;
  const low = dayOf(filter.low);
  const high = dayOf(filter.high);
  if (from > to || (low && from < low) || (high && to > high)) return null;
  return { preset: 'custom', from, to };
}

function valuesFrom(filter, value) {
  if (!Array.isArray(value)) return null;
  const known = Array.isArray(filter.options) ? new Set(filter.options.map(String)) : null;
  const keep = (v) => typeof v === 'string' && (known ? known.has(v) : !!filter.error);
  return [...new Set(value.filter(keep))];
}

export function restoreFilters(compact, filters, columns) {
  const state = initialFilterState(filters);
  if (!isObject(compact)) return { state, dropped: true };
  const byId = new Map((filters || []).map((f) => [f.id, f]));
  let dropped = Object.keys(compact).some((key) => key !== 'r' && key !== 's' && key !== 'c');
  const restored = restoreColumns(compact.c, columns);
  if (restored.dropped) dropped = true;
  if (restored.columns) state.columns = restored.columns;
  const ranges = compact.r ?? {};
  if (!isObject(ranges)) dropped = true;
  else {
    Object.entries(ranges).forEach(([id, value]) => {
      const f = byId.get(id);
      const range = f?.type === 'date_range' ? rangeFrom(f, value) : null;
      if (range) state.range[id] = range;
      else dropped = true;
    });
  }
  const picks = compact.s ?? {};
  if (!isObject(picks)) dropped = true;
  else {
    Object.entries(picks).forEach(([id, value]) => {
      const f = byId.get(id);
      const kept = f?.type === 'multi_select' ? valuesFrom(f, value) : null;
      if (!kept || kept.length !== new Set(value).size) dropped = true;
      if (kept?.length) state.sel[id] = kept;
    });
  }
  return { state, dropped };
}

export function restoreView(value, allowed) {
  if (value == null) return { view: 'overview', dropped: false };
  return allowed.includes(value) ? { view: value, dropped: false } : { view: 'overview', dropped: true };
}

function combine(filters, view) {
  return { state: filters.state, view: view.view, dropped: filters.dropped || view.dropped };
}

export function readLink(link, filters, views, columns) {
  const compact = link.f == null ? {} : decodeFilters(link.f);
  return combine(restoreFilters(compact, filters, columns), restoreView(link.v, views));
}

export function readSaved(entry, filters, views, columns) {
  return combine(restoreFilters(entry.filters, filters, columns), restoreView(entry.view, views));
}

export function buildHash(pageId, view, state, filters, rec, columns) {
  const query = new URLSearchParams();
  if (view && view !== 'overview') query.set('v', view);
  const compact = compactState(state, filters, columns);
  if (Object.keys(compact).length) query.set('f', encodeFilters(compact));
  if (rec) query.set('rec', rec);
  const text = query.toString();
  return `#/${encodeURIComponent(pageId)}${text ? `?${text}` : ''}`;
}

export function listText(values, total = values.length) {
  if (total <= SHOWN_VALUES) return values.join(', ');
  return `${values.slice(0, SHOWN_VALUES).join(', ')} and ${total - SHOWN_VALUES} more`;
}

export function describeFilters(state, filters, columns) {
  const parts = [];
  (filters || []).forEach((f) => {
    if (f.type === 'date_range') {
      const range = state?.range?.[f.id];
      if (range) parts.push(`${f.label}: ${rangeLabel(f, range)}`);
    } else {
      const values = state?.sel?.[f.id] || [];
      if (values.length) parts.push(`${f.label}: ${listText(values)}`);
    }
  });
  columnScopes(columns).forEach(([table, list]) => {
    const values = columnValues(state, table);
    list.filter((f) => columnFilterOn(values[f.column])).forEach((f) => {
      const value = values[f.column];
      parts.push(`${f.label}: ${Array.isArray(value) ? listText(value) : columnFilterText(f, value)}`);
    });
  });
  return parts.length ? parts.join('; ') : 'none';
}

export const sameView = (a, b) => (a.view || 'overview') === (b.view || 'overview') && JSON.stringify(a.filters || {}) === JSON.stringify(b.filters || {});

function cleanEntry(entry) {
  if (!isObject(entry) || typeof entry.name !== 'string' || !entry.name.trim()) return null;
  return { name: entry.name, view: typeof entry.view === 'string' ? entry.view : 'overview', filters: isObject(entry.filters) ? entry.filters : {} };
}

function cleanList(list) {
  const seen = new Set();
  return list.map(cleanEntry).filter((entry) => {
    if (!entry || seen.has(entry.name.toLowerCase())) return false;
    seen.add(entry.name.toLowerCase());
    return true;
  }).slice(0, VIEWS_PER_PAGE);
}

export function readViews(storage) {
  let parsed;
  try {
    parsed = JSON.parse(storage.getItem(VIEWS_KEY) || '{}');
  } catch {
    return {};
  }
  if (!isObject(parsed)) return {};
  const out = {};
  Object.entries(parsed).forEach(([pageId, list]) => {
    const kept = Array.isArray(list) ? cleanList(list) : [];
    if (kept.length) out[pageId] = kept;
  });
  return out;
}

export function writeViews(storage, all) {
  try {
    storage.setItem(VIEWS_KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}

export function nameProblem(name, list) {
  const text = String(name ?? '').trim();
  if (list.length >= VIEWS_PER_PAGE) return `This page already keeps ${VIEWS_PER_PAGE} saved views. Delete one to save another.`;
  if (!text) return 'Give the view a name.';
  if ([...text].length > VIEW_NAME_MAX) return `Use ${VIEW_NAME_MAX} characters or fewer.`;
  if (list.some((v) => v.name.toLowerCase() === text.toLowerCase())) return 'A view with this name is already saved on this page.';
  return '';
}

export function addView(all, pageId, entry) {
  const list = all[pageId] || [];
  const problem = nameProblem(entry.name, list);
  if (problem) return { all, problem };
  return { all: { ...all, [pageId]: [...list, { name: entry.name.trim(), view: entry.view || 'overview', filters: entry.filters || {} }] }, problem: '' };
}

export function removeView(all, pageId, name) {
  const next = { ...all };
  const list = (all[pageId] || []).filter((v) => v.name !== name);
  if (list.length) next[pageId] = list;
  else delete next[pageId];
  return next;
}
