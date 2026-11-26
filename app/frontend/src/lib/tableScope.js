
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
    ...(row.group === true ? { group: true } : {}),
  }));
  return { columns, rows };
}

const NUMERIC_TYPE = /^(DECIMAL|DOUBLE|FLOAT|REAL|NUMERIC|INT|INTEGER|BIGINT|SMALLINT|TINYINT|LONG|SHORT|BYTE)(?![A-Za-z_])/i;
const DATE_TYPE = /^(DATE|TIMESTAMP|TIMESTAMP_NTZ|TIMESTAMP_LTZ|INTERVAL)(?![A-Za-z_])/i;

// Row Groups apply to categorical columns: every type that is neither numeric nor a date (string, boolean and the rest).
export function columnKindOf(dataType) {
  const type = String(dataType ?? '').trim();
  if (DATE_TYPE.test(type)) return 'date';
  if (NUMERIC_TYPE.test(type)) return 'numeric';
  return 'categorical';
}

export const isGroupRow = (row) => row.group === true;

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

// The saved entry for a table, matched by name in any case; undefined when the table has no scope.
export function scopeEntryOf(scopes, table) {
  const want = scopeKeyOf(table);
  return Object.entries(scopes || {}).find(([name]) => scopeKeyOf(name) === want)?.[1];
}

export function tableScopeOf(scopes, table) {
  const key = scopeKeyOf(table);
  for (const [name, entry] of Object.entries(scopes || {})) {
    if (scopeKeyOf(name) === key) return entry;
  }
  return null;
}

// The scope entries a run reads: the valid entries of the picked tables, sorted by name.
function sentTableScopes(scopes, pickedTables = []) {
  const picked = new Set(pickedTables.map(scopeKeyOf));
  const out = {};
  for (const table of Object.keys(scopes || {}).sort()) {
    if (!picked.has(scopeKeyOf(table))) continue;
    const entry = scopes[table];
    if (scopeIsValid(entry)) out[table] = normalizeTableScope(entry);
  }
  return out;
}

// The one rule for the use case label: it names the Row Groups of the picked tables, so it is available only when a picked
// table has a Row Group. The label box is disabled without one, and the serialiser writes the label only with one.
export function labelAvailable(scopes, pickedTables = []) {
  return Object.values(sentTableScopes(scopes, pickedTables)).some((entry) => entry.rows.some(isGroupRow));
}

export function serializeTableScopes(scopes, pickedTables = [], label = '') {
  const out = sentTableScopes(scopes, pickedTables);
  const labelText = text(label);
  if (labelText && labelAvailable(scopes, pickedTables)) out[USE_CASE_LABEL_KEY] = labelText;
  return Object.keys(out).length ? JSON.stringify(out) : '';
}

// The 17_table_scope text a launch sends. Every launch path builds it here, from the one scope state and the picks the run reads
// (REQ-242): a scope on a table the picks read is sent, a scope on a table they do not read is not.
export function launchTableScopeText(scopes, picks = {}, label = '') {
  return serializeTableScopes(scopes, pickedTableNames(scopes, picks), label);
}

// The values the label is prefilled from: the values of the "is" and "is one of" row filters on the picked tables.
export function filterValuesOf(scopes, pickedTables = []) {
  const picked = new Set(pickedTables.map(scopeKeyOf));
  const values = [];
  for (const [table, entry] of Object.entries(scopes || {})) {
    if (!picked.has(scopeKeyOf(table))) continue;
    for (const row of normalizeTableScope(entry).rows) {
      if (isGroupRow(row)) values.push(...row.values.filter(Boolean));
    }
  }
  return [...new Set(values)];
}

// The tables a run reads, from the picked scope (pickedScope in catalogList.js: the catalogs and schemas read whole, and the
// tables read one by one). Every scoped table under a schema or catalog read whole is included; a schema that has a picked table
// under it is not read whole, so its other scoped tables are left out. Keyed catalog.schema.table like any other.
export function pickedTableNames(scopes, { catalogs = [], schemas = [], tables = [] } = {}) {
  const names = [...tables];
  const seen = new Set(names.map(scopeKeyOf));
  const under = (key) => schemas.some((s) => key.startsWith(`${scopeKeyOf(s)}.`)) || catalogs.some((c) => key.startsWith(`${scopeKeyOf(c)}.`));
  for (const table of Object.keys(scopes || {})) {
    const key = scopeKeyOf(table);
    if (!seen.has(key) && under(key)) { seen.add(key); names.push(table); }
  }
  return names;
}

