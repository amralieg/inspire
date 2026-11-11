import { briefList, counted } from './plural.js';

export const GROUP_BY = 'group_by';
export const RUN_SCOPE = 'run_scope';
export const SCOPE_GROUPS = 'scope_groups';
export const SCOPE_DAYS = 'scope_days';
export const SCOPE_RECORDS = 'scope_records';
export const SCOPE_SETTINGS = [GROUP_BY, RUN_SCOPE, SCOPE_GROUPS, SCOPE_DAYS, SCOPE_RECORDS];
export const SCOPE_SAVE_ORDER = [GROUP_BY, SCOPE_GROUPS, SCOPE_DAYS, SCOPE_RECORDS, RUN_SCOPE];
export const GROUPING_SETTINGS = [GROUP_BY];
export const FIRST_RUN_SETTINGS = [RUN_SCOPE, SCOPE_GROUPS, SCOPE_DAYS, SCOPE_RECORDS];
export const FIRST_RUN_LABEL = 'First run';
export const SCOPE_LABELS = {
  [GROUP_BY]: 'Data groups', [RUN_SCOPE]: FIRST_RUN_LABEL, [SCOPE_GROUPS]: 'Groups to run on', [SCOPE_DAYS]: 'Days to run on', [SCOPE_RECORDS]: 'Records to run on',
};
export const GROUP_ALL = 'all';
export const FIRST_RUN_DEFAULT = 'records';
export const GROUP_CUSTOM = 'custom';
export const RUN_SCOPES = ['all', 'groups', 'recent', 'records'];
export const CUSTOM_SQL_SETTINGS = ['group_sql', 'group_sql_tables', 'group_sql_hash', 'group_sql_checked_by', 'group_sql_checked_at',
  'scope_sql', 'scope_sql_tables', 'scope_sql_hash', 'scope_sql_checked_by', 'scope_sql_checked_at'];
export const CUSTOM_SQL_REFUSED = 'Inspire does not run SQL typed into Data groups or First run; choose columns for Data groups and one of the First run choices instead';
export const RUN_SCOPE_ALLOWED = RUN_SCOPES.join(', ');
export const SCOPE_DEFAULTS = { [SCOPE_DAYS]: '30', [SCOPE_RECORDS]: '1000' };
export const GROUPING_TITLE = 'How do you split the data into groups?';
export const FIRST_RUN_TITLE = `What should the ${FIRST_RUN_LABEL} cover?`;
export const FIRST_RUN_KEEPS = 'Only the first run uses this test scope. Every later run, scheduled or not, covers all the records in the Data groups.';
export const GROUPING_PLAIN = 'Data groups split the data the way the business looks at it, such as per region or per store. Inspire models each group on its own: '
  + 'a sales forecast for one region is not mixed with another, and what is unusual is found within its own group. Choose the whole data as one group to model it all together.';
export const GROUPING_EXAMPLE = 'Some numbers only mean something inside a group. An average salary over all countries mixes very different pay levels '
  + 'and tells you little; the average per country, or per state, is one people can act on. Inspire works the same way: it works out each Data group '
  + 'on its own, so one group never blurs another.';
export const GROUPING_PICK = 'Pick how to split the data below.';
export const GROUPING_COMBINE = 'Combine columns, coarse to fine';
export function groupingCombineNote(columns) {
  const [broad, fine] = (columns || []).map((c) => text(c?.name)).filter(Boolean);
  return broad && fine ? `Ticking both ${broad} and ${fine} gives groups of ${broad} and ${fine} together: one group for each ${fine} inside its ${broad}.`
    : 'Tick more than one column to combine them; each group is one value of every ticked column.';
}
export const GROUP_KIND_WORDS = { biggest: 'the biggest', typical: 'a typical one', smallest: 'the smallest' };
export const GROUPING_GLOBAL_LABEL = 'Whole data as one group';
export const RUN_EVERYTHING_LABEL = 'Run on everything';
export const GROUPING_SAVE_LABEL = 'Save Data groups';
export const FIRST_RUN_SAVE_LABEL = `Save ${FIRST_RUN_LABEL}`;
export const FIRST_RUN_ONE_LABEL = 'One group';
export const FIRST_RUN_SEVERAL_LABEL = 'Several groups';
export const FIRST_RUN_GROUPS_MAX_SHOWN = 50;
export const FIRST_RUN_GROUPS_FIND_FROM = 10;
export const FIRST_RUN_GROUPS_READING = 'Inspire is reading the groups of the Data groups you chose.';
export const FIRST_RUN_COVERS = `The ${FIRST_RUN_LABEL} covers`;
export const SPREAD_WORDS = 'spread across the whole table, the same records every run';
export const GROUPING_JOINED_NOTE = 'Each run reads it from that table through this join.';

const isMap = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value) => (value == null ? '' : String(value).trim());
const whole = (value) => (/^[0-9]+$/.test(text(value)) ? Number(text(value)) : null);
const finite = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

export function groupByColumns(value) {
  const seen = [];
  for (const part of text(value).split(',')) {
    const name = part.trim();
    if (name && !seen.some((s) => s.toLowerCase() === name.toLowerCase())) seen.push(name);
  }
  return seen;
}

export function sameGrouping(a, b) {
  const left = groupByColumns(a).map((s) => s.toLowerCase());
  const right = groupByColumns(b).map((s) => s.toLowerCase());
  const norm = (list) => (list.length ? list.join(',') : GROUP_ALL);
  return norm(left) === norm(right);
}

