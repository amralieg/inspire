import { addedParts, asDate, cap, countOf, dayLabel, entityName, formatValue, grouped, integer, isAmount, isCurrency, plainText, plainWords, savedVerb, savedWords, shownUnit, wholeMoney } from './format.js';

const LONG_TEXT = /(action|note|comment|description|reason|summary|detail|explanation|why)/i;
const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
const WHOLE = /^[-+]?\d{1,20}$/;
const STAMP = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });

export const SOURCES = { run: 'Written by the job', edit: 'Edited', add: 'Added', delete: 'Deleted', action: 'Action recorded' };
export const ACTION_LABELS = { action_owner: 'Owner', action_status: 'Status', action_due: 'Due', action_note: 'Note', dismiss_reason: 'Why it is wrong',
  action_outcome: 'Outcome', realized_note: 'How you know' };
export const NEW = 'New';
export const IN_PROGRESS = 'In progress';
export const DONE = 'Done';
export const DISMISSED = 'Dismissed';
export const COULD_NOT = 'Could not fix';
export const STATUS_KINDS = { [NEW]: 'open', [IN_PROGRESS]: 'open', [DONE]: 'done', [DISMISSED]: 'dismissed', [COULD_NOT]: 'could_not' };
export const STATUSES = Object.keys(STATUS_KINDS);
export const statusesOf = (...kinds) => STATUSES.filter((s) => kinds.includes(STATUS_KINDS[s]));
export const statusKind = (status) => STATUS_KINDS[status || NEW] || '';
export const STATUS_LABELS = { [DISMISSED]: 'Not an issue' };
export const statusLabel = (status) => STATUS_LABELS[status] || status;
export const OPEN_STATUSES = statusesOf('open');
export const CLOSED_STATUSES = STATUSES.filter((s) => !OPEN_STATUSES.includes(s));
export const isOpenStatus = (status) => OPEN_STATUSES.includes(status || NEW);
export const CHOICE_COLUMN = 'action_choice';
export const choiceId = (label) => String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
export const DEFAULT_CHOICES = STATUSES.map((s) => ({ id: choiceId(statusLabel(s)), label: statusLabel(s), status: s }));
export const pageChoices = (app, pageId) => statusChoices((app?.pages || []).find((p) => p.id === pageId));
export const statusChoices = (page) => (Array.isArray(page?.statuses) && page.statuses.length ? page.statuses : DEFAULT_CHOICES);
export function choiceOf(choices, status, id) {
  const same = (choices || []).filter((c) => c.status === (status || NEW));
  return same.find((c) => c.id === id) || (same.length === 1 ? same[0] : null);
}
export const rowChoice = (choices, row) => choiceOf(choices, row?._inspire_status || row?.action_status, row?._inspire_choice ?? row?.[CHOICE_COLUMN]);
export const choiceLabel = (choices, row) => rowChoice(choices, row)?.label || statusLabel(row?._inspire_status || row?.action_status || NEW);
export const closingChoices = (choices) => (choices || []).filter((c) => !isOpenStatus(c.status));
export const QUICK_CLOSE = { done: ['Mark done', 'done'], dismissed: ['Not an issue', 'dismiss'], could_not: ['Could not fix', 'could-not-fix'] };
export const writesChoice = (choices) => !(choices?.length === DEFAULT_CHOICES.length && choices.every(isDefaultChoice));
export function choiceValues(choice, detail = '', choices = [choice]) {
  const custom = writesChoice(choices);
  const said = !custom ? detail : detail ? `${choice.label}: ${detail}` : choice.label;
  const base = { action_status: choice.status, ...(custom ? { [CHOICE_COLUMN]: choice.id } : {}) };
  if (statusKind(choice.status) === 'dismissed') return { ...base, dismiss_reason: said };
  return said ? { ...base, note: said } : base;
}
export const canDecide = (app, list) => !!(app?.options?.decisions && list?.actions);
export const pageDecides = (page) => !!page?.records && page?.layout?.decides !== false;
export const NO_DECISIONS = 'This App does not record decisions, so this list shows its suggestions only.';
export const INFORMATIONAL = 'This page shows information only, so its rows carry no status. Open a row to see its details or ask Genie about it.';
export const UNLINKED = 'This list is not linked to the records of the use case, so the App cannot save a decision on it yet.';
export const noDecisionText = (app, page) => (!pageDecides(page) ? INFORMATIONAL : app?.options?.decisions ? UNLINKED : NO_DECISIONS);
export const PAGE_SIZES = [25, 50, 100];
export const ACT_LIMIT = 200;
export const SIMILAR_KEYS = 50;
export const DRAFT_RECORDS = 10;
export const DRAFT_LABEL = 'Draft Message to Someone';
export const DRAFT_ATTEMPTS = 20;
export const DRAFT_COPIED = 'Message copied. Paste it into any app to send it.';
export const DRAFT_MANUAL = 'This browser did not let the App copy it. The message is selected, so press Ctrl+C, or Cmd+C on a Mac, to copy it.';
export const DRAFT_FAILED = 'The message could not be drafted';
export const NO_SIMILAR = 'No other open record shares the values of these records.';
export const REASON_CHARS = 300;
export const NOTE_CHARS = 500;
const AMOUNT = /^\d+(\.\d+)?$/;
export const UNEXPLAINED = 'Not explained yet';
export const CONFIDENCE_LEVELS = ['High', 'Medium', 'Low'];
const EXPLAIN_FIELDS = 40;
const EXPLAIN_VERSIONS = 10;
const EXPLAIN_FACTS = 1000;
export const HELD = 'Inspire left out the AI reasoning for this record because it failed a check after one repair round';

