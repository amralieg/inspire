const crypto = require('node:crypto');
const shared = require('../../frontend/src/lib/groupingSql.js');

const { GROUPING_SQL_MAX_CHARS, REFUSED_KEYWORDS, REFUSED_FUNCTIONS, quotedIdent, groupingMainTable, head } = shared;

function checkGroupingSql(input) {
  const checked = shared.checkGroupingSql(input);
  return { ...checked, hash: checked.ok ? crypto.createHash('sha256').update(checked.sql, 'utf8').digest('hex') : '' };
}

function wrapGroupingSql(sql) {
  return `(${sql}\n)`;
}

const GROUPING_TOP = 10;
const GROUPING_MIN_GROUPS = 2;
const GROUPING_MAX_GROUPS = 500;
const GROUPING_MIN_RECORDS = 30;
const GROUPING_MAX_KEYS = 8;
const GROUPING_NAME_CHARS = 200;
const GROUPING_PREVIEW_MS = 120000;
const GROUPING_ROW_LIMIT = 100;
const GROUPING_BYTE_LIMIT = 1048576;
const GROUPING_SETTINGS = ['group_sql', 'group_sql_tables', 'group_sql_hash', 'group_sql_checked_by', 'group_sql_checked_at'];
const GROUPING_ASSUMPTIONS_SUFFIX = '_assumptions';
const GROUPING_ASSUMPTION_COLUMNS = [['use_case_id', 'STRING'], ['name', 'STRING'], ['value', 'DOUBLE'], ['changed_by', 'STRING'], ['changed_at', 'TIMESTAMP'],
  ['note', 'STRING'], ['text_value', 'STRING']];
const GROUPING_SAVED_NOTE = 'Custom grouping SQL checked and saved in Inspire';
const GROUPING_NO_SIGN_IN = 'Inspire runs a custom grouping with your own sign-in, and this request carries none, so it ran nothing; '
  + 'ask an App manager to re-run the Inspire installer, which turns on user authorization with the sql scope';
const GROUPING_DENIED = 'You cannot read every table this grouping SQL reads with your own sign-in, so Inspire ran nothing and saved nothing';

function groupingKeyColumns(raw) {
  const keys = Array.isArray(raw) ? raw.map((k) => String(k ?? '').trim()) : [];
  if (!keys.length || keys.length > GROUPING_MAX_KEYS) return null;
  const plain = (k) => k.length > 0 && k.length <= 255 && Array.from(k).every((c) => c.codePointAt(0) >= 0x20 && c !== '\u007f');
  if (!keys.every(plain) || new Set(keys.map((k) => k.toLowerCase())).size !== keys.length || keys.some((k) => k.toLowerCase() === 'group_name')) return null;
  return keys;
}

function groupingShapeSql(sql) {
  return `SELECT * FROM ${wrapGroupingSql(sql)} LIMIT 0`;
}

function groupingTopSql(sql) {
  return `SELECT group_name, COUNT(*) AS records FROM ${wrapGroupingSql(sql)} GROUP BY 1 ORDER BY 2 DESC LIMIT ${GROUPING_TOP}`;
}

function groupingTotalsSql(sql, main, keys) {
  const k = keys.map(quotedIdent);
  const match = k.map((c) => `g.${c} <=> m.${c}`).join(' AND ');
  return `WITH inspire_grouping AS (SELECT * FROM ${wrapGroupingSql(sql)}), `
    + 'inspire_groups AS (SELECT group_name, COUNT(*) AS records FROM inspire_grouping WHERE group_name IS NOT NULL GROUP BY group_name) '
    + 'SELECT (SELECT COUNT(*) FROM inspire_grouping) AS row_count, '
    + `(SELECT COUNT(DISTINCT ${k.join(', ')}) FROM inspire_grouping) AS record_keys, `
    + '(SELECT COUNT(*) FROM inspire_groups) AS group_count, '
    + '(SELECT MIN(records) FROM inspire_groups) AS smallest_group, '
    + `(SELECT COUNT(*) FROM inspire_groups WHERE records < ${GROUPING_MIN_RECORDS}) AS small_groups, `
    + '(SELECT COUNT(*) FROM inspire_grouping WHERE group_name IS NULL) AS null_groups, '
    + `(SELECT COUNT(*) FROM ${main.sql} m WHERE NOT EXISTS (SELECT 1 FROM inspire_grouping g WHERE ${match})) AS no_group`;
}

function shapeProblem(columns, keys) {
  const have = new Set(columns.map((c) => String(c).toLowerCase()));
  const missing = ['group_name', ...keys].filter((c) => !have.has(c.toLowerCase()));
  if (!missing.length) return '';
  return `The grouping SQL returns no column named ${missing.join(', ')}; return one row per record with the record key `
    + `${keys.length === 1 ? 'column' : 'columns'} ${keys.join(', ')} and group_name.`;
}

const count = (v) => (v == null || v === '' ? 0 : Number(v));