export function scopeValues(get) {
  const read = (name) => text(get(name));
  return {
    [GROUP_BY]: read(GROUP_BY) || GROUP_ALL,
    [RUN_SCOPE]: read(RUN_SCOPE),
    [SCOPE_GROUPS]: read(SCOPE_GROUPS),
    [SCOPE_DAYS]: read(SCOPE_DAYS) || SCOPE_DEFAULTS[SCOPE_DAYS],
    [SCOPE_RECORDS]: read(SCOPE_RECORDS) || SCOPE_DEFAULTS[SCOPE_RECORDS],
  };
}

export function scopeChanges(before, after) {
  return SCOPE_SAVE_ORDER.filter((name) => text(before?.[name]) !== text(after?.[name]));
}

export function isScopeSetting(setting) {
  return SCOPE_SETTINGS.includes(String(setting?.name || ''));
}

export function isGroupingSetting(setting) {
  return GROUPING_SETTINGS.includes(String(setting?.name || ''));
}

export function isFirstRunSetting(setting) {
  return FIRST_RUN_SETTINGS.includes(String(setting?.name || ''));
}

export function customSqlProblem(name, value, label = name) {
  const key = text(name).toLowerCase();
  if (CUSTOM_SQL_SETTINGS.includes(key) && text(value)) return `${text(label)}: ${CUSTOM_SQL_REFUSED}`;
  if (key === RUN_SCOPE && text(value).toLowerCase() === GROUP_CUSTOM) return `${text(label)} is '${text(value)}': ${CUSTOM_SQL_REFUSED}`;
  if (key === GROUP_BY && groupByColumns(value).some((c) => c.toLowerCase() === GROUP_CUSTOM)) return `${text(label)} is '${text(value)}': ${CUSTOM_SQL_REFUSED}`;
  return '';
}

export function customSqlProblems(values) {
  return Object.keys(isMap(values) ? values : {}).sort().map((name) => customSqlProblem(name, values[name])).filter(Boolean);
}

export function runScopeProblem(value, name = SCOPE_LABELS[RUN_SCOPE]) {
  const scope = text(value);
  const custom = customSqlProblem(RUN_SCOPE, scope, name);
  if (custom) return custom;
  return scope && !RUN_SCOPES.includes(scope) ? `${name} is '${scope}'; allowed: ${RUN_SCOPE_ALLOWED}` : '';
}

export function runScopeSetting(setting) {
  if (!isMap(setting) || text(setting.name) !== RUN_SCOPE) return setting;
  return { ...setting, kind: 'choice', choices: [...RUN_SCOPES], many: false, allowed: RUN_SCOPE_ALLOWED, low: null, high: null, whole: false };
}

export const RUN_SCOPE_UNRECORDED = `The earlier build did not record which ${FIRST_RUN_LABEL} it meant, so Inspire shows the one it suggests for this table.`;
export const RUN_SCOPE_UNRECORDED_HIDDEN = `The earlier build did not record which ${FIRST_RUN_LABEL} it meant, and Inspire could not suggest one for this table, so this build `
  + 'runs on everything.';
export const RUN_SCOPE_OLD_APP = `This App was built before ${FIRST_RUN_LABEL} had its choices, so it cannot save one. To change ${FIRST_RUN_LABEL}, open Vibe/Add/Remove Features, `
  + 'then Open all settings; the next build gives the App the choices.';
const RUN_SCOPE_WORDS = [[/\b(records?|rows?)\b/, 'records', SCOPE_RECORDS], [/\bdays?\b/, 'recent', SCOPE_DAYS]];

export function runScopeDeclared(settings) {
  return (Array.isArray(settings) ? settings : []).find((s) => isMap(s) && text(s.name) === RUN_SCOPE) || null;
}

export function recordedRunScope(values, declared = null) {
  const recorded = isMap(values) ? values : {};
  const was = text(recorded[RUN_SCOPE]);
  if (!was) return { values: recorded, unrecorded: false };
  const scope = was.toLowerCase();
  if (RUN_SCOPES.includes(scope)) return { values: scope === recorded[RUN_SCOPE] ? recorded : { ...recorded, [RUN_SCOPE]: scope }, unrecorded: false };
  if (scope === GROUP_CUSTOM) return { values: { ...recorded, [RUN_SCOPE]: GROUP_CUSTOM }, unrecorded: false };
  const count = whole(was);
  const legacy = isMap(declared) && declared.kind !== 'choice';
  const words = legacy ? [declared.label, declared.help, declared.unit].map(text).join(' ').toLowerCase() : '';
  const meant = count != null && count >= 1 ? RUN_SCOPE_WORDS.filter(([pattern]) => pattern.test(words)) : [];
  if (meant.length === 1) return { values: { ...recorded, [RUN_SCOPE]: meant[0][1], [meant[0][2]]: String(count) }, unrecorded: false };
  return { values: { ...recorded, [RUN_SCOPE]: '' }, unrecorded: true };
}

export function latestRunScope(latest) {
  const spec = isMap(latest?.spec_json) ? latest.spec_json : null;
  return recordedRunScope(spec?.config?.widgets, runScopeDeclared(isMap(latest?.asset_status) ? latest.asset_status.settings : null));
}

export function profileRecords(profile) {
  return finite(profile?.records);
}

function scopedGroupRecords(group, rows) {
  if (!Array.isArray(rows)) return null;
  const parts = Array.isArray(group.parts) ? group.parts : [];
  const hit = rows.find((row) => parts.every((p) => String(row?.[p.column] ?? '') === String(p.value ?? '')));
  const n = Number(hit?.records);
  return hit && Number.isFinite(n) ? n : 0;
}

export function withScopedRows(profile, rows, groups = null) {
  if (!isMap(profile)) return profile;
  const whole = { ...profile };
  delete whole.recent;
  const count = Number.isFinite(rows) ? rows : null;
  return {
    ...whole,
    records: count,
    first_run: { ...(isMap(profile.first_run) ? profile.first_run : {}), all: count, recent: null },
    suggested_groups: Array.isArray(profile.suggested_groups)
      ? profile.suggested_groups.map((g) => (isMap(g) ? { ...g, records: scopedGroupRecords(g, groups) } : g)) : profile.suggested_groups,
  };
}