export const recordKeyOf = (row) => (row?.record_key ?? row?._inspire_key ?? null);
export const statusClass = (s) => `status status--${String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

export function recordRef(meta, row) {
  const key = recordKeyOf(row);
  return key != null && key !== '' ? { record_key: String(key) } : { key: String(row?.[meta.key] ?? '') };
}

const count = (n) => grouped(n || 0);

export function totalText(total, more) {
  return more ? `more than ${count(total)}` : count(total);
}

export function pageText(offset, shown, total, more = false) {
  if (!total) return 'No records';
  if (!shown) return `No records on this page; the list has ${totalText(total, more)}`;
  return `Showing ${count(offset + 1)} to ${count(offset + shown)} of ${totalText(total, more)}`;
}

export function impactText(summary) {
  if (summary?.open == null) return '';
  const base = `Actions: ${count(summary.open)} open · ${count(summary.done)} done`;
  return summary.done ? `${base} · ${count(summary.resolved)} resolved by a later run (${summary.resolved}/${summary.done})` : base;
}

export const UNDO_MS = 15000;
export const SIMILAR_PAGE = 50;
export const SIMILAR_SUMMARY = 3;
export const CONFLICTS_SHOWN = 20;
const VIEW_KEYS = ['ai', 'search', 'mine', 'changed', 'column_filters', 'window', 'window_limit', 'time_zone', 'focus'];
const WINDOW_KEYS = ['window', 'window_limit', 'time_zone'];

export const withoutWindow = (body) => Object.fromEntries(Object.entries(body).filter(([k]) => !WINDOW_KEYS.includes(k)));
const KIND_WORDS = { done: 'marked done', dismissed: 'marked as not an issue', could_not: 'marked as could not fix' };
export const isDefaultChoice = (choice) => !!choice && DEFAULT_CHOICES.some((d) => d.id === choice.id && d.label === choice.label && d.status === choice.status);
const howMany = (v) => (Array.isArray(v) ? v.length : countOf(v));

export const recordsText = (n) => `${count(n)} ${n === 1 ? 'record' : 'records'}`;

export function changeWords(values, choices = DEFAULT_CHOICES) {
  const parts = [];
  const choice = values?.action_status ? choiceOf(choices, values.action_status, values[CHOICE_COLUMN]) : null;
  if (choice && !isDefaultChoice(choice)) parts.push(`marked ${choice.label}`);
  else if (values?.action_status) parts.push(KIND_WORDS[statusKind(values.action_status)] || `set to ${statusLabel(values.action_status)}`);
  if (values?.action_owner != null) parts.push(values.action_owner ? `given to ${values.action_owner}` : 'given to nobody');
  if (values?.snooze_until) parts.push(`snoozed until ${dayLabel(values.snooze_until)}`);
  if (values?.action_due) parts.push(`due ${dayLabel(values.action_due)}`);
  if (!parts.length && String(values?.note || '').trim()) parts.push('noted');
  return parts.join(', ') || 'changed';
}

export function actOutcome(out) {
  const sample = Array.isArray(out?.conflicts) ? out.conflicts.slice(0, CONFLICTS_SHOWN) : [];
  return { written: howMany(out?.written), conflicts: out?.conflicts_count == null ? howMany(out?.conflicts) : countOf(out.conflicts_count), sample,
    batch: String(out?.batch_id || ''), matched: out?.matched == null ? null : countOf(out.matched), leftOut: countOf(out?.left_out),
    changed: Array.isArray(out?.changed) ? out.changed.map(String) : [] };
}

export function reviewedText(keys, nameOf = (k) => k) {
  const n = keys.length;
  if (!n) return '';
  const said = n === 1 ? '1 record changed since you reviewed it and was left as it was' : `${count(n)} records changed since you reviewed them and were left as they were`;
  const names = keys.slice(0, CONFLICTS_SHOWN).map((k) => plainText(nameOf(k))).filter(Boolean);
  return `${said}${names.length ? `: ${names.join(', ')}${n > names.length ? `, and ${count(n - names.length)} more` : ''}` : ''}`;
}

export const MONEY_COLUMN = 'value_at_stake';

export function recordDetails(meta, row, unit, kind) {
  return [...(meta?.detail || []).map((d) => [d.column, d.label, d.column === MONEY_COLUMN
      ? formatValue(row?.[d.column], d.format || 'currency', shownUnit(unit, d.currency, kind), undefined, kind)
      : formatValue(row?.[d.column], d.format || 'text', d.currency)]),
    ...(meta?.rank && row?.[meta.rank] != null ? [[meta.rank, 'Rank', `${integer(row[meta.rank])} on the latest run`]] : [])];
}

export function recordLine(meta, row) {
  const name = entityName(row, meta?.label);
  const [segment, key] = addedParts(name, [meta?.sublabel ? row?.[meta.sublabel] : '', row?.[meta?.key]]);
  return { name, sub: [key, segment].filter(Boolean) };
}

export function conflictText(n) {
  if (!n) return '';
  return n === 1 ? '1 record changed since you loaded it and was left as it is' : `${count(n)} records changed since you loaded them and were left as they are`;
}

function leftOutText(n) {
  if (!n) return '';
  return n === 1 ? '1 record you cannot read was left out' : `${count(n)} records you cannot read were left out`;
}

export function actedText(outcome, values, nameOf) {
  const who = outcome.matched > outcome.written
    ? `${count(outcome.written)} of ${count(outcome.matched)} matching ${outcome.matched === 1 ? 'record' : 'records'}` : recordsText(outcome.written);
  return [`${who} ${changeWords(values)}.`, ...[conflictText(outcome.conflicts), reviewedText(outcome.changed || [], nameOf), leftOutText(outcome.leftOut)]
    .filter(Boolean).map((t) => `${t}.`)].join(' ');
}

export const STALE_LIST = 'The list changed since you loaded it. Reload and try again.';
export const NO_AS_OF = 'The App cannot tell when this list was read, so it cannot act on every matching record. Reload the list and try again.';

export function listAsOf(data) {
  const sent = data?.as_of_us;
  const text = typeof sent === 'number' && Number.isSafeInteger(sent) ? String(sent) : typeof sent === 'string' ? sent : '';
  return /^[1-9]\d*$/.test(text) ? text : '';
}

export const CODES = { staleList: 'stale_list', unknownCopy: 'unknown_copy', noMatch: 'no_match', overCap: 'over_cap', staleRecord: 'stale_record',
  noWindow: 'no_window' };
const LIST_CHANGED = [CODES.staleList, CODES.unknownCopy, CODES.noMatch];
export const isStaleRecord = (err) => err?.code === CODES.staleRecord;

export function actError(err) {
  const matched = countOf(err?.detail?.matched);
  const most = Number(err?.detail?.cap);
  if (err?.code === CODES.overCap && most > 0 && matched > most) {
    return `These filters match ${recordsText(matched)}. You can change up to ${count(most)} at once, so narrow the filters and try again.`;
  }
  if (LIST_CHANGED.includes(err?.code)) return STALE_LIST;
  return err?.message || 'The change could not be saved';
}

export function undoText(out, nameOf = (s) => String(s?.record_key ?? '')) {
  const restored = howMany(out?.restored);
  const skipped = howMany(out?.skipped);
  const back = restored ? `Undone: ${recordsText(restored)} ${restored === 1 ? 'is' : 'are'} back as ${restored === 1 ? 'it was' : 'they were'}.` : 'Nothing was undone.';
  const hidden = leftOutText(countOf(out?.left_out));
  const tail = hidden ? ` ${hidden}.` : '';
  if (!skipped) return `${back}${tail}`;
  const left = skipped === 1 ? '1 record changed since and was left as it is' : `${count(skipped)} records changed since and were left as they are`;
  const names = (Array.isArray(out?.skipped_sample) ? out.skipped_sample : []).slice(0, skipped).map(nameOf).filter(Boolean);
  const listed = names.length ? `: ${names.join(', ')}${skipped > names.length ? `, and ${count(skipped - names.length)} more` : ''}` : '';
  return `${back} ${left}${listed}.${tail}`;
}

export function matchOf(body, asOf) {
  return { filters: body.filters || {}, view: Object.fromEntries(VIEW_KEYS.filter((k) => body[k] !== undefined).map((k) => [k, body[k]])), as_of_us: String(asOf) };
}

export function byWords(by) {
  return (Array.isArray(by) ? by : []).filter((b) => b && (b.label || b.filter)).map((b) => `${String(b.label || b.filter)} ${plainText(b.value)}`.trim()).join(', ');
}

export function batchText(batch, choices = DEFAULT_CHOICES) {
  const who = String(batch?.editor || '').trim() || 'someone';
  const note = String(batch?.note || '').trim();
  const n = recordsText(countOf(batch?.count));
  const did = batch?.undoes ? `undid an earlier change on ${n}` : `${n} ${changeWords(batch?.values, choices)}`;
  return `${whenText(batch?.at)}, ${who}: ${did}${note ? `. Note: ${note}` : ''}`;
}

export const asOfText = (us) => (Number(us) > 0 ? whenText(new Date(Math.floor(Number(us) / 1000)).toISOString()) : '');

export const isOverdue = (due, status, today) => !!due && String(due).slice(0, 10) < today && isOpenStatus(status);

export function overdueFirst(rows, today) {
  const late = rows.filter((r) => isOverdue(r._inspire_due, r._inspire_status, today));
  return late.length ? { rows: [...late, ...rows.filter((r) => !late.includes(r))], late: late.length } : { rows, late: 0 };
}

export const leftText = (n) => (n ? `${count(n)} ${n === 1 ? 'record' : 'records'} left the list since the last run` : '');

export const NOT_IN_RUN = 'Not in the latest run';
export const missingSince = (row) => row?._inspire_missing ?? row?.not_listed_since ?? null;
export const keptText = (n) => (n ? `${count(n)} ${n === 1 ? 'record' : 'records'} not in the latest run, kept because people changed ${n === 1 ? 'it' : 'them'}` : '');
export const notInRunText = (since) => `The runs stopped listing this record on ${dayLabel(since)}. It stays because a person changed or added it, and this App keeps people's changes.`;

