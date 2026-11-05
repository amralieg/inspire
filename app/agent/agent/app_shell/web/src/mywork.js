import { asDate, dayLabel, grouped, wholeMoney } from './format.js';
import { moneyText, ownerName, pageCurrency, pageKind, plural, totals } from './hub.js';
import { browserZone } from './prefs.js';

export const MY_WORK_ROUTE = 'mywork';
export const CUSTOM = 'custom';
export const DEFAULT_PERIOD = 'week';
export const PERIODS = [['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['all', 'All time'], [CUSTOM, 'Pick days']];
export const MAX_DAYS = 366;
export const PAGE_ROWS = 50;
export const AI_CHARS = 600;
const DAY_MS = 86400000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const NUMBER = /\d[\d,]*(?:\.\d+)?/g;
export const KINDS = {
  fixed: 'Fixed', dismissed: 'Closed as not an issue', could_not: 'Closed as could not fix', assigned: 'Assigned', note: 'Added a note',
  changed: 'Changed',
};

export function periodProblem(choice, from, to) {
  if (choice !== CUSTOM) return PERIODS.some(([id]) => id === choice) ? '' : 'Pick a period';
  const real = (day) => DAY.test(String(day || '')) && asDate(day)?.toISOString().slice(0, 10) === day;
  if (!real(from) || !real(to)) return 'Pick a first and a last day';
  if (from > to) return 'The first day must be on or before the last day';
  return Math.round((asDate(to) - asDate(from)) / DAY_MS) >= MAX_DAYS ? `Pick a period of at most ${plural(MAX_DAYS, 'day')}` : '';
}

export function periodBody(choice, from, to, zone = browserZone()) {
  return { ...(choice === CUSTOM ? { from, to } : { window: choice }), ...(zone ? { time_zone: zone } : {}) };
}

export function periodText(period) {
  const zone = period?.zone || 'UTC';
  if (!period?.start_day) return 'over all time';
  const last = new Date(Date.parse(`${period.end_day}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
  const span = last === period.start_day ? `on ${dayLabel(last)}` : `from ${dayLabel(period.start_day)} to ${dayLabel(last)}`;
  return `${span}, ${zone} time`;
}

const unitOf = (page, summaries) => [pageCurrency(page, summaries?.[page.id]), pageKind(page, summaries?.[page.id])];
const amount = (n, [currency, kind]) => wholeMoney(n, currency, kind);
const hoursText = (h) => `${grouped(Math.round(h * 10) / 10)} ${h === 1 ? 'hour' : 'hours'}`;

export function workRows(data, pages, summaries) {
  return (pages || []).map((page) => ({ page, entry: data?.pages?.[page.id] })).filter(({ entry }) => entry?.tracked).map(({ page, entry }) => {
    const unit = unitOf(page, summaries);
    const records = entry.worked.records || 0;
    return {
      page, unit, worked: entry.worked, priced: entry.priced === true, money: entry.money, close: entry.close,
      best: entry.best ? { ...entry.best, text: amount(entry.best.money, unit) } : null,
      perHour: entry.active_hours ? records / entry.active_hours : null, activeHours: entry.active_hours || 0,
      saved: entry.minutes ? (records * entry.minutes) / 60 : null, minutes: entry.minutes ?? null,
    };
  });
}

const total = (rows, pick) => rows.reduce((n, r) => n + (Number(pick(r)) || 0), 0);

function moneyLine(rows, basis) {
  const priced = rows.filter((r) => r.priced && r.money?.[basis]?.n);
  if (!priced.length) return null;
  const sums = totals(priced.map((r) => ({ money: r.money[basis].money, currency: r.unit[0], kind: r.unit[1] })));
  return { n: total(priced, (r) => r.money[basis].n), text: moneyText(sums), units: sums.size };
}

export function workFacts(data, pages, summaries) {
  const rows = workRows(data, pages, summaries);
  const sum = (key) => total(rows, (r) => r.worked[key]);
  const worked = Object.fromEntries(['fixed', 'dismissed', 'could_not', 'assigned', 'notes', 'changes', 'records'].map((k) => [k, sum(k)]));
  const units = new Set(rows.filter((r) => r.best).map((r) => JSON.stringify(r.unit)));
  const best = units.size === 1 ? rows.filter((r) => r.best).sort((a, b) => b.best.money - a.best.money)[0] : null;
  const timed = rows.filter((r) => r.saved !== null);
  return {
    period: periodText(data?.period), rows, worked, single: rows.length === 1,
    money: { measured: moneyLine(rows, 'measured'), reported: moneyLine(rows, 'reported'), estimated: moneyLine(rows, 'estimated') },
    best: best ? { page: best.page, key: best.best.key, label: best.best.label || String(best.best.key), basis: best.best.basis, text: best.best.text } : null,
    saved: timed.length ? { hours: total(timed, (r) => r.saved), pages: timed.map((r) => r.page), missing: rows.filter((r) => r.saved === null).map((r) => r.page) } : null,
  };
}

export function rateText(row) {
  return row.perHour === null ? 'no active hour' : `${grouped(Math.round(row.perHour * 10) / 10)} records per active hour`;
}

export function closeText(row) {
  return row.close?.n ? `${hoursText(row.close.median_hours)} median from first seen to your close, over ${plural(row.close.n, 'close')}` : 'nothing closed';
}

export function scopeText(facts) {
  const uses = `${plural(facts.rows.length, 'use case')} that ${facts.rows.length === 1 ? 'keeps' : 'keep'} actions`;
  return `Counts only the records you changed yourself, ${facts.period}, in the ${uses}. Money stays in each use case's own unit and is never added across units.`;
}

export function notableOf(facts) {
  if (!facts.worked.records) return null;
  if (facts.best) return { name: facts.best.label, line: `${facts.best.label} in ${facts.best.page.title}, ${facts.best.text} ${facts.best.basis}` };
  const most = (key) => facts.rows.filter((r) => r.worked[key] > 0).sort((a, b) => b.worked[key] - a.worked[key])[0];
  const fixed = most('fixed');
  if (fixed?.best) {
    const label = fixed.best.label || String(fixed.best.key);
    return { name: label, line: `${label} in ${fixed.page.title}, ${fixed.best.text} ${fixed.best.basis}` };
  }
  if (fixed) return { name: fixed.page.title, line: `${plural(fixed.worked.fixed, 'record')} fixed in ${fixed.page.title}` };
  const changed = most('records');
  return changed ? { name: changed.page.title, line: `${plural(changed.worked.records, 'record')} changed in ${changed.page.title}` } : null;
}

export function factLines(facts) {
  const w = facts.worked;
  const lines = [`Period: ${facts.period}`, `Records changed: ${grouped(w.records)}`, `Fixed: ${grouped(w.fixed)}`,
    `Closed as not an issue: ${grouped(w.dismissed)}`, `Closed as could not fix: ${grouped(w.could_not)}`,
    `Assigned: ${grouped(w.assigned)}`, `Notes added: ${grouped(w.notes)}`];
  [['measured', 'Measured savings on your fixes'], ['reported', 'Savings people reported on your fixes'],
    ['estimated', 'Estimated savings on your fixes']].forEach(([basis, label]) => {
    const line = facts.money[basis];
    if (line) lines.push(`${label}: ${line.text} on ${plural(line.n, 'fix', 'fixes')}`);
  });
  if (facts.best) lines.push(`Largest closed record: ${facts.best.label}, ${facts.best.text} ${facts.best.basis}`);
  if (facts.saved) lines.push(`Estimated time saved: ${hoursText(facts.saved.hours)}`);
  const notable = notableOf(facts);
  if (notable) lines.push(`Notable example: ${notable.line}`);
  return lines;
}

export function templateText(facts) {
  const w = facts.worked;
  if (!w.records) return `You changed no records ${facts.period}.`;
  const closed = [w.fixed ? `fixed ${plural(w.fixed, 'record')}` : '', w.dismissed ? `closed ${grouped(w.dismissed)} as not an issue` : '',
    w.could_not ? `closed ${grouped(w.could_not)} as could not fix` : ''].filter(Boolean);
  const did = closed.length ? closed.join(', ') : `changed ${plural(w.records, 'record')}`;
  const money = ['measured', 'reported', 'estimated'].map((b) => (facts.money[b] ? `${facts.money[b].text} ${b}` : '')).filter(Boolean);
  return `${facts.period.charAt(0).toUpperCase()}${facts.period.slice(1)}, you ${did} in ${plural(facts.rows.length, 'use case')}.`
    + (money.length ? ` Your fixes show ${money.join(', ')}.` : '');
}

export function aiQuestion(facts) {
  const notable = notableOf(facts);
  return ['Write two short plain sentences to this person about their own work, speaking to them as "you".',
    'The first sentence praises their work for what it achieved in this period, warmly and without exaggeration.',
    ...(notable ? [`The second sentence names this one notable example: ${notable.line}. Write its name exactly as it is written here.`] : []),
    'Use only the facts below. Copy every number exactly as it is written here, write no other number, and run no query.',
    ...factLines(facts)].join('\n');
}

const numbers = (text) => (String(text || '').match(NUMBER) || []).map((n) => n.replace(/,/g, ''));

export function answerProblem(answer, facts) {
  const text = String(answer || '').trim();
  if (!text) return 'Genie wrote nothing';
  if (text.length > AI_CHARS) return 'Genie wrote more than a short summary';
  const notable = notableOf(facts);
  if (notable && !text.toLowerCase().includes(notable.name.toLowerCase())) return `Genie did not name your notable example, ${notable.name}`;
  const allowed = new Set(numbers(factLines(facts).join('\n')));
  return numbers(text).every((n) => allowed.has(n)) ? '' : 'Genie wrote a number that is not one of yours';
}

export function checkedAnswer(answer, facts) {
  return answerProblem(answer, facts) ? '' : String(answer).trim();
}

export function whenText(at, zone = browserZone()) {
  const d = asDate(at);
  if (!d) return String(at ?? '');
  const options = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
  try {
    return new Intl.DateTimeFormat('en-US', { ...options, ...(zone ? { timeZone: zone } : {}) }).format(d);
  } catch {
    return new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(d);
  }
}

export function activityText(entry) {
  const kind = KINDS[entry.kind] || KINDS.changed;
  if (entry.kind === 'assigned') return entry.owner ? `${kind} to ${ownerName(entry.owner)}` : 'Took the owner off';
  return kind;
}
