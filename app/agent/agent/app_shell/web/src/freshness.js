import { NOT_RECORDED, asDate, cap, dayLabel, formatValue, integer, kindOf, numberOf, stakeName, unitOf } from './format.js';
import { listText } from './links.js';
import { plural, shortDay, tickOf } from './hub.js';

export const POLL_MS = 10000;
export const RUNS_PAGE = 20;
export const BUSY = 'Refreshing all the data';
const MINUTE = 60 * 1000;
const STATES = {
  done: ['Done', 'ok'], failed: ['Failed', 'bad'], running: ['Running', 'neutral'], queued: ['Waiting to start', 'neutral'],
  canceled: ['Canceled', 'neutral'], skipped: ['Skipped', 'warn'], unfinished: ['Not finished', 'warn'],
};
const TRIGGERS = { schedule: 'Scheduled', refresh: 'Refresh now', build: 'Build' };
const STAMP = { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' };
const RUN_ERRORS = {
  missing_table: 'A table this use case reads is missing',
  missing_column: 'A column this use case reads is missing',
  not_allowed: 'The job is not allowed to read data it needs',
  timed_out: 'The run took longer than its time limit and was stopped',
  no_compute: 'The computer that runs the job could not start',
};

const stampOf = (value) => (value == null || value === '' ? null : asDate(value));

export function agoText(value, now = Date.now()) {
  const d = stampOf(value);
  if (!d) return '';
  const gap = Math.max(0, now - d.getTime());
  if (gap < MINUTE) return 'just now';
  if (gap < 60 * MINUTE) return `${Math.floor(gap / MINUTE)} min ago`;
  if (gap < 24 * 60 * MINUTE) return `${Math.floor(gap / (60 * MINUTE))} h ago`;
  const days = Math.floor(gap / (24 * 60 * MINUTE));
  return days < 14 ? `${days} day${days === 1 ? '' : 's'} ago` : `on ${dayLabel(d.toISOString().slice(0, 10))}`;
}

export function spanText(seconds) {
  if (seconds == null || !Number.isFinite(Number(seconds))) return '';
  const s = Math.max(0, Math.round(Number(seconds)));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}

export function stampText(value, now = Date.now()) {
  const d = stampOf(value);
  if (!d) return '';
  const year = d.getUTCFullYear() === new Date(now).getUTCFullYear() ? {} : { year: 'numeric' };
  return `${new Intl.DateTimeFormat('en-US', { ...STAMP, ...year }).format(d)} UTC`;
}

export function bannerText(fresh, now = Date.now(), showThrough = true) {
  if (!fresh) return '';
  const last = fresh.last_success;
  const through = showThrough && fresh.data_through ? ` · data through ${dayLabel(fresh.data_through)}` : '';
  const when = last ? stampText(last.ended || last.started, now) : '';
  return `${when ? `Updated ${when}` : 'Not updated yet'}${through}`;
}

export function untilText(fresh, now = Date.now()) {
  const last = fresh?.last_success;
  const when = last ? stampText(last.ended || last.started, now) : '';
  return when ? `Until it finishes you see the data of the update on ${when}` : '';
}

function forText(started, now) {
  const seconds = Math.max(0, (now - started.getTime()) / 1000);
  return seconds < 60 ? 'under a minute' : spanText(Math.floor(seconds / 60) * 60);
}

const typicalText = (seconds) => (seconds ? `, usually about ${spanText(seconds < 60 ? seconds : Math.round(seconds / 60) * 60)}` : '');

export function progressText(active, now = Date.now(), typical = null) {
  const d = stampOf(active?.started);
  const verb = active?.result === 'queued' ? 'waiting in the queue' : 'running';
  return `${d ? `${verb} for ${forText(d, now)}` : verb}${typicalText(typical)}`;
}

const known = (v) => v != null && v !== '' && Number.isFinite(Number(v));

export const isQuiet = (active) => !!active?.silent_since;

export function progressShare(active) {
  if (isQuiet(active) || !known(active?.percent)) return null;
  return Math.max(0, Math.min(100, Number(active.percent)));
}

const etaText = (seconds) => (seconds < 60 ? 'under a minute left' : `about ${spanText(Math.round(seconds / 60) * 60)} left`);

export function stepText(active, now = Date.now(), typical = null) {
  if (isQuiet(active)) return String(active.message || '').trim() || 'No news from this run. It may have stopped.';
  const parts = [];
  const at = Number(active?.stage_index);
  const of = Number(active?.stage_total);
  const stage = String(active?.stage ?? '').trim();
  if (Number.isInteger(at) && Number.isInteger(of) && at > 0 && of >= at) parts.push(`Step ${integer(at)} of ${integer(of)}${stage ? `: ${stage}` : ''}`);
  else if (stage) parts.push(stage);
  if (known(active?.rows_done) && known(active?.rows_total) && numberOf(active.rows_total) > 0) {
    parts.push(`${integer(active.rows_done)} of ${integer(active.rows_total)} rows`);
  } else if (known(active?.rows_done)) parts.push(`${integer(active.rows_done)} ${numberOf(active.rows_done) === 1 ? 'row' : 'rows'}`);
  if (!parts.length) return progressText(active, now, typical);
  parts.push(known(active?.eta_s) && Number(active.eta_s) >= 0 ? etaText(Number(active.eta_s)) : progressText(active, now, typical));
  return parts.join(' · ');
}

export function stepsText(stages) {
  return (Array.isArray(stages) ? stages : []).filter((s) => String(s?.stage ?? '').trim() && known(s?.spent_s)).map((s) => {
    const rows = known(s.rows_total) && numberOf(s.rows_total) > 0 ? ` for ${integer(s.rows_total)} ${numberOf(s.rows_total) === 1 ? 'row' : 'rows'}` : '';
    return `${String(s.stage).trim()}: ${spanText(s.spent_s)}${rows}`;
  });
}

export const OPEN_RUN = 'Open the run';
export const CHECK_AGAIN = 'Check again';
export const SEE_CHANGES = 'See what changed';
export const RUN_STATES = {
  running: { heading: BUSY, tone: 'progress', action: '' },
  queued: { heading: 'Waiting for the refresh to start', tone: 'progress', action: '' },
  quiet: { heading: 'The refresh has gone quiet', tone: 'warn', action: OPEN_RUN },
  succeeded: { heading: 'Refreshed', tone: 'fact', action: SEE_CHANGES },
  failed: { heading: 'The latest run failed', tone: 'bad', action: '' },
  canceled: { heading: 'The latest run was stopped before it finished', tone: 'fact', action: '' },
  skipped: { heading: 'The job skipped the latest run, most often because another run of it was still going', tone: 'fact', action: '' },
  unknown: { heading: 'The latest run never said it finished', tone: 'fact', action: '' },
};
const OTHER_END = { heading: 'The App cannot tell how the latest run ended', tone: 'fact', action: '' };

export const runState = (key) => ({ key, ...(Object.hasOwn(RUN_STATES, key) ? RUN_STATES[key] : OTHER_END) });

export const activeState = (active) => runState(isQuiet(active) ? 'quiet' : active?.result === 'queued' ? 'queued' : 'running');

export const toastTone = (tone) => (tone === 'bad' ? 'error' : 'info');

export function lastRunText(run) {
  const result = String(run?.result || '');
  const { heading, tone } = runState(result);
  const message = String(run?.message || '').trim();
  return { result, tone, text: message ? `${heading}: ${message}` : heading };
}

export function lastRunNote(fresh) {
  const run = fresh?.last_run;
  if (!run || run.result === 'succeeded') return null;
  const last = fresh.last_success;
  if (last) {
    const ran = stampOf(run.started);
    const ok = stampOf(last.ended || last.started);
    if (!(ran && ok && ran > ok)) return null;
  }
  return lastRunText(run);
}

export function runFlag(status) {
  const [text, tone] = STATES[status] || ['Not recorded', 'neutral'];
  return { text, tone };
}

export const triggerText = (trigger) => TRIGGERS[trigger] || cap(trigger) || 'Not recorded';

export function coveredText(segments) {
  if (segments == null) return 'Not recorded';
  if (!segments.length) return 'All data';
  return segments.map((s) => `${s.label}: ${listText(s.values, s.values.length + (s.more || 0))}`).join('; ');
}

export function groupingText(grouping) {
  if (!grouping || grouping.groups == null) return '';
  if (grouping.mode === 'all') return 'Data groups: all records as one group';
  const levels = (grouping.levels || []).filter((l) => l.level && l.groups != null);
  const shown = levels.length > 1 ? ` (${levels.map((l) => `${integer(l.groups)} by ${l.level}`).join(', ')})` : '';
  return `Data groups: ${plural(grouping.groups, 'group')} by ${(grouping.group_by || []).join(', ')}${shown}`;
}

export function lastedText(run, now = Date.now()) {
  const started = stampOf(run?.started);
  if (started && (run.status === 'running' || run.status === 'queued')) return `${run.status === 'queued' ? 'waiting' : 'running'} for ${forText(started, now)}`;
  return spanText(run?.duration_s);
}

export function errorText(run) {
  const detail = String(run?.error || '').trim();
  if (run?.status === 'canceled') return { lead: 'The run was stopped before it finished', detail };
  if (run?.status === 'skipped') return { lead: 'The job skipped this run, most often because another run of it was still going', detail };
  const code = String(run?.error_code || '');
  return { lead: Object.hasOwn(RUN_ERRORS, code) ? RUN_ERRORS[code] : 'The run stopped with an error', detail };
}

export const STOPPED = ['failed', 'canceled', 'skipped'];

export function latestRunText(run, now = Date.now()) {
  if (!run) return 'No run is recorded yet.';
  const when = stampText(run.started, now);
  const head = `Latest run${when ? `, ${when}` : ''}: ${runFlag(run.status).text}.`;
  const body = STOPPED.includes(run.status) ? `${errorText(run).lead}.` : run.status === 'done' ? foundText(run) : '';
  return [head, body].filter(Boolean).join(' ');
}

export const runKey = (run) => run.run_id || `job-${run.job_run_id}`;

export function runBars(runs, now = Date.now()) {
  const counted = (runs || []).filter((r) => r.to_fix != null).reverse();
  return counted.map((r, i) => ({
    key: runKey(r), label: stampText(r.started, now) || NOT_RECORDED, value: r.to_fix, text: integer(r.to_fix),
    tick: tickOf(shortDay(r.started) || NOT_RECORDED, i, counted.length),
  }));
}

export function runsPageText(offset, shown, total) {
  if (!total) return 'No runs';
  if (!shown) return `No runs on this page; there are ${integer(total)}`;
  return `Runs ${integer(offset + 1)} to ${integer(offset + shown)} of ${integer(total)}`;
}

export function couldSaveRunFormula(run) {
  if (run.could_save == null) return '';
  const fix = run.to_fix == null ? 'its things to fix' : `its ${plural(run.to_fix, 'thing')} to fix`;
  return `${stakeName(unitOf(run), kindOf(run))} on ${fix} in Act now and Review, added up when the run ended = ${formatValue(run.could_save, unitOf(run) ? 'currency' : 'number', unitOf(run), undefined, kindOf(run))}`;
}

export function foundText(run) {
  const saving = run.could_save == null ? '' : ` that could save ${formatValue(run.could_save, unitOf(run) ? 'currency' : 'number', unitOf(run), undefined, kindOf(run))}`;
  const counted = run.to_fix ? `${integer(run.to_fix)} thing${run.to_fix === 1 ? '' : 's'} to fix${saving}.` : run.to_fix === 0 ? 'Nothing to fix.' : '';
  const lead = [run.summary, run.nothing_to_act].filter(Boolean).join(' ') || counted;
  const covered = run.segments == null ? '' : run.segments.length ? `It covered ${coveredText(run.segments)}` : 'It covered all the data';
  const records = run.records ? `${integer(run.records)} record${run.records === 1 ? '' : 's'}` : '';
  const tail = covered && records ? `${covered}, ${records}.` : covered ? `${covered}.` : records ? `It checked ${records}.` : '';
  return [lead, tail].filter(Boolean).join(' ') || 'This run recorded nothing about what it found.';
}

export function backendText(backend, now = Date.now()) {
  if (backend?.kind !== 'lakebase') return '';
  const synced = agoText(backend.synced_at, now);
  return synced ? `Read from Lakebase, synced ${synced}` : 'Read from Lakebase';
}

export function backendNotes(backend, data) {
  const out = [];
  if (backend?.note) out.push(backend.note);
  if (data?.catching_up) out.push('Showing your latest changes from Delta tables until Lakebase syncs them, usually within a few minutes');
  return out;
}
