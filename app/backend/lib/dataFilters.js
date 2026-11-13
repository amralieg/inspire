// The Data Filters a use case reads through (REQ-171). The record is the run's Table Scope (the session's table_scope, the same text the
// run was started with as 17_table_scope). The notebook writes the Excel, CSV, PDF and markdown from the same record, and this file is the
// App's reader of it. Both sides format the cells the same way: the parity fixture app/agent/tests/fixtures/data_filter_cases.json holds the
// expected output and is checked by both test suites.
const { parseTableScopeText } = require('./inspireJobParams');
const { tableScopeOf, normalizeTableScope } = require('../../frontend/src/lib/tableScope.js');

const DATA_FILTER_VALUE_LIMIT = 10;
const DATA_FILTER_PICKS = ['=', 'in'];
const DATA_FILTER_EXCEPTS = ['!=', 'not in'];

function tablesOfUseCase(uc) {
  const involved = String(uc.tables_involved ?? uc['Tables Involved'] ?? '').split(',');
  return [uc.primary_table ?? uc['Primary Table'] ?? '', ...involved].map((t) => String(t).replace(/`/g, '').trim()).filter(Boolean);
}

// The categorical filters on the use case's tables: one entry per filtered column of each table, in the order the tables are read.
function useCaseDataFilters(uc, scopes) {
  const out = [];
  const seen = new Set();
  for (const table of tablesOfUseCase(uc)) {
    const key = table.toLowerCase();
    const entry = tableScopeOf(scopes || {}, table);
    if (!entry || seen.has(key)) continue;
    seen.add(key);
    for (const row of normalizeTableScope(entry).rows) {
      const op = String(row.op || '').toLowerCase();
      if (DATA_FILTER_PICKS.includes(op) || DATA_FILTER_EXCEPTS.includes(op)) {
        out.push({ column: row.column, table: table.split('.').pop(), excepts: DATA_FILTER_EXCEPTS.includes(op), values: row.values });
      }
    }
  }
  return out;
}

// The filtered column names, once each, in the order first filtered, as the person spelled them.
function dataFilterNames(filters) {
  const names = new Map();
  for (const f of filters) if (!names.has(f.column.toLowerCase())) names.set(f.column.toLowerCase(), f.column);
  return [...names.values()];
}

// The picked values of one filtered column: comma-joined, the first ten and a count for the rest; a table with its own values is named.
function dataFilterCell(filters, column, limit = DATA_FILTER_VALUE_LIMIT) {
  const parts = filters.filter((f) => f.column.toLowerCase() === column.toLowerCase()).map((f) => {
    const shown = f.values.slice(0, limit).join(', ') + (f.values.length > limit ? ` and ${f.values.length - limit} more` : '');
    return { table: f.table, text: f.excepts ? `all except ${shown}` : shown };
  });
  if (parts.length > 1) return parts.map((p) => `${p.table}: ${p.text}`).join('; ');
  return parts.length ? parts[0].text : '';
}

// One use case's filters for the App: [{ column, text }], one per filtered column.
function dataFiltersOf(uc, scopes) {
  const filters = useCaseDataFilters(uc, scopes);
  return dataFilterNames(filters).map((column) => ({ column, text: dataFilterCell(filters, column) }));
}

// The session's Table Scope parsed once for every session a list of rows names.
function scopesOfSessions(texts) {
  const out = new Map();
  for (const [sid, text] of texts) out.set(String(sid), parseTableScopeText(text).scopes);
  return out;
}

module.exports = { DATA_FILTER_VALUE_LIMIT, useCaseDataFilters, dataFilterNames, dataFilterCell, dataFiltersOf, scopesOfSessions };
