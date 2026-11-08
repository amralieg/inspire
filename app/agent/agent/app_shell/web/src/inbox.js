import { entityName } from './format.js';
import { NEW, isClosed, isOverdue, missingSince, recordKeyOf, statusLabel } from './records.js';

export const DUE_DAYS = 3;
export const INBOX_ROWS = 50;
export const INBOX_GROUPS = [['changed', 'Changed since you were last here'], ['assigned', 'Assigned to you'], ['due', `Due in ${DUE_DAYS} days or overdue`]];
const DAY_MS = 86400000;

const dayAt = (ms) => new Date(ms).toISOString().slice(0, 10);
const dayPlus = (day, n) => dayAt(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS);
const versionMs = (row) => Number(row?._inspire_version) / 1000;

export const inboxAsks = (page) => ({
  changed: { page: page.id, filters: {}, changed: true, limit: INBOX_ROWS },
  mine: { page: page.id, filters: {}, mine: true, window: 'all', limit: INBOX_ROWS },
  ...(page.is_owner === true ? { unowned: { page: page.id, filters: {}, unowned: true, window: 'all', due_within: DUE_DAYS, limit: INBOX_ROWS } } : {}),
});

export const inboxOn = (app, page) => !!(page?.history && page?.records && app?.options?.decisions && (app.user?.email || app.user?.name));

function itemOf(row, meta, today) {
  const key = recordKeyOf(row);
  const status = row._inspire_status || NEW;
  const due = row._inspire_due ? String(row._inspire_due).slice(0, 10) : '';
  return { key: String(key), label: entityName(row, meta?.label) || String(key), status: statusLabel(status), due,
    late: isOverdue(due, status, today), kept: !!missingSince(row) };
}

export function inboxGroups({ changed = [], mine = [], unowned = [], meta, lastVisit = 0, today }) {
  const after = (row) => lastVisit > 0 && versionMs(row) > lastVisit;
  const keyed = (rows) => rows.filter((r) => recordKeyOf(r) != null);
  const soon = dayPlus(today, DUE_DAYS);
  const visitDay = lastVisit > 0 ? dayAt(lastVisit) : '';
  const open = keyed(mine).filter((r) => !isClosed(r));
  const owned = new Set(open.map((r) => String(recordKeyOf(r))));
  const nobody = keyed(unowned).filter((r) => !isClosed(r) && !String(r._inspire_owner || '').trim() && !owned.has(String(recordKeyOf(r))));
  const groups = {
    changed: keyed(changed).filter(after).map((r) => ({ ...itemOf(r, meta, today), fresh: true })),
    assigned: open.map((r) => ({ ...itemOf(r, meta, today), fresh: after(r) })),
    due: [...open.map((r) => [r, false]), ...nobody.map((r) => [r, true])].filter(([r]) => r._inspire_due && String(r._inspire_due).slice(0, 10) <= soon)
      .map(([r, none]) => ({ ...itemOf(r, meta, today), unowned: none }))
      .map((item) => ({ ...item, fresh: !!visitDay && dayPlus(item.due, -DUE_DAYS) > visitDay }))
      .sort((a, b) => a.due.localeCompare(b.due) || a.key.localeCompare(b.key)),
  };
  const fresh = new Set(Object.values(groups).flat().filter((i) => i.fresh).map((i) => i.key));
  return { groups, fresh: fresh.size, keys: [...fresh] };
}

export function inboxCount(groups, seen = new Set()) {
  return groups.keys.filter((k) => !seen.has(k)).length;
}

export const badgeText = (n) => (n > 99 ? '99+' : String(n));