export function changeBadge(row) {
  if (missingSince(row)) return { text: NOT_IN_RUN, kind: 'missing' };
  if (row?._inspire_change === 'new') return { text: 'New', kind: 'new' };
  if (row?._inspire_change === 'moved' && row._inspire_moved_to) return { text: `Moved to ${row._inspire_moved_to}`, kind: 'moved' };
  return null;
}

export function actionForm(current, person, choices = DEFAULT_CHOICES) {
  const status = current?.action_status || NEW;
  return { owner: current?.action_owner || person || '', status, choice: choiceOf(choices, status, current?.[CHOICE_COLUMN])?.id || '', due: String(current?.action_due || '').slice(0, 10),
    note: current?.action_note || '', reason: current?.dismiss_reason || '', saved: current?.realized_value == null ? '' : String(current.realized_value),
    how: current?.realized_note || '' };
}

const sameAmount = (text, stored) => (text === '' ? stored == null || stored === '' : stored != null && stored !== '' && Number(text) === Number(stored));

export function pickChoice(form, choices, id) {
  const choice = (choices || []).find((c) => c.id === id);
  return choice ? { ...form, choice: choice.id, status: choice.status } : form;
}

export function actionValues(current, form, choices = DEFAULT_CHOICES) {
  const was = (name) => String(current?.[name] ?? '').trim();
  const out = {};
  if (form.owner.trim() !== was('action_owner')) out.action_owner = form.owner.trim();
  if (form.status !== was('action_status')) out.action_status = form.status;
  const before = choiceOf(choices, current?.action_status || NEW, current?.[CHOICE_COLUMN])?.id || '';
  const chosen = choiceOf(choices, form.status, form.choice)?.id || '';
  if (chosen && chosen !== before) out.action_status = form.status;
  if (form.due !== was('action_due').slice(0, 10)) out.action_due = form.due;
  if (form.note.trim() !== was('action_note')) out.action_note = form.note.trim();
  if (statusKind(form.status) === 'dismissed' && (out.action_status || form.reason.trim() !== was('dismiss_reason'))) {
    out.action_status = form.status;
    out.dismiss_reason = form.reason.trim();
  }
  const saved = String(form.saved ?? '').trim();
  const how = String(form.how ?? '').trim();
  if (statusKind(form.status) === 'done' && (!sameAmount(saved, current?.realized_value) || how !== was('realized_note'))) {
    out.action_status = form.status;
    out.realized_value = saved === '' ? null : Number(saved);
    out.realized_note = how;
  }
  if (out.action_status && chosen && writesChoice(choices)) out[CHOICE_COLUMN] = chosen;
  return out;
}