function groupingPreviewView(top, totalsRow) {
  const totals = {
    rows: count(totalsRow.row_count),
    record_keys: count(totalsRow.record_keys),
    groups: count(totalsRow.group_count),
    smallest_group: totalsRow.smallest_group == null ? null : Number(totalsRow.smallest_group),
    small_groups: count(totalsRow.small_groups),
    null_groups: count(totalsRow.null_groups),
    no_group: count(totalsRow.no_group),
  };
  const one = totals.rows === totals.record_keys;
  const range = totals.groups >= GROUPING_MIN_GROUPS && totals.groups <= GROUPING_MAX_GROUPS;
  const rules = [
    { id: 'one_row_per_record', ok: one, text: one ? `Each of the ${totals.record_keys} records has one row.`
      : `The SQL returns ${totals.rows} rows for ${totals.record_keys} records; return exactly one row per record.` },
    { id: 'group_count', ok: range, text: `${totals.groups} ${totals.groups === 1 ? 'group' : 'groups'}; a grouping needs ${GROUPING_MIN_GROUPS} to ${GROUPING_MAX_GROUPS}.` },
    { id: 'small_groups', ok: true, text: totals.small_groups
      ? `${totals.small_groups} ${totals.small_groups === 1 ? 'group has' : 'groups have'} fewer than ${GROUPING_MIN_RECORDS} records and combine into Other groups.`
      : `Every group has at least ${GROUPING_MIN_RECORDS} records.` },
    { id: 'no_group', ok: true, text: totals.null_groups + totals.no_group
      ? `${totals.null_groups + totals.no_group} records fall in No group: ${totals.null_groups} with no group_name and ${totals.no_group} with no row.`
      : 'Every record has a group.' },
  ];
  const shown = (top || []).slice(0, GROUPING_TOP).map((r) => {
    const name = r.group_name == null ? null : String(r.group_name);
    const cut = name !== null && Array.from(name).length > GROUPING_NAME_CHARS;
    return { group_name: cut ? `${head(name, GROUPING_NAME_CHARS)}...` : name, records: count(r.records), cut };
  });
  const text = totals.groups > GROUPING_TOP ? `Showing the ${GROUPING_TOP} largest of ${totals.groups} groups.`
    : totals.groups === 1 ? 'Showing the one group.' : `Showing all ${totals.groups} groups.`;
  return { ok: one && range, top: shown, totals, rules, text };
}

function groupingSettingsTable(resultTable) {
  const table = groupingMainTable(resultTable);
  if (!table) return null;
  return { sql: `${table.sql.slice(0, -1)}${GROUPING_ASSUMPTIONS_SUFFIX}\`` };
}

function groupingSettingsCreateSql(table) {
  return `CREATE TABLE IF NOT EXISTS ${table.sql} (${GROUPING_ASSUMPTION_COLUMNS.map(([name, kind]) => `${name} ${kind}`).join(', ')})`;
}

function groupingSettingsInsert(table, row) {
  const values = [row.sql, JSON.stringify(row.tables), row.hash, row.checkedBy, String(row.checkedAt)];
  return {
    sql: `INSERT INTO ${table.sql} (use_case_id, name, value, changed_by, changed_at, note, text_value) VALUES `
      + GROUPING_SETTINGS.map((name, i) => `(:use_case_id, '${name}', NULL, :changed_by, :changed_at, :note, :v${i})`).join(', '),
    parameters: [{ name: 'use_case_id', value: String(row.useCaseId), type: 'STRING' }, { name: 'changed_by', value: String(row.checkedBy), type: 'STRING' },
      { name: 'changed_at', value: String(row.checkedAt), type: 'TIMESTAMP' }, { name: 'note', value: GROUPING_SAVED_NOTE, type: 'STRING' },
      ...values.map((value, i) => ({ name: `v${i}`, value: String(value), type: 'STRING' }))],
  };
}

module.exports = {
  GROUPING_SQL_MAX_CHARS,
  REFUSED_KEYWORDS,
  REFUSED_FUNCTIONS,
  GROUPING_TOP,
  GROUPING_MIN_GROUPS,
  GROUPING_MAX_GROUPS,
  GROUPING_MIN_RECORDS,
  GROUPING_PREVIEW_MS,
  GROUPING_ROW_LIMIT,
  GROUPING_BYTE_LIMIT,
  GROUPING_SETTINGS,
  GROUPING_ASSUMPTION_COLUMNS,
  GROUPING_SAVED_NOTE,
  GROUPING_NO_SIGN_IN,
  GROUPING_DENIED,
  checkGroupingSql,
  wrapGroupingSql,
  quotedIdent,
  groupingMainTable,
  groupingKeyColumns,
  groupingShapeSql,
  groupingTopSql,
  groupingTotalsSql,
  shapeProblem,
  groupingPreviewView,
  groupingSettingsTable,
  groupingSettingsCreateSql,
  groupingSettingsInsert,
};
