// The relationships of one picked table (REQ-362, REQ-370). The person picks one table; Inspire reads its declared keys (both
// directions) and then finds name matches across the picked scope. The scope is read with ONE information_schema.columns query per
// catalog, so a whole-catalog pick is not capped at a table count. The run does not read these yet: the person's list is kept in the
// Launch draft, and the agent notebook's own key discovery should later read that list (one source).
const I = require('./inspireImplement');
const { notInspireOwnSql } = require('../../frontend/src/lib/inspireOwnObjects.js');

const SOURCE_DECLARED = 'declared key';
const SOURCE_NAME = 'matching column name';
const low = (value) => String(value ?? '').toLowerCase();
const plain = (name) => String(name ?? '').replace(/`/g, '').trim();
const shortOf = (name) => name.split('.').pop();

function splitTable(name) {
  const parts = plain(name).split('.');
  return parts.length === 3 && parts.every((p) => p.trim()) ? parts.map((p) => p.trim()) : null;
}

/** The one picked table the relationships are read for: catalog.schema.table, trimmed. */
function pickedTableOf(value) {
  const name = plain(value);
  if (!splitTable(name)) throw I.badRequest(`${name || 'An empty name'} is not a catalog.schema.table name`);
  return name;
}

/** The picked scope the name matches are read over: catalog.schema.table names, trimmed, de-duplicated. No count cap. */
function pickedTablesOf(value) {
  if (!Array.isArray(value)) throw I.badRequest('tables must be a list of catalog.schema.table names');
  const seen = new Set();
  const out = [];
  for (const raw of value) {
    const name = pickedTableOf(raw);
    if (!seen.has(low(name))) { seen.add(low(name)); out.push(name); }
  }
  return out;
}

/** A plural table name's singular: customers -> customer, categories -> category, addresses -> address, status stays status. */
function singularOf(word) {
  const w = low(word);
  if (w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.endsWith('sses')) return w.slice(0, -2);
  if (w.endsWith('ss') || w.endsWith('us') || w.endsWith('is')) return w;
  return w.endsWith('s') ? w.slice(0, -1) : w;
}

/** The foreign keys one table declares: which of its columns reference which column of which table (the table's own child side). */
function declaredKeysStatement(name) {
  const [c, s, t] = splitTable(name);
  return {
    sql: `SELECT kcu.column_name AS column_name, ccu.table_catalog AS ref_catalog, ccu.table_schema AS ref_schema, `
      + 'ccu.table_name AS ref_table, ccu.column_name AS ref_column '
      + `FROM \`${c}\`.information_schema.key_column_usage kcu `
      + `JOIN \`${c}\`.information_schema.table_constraints tc ON tc.constraint_catalog = kcu.constraint_catalog `
      + 'AND tc.constraint_schema = kcu.constraint_schema AND tc.constraint_name = kcu.constraint_name '
      + `JOIN \`${c}\`.information_schema.constraint_column_usage ccu ON ccu.constraint_catalog = tc.constraint_catalog `
      + 'AND ccu.constraint_schema = tc.constraint_schema AND ccu.constraint_name = tc.constraint_name '
      + "WHERE tc.constraint_type = 'FOREIGN KEY' AND kcu.table_schema = lower(:s) AND kcu.table_name = lower(:t) "
      + 'ORDER BY kcu.ordinal_position',
    parameters: [{ name: 's', value: s, type: 'STRING' }, { name: 't', value: t, type: 'STRING' }],
  };
}

/** The foreign keys other tables declare into one table (the table's parent side): the child table, its column, the referenced column. */
function declaredIntoStatement(name) {
  const [c, s, t] = splitTable(name);
  return {
    sql: 'SELECT kcu.table_catalog AS child_catalog, kcu.table_schema AS child_schema, kcu.table_name AS child_table, '
      + 'kcu.column_name AS child_column, ccu.column_name AS ref_column '
      + `FROM \`${c}\`.information_schema.key_column_usage kcu `
      + `JOIN \`${c}\`.information_schema.table_constraints tc ON tc.constraint_catalog = kcu.constraint_catalog `
      + 'AND tc.constraint_schema = kcu.constraint_schema AND tc.constraint_name = kcu.constraint_name '
      + `JOIN \`${c}\`.information_schema.constraint_column_usage ccu ON ccu.constraint_catalog = tc.constraint_catalog `
      + 'AND ccu.constraint_schema = tc.constraint_schema AND ccu.constraint_name = tc.constraint_name '
      + "WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_schema = lower(:s) AND ccu.table_name = lower(:t) "
      + 'ORDER BY kcu.table_schema, kcu.table_name, kcu.ordinal_position',
    parameters: [{ name: 's', value: s, type: 'STRING' }, { name: 't', value: t, type: 'STRING' }],
  };
}

