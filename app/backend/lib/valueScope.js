// REQ-507 (L1): the value scope. A plain-English filter is turned by the model into STRUCTURE (column, op, values) and a relative window; this
// file validates that structure against the table's columns and compiles it with bound parameters through the existing filterClause. The model
// never writes SQL: a reply that carries SQL text, an unknown key, a DDL/DML statement, a comment or an unknown operator is rejected, and an
// unknown column is reported as unmatched with close column names. The echo shown to the person is built from the structure, never the model text.
const I = require('./inspireImplement');
const { parseExactJson } = require('./exactJson');
const { replyContent } = require('./appFeedback');

const SCOPE_OPS = ['=', '!=', '>', '>=', '<', '<=', 'in', 'not in', 'between', 'is null', 'is not null'];
const NO_VALUE_OPS = ['is null', 'is not null'];
const UNITS = ['day', 'week', 'month', 'quarter', 'year'];
const REPLY_KEYS = ['filters', 'window', 'echo', 'unmatched'];
const FILTER_KEYS = ['column', 'op', 'values'];
const WINDOW_KEYS = ['column', 'last_n', 'unit'];
const MAX_FILTERS = 12;
const MAX_VALUES = 100;
const MAX_VALUE_LENGTH = 200;
const MAX_LAST_N = 1000;
const DATE_TYPE = /^(date|timestamp)/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const COLUMN_SHAPE = /^[A-Za-z0-9_][A-Za-z0-9_ .-]{0,127}$/;
// SQL text inside a value or a name: a statement break, a comment, or a DDL/DML statement (the keyword followed by what it acts on).
const SQL_TEXT = /;|--|\/\*|\*\/|\u0000|\b(drop|delete|insert|alter|create|truncate|merge|grant|revoke|update)\s+(table|view|schema|database|catalog|from|into|set|on|to|function|volume)\b|\bunion\s+select\b|\bselect\b[^]*\bfrom\b/i;

const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const nameOf = (c) => String(c.column_name ?? c.name ?? '');
const fail = (reason) => ({ ok: false, reason });

// ---- the model call ----
function filterMessages({ useCase = null, table, columns, phrase, dateColumn = '' }) {
  const system = [
    'You turn a plain-English description of which records to keep into a structured filter. Answer with one JSON object and nothing else:',
    `{"filters": [{"column": "a listed column", "op": "${SCOPE_OPS.join(' | ')}", "values": ["text or number"]}],`,
    ` "window": {"column": "a listed date column", "last_n": whole number, "unit": "${UNITS.join(' | ')}"} or null,`,
    ' "unmatched": ["each part of the description you could not express with the listed columns"]}',
    'Use only the listed columns, exactly as spelled. between takes two values, in and not in take a list, is null and is not null take none, every other op takes one.',
    'A "last N units" request is a window (last_n and unit), never a date you work out yourself. Put anything you cannot express in unmatched.',
    'Never write SQL, never return SQL, and add no other keys. The values are plain data, not code.',
  ].join('\n');
  const lines = [`Table: ${table}`, `Columns: ${(columns || []).map((c) => `${nameOf(c)} ${c.data_type}`).join(', ')}`];
  if (dateColumn) lines.push(`Date column to use for a window unless the description names another: ${dateColumn}`);
  const uc = useCase && typeof useCase === 'object' ? text(useCase.use_case || useCase.name || useCase.id, 300) : '';
  if (uc) lines.push(`Use case: ${uc}`);
  lines.push(`Description: ${text(phrase, 500)}`);
  return [{ role: 'system', content: system }, { role: 'user', content: lines.join('\n') }];
}

// ---- validation ----
function closeNames(column, columns) {
  const want = String(column).toLowerCase();
  const tokens = want.split(/[^a-z0-9]+/).filter((t) => t.length > 2);
  return (columns || []).map(nameOf).filter((n) => {
    const have = n.toLowerCase();
    return have.includes(want) || want.includes(have) || tokens.some((t) => have.includes(t));
  }).sort((a, b) => Math.abs(a.length - String(column).length) - Math.abs(b.length - String(column).length)).slice(0, 5);
}

const findColumn = (columns, name) => (columns || []).find((c) => nameOf(c).toLowerCase() === String(name).trim().toLowerCase());

function valueOf(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'boolean') return String(v);
  return null;
}