export function actionProblem(form, unit = '', kind = '') {
  if (statusKind(form.status) === 'done') {
    const saved = String(form.saved ?? '').trim();
    if (saved && !AMOUNT.test(saved)) return `Enter the ${savedWords(unit, kind)} as a number, 0 or more`;
    return String(form.how ?? '').trim().length > NOTE_CHARS ? `Keep how you know to ${NOTE_CHARS} characters` : '';
  }
  if (statusKind(form.status) !== 'dismissed') return '';
  if (!form.reason.trim()) return 'Say why it is not an issue';
  return form.reason.trim().length > REASON_CHARS ? `Keep the reason to ${REASON_CHARS} characters` : '';
}

export const heldBack = (current) => current?.held_back === true;
export const heldText = (meaning) => `${meaning} Leave this one as it is.`;

export function aiValue(name, current, row, aliases = {}) {
  for (const value of [current?.[name], row?.[name], aliases[name] ? row?.[aliases[name]] : null]) {
    const text = value == null ? '' : plainText(value).trim();
    if (text) return text;
  }
  return '';
}

export function evidenceOf(raw) {
  if (Array.isArray(raw)) return raw.map((s) => plainText(s).trim()).filter(Boolean);
  const text = String(raw ?? '').trim();
  if (!text) return [];
  if (!text.startsWith('[')) return [text];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? evidenceOf(parsed) : [];
  } catch {
    return [];
  }
}