/** The bound predicate that picks the tables named (catalog.schema.table) in one catalog: one clause per table, values as parameters. */
function scopePredicate(names) {
  const parameters = [];
  const clauses = names.map((name, i) => {
    const [, s, t] = splitTable(name);
    parameters.push({ name: `s${i}`, value: s, type: 'STRING' }, { name: `t${i}`, value: t, type: 'STRING' });
    return `(table_schema = lower(:s${i}) AND table_name = lower(:t${i}))`;
  });
  return { clause: clauses.join(' OR '), parameters };
}

/** The columns of every table in one catalog's part of the picked scope: ONE information_schema.columns query for the catalog. */
function scopeColumnsStatement(catalog, names) {
  const { clause, parameters } = scopePredicate(names);
  return {
    sql: `SELECT table_schema, table_name, column_name FROM \`${catalog}\`.information_schema.columns `
      + `WHERE (${clause}) AND ${notInspireOwnSql('table_name', 'table_schema')} ORDER BY table_schema, table_name, ordinal_position`,
    parameters,
  };
}

/** The primary key columns of every table in one catalog's part of the picked scope: ONE query for the catalog (REQ-370). */
function scopeKeysStatement(catalog, names) {
  const { clause, parameters } = scopePredicate(names);
  return {
    sql: `SELECT kcu.table_schema, kcu.table_name, kcu.column_name FROM \`${catalog}\`.information_schema.key_column_usage kcu `
      + `JOIN \`${catalog}\`.information_schema.table_constraints tc ON kcu.constraint_catalog = tc.constraint_catalog `
      + 'AND kcu.constraint_schema = tc.constraint_schema AND kcu.constraint_name = tc.constraint_name '
      + "WHERE tc.constraint_type = 'PRIMARY KEY' "
      + `AND (${clause.replace(/table_schema/g, 'kcu.table_schema').replace(/table_name/g, 'kcu.table_name')}) `
      + `AND ${notInspireOwnSql('kcu.table_name', 'kcu.table_schema')} `
      + 'ORDER BY kcu.table_schema, kcu.table_name, kcu.ordinal_position',
    parameters,
  };
}

const findName = (list, name) => list.find((x) => low(x) === low(name));

// Key names that many tables use for unrelated keys (id, code, name...). A shared name of this kind is not a link by itself: it links
// only through the <table>_id rule or a declared key (REQ-370).
const GENERIC_KEY_NAMES = new Set(['id', 'key', 'code', 'name', 'uuid', 'guid', 'pk', 'row_id', 'rowid', 'row_key', 'idx', 'index']);
const isGenericKey = (column) => GENERIC_KEY_NAMES.has(low(column));
const fullName = (catalog, schema, table) => `${catalog}.${schema}.${table}`;

// The payload cap for one answer (REQ-370): above it, the columns of the tables the picked table does not link to are left out, with a note.
const PAYLOAD_LIMIT_BYTES = 2 * 1024 * 1024;

/**
 * The relationships of one picked table. `columns` are rows { table, column_name } over the whole picked scope (table = full name);
 * `keys` are the primary key rows { table, column_name } over the same scope; `declared` are the table's own foreign keys
 * (declaredKeysStatement rows); `into` are the foreign keys that point at it (declaredIntoStatement rows, child_* fields).
 * Returns { tables, suggestions }: every picked table's columns and keys (the pickers), and the relationships that involve this table.
 */
function relationshipsOfTable(table, { columns = [], keys = [], declared = [], into = [], focus = [] }) {
  const byTable = scopeIndex(columns, keys);
  const pCols = byTable.get(low(table))?.columns || [];
  const { byKey, add } = collector();
  // Declared keys first: a declared key is never repeated as a name match.
  for (const fk of declared) addDeclared(add, byTable, table, fk);
  for (const fk of into.filter((r) => r.child_table)) {
    const childName = fullName(fk.child_catalog, fk.child_schema, fk.child_table);
    if (!byTable.has(low(childName))) continue;
    add({ table: byTable.get(low(childName)).name, column: String(fk.child_column) },
      { table, column: findName(pCols, String(fk.ref_column)) || String(fk.ref_column) }, SOURCE_DECLARED);
  }
  addNameMatches(add, byTable, table);
  return fitPayload({ tables: tablesOf(byTable), suggestions: sortedSuggestions(byKey) }, [table, ...focus]);
}

/** The scope's tables by lower-case full name: { name, columns, keys }. */
function scopeIndex(columns, keys) {
  const byTable = new Map();
  for (const row of columns) {
    const key = low(row.table);
    if (!byTable.has(key)) byTable.set(key, { name: row.table, columns: [], keys: [] });
    byTable.get(key).columns.push(String(row.column_name));
  }
  for (const row of keys) byTable.get(low(row.table))?.keys.push(String(row.column_name));
  return byTable;
}
const tablesOf = (byTable) => Object.fromEntries([...byTable.values()].map((t) => [t.name, { columns: t.columns, primary_keys: t.keys }]));

