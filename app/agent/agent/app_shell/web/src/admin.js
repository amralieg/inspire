import { dayLabel, grouped } from './format.js';

export const ADMIN_ROUTE = 'admin';
export const USAGE_LABELS = { action: 'Actions', edit: 'Edits', add: 'Added', delete: 'Deleted', assumption: 'Assumption changes', refresh: 'Refreshes asked' };
export const USAGE_RECORDED = 'Counted from what the App already keeps: the version a person writes when they record an action or edit, add or delete a record, each assumption change, and each refresh a person asks the job for.';
export const USAGE_UNRECORDED = 'The App does not record who opens a page or asks Genie, so someone who only reads the App does not show here.';
export const NO_USE = 'Nobody changed anything here in this time';
export const NO_PEOPLE = 'Nobody changed anything in this App in this time.';

const whole = (n) => grouped(n || 0);

export function usageView(data) {
  const kinds = (data?.kinds || Object.keys(USAGE_LABELS)).filter((k) => USAGE_LABELS[k]);
  const cells = (counts) => kinds.map((k) => whole(counts?.[k]));
  const amounts = (p, lead) => ({ lead: [lead], cells: kinds.map((k) => p.counts?.[k] || 0), total: p.total || 0, last: p.last || null });
  return {
    title: `Usage in the last ${data?.days ?? 30} days`,
    since: data?.since ? `Since ${dayLabel(data.since)}` : '',
    kinds: kinds.map((k) => ({ id: k, label: USAGE_LABELS[k] })),
    pages: (data?.pages || []).map((p) => ({
      id: p.id, title: p.title || p.id, people: whole(p.people), cells: cells(p.counts), total: whole(p.total),
      last: p.last ? dayLabel(p.last) : NO_USE, errors: p.errors || [], amounts: amounts(p, p.people || 0),
    })),
    people: (data?.people || []).map((p) => ({ who: p.who, pages: (p.pages || []).join(', '), cells: cells(p.counts), total: whole(p.total), last: p.last ? dayLabel(p.last) : '',
      amounts: amounts(p, (p.pages || []).join(', ')) })),
  };
}