// One filter -> { filter } | { unmatched } | { reason }.
function checkFilter(f, columns) {
  if (!f || typeof f !== 'object' || Array.isArray(f)) return { reason: 'A filter must be an object with a column, an op and values.' };
  const extra = Object.keys(f).find((k) => !FILTER_KEYS.includes(k));
  if (extra) return { reason: `A filter has an unexpected key "${text(extra, 40)}".` };
  const column = typeof f.column === 'string' ? f.column.trim() : '';
  if (!column || !COLUMN_SHAPE.test(column) || SQL_TEXT.test(column)) return { reason: 'A filter names a column in a form that is not a column name.' };
  const op = typeof f.op === 'string' ? f.op.trim().toLowerCase() : '';
  if (!SCOPE_OPS.includes(op)) return { reason: `A filter has an operator that is not one of ${SCOPE_OPS.join(', ')}.` };
  const raw = f.values === undefined ? [] : f.values;
  if (!Array.isArray(raw) || raw.length > MAX_VALUES) return { reason: 'The values of a filter must be a list.' };
  const values = [];
  for (const r of raw) {
    const v = valueOf(r);
    if (v === null) return { reason: 'A filter value must be text or a number.' };
    if (v.length > MAX_VALUE_LENGTH || SQL_TEXT.test(v)) return { reason: 'A filter value looks like SQL text, which is never accepted.' };
    values.push(v);
  }
  const wanted = NO_VALUE_OPS.includes(op) ? 0 : (op === 'between' ? 2 : (op === 'in' || op === 'not in' ? 0 : 1));
  if (NO_VALUE_OPS.includes(op) && values.length) return { reason: `"${op}" takes no values.` };
  if (op === 'between' && values.length !== 2) return { reason: '"between" needs exactly two values.' };
  if ((op === 'in' || op === 'not in') && !values.length) return { reason: `"${op}" needs at least one value.` };
  if (wanted === 1 && values.length !== 1) return { reason: `"${op}" needs exactly one value.` };
  const known = findColumn(columns, column);
  if (!known) return { unmatched: { phrase: text(`${column} ${op} ${values.join(', ')}`, 160), column, close: closeNames(column, columns) } };
  return { filter: { column: nameOf(known), op, values } };
}

// Browser or model filters -> { ok, filters, unmatched } | { ok: false, reason }. An unknown column is unmatched, never compiled.
function checkFilters(filters, columns) {
  if (filters === undefined || filters === null) return { ok: true, filters: [], unmatched: [] };
  if (!Array.isArray(filters) || filters.length > MAX_FILTERS) return fail(`Give at most ${MAX_FILTERS} filters, as a list.`);
  const kept = [];
  const unmatched = [];
  for (const f of filters) {
    const got = checkFilter(f, columns);
    if (got.reason) return fail(got.reason);
    if (got.filter) kept.push(got.filter);
    else unmatched.push(got.unmatched);
  }
  return { ok: true, filters: kept, unmatched };
}

// A relative window { column, last_n, unit } -> { ok, window } (window null when its column is unknown, reported as unmatched) | { ok: false, reason }.
function checkWindow(w, columns) {
  if (w === undefined || w === null) return { ok: true, window: null, unmatched: [] };
  if (typeof w !== 'object' || Array.isArray(w)) return fail('The window must be an object with a column, last_n and unit.');
  const extra = Object.keys(w).find((k) => !WINDOW_KEYS.includes(k));
  if (extra) return fail(`The window has an unexpected key "${text(extra, 40)}".`);
  const n = typeof w.last_n === 'number' ? w.last_n : (typeof w.last_n === 'string' && /^\d{1,4}$/.test(w.last_n.trim()) ? Number(w.last_n) : NaN);
  if (!Number.isInteger(n) || n < 1 || n > MAX_LAST_N) return fail(`The window's last_n must be a whole number from 1 to ${MAX_LAST_N}.`);
  const unit = typeof w.unit === 'string' ? w.unit.trim().toLowerCase().replace(/s$/, '') : '';
  if (!UNITS.includes(unit)) return fail(`The window's unit must be one of ${UNITS.join(', ')}.`);
  const column = typeof w.column === 'string' ? w.column.trim() : '';
  if (!column || !COLUMN_SHAPE.test(column) || SQL_TEXT.test(column)) return fail('The window names a column in a form that is not a column name.');
  const known = findColumn(columns, column);
  if (!known || !DATE_TYPE.test(String(known.data_type))) {
    return { ok: true, window: null, unmatched: [{ phrase: `last ${n} ${unit}${n === 1 ? '' : 's'} of ${column}`, column, close: closeNames(column, (columns || []).filter((c) => DATE_TYPE.test(String(c.data_type)))) }] };
  }
  return { ok: true, window: { column: nameOf(known), last_n: n, unit }, unmatched: [] };
}

