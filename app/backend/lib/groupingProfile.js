const G = require('../../frontend/src/lib/tableName.js');
const R = require('./groupingRule');
const { parseExactJson } = require('./exactJson');
const { plural } = require('./plural');
const { compileExpression } = require('../../agent/agent/app_shell/web/src/moneyValue.js');

const PROFILE_MS = 60000;
const PROFILE_DAYS_MAX = 3650;
const PROFILE_VALUE_CHARS = 200;
const PROFILE_APPROX_MARGIN = 1.1;
const PROFILE_EXAMPLE_GROUPS = 5;
const PROFILE_APPROX_MAX = Math.ceil(R.GROUP_MAX_GROUPS * PROFILE_APPROX_MARGIN);
const PROFILE_VALUE_ROWS = (PROFILE_APPROX_MAX + 1) * R.GROUP_PROFILED;
const PROFILE_PATH_ROWS = 2000;
const PROFILE_META_ROWS = 2000;
const PROFILE_BYTE_LIMIT = 1048576;

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

const MONEY_AMOUNT = /amount|value|total|revenue|price|cost|sales|fare|loss|spend/i;
const NUMERIC_TYPE = /^(DECIMAL|DOUBLE|FLOAT|INT|BIGINT|SMALLINT|TINYINT|LONG|REAL|NUMERIC)/i;
const CURRENCY_NAME = /currency/i;
const STATUS_NAME = /status/i;
const MONEY_SAMPLE_ROWS = 3;

// The three example rows the wizard's Measure step works through: the first amount-like numeric column, then its currency and status.
function moneySampleColumns(columns) {
  const named = (columns || []).map((c) => ({ name: str(c.column_name), type: str(c.data_type) })).filter((c) => c.name);
  const amount = named.find((c) => NUMERIC_TYPE.test(c.type) && MONEY_AMOUNT.test(c.name));
  if (!amount) return null;
  const currency = named.find((c) => CURRENCY_NAME.test(c.name));
  const status = named.find((c) => STATUS_NAME.test(c.name));
  return { amount: amount.name, currency: currency ? currency.name : '', status: status ? status.name : '' };
}

function moneySampleSql(main, pick) {
  const cols = [pick.amount, pick.currency, pick.status, pick.rate].filter(Boolean).map((c) => q(c));
  return `SELECT ${cols.join(', ')} FROM ${main.sql} LIMIT ${MONEY_SAMPLE_ROWS}`;
}

const RATE_TABLE_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*){0,2}$/;

const RATE_COLUMN_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const RATE_SAMPLE_ROWS = 3;

const CURRENCY_SPREAD_ROWS = 10000;
const MONEY_VALUE_ROWS = 3;
const ISO_CODE = /^[A-Z]{3}$/;

// Every currency the use case table holds, with its row count, most rows first: the Measure step lists one rate per currency.
function currencySpreadSql(table, currencyColumn) {
  if (!RATE_TABLE_PATTERN.test(String(table || '')) || !RATE_COLUMN_PATTERN.test(String(currencyColumn || ''))) return null;
  return `SELECT ${q(currencyColumn)} AS currency, COUNT(*) AS records FROM ${G.groupingMainTable(table).sql} `
    + `WHERE ${q(currencyColumn)} IS NOT NULL GROUP BY ${q(currencyColumn)} ORDER BY records DESC`;
}

