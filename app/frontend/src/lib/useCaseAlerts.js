import { VIBE_FEATURES_LABEL } from './implementWizard.js';

export const ALERTS_HINT = 'Get an email when the results of this use case cross a line you set. Inspire saves each alert in Databricks as you, and it checks on its own schedule.';
export const ALERTS_EMPTY = 'No alerts on this use case yet.';
export const ALERTS_NOTHING = 'The page of this use case shows nothing an alert can watch: no rows to act on and no numbers.';
export const ALERTS_GENIE_NOTE = `The alert Genie builds with the MVP is set in ${VIBE_FEATURES_LABEL}.`;
export const BUILT_BY_GENIE = 'Built by Genie';
export const BUILT_DETAIL = `Genie built it with the MVP and checks it after each run of the job. Change it in ${VIBE_FEATURES_LABEL}.`;
export const BASELINE_HINT = 'It compares with the usual range of earlier runs, and uses your number until 5 earlier runs exist.';
export const EMAILS_HINT = 'Only people with a user in this workspace get the email. It never lists records.';
export const CLEARS_LABEL = 'Email again when it clears';
export const CLEARS_HINT = 'One more email when the value is back on the right side of the line, so the owner knows it recovered. '
  + 'Turn it off to hear from the alert only when it fires.';

const STATES = {
  ok: { label: 'OK', tone: 'success' },
  triggered: { label: 'Firing', tone: 'warning' },
  error: { label: 'Could not check', tone: 'error' },
  paused: { label: 'Paused', tone: 'idle' },
  unknown: { label: 'Not checked yet', tone: 'idle' },
  unread: { label: 'Cannot read', tone: 'error' },
};

export function alertState(state) {
  return STATES[state] || STATES.unknown;
}

export function clearsText(on) {
  return on ? 'Emails again when it clears' : 'No email when it clears';
}

export function parseEmails(text) {
  const seen = new Map();
  for (const raw of String(text || '').split(/[\s,;]+/)) {
    const email = raw.trim();
    if (email && !seen.has(email.toLowerCase())) seen.set(email.toLowerCase(), email);
  }
  return [...seen.values()];
}

export function measureOf(listing, form) {
  return (listing?.measures || []).find((m) => m.id === form?.what) || null;
}

export function blankAlertForm(listing) {
  return { id: '', name: '', what: listing?.measures?.[0]?.id || '', basis: 'fixed', operator: '>=', threshold: '', filters: {}, schedule: 'daily',
    emails: listing?.person || '', paused: false, notify: true };
}

export function alertFormFrom(alert) {
  const watch = alert?.watch || {};
  const threshold = Number(watch.threshold);
  return {
    id: String(alert?.id || ''), name: alert?.name && alert.name !== alert.rule ? alert.name : '', what: watch.what || '', basis: watch.basis || 'fixed', operator: watch.operator || '>=',
    threshold: Number.isFinite(threshold) ? String(threshold) : '', filters: { ...(watch.filters || {}) }, schedule: alert?.schedule || 'daily',
    emails: (alert?.emails || []).join(', '), paused: alert?.state === 'paused', notify: alert?.notify_on_ok !== false,
  };
}

export function reachableFilters(listing, form) {
  const measure = measureOf(listing, form);
  if (!measure) return [];
  const ids = form.basis === 'baseline' ? measure.baseline_filters || [] : measure.filters || [];
  return (listing?.filters || []).filter((f) => ids.includes(f.id));
}

export function operatorChoices(listing, form) {
  const words = listing?.operator_words || {};
  const ids = form?.basis === 'baseline' ? listing?.baseline_operators || [] : listing?.operators || [];
  return ids.map((id) => ({ id, label: words[id] || id }));
}

export function alertRequest(listing, form) {
  const allowed = new Set(reachableFilters(listing, form).map((f) => f.id));
  const filters = Object.fromEntries(Object.entries(form.filters || {}).filter(([id, values]) => allowed.has(id) && values.length));
  return {
    ...(form.id ? { id: form.id } : {}), name: form.name.trim(), schedule: form.schedule, emails: parseEmails(form.emails), paused: Boolean(form.paused),
    notify_on_ok: form.notify !== false,
    watch: { what: form.what, filters, operator: form.operator, threshold: String(form.threshold).trim(), basis: form.basis },
  };
}

export function numberText(value) {
  const n = Number(value);
  if (value === null || value === undefined || value === '' || !Number.isFinite(n)) return 'no value';
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

export function previewLine(preview) {
  if (!preview) return '';
  const fires = preview.fires ? 'It would send an email.' : 'It would not send an email.';
  const line = preview.basis === 'baseline' ? ` The line is ${numberText(preview.threshold)}, from ${preview.history_runs} earlier runs.` : '';
  return `Now: ${numberText(preview.value)}. ${fires}${line}`;
}

export function capText(caps) {
  if (!caps) return '';
  return `${caps.used} of ${caps.app} alerts kept here. You set up ${caps.mine} of your ${caps.person}.`;
}

export function capped(caps) {
  return Boolean(caps) && (caps.used >= caps.app || caps.mine >= caps.person);
}

export function scheduleLabel(listing, id) {
  const label = (listing?.schedules || []).find((s) => s.id === id)?.label || '';
  return label ? label[0].toUpperCase() + label.slice(1) : '';
}

export function thresholdHint(measure) {
  if (!measure) return '';
  if (measure.whole && measure.min === 0) return 'A whole number of rows, 0 or more.';
  return '';
}
