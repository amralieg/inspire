const G = require('./groupingSql');
const R = require('./groupingRule');
const { parseExactJson } = require('./exactJson');

const PROFILE_MS = 60000;
const PROFILE_DAYS_MAX = 3650;
const PROFILE_VALUE_CHARS = 200;
const PROFILE_APPROX_MARGIN = 1.1;
const PROFILE_EXAMPLE_GROUPS = 5;
const PROFILE_APPROX_MAX = Math.ceil(R.GROUP_MAX_GROUPS * PROFILE_APPROX_MARGIN);
const PROFILE_VALUE_ROWS = (PROFILE_APPROX_MAX + 1) * R.GROUP_PROFILED;
const PROFILE_PATH_ROWS = 2000;
const PROFILE_META_ROWS = 2000;

const q = G.quotedIdent;
const str = (v) => (v == null ? '' : String(v));
const num = (v) => (v == null || v === '' ? 0 : Number(v) || 0);
const shownValue = (v) => (v == null ? null : str(v));

function scopeDaysOf(raw) {
  if (raw == null || raw === '') return R.SCOPE_DAYS;
  const days = Number(raw);
  return Number.isInteger(days) && days >= 1 && days <= PROFILE_DAYS_MAX ? days : null;
}

function keysStatement(catalog, schema, table) {
  const ic = `${q(catalog)}.information_schema`;
  return {
    sql: `SELECT tc.constraint_type, tc.constraint_name, k.column_name, k.ordinal_position, u.table_catalog AS ref_catalog, u.table_schema AS ref_schema, `
      + `u.table_name AS ref_table, u.column_name AS ref_column FROM ${ic}.table_constraints tc `
      + `JOIN ${ic}.key_column_usage k ON k.constraint_catalog = tc.constraint_catalog AND k.constraint_schema = tc.constraint_schema `
      + 'AND k.constraint_name = tc.constraint_name '
      + `LEFT JOIN ${ic}.referential_constraints r ON r.constraint_catalog = tc.constraint_catalog AND r.constraint_schema = tc.constraint_schema `
      + 'AND r.constraint_name = tc.constraint_name '
      + `LEFT JOIN ${ic}.key_column_usage u ON u.constraint_catalog = r.unique_constraint_catalog AND u.constraint_schema = r.unique_constraint_schema `
      + 'AND u.constraint_name = r.unique_constraint_name AND u.ordinal_position = k.position_in_unique_constraint '
      + "WHERE tc.table_schema = lower(:s) AND tc.table_name = lower(:t) AND tc.constraint_type IN ('PRIMARY KEY', 'FOREIGN KEY') "
      + 'ORDER BY tc.constraint_type DESC, tc.constraint_name, k.ordinal_position',
    parameters: [{ name: 's', value: schema, type: 'STRING' }, { name: 't', value: table, type: 'STRING' }],
  };
}

function statsSql(main, columns, timeColumn, days) {
  const parts = ['COUNT(*) AS records', ...columns.flatMap((c, i) => [`approx_count_distinct(${q(c)}) AS d${i}`,
    `COUNT_IF(${q(c)} IS NULL OR TRIM(CAST(${q(c)} AS STRING)) = '') AS n${i}`])];
  if (timeColumn) parts.push(`COUNT_IF(${q(timeColumn)} >= date_sub(current_date(), ${Number(days)})) AS recent`);
  return `SELECT ${parts.join(', ')} FROM ${main.sql}`;
}

function sampleSql(main, columns) {
  const c = columns.map(q);
  const sizes = c.map((col, i) => `SELECT 'size' AS kind, ${i} AS coarse, -1 AS fine, COUNT(*) AS groups, SUM(n) AS records `
    + `FROM (SELECT ${col} AS v, COUNT(*) AS n FROM s GROUP BY ${col})`);
  const nests = c.flatMap((a, i) => c.map((b, j) => (i === j ? '' : `SELECT 'nest' AS kind, ${i} AS coarse, ${j} AS fine, MAX(k) AS groups, 0 AS records `
    + `FROM (SELECT ${b} AS v, COUNT(DISTINCT ${a}) AS k FROM s GROUP BY ${b})`))).filter(Boolean);
  return `WITH s AS (SELECT ${c.join(', ')} FROM ${main.sql} LIMIT ${R.GROUP_SAMPLE_ROWS}) ${[...sizes, ...nests].join(' UNION ALL ')}`;
}

function valuesSql(main, picked) {
  const parts = picked.map(({ name, at }) => `SELECT ${at} AS col, left(CAST(${q(name)} AS STRING), ${PROFILE_VALUE_CHARS}) AS value, COUNT(*) AS records `
    + `FROM ${main.sql} GROUP BY ${q(name)}`);
  return `SELECT col, value, records FROM (${parts.join(' UNION ALL ')}) ORDER BY col, records DESC`;
}

