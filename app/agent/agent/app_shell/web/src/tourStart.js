import { kpiValue } from './Kpis.jsx';
import { recordName } from './records.js';
import { integer } from './format.js';

export const TOUR_PARAM = 'tour';
const TOUR_PREFIX = 'inspire-tour:v1';

export const tourKey = (person, pageId, version) => `${TOUR_PREFIX}:${person || 'anyone'}:${pageId}:${version}`;

export function tourAsked(search = window.location.search) {
  return new URLSearchParams(search).get(TOUR_PARAM) || '';
}

export function tourSeen(key) {
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}

export function markTourSeen(key) {
  try { localStorage.setItem(key, '1'); } catch { /* private mode shows the tour again next visit */ }
}

export function tourDue(key, asked = tourAsked(), automated = !!navigator.webdriver) {
  if (asked === '1') return true;
  if (automated && asked !== 'auto') return false;
  return !tourSeen(key);
}

export function tourFacts(page, kpis, list) {
  const values = {};
  (page?.kpis || []).forEach((k) => {
    const now = kpis?.[k.id];
    if (now?.now != null) values[k.id] = kpiValue(k, now);
  });
  const rows = list?.rows || [];
  return {
    kpis: values,
    open_count: list && list.total != null ? integer(list.total) : '',
    top_record: rows.length && page?.records ? recordName(rows[0], page.records) || '' : '',
  };
}
