import { plural } from './hub.js';
import { noAccessOf } from './plainText.js';

export { COPIED_SEND_TEXT, COPY_SEND_LABEL, RETRY_LABEL } from './plainText.js';

export const CARD_KEY = /^(?:kpi|chart|table):/;
export const SHARED_CARD_TEXT = 'Could not load, see the message at the top of the page';
export const RUNS_LABEL = 'See the runs';
export const PAGE_FAILED_LEAD = 'This page could not load: ';
export const partsFailedLead = (n) => `${plural(n, 'part')} of this page could not load: `;

export const said = (text) => String(text ?? '').trim();

export function cardKeys(page) {
  return [...(page?.kpis || []).map((k) => `kpi:${k.id}`), ...(page?.charts || []).map((c) => `chart:${c.id}`), ...(page?.tables || []).map((t) => `table:${t.id}`)];
}

export function pageFailures(page, data, error) {
  if (!data && said(error)) {
    const keys = cardKeys(page);
    return { errors: Object.fromEntries(keys.map((k) => [k, said(error)])), shared: said(error), count: keys.length, whole: true };
  }
  const errors = data?.errors || {};
  const counts = new Map();
  Object.entries(errors).forEach(([key, text]) => {
    if (CARD_KEY.test(key) && said(text) && !noAccessOf(text)) counts.set(said(text), (counts.get(said(text)) || 0) + 1);
  });
  let shared = '';
  let count = 1;
  counts.forEach((n, text) => { if (n > count) { shared = text; count = n; } });
  return { errors, shared, count: shared ? count : 0, whole: false };
}

export const sharedBy = (shared, text) => !!shared && said(text) === shared;
