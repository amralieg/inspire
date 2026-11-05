const { RUN_SCOPES } = require('../../frontend/src/lib/runScope.js');
const { PERSONAL_NAME_RE, PERSONAL_TAG_RE, personalColumn } = require('../../frontend/src/lib/personalColumns.js');
const { technique_records: TECHNIQUE_RECORDS } = require('../../agent/agent/app_shell/kinds.json');
const GROUP_BY = 'group_by';
const GROUP_LABEL = 'Data groups';
const GROUP_ALL = 'all';
const GROUP_CUSTOM = 'custom';
const GROUP_GLOBAL = 'Global';
const GROUP_OTHER = 'Other groups';
const GROUP_NONE = 'No group';
const GROUP_SEPARATOR = ' / ';
const GROUP_MIN_RECORDS = 30;
const GROUP_MIN_PERIODS = 30;
const GROUP_MAX_GROUPS = 500;
const GROUP_MIN_GROUPS = 2;
const FIRST_RUN_DEFAULT = 'records';
const SUGGESTED_GROUPS = 3;
const SCOPE_DAYS = 30;
const SCOPE_RECORDS = 1000;
const SCOPE_VIA_KEYS_MAX = 10000;
const GROUP_MAX_NULL_SHARE = 0.5;
const GROUP_CANDIDATES = 12;
const GROUP_PROFILED = 6;
const GROUP_SAMPLE_ROWS = 100000;
const TECHNIQUE_RECORD_KINDS = ['groups', 'alone', 'together'];
const GROUP_ID_RE = /(?:^|_)(?:id|key|uuid|guid|sk|nk|hash)$/i;
const GROUP_TYPES = ['string', 'varchar', 'char', 'boolean'];
const GROUP_KEY_TYPES = ['int', 'integer', 'bigint', 'smallint', 'tinyint', 'long', 'short', 'byte', 'string', 'varchar', 'char'];
const TIME_TYPES = ['date', 'timestamp'];
const TIME_NAME_RE = /(date|time|day)|_at$|_ts$/i;
const TEXT_NAME_TOKENS = ['text', 'comment', 'review', 'description', 'desc', 'note', 'feedback', 'transcript', 'body', 'message', 'title', 'subject',
  'content', 'reason', 'summary', 'narrative', 'remark'];

const str = (v) => (v == null ? '' : String(v));
const lower = (v) => str(v).toLowerCase();
const whole = (v) => {
  const n = Number.parseInt(str(v), 10);
  return Number.isFinite(n) ? n : 0;
};

function techniqueRecords(technique) {
  const label = lower(technique).split(/\s+/).filter(Boolean).join(' ');
  const key = Object.keys(TECHNIQUE_RECORDS).find((name) => name.toLowerCase() === label);
  return key === undefined ? '' : TECHNIQUE_RECORDS[key];
}

const groupingApplies = (technique) => techniqueRecords(technique) === 'groups';
const standaloneRecords = (technique) => techniqueRecords(technique) === 'alone';

function groupByParts(text) {
  const picked = [];
  for (const part of str(text).split(',')) {
    const name = part.trim();
    if (name && !picked.some((seen) => seen.toLowerCase() === name.toLowerCase())) picked.push(name);
  }
  return picked;
}

function groupByMode(text) {
  const picked = groupByParts(text);
  const lowered = picked.map((name) => name.toLowerCase());
  if (lowered.includes(GROUP_CUSTOM)) return { mode: GROUP_CUSTOM, columns: picked };
  if (lowered.includes(GROUP_ALL) && picked.length > 1) return { mode: 'mixed', columns: picked };
  if (!picked.length || lowered.includes(GROUP_ALL)) return { mode: GROUP_ALL, columns: [] };
  return { mode: 'columns', columns: picked };
}

function groupByColumns(text) {
  const { mode, columns } = groupByMode(text);
  return mode === 'columns' ? columns : [];
}

const groupMinimum = (timeSeries) => (timeSeries ? GROUP_MIN_PERIODS : GROUP_MIN_RECORDS);

function groupPart(column, value) {
  if (value == null || (typeof value === 'number' && Number.isNaN(value))) return `no ${column}`;
  return str(value).trim() || `no ${column}`;
}