export function savingText(amount, currency, kind = '') {
  const unit = String(currency || '').trim();
  return unit ? wholeMoney(amount, unit, kind) : integer(amount);
}

export function recordCurrency(meta, current, row) {
  return [current?.currency, row?.currency, listed('value_at_stake', meta)?.currency].find((c) => isCurrency(c)) || '';
}

export function claimTarget(rows, person, limit = 200) {
  const open = (rows || []).filter((r) => recordKeyOf(r) != null && r?._inspire_version && !isClosed(r));
  if (!String(person || '').trim() || !open.length || open.some((r) => String(r._inspire_owner || '').trim())) return null;
  const mine = open.slice(0, limit);
  return { record_keys: mine.map((r) => String(recordKeyOf(r))), seen: Object.fromEntries(mine.map((r) => [String(recordKeyOf(r)), String(r._inspire_version)])) };
}

export const claimText = (n) => `Nobody owns these records yet, so My work stays empty for everyone. Take the ${n === 1 ? 'one' : n} on this page, or assign each one to the person who will work it.`;

export const QUIET_MIN = 3;
export const RAISE_CONFIDENCE = 'What would raise it: more history for each item, so the forecast can beat a simple guess; fixing the data quality issues flagged on the rows; and a run on every group instead of the First run only.';

export function quietList(rows, meta, aliases = {}) {
  const list = rows || [];
  if (list.length < QUIET_MIN) return null;
  const levels = list.map((r) => aiValue('confidence_level', null, r, { confidence_level: '_inspire_confidence_level', ...aliases }));
  if (!levels.every((l) => l === 'Low')) return null;
  const actions = new Set(list.map((r) => (meta?.action ? plainText(r?.[meta.action]).trim() : '')));
  const action = actions.size === 1 ? [...actions][0] : '';
  const why = list.map((r) => aiValue('ai_confidence_reason', null, r, aliases)).find(Boolean) || '';
  const said = action ? `, so the suggested action on each one is “${action}”` : '';
  return { title: `All ${list.length} rows on this list are low confidence${said}.`, why: why ? `Why: ${why}` : '', raise: RAISE_CONFIDENCE };
}

export function recordView(meta, current, row, aliases = {}, unit = '', kind = '') {
  const get = (name) => aiValue(name, current, row, aliases);
  const level = get('confidence_level');
  const raw = current?.value_at_stake ?? row?.value_at_stake;
  const amount = isAmount(raw) ? countOf(raw) : null;
  const currency = shownUnit(unit, recordCurrency(meta, current, row), kind);
  const planned = meta?.action ? plainText(current?.[meta.action] ?? row?.[meta.action]).trim() : '';
  return {
    explanation: get('ai_explanation'),
    held: get('ai_check'),
    evidence: evidenceOf(current?.ai_evidence ?? row?.ai_evidence),
    confidence: CONFIDENCE_LEVELS.includes(level) ? { level, reason: get('ai_confidence_reason') } : null,
    action: get('ai_next_action') || planned,
    expected: get('ai_expected_result'),
    other: get('ai_other_option'),
    saving: amount == null ? null : { text: savingText(amount, currency, kind), formula: get('value_at_stake_formula') },
  };
}