export function firstRunDefault(profile) {
  if (!isMap(profile)) return '';
  return RUN_SCOPES.includes(profile.default_scope) && profile.default_scope !== GROUP_ALL ? profile.default_scope : FIRST_RUN_DEFAULT;
}

export function suggestedGroups(profile) {
  const finest = Array.isArray(profile?.recommended) ? text(profile.recommended[profile.recommended.length - 1]) : '';
  return (Array.isArray(profile?.suggested_groups) ? profile.suggested_groups : []).filter(isMap)
    .map((g) => ({ value: text(g.value), records: finite(g.records), kind: text(g.kind), parts: groupPartsOf(g.parts) || [{ column: finest, value: text(g.value) }] }))
    .filter((g) => g.value);
}

export const WHOLE_GROUPS_MAX = 20;
export const WHOLE_GROUPS_MIN = 3;
export const SCOPE_GROUP_AND = ' and ';

export function wholeGroups(sizes, target) {
  const goal = whole(target) ?? Number(SCOPE_DEFAULTS[SCOPE_RECORDS]);
  const eligible = (Array.isArray(sizes) ? sizes : []).filter(isMap)
    .map((g) => ({ ...g, value: g.value == null ? null : String(g.value), records: finite(Number(g.records)) ?? 0 }))
    .filter((g) => g.value != null && g.records > 0)
    .sort((a, b) => b.records - a.records || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
  const fits = eligible.filter((g) => g.records <= goal);
  const order = fits.length ? [fits[0], fits[Math.floor((fits.length - 1) / 2)], fits[fits.length - 1], ...fits] : [];
  const picked = [];
  let total = 0;
  for (const g of order) {
    if (picked.length >= WHOLE_GROUPS_MAX) break;
    if (!picked.includes(g) && total + g.records <= goal) {
      picked.push(g);
      total += g.records;
    }
  }
  for (const g of order) {
    if (picked.length >= Math.min(WHOLE_GROUPS_MIN, fits.length)) break;
    if (!picked.includes(g)) picked.push(g);
  }
  if (!picked.length && eligible.length) picked.push(eligible[eligible.length - 1]);
  return picked.sort((a, b) => eligible.indexOf(a) - eligible.indexOf(b));
}

function jsonOrNull(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function groupPartsOf(raw) {
  if (!Array.isArray(raw)) return null;
  const parts = raw.filter(isMap).map((p) => ({ column: text(p.column), value: p.value == null ? '' : String(p.value), ...(isMap(p.join) ? { join: p.join } : {}) }))
    .filter((p) => p.column);
  return parts.length === raw.length && parts.length ? parts : null;
}

export function scopeGroupsOf(value, finest = '') {
  const raw = text(value);
  const listed = raw.startsWith('[') ? jsonOrNull(raw) : null;
  const groups = Array.isArray(listed) ? listed.map((g) => groupPartsOf(g)) : [];
  if (groups.length && groups.every(Boolean)) return groups;
  return groupByColumns(raw).filter((v) => v.toLowerCase() !== GROUP_ALL).map((v) => [{ column: text(finest), value: v }]);
}

export function scopeGroupsValue(groups) {
  const list = (Array.isArray(groups) ? groups : []).filter((g) => Array.isArray(g) && g.length);
  if (list.every((g) => g.length === 1 && !text(g[0].column) && !g[0].value.includes(','))) return list.map((g) => g[0].value).join(', ');
  return JSON.stringify(list.map((g) => g.map((p) => ({ column: p.column, value: p.value, ...(p.join ? { join: p.join } : {}) }))));
}

export function scopeGroupKey(group) {
  return JSON.stringify((group || []).map((p) => [text(p.column).toLowerCase(), String(p.value)]));
}

const RTL_LETTERS = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;

export function isolated(value) {
  const shown = text(value);
  return RTL_LETTERS.test(shown) ? `\u2068${shown}\u2069` : shown;
}

export function scopeGroupText(group) {
  return (group || []).map((p) => (p.column ? `${p.column} = ${isolated(p.value)}` : isolated(p.value))).join(SCOPE_GROUP_AND);
}

const byValue = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true });

export function groupsInBrief(texts) {
  return briefList([...texts].sort(byValue), { sep: '; ' });
}

export const GROUPING_DEEP_MARK = 'Suggested by discovery';
export const GROUPING_DEEP_PICKED = 'Discovery picked this grouping. It becomes your choice when you pick it or another one.';

export function deepGrouping(profile) {
  const columns = Array.isArray(profile?.deep_suggestion?.columns) ? profile.deep_suggestion.columns : [];
  return groupByColumns(columns.map(text).filter(Boolean).join(', '));
}

export function groupingChosenBy(raw, profile) {
  if (text(raw)) return 'person';
  return deepGrouping(profile).length ? 'deep' : '';
}

export function groupingProfiled(values, profile) {
  const finest = groupByColumns(values[GROUP_BY]).pop();
  const profiled = finestGroupColumn(profile);
  return !finest || finest.toLowerCase() === GROUP_ALL || (profiled && finest.toLowerCase() === profiled.toLowerCase());
}

export function withScopeDefaults(values, profile) {
  if (text(values[RUN_SCOPE])) return values;
  const chosen = isMap(profile) ? firstRunDefault(profile) : FIRST_RUN_DEFAULT;
  const next = { ...values, [RUN_SCOPE]: chosen };
  if (chosen === 'groups' && !text(values[SCOPE_GROUPS]) && groupingProfiled(values, profile)) {
    next[SCOPE_GROUPS] = scopeGroupsValue(suggestedGroups(profile).map((g) => g.parts));
  }
  return next;
}

