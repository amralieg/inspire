
export const SCOPE_OPS = [
  { op: '=', label: 'is', values: 1 },
  { op: '!=', label: 'is not', values: 1 },
  { op: 'in', label: 'is one of', values: 'many' },
  { op: 'between', label: 'is between', values: 2 },
  { op: '>=', label: 'is at least', values: 1 },
  { op: '<=', label: 'is at most', values: 1 },
  { op: 'is null', label: 'is empty', values: 0 },
];

const OP_BY_NAME = new Map(SCOPE_OPS.map((def) => [def.op, def]));

export const scopeOpOf = (op) => OP_BY_NAME.get(String(op ?? '').trim().toLowerCase()) || null;

export const scopeKeyOf = (table) => String(table ?? '').replace(/`/g, '').trim().toLowerCase();

const text = (v) => (v == null ? '' : String(v).trim());

export function normalizeTableScope(entry) {
  const raw = entry && typeof entry === 'object' ? entry : {};
  const columns = [...new Set((Array.isArray(raw.columns) ? raw.columns : []).map(text).filter(Boolean))];
  const rows = (Array.isArray(raw.rows) ? raw.rows : []).filter((row) => row && typeof row === 'object').map((row) => ({
    column: text(row.column),
    op: text(row.op).toLowerCase(),
    values: (Array.isArray(row.values) ? row.values : []).map(text),
  }));
  return { columns, rows };
}

export function scopeProblems(entry, tableColumns = null) {
  const scope = normalizeTableScope(entry);
  const known = tableColumns ? new Set(tableColumns.map((c) => String(c).toLowerCase())) : null;
  const problems = [];
  if (!scope.columns.length) problems.push('Pick at least one column for this table.');
  if (known) {
    for (const column of scope.columns) {
      if (!known.has(column.toLowerCase())) problems.push(`Column ${column} is not in this table.`);
    }
  }
  scope.rows.forEach((row, index) => {
    const label = `Filter ${index + 1}`;
    if (!row.column) problems.push(`${label} needs a column.`);
    else if (known && !known.has(row.column.toLowerCase())) problems.push(`${label} uses ${row.column}, which is not in this table.`);
    const def = scopeOpOf(row.op);
    if (!def) {
      problems.push(`${label} has an operator Inspire does not support.`);
      return;
    }
    const filled = row.values.filter(Boolean);
    if (filled.length !== row.values.length) problems.push(`${label} has an empty value.`);
    if (def.values === 'many' && !filled.length) problems.push(`${label} needs at least one value.`);
    if (typeof def.values === 'number' && def.values !== row.values.length) {
      const need = def.values === 0 ? 'no value' : def.values === 1 ? 'one value' : 'two values';
      problems.push(`${label} ${def.label} needs ${need}.`);
    }
  });
  return problems;
}

export const scopeIsValid = (entry, tableColumns = null) => scopeProblems(entry, tableColumns).length === 0;

export const USE_CASE_LABEL_KEY = 'use_case_label';

// The label is the one text key the scope object carries besides the catalog.schema.table keys.
export function scopesFromObject(value) {
  const out = { scopes: {}, problems: [] };
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    if (value != null && value !== '') out.problems.push('The table scope must be an object keyed by catalog.schema.table.');
    return out;
  }
  const label = typeof value[USE_CASE_LABEL_KEY] === 'string' ? text(value[USE_CASE_LABEL_KEY]) : '';
  if (label) out.label = label;
  for (const [table, entry] of Object.entries(value)) {
    if (table === USE_CASE_LABEL_KEY) continue;
    if (!/^[^.`\s]+\.[^.`\s]+\.[^.`\s]+$/.test(table)) {
      out.problems.push(`${table} must be a catalog.schema.table name.`);
      continue;
    }
    const problems = scopeProblems(entry);
    if (problems.length) {
      out.problems.push(...problems.map((p) => `${table}: ${p}`));
      continue;
    }
    out.scopes[table] = normalizeTableScope(entry);
  }
  return out;
}

export function tableScopeOf(scopes, table) {
  const key = scopeKeyOf(table);
  for (const [name, entry] of Object.entries(scopes || {})) {
    if (scopeKeyOf(name) === key) return entry;
  }
  return null;
}

// The use case label only means something when a picked table has a row filter, so it is written only then.
export function serializeTableScopes(scopes, pickedTables = [], label = '') {
  const picked = new Set(pickedTables.map(scopeKeyOf));
  const out = {};
  for (const table of Object.keys(scopes || {}).sort()) {
    if (!picked.has(scopeKeyOf(table))) continue;
    const entry = scopes[table];
    if (scopeIsValid(entry)) out[table] = normalizeTableScope(entry);
  }
  const labelText = text(label);
  if (labelText && Object.values(out).some((entry) => entry.rows.length)) out[USE_CASE_LABEL_KEY] = labelText;
  return Object.keys(out).length ? JSON.stringify(out) : '';
}

// The values the label is prefilled from: the values of the "is" and "is one of" row filters on the picked tables.
export function filterValuesOf(scopes, pickedTables = []) {
  const picked = new Set(pickedTables.map(scopeKeyOf));
  const values = [];
  for (const [table, entry] of Object.entries(scopes || {})) {
    if (!picked.has(scopeKeyOf(table))) continue;
    for (const row of normalizeTableScope(entry).rows) {
      if (row.op === '=' || row.op === 'in') values.push(...row.values.filter(Boolean));
    }
  }
  return [...new Set(values)];
}

export function filteredTablesOf(scopes, pickedTables = []) {
  const picked = new Set(pickedTables.map(scopeKeyOf));
  return Object.entries(scopes || {})
    .filter(([table, entry]) => picked.has(scopeKeyOf(table)) && normalizeTableScope(entry).rows.length)
    .map(([table]) => table);
}

export function tableScopeSummary(entry) {
  const scope = normalizeTableScope(entry);
  const cols = scope.columns.length;
  const parts = [`${cols} column${cols === 1 ? '' : 's'}`];
  if (!scope.rows.length) return `${parts[0]}, all rows`;
  const filters = scope.rows.map((row) => {
    const def = scopeOpOf(row.op);
    const label = def ? def.label : row.op;
    const value = def && def.values === 0 ? '' : ` ${row.values.join(' and ')}`;
    return `${row.column} ${label}${value}`;
  });
  return `${parts[0]}, rows where ${filters.join(' and ')}`;
}