export function askQuestions(meta) {
  const title = meta?.label ? String(columnLabel(meta.label, meta) || '').trim() : '';
  const noun = !title ? 'record' : /^[A-Z0-9]+$/.test(title) ? title : title.charAt(0).toLowerCase() + title.slice(1);
  return [`Show the history of this ${noun}`, 'Are there others like this?', 'What happens if we do nothing?'];
}

export function initials(who) {
  const parts = String(who || '').split('@')[0].split(/[\s._-]+/).filter(Boolean);
  return parts.slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join('') || '?';
}

export function dueText(due, status, today = new Date().toISOString().slice(0, 10)) {
  const day = String(due ?? '').slice(0, 10);
  if (!day) return null;
  return { text: `Due ${dayLabel(day)}`, late: day < today && isOpenStatus(status) };
}

export function doneText(current, currency = '', kind = '', choices = DEFAULT_CHOICES) {
  const outcome = String(current?.action_outcome ?? '').trim();
  const choice = choiceOf(choices, current?.action_status, current?.[CHOICE_COLUMN]);
  const marked = choice && !isDefaultChoice(choice) ? `Marked ${choice.label}` : '';
  const text = doneWords(current, currency, kind, outcome);
  return marked && text ? text.replace(/^Marked (done|as not an issue|as could not fix)/, marked) : text;
}

function doneWords(current, currency, kind, outcome) {
  const status = statusKind(current?.action_status);
  if (status === 'done') {
    const amount = current.realized_value;
    const reported = !isAmount(amount) ? ''
      : ` People reported it ${savedVerb(currency, kind)} ${savingText(amount, currency, kind)}${String(current.realized_note ?? '').trim() ? `: ${String(current.realized_note).trim()}` : ''}.`;
    if (outcome === 'Resolved') return `Marked done. A later run found it resolved.${reported}`;
    if (outcome === 'Still flagged') return `Marked done, but a later run still flags it.${reported}`;
    return (outcome ? `Marked done. A later run says: ${outcome}` : 'Marked done. The next run checks whether it worked.') + reported;
  }
  if (status === 'could_not') {
    if (outcome === 'Resolved') return 'Marked as could not fix. A later run found it resolved anyway.';
    if (outcome === 'Still flagged') return 'Marked as could not fix. A later run still flags it.';
    return 'Marked as could not fix. The next run still checks it.';
  }
  if (status === 'dismissed') {
    const reason = String(current.dismiss_reason ?? '').trim();
    return reason ? `Marked as not an issue. Reason: ${reason}` : 'Marked as not an issue.';
  }
  return '';
}

function listed(name, meta) {
  return [...(meta?.columns || []), ...(meta?.detail || [])].find((c) => c.column === name);
}

export function columnLabel(name, meta, unit = '', kind = '') {
  const known = listed(name, meta);
  if (known?.label) return plainWords(known.label);
  const roles = { [meta?.label]: meta?.label_title || 'Item', [meta?.tier]: 'Priority tier', [meta?.rank]: 'Rank', [meta?.action]: 'Recommended action',
    [meta?.reasons]: 'Why it is on the list', [meta?.key]: 'Id' };
  if (name && roles[name]) return roles[name];
  if (name === 'realized_value') return cap(savedWords(unit, kind));
  if (ACTION_LABELS[name]) return ACTION_LABELS[name];
  return plainWords(String(name || '')) || '';
}

export function inputOf(field, value) {
  switch (field.kind) {
    case 'integer': return { tag: 'input', type: 'number', step: '1', inputMode: 'numeric' };
    case 'decimal': return { tag: 'input', type: 'number', step: 'any', inputMode: 'decimal' };
    case 'boolean': return { tag: 'select' };
    case 'date': return { tag: 'input', type: 'date' };
    case 'timestamp': return { tag: 'input', type: 'datetime-local', step: '1' };
    case 'lines': return { tag: 'textarea', rows: 3, wide: true, hint: 'One per line' };
    default: return LONG_TEXT.test(field.name) || String(value ?? '').length > 60 ? { tag: 'textarea', rows: 3, wide: true } : { tag: 'input', type: 'text' };
  }
}

export function toInput(field, value) {
  if (value == null) return '';
  switch (field.kind) {
    case 'boolean': return value === true || value === 'true' ? 'true' : value === false || value === 'false' ? 'false' : '';
    case 'lines': return (Array.isArray(value) ? value : [value]).map((v) => plainText(v)).join('\n');
    case 'timestamp': return String(value).replace(' ', 'T').replace(/(Z|[+-]\d{2}:\d{2})$/, '').slice(0, 19);
    case 'date': return String(value).slice(0, 10);
    default: return typeof value === 'object' ? plainText(value) : String(value);
  }
}

