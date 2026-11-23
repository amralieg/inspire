// REQ-507 L4 (pure): the text and choices behind the Data and Filter pages of the value wizard. Every line is built from the structure the
// server returns (facts, scope, predicates), never from model text.
import { plural } from './plural.js';

export const SCOPE_ROUTE = '/api/inspire/value/scope';
export const FILTER_ROUTE = '/api/inspire/value/filter';
export const FILTER_EXAMPLES = [
  'Only include transactions from the last 1 year',
  'Exclude cancelled and test records',
  'Only the top 3 regions by volume',
  'Amount above 100 and status is completed',
  'Only customers who joined since 2024',
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const parts = (iso) => String(iso).slice(0, 10).split('-').map(Number);
const dateText = (iso) => { const [y, m, d] = parts(iso); return `${d} ${MONTHS[m - 1]} ${y}`; };
const isoOf = (ms) => new Date(ms).toISOString().slice(0, 10);

// The first day of the 12 months that end on `last`: one year back, plus a day (30 Sep 2026 gives 1 Oct 2025).
function twelveMonthsStart(last) {
  const [y, m, d] = parts(last);
  const back = new Date(Date.UTC(y - 1, m - 1, 1));
  const lastDay = new Date(Date.UTC(y - 1, m, 0)).getUTCDate();
  back.setUTCDate(Math.min(d, lastDay));
  return isoOf(back.getTime() + 86400000);
}
const monthsBetween = (first, last) => { const [fy, fm, fd] = parts(first); const [ly, lm, ld] = parts(last); return (ly - fy) * 12 + (lm - fm) + (ld >= fd ? 0 : -1); };
const dated = (facts) => Boolean(facts?.date_column && facts.first && facts.last);

export function factsLine(facts, noun = 'record') {
  const count = plural(facts?.rows ?? 0, noun);
  if (!dated(facts)) return `${count}, no date column found`;
  return `${count}, ${dateText(facts.first)} to ${dateText(facts.last)}, dated by ${facts.date_column}`;
}

export function scopeChoices(facts) {
  const long = dated(facts) && monthsBetween(facts.first, facts.last) > 15;
  const choices = [{ id: 'all', label: 'All data', recommended: !long }];
  if (dated(facts)) choices.push({ id: 'last_12', label: 'Last 12 months', recommended: long, start: twelveMonthsStart(facts.last), end: facts.last });
  choices.push({ id: 'filter', label: 'My own filter', recommended: false });
  return choices;
}

export const choiceDates = (c) => (c?.start ? `${dateText(c.start)} to ${dateText(c.end)}` : '');

export function scopeOfChoice(id, facts) {
  if (id !== 'all') return null;
  return { phrase: 'All data', filters: [], window: null, rows_before: facts.rows, rows_after: facts.rows, first: facts.first, last: facts.last };
}

export function filterBodyOfChoice(id, facts) {
  const base = { date_column: facts?.date_column || null, filters: [] };
  if (id === 'last_12' && dated(facts)) return { ...base, window: { column: facts.date_column, last_n: 12, unit: 'month' } };
  return { ...base, window: null };
}

const list = (values) => (values || []).join(' or ');
export function predicateText({ column, op, values = [] }) {
  switch (op) {
    case '=': return `${column} is ${list(values)}`;
    case '!=': return `${column} is not ${list(values)}`;
    case 'in': return `${column} is ${list(values)}`;
    case 'not in': return `${column} is not ${list(values)}`;
    case '>': return `${column} is above ${values[0]}`;
    case '>=': return `${column} is at least ${values[0]}`;
    case '<': return `${column} is below ${values[0]}`;
    case '<=': return `${column} is at most ${values[0]}`;
    case 'between': return `${column} is between ${values[0]} and ${values[1]}`;
    case 'is null': return `${column} is empty`;
    case 'is not null': return `${column} is not empty`;
    default: return `${column} ${op} ${values.join(' ')}`.trim();
  }
}

// The scope without one chip. The count is stale until the server counts again.
export function withoutPredicate(scope, index) {
  return { ...scope, filters: (scope.filters || []).filter((_, i) => i !== index), rows_after: null };
}

export function unmatchedLine({ phrase = '', column = '', close = [] } = {}) {
  if (!column && /\b(top|bottom|highest|lowest|first|last)\s+\d+/i.test(phrase)) {
    return `I could not apply '${phrase}': rank filters are not supported; name the regions or values to keep.`;
  }
  const names = column || phrase;
  return `I found no column for '${names}'.${close?.length ? ` Columns that look close: ${close.join(', ')}.` : ''}`;
}
