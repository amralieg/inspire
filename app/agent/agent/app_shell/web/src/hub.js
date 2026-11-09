import { addCounts, asDate, countOf, grouped, isAmount, isMoney, kindOf, largestFirst, stakeNameOf, sumOf, unitOf, wholeMoney } from './format.js';
import { savedFormula, sumFormula } from './money.js';

export const NOT_MEASURED = 'Not measured yet';
export const NOT_RELIABLE = 'Results not trusted yet';
export const ACT_NOW = 'Act now';
export const REVIEW = 'Review';
export const DEFAULT_VIEW = { owner: 'all', show: 'fix' };
export const OWNER_CHOICES = [['all', 'Everyone'], ['me', 'Me'], ['none', 'Nobody yet']];
export const SHOW_CHOICES = [['fix', 'To fix'], ['all', 'To fix and worth a look']];
const SHOWN_TIERS = { fix: [ACT_NOW], all: [ACT_NOW, REVIEW] };
export const MONEY_COLUMN = 'value_at_stake';
export const shownTiers = (show) => SHOWN_TIERS[show] || SHOWN_TIERS.fix;
const DAY_MS = 86400000;
const BAR_TICKS = 8;
const SHORT_DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const WEEKDAY = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

export const plural = (n, one, many = `${one}s`) => `${grouped(n)} ${n === 1 ? one : many}`;
export const shortDay = (value) => { const d = asDate(value); return d ? SHORT_DAY.format(d) : ''; };
export const tickOf = (label, i, count) => (i % Math.ceil(count / BAR_TICKS) ? '' : label);
const dayOf = (value) => (value ? String(value).slice(0, 10) : '');
const daysBetween = (from, to) => Math.round((asDate(dayOf(to)) - asDate(dayOf(from))) / DAY_MS);

export function isMine(owner, user) {
  const text = String(owner || '').trim().toLowerCase();
  return !!text && [user?.email, user?.name].some((who) => who && String(who).trim().toLowerCase() === text);
}

