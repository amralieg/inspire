const GROUP_BY = 'group_by';
const GROUP_LABEL = 'Grouping';
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
const FIRST_RUN_RECORDS_LINE = 1000;
const SUGGESTED_GROUPS = 3;
const SCOPE_DAYS = 30;
const SCOPE_RECORDS = 1000;
const GROUP_MAX_NULL_SHARE = 0.5;
const GROUP_CANDIDATES = 12;
const GROUP_PROFILED = 6;
const GROUP_SAMPLE_ROWS = 100000;
const GROUP_TECHNIQUES = ['anomal', 'outlier', 'forecast', 'predict', 'threshold', 'benchmark', 'rank', 'propensity', 'churn', 'cluster', 'segment',
  'baseline', 'deviation', 'trend'];
const STANDALONE_TECHNIQUES = ['classif', 'extract', 'summar', 'sentiment', 'tag', 'categor', 'entity', 'translat', 'document'];
const RUN_SCOPES = ['all', 'groups', 'recent', 'records'];
const GROUP_ID_RE = /(?:^|_)(?:id|key|uuid|guid|sk|nk|hash)$/i;
const GROUP_TYPES = ['string', 'varchar', 'char', 'boolean'];
const TIME_TYPES = ['date', 'timestamp'];
const TEXT_NAME_TOKENS = ['text', 'comment', 'review', 'description', 'desc', 'note', 'feedback', 'transcript', 'body', 'message', 'title', 'subject',
  'content', 'reason', 'summary', 'narrative', 'remark'];

const str = (v) => (v == null ? '' : String(v));
const lower = (v) => str(v).toLowerCase();
const whole = (v) => {
  const n = Number.parseInt(str(v), 10);
  return Number.isFinite(n) ? n : 0;
};

function techniqueHas(technique, words) {
  const text = lower(technique);
  return words.some((word) => text.includes(word));
}

const groupingApplies = (technique) => techniqueHas(technique, GROUP_TECHNIQUES);
const standaloneRecords = (technique) => techniqueHas(technique, STANDALONE_TECHNIQUES);

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
  const solo = [GROUP_ALL, GROUP_CUSTOM].filter((name) => lowered.includes(name));
  if (solo.length && picked.length > 1) return { mode: 'mixed', columns: picked };
  if (!picked.length || (solo.length === 1 && solo[0] === GROUP_ALL)) return { mode: GROUP_ALL, columns: [] };
  if (solo.length === 1 && solo[0] === GROUP_CUSTOM) return { mode: GROUP_CUSTOM, columns: [] };
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

function customGroupNames(sizes) {
  return Object.fromEntries(Object.entries(sizes || {}).map(([name, size]) => [str(name), whole(size) >= GROUP_MIN_RECORDS ? str(name) : GROUP_OTHER]));
}

function groupingCandidates(columns, roles = {}, mainTable = '') {
  const plain = (ref) => str(ref).replace(/`/g, '');
  const main = lower(plain(mainTable));
  const own = {};
  for (const [role, ref] of Object.entries(roles || {})) {
    const parts = plain(ref).split('.');
    if (parts.slice(0, 3).join('.').toLowerCase() === main) own[role] = parts[parts.length - 1].toLowerCase();
  }
  const skip = new Set(['entity_id', 'event_date', 'measure', 'label'].map((role) => own[role]).filter(Boolean));
  const picked = [];
  for (const column of columns || []) {
    const name = str(column && column.column_name);
    const kind = lower(column && column.data_type);
    if (!name || skip.has(name.toLowerCase()) || picked.includes(name)) continue;
    if (name.toLowerCase() === own.segment) picked.unshift(name);
    else if (GROUP_TYPES.some((t) => kind.startsWith(t)) && !GROUP_ID_RE.test(name) && !TEXT_NAME_TOKENS.some((token) => name.toLowerCase().includes(token))) {
      picked.push(name);
    }
  }
  return picked.slice(0, GROUP_CANDIDATES);
}

function timeColumnOf(columns, roles = {}, mainTable = '') {
  const event = str(roles && roles.event_date).replace(/`/g, '').split('.');
  const named = (columns || []).map((c) => str(c && c.column_name));
  if (event.length > 3 && event.slice(0, 3).join('.').toLowerCase() === lower(str(mainTable).replace(/`/g, ''))) {
    const hit = named.find((n) => n.toLowerCase() === event[event.length - 1].toLowerCase());
    if (hit) return hit;
  }
  const timed = (columns || []).filter((c) => TIME_TYPES.some((t) => lower(c && c.data_type).startsWith(t))).map((c) => str(c.column_name));
  return timed.find((n) => /(date|time|day)|_at$|_ts$/i.test(n)) || timed[0] || null;
}

function keyColumnGuess(columns) {
  const named = (columns || []).map((c) => str(c && c.column_name)).filter(Boolean);
  const hit = named.find((n) => n.toLowerCase() === 'id') || named.find((n) => /(?:^|_)id$/i.test(n)) || named.find((n) => GROUP_ID_RE.test(n)) || named[0];
  return hit ? [hit] : [];
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

function firstRunDefault({ records, groups, recent, standalone }) {
  if (whole(records) <= FIRST_RUN_RECORDS_LINE) return 'all';
  if (whole(groups) > 0) return 'groups';
  if (whole(recent) > 0) return 'recent';
  if (standalone) return 'records';
  return 'all';
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
  FIRST_RUN_RECORDS_LINE,
  SUGGESTED_GROUPS,
  SCOPE_DAYS,
  SCOPE_RECORDS,
  GROUP_MAX_NULL_SHARE,
  GROUP_CANDIDATES,
  GROUP_PROFILED,
  GROUP_SAMPLE_ROWS,
  GROUP_TECHNIQUES,
  STANDALONE_TECHNIQUES,
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
  customGroupNames,
  groupingCandidates,
  timeColumnOf,
  keyColumnGuess,
  suggestedGroups,
  firstRunDefault,
};