function periodSet(item, timeSeries) {
  if (!timeSeries) return new Set();
  const [lo, hi] = (item.periods || []).map(whole);
  const out = new Set();
  for (let p = lo; p <= hi; p += 1) out.add(p);
  return out;
}

function effectiveGroups(groupBy, groups, timeSeries = false) {
  const columns = groupByColumns(groupBy);
  const rows = (groups || []).map((item) => ({ path: [...(item.path || [])], records: whole(item.records), periods: periodSet(item, timeSeries) }));
  const settled = rows.map(() => null);
  for (let depth = columns.length; depth > 0; depth -= 1) {
    const keys = rows.map((row) => columns.slice(0, depth).slice(0, row.path.length).map((column, at) => groupPart(column, row.path[at])));
    const pools = new Map();
    rows.forEach((row, at) => {
      if (settled[at]) return;
      const id = JSON.stringify(keys[at]);
      const pool = pools.get(id) || { records: 0, periods: new Set() };
      pool.records += row.records;
      row.periods.forEach((p) => pool.periods.add(p));
      pools.set(id, pool);
    });
    rows.forEach((row, at) => {
      if (settled[at]) return;
      const pool = pools.get(JSON.stringify(keys[at]));
      if (pool && (timeSeries ? pool.periods.size : pool.records) >= groupMinimum(timeSeries)) {
        settled[at] = { group: keys[at].join(GROUP_SEPARATOR), level: columns[depth - 1] };
      }
    });
  }
  return rows.map((row, at) => ({ path: row.path, group: settled[at] ? settled[at].group : GROUP_GLOBAL, level: settled[at] ? settled[at].level : GROUP_ALL }));
}

function columnUsable(profile) {
  const groups = whole(profile && profile.groups);
  const records = whole(profile && profile.records);
  return groups >= GROUP_MIN_GROUPS && groups <= GROUP_MAX_GROUPS && records >= groups * GROUP_MIN_RECORDS;
}

function nullHeavy(profile) {
  const records = whole(profile && profile.records);
  return records > 0 && whole(profile && profile.nulls) > records * GROUP_MAX_NULL_SHARE;
}

function recommendation(profiles, nests = []) {
  const nested = new Set((nests || []).filter((n) => n[2]).map(([coarse, fine]) => `${lower(coarse)}\u0000${lower(fine)}`));
  const usable = (profiles || []).filter(columnUsable).sort((a, b) => {
    const byGroups = whole(a.groups) - whole(b.groups);
    if (byGroups) return byGroups;
    const x = lower(a.column);
    const y = lower(b.column);
    return x < y ? -1 : x > y ? 1 : 0;
  });
  const picked = [];
  for (const profile of usable) {
    if (!picked.length || nested.has(`${lower(picked[picked.length - 1])}\u0000${lower(profile.column)}`)) picked.push(str(profile.column));
  }
  return picked;
}

