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
export const RUN_SCOPES = ['all', 'groups', 'recent', 'records'];
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

export function profileRecords(profile) {
  return finite(profile?.records);
}

export function firstRunDefault(profile) {
  if (!isMap(profile)) return '';
  return RUN_SCOPES.includes(profile.default_scope) ? profile.default_scope : GROUP_ALL;
}

export function suggestedGroups(profile) {
  return (Array.isArray(profile?.suggested_groups) ? profile.suggested_groups : []).filter(isMap)
    .map((g) => ({ value: text(g.value), records: finite(g.records), kind: text(g.kind) })).filter((g) => g.value);
}

export function withScopeDefaults(values, profile) {
  if (!isMap(profile) || text(values[RUN_SCOPE])) return values;
  const chosen = firstRunDefault(profile);
  const next = { ...values, [RUN_SCOPE]: chosen };
  if (chosen === 'groups' && !text(values[SCOPE_GROUPS])) next[SCOPE_GROUPS] = suggestedGroups(profile).map((g) => g.value).join(', ');
  return next;
}

export function groupingChoices(profile, settingChoices = []) {
  const recommended = (Array.isArray(profile?.recommended) ? profile.recommended : []).map(text).filter(Boolean);
  const known = recommended.length ? recommended : (settingChoices || []).map(text).filter((c) => c && ![GROUP_ALL, GROUP_CUSTOM].includes(c.toLowerCase()));
  const list = [{ value: GROUP_ALL, label: GROUPING_GLOBAL_LABEL, columns: [] }];
  if (recommended.length) list.push({ value: recommended.join(', '), label: recommended.join(', then '), columns: recommended, recommended: true });
  for (const column of known) {
    if (recommended.length === 1 && column === recommended[0]) continue;
    list.push({ value: column, label: column, columns: [column] });
  }
  list.push({ value: GROUP_CUSTOM, label: GROUPING_CUSTOM_LABEL, columns: [] });
  return list;
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

export function firstRunChoices(profile, values) {
  const fr = isMap(profile?.first_run) ? profile.first_run : {};
  const groups = suggestedGroups(profile);
  const picked = groupByColumns(values?.[SCOPE_GROUPS]);
  const pickedRecords = picked.map((v) => groups.find((g) => g.value.toLowerCase() === v.toLowerCase())?.records);
  const days = whole(values?.[SCOPE_DAYS]);
  const recent = isMap(profile?.recent) ? profile.recent : null;
  const records = whole(values?.[SCOPE_RECORDS]);
  const total = profileRecords(profile);
  const timeColumn = text(profile?.time_column);
  return [
    {
      id: 'groups', label: 'Chosen groups', available: groups.length > 0,
      records: picked.length && pickedRecords.every((n) => n != null) ? pickedRecords.reduce((a, b) => a + b, 0) : picked.length ? null : finite(fr.groups),
    },
    {
      id: 'recent', label: timeColumn ? `The last ${days ?? SCOPE_DEFAULTS[SCOPE_DAYS]} days of ${timeColumn}` : 'A recent period', available: Boolean(timeColumn),
      records: recent && days != null && Number(recent.days) === days ? finite(recent.records) ?? finite(fr.recent) : days == null ? null : finite(fr.recent),
      exact: Boolean(recent && days != null && Number(recent.days) === days),
    },
    {
      id: 'records', label: `The first ${counted(records ?? Number(SCOPE_DEFAULTS[SCOPE_RECORDS]), 'record')}`, available: profile?.standalone === true,
      records: records != null && total != null ? Math.min(records, total) : finite(fr.records),
    },
    { id: 'all', label: 'Everything', available: true, records: finite(fr.all) ?? total },
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
  if (scope && !RUN_SCOPES.includes(scope)) problems.push(`First run is '${scope}'; allowed: ${RUN_SCOPES.join(', ')}`);
  if (scope === 'records' && isMap(profile) && profile.standalone !== true) {
    problems.push('A first run on a number of records works only when each record stands alone; choose chosen groups, a recent period or everything');
  }
  if (scope === 'recent' && (whole(values?.[SCOPE_DAYS]) ?? 0) < 1) problems.push(`Days to run on is '${text(values?.[SCOPE_DAYS])}'; allowed: a whole number, at least 1`);
  if (scope === 'records' && (whole(values?.[SCOPE_RECORDS]) ?? 0) < 1) {
    problems.push(`Records to run on is '${text(values?.[SCOPE_RECORDS])}'; allowed: a whole number, at least 1`);
  }
  if (groupByColumns(values?.[GROUP_BY]).some((c) => [GROUP_ALL, GROUP_CUSTOM].includes(c.toLowerCase())) && groupByColumns(values?.[GROUP_BY]).length > 1) {
    grouping.push(`Grouping is '${text(values?.[GROUP_BY])}'; choose ${GROUP_ALL}, ${GROUP_CUSTOM} or column names, not a mix`);
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

export function scopeStepsOf(profileState, profile) {
  const ready = profileState === 'ready' && isMap(profile);
  return { grouping: ready && profile.qualifies === true, firstRun: ready || profileState === 'error' };
}

export const SCOPE_ALL_TEXT = 'All records';

export function scopeText(values) {
  const scope = text(values?.[RUN_SCOPE]) || GROUP_ALL;
  if (scope === 'groups') {
    const picked = groupByColumns(values?.[SCOPE_GROUPS]);
    return picked.length ? `First run: ${counted(picked.length, 'group')} (${picked.join(', ')})` : 'First run: the largest groups';
  }
  if (scope === 'recent') return `First run: the last ${counted(whole(values?.[SCOPE_DAYS]) ?? Number(SCOPE_DEFAULTS[SCOPE_DAYS]), 'day')}`;
  if (scope === 'records') return `First run: the first ${counted(whole(values?.[SCOPE_RECORDS]) ?? Number(SCOPE_DEFAULTS[SCOPE_RECORDS]), 'record')}`;
  return SCOPE_ALL_TEXT;
}

export function profileHeldText(profile) {
  const records = profileRecords(profile);
  const table = text(profile?.table);
  if (records == null || !table) return '';
  const smaller = firstRunDefault(profile) !== GROUP_ALL;
  return `${table} holds ${counted(records, 'record')}${smaller ? ', so Inspire suggests a smaller first run to show results sooner.' : '.'}`;
}