export function groupingDefault(profile) {
  const deep = deepGrouping(profile);
  if (deep.length) return deep.join(', ');
  if (!isMap(profile) || profile.applies !== true || profile.qualifies !== true) return GROUP_ALL;
  const recommended = groupingChoices(profile).find((c) => c.recommended);
  return recommended ? recommended.value : GROUP_ALL;
}

export function withGroupingDefault(values, profile, raw = '') {
  if (text(raw) || groupByColumns(values[GROUP_BY]).some((c) => c.toLowerCase() !== GROUP_ALL)) return values;
  return { ...values, [GROUP_BY]: groupingDefault(profile) };
}

export function groupingChoices(profile, settingChoices = []) {
  const recommended = (Array.isArray(profile?.recommended) ? profile.recommended : []).map(text).filter(Boolean);
  const columns = (Array.isArray(profile?.columns) ? profile.columns : []).filter(isMap);
  const shown = columns.map((c) => text(c.name)).filter(Boolean);
  const joinOf = new Map(columns.filter((c) => isMap(c.join)).map((c) => [text(c.name), c.join]));
  const extra = recommended.length || shown.length ? [] : (settingChoices || []).map(text).filter((c) => c && ![GROUP_ALL, GROUP_CUSTOM].includes(c.toLowerCase()));
  const known = [...new Set([...recommended, ...shown, ...extra])];
  const withJoin = (choice) => {
    const via = choice.columns.filter((c) => joinOf.has(c)).map((c) => `${c} joins on ${text(joinOf.get(c).key)} = ${text(joinOf.get(c).ref_column)}`);
    return via.length ? { ...choice, note: `${via.join('; ')}. ${GROUPING_JOINED_NOTE}` } : choice;
  };
  const list = [{ value: GROUP_ALL, label: GROUPING_GLOBAL_LABEL, columns: [] }];
  const deep = deepGrouping(profile);
  if (deep.length) {
    list.push(withJoin({ value: deep.join(', '), label: deep.join(', then '), columns: deep, deep: true, recommended: sameGrouping(deep.join(','), recommended.join(',')) }));
  }
  if (recommended.length && !list.some((c) => sameGrouping(c.value, recommended.join(',')))) {
    list.push(withJoin({ value: recommended.join(', '), label: recommended.join(', then '), columns: recommended, recommended: true }));
  }
  for (const column of known) {
    if (list.some((c) => sameGrouping(c.value, column))) continue;
    list.push(withJoin({ value: column, label: column, columns: [column] }));
  }
  return list;
}

export const GROUPING_SHOWN = 6;
export const GROUPING_UNCOUNTED = 'groups counted once picked';
export const GROUPING_FIND = 'Find a column';
export const GROUPING_MORE = 'How groups work';

export function groupingCount(choice, profile) {
  const columns = Array.isArray(choice?.columns) ? choice.columns : [];
  if (!columns.length) return 1;
  if (columns.length === 1) {
    const found = (Array.isArray(profile?.columns) ? profile.columns : []).filter(isMap).find((c) => text(c.name).toLowerCase() === columns[0].toLowerCase());
    if (finite(found?.distinct) != null) return found.distinct;
  }
  const listed = groupingGroupsOf(profile, columns.join(', '));
  if (!Array.isArray(listed) || !listed.length) return null;
  const total = columns.length > 1 ? finite(profile?.group_count) : null;
  if (total != null) return total;
  const finest = (Array.isArray(profile?.columns) ? profile.columns : []).filter(isMap)
    .find((c) => text(c.name).toLowerCase() === columns[columns.length - 1].toLowerCase());
  return listed.length < (finite(finest?.distinct) ?? 0) ? null : listed.length;
}

export function groupingCountText(count) {
  return count == null ? GROUPING_UNCOUNTED : counted(count, 'group');
}

export function groupingBest(profile, choices = groupingChoices(profile)) {
  const best = groupingDefault(profile);
  return choices.find((c) => sameGrouping(c.value, best)) || choices[0] || null;
}

export function groupingOf(profile, groupBy, choices = groupingChoices(profile)) {
  const found = choices.find((c) => sameGrouping(c.value, groupBy));
  if (found) return found;
  const columns = groupByColumns(groupBy).filter((c) => c.toLowerCase() !== GROUP_ALL && c.toLowerCase() !== GROUP_CUSTOM);
  return columns.length ? { value: columns.join(', '), label: columns.join(', then '), columns } : null;
}

export function groupingLead(profile, choices = groupingChoices(profile), groupBy = '', read = null) {
  const picked = groupBy ? groupingOf(profile, groupBy, choices) : null;
  const lead = picked?.columns.length ? picked : groupingBest(profile, choices);
  if (!lead || !lead.columns.length) return null;
  return { label: lead.label, groups: groupingCount(lead, profile) ?? (isMap(read) ? groupingCount(lead, read) : null) };
}

export function groupingOverLimitText(lead, profile) {
  const max = finite(profile?.group_max);
  if (!lead || lead.groups == null || max == null || lead.groups <= max) return '';
  return `That is more than the ${counted(max, 'group')} Inspire models one by one, so untick a column or pick a coarser one.`;
}

export function topShown(items, { keep = () => false, limit = GROUPING_SHOWN, open = false, query = '', textOf = String } = {}) {
  const list = Array.isArray(items) ? items : [];
  const needle = text(query).toLowerCase();
  if (open) return list.filter((item) => !needle || keep(item) || textOf(item).toLowerCase().includes(needle));
  const kept = list.filter(keep);
  const extra = list.filter((item) => !kept.includes(item)).slice(0, Math.max(0, limit - kept.length));
  return list.filter((item) => kept.includes(item) || extra.includes(item));
}