const baseType = (kind) => lower(kind).replace(/\(.*$/, '').trim();
const textColumn = (name, kind) => GROUP_TYPES.some((t) => lower(kind).startsWith(t)) && !GROUP_ID_RE.test(name)
  && !TEXT_NAME_TOKENS.some((token) => lower(name).includes(token));
const keyColumn = (name, kind) => GROUP_KEY_TYPES.includes(baseType(kind)) && GROUP_ID_RE.test(name) && !TIME_NAME_RE.test(name);

function useCaseWords(text) {
  const words = new Set();
  for (const word of lower(text).split(/[^a-z0-9]+/).filter(Boolean)) {
    words.add(word);
    if (word.endsWith('ies')) words.add(`${word.slice(0, -3)}y`);
    else if (word.endsWith('s')) words.add(word.slice(0, -1));
  }
  return words;
}

function candidateRelevance(name, words) {
  const column = str(name).split('.').pop();
  return lower(column).split(/[^a-z0-9]+/).filter((token) => token.length >= 3 && words.has(token)).length;
}

function columnTags(tags, table, column) {
  return (tags || {})[`${lower(str(table).replace(/`/g, ''))}.${lower(column)}`] || {};
}

function joinedCandidates(joins, refColumns = {}, tags = {}, timeTable = '') {
  const out = [];
  const seenTables = new Set();
  for (const join of joins || []) {
    const ref = joinRef(join);
    if (!ref || seenTables.has(ref.toLowerCase()) || TIME_NAME_RE.test(str(join.column)) || ref.toLowerCase() === lower(timeTable)) continue;
    seenTables.add(ref.toLowerCase());
    const short = ref.split('.').pop();
    for (const column of refColumns[ref.toLowerCase()] || []) {
      const name = str(column && column.column_name);
      const shown = `${short}.${name}`;
      if (!name || !textColumn(name, column.data_type) || personalColumn(name, columnTags(tags, ref, name))) continue;
      if (out.some((c) => lower(c.name) === lower(shown))) continue;
      out.push({ name: shown, table: ref, column: name, type: str(column.data_type), key: str(join.column), ref_column: str(join.ref_column) });
    }
  }
  return out;
}

function joinedTables(joins) {
  const out = [];
  for (const join of joins || []) {
    const ref = joinRef(join);
    if (ref && !TIME_NAME_RE.test(str(join.column)) && !out.some((t) => t.toLowerCase() === ref.toLowerCase())) out.push(ref);
  }
  return out.slice(0, GROUP_CANDIDATES);
}

function groupingCandidates(columns, roles = {}, mainTable = '', { primary = [], joined = [], text = '', time = '', tags = {} } = {}) {
  const plain = (ref) => str(ref).replace(/`/g, '');
  const main = lower(plain(mainTable));
  const own = {};
  for (const [role, ref] of Object.entries(roles || {})) {
    const parts = plain(ref).split('.');
    if (parts.slice(0, 3).join('.').toLowerCase() === main) own[role] = parts[parts.length - 1].toLowerCase();
  }
  const skip = new Set([...['entity_id', 'event_date', 'measure', 'label'].map((role) => own[role]), ...(primary || []).map(lower), lower(time)].filter(Boolean));
  const segment = [];
  const texts = [];
  const keys = [];
  const seen = new Set();
  for (const column of columns || []) {
    const name = str(column && column.column_name);
    const kind = column && column.data_type;
    if (!name || skip.has(name.toLowerCase()) || seen.has(name) || personalColumn(name, columnTags(tags, mainTable, name))) continue;
    seen.add(name);
    if (name.toLowerCase() === own.segment) segment.push(name);
    else if (textColumn(name, kind)) texts.push(name);
    else if (keyColumn(name, kind)) keys.push(name);
  }
  const lanes = [texts, keys, (joined || []).map((c) => str(c.name)).filter(Boolean)];
  const fair = [];
  for (let at = 0; lanes.some((lane) => at < lane.length); at += 1) lanes.forEach((lane) => { if (at < lane.length) fair.push(lane[at]); });
  const words = useCaseWords(text);
  const ranked = fair.map((name, at) => ({ name, at, score: candidateRelevance(name, words) })).sort((a, b) => b.score - a.score || a.at - b.at);
  return [...segment, ...ranked.map((c) => c.name)].slice(0, GROUP_CANDIDATES);
}

function ownColumn(reference, table) {
  const parts = str(reference).split('.').map((p) => p.replace(/`/g, '')).filter(Boolean);
  const held = lower(str(table).replace(/`/g, '')).split('.').map((p) => p.trim());
  const named = parts.slice(0, -1).map(lower);
  return named.length >= 1 && named.length <= 3 && held.slice(held.length - named.length).join('.') === named.join('.') ? parts[parts.length - 1] : '';
}

function namedTimeColumn(roles, assessment, table) {
  const via = assessment && assessment.time_via_join;
  return ownColumn(roles && roles.event_date, table) || ownColumn(via && typeof via === 'object' ? via.key : '', table)
    || ownColumn(assessment && assessment.time_column, table);
}

const dated = (c) => TIME_TYPES.some((t) => lower(c && c.data_type).startsWith(t));