function collector() {
  const byKey = new Map();
  const add = (from, to, source) => {
    const id = low(`${from.table}.${from.column}>${to.table}.${to.column}`);
    if (!byKey.has(id)) byKey.set(id, { from, to, source });
  };
  return { byKey, add };
}
const sortedSuggestions = (byKey) => [...byKey.values()].sort((x, y) => (low(`${x.from.table}.${x.from.column}`) < low(`${y.from.table}.${y.from.column}`) ? -1 : 1));

/** One declared foreign key of `table` (rows of declaredKeysStatement): added when the referenced table is in the scope. */
function addDeclared(add, byTable, table, fk) {
  if (!fk.ref_table) return;
  const refName = fullName(fk.ref_catalog, fk.ref_schema, fk.ref_table);
  if (!byTable.has(low(refName))) return;
  const column = String(fk.column_name);
  const refColumn = String(fk.ref_column);
  if (low(table) === low(refName) && low(column) === low(refColumn)) return;
  const refColumns = byTable.get(low(refName)).columns;
  add({ table, column }, { table: byTable.get(low(refName)).name, column: findName(refColumns, refColumn) || refColumn }, SOURCE_DECLARED);
}

/** The name matches between `table` and every other table of the scope, both directions. */
function addNameMatches(add, byTable, table) {
  const pCols = byTable.get(low(table))?.columns || [];
  const keysOf = (name) => byTable.get(low(name))?.keys || [];
  // A <other>_id column names the other table's key: its same-name column, its id, or its single primary key.
  const singleKey = (name) => (keysOf(name).length === 1 ? keysOf(name)[0] : null);
  for (const other of byTable.values()) {
    if (low(other.name) === low(table)) continue;
    const otherShort = shortOf(other.name);
    for (const column of pCols.filter((c) => low(c) === `${singularOf(otherShort)}_id`)) {
      const target = findName(other.columns, column) || singleKey(other.name) || findName(other.columns, 'id');
      if (target) add({ table, column }, { table: other.name, column: findName(other.columns, target) || target }, SOURCE_NAME);
    }
    const thisShort = shortOf(table);
    for (const column of other.columns.filter((c) => low(c) === `${singularOf(thisShort)}_id`)) {
      const target = findName(pCols, column) || singleKey(table) || findName(pCols, 'id');
      if (target) add({ table: other.name, column }, { table, column: findName(pCols, target) || target }, SOURCE_NAME);
    }
    // A shared column that is a single-column primary key of one table: the other table's column points at it (the child is the "from" side).
    for (const column of pCols) {
      if (isGenericKey(column)) continue;
      if (findName(keysOf(other.name), column) && findName(other.columns, column)) add({ table, column }, { table: other.name, column: findName(other.columns, column) }, SOURCE_NAME);
      else if (findName(keysOf(table), column) && findName(other.columns, column)) add({ table: other.name, column: findName(other.columns, column) }, { table, column }, SOURCE_NAME);
    }
  }
}

/**
 * The joins across every pair of the picked tables (REQ-584), by name: the rules of relationshipsOfTable applied to each table.
 * `declared` rows are each table's own foreign keys with a `table` field (scopeDeclaredStatement rows, child side). `labels` is
 * { fqn: { env, label } } (REQ-583): a dev or technical table gets no suggestion and a reference table is only a target, never
 * the foreign-key side. With no labels every table counts.
 */
function relationshipsAcross({ columns = [], keys = [], declared = [], labels = {} }) {
  const byTable = scopeIndex(columns, keys);
  const labelOf = (name) => labels?.[name] || Object.entries(labels || {}).find(([k]) => low(k) === low(name))?.[1] || {};
  const excluded = (name) => labelOf(name).env === 'dev' || labelOf(name).label === 'technical';
  const isReference = (name) => labelOf(name).label === 'reference';
  const { byKey, add: addAny } = collector();
  const add = (from, to, source) => {
    if (excluded(from.table) || excluded(to.table) || isReference(from.table)) return;
    addAny(from, to, source);
  };
  for (const fk of declared) if (fk.table && byTable.has(low(fk.table))) addDeclared(add, byTable, byTable.get(low(fk.table)).name, fk);
  for (const t of byTable.values()) addNameMatches(add, byTable, t.name);
  return { tables: tablesOf(byTable), suggestions: sortedSuggestions(byKey) };
}

