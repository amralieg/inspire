import { counted } from './plural.js';
import { groupingMainTable } from './groupingSql.js';

export const GROUP_BY = 'group_by';
export const RUN_SCOPE = 'run_scope';
export const SCOPE_GROUPS = 'scope_groups';
export const SCOPE_DAYS = 'scope_days';
export const SCOPE_RECORDS = 'scope_records';
export const SCOPE_SETTINGS = [GROUP_BY, RUN_SCOPE, SCOPE_GROUPS, SCOPE_DAYS, SCOPE_RECORDS];
export const SCOPE_SAVE_ORDER = [GROUP_BY, SCOPE_GROUPS, SCOPE_DAYS, SCOPE_RECORDS, RUN_SCOPE];
export const SCOPE_LABELS = {
  [GROUP_BY]: 'Grouping', [RUN_SCOPE]: 'First run', [SCOPE_GROUPS]: 'Groups to run on', [SCOPE_DAYS]: 'Days to run on', [SCOPE_RECORDS]: 'Records to run on',
};
export const GROUP_ALL = 'all';
export const GROUP_CUSTOM = 'custom';
export const RUN_SCOPES = ['all', 'groups', 'recent', 'records', 'custom'];
export const RUN_SCOPE_ALLOWED = RUN_SCOPES.join(', ');
export const SCOPE_DEFAULTS = { [SCOPE_DAYS]: '30', [SCOPE_RECORDS]: '1000' };
export const GROUPING_TITLE = 'Compare like with like?';
export const FIRST_RUN_TITLE = 'What should the first run cover?';
export const FIRST_RUN_KEEPS = 'Schedules keep this scope until someone presses Run on everything.';
export const GROUPING_PLAIN = 'Grouping compares each record with records like it, such as the same country or store, instead of with every record, '
  + 'so a small place is not judged by what is normal for a big one.';
export const GROUP_KIND_WORDS = { biggest: 'the biggest', typical: 'a typical one', smallest: 'the smallest' };
export const GROUPING_GLOBAL_LABEL = 'Global (All)';
export const GROUPING_CUSTOM_LABEL = 'Custom';
export const RUN_EVERYTHING_LABEL = 'Run on everything';
export const SCOPE_SAVE_LABEL = 'Save Grouping and First run';
export const GROUPING_JOINED_NOTE = 'Inspire groups by it through a grouping SQL that joins that table; press Preview, then Use this grouping.';

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

export function runScopeProblem(value, name = SCOPE_LABELS[RUN_SCOPE]) {
  const scope = text(value);
  return scope && !RUN_SCOPES.includes(scope) ? `${name} is '${scope}'; allowed: ${RUN_SCOPE_ALLOWED}` : '';
}

export function runScopeSetting(setting) {
  if (!isMap(setting) || text(setting.name) !== RUN_SCOPE) return setting;
  return { ...setting, kind: 'choice', choices: [...RUN_SCOPES], many: false, allowed: RUN_SCOPE_ALLOWED, low: null, high: null, whole: false };
}

export const RUN_SCOPE_UNRECORDED = 'The earlier build did not record which first run it meant, so Inspire shows the first run it suggests for this table.';
export const RUN_SCOPE_UNRECORDED_HIDDEN = 'The earlier build did not record which first run it meant, and Inspire could not suggest one for this table, so this build '
  + 'runs on everything.';
export const RUN_SCOPE_OLD_APP = 'This App was built before First run had its choices, so it cannot save one. To change First run, open Vibe/Add/Remove Features, '
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

export function firstRunDefault(profile) {
  if (!isMap(profile)) return '';
  return RUN_SCOPES.includes(profile.default_scope) ? profile.default_scope : GROUP_ALL;
}