function joinRef(join) {
  const parts = str(join && join.ref_table).replace(/`/g, '').split('.').map((p) => p.trim());
  return parts.length === 3 && parts.every(Boolean) ? parts.join('.') : '';
}

function timeSourceOf(named, columns, joins = [], refColumns = {}) {
  const known = (columns || []).filter((c) => str(c && c.column_name));
  if (!known.length) return named ? { column: str(named), via: null } : null;
  const viaOf = (column) => {
    for (const join of joins || []) {
      const ref = joinRef(join);
      if (lower(join && join.column) !== lower(column) || !str(join.ref_column) || !ref) continue;
      const found = (refColumns[ref.toLowerCase()] || []).filter(dated).map((c) => str(c.column_name));
      const date = found.find((n) => TIME_NAME_RE.test(n)) || found[0];
      if (date) return { table: ref, key: str(join.ref_column), date };
    }
    return null;
  };
  const sourceOf = (column) => {
    if (!column) return null;
    const via = dated(column) ? null : viaOf(str(column.column_name));
    return dated(column) || via ? { column: str(column.column_name), via } : null;
  };
  const hit = sourceOf(named ? known.find((c) => lower(c.column_name) === lower(named)) : null);
  if (hit) return hit;
  const timed = known.filter(dated);
  const direct = timed.find((c) => TIME_NAME_RE.test(str(c.column_name))) || timed[0];
  if (direct) return sourceOf(direct);
  for (const column of known.filter((c) => TIME_NAME_RE.test(str(c.column_name)))) {
    const found = sourceOf(column);
    if (found) return found;
  }
  return null;
}

function timeRefsOf(named, columns, joins = []) {
  const asked = new Set((columns || []).map((c) => str(c && c.column_name)).filter((n) => TIME_NAME_RE.test(n) || (named && lower(n) === lower(named)))
    .map(lower));
  return [...new Set((joins || []).filter((j) => asked.has(lower(j && j.column)) && joinRef(j)).map(joinRef))].sort();
}

function suggestedGroups(values) {
  const big = (values || []).filter((v) => whole(v.records) >= GROUP_MIN_RECORDS)
    .sort((a, b) => whole(b.records) - whole(a.records) || (str(a.value) < str(b.value) ? -1 : str(a.value) > str(b.value) ? 1 : 0));
  if (!big.length) return [];
  const kinds = [[0, 'biggest'], [Math.floor((big.length - 1) / 2), 'typical'], [big.length - 1, 'smallest']];
  const out = [];
  for (const [at, kind] of kinds) {
    if (!out.some((o) => o.value === str(big[at].value))) out.push({ value: str(big[at].value), records: whole(big[at].records), kind });
  }
  return out.slice(0, SUGGESTED_GROUPS);
}

module.exports = {
  GROUP_BY,
  GROUP_LABEL,
  GROUP_ALL,
  GROUP_CUSTOM,
  GROUP_GLOBAL,
  GROUP_OTHER,
  GROUP_NONE,
  GROUP_SEPARATOR,
  GROUP_MIN_RECORDS,
  GROUP_MIN_PERIODS,
  GROUP_MAX_GROUPS,
  GROUP_MIN_GROUPS,
  FIRST_RUN_DEFAULT,
  SUGGESTED_GROUPS,
  SCOPE_DAYS,
  SCOPE_RECORDS,
  SCOPE_VIA_KEYS_MAX,
  GROUP_MAX_NULL_SHARE,
  GROUP_CANDIDATES,
  GROUP_PROFILED,
  GROUP_SAMPLE_ROWS,
  TECHNIQUE_RECORDS,
  TECHNIQUE_RECORD_KINDS,
  techniqueRecords,
  RUN_SCOPES,
  TEXT_NAME_TOKENS,
  groupingApplies,
  standaloneRecords,
  groupByParts,
  groupByMode,
  groupByColumns,
  groupMinimum,
  groupPart,
  effectiveGroups,
  columnUsable,
  nullHeavy,
  recommendation,
  GROUP_KEY_TYPES,
  PERSONAL_NAME_RE,
  PERSONAL_TAG_RE,
  personalColumn,
  joinedTables,
  joinedCandidates,
  groupingCandidates,
  ownColumn,
  namedTimeColumn,
  timeSourceOf,
  timeRefsOf,
  suggestedGroups,
};