const fromInput = (field, text) => (field.kind === 'lines' ? String(text).split('\n').map((t) => t.trim()).filter(Boolean) : text);

export const editableFields = (fields) => (fields || []).filter((f) => f.editable);

export function formValues(fields, row, keyField) {
  const out = Object.fromEntries(editableFields(fields).map((f) => [f.name, toInput(f, row?.[f.name])]));
  const key = (fields || []).find((f) => f.name === keyField);
  if (key && !row) out[key.name] = '';
  return out;
}

export function changedValues(fields, row, form) {
  const out = {};
  editableFields(fields).forEach((f) => {
    if ((form[f.name] ?? '') !== toInput(f, row?.[f.name])) out[f.name] = fromInput(f, form[f.name] ?? '');
  });
  return out;
}

export function addedValues(fields, form, keyField) {
  const out = {};
  (fields || []).filter((f) => f.editable || f.name === keyField).forEach((f) => {
    const text = form[f.name] ?? '';
    if (String(text).trim() !== '') out[f.name] = fromInput(f, text);
  });
  return out;
}

export function formProblems(fields, form, keyField) {
  const problems = {};
  (fields || []).filter((f) => f.editable || f.name === keyField).forEach((f) => {
    const text = String(form[f.name] ?? '').trim();
    if (f.name === keyField && !text) problems[f.name] = 'A new record needs this id';
    else if (text && f.kind === 'integer' && !WHOLE.test(text)) problems[f.name] = 'Enter a whole number';
    else if (text && f.kind === 'decimal' && (!NUMBER.test(text) || !Number.isFinite(Number(text)))) problems[f.name] = 'Enter a number';
  });
  return problems;
}

export function suggestions(rows, name, limit = 30) {
  const seen = new Set();
  (rows || []).forEach((r) => {
    const v = r?.[name];
    if (typeof v === 'string' && v.trim() && seen.size < limit) seen.add(v);
  });
  return [...seen].sort((a, b) => a.localeCompare(b));
}

export function whenText(value) {
  const d = value == null || value === '' ? null : asDate(value);
  return d ? `${STAMP.format(d)} UTC` : String(value ?? '');
}

