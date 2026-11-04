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

function sourceOf(main, names, joined = []) {
  const byName = new Map((joined || []).map((c) => [c.name, c]));
  const groups = [];
  const placed = new Map();
  for (const name of names) {
    const hit = byName.get(name);
    if (!hit || placed.has(name)) continue;
    let group = groups.find((g) => g.table.toLowerCase() === hit.table.toLowerCase() && g.key === hit.key && g.ref_column === hit.ref_column);
    if (!group) {
      group = { alias: `g${groups.length + 1}`, table: hit.table, key: hit.key, ref_column: hit.ref_column, columns: [] };
      groups.push(group);
    }
    if (!group.columns.includes(hit.column)) group.columns.push(hit.column);
    placed.set(name, `${group.alias}.${q(hit.column)}`);
  }
  const joins = groups.map((g) => `LEFT JOIN (SELECT ${q(g.ref_column)} AS inspire_key, ${g.columns.map((c) => `MAX(${q(c)}) AS ${q(c)}`).join(', ')} `
    + `FROM ${G.groupingMainTable(g.table).sql} GROUP BY ${q(g.ref_column)}) ${g.alias} ON m.${q(g.key)} = ${g.alias}.inspire_key`);
  return { from: [`${main.sql} m`, ...joins].join(' '), expr: (name) => placed.get(name) || `m.${q(name)}` };
}

function statsSql(main, columns, time, days, joined = []) {
  const src = sourceOf(main, columns, joined);
  const parts = ['COUNT(*) AS records', ...columns.flatMap((c, i) => [`approx_count_distinct(${src.expr(c)}) AS d${i}`,
    `COUNT_IF(${src.expr(c)} IS NULL OR TRIM(CAST(${src.expr(c)} AS STRING)) = '') AS n${i}`])];
  const back = Math.max(Number(days), 1) - 1;
  if (!time || !time.column) return `SELECT ${parts.join(', ')} FROM ${src.from}`;
  const t = q(time.column);
  if (!time.via) {
    parts.push(`COUNT_IF(CAST(m.${t} AS DATE) >= x.inspire_since) AS recent`);
    return `WITH x AS (SELECT date_sub(MAX(CAST(${t} AS DATE)), ${back}) AS inspire_since FROM ${main.sql}) `
      + `SELECT ${parts.join(', ')} FROM ${src.from} CROSS JOIN x`;
  }
  const ref = G.groupingMainTable(time.via.table).sql;
  const [key, date] = [q(time.via.key), `CAST(r.${q(time.via.date)} AS DATE)`];
  parts.push('COUNT(k.inspire_key) AS recent', 'MAX(kc.inspire_keys) AS recent_keys');
  return `WITH x AS (SELECT MAX(${date}) AS inspire_newest FROM ${main.sql} m JOIN ${ref} r ON m.${t} = r.${key}), `
    + `k AS (SELECT DISTINCT r.${key} AS inspire_key FROM ${ref} r CROSS JOIN x WHERE ${date} >= date_sub(x.inspire_newest, ${back}) `
    + `AND ${date} <= x.inspire_newest AND r.${key} IS NOT NULL), kc AS (SELECT COUNT(*) AS inspire_keys FROM k) `
    + `SELECT ${parts.join(', ')} FROM ${src.from} CROSS JOIN kc LEFT JOIN k ON m.${t} = k.inspire_key`;
}

function sampleSql(main, columns, joined = []) {
  const src = sourceOf(main, columns, joined);
  const c = columns.map((_name, i) => `c${i}`);
  const sizes = c.map((col, i) => `SELECT 'size' AS kind, ${i} AS coarse, -1 AS fine, COUNT(*) AS groups, SUM(n) AS records `
    + `FROM (SELECT ${col} AS v, COUNT(*) AS n FROM s GROUP BY ${col})`);
  const nests = c.flatMap((a, i) => c.map((b, j) => (i === j ? '' : `SELECT 'nest' AS kind, ${i} AS coarse, ${j} AS fine, MAX(k) AS groups, 0 AS records `
    + `FROM (SELECT ${b} AS v, COUNT(DISTINCT ${a}) AS k FROM s GROUP BY ${b})`))).filter(Boolean);
  return `WITH s AS (SELECT ${columns.map((name, i) => `${src.expr(name)} AS c${i}`).join(', ')} FROM ${src.from} LIMIT ${R.GROUP_SAMPLE_ROWS}) `
    + `${[...sizes, ...nests].join(' UNION ALL ')}`;
}