export const GROUPING_NAMED_DEFAULT = 'Inspire picked this default because the use case names it.';

export function groupingDefaultNote(profile) {
  return isMap(profile) && profile.recommended_by === 'use_case' ? GROUPING_NAMED_DEFAULT : '';
}

export function groupingReasonText(profile) {
  return isMap(profile) && profile.applies === true ? text(profile.reason) : '';
}

export function groupingNothingText(profile, choices) {
  if (!isMap(profile) || (Array.isArray(choices) ? choices : []).length > 1) return '';
  if (profileRecords(profile) === 0) return `${text(profile.table) || 'The main table'} holds no records yet, so there is nothing to split and nothing to pick here.`;
  const reason = groupingReasonText(profile) || 'No column splits the data into fair groups, so Inspire models the whole data as one group.';
  return `${/[.!?]$/.test(reason) ? reason : `${reason}.`} There is nothing else to pick here.`;
}

export function groupingExampleText(profile) {
  const groups = suggestedGroups(profile);
  const column = text(profile?.example?.column) || (Array.isArray(profile?.recommended) ? text(profile.recommended[profile.recommended.length - 1]) : '');
  const big = groups.find((g) => g.kind === 'biggest') || groups[0];
  const small = groups.find((g) => g.kind === 'smallest') || groups[groups.length - 1];
  if (!column || !big || !small || big.value === small.value || big.records == null || small.records == null) return '';
  const [bigText, smallText] = [isolated(big.value), isolated(small.value)];
  return `${bigText} has ${counted(big.records, 'record')} and ${smallText} has ${counted(small.records, 'record')}. Grouped by ${column}, `
    + `each ${column} is compared only with its own records, so what is normal for ${bigText} does not hide what stands out in ${smallText}.`;
}

export function groupingMovesUpText(profile) {
  const example = isMap(profile?.example) ? profile.example : null;
  const small = (Array.isArray(example?.small_groups) ? example.small_groups : []).filter(isMap).find((g) => text(g.value));
  if (!small) return '';
  const into = text(example.moves_to) || GROUPING_GLOBAL_LABEL;
  const records = finite(small.records);
  return `A group too small to compare fairly moves up a level: ${isolated(text(small.value))}${records == null ? '' : ` has ${counted(records, 'record')}, so it`} `
    + `is measured with ${into}.`;
}

export function finestGroupColumn(profile) {
  return text(profile?.group_column) || (Array.isArray(profile?.recommended) ? text(profile.recommended[profile.recommended.length - 1]) : '');
}

function joinOfColumn(profile, column) {
  const found = (Array.isArray(profile?.columns) ? profile.columns : []).filter(isMap).find((c) => text(c.name).toLowerCase() === column.toLowerCase());
  return isMap(found?.join) ? found.join : null;
}

function columnGroupsOf(profile, column) {
  const byName = isMap(profile?.column_groups) ? profile.column_groups : {};
  const name = Object.keys(byName).find((n) => n.toLowerCase() === column.toLowerCase());
  if (!name || !Array.isArray(byName[name])) return null;
  const join = joinOfColumn(profile, name);
  return byName[name].filter((g) => isMap(g) && g.value != null && text(g.value))
    .map((g) => ({ value: String(g.value), records: finite(Number(g.records)), parts: [{ column: name, value: String(g.value), ...(join ? { join } : {}) }] }));
}

export function groupingGroupsOf(profile, groupBy) {
  if (!isMap(profile)) return null;
  const columns = groupByColumns(groupBy).filter((c) => c.toLowerCase() !== GROUP_ALL);
  if (!columns.length) return [];
  if (Array.isArray(profile.group_list) && sameGrouping(profile.groups_for, columns.join(','))) {
    const finest = columns[columns.length - 1];
    return profile.group_list.filter((g) => isMap(g) && text(g.value))
      .map((g) => ({ value: text(g.value), records: finite(Number(g.records)), parts: groupPartsOf(g.parts) || [{ column: finest, value: text(g.value) }] }));
  }
  return columns.length === 1 ? columnGroupsOf(profile, columns[0]) : null;
}

function wholeColumnRead(profile, groupBy) {
  const own = profile.applies === true && profile.standalone !== true ? wholeGroupColumn(groupBy) : '';
  return !own || own.toLowerCase() === text(profile.group_column).toLowerCase();
}

export function groupsReadNeeded(profile, groupBy) {
  return isMap(profile) && (groupingGroupsOf(profile, groupBy) === null || !wholeColumnRead(profile, groupBy));
}

export function wholeGroupColumn(groupBy) {
  return groupByColumns(groupBy).filter((c) => c.toLowerCase() !== GROUP_ALL && !c.includes('.')).pop() || '';
}

export function oneGroupChosen(profile, values) {
  return isMap(profile) && profile.applies === true && text(values?.[GROUP_BY]).toLowerCase() === GROUP_ALL;
}

export function recordGroups(profile, values) {
  if (!isMap(profile) || profile.standalone === true || oneGroupChosen(profile, values) || !wholeColumnRead(profile, values?.[GROUP_BY])) return null;
  return wholeGroups(profile.group_sizes, values?.[SCOPE_RECORDS]);
}

export const GROUPS_FROM_EARLIER = `Data groups is the whole data as one group, so these groups come from an earlier choice; change them below or pick another ${FIRST_RUN_LABEL}.`;

export function groupsPickedByRunText(values) {
  const finest = groupByColumns(values?.[GROUP_BY]).pop();
  if (!finest) return '';
  if (finest.toLowerCase() === GROUP_ALL) return GROUPS_FROM_EARLIER;
  return `Inspire profiled the groups of another column, so the run picks whole groups of ${finest} itself; type groups below to choose them.`;
}