export function valueText(field, value, meta, unit = '', kind = '') {
  if (value == null || value === '' || (Array.isArray(value) && !value.length)) return 'empty';
  const known = listed(field.name, meta);
  if (known && field.name === 'value_at_stake') return formatValue(value, known.format || 'currency', shownUnit(unit, known.currency, kind), undefined, kind);
  if (known) return formatValue(value, known.format || 'text', known.currency);
  switch (field.kind) {
    case 'boolean': return value === true || value === 'true' ? 'Yes' : 'No';
    case 'date': return dayLabel(value);
    case 'timestamp': return whenText(value);
    case 'integer': return grouped(value);
    case 'decimal': return grouped(value, { maximumFractionDigits: 4 });
    default: return plainText(value);
  }
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function historyChanges(fields, versions) {
  const shown = (fields || []).filter((f) => f.role === 'business' || f.role === 'id' || f.role === 'action');
  return (versions || []).map((version, i) => {
    const before = i ? versions[i - 1] : null;
    const changes = before ? shown.filter((f) => !same(before[f.name], version[f.name])).map((f) => ({ field: f, from: before[f.name], to: version[f.name] })) : [];
    const set = !before && version.change_source === 'add' ? shown.filter((f) => version[f.name] != null && version[f.name] !== '').map((f) => ({ field: f, to: version[f.name] })) : [];
    return { version, n: i + 1, changes, set };
  });
}

export function whoText(version) {
  const by = String(version?.changed_by || '').trim();
  if (by.startsWith('run ')) return `the job, ${by}`;
  return by || 'someone';
}

const said = (value) => plainText(value ?? '').trim();

export function closedText(row) {
  if (!CLOSED_STATUSES.includes(row?._inspire_status) || !(said(row?._inspire_closed_by) || row?._inspire_closed_at)) return '';
  const when = row._inspire_closed_at ? ` on ${whenText(row._inspire_closed_at)}` : '';
  const why = said(row._inspire_closed_reason);
  const note = said(row._inspire_closed_note) || said(row._inspire_closed_comment);
  return [`By ${whoText({ changed_by: row._inspire_closed_by })}${when}`, why && `Why: ${why}`, note && `Note: ${note}`].filter(Boolean).join('. ');
}

const BATCH = /^[0-9a-f]{32}$/;

export const closedBatchOf = (row) => (CLOSED_STATUSES.includes(row?._inspire_status)
  && BATCH.test(String(row?._inspire_closed_batch ?? '')) && !row?._inspire_closed_undo ? String(row._inspire_closed_batch) : '');

export const undoBatchOf = (row, person) => (String(person || '').trim() && row?._inspire_closed_can_undo === true ? closedBatchOf(row) : '');

export const UNDO_THEIRS = 'Only the person who made this change or an owner of this use case can undo it.';

export const UNDO_CLOSE = 'Undo puts back every record this change touched, as they were before it, and keeps both versions in their history.';

export const isClosed = (row) => CLOSED_STATUSES.includes(row?._inspire_status || row?.action_status);

export const ACCEPTED = { action_status: IN_PROGRESS, note: 'Accepted the suggested action' };
export const suggestionOf = (meta, row) => (meta?.action ? plainText(row?.[meta.action]).trim() : '');
export const acceptable = (meta, row) => !!suggestionOf(meta, row) && !!row?._inspire_version && (row._inspire_status || NEW) === NEW;
export function acceptedText(n, left = 0) {
  const kept = left ? ` Left ${recordsText(left)} as they are: no suggested action, or already started or closed.` : '';
  return n ? `Accepted the suggested action on ${recordsText(n)}.${kept}` : `None of the selected records has a suggested action to accept.${kept}`;
}

export const skippedText = (n) => `Skipped ${recordsText(n)} already closed: fixed, dismissed or could not fix. To reopen one, open it and undo its change.`;

export const READ_ONLY = 'Read-only in Everything. To reopen it, undo this change.';
export const READ_ONLY_KEPT = 'Read-only in Everything. This change cannot be undone here, so the record stays closed.';
export const READ_ONLY_THEIRS = `Read-only in Everything. ${UNDO_THEIRS}`;
export const CLOSED_PICK = 'Already closed, so it cannot be selected';

function versionLine(meta, { version, changes }, unit = '', kind = '') {
  const said = changes.map((c) => `${columnLabel(c.field.name, meta, unit, kind)}: ${valueText(c.field, c.from, meta, unit, kind)} to ${valueText(c.field, c.to, meta, unit, kind)}`);
  return `${whenText(version.valid_from)}, ${whoText(version)}, ${SOURCES[version.change_source] || version.change_source}${said.length ? `: ${said.join('; ')}` : ''}`;
}

export function explainContext(meta, data, row, unit = '', kind = '') {
  const current = data?.current || row || {};
  const fields = {};
  const add = (label, text) => {
    if (Object.keys(fields).length < EXPLAIN_FIELDS && text && text !== 'empty' && !(label in fields)) fields[label] = text;
  };
  const known = (data?.fields || []).filter((f) => ['id', 'business', 'action', 'run'].includes(f.role));
  if (known.length) known.forEach((f) => add(columnLabel(f.name, meta, unit, kind), valueText(f, current[f.name], meta, unit, kind)));
  else {
    [meta.label, meta.key, meta.sublabel, ...[...(meta.columns || []), ...(meta.detail || [])].map((c) => c.column)].filter(Boolean)
      .forEach((name) => add(columnLabel(name, meta), current[name] == null ? '' : formatValue(current[name], listed(name, meta)?.format || 'text', listed(name, meta)?.currency)));
  }
  const tier = current[meta.tier] ?? row?.[meta.tier];
  const action = current[meta.action] ?? row?.[meta.action];
  const history = historyChanges(data?.fields, data?.versions).slice(-EXPLAIN_VERSIONS).map((item) => versionLine(meta, item, unit, kind));
  const level = aiValue('confidence_level', current, row, { confidence_level: '_inspire_confidence_level' });
  return {
    fields, tier: tier == null ? null : String(tier), action: action == null ? null : plainText(action), history,
    ...(CONFIDENCE_LEVELS.includes(level) ? { confidence: level, facts: plainText(current.ai_facts ?? row?.ai_facts).slice(0, EXPLAIN_FACTS) } : {}),
  };
}

export const recordName = (row, meta) => entityName(row, meta?.label);
export function watchBreakdown(counts) {
  if (!counts || counts.open !== 0 || !(counts.watch > 0)) return '';
  const done = counts.statuses?.[DONE] || 0;
  const dismissed = counts.statuses?.[DISMISSED] || 0;
  return `Nothing to fix right now: ${integer(counts.watch)} on watch (held back on purpose), ${integer(done)} done, ${integer(dismissed)} dismissed.`;
}

export const recordSentenceName = (row, meta) => entityName(row, meta?.label, { sentence: true }) || 'This record';
