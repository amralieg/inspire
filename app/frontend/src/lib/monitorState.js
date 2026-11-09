import { formatClockUtc, formatWhen, utcDate } from './formatWhen.js';
import { COPY_SEND_LABEL, failureCauseOf, sendText, splitTechnical } from './plainText.js';

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

export function viewerLine(runInfo) {
  const note = String(runInfo?.viewer_note || '').trim();
  return note && !/[.!?]$/.test(note) ? `${note}.` : note;
}

export function runElapsedMs(runInfo, now) {
  const total = Number(runInfo?.run_duration);
  if (total > 0) return total;
  const start = Number(runInfo?.start_time);
  const end = Number(runInfo?.end_time);
  if (start > 0 && end >= start) return end - start;
  const execution = Number(runInfo?.execution_duration);
  if (execution > 0) return execution;
  if (start > 0 && !(end > 0) && Number.isFinite(now) && now >= start) return now - start;
  return null;
}

export function runTitle(runInfo, businessName) {
  const business = String(businessName || '').trim() || 'Inspire run';
  const started = Number(runInfo?.start_time) > 0 ? formatWhen(Number(runInfo.start_time)) : '';
  return started ? `${business}, started ${started}` : business;
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

const RUN_TERMINAL = new Set(['TERMINATED', 'INTERNAL_ERROR', 'SKIPPED']);

export function runEnded(runInfo) {
  return RUN_TERMINAL.has(String(runInfo?.life_cycle_state || ''));
}

export function runStopped(runInfo) {
  return runEnded(runInfo) && ['CANCELED', 'CANCELLED', 'UPSTREAM_CANCELED'].includes(String(runInfo?.result_state || ''));
}

export function runEndedBadly(runInfo) {
  return runEnded(runInfo) && !runStopped(runInfo) && String(runInfo?.result_state || '') !== 'SUCCESS';
}

export const RUN_FAILED_TEXT = 'The run failed, so open the run log to see which step stopped it.';
const RESULT_TEXT = {
  TIMEDOUT: 'The run went past its time limit and Databricks stopped it, so open the run log to see which step was still going.',
  MAXIMUM_CONCURRENT_RUNS_REACHED: 'Databricks did not start the run because another run of the same job was still going, so wait for that run to end and start this one again.',
  SKIPPED: 'Databricks skipped the run and it read nothing, so start a new run on the Start page.',
};

const PROGRAM_FAULT = /\b[A-Z]\w*(?:Error|Exception)\b|Traceback|File "/;

export function runFailureText(runInfo) {
  const failedTask = (runInfo?.tasks || []).find((t) => t.result_state && t.result_state !== 'SUCCESS') || null;
  const platform = String(runInfo?.state_message || '').trim();
  const raw = [String(failedTask?.error || failedTask?.state_message || '').trim()].filter((s) => s && s !== platform);
  const known = RESULT_TEXT[String(runInfo?.result_state || '')] || (runInfo?.life_cycle_state === 'SKIPPED' ? RESULT_TEXT.SKIPPED : '');
  if (known) return { text: known, details: raw };
  const caused = [...raw, platform].find((s) => s && failureCauseOf(s));
  if (caused) return { text: `The run failed: ${caused}`, details: raw.filter((s) => s !== caused) };
  const said = raw.find((s) => !PROGRAM_FAULT.test(s));
  if (said) return { text: said, details: raw.filter((s) => s !== said) };
  if (raw.length) return { text: RUN_FAILED_TEXT, details: raw };
  return { text: platform && !PROGRAM_FAULT.test(platform) ? platform : RUN_FAILED_TEXT, details: [] };
}

export const POLL_GIVE_UP_AFTER = 15;
export const RUN_GONE_TEXT = 'This run no longer exists in Databricks, so start a new run on the Start page.';

export function pollFailure(error, failures) {
  const message = String(error?.message || error || '').trim();
  const cause = failureCauseOf(message);
  const transient = error?.status === undefined || Boolean(cause?.transient) || [429, 502, 503, 504].includes(error?.status);
  if (transient && failures < POLL_GIVE_UP_AFTER) {
    return { stop: false, transient, text: 'Inspire cannot reach this run right now and checks again every few seconds.', details: message ? [message] : [] };
  }
  if (error?.status === 404) return { stop: true, transient, text: RUN_GONE_TEXT, details: message ? [message] : [] };
  const text = transient ? `Inspire stopped checking this run after ${failures} tries: ${message}` : `Inspire cannot check this run: ${message}`;
  return { stop: true, transient, text, details: [] };
}

export const CHECK_AGAIN_LABEL = 'Check again';

export const RUN_AGAIN_LABEL = 'Run again';

export function monitorFailureChoices({ cannotRead = false, runUrl = '', canRunAgain = false } = {}) {
  return [
    canRunAgain && !cannotRead && { id: 'again', label: RUN_AGAIN_LABEL, detail: 'Starts this run again with the same settings, in a new session.' },
    cannotRead && { id: 'read', label: CHECK_AGAIN_LABEL, detail: 'Once you have access, Inspire reads this run again.' },
    runUrl && { id: 'open', label: 'Open the run in Databricks', url: runUrl, detail: 'The run page shows the full error and every task.' },
    { id: 'copy', label: COPY_SEND_LABEL, detail: cannotRead ? 'Copies the run and what Inspire could not read, to send to the person who started it.' : 'Copies the run and its error, to send to whoever looks after Inspire.' },
  ].filter(Boolean);
}

export function monitorSendText({ label = '', detail = '', details: more = [], runId = '', sessionId = '', runUrl = '' } = {}) {
  const { plain, details } = splitTechnical(detail);
  const about = [runId && `Run ${runId}`, sessionId && `session ${sessionId}`].filter(Boolean).join(', ');
  return sendText([label && `${label}${about ? ` (${about})` : ''}`, plain].filter(Boolean).join(': '), [...details, ...more, runUrl].filter(Boolean));
}