const SPREAD_LINE = `${SPREAD_WORDS.charAt(0).toUpperCase()}${SPREAD_WORDS.slice(1)}`;

export function recordGroupsSaid(profile, values) {
  const picked = recordGroups(profile, values);
  const goal = whole(values?.[SCOPE_RECORDS]) ?? Number(SCOPE_DEFAULTS[SCOPE_RECORDS]);
  const about = `~${counted(goal, 'record')}`;
  const all = profileRecords(profile);
  if (all === 0) return { label: '0 records yet', detail: `${text(profile?.table) || 'The table'} holds no records yet, so the ${FIRST_RUN_LABEL} has nothing to read until data arrives.`, groups: [] };
  if (all != null && all <= goal) return { label: `All ${counted(all, 'record')}`, detail: '', groups: [] };
  if (!picked && oneGroupChosen(profile, values)) return { label: about, detail: `${SPREAD_LINE}; the whole data is one group.`, groups: [] };
  if (!picked && isMap(profile) && profile.standalone !== true && !wholeColumnRead(profile, values?.[GROUP_BY])) {
    return { label: `${about} in whole groups of ${groupByColumns(values?.[GROUP_BY]).filter((c) => c.toLowerCase() !== GROUP_ALL && !c.includes('.')).join(', then ')}`, detail: 'No group is cut.', groups: [] };
  }
  if (!picked) return { label: about, detail: `${SPREAD_LINE}.`, groups: [] };
  if (!picked.length) {
    return { label: about, detail: `${SPREAD_LINE}. This analysis compares records with each other and no column groups them, so a group may be cut in this ${FIRST_RUN_LABEL}.`, groups: [] };
  }
  const column = finestGroupColumn(profile);
  const named = (g) => `${column ? `${column} = ` : ''}${isolated(g.value)}`;
  const total = picked.reduce((sum, g) => sum + g.records, 0);
  if (picked.length === 1 && total > goal) {
    return { label: `${counted(total, 'record')} in 1 whole group`, detail: `All of ${named(picked[0])}, the smallest group, since every group holds more than ${counted(goal, 'record')}.`, groups: [] };
  }
  const groups = picked.map((g) => `${named(g)} · ${counted(g.records, 'record')}`).sort(byValue);
  return { label: `${counted(total, 'record')} in ${counted(picked.length, 'whole group')}`,
    detail: total > goal ? `The ${FIRST_RUN_LABEL} sees more than one group and no group is cut.` : 'No group is cut.', groups };
}

export function recordGroupsText(profile, values) {
  return recordGroupsSaid(profile, values).label;
}

export function firstRunGroupsPick(profile, groups, picked, id) {
  if (!groups.length) return [];
  const suggested = suggestedGroups(profile).filter((s) => groups.some((g) => scopeGroupKey(g.parts) === scopeGroupKey(s.parts)));
  if (id === 'one') return [picked.length ? picked[0] : groups[0].parts];
  return picked.length ? picked : (suggested.length ? suggested : groups.slice(0, 3)).map((g) => g.parts);
}

export function scopeGroupsColumn(profile, values) {
  return wholeGroupColumn(values?.[GROUP_BY]) || finestGroupColumn(profile);
}

function pickedGroupsOf(profile, values) {
  const listed = groupingGroupsOf(profile, values?.[GROUP_BY]) || [];
  const picked = scopeGroupsOf(values?.[SCOPE_GROUPS], scopeGroupsColumn(profile, values));
  return { listed, picked };
}

export const SCOPE_ESTIMATE_MAX_SCALE = 10;

export function everythingEstimate(everything, total, first) {
  if (text(everything)) return text(everything);
  const size = whole(first) || Number(SCOPE_DEFAULTS[SCOPE_RECORDS]);
  if (total == null || total <= size) return '';
  const scale = Math.round(total / size);
  if (scale < 2) return `Everything is ${counted(total, 'record')}, a little more than a ${size.toLocaleString('en-US')}-record ${FIRST_RUN_LABEL}, so it takes a little longer`;
  const lead = `Everything is ${counted(total, 'record')}, about ${scale.toLocaleString('en-US')} times a ${size.toLocaleString('en-US')}-record ${FIRST_RUN_LABEL}`;
  if (total / size > SCOPE_ESTIMATE_MAX_SCALE) return `${lead}; how long it takes is unknown until a larger run is measured`;
  return `${lead}, so it takes up to about ${scale.toLocaleString('en-US')} times as long`;
}

function groupsRecords(listed, parts) {
  const sizes = parts.map((p) => listed.find((g) => scopeGroupKey(g.parts) === scopeGroupKey(p))?.records ?? null);
  return sizes.length && sizes.every((n) => n != null) ? sizes.reduce((a, n) => a + n, 0) : null;
}