export function ownerName(owner) {
  const text = String(owner || '').trim();
  if (!text.includes('@')) return text;
  return text.split('@')[0].split(/[._-]+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || text;
}

export function dueText(due, today) {
  if (!due) return { text: 'No date', late: false, none: true };
  const days = daysBetween(today, due);
  if (days === 0) return { text: 'Today', late: false };
  if (days === 1) return { text: 'Tomorrow', late: false };
  if (days < 0) return { text: `${plural(-days, 'day')} late`, late: true };
  return { text: WEEKDAY.format(asDate(dayOf(due))), late: false };
}

export function pageCurrency(page, summary) {
  const listed = [...(page?.records?.columns || []), ...(page?.records?.detail || [])].find((c) => c.column === MONEY_COLUMN);
  const run = summary?.run;
  if (run && !isMoney(unitOf(run), kindOf(run))) return unitOf(run);
  return (run ? unitOf(run) : '') || listed?.currency || '';
}

export const pageKind = (page, summary) => kindOf(summary?.run);

export function totals(rows) {
  const out = new Map();
  rows.forEach((r) => {
    if (!isAmount(r.money)) return;
    const key = JSON.stringify([r.currency || '', r.kind || '']);
    out.set(key, addCounts([out.get(key), r.money]));
  });
  return out;
}

export function moneyText(sums) {
  if (!sums.size) return wholeMoney(0, '');
  return [...sums.entries()].sort((a, b) => largestFirst(a[1], b[1])).map(([key, n]) => wholeMoney(n, ...JSON.parse(key))).join(' + ');
}

export const ownerMatches = (item, owner, user) => owner === 'all' || (owner === 'me' ? isMine(item.owner, user) : !String(item.owner || '').trim());
export const isShown = (item, show) => (SHOWN_TIERS[show] || SHOWN_TIERS.fix).includes(item.tier);
export const isToFix = (item) => item.tier === ACT_NOW;

export function sortThings(rows, user) {
  return [...rows].sort((a, b) => (Number(isMine(b.owner, user)) - Number(isMine(a.owner, user)))
    || largestFirst(a.money, b.money) || String(a.label ?? '').localeCompare(String(b.label ?? '')));
}

export const visiblePages = (pages, hub) => pages.filter((p) => hub?.pages?.[p.id]?.visible !== false);

export function viewRows(items, view, user) {
  const owned = items.filter((i) => ownerMatches(i, view.owner, user));
  return { owned, fix: owned.filter(isToFix), shown: sortThings(owned.filter((i) => isShown(i, view.show)), user) };
}

export function hubView(page, current, summary, view, user) {
  const currency = pageCurrency(page, summary);
  const kind = pageKind(page, summary);
  const items = current?.tracked ? current.items.map((i) => ({ ...i, page, currency, kind, model: current.money_model || null })) : [];
  return viewRows(items, view, user);
}

export const viewIsDefault = (view) => view.owner === DEFAULT_VIEW.owner && view.show === DEFAULT_VIEW.show;

export function viewWords(view, reasons = [], state = null) {
  const named = (choices, v) => choices.find(([k]) => k === v)?.[1] || v;
  return [`Owner: ${named(OWNER_CHOICES, view.owner)}`, `Show: ${named(SHOW_CHOICES, view.show)}`,
    ...reasons.filter((r) => state?.ai?.[r.name]?.length).map((r) => `${r.label}: ${state.ai[r.name].join(', ')}`)].join('; ');
}

export function couldSaveText(fix) {
  return fix.length ? `${stakeNameOf(fix.map((r) => r.currency), fix.map((r) => r.kind))} on the ${plural(fix.length, 'thing')} to fix, added up` : 'Nothing to fix right now';
}

export const couldSaveFormula = (fix, place = '') => sumFormula(fix, `${stakeNameOf(fix.map((r) => r.currency), fix.map((r) => r.kind))} on the ${plural(fix.length, 'thing')} to fix${place}, added up`);

export function measured(entries) {
  return entries.filter((e) => e?.tracked && e.money);
}

export function savedTile(entries, pages, summaries, key, since) {
  const counted = measured(entries.map(([, e]) => e));
  if (!counted.length) return { value: NOT_MEASURED, sub: 'No use case records its fixes and the amount at stake on them yet', tone: '' };
  const rows = entries.filter(([, e]) => counted.includes(e)).map(([id, e]) => ({
    money: e.done[key] ?? 0, currency: pageCurrency(pages.find((p) => p.id === id), summaries?.[id]),
    kind: pageKind(pages.find((p) => p.id === id), summaries?.[id]),
  }));
  const n = sumOf(counted, (e) => e.done[`${key}_n`]);
  const when = since ? ` since ${shortDay(since)}` : '';
  const value = moneyText(totals(rows));
  const stake = stakeNameOf(rows.map((r) => r.currency), rows.map((r) => r.kind));
  return { value, sub: `${stake} when fixed, less what a later run still finds, on ${plural(n, 'fix', 'fixes')} a later run confirmed${when}`, tone: 'green',
    formula: savedFormula(value, n, since ? shortDay(since) : '', rows.length === 1 ? rows[0].currency : '',
      rows.length === 1 ? rows[0].kind : '') };
}

export function useCaseState(entry, summary) {
  if (!entry) return { kind: 'loading', text: '' };
  if (entry.error) return { kind: 'error', text: 'Could not load', reason: entry.error };
  if (entry.visible === false) return { kind: 'hidden', text: '' };
  const unreliable = String(summary?.run?.not_reliable || '').trim();
  if (unreliable && !entry.runs?.failed) {
    return { kind: 'wait', text: NOT_RELIABLE, title: NOT_RELIABLE, reason: unreliable, unreliable: true, next: entry.runs?.next };
  }
  if (entry.empty) return { kind: 'wait', text: 'Not ready yet', title: 'Not ready yet', reason: 'No update has written its results yet.' };
  if (!entry.tracked) return { kind: 'none', text: '' };
  const runs = entry.runs || {};
  if (runs.failed || runs.stale) {
    const since = shortDay(runs.updated || runs.as_of);
    const from = runs.as_of ? ` Its results are from ${shortDay(runs.as_of)}.` : '';
    return {
      kind: 'stale', text: 'Not updated', title: `Not updated since ${since}`,
      reason: runs.failed ? `The last update failed.${from}` : `The update planned for ${shortDay(runs.next)} has not run.${from}`,
    };
  }
  const run = summary?.run;
  if (run?.decision_basis === 'predicted' && run?.nothing_to_act) {
    return { kind: 'wait', text: 'Not ready yet', title: 'Not ready yet', reason: run.nothing_to_act, next: runs.next };
  }
  return { kind: 'fix', text: `${entry.items.filter(isToFix).length} to fix` };
}

export function nothingReason(entry, summary) {
  if (!entry?.tracked || (entry.items || []).some(isToFix)) return '';
  const run = summary?.run;
  const given = String(run?.nothing_to_act || '').trim();
  if (given) return given;
  const acted = countOf(run?.act_now_records);
  if (acted && !entry.truncated) return `the ${plural(acted, 'record')} to act on from the last update ${acted === 1 ? 'is' : 'are'} done or set aside`;
  const review = (entry.items || []).filter((i) => i.tier === REVIEW).length;
  if (review) return `no record reached Act now in the last update, and ${plural(review, 'record')} ${review === 1 ? 'is' : 'are'} worth a look`;
  return 'no record reached Act now or Review in the last update';
}

export function reliableText(reason) {
  const text = String(reason || '').trim();
  return text ? `${NOT_RELIABLE}: ${text}` : '';
}

export function capacityText(run) {
  const over = countOf(run?.over_capacity_records);
  const cap = countOf(run?.act_now_capacity);
  if (over <= 0 || cap <= 0) return '';
  const one = over === 1;
  return `${grouped(over)} more ${one ? 'record' : 'records'} would qualify for Act now, but the team capacity of `
    + `${grouped(cap)} a run holds ${one ? 'it' : 'them'} in Review.`;
}

export function nothingText(reason) {
  const text = String(reason || '').trim();
  if (!text) return '';
  const lowered = /^[A-Z][a-z]/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text;
  return `Nothing to act on yet, because ${lowered}`;
}

export const UNEXPLAINED = 'Not explained yet';
export const hasReasons = (state) => Object.values(state?.ai || {}).some((v) => v?.length);

export function setReason(state, name, values) {
  const ai = { ...(state?.ai || {}) };
  if (values?.length) ai[name] = values;
  else delete ai[name];
  return { ...state, ai };
}

export function pickReason(state, name, value) {
  const now = state?.ai?.[name] || [];
  return setReason(state, name, now.length === 1 && now[0] === value ? [] : [value]);
}

export function reasonFilters(entry, summary) {
  const reasons = [...new Set((entry?.items || []).map((i) => i.reason).filter(Boolean))];
  return (entry?.categories || []).map((name, i) => {
    const spec = summary?.categories?.[name];
    const meaning = String(spec?.meaning || '').trim();
    const label = i === 0 ? 'Reason (from AI)' : `${meaning ? meaning.charAt(0).toUpperCase() + meaning.slice(1) : `Reason ${i + 1}`} (from AI)`;
    const options = [...new Set([...(spec?.values || []), ...(i === 0 ? reasons : []), UNEXPLAINED])];
    return { name, label, options };
  });
}

export function switcherMatches(pages, text) {
  const words = String(text || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return pages;
  return pages.filter((p) => {
    const said = [p.title, p.use_case_id, p.domain, p.subdomain].filter(Boolean).join(' ').toLowerCase();
    return words.every((w) => said.includes(w));
  });
}
