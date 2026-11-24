// Pure helpers for the Agent page's answer blocks: no React, so the node tests can load them.
import { wholeMoney } from './format.js';
// The server validates every block (shell_blocks.py); these helpers only shape what the page shows and sends.

// Every action the Agent page offers. Record actions go through records/act with the confirm card; app actions
// (run again, set target) go through their own route after the same confirm card. The server builds each write.
export const AGENT_ACTIONS = {
  done: 'Mark done', snooze: 'Snooze', assign: 'Assign', skip: 'Skip', not_an_issue: 'Mark not an issue', reopen: 'Reopen',
  override: 'Override with a reason', add_note: 'Add note', set_target: 'Set target', run_again: 'Run again',
};
export const AGENT_ACTION_IDS = Object.keys(AGENT_ACTIONS);
export const ACTION_FIELDS = {
  done: [], snooze: ['until'], assign: ['owner'], skip: [], not_an_issue: ['reason'], reopen: [],
  override: ['status', 'reason'], add_note: ['note'], set_target: ['value'], run_again: [],
};
export const actionLabel = (id) => AGENT_ACTIONS[id] || id;

// Values the action needs before the confirm card can be prepared. Each field has its own message.
const MISSING = {
  until: 'Pick the day to snooze until.', owner: 'Name the person to assign it to.', reason: 'Give the reason.',
  status: 'Pick the status to set.', note: 'Write the note.', value: 'Give the target as a number.',
};
export function valuesFor(action, input = {}) {
  const values = {};
  for (const f of ACTION_FIELDS[action] || []) {
    const v = String(input[f] ?? '').trim();
    if (!v) return { error: MISSING[f] || 'Fill in every field.' };
    values[f] = v;
  }
  return { values };
}

export const askText = (option) => option?.ask || option?.label || '';

// A multi-select submit: the ask text plus the picked labels, in the order the options were shown.
export function multiAsk(block, pickedIds) {
  const picked = (block.options || []).filter((o) => pickedIds.includes(o.id));
  const lead = block.ask || block.prompt || 'Use these';
  return picked.length ? `${lead} ${picked.map((o) => o.label).join(', ')}`.trim() : '';
}

export function multiValid(block, pickedIds) {
  const n = pickedIds.length;
  return n >= (block.min || 0) && n <= (block.max || block.options.length);
}

// The text a person copies from an email block: a subject line, a blank line, then the body.
export const copyText = (email) => `Subject: ${email.subject || ''}\n\n${email.body || ''}`.trim();

export const ticketKey = (ticket) => String(ticket?.record_key || '');

// Table columns: the page's own column labels, falling back to the column id.
export function columnHeads(page, columns = []) {
  const declared = (page?.records?.columns || []).reduce((acc, c) => ({ ...acc, [c.column]: c.label || c.column }), {});
  return columns.map((id) => ({ id, label: declared[id] || id }));
}

// The KPI tile's name: the page's KPI label when it has one, else the id.
export function kpiName(page, kpiId) {
  const kpi = (page?.kpis || []).find((k) => k.id === kpiId);
  return kpi?.label || kpiId;
}

export function chartOf(page, chartId) {
  return (page?.charts || []).find((c) => c.id === chartId) || null;
}

// The briefing: the top tickets, all visible at once (the server already grounded their values in the records).
export function briefingBlocks(briefing) {
  return (briefing?.tickets || []).map((t) => ({ ...t, type: 'ticket' }));
}

// A sent question is an ordinary turn on the agent: the same request, with the surface flag set.
export const askBody = (pageId, question, history = []) => ({
  page: pageId, question, surface: 'agent', history: history.slice(-6).map((h) => ({ question: h.question, answer: h.answer || '' })),
  view: {}, visible: [],
});

// The App's currency for value at stake: the decision list's own currency, from its money column. Empty when the App names none.
export function stakeCurrency(page) {
  const cols = page?.records?.columns || [];
  return page?.records?.currency || cols.find((c) => c.currency)?.currency || '';
}

// Value at stake in the App's currency, through the shared formatter. A value that is not a number is shown as given.
export function stakeText(value, page) {
  if (value == null || value === '') return '';
  const n = Number(value);
  return Number.isFinite(n) ? wholeMoney(n, stakeCurrency(page), 'money') : String(value);
}