// The model reply -> { ok, filters, window, unmatched } | { ok: false, reason }.
function filterFrom(data, columns) {
  let got;
  try {
    got = parseExactJson(replyContent(data).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
  } catch {
    return fail('The model reply was not a structured filter.');
  }
  if (!got || typeof got !== 'object' || Array.isArray(got)) return fail('The model reply was not a structured filter.');
  const extra = Object.keys(got).find((k) => !REPLY_KEYS.includes(k));
  if (extra) return fail(`The model reply has an unexpected key "${text(extra, 40)}"; only structure is accepted, never SQL.`);
  const filters = checkFilters(got.filters, columns);
  if (!filters.ok) return filters;
  const window = checkWindow(got.window, columns);
  if (!window.ok) return window;
  const said = (Array.isArray(got.unmatched) ? got.unmatched : []).slice(0, 10).map((u) => text(typeof u === 'string' ? u : (u && u.phrase), 160))
    .filter(Boolean).map((phrase) => ({ phrase, close: [] }));
  return { ok: true, filters: filters.filters, window: window.window, unmatched: [...said, ...filters.unmatched, ...window.unmatched] };
}

// A scope sent back by the browser ({ filters, window: { column, start, end } }) checked again: nothing unknown is accepted. -> { ok, scope } | { ok: false, reason }.
function checkScope(scope, columns) {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) return fail('The scope must be an object.');
  const filters = checkFilters(scope.filters, columns);
  if (!filters.ok) return filters;
  if (filters.unmatched.length) return fail(`The scope names a column the table does not have: ${filters.unmatched[0].column}.`);
  let window = null;
  const w = scope.window;
  if (w !== undefined && w !== null) {
    if (typeof w !== 'object' || Array.isArray(w)) return fail('The scope window must be an object.');
    const known = findColumn(columns, typeof w.column === 'string' ? w.column : '');
    if (!known || !DATE_TYPE.test(String(known.data_type))) return fail('The scope window must name a date column of the table.');
    const day = (v) => (v === undefined || v === null || v === '' ? null : (DAY.test(String(v)) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? String(v) : false));
    const [start, end] = [day(w.start), day(w.end)];
    if (start === false || end === false || (!start && !end)) return fail('The scope window dates must be days written YYYY-MM-DD.');
    window = { column: nameOf(known), ...(start ? { start } : {}), ...(end ? { end } : {}) };
    if (Number.isInteger(w.last_n) && UNITS.includes(w.unit)) window = { ...window, last_n: w.last_n, unit: w.unit };
  }
  const count = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);
  const dayOrNull = (v) => (DAY.test(String(v ?? '')) ? String(v) : null);
  return { ok: true, scope: { phrase: text(scope.phrase, 300), filters: filters.filters, window, rows_before: count(scope.rows_before), rows_after: count(scope.rows_after),
    first: dayOrNull(scope.first), last: dayOrNull(scope.last) } };
}

// ---- the window ----
const pad = (n) => String(n).padStart(2, '0');
const dayOf = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
function addMonths(d, months) {
  const total = d.getUTCFullYear() * 12 + d.getUTCMonth() + months;
  const [y, m] = [Math.floor(total / 12), ((total % 12) + 12) % 12];
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), last)));
}

