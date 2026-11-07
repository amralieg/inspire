import { change, changeText, grouped } from './format.js';

export const OPERATOR_WORDS = { '>=': 'at least', '>': 'more than', '=': 'equal to', '!=': 'not equal to', '<': 'less than', '<=': 'at most' };
export const RISES = ['>=', '>'];
export const BASELINE_MIN_RUNS = 5;

const STATES = {
  ok: { text: 'OK', tone: 'ok' },
  triggered: { text: 'Firing', tone: 'bad' },
  error: { text: 'Could not check', tone: 'bad' },
  paused: { text: 'Paused', tone: '' },
  unknown: { text: 'Not checked yet', tone: 'warn' },
};

export const stateFlag = (state) => STATES[state] || STATES.unknown;
export const withNotice = (said, out) => (out?.notice ? `${said} ${out.notice}` : said);

export function numberText(value) {
  const n = Number(value);
  if (value === '' || value == null || !Number.isFinite(n)) return '';
  return String(n);
}

export function shownNumber(value) {
  const n = Number(value);
  if (value === '' || value == null || !Number.isFinite(n)) return '';
  if (Number.isInteger(n)) return grouped(n);
  return grouped(n, Math.abs(n) >= 1 ? { maximumFractionDigits: 6 } : { maximumSignificantDigits: 6 });
}

export function ruleText(watch, measures) {
  const measure = (measures || []).find((m) => m.id === watch.what);
  const label = measure?.label || watch.what;
  const number = shownNumber(watch.threshold);
  const plural = !!measure?.whole;
  if (watch.basis === 'baseline') {
    const way = RISES.includes(watch.operator) ? 'rise' : 'fall';
    return `${label} ${plural ? way : `${way}s`} ${way === 'rise' ? 'above' : 'below'} the usual range of earlier runs`;
  }
  return `${label} ${plural ? 'are' : 'is'} ${OPERATOR_WORDS[watch.operator] || watch.operator} ${number}`;
}

export function operatorLabel(operator, basis) {
  if (basis !== 'baseline') return OPERATOR_WORDS[operator] ? `is ${OPERATOR_WORDS[operator]}` : operator;
  return `${RISES.includes(operator) ? 'rises above' : 'falls below'} the usual range, until then ${OPERATOR_WORDS[operator]} the number`;
}

export function filtersText(watch, filters) {
  const labels = Object.fromEntries((filters || []).map((f) => [f.id, f.label]));
  const parts = Object.entries(watch?.filters || {}).filter(([, v]) => v?.length).map(([id, v]) => `${labels[id] || id}: ${v.join(', ')}`);
  return parts.join('; ');
}

export function parseEmails(text) {
  const seen = new Map();
  for (const raw of String(text || '').split(/[\s,;]+/)) {
    const email = raw.trim();
    if (email && !seen.has(email.toLowerCase())) seen.set(email.toLowerCase(), email);
  }
  return [...seen.values()];
}

export function blankForm(listing, user) {
  const first = listing?.measures?.[0];
  return { id: '', name: '', what: first?.id || '', filters: {}, operator: '>=', threshold: '', basis: 'fixed', schedule: 'daily',
    emails: user?.email || '', paused: false, notify: true };
}

export function formFrom(alert) {
  const w = alert.watch || {};
  return { id: alert.id, name: alert.name || '', what: w.what || '', filters: { ...(w.filters || {}) }, operator: w.operator || '>=',
    threshold: numberText(w.threshold), basis: w.basis || 'fixed', schedule: alert.schedule || 'daily', emails: (alert.emails || []).join(', '),
    paused: alert.state === 'paused', notify: alert.notify_on_ok !== false };
}

export function measureOf(listing, form) {
  return (listing?.measures || []).find((m) => m.id === form.what) || null;
}

export function reachable(listing, form) {
  const measure = measureOf(listing, form);
  if (!measure) return [];
  return form.basis === 'baseline' ? measure.baseline_filters : measure.filters;
}

export function operatorsOf(listing, form) {
  return form.basis === 'baseline' ? listing?.baseline_operators || [] : listing?.operators || [];
}

export function watchOf(listing, form) {
  const allowed = new Set(reachable(listing, form));
  const filters = Object.fromEntries(Object.entries(form.filters).filter(([id, v]) => allowed.has(id) && v.length));
  return { what: form.what, filters, operator: form.operator, threshold: Number(form.threshold), basis: form.basis };
}

export function defaultName(listing, form) {
  return form.what ? ruleText(watchOf(listing, form), listing?.measures) : '';
}

export function formProblem(listing, form) {
  if (!measureOf(listing, form)) return 'Pick what to watch.';
  if (String(form.threshold).trim() === '' || !Number.isFinite(Number(form.threshold))) return 'Type the number to compare with.';
  if (!operatorsOf(listing, form).includes(form.operator)) return 'Pick how to compare.';
  if (!parseEmails(form.emails).length) return 'Add at least one email address.';
  return '';
}

export function capText(caps) {
  if (!caps) return '';
  return `${caps.used} of ${caps.app} alerts in this App. You set up ${caps.mine} of your ${caps.person}.`;
}

export function capped(caps) {
  return !!caps && (caps.used >= caps.app || caps.mine >= caps.person);
}

export function previewText(preview, format) {
  if (!preview) return '';
  const value = preview.value == null ? 'no value' : format(preview.value);
  const d = change(preview.value, preview.previous);
  const before = !('previous' in preview) ? '.' : preview.previous == null ? `. ${preview.words.none}.`
    : d == null ? '.' : `, ${changeText(d, preview.words)} ${preview.vs}.`;
  const line = preview.basis === 'baseline' ? ` The line is ${format(preview.threshold)}, from ${preview.history_runs} earlier runs.`
    : preview.history_runs != null ? ` There are ${preview.history_runs} earlier runs, so it uses your number until ${BASELINE_MIN_RUNS} exist.` : '';
  return `Now: ${value}${before} ${preview.fires ? 'It would send an email.' : 'It would not send an email.'}${line}`;
}