// Three rows of the use case table through a value definition: the amount each row is worth, and its currency.
function moneyValueSampleSql(table, value) {
  if (!RATE_TABLE_PATTERN.test(String(table || '')) || !value || typeof value !== 'object') return null;
  let amount = null;
  if (value.method === 'fixed' && Number.isFinite(Number(value.amount)) && Number(value.amount) > 0) amount = String(Number(value.amount));
  else if (value.method === 'column' && RATE_COLUMN_PATTERN.test(String(value.column || ''))) amount = q(value.column);
  else if (value.method === 'equation') {
    const compiled = compileExpression(value.expression, q);
    if (!compiled.problem) amount = compiled.sql;
  }
  if (amount === null) return null;
  let currency = null;
  if (value.currency !== undefined && ISO_CODE.test(String(value.currency))) currency = `'${value.currency}'`;
  else if (value.currency_column !== undefined && RATE_COLUMN_PATTERN.test(String(value.currency_column))) currency = q(value.currency_column);
  if (currency === null) return null;
  return `SELECT CAST(${amount} AS DOUBLE) AS stake, ${currency} AS currency FROM ${G.groupingMainTable(table).sql} `
    + `WHERE ${amount} IS NOT NULL LIMIT ${MONEY_VALUE_ROWS}`;
}

// The latest rate loaded for up to three currencies, into the base currency: the example reads real numbers from the rate table.
function rateSampleSql(rateTable, base) {
  const t = rateTable || {};
  const names = ['currency_column', 'base_column', 'rate_column', 'load_column'];
  if (!RATE_TABLE_PATTERN.test(String(t.table || '')) || !/^[A-Z]{3}$/.test(String(base || ''))
    || names.some((k) => !RATE_COLUMN_PATTERN.test(String(t[k] || '')))) return null;
  return `SELECT currency, rate FROM (SELECT ${q(t.currency_column)} AS currency, CAST(${q(t.rate_column)} AS DOUBLE) AS rate, `
    + `ROW_NUMBER() OVER (PARTITION BY ${q(t.currency_column)} ORDER BY ${q(t.load_column)} DESC) AS latest `
    + `FROM ${G.groupingMainTable(t.table).sql} WHERE ${q(t.base_column)} = '${String(base)}') AS ranked WHERE latest = 1 LIMIT ${RATE_SAMPLE_ROWS}`;
}

