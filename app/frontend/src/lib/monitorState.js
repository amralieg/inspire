import { formatClockUtc, utcDate } from './formatWhen.js';

export const SESSION_QUIET_AFTER_MS = 30 * 60 * 1000;

const ENDED_CATEGORY = {
  ended_success: 'success', completed: 'success', ended_warning: 'warning', ended_error: 'error', failed: 'error', error: 'error',
};

export function sessionFinished(session) {
  return Boolean(session) && (Boolean(session.completed_on) || Number(session.completed_percent) >= 100);
}

export const SESSION_FAILED = 'failed';

export function sessionFailed(session) {
  return sessionFinished(session) && String(session.processing_status || '').toLowerCase() === SESSION_FAILED;
}

export function sessionSucceeded(session) {
  return sessionFinished(session) && !sessionFailed(session);
}

export function sessionQuietSince(session, now, quietAfter = SESSION_QUIET_AFTER_MS) {
  if (!session || sessionFinished(session) || !Number.isFinite(now)) return null;
  const last = utcDate(session.last_updated) || utcDate(session.create_at);
  return last && now - last.getTime() > quietAfter ? last.toISOString() : null;
}

export function sessionStatus(session, now) {
  if (!session) return 'none';
  if (sessionFailed(session)) return 'failed';
  if (sessionFinished(session)) return 'finished';
  return sessionQuietSince(session, now) ? 'quiet' : 'running';
}

export function quietLine(since, now) {
  return `No news from this run since ${formatClockUtc(since, now)}.`;
}

export function stepCategory(status, live) {
  return ENDED_CATEGORY[String(status || '')] || (live ? 'running' : 'open');
}

const stepEnded = (step) => Object.hasOwn(ENDED_CATEGORY, String(step?.status || ''));

function eventAt(step) {
  const payload = step?.result_json;
  const at = utcDate(payload && typeof payload === 'object' ? payload.event_at : null) || utcDate(step?.last_updated);
  return at ? at.getTime() : null;
}

function replaces(held, next) {
  const before = eventAt(held);
  const after = eventAt(next);
  if (before !== null && after !== null && before !== after) return after > before;
  return stepEnded(next) || !stepEnded(held);
}

export function mergeSteps(previous, incoming) {
  const byId = new Map((previous || []).map((step) => [String(step.step_id), step]));
  for (const step of incoming || []) {
    const id = String(step.step_id);
    const held = byId.get(id);
    if (!held || replaces(held, step)) byId.set(id, step);
  }
  return [...byId.values()].sort((a, b) => String(a.last_updated || '').localeCompare(String(b.last_updated || '')));
}