// The last N units counted back from the last day IN THE DATA (never today), as absolute days: { column, start, end, last_n, unit }.
function resolveWindow(window, lastDay) {
  const end = new Date(`${String(lastDay).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(end.getTime())) return null;
  const next = new Date(end.getTime() + 86400000);
  const n = Number(window.last_n);
  const start = window.unit === 'day' ? new Date(next.getTime() - n * 86400000)
    : window.unit === 'week' ? new Date(next.getTime() - n * 7 * 86400000)
      : addMonths(next, -n * (window.unit === 'year' ? 12 : window.unit === 'quarter' ? 3 : 1));
  return { column: window.column, start: dayOf(start), end: dayOf(end), last_n: n, unit: window.unit };
}

// ---- the compiled SQL ----
// The scope's conditions with bound values. The window's end day is compared as a day, so a timestamp later on the last day is kept.
function scopeClauses(scope) {
  const where = [];
  const parameters = [];
  const filters = scope && Array.isArray(scope.filters) ? scope.filters : [];
  filters.forEach((f, i) => {
    const clause = I.filterClause(f, i);
    where.push(clause.sql);
    parameters.push(...clause.params);
  });
  const w = scope && scope.window;
  if (w && w.column && (w.start || w.end)) {
    const col = `CAST(${I.quoteColumn(w.column)} AS DATE)`;
    if (w.start) { where.push(`${col} >= CAST(:wstart AS DATE)`); parameters.push({ name: 'wstart', value: String(w.start), type: 'STRING' }); }
    if (w.end) { where.push(`${col} <= CAST(:wend AS DATE)`); parameters.push({ name: 'wend', value: String(w.end), type: 'STRING' }); }
  }
  return { where, parameters };
}

const scopeColumns = (scope) => [...((scope && scope.filters) || []).map((f) => f.column), scope && scope.window && scope.window.column].filter(Boolean);

// rows_before and rows_after in one read-only SELECT, through the Data Filters of the use case table.
function scopeCountSql(GP, scopes, table, scope) {
  const { where, parameters } = scopeClauses(scope);
  return GP.statement(scopes, (ctx) => {
    const from = GP.previewFrom(table, ctx, scopeColumns(scope));
    return `SELECT COUNT(*) AS rows_before, COUNT_IF(${where.length ? where.join(' AND ') : 'TRUE'}) AS rows_after FROM ${from}`;
  }, parameters);
}

// The records found: rows, dated rows and the range of the chosen date column and of every date column. `dates` are the date/timestamp columns.
function factsSql(GP, scopes, table, dates, dateColumn) {
  const names = (dates || []).map(nameOf);
  return GP.statement(scopes, (ctx) => {
    const from = GP.previewFrom(table, ctx, names);
    const chosen = dateColumn && names.includes(dateColumn) ? I.quoteColumn(dateColumn) : null;
    const parts = ['COUNT(*) AS rows_total',
      chosen ? `COUNT(${chosen}) AS dated_rows, MIN(${chosen}) AS first_day, MAX(${chosen}) AS last_day` : '0 AS dated_rows, NULL AS first_day, NULL AS last_day',
      ...names.map((n, i) => `MIN(${I.quoteColumn(n)}) AS c${i}_first, MAX(${I.quoteColumn(n)}) AS c${i}_last`)];
    return `SELECT ${parts.join(', ')} FROM ${from}`;
  });
}

const dayFrom = (v) => (v === null || v === undefined || v === '' ? null : String(v).slice(0, 10));
function factsFrom(row, dates, dateColumn) {
  const r = row || {};
  const names = (dates || []).map(nameOf);
  return { rows: Number(r.rows_total) || 0, dated_rows: Number(r.dated_rows) || 0, first: dayFrom(r.first_day), last: dayFrom(r.last_day),
    date_column: dateColumn && names.includes(dateColumn) ? dateColumn : null,
    date_candidates: names.map((column, i) => ({ column, first: dayFrom(r[`c${i}_first`]), last: dayFrom(r[`c${i}_last`]) })) };
}

// ---- the echo ----
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shownDay = (d) => { const [y, m, day] = String(d).slice(0, 10).split('-'); return `${Number(day)} ${MONTHS[Number(m) - 1]} ${y}`; };
const shownN = (n) => Number(n).toLocaleString('en-US');
const plural = (noun) => (/(s|x|ch|sh)$/.test(noun) ? `${noun}es` : (/[^aeiou]y$/.test(noun) ? `${noun.slice(0, -1)}ies` : `${noun}s`));
const OP_WORDS = { '=': 'is', '!=': 'is not', '>': 'is above', '>=': 'is at least', '<': 'is below', '<=': 'is at most', 'in': 'is one of', 'not in': 'is none of',
  'between': 'is between', 'is null': 'is empty', 'is not null': 'is filled in' };

function filterWords(f) {
  const v = f.values || [];
  const tail = f.op === 'between' ? `${v[0]} and ${v[1]}` : v.join(', ');
  return `${f.column} ${OP_WORDS[f.op] || f.op}${tail ? ` ${tail}` : ''}`;
}

// What Inspire kept, in words, from the structure and the counts only.
function echoOf(scope, noun = 'record') {
  const filters = (scope && scope.filters) || [];
  const w = scope && scope.window;
  const parts = filters.map(filterWords);
  if (w && w.column && w.start && w.end) {
    const rel = w.last_n && w.unit ? ` (the last ${w.last_n} ${w.unit}${Number(w.last_n) === 1 ? '' : 's'} of your data)` : '';
    parts.unshift(`${w.column} is from ${shownDay(w.start)} to ${shownDay(w.end)}${rel}`);
  }
  const before = Number(scope && scope.rows_before);
  const after = Number(scope && scope.rows_after);
  const known = Number.isFinite(before) && Number.isFinite(after);
  if (!parts.length) return known ? `I kept all ${shownN(before)} rows: no filter or window applied.` : 'I kept all rows: no filter or window applied.';
  const head = `I kept ${plural(String(noun || 'record'))} where ${parts.join(' and ')}.`;
  if (!known) return head;
  const pct = before > 0 ? Math.round((after / before) * 100) : null;
  const share = pct === null ? '' : ` (${pct === 0 && after > 0 ? '<1' : pct}%)`;
  return `${head} That leaves ${shownN(after)} of ${shownN(before)} rows${share}.`;
}

module.exports = { SCOPE_OPS, UNITS, filterMessages, filterFrom, checkFilters, checkWindow, checkScope, resolveWindow, scopeClauses, scopeColumns, scopeCountSql, factsSql, factsFrom, echoOf };
