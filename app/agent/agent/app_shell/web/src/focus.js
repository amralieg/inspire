// REQ-542: the pure rules of the One-by-One wizard. The App renders page.focus_spec; nothing here calls a model.
import { DEFAULT_ACTIONS } from './focusSpec.js';
import { resolveWorkMode } from './onboarding.js';
import { DISMISSED, DONE, statusKind } from './records.js';

const CLAUSE = /^\s*([A-Za-z_][\w]*)\s*(=|!=|>=|<=|>|<)\s*('([^']*)'|"([^"]*)"|-?\d+(?:\.\d+)?)\s*$/;
const num = (v) => (v === null || v === '' || typeof v === 'boolean' ? NaN : Number(v));

// queue.filter is "column op value" clauses joined by AND. The column "status" reads the record's action status when the row has no such column.
function clauseTest(text) {
  const m = CLAUSE.exec(text);
  if (!m) return () => true;
  const [, column, op, raw, single, double] = m;
  const quoted = single ?? double;
  const want = quoted ?? Number(raw);
  return (row) => {
    const have = column === 'status' && !Object.prototype.hasOwnProperty.call(row, 'status') ? statusKind(row._inspire_status) : row[column];
    if (have == null) return false;
    const both = typeof want === 'number' && Number.isFinite(num(have));
    const a = both ? num(have) : String(have);
    const b = both ? want : String(want);
    return { '=': a === b, '!=': a !== b, '>': a > b, '<': a < b, '>=': a >= b, '<=': a <= b }[op];
  };
}

export function queueOf(rows, queue) {
  const tests = String(queue?.filter || '').split(/\s+AND\s+/i).filter((t) => t.trim()).map(clauseTest);
  const kept = (Array.isArray(rows) ? rows : []).filter((r) => r && tests.every((t) => t(r)));
  const column = queue?.order?.column;
  if (!column) return kept;
  const sign = queue.order.direction === 'asc' ? 1 : -1;
  const value = (r) => r[column];
  return kept.map((r, i) => ({ r, i })).sort((x, y) => {
    const a = value(x.r);
    const b = value(y.r);
    if (a == null || b == null) return a == null && b == null ? x.i - y.i : a == null ? 1 : -1;
    const an = num(a);
    const bn = num(b);
    const c = Number.isFinite(an) && Number.isFinite(bn) ? an - bn : String(a).localeCompare(String(b));
    return c * sign || x.i - y.i;
  }).map((x) => x.r);
}

// 2 to 5 steps and the last one decides; anything else is not a wizard, so the page keeps its list.
export function stepsOf(spec) {
  const steps = spec?.steps;
  if (!Array.isArray(steps) || steps.length < 2 || steps.length > 5) return [];
  return steps.at(-1)?.kind === 'decide' ? steps : [];
}

export function decideChoices(spec, allowed) {
  const list = spec?.decide?.choices ?? spec?.choices;
  const ok = new Set(allowed == null ? DEFAULT_ACTIONS : allowed);
  return Array.isArray(list) ? list.filter((c) => ok.has(c?.action)) : [];
}

// log: [{ key, action }] where action 'skip' is a skipped item.
export function summaryOf(log) {
  const out = { skipped: 0, total: 0 };
  for (const entry of log || []) {
    const name = entry.action === 'skip' ? 'skipped' : entry.action;
    out[name] = (out[name] || 0) + 1;
    out.total += 1;
  }
  return out;
}

export const modeOf = (prefs, count) => resolveWorkMode(prefs || {}, count);

// What records/act is sent for a decide choice. The note is the owner, the reason or the date, per action (shell_actions.record_values).
export const NOTE_FIELDS = { assign: ['Assign to', 'text', 'action_owner'], not_an_issue: ['Reason', 'text', 'dismiss_reason'], snooze: ['Snooze until', 'date', 'snooze_until'] };
export function actionValues(action, note = '') {
  if (action === 'done') return note ? { action_status: DONE, action_note: note } : { action_status: DONE };
  if (action === 'not_an_issue') return { action_status: DISMISSED, dismiss_reason: note };
  const field = NOTE_FIELDS[action]?.[2];
  return field ? { [field]: note } : {};
}

// The drawer sits on top of the page (a modal dialog), so its own toggle asks the page to go back to One by one with this event.
export const FOCUS_MODE = 'inspire:focus-mode';