/** Every table's own foreign keys in one catalog's part of the scope (child side): ONE query for the catalog. */
function scopeDeclaredStatement(catalog, names) {
  const { clause, parameters } = scopePredicate(names);
  return {
    sql: 'SELECT kcu.table_schema AS table_schema, kcu.table_name AS table_name, kcu.column_name AS column_name, '
      + 'ccu.table_catalog AS ref_catalog, ccu.table_schema AS ref_schema, ccu.table_name AS ref_table, ccu.column_name AS ref_column '
      + `FROM \`${catalog}\`.information_schema.key_column_usage kcu `
      + `JOIN \`${catalog}\`.information_schema.table_constraints tc ON tc.constraint_catalog = kcu.constraint_catalog `
      + 'AND tc.constraint_schema = kcu.constraint_schema AND tc.constraint_name = kcu.constraint_name '
      + `JOIN \`${catalog}\`.information_schema.constraint_column_usage ccu ON ccu.constraint_catalog = tc.constraint_catalog `
      + 'AND ccu.constraint_schema = tc.constraint_schema AND ccu.constraint_name = tc.constraint_name '
      + "WHERE tc.constraint_type = 'FOREIGN KEY' "
      + `AND (${clause.replace(/table_schema/g, 'kcu.table_schema').replace(/table_name/g, 'kcu.table_name')}) `
      + 'ORDER BY kcu.table_schema, kcu.table_name, kcu.ordinal_position',
    parameters,
  };
}

/** The label rows of the scope's catalogs (U8 v2 __inspire_table_labels: level, object_fqn, env, label, labelled_at). Null when the name is not a schema name. */
function tableLabelsStatement(inspireDatabase, catalogs) {
  const db = plain(inspireDatabase);
  if (!/^[\w-]+\.[\w-]+$/.test(db) || !catalogs.length) return null;
  return {
    sql: `SELECT level, object_fqn, env, label FROM \`${db.split('.')[0]}\`.\`${db.split('.')[1]}\`.__inspire_table_labels `
      + `WHERE lower(split_part(object_fqn, '.', 1)) IN (${catalogs.map((_, i) => `lower(:c${i})`).join(', ')}) ORDER BY labelled_at`,
    parameters: catalogs.map((value, i) => ({ name: `c${i}`, value, type: 'STRING' })),
  };
}

/**
 * { fqn: { env, label } } for the scope's tables from label rows (the latest row of an object wins). A table under a dev catalog or
 * dev schema is dev. A table with no row has no entry (it counts as a plain table).
 */
function labelsOfRows(rows, tables) {
  const latest = new Map();
  for (const r of rows || []) latest.set(`${low(r.level)}|${low(r.object_fqn)}`, r);
  const envOf = (key) => low(latest.get(key)?.env);
  const out = {};
  for (const t of tables) {
    const [c, s] = t.split('.');
    const row = latest.get(`table|${low(t)}`);
    const dev = envOf(`catalog|${low(c)}`) === 'dev' || envOf(`schema|${low(`${c}.${s}`)}`) === 'dev' || envOf(`table|${low(t)}`) === 'dev';
    if (dev) out[t] = { env: 'dev', label: row?.label || null };
    else if (row) out[t] = { env: low(row.env) || 'prod', label: row.label ? low(row.label) : null };
  }
  return out;
}

/** The answer fits PAYLOAD_LIMIT_BYTES: the picked table, the focus tables and the tables the suggestions name come first, the rest follow while they fit. */
function fitPayload(result, focus) {
  const size = (value) => Buffer.byteLength(JSON.stringify(value));
  if (size(result) <= PAYLOAD_LIMIT_BYTES) return result;
  const first = new Set([...focus, ...result.suggestions.flatMap((s) => [s.from.table, s.to.table])].map(low));
  const names = Object.keys(result.tables).sort((a, b) => (first.has(low(b)) - first.has(low(a))) || a.localeCompare(b));
  let budget = PAYLOAD_LIMIT_BYTES - size({ ...result, tables: {} });
  const tables = {};
  for (const name of names) {
    const cost = size([name, result.tables[name]]);
    if (cost > budget) break;
    budget -= cost;
    tables[name] = result.tables[name];
  }
  const shown = Object.keys(tables).length;
  return {
    ...result,
    tables,
    columns_note: `Columns are sent for ${shown} of ${names.length} tables: the picked table and the ones its suggestions name come first. `
      + 'Pick a smaller scope to see the columns of the rest.',
    columns_shown: shown,
    columns_total: names.length,
  };
}

module.exports = {
  SOURCE_DECLARED, SOURCE_NAME, pickedTableOf, pickedTablesOf, singularOf, declaredKeysStatement, declaredIntoStatement,
  scopeColumnsStatement, scopeKeysStatement, scopeDeclaredStatement, tableLabelsStatement, labelsOfRows, relationshipsOfTable, relationshipsAcross, fitPayload, PAYLOAD_LIMIT_BYTES,
};