// The three latest rates from a rate column of the use case table: the example reads real numbers for a rate column too.
function rateColumnSampleSql(table, currencyColumn, rateColumn) {
  if (!RATE_TABLE_PATTERN.test(String(table || '')) || !RATE_COLUMN_PATTERN.test(String(currencyColumn || ''))
    || !RATE_COLUMN_PATTERN.test(String(rateColumn || ''))) return null;
  const main = G.groupingMainTable(table).sql;
  return `SELECT ${q(currencyColumn)} AS currency, CAST(${q(rateColumn)} AS DOUBLE) AS rate FROM ${main} `
    + `WHERE ${q(rateColumn)} IS NOT NULL LIMIT ${RATE_SAMPLE_ROWS}`;
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

function overLimitOf(candidates, stats, groups) {
  return candidates.map((name, at) => (groups.has(name) ? { name, groups: groups.get(name).size, about: false } : { name, groups: num(stats[`d${at}`]), about: true }))
    .filter((c) => c.groups > R.GROUP_MAX_GROUPS);
}

function overLimitText(over) {
  const limit = `the ${R.GROUP_MAX_GROUPS} Inspire models one by one`;
  const size = (c) => `${c.about ? 'about ' : ''}${plural(c.groups, 'group')}`;
  if (!over.length) return '';
  if (over.length === 1) return ` ${over[0].name} makes ${size(over[0])}, more than ${limit}.`;
  return ` These columns make more groups than ${limit}: ${over.map((c) => `${c.name}, ${size(c)}`).join('; ')}.`;
}

function reasonOf({ technique, qualifies, standalone, recommended, table, groups, records, over, bySubject = false }) {
  const named = str(technique).trim() || 'this use case';
  if (qualifies && bySubject) {
    return `Inspire recommends ${recommended.join(', then ')} because the use case names ${recommended[recommended.length - 1]}, and that column splits `
      + `${table} into ${groups} groups.${overLimitText(over)}`;
  }
  if (qualifies) {
    return `Inspire recommends ${recommended.join(', then ')} because ${named} works out what is normal inside each group, and ${recommended[recommended.length - 1]} `
      + `splits ${table} into ${groups} groups.${overLimitText(over)}`;
  }
  if (!R.techniqueRecords(technique)) return `Data groups do not apply: ${named} is not a technique in Inspire's technique table, so every record is in one group.`;
  if (!R.groupingApplies(technique)) {
    return standalone ? `Data groups do not apply: ${named} looks at each record on its own, so every record is in one group.`
      : `Data groups do not apply: ${named} does not work out what is normal inside groups, so every record is in one group.`;
  }
  if (records === 0) return `Inspire recommends the whole data as one group because ${table} holds no records yet, so no column can split it into groups.`;
  return `Inspire recommends the whole data as one group because no column of ${table} or of a table it joins splits it into ${R.GROUP_MIN_GROUPS} to `
    + `${R.GROUP_MAX_GROUPS} groups with ${R.GROUP_MIN_RECORDS} records each on average.${overLimitText(over)}`;
}

function namedIn(subject, column) {
  const said = str(subject).toLowerCase();
  const name = str(column).trim().toLowerCase();
  if (!name) return false;
  return [name, name.replace(/_/g, ' ')].some((word) => new RegExp(`(^|[^a-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(said));
}

function joinOf(candidate) {
  return { table: candidate.table, key: candidate.key, ref_column: candidate.ref_column };
}

function keptColumns(asked, keptNames, skip = new Set()) {
  const kept = new Map(keptNames.filter((n) => !skip.has(n)).map((n) => [n.toLowerCase(), n]));
  const named = (asked || []).map((c) => kept.get(str(c).trim().toLowerCase()));
  return named.length && named.every(Boolean) && new Set(named).size === named.length ? named : null;
}

function bySize(list) {
  return list.sort((a, b) => b.records - a.records || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
}

function profileView({ table, technique, columns, candidates, stats, sample, values, paths, time, days, joined = [], deep = [], groupBy = [], readAt, subject = '' }) {
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
  const named = keptNames.filter((n) => !heavy.has(n) && namedIn(subject, n));
  const discovered = keptColumns(deep, keptNames, heavy);
  const bySubject = !discovered && named.length > 0;
  const recommended = discovered || (bySubject ? [named[0]] : R.recommendation(profiles.filter((p) => keptNames.includes(p.column) && !heavy.has(p.column)), nests));
  const grouped = keptColumns(groupBy, keptNames) || recommended;
  const shown = kept.map((p) => {
    const sizes = [...groups.get(p.name).values()].map((g) => g.records);
    return { name: p.name, type: types.get(p.name) || '', distinct: sizes.length, smallest: Math.min(...sizes), largest: Math.max(...sizes), nulls: p.nulls,
      parent: parentOf(p.name, groups, nests, keptNames), ...(dimension.has(p.name) ? { join: joinOf(dimension.get(p.name)) } : {}) };
  });
  const columnGroups = Object.fromEntries(keptNames.map((name) => [name, bySize([...groups.get(name).values()].filter((g) => g.value != null)
    .map((g) => ({ value: g.value, records: g.records }))).slice(0, R.GROUP_MAX_GROUPS)]));
  const finest = grouped[grouped.length - 1];
  const partOf = (column, value) => ({ column, value, ...(dimension.has(column) ? { join: joinOf(dimension.get(column)) } : {}) });
  const sizes = finest ? [...groups.get(finest).values()].filter((g) => g.value != null) : [];
  const combos = grouped.length > 1
    ? (paths || []).map((row) => grouped.map((_c, i) => (row[`p${i}`] == null ? null : str(row[`p${i}`]))))
      .map((path, i) => ({ path, records: num(paths[i].records) })).filter((c) => c.path.every((v) => v != null && v.trim() !== ''))
    : [];
  const byValue = new Map(combos.map((c) => [c.path.join(R.GROUP_SEPARATOR), c.path]));
  const groupList = grouped.length > 1
    ? bySize(combos.map((c) => ({ value: c.path.join(R.GROUP_SEPARATOR), records: c.records, parts: grouped.map((column, i) => partOf(column, c.path[i])) })))
    : bySize(sizes.map((g) => ({ value: g.value, records: g.records, parts: [partOf(finest, g.value)] })));
  const suggested = grouped.length > 1
    ? R.suggestedGroups([...byValue.keys()].map((value) => ({ value, records: combos.find((c) => c.path.join(R.GROUP_SEPARATOR) === value).records })))
      .map((g) => ({ ...g, parts: grouped.map((column, i) => partOf(column, byValue.get(g.value)[i])) }))
    : R.suggestedGroups(sizes).map((g) => ({ ...g, parts: [partOf(finest, g.value)] }));
  const applies = R.groupingApplies(technique);
  const qualifies = applies && recommended.length > 0;
  const via = time && time.column && time.via ? { table: str(time.via.table), key: str(time.via.key), date: str(time.via.date) } : null;
  const timeColumn = time && time.column && !(via && num(stats.recent_keys) > R.SCOPE_VIA_KEYS_MAX) ? str(time.column) : null;
  const recent = timeColumn ? { days, records: num(stats.recent) } : null;
  const inGroups = suggested.length ? suggested.reduce((sum, g) => sum + g.records, 0) : null;
  const firstRun = { all: records, groups: inGroups, recent: recent ? recent.records : null, records: standalone ? Math.min(records, R.SCOPE_RECORDS) : null };
  const wholeColumn = standalone ? null : [...grouped].reverse().find((c) => !dimension.has(c)) || finest || keptNames[0] || null;
  const wholeSizes = wholeColumn ? [...groups.get(wholeColumn).values()].filter((g) => g.value != null) : [];
  const recommendedGroups = recommended.length ? groups.get(recommended[recommended.length - 1]).size : 0;
  return {
    table,
    records,
    applies,
    qualifies,
    reason: reasonOf({ technique, qualifies, standalone, recommended, table, groups: recommendedGroups, records, over: overLimitOf(candidates, stats, groups), bySubject: bySubject && qualifies }),
    recommended_by: qualifies ? (discovered ? 'discovery' : bySubject ? 'use_case' : 'statistics') : '',
    standalone,
    columns: shown,
    recommended: applies ? recommended : [],
    example: applies ? exampleOf(recommended, groups, grouped.join(',') === recommended.join(',') ? paths : null) : null,
    time_column: timeColumn || null,
    time_via: timeColumn ? via : null,
    recent,
    suggested_groups: suggested,
    group_column: wholeColumn,
    group_sizes: wholeSizes.filter((g) => g.records >= R.GROUP_MIN_RECORDS).sort((a, b) => b.records - a.records || (a.value < b.value ? -1 : 1)).slice(0, R.GROUP_MAX_GROUPS)
      .map((g) => ({ value: g.value, records: g.records })),
    groups_for: grouped.join(', '),
    group_list: groupList.slice(0, R.GROUP_MAX_GROUPS),
    group_count: groupList.length,
    group_max: R.GROUP_MAX_GROUPS,
    column_groups: columnGroups,
    first_run: firstRun,
    default_scope: R.FIRST_RUN_DEFAULT,
    read_at: readAt,
  };
}

module.exports = {
  currencySpreadSql,
  moneyValueSampleSql,
  CURRENCY_SPREAD_ROWS,
  MONEY_VALUE_ROWS,
  rateColumnSampleSql,
  rateSampleSql,
  RATE_SAMPLE_ROWS,
  moneySampleColumns,
  moneySampleSql,
  MONEY_SAMPLE_ROWS,
  PROFILE_MS,
  PROFILE_DAYS_MAX,
  PROFILE_APPROX_MAX,
  PROFILE_VALUE_ROWS,
  PROFILE_PATH_ROWS,
  PROFILE_META_ROWS,
  PROFILE_BYTE_LIMIT,
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
  profileView,
};