function pathsSql(main, columns) {
  const c = columns.map(q);
  return `SELECT ${c.map((col, i) => `left(CAST(${col} AS STRING), ${PROFILE_VALUE_CHARS}) AS p${i}`).join(', ')}, COUNT(*) AS records `
    + `FROM ${main.sql} GROUP BY ${c.join(', ')}`;
}

function profiledColumns(stats, candidates) {
  return candidates.map((name, at) => ({ name, at, approx: num(stats[`d${at}`]), nulls: num(stats[`n${at}`]) }))
    .filter((c) => c.approx >= R.GROUP_MIN_GROUPS - 1 && c.approx <= PROFILE_APPROX_MAX);
}

function sampleProfile(rows, candidates) {
  const profiles = [];
  const nests = [];
  for (const row of rows || []) {
    const coarse = candidates[num(row.coarse)];
    if (row.kind === 'size' && coarse !== undefined) profiles.push({ column: coarse, groups: num(row.groups), records: num(row.records) });
    if (row.kind === 'nest' && coarse !== undefined && candidates[num(row.fine)] !== undefined) {
      nests.push([coarse, candidates[num(row.fine)], num(row.groups) <= 1]);
    }
  }
  return { profiles, nests };
}

function groupsByColumn(rows, picked) {
  const out = new Map(picked.map((p) => [p.name, new Map()]));
  const byAt = new Map(picked.map((p) => [p.at, p.name]));
  for (const row of rows || []) {
    const name = byAt.get(num(row.col));
    if (name === undefined) continue;
    const key = R.groupPart(name, row.value);
    const groups = out.get(name);
    const seen = groups.get(key) || { value: row.value == null || str(row.value).trim() === '' ? null : str(row.value), records: 0 };
    seen.records += num(row.records);
    groups.set(key, seen);
  }
  return out;
}

function parentOf(name, groups, nests, kept) {
  const mine = groups.get(name).size;
  const holds = new Set(nests.filter((n) => n[2] && n[1] === name).map((n) => n[0]));
  const coarser = kept.filter((other) => other !== name && holds.has(other) && groups.get(other).size < mine)
    .sort((a, b) => groups.get(b).size - groups.get(a).size || (a < b ? -1 : 1));
  return coarser[0] || null;
}

function exampleOf(recommended, groups, pathRows) {
  if (!recommended.length) return null;
  const finest = recommended[recommended.length - 1];
  const paths = recommended.length === 1
    ? [...groups.get(finest).values()].map((g) => ({ path: [g.value], records: g.records }))
    : (pathRows || []).map((row) => ({ path: recommended.map((_c, i) => (row[`p${i}`] == null ? null : str(row[`p${i}`]))), records: num(row.records) }));
  const placed = R.effectiveGroups(recommended.join(', '), paths, false);
  const moved = new Map();
  placed.forEach((p, i) => {
    if (p.level === finest) return;
    const list = moved.get(p.group) || [];
    list.push({ value: R.groupPart(finest, p.path[p.path.length - 1]), records: paths[i].records });
    moved.set(p.group, list);
  });
  if (!moved.size) return null;
  const [movesTo, small] = [...moved.entries()].sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1))[0];
  return { column: finest, small_groups: small.sort((a, b) => b.records - a.records || (a.value < b.value ? -1 : 1)).slice(0, PROFILE_EXAMPLE_GROUPS), moves_to: movesTo };
}