export function firstRunChoices(profile, values, everything = '') {
  const fr = isMap(profile?.first_run) ? profile.first_run : {};
  const { listed, picked } = pickedGroupsOf(profile, values);
  const days = whole(values?.[SCOPE_DAYS]);
  const recent = isMap(profile?.recent) ? profile.recent : null;
  const records = whole(values?.[SCOPE_RECORDS]);
  const total = profileRecords(profile);
  const timeColumn = text(profile?.time_column);
  const via = isMap(profile?.time_via) && text(profile.time_via.date) && text(profile.time_via.table) ? profile.time_via : null;
  const timeName = via ? `${text(via.date)} in ${text(via.table)}, through ${timeColumn}` : timeColumn;
  const inGroups = recordGroups(profile, values);
  const grouped = Array.isArray(inGroups) && inGroups.length > 0;
  const said = recordGroupsSaid(profile, values);
  return [
    { id: 'one', scope: 'groups', label: FIRST_RUN_ONE_LABEL, available: listed.length > 0, records: groupsRecords(listed, firstRunGroupsPick(profile, listed, picked, 'one')) },
    { id: 'groups', scope: 'groups', label: FIRST_RUN_SEVERAL_LABEL, available: listed.length > 1,
      records: groupsRecords(listed, firstRunGroupsPick(profile, listed, picked, 'groups')) },
    {
      id: 'records',
      scope: 'records',
      label: said.label,
      detail: said.detail,
      shown: said.groups,
      available: true,
      records: grouped ? inGroups.reduce((a, g) => a + g.records, 0) : records != null && total != null ? Math.min(records, total) : finite(fr.records),
      groups: grouped ? inGroups : null,
    },
    {
      id: 'recent', scope: 'recent', label: timeColumn ? `The last ${days ?? SCOPE_DEFAULTS[SCOPE_DAYS]} days of ${timeName}` : 'A recent period', available: Boolean(timeColumn),
      records: recent && days != null && Number(recent.days) === days ? finite(recent.records) ?? finite(fr.recent) : days == null ? null : finite(fr.recent),
      exact: Boolean(recent && days != null && Number(recent.days) === days),
    },
    { id: 'all', scope: 'all', label: 'Everything', available: true, records: finite(fr.all) ?? total,
      estimate: everythingEstimate(everything, finite(fr.all) ?? total, values?.[SCOPE_RECORDS]) },
  ];
}

export function firstRunChoiceOf(values) {
  const scope = text(values?.[RUN_SCOPE]);
  if (scope !== 'groups') return scope;
  return scopeGroupsOf(values?.[SCOPE_GROUPS]).length === 1 ? 'one' : 'groups';
}

export function firstRunCoversText(profile, values, everything = '') {
  const choice = firstRunChoiceOf(values);
  const found = firstRunChoices(profile, values, everything).find((c) => c.id === choice);
  if (!found) return '';
  const size = found.records == null ? '' : `, ${counted(found.records, 'record')}`;
  if (found.scope === 'groups') {
    const { picked } = pickedGroupsOf(profile, values);
    if (!picked.length) return `${FIRST_RUN_COVERS} no group yet; pick the groups it runs on.`;
    const columns = [...new Set(picked.flat().map((p) => text(p?.column)).filter(Boolean))];
    return `${FIRST_RUN_COVERS} ${counted(picked.length, 'group')}${columns.length ? ` of ${columns.join(', then ')}` : ''}: `
      + `${groupsInBrief(picked.map(scopeGroupText))}${size}. Every other group waits for a run on everything.`;
  }
  if (found.scope === 'records') {
    const all = profileRecords(profile);
    const goal = whole(values?.[SCOPE_RECORDS]) ?? Number(SCOPE_DEFAULTS[SCOPE_RECORDS]);
    if (all === 0) return `${FIRST_RUN_COVERS} nothing yet: ${text(profile?.table) || 'the main table'} holds no records.`;
    if (all != null && all <= goal) return `${FIRST_RUN_COVERS} all ${counted(all, 'record')} of ${text(profile?.table) || 'the main table'}, since it holds no more than ${counted(goal, 'record')}.`;
    return `${FIRST_RUN_COVERS} ${found.label}.${found.detail ? ` ${found.detail}` : ''}`;
  }
  if (found.scope === 'recent') return `${FIRST_RUN_COVERS} ${found.label.charAt(0).toLowerCase()}${found.label.slice(1)}${size}.`;
  return `${FIRST_RUN_COVERS} everything${size}.${found.estimate ? ` ${found.estimate}.` : ''}`;
}

export function groupingProblems(values) {
  const problems = [];
  const custom = customSqlProblem(GROUP_BY, values?.[GROUP_BY], SCOPE_LABELS[GROUP_BY]);
  if (custom) problems.push(custom);
  const columns = groupByColumns(values?.[GROUP_BY]);
  if (!custom && columns.some((c) => c.toLowerCase() === GROUP_ALL) && columns.length > 1) {
    problems.push(`${SCOPE_LABELS[GROUP_BY]} is '${text(values?.[GROUP_BY])}'; choose ${GROUP_ALL} or column names, not a mix`);
  }
  return problems;
}

export function firstRunProblems(values) {
  const problems = [];
  const scope = text(values?.[RUN_SCOPE]);
  const wrongScope = runScopeProblem(scope);
  if (wrongScope) problems.push(wrongScope);
  if (scope === 'groups' && !scopeGroupsOf(values?.[SCOPE_GROUPS]).length) {
    problems.push(`${SCOPE_LABELS[SCOPE_GROUPS]} is empty; pick at least one group`);
  }
  if (scope === 'recent' && (whole(values?.[SCOPE_DAYS]) ?? 0) < 1) problems.push(`Days to run on is '${text(values?.[SCOPE_DAYS])}'; allowed: a whole number, at least 1`);
  if (scope === 'records' && (whole(values?.[SCOPE_RECORDS]) ?? 0) < 1) {
    problems.push(`Records to run on is '${text(values?.[SCOPE_RECORDS])}'; allowed: a whole number, at least 1`);
  }
  return problems;
}

export const FIRST_RUN_OWN_SETTING = { groups: SCOPE_GROUPS, recent: SCOPE_DAYS, records: SCOPE_RECORDS };
const FIRST_RUN_OWNER_WORDS = { groups: `${FIRST_RUN_ONE_LABEL} or ${FIRST_RUN_SEVERAL_LABEL}`, recent: 'a recent period', records: 'about a number of records' };

function firstRunStale(values) {
  const scope = text(values?.[RUN_SCOPE]).toLowerCase();
  if (scope && !RUN_SCOPES.includes(scope)) return [];
  return Object.entries(FIRST_RUN_OWN_SETTING).filter(([owner, name]) => owner !== scope && text(values?.[name])).map(([owner, name]) => ({ owner, name }));
}