function valuesSql(main, picked, joined = []) {
  const parts = picked.map(({ name, at }) => {
    const src = sourceOf(main, [name], joined);
    return `SELECT ${at} AS col, left(CAST(${src.expr(name)} AS STRING), ${PROFILE_VALUE_CHARS}) AS value, COUNT(*) AS records `
      + `FROM ${src.from} GROUP BY ${src.expr(name)}`;
  });
  return `SELECT col, value, records FROM (${parts.join(' UNION ALL ')}) ORDER BY col, records DESC`;
}

function pathsSql(main, columns, joined = []) {
  const src = sourceOf(main, columns, joined);
  const c = columns.map((name) => src.expr(name));
  return `SELECT ${c.map((col, i) => `left(CAST(${col} AS STRING), ${PROFILE_VALUE_CHARS}) AS p${i}`).join(', ')}, COUNT(*) AS records `
    + `FROM ${src.from} GROUP BY ${c.join(', ')}`;
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

function eliteAssessmentOf(raw) {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = parseExactJson(value);
    } catch {
      value = null;
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function deepSuggestionOf(useCase) {
  const columns = R.groupByColumns(useCase && useCase.suggested_group_by);
  if (!R.groupingApplies(useCase && useCase.analytics_technique) || !columns.length) return null;
  return { columns, record_level: str(useCase.record_level).trim() || null };
}

function declaredKeys(rows) {
  const primary = (rows || []).filter((r) => r.constraint_type === 'PRIMARY KEY').map((r) => str(r.column_name)).filter(Boolean);
  const joins = (rows || []).filter((r) => r.constraint_type === 'FOREIGN KEY' && r.ref_table && r.ref_column)
    .map((r) => ({ column: str(r.column_name), ref_table: [r.ref_catalog, r.ref_schema, r.ref_table].map(str).join('.'), ref_column: str(r.ref_column),
      source: 'unity_catalog' }))
    .filter((j) => G.groupingMainTable(j.ref_table));
  return { primary: [...new Set(primary)], joins };
}

function tagsStatement(tables) {
  const named = [...new Map((tables || []).map((t) => G.groupingMainTable(t)).filter(Boolean).map((t) => [t.canonical, t])).values()];
  const byCatalog = new Map();
  for (const t of named) {
    const [catalog, schema, table] = t.canonical.split('.');
    byCatalog.set(catalog, [...(byCatalog.get(catalog) || []), [schema, table]]);
  }
  const parameters = [];
  const parts = [...byCatalog.entries()].map(([catalog, pairs]) => {
    const where = pairs.map(([schema, table]) => {
      const at = parameters.length;
      parameters.push({ name: `s${at}`, value: schema, type: 'STRING' }, { name: `t${at}`, value: table, type: 'STRING' });
      return `(schema_name = lower(:s${at}) AND table_name = lower(:t${at}))`;
    }).join(' OR ');
    return `SELECT catalog_name, schema_name, table_name, column_name, tag_name, tag_value FROM ${q(catalog)}.information_schema.column_tags WHERE ${where}`;
  });
  return parts.length ? { sql: parts.join(' UNION ALL '), parameters } : null;
}

function columnTagsOf(rows) {
  const out = {};
  for (const r of rows || []) {
    const key = [r.catalog_name, r.schema_name, r.table_name, r.column_name].map((v) => str(v).toLowerCase()).join('.');
    out[key] = { ...(out[key] || {}), [str(r.tag_name)]: str(r.tag_value) };
  }
  return out;
}

function prefillSql(main, keys, joins, groupColumns, joined = []) {
  const sql = (name) => G.groupingMainTable(name).sql;
  const canonical = (name) => (G.groupingMainTable(name) || {}).canonical || '';
  const listed = [...joins];
  const byName = new Map((joined || []).map((c) => [c.name, c]));
  const exprs = (Array.isArray(groupColumns) ? groupColumns : [groupColumns]).filter(Boolean).map((name) => {
    const hit = byName.get(name);
    if (!hit) return `m.${q(name)}`;
    let at = listed.findIndex((j) => str(j.column).toLowerCase() === hit.key.toLowerCase() && canonical(j.ref_table) === canonical(hit.table)
      && str(j.ref_column).toLowerCase() === hit.ref_column.toLowerCase());
    if (at < 0) {
      listed.push({ column: hit.key, ref_table: hit.table, ref_column: hit.ref_column });
      at = listed.length - 1;
    }
    return `j${at + 1}.${q(hit.column)}`;
  });
  const group = !exprs.length ? "'Global'" : exprs.length === 1 ? exprs[0]
    : `concat_ws('${R.GROUP_SEPARATOR}', ${exprs.map((e) => `CAST(${e} AS STRING)`).join(', ')})`;
  const lines = [`SELECT ${[...keys.map((k) => `m.${q(k)}`), `${group} AS group_name`].join(', ')}`, `FROM ${main.sql} m`];
  listed.forEach((j, i) => lines.push(`LEFT JOIN ${sql(j.ref_table)} j${i + 1} ON m.${q(j.column)} = j${i + 1}.${q(j.ref_column)}`));
  return lines.join('\n');
}

function reasonOf({ technique, qualifies, standalone, recommended, table }) {
  const named = str(technique).trim() || 'this use case';
  if (qualifies) return `Grouping applies: ${named} compares each record with the records like it, and ${recommended.join(', ')} can group ${table}.`;
  if (!R.groupingApplies(technique)) {
    return standalone ? `Grouping does not apply: ${named} looks at each record on its own, so every record is in one Global group.`
      : `Grouping does not apply: ${named} does not compare records with each other, so every record is in one Global group.`;
  }
  return `Grouping applies: ${named} compares each record with the records like it, but no column of ${table} or of a table it joins makes `
    + `${R.GROUP_MIN_GROUPS} to ${R.GROUP_MAX_GROUPS} groups with ${R.GROUP_MIN_RECORDS} records each on average, so Global is picked and every record `
    + 'is compared with every other record; choose Custom to group the records with your own SQL.';
}

function joinOf(candidate) {
  return { table: candidate.table, key: candidate.key, ref_column: candidate.ref_column };
}

function profileView({ table, technique, columns, candidates, stats, sample, values, paths, time, days, keys, joins, joined = [], readAt }) {
  const records = num(stats.records);
  const standalone = R.standaloneRecords(technique);
  const picked = profiledColumns(stats, candidates);
  const groups = groupsByColumn(values, picked);
  const dimension = new Map((joined || []).map((c) => [c.name, c]));
  const types = new Map([...(columns || []).map((c) => [str(c.column_name), str(c.data_type)]), ...[...dimension.values()].map((c) => [c.name, str(c.type)])]);
  const kept = picked.filter((p) => groups.get(p.name).size >= R.GROUP_MIN_GROUPS && groups.get(p.name).size <= R.GROUP_MAX_GROUPS);
  const keptNames = kept.map((p) => p.name);
  const { profiles, nests } = sampleProfile(sample, candidates);
  const heavy = new Set(kept.filter((p) => R.nullHeavy({ records, nulls: p.nulls })).map((p) => p.name));
  const recommended = R.recommendation(profiles.filter((p) => keptNames.includes(p.column) && !heavy.has(p.column)), nests);
  const shown = kept.map((p) => {
    const sizes = [...groups.get(p.name).values()].map((g) => g.records);
    return { name: p.name, type: types.get(p.name) || '', distinct: sizes.length, smallest: Math.min(...sizes), largest: Math.max(...sizes), nulls: p.nulls,
      parent: parentOf(p.name, groups, nests, keptNames), ...(dimension.has(p.name) ? { join: joinOf(dimension.get(p.name)) } : {}) };
  });
  const finest = recommended[recommended.length - 1];
  const partOf = (column, value) => ({ column, value, ...(dimension.has(column) ? { join: joinOf(dimension.get(column)) } : {}) });
  const sizes = finest ? [...groups.get(finest).values()].filter((g) => g.value != null) : [];
  const combos = recommended.length > 1
    ? (paths || []).map((row) => recommended.map((_c, i) => (row[`p${i}`] == null ? null : str(row[`p${i}`]))))
      .map((path, i) => ({ path, records: num(paths[i].records) })).filter((c) => c.path.every((v) => v != null && v.trim() !== ''))
    : [];
  const byValue = new Map(combos.map((c) => [c.path.join(R.GROUP_SEPARATOR), c.path]));
  const suggested = recommended.length > 1
    ? R.suggestedGroups([...byValue.keys()].map((value) => ({ value, records: combos.find((c) => c.path.join(R.GROUP_SEPARATOR) === value).records })))
      .map((g) => ({ ...g, parts: recommended.map((column, i) => partOf(column, byValue.get(g.value)[i])) }))
    : R.suggestedGroups(sizes).map((g) => ({ ...g, parts: [partOf(finest, g.value)] }));
  const applies = R.groupingApplies(technique);
  const qualifies = applies && recommended.length > 0;
  const via = time && time.column && time.via ? { table: str(time.via.table), key: str(time.via.key), date: str(time.via.date) } : null;
  const timeColumn = time && time.column && !(via && num(stats.recent_keys) > R.SCOPE_VIA_KEYS_MAX) ? str(time.column) : null;
  const recent = timeColumn ? { days, records: num(stats.recent) } : null;
  const inGroups = suggested.length ? suggested.reduce((sum, g) => sum + g.records, 0) : null;
  const firstRun = { all: records, groups: inGroups, recent: recent ? recent.records : null, records: standalone ? Math.min(records, R.SCOPE_RECORDS) : null };
  const keyColumns = keys.primary.length ? keys.primary : R.keyColumnGuess(columns);
  const prefillJoins = joins.length ? joins : keys.joins;
  const main = G.groupingMainTable(table);
  const start = finest || keptNames[0] || candidates[0] || '';
  const wholeColumn = standalone ? null : finest || keptNames[0] || null;
  const wholeSizes = wholeColumn ? [...groups.get(wholeColumn).values()].filter((g) => g.value != null) : [];
  return {
    table,
    records,
    applies,
    qualifies,
    reason: reasonOf({ technique, qualifies, standalone, recommended, table }),
    standalone,
    columns: shown,
    recommended,
    example: exampleOf(recommended, groups, paths),
    time_column: timeColumn || null,
    time_via: timeColumn ? via : null,
    recent,
    suggested_groups: suggested,
    group_column: wholeColumn,
    group_sizes: wholeSizes.filter((g) => g.records >= R.GROUP_MIN_RECORDS).sort((a, b) => b.records - a.records || (a.value < b.value ? -1 : 1)).slice(0, R.GROUP_MAX_GROUPS)
      .map((g) => ({ value: g.value, records: g.records })),
    first_run: firstRun,
    default_scope: R.firstRunDefault({ records }),
    prefill: { key_columns: keyColumns, joins: prefillJoins, sql: prefillSql(main, keyColumns, prefillJoins, start, joined) },
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
  eliteAssessmentOf,
  deepSuggestionOf,
  declaredKeys,
  tagsStatement,
  columnTagsOf,
  prefillSql,
  profileView,
};
