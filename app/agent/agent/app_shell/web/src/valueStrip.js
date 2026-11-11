import { kpiText, wholeMoney } from './format.js';

export const MORE_USE_CASES = 'More use cases for this business';
export const SAVED_LABEL = 'Saved since go-live';

export function savedOf(saved) {
  if (!saved) return null;
  if (saved.warning) return { text: '', warning: saved.warning };
  if (!saved.lines?.length) return { text: `${SAVED_LABEL}: none recorded yet`, warning: '' };
  const parts = saved.lines.map((row) => `${wholeMoney(Number(row.amount), row.currency, row.kind)}${row.unit ? ` ${row.unit}` : ''}`);
  return { text: `${SAVED_LABEL}: ${parts.join(' · ')}`, warning: '' };
}

export function valueStripOf(page, data, app, saved = null) {
  const kpi = (page?.kpis || []).find((k) => k.format === 'currency') || null;
  const more = app?.review_run || '';
  const savedLine = savedOf(saved);
  if (!kpi && !more && !savedLine) return null;
  return {
    kpi: kpi ? { label: kpi.label, now: data ? kpiText(kpi, data.kpis?.[kpi.id]) : '' } : null,
    saved: savedLine,
    more: more ? { href: more, inside: app.inside === true } : null,
  };
}