export function firstRunSaved(values) {
  const stale = firstRunStale(values).map((s) => s.name);
  return Object.fromEntries(Object.entries(isMap(values) ? values : {}).filter(([name]) => !stale.includes(name)));
}

export function firstRunSent(values, edited = null) {
  const saved = firstRunSaved(values);
  if (!isMap(edited) || text(edited[RUN_SCOPE]) || text(saved[RUN_SCOPE]).toLowerCase() !== FIRST_RUN_DEFAULT) return saved;
  const { [RUN_SCOPE]: _default, ...rest } = saved;
  return firstRunStale(rest).length ? saved : rest;
}

export function firstRunContradictions(values) {
  const scope = text(values?.[RUN_SCOPE]).toLowerCase();
  const said = scope ? `${FIRST_RUN_LABEL} is ${scope}` : `${FIRST_RUN_LABEL} is not chosen`;
  return firstRunStale(values).map(({ owner, name }) => {
    const value = name === SCOPE_GROUPS ? scopeGroupsOf(values[name]).map(scopeGroupText).join('; ') || text(values[name]) : text(values[name]);
    return `${said}, but ${SCOPE_LABELS[name]} holds ${value}; a run covers only its ${FIRST_RUN_LABEL} choice, so it would not use ${value}. `
      + `Choose ${FIRST_RUN_OWNER_WORDS[owner]} as the ${FIRST_RUN_LABEL} to run on it, or clear ${SCOPE_LABELS[name]}`;
  });
}

export function scopeProblems(values, part = 'both') {
  if (part === 'grouping') return groupingProblems(values);
  return part === 'first_run' ? firstRunProblems(values) : [...firstRunProblems(values), ...groupingProblems(values)];
}

export const SCOPE_DIFFERENT_NOTE = 'The previous run covered a different scope.';

export function runScopeFacts(runs) {
  const [latest, previous] = (Array.isArray(runs) ? runs : []).filter(isMap);
  if (!latest) return null;
  const scope = isMap(latest.scope) ? latest.scope : null;
  const before = isMap(previous?.scope) ? previous.scope : null;
  const facts = isMap(latest.facts) ? latest.facts : {};
  return {
    scoped: Boolean(scope && text(scope.scope) && text(scope.scope) !== GROUP_ALL),
    text: text(latest.scope_text),
    covered: text(facts.covered),
    everything: text(facts.everything),
    note: scope && before && text(scope.key) !== text(before.key) ? SCOPE_DIFFERENT_NOTE : '',
  };
}

export function scopeStepsOf(profileState, profile, builtFirstRun = false) {
  const ready = profileState === 'ready' && isMap(profile);
  const reading = profileState === 'loading';
  return { grouping: reading || (ready && (profile.applies === true || deepGrouping(profile).length > 0)),
    firstRun: builtFirstRun !== true && (ready || reading || profileState === 'error') };
}

export function builtFirstRunOf(model) {
  return (Array.isArray(model) ? model : []).some((s) => isMap(s) && text(s.name) === RUN_SCOPE && s.source === 'widget');
}

export const SCOPE_ALL_TEXT = 'All records';

export function firstRunSummaryText(profile, values, everything = '') {
  const choice = firstRunChoiceOf(values) || FIRST_RUN_DEFAULT;
  const found = firstRunChoices(profile, values, everything).find((c) => c.id === choice);
  if (!found) return '';
  const size = found.records == null || found.label.includes(counted(found.records, 'record')) ? '' : ` · ${counted(found.records, 'record')}`;
  if (found.scope !== 'groups') return `${found.label}${size}`;
  const { picked } = pickedGroupsOf(profile, values);
  return `${found.label}${size}${picked.length ? `: ${groupsInBrief(picked.map(scopeGroupText))}` : ''}`;
}

export function scopeText(values, profile = null) {
  const scope = text(values?.[RUN_SCOPE]) || GROUP_ALL;
  if (scope === 'groups') {
    const picked = scopeGroupsOf(values?.[SCOPE_GROUPS], scopeGroupsColumn(profile, values));
    return picked.length ? `${FIRST_RUN_LABEL}: ${counted(picked.length, 'group')} (${picked.map(scopeGroupText).join(picked.some((g) => g.length > 1) ? '; ' : ', ')})` : `${FIRST_RUN_LABEL}: the largest groups`;
  }
  if (scope === 'recent') return `${FIRST_RUN_LABEL}: the last ${counted(whole(values?.[SCOPE_DAYS]) ?? Number(SCOPE_DEFAULTS[SCOPE_DAYS]), 'day')}`;
  if (scope === 'records') {
    const goal = counted(whole(values?.[SCOPE_RECORDS]) ?? Number(SCOPE_DEFAULTS[SCOPE_RECORDS]), 'record');
    return isMap(profile) ? `${FIRST_RUN_LABEL}: ${recordGroupsText(profile, values)}`
      : `${FIRST_RUN_LABEL}: about ${goal}, keeping related records together`;
  }
  return SCOPE_ALL_TEXT;
}

export function profileHeldText(profile) {
  const records = profileRecords(profile);
  const table = text(profile?.table);
  if (records == null || !table) return '';
  const goal = Number(SCOPE_DEFAULTS[SCOPE_RECORDS]);
  if (records === 0) return `${table} holds no records yet, so a ${FIRST_RUN_LABEL} has nothing to read until data arrives.`;
  if (records <= goal) return `${table} holds ${counted(records, 'record')}, so the ${FIRST_RUN_LABEL} covers all of it.`;
  return `${table} holds ${counted(records, 'record')}, so Inspire suggests a smaller ${FIRST_RUN_LABEL} to show results sooner.`;
}