function savedJoins(raw, table) {
  let joins = raw;
  if (typeof joins === 'string') {
    try {
      joins = parseExactJson(joins);
    } catch {
      joins = [];
    }
  }
  const plain = (t) => str(t).replace(/`/g, '').toLowerCase();
  return (Array.isArray(joins) ? joins : [])
    .filter((j) => j && plain(j.table) === plain(table) && G.groupingMainTable(j.ref_table) && str(j.column) && str(j.ref_column))
    .map((j) => ({ column: str(j.column), ref_table: str(j.ref_table), ref_column: str(j.ref_column), source: str(j.source) || 'discover' }));
}

function declaredKeys(rows) {
  const primary = (rows || []).filter((r) => r.constraint_type === 'PRIMARY KEY').map((r) => str(r.column_name)).filter(Boolean);
  const joins = (rows || []).filter((r) => r.constraint_type === 'FOREIGN KEY' && r.ref_table && r.ref_column)
    .map((r) => ({ column: str(r.column_name), ref_table: [r.ref_catalog, r.ref_schema, r.ref_table].map(str).join('.'), ref_column: str(r.ref_column),
      source: 'unity_catalog' }))
    .filter((j) => G.groupingMainTable(j.ref_table));
  return { primary: [...new Set(primary)], joins };
}

function prefillSql(main, keys, joins, groupColumn) {
  const sql = (name) => G.groupingMainTable(name).sql;
  const lines = [`SELECT ${[...keys.map((k) => `m.${q(k)}`), `${groupColumn ? `m.${q(groupColumn)}` : "'Global'"} AS group_name`].join(', ')}`,
    `FROM ${main.sql} m`];
  joins.forEach((j, i) => lines.push(`LEFT JOIN ${sql(j.ref_table)} j${i + 1} ON m.${q(j.column)} = j${i + 1}.${q(j.ref_column)}`));
  return lines.join('\n');
}

function reasonOf({ technique, qualifies, standalone, recommended, table }) {
  const named = str(technique).trim() || 'this use case';
  if (qualifies) return `Grouping applies: ${named} compares each record with the records like it, and ${recommended.join(', ')} can group ${table}.`;
  if (!R.groupingApplies(technique)) {
    return standalone ? `Grouping does not apply: ${named} looks at each record on its own, so every record is in one Global group.`
      : `Grouping does not apply: ${named} does not compare records with each other, so every record is in one Global group.`;
  }
  return `Grouping does not apply: no column of ${table} makes ${R.GROUP_MIN_GROUPS} to ${R.GROUP_MAX_GROUPS} groups with ${R.GROUP_MIN_RECORDS} `
    + 'records each on average, so every record is in one Global group.';
}

function profileView({ table, technique, columns, candidates, stats, sample, values, paths, timeColumn, days, keys, joins, readAt }) {
  const records = num(stats.records);
  const standalone = R.standaloneRecords(technique);
  const picked = profiledColumns(stats, candidates);
  const groups = groupsByColumn(values, picked);
  const types = new Map((columns || []).map((c) => [str(c.column_name), str(c.data_type)]));
  const kept = picked.filter((p) => groups.get(p.name).size >= R.GROUP_MIN_GROUPS && groups.get(p.name).size <= R.GROUP_MAX_GROUPS);
  const keptNames = kept.map((p) => p.name);
  const { profiles, nests } = sampleProfile(sample, candidates);
  const heavy = new Set(kept.filter((p) => R.nullHeavy({ records, nulls: p.nulls })).map((p) => p.name));
  const recommended = R.recommendation(profiles.filter((p) => keptNames.includes(p.column) && !heavy.has(p.column)), nests);
  const shown = kept.map((p) => {
    const sizes = [...groups.get(p.name).values()].map((g) => g.records);
    return { name: p.name, type: types.get(p.name) || '', distinct: sizes.length, smallest: Math.min(...sizes), largest: Math.max(...sizes), nulls: p.nulls,
      parent: parentOf(p.name, groups, nests, keptNames) };
  });
  const finest = recommended[recommended.length - 1];
  const suggested = finest ? R.suggestedGroups([...groups.get(finest).values()].filter((g) => g.value != null)) : [];
  const qualifies = R.groupingApplies(technique) && recommended.length > 0;
  const recent = timeColumn ? { days, records: num(stats.recent) } : null;
  const inGroups = suggested.length ? suggested.reduce((sum, g) => sum + g.records, 0) : null;
  const firstRun = { all: records, groups: inGroups, recent: recent ? recent.records : null, records: standalone ? Math.min(records, R.SCOPE_RECORDS) : null };
  const keyColumns = keys.primary.length ? keys.primary : R.keyColumnGuess(columns);
  const prefillJoins = joins.length ? joins : keys.joins;
  const main = G.groupingMainTable(table);
  return {
    table,
    records,
    qualifies,
    reason: reasonOf({ technique, qualifies, standalone, recommended, table }),
    standalone,
    columns: shown,
    recommended,
    example: exampleOf(recommended, groups, paths),
    time_column: timeColumn || null,
    recent,
    suggested_groups: suggested,
    first_run: firstRun,
    default_scope: R.firstRunDefault({ records, groups: inGroups, recent: firstRun.recent, standalone }),
    prefill: { key_columns: keyColumns, joins: prefillJoins, sql: prefillSql(main, keyColumns, prefillJoins, finest || keptNames[0] || candidates[0] || '') },
    read_at: readAt,
  };
}

module.exports = {
  PROFILE_MS,
  PROFILE_DAYS_MAX,
  PROFILE_APPROX_MAX,
  PROFILE_VALUE_ROWS,
  PROFILE_PATH_ROWS,
  PROFILE_META_ROWS,
  scopeDaysOf,
  keysStatement,
  statsSql,
  sampleSql,
  valuesSql,
  pathsSql,
  profiledColumns,
  savedJoins,
  declaredKeys,
  prefillSql,
  profileView,
};
