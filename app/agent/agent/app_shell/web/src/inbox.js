import { dayLabel, entityName } from './format.js';
import { errorText, runKey, stampText } from './freshness.js';
import { feedbackStatusText } from './feedback.js';
import { plural } from './hub.js';
import { NEW, isClosed, isOverdue, missingSince, recordKeyOf, statusLabel } from './records.js';

export const DUE_DAYS = 3;
export const INBOX_ROWS = 50;
export const INBOX_GROUPS = [
  ['fix', 'To fix'], ['runs', 'Failed runs'], ['reports', 'Reported issues'], ['assigned', 'Assigned to you'], ['due', `Due in ${DUE_DAYS} days or overdue`],
];
const DAY_MS = 86400000;
const REPORT_CHARS = 120;

const dayAt = (ms) => new Date(ms).toISOString().slice(0, 10);
const dayPlus = (day, n) => dayAt(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS);
const versionMs = (row) => Number(row?._inspire_version) / 1000;

export const inboxAsks = (page) => ({
  mine: { page: page.id, filters: {}, mine: true, window: 'all', limit: INBOX_ROWS },
  ...(page.is_owner === true ? { unowned: { page: page.id, filters: {}, unowned: true, window: 'all', due_within: DUE_DAYS, limit: INBOX_ROWS } } : {}),
});

const signedIn = (app) => !!(app?.user?.email || app?.user?.name);

export const recordsInbox = (app, page) => !!(page?.history && page?.records && app?.options?.decisions && signedIn(app));

export const inboxOn = (app, page) => !!page && signedIn(app) && (recordsInbox(app, page) || page.is_owner === true);

function itemOf(row, meta, today) {
  const key = recordKeyOf(row);
  const status = row._inspire_status || NEW;
  const due = row._inspire_due ? String(row._inspire_due).slice(0, 10) : '';
  return { kind: 'record', key: String(key), label: entityName(row, meta?.label) || String(key), status: statusLabel(status), due,
    late: isOverdue(due, status, today), kept: !!missingSince(row) };
}

export function failedRuns(runs) {
  const out = [];
  for (const run of runs || []) {
    if (run.status === 'done') break;
    if (run.status === 'failed') out.push(run);
  }
  return out;
}

const clip = (text) => {
  const chars = [...String(text || '').trim()];
  return chars.length > REPORT_CHARS ? `${chars.slice(0, REPORT_CHARS - 1).join('')}…` : chars.join('');
};

export function inboxGroups({ mine = [], unowned = [], meta, lastVisit = 0, today, fix = null, runs = null, reports = null, records = true }) {
  const after = (row) => lastVisit > 0 && versionMs(row) > lastVisit;
  const keyed = (rows) => rows.filter((r) => recordKeyOf(r) != null);
  const soon = dayPlus(today, DUE_DAYS);
  const visitDay = lastVisit > 0 ? dayAt(lastVisit) : '';
  const open = keyed(mine).filter((r) => !isClosed(r));
  const owned = new Set(open.map((r) => String(recordKeyOf(r))));
  const nobody = keyed(unowned).filter((r) => !isClosed(r) && !String(r._inspire_owner || '').trim() && !owned.has(String(recordKeyOf(r))));
  const groups = {
    fix: fix > 0 ? [{ kind: 'fix', key: 'fix', label: `${plural(fix, 'record')} to fix`, sub: 'Opens Work with the records to fix' }] : [],
    runs: runs?.can_run ? failedRuns(runs.runs).map((r) => ({ kind: 'run', key: `run:${runKey(r)}`, run: runKey(r),
      label: `The run of ${stampText(r.started) || 'an unrecorded time'} failed`, sub: errorText(r).lead })) : [],
    reports: reports?.everyone ? (reports.items || []).filter((r) => r.status === 'new' && r.feedback_id).map((r) => ({ kind: 'report', key: `report:${r.feedback_id}`,
      label: clip(r.text), sub: [r.section, r.reported_by, r.reported_at ? dayLabel(String(r.reported_at).slice(0, 10)) : '', feedbackStatusText(r.status)].filter(Boolean).join(' · ') })) : [],
    assigned: open.map((r) => ({ ...itemOf(r, meta, today), fresh: after(r) })),
    due: [...open.map((r) => [r, false]), ...nobody.map((r) => [r, true])].filter(([r]) => r._inspire_due && String(r._inspire_due).slice(0, 10) <= soon)
      .map(([r, none]) => ({ ...itemOf(r, meta, today), unowned: none }))
      .map((item) => ({ ...item, fresh: !!visitDay && dayPlus(item.due, -DUE_DAYS) > visitDay }))
      .sort((a, b) => a.due.localeCompare(b.due) || a.key.localeCompare(b.key)),
  };
  const all = Object.values(groups).flat();
  const on = { fix: fix != null, runs: !!runs?.can_run, reports: !!reports?.everyone, assigned: records, due: records };
  return { groups, on, count: new Set(all.map((i) => `${i.kind}:${i.key}`)).size, fresh: new Set(all.filter((i) => i.fresh).map((i) => i.key)).size };
}