// The warehouse query every Unity Catalog browse call carries.
// REQ-521: showEverything adds include_unreadable=1, which makes every row carry readable: true|false.
export function tableBrowseQuery(warehouseId, showEverything = false) {
  const parts = [];
  if (warehouseId) parts.push(`warehouse_id=${encodeURIComponent(warehouseId)}`);
  if (showEverything) parts.push('include_unreadable=1');
  return parts.length ? `?${parts.join('&')}` : '';
}

// REQ-521: a row the person cannot read is listed only to request access to it; it is never a run source.
export const isUnreadable = (row) => row?.readable === false;

// REQ-522: who must be given access before a row can be a run source. A run reads as Inspire's own account, so Inspire needs read
// access as well as the person. The one rule the row marker and the Request Access body both use: [], ['person'], ['inspire'] or both.
export function accessNeedOf(row) {
  const need = [];
  if (row?.readable === false || row?.request === 'person') need.push('person');
  if (row?.inspire_readable === false || row?.request === 'inspire') need.push('inspire');
  return need;
}

export const ACCESS_NEED_TEXT = { person: 'You need access', inspire: 'Inspire needs access', both: 'You and Inspire need access' };
export const INSPIRE_NEED_TITLE = 'Runs read your data as Inspire, so Inspire needs read access too.';
export const accessNeedText = (need) => (need.length === 2 ? ACCESS_NEED_TEXT.both : need[0] ? ACCESS_NEED_TEXT[need[0]] : '');
export const MAX_ACCESS_OBJECTS = 50;

// RC7-B-06: with Show everything off the picker lists what the person can use: a row needing access (the person's or Inspire's) waits for
// Show everything. A row already picked stays listed, so a pick never vanishes from its own list. `keyOf` names a row as the picks do.
export function usableRows(rows, showEverything = false, picked = [], keyOf = (row) => row.full_name || row.name) {
  const list = Array.isArray(rows) ? rows : [];
  if (showEverything) return list;
  return list.filter((row) => accessNeedOf(row).length === 0 || picked.includes(keyOf(row)));
}

export function filteredTablesOf(scopes, pickedTables = []) {
  const picked = new Set(pickedTables.map(scopeKeyOf));
  return Object.entries(scopes || {})
    .filter(([table, entry]) => picked.has(scopeKeyOf(table)) && normalizeTableScope(entry).rows.some(isGroupRow))
    .map(([table]) => table);
}

// One row filter as the person reads it: its column, its operator and its values.
export function rowFilterText(row) {
  const def = scopeOpOf(row.op);
  const label = def ? def.label : row.op;
  const value = def && def.values === 0 ? '' : ` ${row.values.join(' and ')}`;
  return `${row.column} ${label}${value}`;
}

export function tableScopeSummary(entry) {
  const scope = normalizeTableScope(entry);
  const cols = scope.columns.length;
  const parts = [`${cols} column${cols === 1 ? '' : 's'}`];
  if (!scope.rows.length) return `${parts[0]}, all rows`;
  return `${parts[0]}, rows where ${scope.rows.map(rowFilterText).join(' and ')}`;
}

// The Table Scope the build reads (REQ-389). With no choice on the Data step (dataSpec.table_scope absent) it reads the scope the
// Discover run read; a choice replaces it, and an empty choice is whole data.
export function chosenTableScopes(dataSpec, carried) {
  return dataSpec && dataSpec.table_scope && typeof dataSpec.table_scope === 'object' ? dataSpec.table_scope : (carried || {});
}

// The Table Scope a wizard preview or readiness read names (REQ-389): the Data step's choice as text, or '' when there is no choice,
// so the read keeps the Discover run's scope.
export function chosenScopeParam(dataSpec) {
  return dataSpec && dataSpec.table_scope !== undefined ? JSON.stringify(dataSpec.table_scope) : '';
}

// The same scope with every row filter taken off: the columns the person kept stay, and a table with nothing left is not read.
export function wholeTableScopes(scopes) {
  return Object.fromEntries(Object.entries(scopes || {}).map(([table, entry]) => [table, { ...normalizeTableScope(entry), rows: [] }])
    .filter(([, entry]) => entry.columns.length > 0));
}

// The same scope with one row filter (by its index in the table's rows) taken off.
export function withoutTableRow(scopes, table, index) {
  const key = scopeKeyOf(table);
  return Object.fromEntries(Object.entries(scopes || {}).map(([name, entry]) => {
    if (scopeKeyOf(name) !== key) return [name, entry];
    const scope = normalizeTableScope(entry);
    return [name, { ...scope, rows: scope.rows.filter((_, i) => i !== index) }];
  }));
}
