import { PAGE_SIZES } from './records.js';

export const MY_KEY = 'inspire-app-my';
export const EVERYTHING = 'everything';
export const WINDOWS = [['hour', 'This hour'], ['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['all', 'All open'], [EVERYTHING, 'Everything']];
export const LIMITS = [10, 25, 50, 100, 200];
export const DENSITIES = [['comfortable', 'Comfortable'], ['compact', 'Compact']];
export const DEFAULT_PREFS = { window: 'all', limit: 0, density: 'comfortable', rows: PAGE_SIZES[0], folds: {}, seen: {}, columns: {} };
export const GRID_CAPS = { grids: 200, keys: 100, chars: 200 };
const DAY_MS = 86400000;

const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const personKey = (person) => String(person || '').trim().toLowerCase() || 'anyone';

function cleanFolds(raw) {
  const out = {};
  if (!isObject(raw)) return out;
  Object.entries(raw).forEach(([pageId, ids]) => {
    if (!isObject(ids)) return;
    const kept = Object.fromEntries(Object.entries(ids).filter(([, folded]) => folded === true));
    if (Object.keys(kept).length) out[pageId] = kept;
  });
  return out;
}

function cleanSeen(raw) {
  if (!isObject(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter(([, at]) => typeof at === 'number' && Number.isFinite(at) && at > 0));
}

const shortText = (x) => typeof x === 'string' && x.length > 0 && x.length <= GRID_CAPS.chars;

function cleanColumns(raw) {
  if (!isObject(raw)) return {};
  const out = {};
  Object.entries(raw).slice(-GRID_CAPS.grids).forEach(([grid, keys]) => {
    if (!shortText(grid) || !Array.isArray(keys)) return;
    const kept = [...new Set(keys.filter(shortText))].slice(0, GRID_CAPS.keys);
    if (kept.length) out[grid] = kept;
  });
  return out;
}

export function cleanPrefs(raw) {
  const p = isObject(raw) ? raw : {};
  return {
    window: WINDOWS.some(([id]) => id === p.window) ? p.window : DEFAULT_PREFS.window,
    limit: LIMITS.includes(p.limit) ? p.limit : 0,
    density: DENSITIES.some(([id]) => id === p.density) ? p.density : DEFAULT_PREFS.density,
    rows: PAGE_SIZES.includes(p.rows) ? p.rows : DEFAULT_PREFS.rows,
    folds: cleanFolds(p.folds),
    seen: cleanSeen(p.seen),
    columns: cleanColumns(p.columns),
  };
}

export const columnOrder = (prefs, grid) => prefs.columns?.[grid] || null;

export function setColumnOrder(prefs, grid, order) {
  const columns = { ...(prefs.columns || {}) };
  delete columns[grid];
  if (order?.length) columns[grid] = order;
  return { ...prefs, columns };
}

function readAll(storage) {
  try {
    const all = JSON.parse(storage.getItem(MY_KEY) || '{}');
    return isObject(all) ? all : {};
  } catch {
    return {};
  }
}

export const readPrefs = (storage, person) => cleanPrefs(readAll(storage)[personKey(person)]);

export function writePrefs(storage, person, prefs) {
  try {
    storage.setItem(MY_KEY, JSON.stringify({ ...readAll(storage), [personKey(person)]: cleanPrefs(prefs) }));
    return true;
  } catch {
    return false;
  }
}

export const windowLabel = (id) => (WINDOWS.find(([w]) => w === id) || WINDOWS.find(([w]) => w === DEFAULT_PREFS.window))[1];

const openWindow = (prefs) => (prefs.window === EVERYTHING ? DEFAULT_PREFS.window : prefs.window);

export function browserZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
}

export function windowParams(prefs, zone = browserZone()) {
  return { window: openWindow(prefs), ...(prefs.limit ? { window_limit: prefs.limit } : {}), ...(zone ? { time_zone: zone } : {}) };
}

export const utcOffset = (now = new Date()) => -now.getTimezoneOffset();

export const listWindow = (prefs, zone = browserZone()) => (prefs.window === EVERYTHING ? {} : windowParams(prefs, zone));

export const listLimit = (prefs) => (prefs.window === EVERYTHING ? 0 : prefs.limit || 0);

export const pickedWindow = (prefs) => openWindow(prefs) !== DEFAULT_PREFS.window || prefs.limit > 0;

export const narrowWindow = (prefs) => ![DEFAULT_PREFS.window, EVERYTHING].includes(prefs.window);

export const localDay = (now = new Date()) => new Date(now.getTime() + utcOffset(now) * 60000).toISOString().slice(0, 10);

export const isFolded = (prefs, pageId, id) => prefs.folds[pageId]?.[id] === true;

export function setFolds(prefs, pageId, ids, folded) {
  const page = { ...(prefs.folds[pageId] || {}) };
  ids.forEach((id) => { if (folded) page[id] = true; else delete page[id]; });
  const folds = { ...prefs.folds };
  if (Object.keys(page).length) folds[pageId] = page;
  else delete folds[pageId];
  return { ...prefs, folds };
}

export const visitedAt = (prefs, pageId) => prefs.seen[pageId] || 0;

export const markVisit = (prefs, pageId, now) => ({ ...prefs, seen: { ...prefs.seen, [pageId]: now } });

export function nextDay(today) {
  return new Date(Date.parse(`${String(today).slice(0, 10)}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
}