export function suggestedGroups(profile) {
  const finest = Array.isArray(profile?.recommended) ? text(profile.recommended[profile.recommended.length - 1]) : '';
  return (Array.isArray(profile?.suggested_groups) ? profile.suggested_groups : []).filter(isMap)
    .map((g) => ({ value: text(g.value), records: finite(g.records), kind: text(g.kind), parts: groupPartsOf(g.parts) || [{ column: finest, value: text(g.value) }] }))
    .filter((g) => g.value);
}

export const WHOLE_GROUPS_MAX = 20;
export const SCOPE_GROUP_AND = ' and ';
export const FIRST_RUN_CUSTOM_LABEL = 'Custom SQL: the records a SELECT of key columns returns';
export const FIRST_RUN_CUSTOM_UNSAVED = 'First run is custom; write the first run SQL, press Preview, then press Use this first run';

export function wholeGroups(sizes, target) {
  const goal = whole(target) ?? Number(SCOPE_DEFAULTS[SCOPE_RECORDS]);
  const eligible = (Array.isArray(sizes) ? sizes : []).filter(isMap)
    .map((g) => ({ value: g.value == null ? null : String(g.value), records: finite(Number(g.records)) ?? 0 }))
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

export function scopeGroupText(group) {
  return (group || []).map((p) => (p.column ? `${p.column} = ${p.value}` : p.value)).join(SCOPE_GROUP_AND);
}

export function scopeGroupsText(groups, recordsOf = () => null) {
  const list = Array.isArray(groups) ? groups : [];
  if (!list.length) return '';
  const named = list.map((g) => {
    const records = recordsOf(g);
    return `${scopeGroupText(g)}${records == null ? '' : `, ${counted(records, 'record')}`}`;
  });
  return `First run uses ${counted(list.length, 'group')}: ${named.join('; ')}`;
}

export function withScopeDefaults(values, profile) {
  if (!isMap(profile) || text(values[RUN_SCOPE])) return values;
  const chosen = firstRunDefault(profile);
  const next = { ...values, [RUN_SCOPE]: chosen };
  if (chosen === 'groups' && !text(values[SCOPE_GROUPS])) next[SCOPE_GROUPS] = scopeGroupsValue(suggestedGroups(profile).map((g) => g.parts));
  return next;
}

export function groupingDefault(profile) {
  if (!isMap(profile) || profile.applies !== true || profile.qualifies !== true) return GROUP_ALL;
  const recommended = groupingChoices(profile).find((c) => c.recommended);
  if (!recommended) return GROUP_ALL;
  return recommended.sql || joinedColumnsOf(profile, recommended.columns).length ? GROUP_CUSTOM : recommended.value;
}

function joinedColumnsOf(profile, columns) {
  const joined = new Set((Array.isArray(profile?.columns) ? profile.columns : []).filter((c) => isMap(c) && isMap(c.join)).map((c) => text(c.name).toLowerCase()));
  return (columns || []).filter((c) => joined.has(text(c).toLowerCase()));
}

export function withGroupingDefault(values, profile) {
  if (groupByColumns(values[GROUP_BY]).some((c) => c.toLowerCase() !== GROUP_ALL)) return values;
  return { ...values, [GROUP_BY]: groupingDefault(profile) };
}

export function withUnrecordedScope(values, profile) {
  return withScopeDefaults(values, isMap(profile) ? profile : { default_scope: GROUP_ALL });
}

export function groupingChoices(profile, settingChoices = []) {
  const recommended = (Array.isArray(profile?.recommended) ? profile.recommended : []).map(text).filter(Boolean);
  const columns = (Array.isArray(profile?.columns) ? profile.columns : []).filter(isMap);
  const shown = columns.map((c) => text(c.name)).filter(Boolean);
  const joinOf = new Map(columns.filter((c) => isMap(c.join)).map((c) => [text(c.name), c.join]));
  const grouped = isMap(profile?.prefill?.grouped) ? profile.prefill.grouped : {};
  const extra = recommended.length || shown.length ? [] : (settingChoices || []).map(text).filter((c) => c && ![GROUP_ALL, GROUP_CUSTOM].includes(c.toLowerCase()));
  const known = [...new Set([...recommended, ...shown, ...extra])];
  const withSql = (choice) => {
    const sql = text(grouped[choice.value]);
    if (!sql) return choice;
    const via = choice.columns.filter((c) => joinOf.has(c)).map((c) => `${c} joins on ${text(joinOf.get(c).key)} = ${text(joinOf.get(c).ref_column)}`);
    return { ...choice, sql, note: `${via.join('; ')}. ${GROUPING_JOINED_NOTE}` };
  };
  const list = [{ value: GROUP_ALL, label: GROUPING_GLOBAL_LABEL, columns: [] }];
  if (recommended.length) list.push(withSql({ value: recommended.join(', '), label: recommended.join(', then '), columns: recommended, recommended: true }));
  for (const column of known) {
    if (recommended.length === 1 && column === recommended[0]) continue;
    list.push(withSql({ value: column, label: column, columns: [column] }));
  }
  list.push({ value: GROUP_CUSTOM, label: GROUPING_CUSTOM_LABEL, columns: [] });
  return list;
}

export function groupingReasonText(profile) {
  return isMap(profile) && profile.applies === true && profile.qualifies !== true ? text(profile.reason) : '';
}

export function groupingExampleText(profile) {
  const groups = suggestedGroups(profile);
  const column = text(profile?.example?.column) || (Array.isArray(profile?.recommended) ? text(profile.recommended[profile.recommended.length - 1]) : '');
  const big = groups.find((g) => g.kind === 'biggest') || groups[0];
  const small = groups.find((g) => g.kind === 'smallest') || groups[groups.length - 1];
  if (!column || !big || !small || big.value === small.value || big.records == null || small.records == null) return '';
  return `${big.value} has ${counted(big.records, 'record')} and ${small.value} has ${counted(small.records, 'record')}. Grouped by ${column}, `
    + `each ${column} is compared only with its own records, so what is normal for ${big.value} does not hide what stands out in ${small.value}.`;
}

export function groupingMovesUpText(profile) {
  const example = isMap(profile?.example) ? profile.example : null;
  const small = (Array.isArray(example?.small_groups) ? example.small_groups : []).filter(isMap).find((g) => text(g.value));
  if (!small) return '';
  const into = text(example.moves_to) || GROUPING_GLOBAL_LABEL;
  const records = finite(small.records);
  return `A group too small to compare fairly moves up a level: ${text(small.value)}${records == null ? '' : ` has ${counted(records, 'record')}, so it`} `
    + `is measured with ${into}.`;
}

export function finestGroupColumn(profile) {
  return text(profile?.group_column) || (Array.isArray(profile?.recommended) ? text(profile.recommended[profile.recommended.length - 1]) : '');
}

export function recordGroups(profile, values) {
  if (!isMap(profile) || profile.standalone === true) return null;
  return wholeGroups(profile.group_sizes, values?.[SCOPE_RECORDS]);
}

export function recordGroupsText(profile, values) {
  const picked = recordGroups(profile, values);
  const goal = whole(values?.[SCOPE_RECORDS]) ?? Number(SCOPE_DEFAULTS[SCOPE_RECORDS]);
  if (!picked) return `The first ${counted(goal, 'record')}`;
  if (!picked.length) {
    return `The first ${counted(goal, 'record')}; this technique reads records together and no column groups them, so a group may be cut in this first run`;
  }
  const column = finestGroupColumn(profile);
  const total = picked.reduce((sum, g) => sum + g.records, 0);
  const lead = total > goal
    ? `${counted(total, 'record')} in the smallest whole group, since every group of ${column || 'the grouping'} holds more than ${counted(goal, 'record')}, so no group is cut: `
    : `About ${counted(goal, 'record')}, in ${counted(picked.length, 'whole group')} so no group is cut: `;
  return lead + picked.map((g) => `${column ? `${column} = ` : ''}${g.value}, ${counted(g.records, 'record')}`).join('; ');
}

export function chosenGroupsText(profile, values) {
  const groups = suggestedGroups(profile);
  const picked = scopeGroupsOf(values?.[SCOPE_GROUPS], finestGroupColumn(profile));
  return scopeGroupsText(picked, (g) => groups.find((s) => scopeGroupKey(s.parts) === scopeGroupKey(g))?.records ?? null);
}

export function everythingEstimate(everything, total, first) {
  if (text(everything)) return text(everything);
  const size = whole(first) || Number(SCOPE_DEFAULTS[SCOPE_RECORDS]);
  if (total == null || total <= size) return '';
  return `Everything is ${counted(total, 'record')}, about ${Math.round(total / size).toLocaleString('en-US')} times a ${size.toLocaleString('en-US')}-record first run, `
    + 'so expect it to take about that many times longer';
}

export function firstRunChoices(profile, values, everything = '') {
  const fr = isMap(profile?.first_run) ? profile.first_run : {};
  const groups = suggestedGroups(profile);
  const picked = scopeGroupsOf(values?.[SCOPE_GROUPS], finestGroupColumn(profile));
  const pickedRecords = picked.map((g) => groups.find((s) => scopeGroupKey(s.parts) === scopeGroupKey(g))?.records);
  const days = whole(values?.[SCOPE_DAYS]);
  const recent = isMap(profile?.recent) ? profile.recent : null;
  const records = whole(values?.[SCOPE_RECORDS]);
  const total = profileRecords(profile);
  const timeColumn = text(profile?.time_column);
  const via = isMap(profile?.time_via) && text(profile.time_via.date) && text(profile.time_via.table) ? profile.time_via : null;
  const timeName = via ? `${text(via.date)} in ${text(via.table)}, through ${timeColumn}` : timeColumn;
  const inGroups = recordGroups(profile, values);
  const grouped = Array.isArray(inGroups) && inGroups.length > 0;
  return [
    {
      id: 'groups', label: 'Chosen groups', available: groups.length > 0,
      records: picked.length && pickedRecords.every((n) => n != null) ? pickedRecords.reduce((a, b) => a + b, 0) : picked.length ? null : finite(fr.groups),
    },
    {
      id: 'recent', label: timeColumn ? `The last ${days ?? SCOPE_DEFAULTS[SCOPE_DAYS]} days of ${timeName}` : 'A recent period', available: Boolean(timeColumn),
      records: recent && days != null && Number(recent.days) === days ? finite(recent.records) ?? finite(fr.recent) : days == null ? null : finite(fr.recent),
      exact: Boolean(recent && days != null && Number(recent.days) === days),
    },
    {
      id: 'records',
      label: recordGroupsText(profile, values),
      available: true,
      records: grouped ? inGroups.reduce((a, g) => a + g.records, 0) : records != null && total != null ? Math.min(records, total) : finite(fr.records),
      groups: grouped ? inGroups : null,
    },
    { id: 'custom', label: FIRST_RUN_CUSTOM_LABEL, available: Boolean(text(profile?.table)), records: null },
    { id: 'all', label: 'Everything', available: true, records: finite(fr.all) ?? total, estimate: everythingEstimate(everything, finite(fr.all) ?? total, values?.[SCOPE_RECORDS]) },
  ];
}

export const GROUPING_CUSTOM_UNSAVED = 'Grouping is custom; write the grouping SQL, press Preview, then press Use this grouping';

export function customGroupingProblem(values, custom) {
  if (!custom || custom.saved === undefined || text(values?.[GROUP_BY]).toLowerCase() !== GROUP_CUSTOM) return '';
  if (!custom.saved) return GROUPING_CUSTOM_UNSAVED;
  const savedFor = text(custom.saved.result_table);
  const now = text(custom.resultTable) ? groupingMainTable(custom.resultTable)?.canonical || text(custom.resultTable) : '';
  if (now && now !== savedFor) {
    return `The custom grouping is saved for ${savedFor || 'another result table'}, but the results now go to ${now}; press Preview, then Use this grouping again`;
  }
  return '';
}

export function scopeProblems(values, profile = null, part = 'both', custom = null) {
  const problems = [];
  const grouping = [];
  const unsaved = customGroupingProblem(values, custom);
  if (unsaved) grouping.push(unsaved);
  const scope = text(values?.[RUN_SCOPE]);
  const wrongScope = runScopeProblem(scope);
  if (wrongScope) problems.push(wrongScope);
  if (scope === 'custom' && isMap(custom?.firstRun) && custom.firstRun.saved !== undefined && !custom.firstRun.saved) problems.push(FIRST_RUN_CUSTOM_UNSAVED);
  if (scope === 'recent' && (whole(values?.[SCOPE_DAYS]) ?? 0) < 1) problems.push(`Days to run on is '${text(values?.[SCOPE_DAYS])}'; allowed: a whole number, at least 1`);
  if (scope === 'records' && (whole(values?.[SCOPE_RECORDS]) ?? 0) < 1) {
    problems.push(`Records to run on is '${text(values?.[SCOPE_RECORDS])}'; allowed: a whole number, at least 1`);
  }
  if (groupByColumns(values?.[GROUP_BY]).some((c) => [GROUP_ALL, GROUP_CUSTOM].includes(c.toLowerCase())) && groupByColumns(values?.[GROUP_BY]).length > 1) {
    grouping.push(`Grouping is '${text(values?.[GROUP_BY])}'; choose ${GROUP_ALL}, ${GROUP_CUSTOM} or column names, not a mix`);
  }
  const joined = joinedColumnsOf(profile, groupByColumns(values?.[GROUP_BY]));
  if (joined.length) {
    grouping.push(`Grouping names ${joined.join(', ')}, a column of a table this use case joins; pick it from the list so Inspire saves the grouping SQL that joins it`);
  }
  if (part === 'grouping') return grouping;
  return part === 'first_run' ? problems : [...problems, ...grouping];
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
  return { grouping: ready && profile.applies === true, firstRun: ready || profileState === 'error' || (builtFirstRun === true && profileState === 'loading') };
}

export function builtFirstRunOf(model) {
  return (Array.isArray(model) ? model : []).some((s) => isMap(s) && text(s.name) === RUN_SCOPE && s.source === 'widget');
}

export const SCOPE_ALL_TEXT = 'All records';

export function scopeText(values, profile = null) {
  const scope = text(values?.[RUN_SCOPE]) || GROUP_ALL;
  if (scope === 'groups') {
    const picked = scopeGroupsOf(values?.[SCOPE_GROUPS], finestGroupColumn(profile));
    return picked.length ? `First run: ${counted(picked.length, 'group')} (${picked.map(scopeGroupText).join(picked.some((g) => g.length > 1) ? '; ' : ', ')})` : 'First run: the largest groups';
  }
  if (scope === 'recent') return `First run: the last ${counted(whole(values?.[SCOPE_DAYS]) ?? Number(SCOPE_DEFAULTS[SCOPE_DAYS]), 'day')}`;
  if (scope === 'records') {
    const goal = counted(whole(values?.[SCOPE_RECORDS]) ?? Number(SCOPE_DEFAULTS[SCOPE_RECORDS]), 'record');
    return isMap(profile) ? `First run: ${recordGroupsText(profile, values)}`
      : `First run: about ${goal}, in whole groups when the technique reads records together`;
  }
  if (scope === 'custom') return 'First run: the records the saved first run SQL returns';
  return SCOPE_ALL_TEXT;
}

export function profileHeldText(profile) {
  const records = profileRecords(profile);
  const table = text(profile?.table);
  if (records == null || !table) return '';
  const smaller = firstRunDefault(profile) !== GROUP_ALL;
  return `${table} holds ${counted(records, 'record')}${smaller ? ', so Inspire suggests a smaller first run to show results sooner.' : '.'}`;
}
