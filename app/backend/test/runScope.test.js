const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const lib = (name) => import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', name)).href);

const PROFILE = {
  table: 'main.sales.orders', records: 48210, applies: true, qualifies: true, reason: 'anomaly detection compares each record with its group', standalone: false,
  columns: [{ name: 'region', type: 'string', distinct: 4, smallest: 210, largest: 30110, nulls: 0, parent: null },
    { name: 'country', type: 'string', distinct: 31, smallest: 12, largest: 18200, nulls: 3, parent: 'region' }],
  recommended: ['region', 'country'],
  example: { column: 'country', small_groups: [{ value: 'Cyprus', records: 12 }], moves_to: 'Europe' },
  time_column: 'order_date', recent: { days: 30, records: 3120 },
  suggested_groups: [{ value: 'USA', records: 18200, kind: 'biggest' }, { value: 'Spain', records: 1400, kind: 'typical' }, { value: 'Cyprus', records: 12, kind: 'smallest' }],
  first_run: { all: 48210, groups: 19612, recent: 3120, records: null }, default_scope: 'groups', read_at: '2026-11-01T15:00:00Z',
  group_column: 'country', group_sizes: [{ value: 'USA', records: 18200 }, { value: 'Spain', records: 1400 }, { value: 'Malta', records: 300 }],
  groups_for: 'region, country',
  group_list: [['AMER', 'USA', 18200], ['EMEA', 'Spain', 1400], ['EMEA', 'Malta', 300], ['EMEA', 'Cyprus', 12]]
    .map(([region, country, records]) => ({ value: `${region} / ${country}`, records, parts: [{ column: 'region', value: region }, { column: 'country', value: country }] })),
  column_groups: { region: [{ value: 'AMER', records: 30110 }, { value: 'EMEA', records: 17890 }, { value: 'APAC', records: 210 }],
    country: [{ value: 'USA', records: 18200 }, { value: 'Spain', records: 1400 }, { value: 'Malta', records: 300 }, { value: 'Cyprus', records: 12 }] },
};

test('the scope settings carry the contract keys, labels and defaults, and an empty value reads as its default', async () => {
  const S = await lib('runScope.js');
  assert.deepEqual(S.SCOPE_SETTINGS, ['group_by', 'run_scope', 'scope_groups', 'scope_days', 'scope_records']);
  assert.deepEqual(Object.values(S.SCOPE_LABELS), ['Data groups', 'MVP Test Run', 'Groups to run on', 'Days to run on', 'Records to run on']);
  assert.deepEqual([S.GROUPING_SETTINGS, S.FIRST_RUN_SETTINGS], [['group_by'], ['run_scope', 'scope_groups', 'scope_days', 'scope_records']],
    'Data groups owns group_by and First run owns the rest, with nothing in both and nothing left out');
  assert.deepEqual([...S.GROUPING_SETTINGS, ...S.FIRST_RUN_SETTINGS].sort(), [...S.SCOPE_SETTINGS].sort());
  for (const name of S.SCOPE_SETTINGS) {
    assert.notEqual(S.isGroupingSetting({ name }), S.isFirstRunSetting({ name }), `${name} belongs to exactly one step`);
  }
  assert.equal(S.isGroupingSetting({ name: 'horizon' }) || S.isFirstRunSetting({ name: 'horizon' }), false, 'another setting is in neither step (must-exclude)');
  assert.deepEqual([S.GROUPING_SAVE_LABEL, S.FIRST_RUN_SAVE_LABEL], ['Save Data groups', 'Save MVP Test Run']);
  assert.deepEqual(S.RUN_SCOPES, ['all', 'groups', 'recent', 'records']);
  assert.equal(S.FIRST_RUN_RECORDS_LINE, undefined, 'the 1,000 record line lives once, in the backend grouping rule that answers default_scope');
  assert.equal(S.GROUP_MIN_RECORDS, undefined, 'the smallest group size lives once, in the backend grouping rule');
  assert.deepEqual(S.scopeValues(() => undefined), { group_by: 'all', run_scope: '', scope_groups: '', scope_days: '30', scope_records: '1000' });
  assert.deepEqual(S.scopeValues((n) => ({ group_by: ' region, country ', run_scope: 'recent', scope_days: '7' }[n])),
    { group_by: 'region, country', run_scope: 'recent', scope_groups: '', scope_days: '7', scope_records: '1000' });
  assert.deepEqual(S.scopeChanges({ run_scope: 'all', scope_groups: '' }, { run_scope: 'groups', scope_groups: 'USA' }), ['scope_groups', 'run_scope'],
    'the groups are saved before the scope that reads them');
  assert.deepEqual(S.scopeChanges({ run_scope: 'all' }, { run_scope: 'all' }), []);
});

test('First run defaults to the scope the profile answers, and never over a choice the person made', async () => {
  const S = await lib('runScope.js');
  assert.equal(S.firstRunDefault(PROFILE), PROFILE.default_scope);
  assert.equal(S.firstRunDefault({ ...PROFILE, records: 1000, default_scope: 'all' }), 'records', 'everything is never the default, not even from an older answer (must-exclude)');
  assert.equal(S.firstRunDefault({ ...PROFILE, records: 1001, default_scope: 'recent' }), 'recent');
  assert.equal(S.firstRunDefault({ ...PROFILE, default_scope: 'nonsense' }), 'records', 'an answer the App cannot read never defaults to everything (must-exclude)');
  assert.equal(S.firstRunDefault(null), '');
  const fresh = S.withScopeDefaults(S.scopeValues(() => undefined), PROFILE);
  assert.deepEqual([fresh.run_scope, fresh.scope_groups], ['groups', '[[{"column":"country","value":"USA"}],[{"column":"country","value":"Spain"}],[{"column":"country","value":"Cyprus"}]]'], 'the suggested biggest, typical and smallest groups are ticked');
  const chosen = S.withScopeDefaults({ ...S.scopeValues(() => undefined), run_scope: 'all' }, PROFILE);
  assert.deepEqual([chosen.run_scope, chosen.scope_groups], ['all', ''], 'the person chose everything, so the default does not apply');
  assert.equal(S.withScopeDefaults({ run_scope: '' }, { ...PROFILE, records: 400, default_scope: 'all' }).run_scope, 'records', 'a small table runs about 1,000 records, which covers it, never a silent everything');
});

test('Grouping offers Global first, the recommended columns coarse to fine, and each column, with no custom SQL choice and a real example', async () => {
  const S = await lib('runScope.js');
  assert.deepEqual(S.groupingChoices(PROFILE).map((c) => [c.value, c.label, Boolean(c.recommended)]), [
    ['all', 'Whole data as one group', false], ['region, country', 'region, then country', true], ['region', 'region', false], ['country', 'country', false]]);
  assert.deepEqual(S.groupingChoices(null, ['store', 'all']).map((c) => c.value), ['all', 'store'], 'without a profile the columns the agent read are offered');
  assert.deepEqual(S.groupingChoices(null).map((c) => c.value), ['all'], 'Global is always offered, and never a custom SQL choice');
  assert.deepEqual(S.groupingChoices(null, ['custom', 'region']).map((c) => c.value), ['all', 'region'], 'a recorded custom choice is not offered back');
  assert.equal(S.groupingExampleText(PROFILE),
    'USA has 18,200 records and Cyprus has 12 records. Grouped by country, each country is compared only with its own records, so what is normal for USA does not hide what stands out in Cyprus.');
  assert.equal(S.groupingMovesUpText(PROFILE), 'A group too small to compare fairly moves up a level: Cyprus has 12 records, so it is measured with Europe.');
  assert.equal(S.groupingExampleText({ ...PROFILE, suggested_groups: [] }), '');
  assert.equal(S.groupingMovesUpText({ ...PROFILE, example: null }), '');
  assert.ok(S.sameGrouping('Region , country', 'region,country'));
  assert.ok(S.sameGrouping('', 'all'));
  assert.ok(!S.sameGrouping('country', 'region, country'));
});

test('a Deep discovery grouping sets Data groups only, and First run keeps its own default of about 1,000 records in whole groups (must-exclude)', async () => {
  const S = await lib('runScope.js');
  const DEEP = { ...PROFILE, default_scope: 'records', deep_suggestion: { columns: ['store_id'], record_level: 'order_id' } };
  assert.equal(S.firstRunDefault(DEEP), 'records', 'the Data groups choice never decides the First run choice');
  const fresh = S.scopeValues(() => undefined);
  const scoped = S.withScopeDefaults(S.withGroupingDefault(fresh, DEEP, ''), DEEP);
  assert.deepEqual([scoped.group_by, scoped.run_scope, scoped.scope_groups || ''], ['store_id', 'records', '']);
  assert.equal(S.firstRunDefault({ ...DEEP, default_scope: 'all' }), 'records', 'never a silent everything (must-exclude)');
  assert.equal(S.firstRunDefault({ ...DEEP, deep_suggestion: null }), 'records', 'no Deep grouping: the profile default stays');
  assert.equal(S.firstRunDefault({ ...DEEP, deep_suggestion: { columns: ['', null] } }), 'records', 'a blank Deep grouping is no Deep grouping');
});

test('a Deep discovery grouping is picked first and marked, a profile without one picks its recommendation, and a person\u2019s pick is never replaced (must-exclude)', async () => {
  const S = await lib('runScope.js');
  const DEEP = { ...PROFILE, deep_suggestion: { columns: ['stores.region', 'store_id'], record_level: 'order_id' } };
  assert.deepEqual(S.groupingChoices(DEEP).map((c) => [c.value, c.label, Boolean(c.deep), Boolean(c.recommended)]), [
    ['all', 'Whole data as one group', false, false], ['stores.region, store_id', 'stores.region, then store_id', true, false],
    ['region, country', 'region, then country', false, true], ['region', 'region', false, false], ['country', 'country', false, false]]);
  const same = S.groupingChoices({ ...PROFILE, deep_suggestion: { columns: ['Region', 'country'] } });
  assert.deepEqual(same.map((c) => [c.value, Boolean(c.deep), Boolean(c.recommended)]), [['all', false, false], ['Region, country', true, true],
    ['region', false, false], ['country', false, false]], 'Deep and the profile agreeing is one choice with both marks');
  assert.equal(S.GROUPING_DEEP_MARK, 'Suggested by discovery');
  const fresh = S.scopeValues(() => undefined);
  assert.equal(S.withGroupingDefault(fresh, DEEP, '').group_by, 'stores.region, store_id', 'nothing picked yet, so the Deep grouping is picked');
  assert.equal(S.withGroupingDefault(fresh, PROFILE, '').group_by, 'region, country', 'no Deep grouping: the build-time recommendation is picked');
  assert.equal(S.withGroupingDefault(fresh, null, '').group_by, 'all');
  assert.equal(S.withGroupingDefault({ ...fresh, group_by: 'all' }, DEEP, 'all').group_by, 'all', 'the person picked Global, so it stays');
  assert.equal(S.withGroupingDefault({ ...fresh, group_by: 'country' }, DEEP, 'country').group_by, 'country', 'the person picked a column, so it stays');
  assert.equal(S.withGroupingDefault(fresh, { ...DEEP, deep_suggestion: { columns: ['', null] } }, '').group_by, 'region, country', 'a blank Deep grouping falls back to the recommendation');
  assert.equal(S.withGroupingDefault(fresh, { ...DEEP, applies: false, qualifies: false, deep_suggestion: null }, '').group_by, 'all', 'Global only when nothing qualifies');
  assert.deepEqual(S.scopeStepsOf('ready', { ...DEEP, qualifies: false }), { grouping: true, firstRun: true }, 'a Deep grouping shows the Grouping step');
  assert.deepEqual(S.scopeStepsOf('ready', { ...PROFILE, applies: false, qualifies: false, deep_suggestion: null }), { grouping: false, firstRun: true });
  assert.equal(S.groupingChosenBy('', DEEP), 'deep', 'a Deep grouping nobody picked is Deep discovery\'s choice');
  assert.equal(S.groupingChosenBy('stores.region, store_id', DEEP), 'person', 'picking the Deep grouping makes it the person\'s choice');
  assert.equal(S.groupingChosenBy('all', DEEP), 'person');
  assert.equal(S.groupingChosenBy('', PROFILE), '', 'no Deep grouping: nothing is chosen until the person picks');
  assert.equal(S.groupingChosenBy('', null), '');
  assert.equal(S.GROUPING_DEEP_PICKED, 'Discovery picked this grouping. It becomes your choice when you pick it or another one.');
  const deepFirst = S.withScopeDefaults(S.withGroupingDefault(fresh, DEEP, ''), DEEP);
  assert.deepEqual([deepFirst.run_scope, deepFirst.scope_groups], ['groups', ''],
    'the profile answers groups, and its groups are countries, not values of the Deep grouping, so none are ticked for it (must-exclude)');
  const profiled = S.withScopeDefaults({ ...fresh, group_by: 'region, country' }, PROFILE);
  assert.deepEqual([profiled.run_scope, JSON.parse(profiled.scope_groups)], ['groups', ['USA', 'Spain', 'Cyprus'].map((value) => [{ column: 'country', value }])]);
  const other = S.withScopeDefaults({ ...fresh, group_by: 'region' }, PROFILE);
  assert.equal(other.scope_groups, '', 'Data groups whose finest column is not the profiled one get no country values');
});

test('First run offers one group, several groups of the chosen Data groups, about 1,000 records, a recent period only with a date column, and everything last', async () => {
  const S = await lib('runScope.js');
  const values = { ...S.withScopeDefaults(S.scopeValues(() => undefined), PROFILE), group_by: 'country' };
  const choices = S.firstRunChoices(PROFILE, values);
  assert.deepEqual(choices.map((c) => [c.id, c.scope, c.available, c.records]), [['one', 'groups', true, null], ['groups', 'groups', true, 19612],
    ['records', 'records', true, 300], ['recent', 'recent', true, 3120], ['all', 'all', true, 48210]]);
  assert.equal(choices[2].label, 'About 1,000 records, in 1 whole group so no group is cut: country = Malta, 300 records');
  assert.equal(choices[3].label, 'The last 30 days of order_date');
  const two = S.firstRunChoices(PROFILE, { ...values, scope_groups: 'USA, Cyprus' });
  assert.equal(two[1].records, 18212, 'the records of the ticked groups');
  assert.equal(S.firstRunChoices(PROFILE, { ...values, scope_groups: 'USA' })[0].records, 18200, 'one group counts its own records');
  const week = S.firstRunChoices(PROFILE, { ...values, scope_days: '7' });
  assert.equal(week[3].label, 'The last 7 days of order_date');
  const standalone = S.firstRunChoices({ ...PROFILE, standalone: true, time_column: null, recent: null }, { ...values, scope_records: '500' });
  assert.deepEqual(standalone.map((c) => [c.id, c.available]), [['one', true], ['groups', true], ['records', true], ['recent', false], ['all', true]]);
  assert.equal(standalone[2].label, 'The first 500 records');
  assert.equal(standalone[2].records, 500);
  const via = { ...PROFILE, records: 718931, suggested_groups: [], first_run: { all: 718931, groups: null, recent: 21000, records: null }, default_scope: 'recent',
    time_column: 'ws_ship_date_sk', time_via: { table: 'samples.tpcds_sf1.date_dim', key: 'd_date_sk', date: 'd_date' }, recent: { days: 30, records: 21000 } };
  const viaValues = S.withScopeDefaults(S.scopeValues(() => undefined), via);
  assert.equal(viaValues.run_scope, 'recent', 'a recent period the profile answers is kept');
  const fresh = S.withScopeDefaults(S.scopeValues(() => undefined), { ...via, default_scope: 'records' });
  assert.equal(fresh.run_scope, 'records', '718,931 records first run on about 1,000 records, never a recent period by default');
  const dated = S.firstRunChoices(via, viaValues);
  assert.deepEqual(dated.filter((c) => c.available).map((c) => [c.id, c.records]), [['records', 1000], ['recent', 21000], ['all', 718931]],
    'the whole data as one group has no group to pick (must-exclude)');
  assert.equal(dated[2].label, 'The first 1,000 records of the whole data, which is one group');
  assert.equal(dated[3].label, 'The last 30 days of d_date in samples.tpcds_sf1.date_dim, through ws_ship_date_sk');
});

test('the groups First run lists are the groups of the Data groups chosen in the step before, with their sizes, and a grouping the profile did not list is read again (must-exclude)', async () => {
  const S = await lib('runScope.js');
  const nested = S.groupingGroupsOf(PROFILE, 'Region , Country');
  assert.deepEqual(nested.map((g) => [g.value, g.records, g.parts.map((p) => p.column)]), [['AMER / USA', 18200, ['region', 'country']],
    ['EMEA / Spain', 1400, ['region', 'country']], ['EMEA / Malta', 300, ['region', 'country']], ['EMEA / Cyprus', 12, ['region', 'country']]]);
  assert.deepEqual(S.groupingGroupsOf(PROFILE, 'region').map((g) => [g.value, g.records, g.parts]),
    [['AMER', 30110, [{ column: 'region', value: 'AMER' }]], ['EMEA', 17890, [{ column: 'region', value: 'EMEA' }]], ['APAC', 210, [{ column: 'region', value: 'APAC' }]]]);
  assert.deepEqual(S.groupingGroupsOf(PROFILE, 'all'), [], 'the whole data as one group lists no group to pick');
  assert.deepEqual(S.groupingGroupsOf(PROFILE, ''), []);
  assert.equal(S.groupingGroupsOf(PROFILE, 'country, region'), null, 'another order is another grouping, which the profile did not list');
  assert.equal(S.groupingGroupsOf(PROFILE, 'store'), null, 'a column the profile did not keep');
  assert.equal(S.groupingGroupsOf(null, 'region'), null);
  assert.equal(S.groupsReadNeeded(PROFILE, 'country, region'), true);
  assert.equal(S.groupsReadNeeded(PROFILE, 'region'), true, 'its groups are listed, but a sample in whole groups needs the sizes of region groups');
  assert.equal(S.groupsReadNeeded(PROFILE, 'region, country'), false);
  assert.equal(S.groupsReadNeeded(PROFILE, 'country'), false);
  assert.equal(S.groupsReadNeeded(PROFILE, 'all'), false);
  assert.equal(S.groupsReadNeeded(null, 'region'), false, 'nothing read yet, nothing to read again');
  const STAR = { ...PROFILE, columns: [...PROFILE.columns, { name: 'item.i_category', distinct: 3, join: { table: 'main.retail.item', key: 'ss_item_sk', ref_column: 'i_item_sk' } }],
    column_groups: { ...PROFILE.column_groups, 'item.i_category': [{ value: 'Home', records: 900 }, { value: '', records: 3 }, { value: null, records: 4 }] } };
  assert.deepEqual(S.groupingGroupsOf(STAR, 'item.i_category'), [{ value: 'Home', records: 900,
    parts: [{ column: 'item.i_category', value: 'Home', join: { table: 'main.retail.item', key: 'ss_item_sk', ref_column: 'i_item_sk' } }] }],
  'a joined column carries its join, and an empty value is no group (must-exclude)');
  assert.equal(S.wholeGroupColumn('region, item.i_category'), 'region', 'a sample in whole groups takes the finest column of the main table, as the run does');
  assert.equal(S.wholeGroupColumn('item.i_category'), '');
  assert.equal(S.wholeGroupColumn('all'), '');
});

test('First run says in plain words what it covers, for every choice, and a small table is covered whole by about 1,000 records', async () => {
  const S = await lib('runScope.js');
  const base = { ...S.scopeValues(() => undefined), group_by: 'country', scope_groups: '' };
  const covers = (values, profile = PROFILE) => S.firstRunCoversText(profile, { ...base, ...values });
  assert.equal(covers({ run_scope: 'groups', scope_groups: 'USA' }), 'The MVP Test Run covers 1 group of country: country = USA, 18,200 records. Every other group waits for a run on everything.');
  assert.equal(covers({ run_scope: 'groups', scope_groups: 'USA, Spain' }),
    'The MVP Test Run covers 2 groups of country: country = USA; country = Spain, 19,600 records. Every other group waits for a run on everything.');
  assert.equal(covers({ run_scope: 'groups' }), 'The MVP Test Run covers no group yet; pick the groups it runs on.');
  assert.equal(covers({ run_scope: 'records' }), 'The MVP Test Run covers about 1,000 records, in 1 whole group so no group is cut: country = Malta, 300 records.');
  assert.equal(covers({ run_scope: 'records' }, { ...PROFILE, records: 700 }), 'The MVP Test Run covers all 700 records of main.sales.orders, since it holds no more than 1,000 records.');
  assert.equal(covers({ run_scope: 'recent' }), 'The MVP Test Run covers the last 30 days of order_date, 3,120 records.');
  assert.match(covers({ run_scope: 'all' }), /^The MVP Test Run covers everything, 48,210 records\. Everything is 48,210 records, about 48 times a 1,000-record MVP Test Run/);
  assert.equal(covers({ run_scope: '' }), '', 'no choice yet says nothing, never everything (must-exclude)');
  assert.equal(S.firstRunChoiceOf({ run_scope: 'groups', scope_groups: 'USA' }), 'one');
  assert.equal(S.firstRunChoiceOf({ run_scope: 'groups', scope_groups: 'USA, Spain' }), 'groups');
  assert.equal(S.firstRunChoiceOf({ run_scope: 'groups', scope_groups: '' }), 'groups');
  assert.equal(S.firstRunChoiceOf({ run_scope: '' }), '');
});

test('the scope checks refuse what the agent would refuse, and accept what it runs', async () => {
  const S = await lib('runScope.js');
  const base = S.scopeValues(() => undefined);
  assert.deepEqual(S.scopeProblems({ ...base, run_scope: 'records' }), [], 'about 1,000 records in whole groups');
  assert.deepEqual(S.scopeProblems({ ...base, run_scope: 'records' }), [], 'the first 1,000 records');
  assert.deepEqual(S.scopeProblems({ ...base, run_scope: 'records', scope_records: '0' }), ["Records to run on is '0'; allowed: a whole number, at least 1"]);
  assert.deepEqual(S.scopeProblems({ ...base, run_scope: 'custom' }, 'first_run'), [`MVP Test Run is 'custom': ${S.CUSTOM_SQL_REFUSED}`]);
  assert.deepEqual(S.scopeProblems({ ...base, group_by: 'region, custom' }, 'grouping'), [`Data groups is 'region, custom': ${S.CUSTOM_SQL_REFUSED}`]);
  assert.deepEqual(S.scopeProblems({ ...base, run_scope: 'recent', scope_days: '0' }), ["Days to run on is '0'; allowed: a whole number, at least 1"]);
  assert.deepEqual(S.scopeProblems({ ...base, run_scope: 'recent', scope_days: '2.5' }), ["Days to run on is '2.5'; allowed: a whole number, at least 1"]);
  assert.deepEqual(S.scopeProblems({ ...base, run_scope: 'everything' }), ["MVP Test Run is 'everything'; allowed: all, groups, recent, records"]);
  assert.deepEqual(S.scopeProblems({ ...base, group_by: 'all, country' }), ["Data groups is 'all, country'; choose all or column names, not a mix"]);
  assert.deepEqual(S.scopeProblems({ ...base, run_scope: 'groups', group_by: 'region, country', scope_groups: 'USA' }), []);
  assert.deepEqual(S.scopeProblems({ ...base, run_scope: 'groups', group_by: 'region, country' }, 'first_run'), ['Groups to run on is empty; pick at least one group'],
    'a first run on groups with no group picked is refused, never a silent pick (must-exclude)');
  assert.deepEqual(S.scopeProblems({ ...base, run_scope: 'groups', group_by: 'region, country' }, 'grouping'), [], 'Data groups never names a First run problem');
});

test('the scope reads as the agent writes it, and counts carry thousands separators', async () => {
  const S = await lib('runScope.js');
  const P = await lib('plural.js');
  assert.equal(S.scopeText({ run_scope: 'all' }), 'All records');
  assert.equal(S.scopeText({ run_scope: '' }), 'All records');
  assert.equal(S.scopeText({ run_scope: 'groups', scope_groups: 'USA, Spain' }), 'MVP Test Run: 2 groups (USA, Spain)');
  assert.equal(S.scopeText({ run_scope: 'recent', scope_days: '1' }), 'MVP Test Run: the last 1 day');
  assert.equal(S.scopeText({ run_scope: 'records', scope_records: '1500' }), 'MVP Test Run: about 1,500 records, in whole groups when the technique reads records together');
  assert.equal(P.counted(48210, 'record'), '48,210 records');
  assert.equal(P.counted(1, 'record'), '1 record');
  assert.equal(S.profileHeldText(PROFILE), 'main.sales.orders holds 48,210 records, so Inspire suggests a smaller MVP Test Run to show results sooner.');
  assert.equal(S.profileHeldText({ ...PROFILE, records: 800, default_scope: 'all' }), 'main.sales.orders holds 800 records, so the MVP Test Run covers all of it.');
  assert.equal(S.profileHeldText({ ...PROFILE, records: 1, default_scope: 'all' }), 'main.sales.orders holds 1 record, so the MVP Test Run covers all of it.');
  assert.equal(S.profileHeldText({ ...PROFILE, records: 0, default_scope: 'all' }), 'main.sales.orders holds no records yet, so an MVP Test Run has nothing to read until data arrives.');
  assert.doesNotMatch(S.profileHeldText({ ...PROFILE, records: 0, default_scope: 'all' }), /0 records|about/, 'an empty table never promises a first run of records (must-exclude)');
});

test('the wizard shows Grouping only when the profile says it applies, First run whenever the table was read or the read failed, and each step names only its own problems', async () => {
  const S = await lib('runScope.js');
  assert.deepEqual(S.scopeStepsOf('ready', PROFILE), { grouping: true, firstRun: true });
  assert.deepEqual(S.scopeStepsOf('ready', { ...PROFILE, applies: false, qualifies: false }), { grouping: false, firstRun: true }, 'a standalone technique hides Grouping');
  assert.deepEqual(S.scopeStepsOf('ready', { ...PROFILE, applies: 'yes' }), { grouping: false, firstRun: true }, 'only applies true shows Grouping');
  assert.deepEqual(S.scopeStepsOf('ready', { ...PROFILE, qualifies: false, recommended: [] }), { grouping: true, firstRun: true },
    'a technique that compares records shows Grouping even when no column qualifies, so Global can be picked');
  assert.deepEqual(S.scopeStepsOf('error', null), { grouping: false, firstRun: true }, 'a refused read still lets the person pick the first run');
  for (const state of ['loading', 'none', 'off']) assert.deepEqual(S.scopeStepsOf(state, null), { grouping: false, firstRun: false }, state);
  const values = { ...S.scopeValues(() => undefined), group_by: 'all, country', run_scope: 'records', scope_records: '0' };
  const grouping = "Data groups is 'all, country'; choose all or column names, not a mix";
  const records = "Records to run on is '0'; allowed: a whole number, at least 1";
  assert.deepEqual(S.scopeProblems(values, 'grouping'), [grouping]);
  assert.deepEqual(S.scopeProblems(values, 'first_run'), [records]);
  assert.deepEqual(S.scopeProblems(values), [records, grouping]);
});

test('a scoped run states its scope with the App\u2019s own words, and a run after another scope says so as a fact', async () => {
  const S = await lib('runScope.js');
  const groups = { run_id: 'r3', scope: { scope: 'groups', key: 'g1' }, scope_text: 'First run: 2 groups of country (USA, Spain)',
    facts: { covered: 'The first run covered 19,600 of 48,210 records (2 groups) in 4 minutes.', everything: 'Run on everything covers all 48,210 records.' } };
  const all = { run_id: 'r2', scope: { scope: 'all', key: 'all' }, scope_text: 'All records', facts: { covered: '', everything: '' } };
  assert.deepEqual(S.runScopeFacts([groups, all]), { scoped: true, text: 'First run: 2 groups of country (USA, Spain)',
    covered: 'The first run covered 19,600 of 48,210 records (2 groups) in 4 minutes.', everything: 'Run on everything covers all 48,210 records.',
    note: 'The previous run covered a different scope.' });
  assert.equal(S.runScopeFacts([groups, { ...groups, run_id: 'r2' }]).note, '', 'the same scope twice says nothing');
  assert.deepEqual(S.runScopeFacts([all, groups]), { scoped: false, text: 'All records', covered: '', everything: '', note: 'The previous run covered a different scope.' });
  assert.equal(S.runScopeFacts([groups]).note, '', 'nothing to compare with');
  assert.deepEqual(S.runScopeFacts([{ run_id: 'r1' }]), { scoped: false, text: '', covered: '', everything: '', note: '' }, 'a run with no scope record claims none');
  assert.equal(S.runScopeFacts([]), null);
  assert.equal(S.runScopeFacts(undefined), null);
});

test('the profile hook state names loading, ready, a missing route and a refusal apart', async () => {
  const G = await lib('groupingProfile.js');
  const key = G.profileKey({ inspireDatabase: 'main.inspire', sessionId: 2222222222222222222n, useCaseId: 'N01-U01', warehouseId: 'w1' });
  assert.deepEqual(G.profileBody(key), { inspire_database: 'main.inspire', session_id: '2222222222222222222', use_case_id: 'N01-U01', warehouse_id: 'w1' },
    'a session id keeps every digit');
  for (const id of ['N01 U01', 'a/b & c+d', 'حالة 1', 'x\ny', 'a=b&session_id=9', '["x","y"]', 'p%20q']) {
    assert.equal(G.profileBody(G.profileKey({ inspireDatabase: 'main.inspire', sessionId: '1', useCaseId: id, warehouseId: 'w1' })).use_case_id, id,
      'the use case id reaches the route exactly as written');
  }
  assert.equal(G.profileKey({ inspireDatabase: 'main.inspire', sessionId: '', useCaseId: 'N01-U01' }), '');
  assert.equal(G.profileKey({ inspireDatabase: 'main.inspire', sessionId: '1', useCaseId: '   ' }), '');
  assert.equal(G.profileKey({ sessionId: '1', useCaseId: 'N01-U01' }), '', 'no tracking database, nothing to read the use case from');
  assert.equal(G.profileKey({ inspireDatabase: 'main.inspire', sessionId: '1', useCaseId: 'N01-U01', enabled: false }), '');
  assert.deepEqual(G.profileState('', null), { state: 'off', profile: null, error: '' });
  assert.equal(G.profileState(key, null).state, 'loading');
  assert.equal(G.profileState(key, { key: 'other', profile: PROFILE }).state, 'loading', 'an answer for another use case is not this one');
  assert.deepEqual(G.profileState(key, { key, profile: PROFILE, status: 200 }), { state: 'ready', profile: PROFILE, error: '' });
  assert.equal(G.profileState(key, { key, profile: null, error: 'no API route', status: 404 }).state, 'none');
  assert.deepEqual(G.profileState(key, { key, profile: null, error: 'You cannot read main.sales.orders', status: 403 }),
    { state: 'error', profile: null, error: 'You cannot read main.sales.orders' });
});

test('the profile body the wizard, the Build page and the Run tab send is one the real profile route accepts', async () => {
  const G = await lib('groupingProfile.js');
  const { makeApp, listen } = require('./support/implementApp');
  const made = makeApp({
    forwardedToken: 'person-tok',
    useCase: { id: 'N01-U01', primary_table: 'main.sales.orders', tables_involved: 'main.sales.orders', analytics_technique: 'Anomaly Detection' },
    columns: [{ column_name: 'order_id', data_type: 'STRING', ordinal_position: 1 }, { column_name: 'region', data_type: 'STRING', ordinal_position: 2 }],
  });
  const srv = await listen(made.app);
  try {
    const key = G.profileKey({ inspireDatabase: 'main.inspire', sessionId: '42', useCaseId: 'N01-U01', warehouseId: 'wh1' });
    const resp = await fetch(`${srv.url}${G.GROUPING_PROFILE_ROUTE}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(G.profileBody(key)),
    });
    const data = await resp.json();
    assert.equal(resp.status, 200, JSON.stringify(data));
    assert.equal(data.table, 'main.sales.orders');
    assert.ok(made.sqlCalls.some((c) => c.token === 'person-tok' && String(c.sql).includes('information_schema.columns')), 'the table is read with the person token');
  } finally {
    await srv.close();
  }
});

const LEGACY = require('../../agent/tests/fixtures/run_scope_legacy_cases.json');
const RECORDED_RUN_SCOPE = LEGACY.declaration;
const declaredOf = (declared) => (declared === 'recorded' ? RECORDED_RUN_SCOPE : declared && { ...RECORDED_RUN_SCOPE, ...declared });
const SCOPE_ALLOWED = 'all, groups, recent, records';
const SCOPE_CASES = [['all', ''], ['groups', ''], ['recent', ''], ['records', ''], ['custom', `run_scope is 'custom': ${require('../../frontend/src/lib/runScope.js').CUSTOM_SQL_REFUSED}`], ['', ''],
  ['5', `run_scope is '5'; allowed: ${SCOPE_ALLOWED}`], ['everything', `run_scope is 'everything'; allowed: ${SCOPE_ALLOWED}`]];

test('a First run a built version recorded as a number takes every First run choice and refuses a number or another word, in the App and the server alike', async () => {
  const S = await lib('runScope.js');
  const U = await lib('useCaseSettings.js');
  const I = require('../lib/inspireImplement');
  for (const [value, problem] of SCOPE_CASES) {
    assert.equal(S.runScopeProblem(value), problem.replace('run_scope', 'MVP Test Run'), `First run step ${value}`);
    assert.equal(S.runScopeProblem(value, 'run_scope'), problem, `runScopeProblem ${value}`);
    assert.equal(U.settingProblem(RECORDED_RUN_SCOPE, value), problem, `App ${value}`);
    assert.equal(I.implementSettingProblem(RECORDED_RUN_SCOPE, value), problem, `server ${value}`);
    assert.deepEqual(I.widgetProblems([], { run_scope: value }), problem ? [problem] : [], `submit ${value}`);
    assert.deepEqual(I.widgetProblems([{ name: 'run_scope', allowed: 'a number' }], { run_scope: value }), problem ? [problem] : [], `submit with a widget rule ${value}`);
  }
});

test('the recorded settings read run_scope as the First run choice on both sides, and the server and the App share one list of First run choices', async () => {
  const S = await lib('runScope.js');
  const U = await lib('useCaseSettings.js');
  const I = require('../lib/inspireImplement');
  const R = require('../lib/groupingRule');
  const history = [{ asset_status: { settings: [RECORDED_RUN_SCOPE, { name: 'horizon', kind: 'number', allowed: 'whole number', whole: true, source: 'widget' }] } }];
  const want = { kind: 'choice', choices: ['all', 'groups', 'recent', 'records'], many: false, allowed: SCOPE_ALLOWED, low: null, high: null, whole: false };
  for (const [side, model] of [['App', U.settingsModelOf(history)], ['server', I.implementSettingsModel(history)]]) {
    const scope = model.find((s) => s.name === 'run_scope');
    assert.deepEqual(Object.fromEntries(Object.keys(want).map((k) => [k, scope[k]])), want, side);
    assert.equal(scope.source, 'widget', side);
    assert.equal(model.find((s) => s.name === 'horizon').kind, 'number', `${side} leaves other settings alone`);
  }
  assert.equal(R.RUN_SCOPES, S.RUN_SCOPES, 'one list, not a copy');
  assert.equal(S.runScopeSetting(RECORDED_RUN_SCOPE).choices === S.RUN_SCOPES, false, 'each setting gets its own copy to edit');
  assert.deepEqual(S.runScopeSetting({ name: 'horizon', kind: 'number' }), { name: 'horizon', kind: 'number' });
  assert.equal(S.runScopeSetting(null), null);
});

test('a built version that recorded a First run keeps the First run step while the table is read, the same as the step bar it ends on', async () => {
  const S = await lib('runScope.js');
  assert.equal(S.builtFirstRunOf([RECORDED_RUN_SCOPE]), true);
  assert.equal(S.builtFirstRunOf([{ ...RECORDED_RUN_SCOPE, source: 'inspire' }]), false, 'only a setting the build ran with');
  assert.equal(S.builtFirstRunOf([{ name: 'horizon', source: 'widget' }]), false);
  for (const model of [null, undefined, 'x', [], [null]]) assert.equal(S.builtFirstRunOf(model), false, JSON.stringify(model));
  assert.deepEqual(S.scopeStepsOf('loading', null, true), { grouping: false, firstRun: true });
  assert.deepEqual(S.scopeStepsOf('ready', PROFILE, true), { grouping: true, firstRun: true });
  assert.deepEqual(S.scopeStepsOf('ready', { ...PROFILE, applies: false, qualifies: false }, true), { grouping: false, firstRun: true });
  for (const state of ['none', 'off']) assert.deepEqual(S.scopeStepsOf(state, null, true), { grouping: false, firstRun: false }, state);
  assert.deepEqual(S.scopeStepsOf('loading', null, 'yes'), { grouping: false, firstRun: false }, 'only true keeps it');
});

test('the wizard reads a First run, recorded or still a notebook widget, as its choice, checks it and does not mark it as derived', async () => {
  const U = await lib('useCaseSettings.js');
  const recorded = U.wizardSettings({ model: [RECORDED_RUN_SCOPE], editing: true });
  const widget = U.wizardSettings({ widgets: [{ name: 'run_scope', type: 'text', default: 'all', allowed: 'a number' }], family: 'E' });
  for (const [side, settings] of [['recorded', recorded], ['widget', widget]]) {
    const scope = settings.find((s) => s.name === 'run_scope');
    assert.equal(scope.kind, 'choice', side);
    assert.deepEqual(scope.choices, ['all', 'groups', 'recent', 'records'], side);
    assert.equal(scope.derived, false, side);
    for (const [value, problem] of SCOPE_CASES) assert.equal(U.settingProblem(scope, value), problem, `${side} ${value}`);
  }
});


test('a First run a build recorded as a number or another word is mapped on read to the choice it meant, and to no choice when it cannot be known (must-exclude)', async () => {
  const S = await lib('runScope.js');
  assert.ok(LEGACY.read.some((c) => !c.unrecorded && c.mapped.run_scope === 'records') && LEGACY.read.some((c) => c.unrecorded));
  for (const { value, declared, mapped, unrecorded } of LEGACY.read) {
    const got = S.recordedRunScope({ ...LEGACY.kept, run_scope: value }, declaredOf(declared));
    assert.deepEqual(got, { values: { ...LEGACY.kept, ...mapped }, unrecorded }, `${JSON.stringify(value)} ${JSON.stringify(declared)}`);
  }
  const kept = { run_scope: 'recent', scope_days: '7' };
  assert.equal(S.recordedRunScope(kept, RECORDED_RUN_SCOPE).values, kept, 'a valid choice is read as it is');
  for (const values of [null, undefined, 'x', [], {}]) assert.deepEqual(S.recordedRunScope(values, RECORDED_RUN_SCOPE), { values: {}, unrecorded: false });
  assert.equal(S.runScopeDeclared([{ name: 'top_k' }, RECORDED_RUN_SCOPE]), RECORDED_RUN_SCOPE);
  for (const list of [null, 'x', [], [null, { name: 'top_k' }]]) assert.equal(S.runScopeDeclared(list), null);
  const row = (status) => ({ spec_json: { config: { widgets: { run_scope: '5' } } }, asset_status: status });
  for (const status of [{ settings: [RECORDED_RUN_SCOPE] }, null, { settings: 'x' }]) {
    assert.deepEqual(S.latestRunScope(row(status)), { values: { run_scope: '' }, unrecorded: true }, JSON.stringify(status));
  }
  assert.deepEqual(S.latestRunScope({ spec_json: { config: { widgets: { run_scope: '30' } } },
    asset_status: { settings: [{ ...RECORDED_RUN_SCOPE, label: 'Days to cover' }] } }), { values: { run_scope: 'recent', scope_days: '30' }, unrecorded: false });
  assert.deepEqual(S.latestRunScope({ spec_json: { config: { widgets: { run_scope: '30' } } }, asset_status: JSON.stringify({ settings: [{ ...RECORDED_RUN_SCOPE, label: 'Days to cover' }] }) }),
    { values: { run_scope: '' }, unrecorded: true }, 'the browser reads rows the server already parsed, never JSON text');
  for (const latest of [null, undefined, {}, { spec_json: 'x' }]) assert.deepEqual(S.latestRunScope(latest), { values: {}, unrecorded: false });
});

test('a First run that cannot be known starts from the default the First run step uses for that table, and about 1,000 records, never everything, when the table was not read', async () => {
  const S = await lib('runScope.js');
  const empty = { run_scope: '', scope_groups: '' };
  assert.deepEqual(S.withScopeDefaults(empty, PROFILE), { run_scope: 'groups', scope_groups: '[[{"column":"country","value":"USA"}],[{"column":"country","value":"Spain"}],[{"column":"country","value":"Cyprus"}]]' });
  assert.deepEqual(S.withScopeDefaults(empty, { ...PROFILE, default_scope: 'all' }), { run_scope: 'records', scope_groups: '' }, 'never everything by default (must-exclude)');
  for (const profile of [null, undefined, 'x']) assert.deepEqual(S.withScopeDefaults(empty, profile), { run_scope: 'records', scope_groups: '' }, String(profile));
  assert.deepEqual(S.withScopeDefaults({ run_scope: 'recent' }, PROFILE), { run_scope: 'recent' }, 'never over a choice');
  assert.equal(S.withScopeDefaults(empty, null).run_scope, S.firstRunDefault({}));
  for (const { table_default: given, run_scope: expected } of LEGACY.unrecorded_default) {
    assert.equal(S.withScopeDefaults(empty, given == null ? null : { default_scope: given }).run_scope, expected, String(given));
  }
});

test('the wizard reads an old spec whose First run is a number as no choice yet, also for a held version, and keeps every other widget', async () => {
  const W = await lib('implementWizard.js');
  const fallback = W.defaultSpecFromUseCase({ No: 'N01-U01', Name: 'Basket' }, {});
  const latest = (status, extra = {}) => ({ spec_version: 2, status, spec_json: { config: { widgets: { run_scope: '5', top_k: '10' } } },
    asset_status: { settings: [RECORDED_RUN_SCOPE] }, ...extra });
  for (const status of ['ready', 'vibe_not_met']) {
    const spec = W.specFromLatest(latest(status), fallback);
    assert.deepEqual(spec.config.widgets, { run_scope: '', top_k: '10' }, status);
  }
  const days = W.specFromLatest(latest('ready', { asset_status: { settings: [{ ...RECORDED_RUN_SCOPE, unit: 'days' }] } }), fallback);
  assert.deepEqual(days.config.widgets, { run_scope: 'recent', scope_days: '5', top_k: '10' });
  const valid = W.specFromLatest({ spec_version: 2, status: 'ready', spec_json: { config: { widgets: { run_scope: 'records', top_k: '10' } } } }, fallback);
  assert.deepEqual(valid.config.widgets, { run_scope: 'records', top_k: '10' });
  assert.equal(W.specFromLatest(null, fallback), fallback);
});

test('the server maps a First run recorded as a number on read, and locks First run on an App built before it had choices while Grouping stays editable', () => {
  const I = require('../lib/inspireImplement');
  const GROUPING = { name: 'group_by', kind: 'choice', choices: ['region'], many: true, source: 'widget', group: 'scope', default: 'all' };
  const history = (widgets) => [{ spec_version: 1, status: 'ready', spec_json: { config: { widgets } }, asset_status: { settings: [RECORDED_RUN_SCOPE, GROUPING] } }];
  const recorded = (widgets) => I.implementSettingsRecorded(history(widgets)).find((s) => s.name === 'run_scope');
  const lost = recorded({ run_scope: '5' });
  assert.equal(lost.kind, 'choice');
  assert.equal(lost.value, '');
  assert.equal(lost.unrecorded, true);
  assert.equal(recorded({ run_scope: 'groups' }).value, 'groups');
  assert.equal(recorded({ run_scope: 'groups' }).unrecorded, undefined);
  assert.equal(recorded({}).value, 'all', 'no recorded First run reads as the declared default');
  const appView = (value, saved = false) => [{ ...RECORDED_RUN_SCOPE, value, saved, editable: true }, { ...GROUPING, value: 'all', editable: true }];
  const [scope, grouping] = I.implementAppSettings(appView('all'), history({ run_scope: 'recent' }));
  assert.deepEqual([scope.kind, scope.choices, scope.value, scope.editable, scope.locked, scope.unrecorded],
    ['choice', ['all', 'groups', 'recent', 'records'], 'recent', false, require('../../frontend/src/lib/runScope.js').RUN_SCOPE_OLD_APP, undefined]);
  assert.equal(grouping.editable, true, 'Grouping saves through the old App as before');
  const savedNumber = I.implementAppSettings(appView('5', true), history({ run_scope: 'recent' }))[0];
  assert.deepEqual([savedNumber.value, savedNumber.unrecorded, savedNumber.editable], ['', true, false], 'a number the old App saved wins over the recorded spec and cannot be known');
  const unrecordedSpec = I.implementAppSettings(appView('all'), history({ run_scope: '5' }))[0];
  assert.deepEqual([unrecordedSpec.value, unrecordedSpec.unrecorded], ['', true]);
  const choiceApp = [{ ...RECORDED_RUN_SCOPE, kind: 'choice', choices: ['all', 'groups', 'recent', 'records'], value: 'groups', editable: true }];
  assert.equal(I.implementAppSettings(choiceApp, history({ run_scope: '5' })), choiceApp, 'an App with First run choices is read as it answers');
  for (const settings of [null, 'x', []]) assert.deepEqual(I.implementAppSettings(settings, []), [], String(settings));
});

const GROUP_CASES = require('../../agent/tests/fixtures/implement_grouping_cases.json').first_run.groups;

test('chosen groups read, write and name the same way as the notebook reader, from the shared cases', async () => {
  const S = await lib('runScope.js');
  for (const c of GROUP_CASES.parse) assert.deepEqual(S.scopeGroupsOf(c.value, c.finest), c.groups, `parse ${c.value}`);
  for (const c of GROUP_CASES.format) {
    assert.equal(S.scopeGroupsValue(c.groups), c.value, `format ${c.value}`);
    assert.deepEqual(S.scopeGroupsOf(c.value, c.groups.length ? c.groups[0][0].column : ''), c.groups, `round trip ${c.value}`);
  }
  for (const c of GROUP_CASES.text) assert.equal(S.scopeGroupText(c.group), c.text);
  for (const [i, c] of GROUP_CASES.whole_groups.entries()) assert.deepEqual(S.wholeGroups(c.sizes, c.target), c.picked, `whole groups case ${i}`);
});

test('a legacy comma list of groups reads as one-value groups of the finest column and is written back naming that column', async () => {
  const S = await lib('runScope.js');
  const groups = S.scopeGroupsOf('USA, Spain', 'country');
  assert.deepEqual(groups, [[{ column: 'country', value: 'USA' }], [{ column: 'country', value: 'Spain' }]]);
  assert.equal(S.scopeGroupsValue(groups), '[[{"column":"country","value":"USA"}],[{"column":"country","value":"Spain"}]]');
  assert.deepEqual(S.scopeGroupsOf(S.scopeGroupsValue(groups), 'region'), groups, 'a later change of the finest column does not move the saved groups');
  assert.equal(S.scopeGroupsValue(S.scopeGroupsOf('USA, Spain', '')), 'USA, Spain', 'with no known column the list stays as it was');
  assert.equal(S.scopeText({ run_scope: 'groups', scope_groups: 'USA, Spain' }), 'MVP Test Run: 2 groups (USA, Spain)');
});

const STAR_PROFILE = {
  table: 'main.retail.store_sales', records: 2880404, applies: true, qualifies: true, standalone: false, reason: '',
  columns: [{ name: 'ss_store_sk', type: 'int', distinct: 6, smallest: 470000, largest: 490000, nulls: 0, parent: null },
    { name: 'item.i_category', type: 'string', distinct: 10, smallest: 280000, largest: 295000, nulls: 0, parent: 'ss_store_sk',
      join: { table: 'main.retail.item', key: 'ss_item_sk', ref_column: 'i_item_sk' } }],
  recommended: ['ss_store_sk', 'item.i_category'], time_column: 'ss_sold_date_sk', recent: { days: 30, records: 0 },
  suggested_groups: [
    { value: '1 / Electronics', records: 49210, kind: 'biggest', parts: [{ column: 'ss_store_sk', value: '1' },
      { column: 'item.i_category', value: 'Electronics', join: { table: 'main.retail.item', key: 'ss_item_sk', ref_column: 'i_item_sk' } }] },
    { value: '7 / Home', records: 28180, kind: 'typical', parts: [{ column: 'ss_store_sk', value: '7' },
      { column: 'item.i_category', value: 'Home', join: { table: 'main.retail.item', key: 'ss_item_sk', ref_column: 'i_item_sk' } }] }],
  group_column: 'ss_store_sk',
  group_sizes: [{ value: '1', records: 490000 }, { value: '7', records: 470000 }],
  groups_for: 'ss_store_sk, item.i_category',
  group_list: [
    { value: '1 / Electronics', records: 49210, parts: [{ column: 'ss_store_sk', value: '1' },
      { column: 'item.i_category', value: 'Electronics', join: { table: 'main.retail.item', key: 'ss_item_sk', ref_column: 'i_item_sk' } }] },
    { value: '7 / Home', records: 28180, parts: [{ column: 'ss_store_sk', value: '7' },
      { column: 'item.i_category', value: 'Home', join: { table: 'main.retail.item', key: 'ss_item_sk', ref_column: 'i_item_sk' } }] }],
  column_groups: { ss_store_sk: [{ value: '1', records: 490000 }, { value: '7', records: 470000 }],
    'item.i_category': [{ value: 'Electronics', records: 295000 }, { value: 'Home', records: 280000 }] },
  first_run: { all: 2880404, groups: 77390, recent: null, records: null }, default_scope: 'records', read_at: '2026-11-04T05:00:00Z',
};

test('a star-schema forecast above 1,000 records defaults to whole groups, never everything or a recent period, and names every group with its records (must-exclude)', async () => {
  const S = await lib('runScope.js');
  const values = S.withScopeDefaults(S.withGroupingDefault(S.scopeValues(() => undefined), STAR_PROFILE), STAR_PROFILE);
  assert.equal(values.group_by, 'ss_store_sk, item.i_category');
  assert.equal(values.run_scope, 'records');
  assert.notEqual(values.run_scope, 'all');
  assert.notEqual(values.run_scope, 'recent');
  const choices = S.firstRunChoices(STAR_PROFILE, values);
  assert.deepEqual(choices.map((c) => [c.id, c.available, c.records]),
    [['one', true, null], ['groups', true, null], ['records', true, 470000], ['recent', true, 0], ['all', true, 2880404]]);
  assert.equal(choices[2].label, '470,000 records in the smallest whole group, since every group of ss_store_sk holds more than 1,000 records, so no group is cut: ss_store_sk = 7, 470,000 records',
    'whole groups of the finest column of the main table, as the run takes them, never of the joined column');
  assert.equal(choices[4].estimate, 'Everything is 2,880,404 records, about 2,880 times a 1,000-record MVP Test Run; how long it takes is unknown until a larger run is measured');
  assert.equal(S.everythingEstimate('', 8000, 1000), 'Everything is 8,000 records, about 8 times a 1,000-record MVP Test Run, so it takes up to about 8 times as long');
  assert.equal(S.everythingEstimate('', 1000, 1000), '');
  assert.equal(S.everythingEstimate('the server said so', 7500000, 1000), 'the server said so');
  assert.deepEqual(S.scopeProblems(values, 'first_run'), []);
  assert.equal(S.scopeText(values, STAR_PROFILE), 'MVP Test Run: 470,000 records in the smallest whole group, since every group of ss_store_sk holds more than 1,000 records, so no group is cut: ss_store_sk = 7, 470,000 records');
  const picked = { ...values, run_scope: 'groups', scope_groups: JSON.stringify(STAR_PROFILE.suggested_groups.map((g) => g.parts)) };
  assert.equal(S.chosenGroupsText, undefined, 'the First run covers line is the one sentence that names the chosen groups');
  assert.equal(S.firstRunCoversText(STAR_PROFILE, picked), 'The MVP Test Run covers 2 groups of ss_store_sk, then item.i_category: ss_store_sk = 1 and '
    + 'item.i_category = Electronics; ss_store_sk = 7 and item.i_category = Home, 77,390 records. Every other group waits for a run on everything.');
  assert.equal(S.scopeText(picked), 'MVP Test Run: 2 groups (ss_store_sk = 1 and item.i_category = Electronics; ss_store_sk = 7 and item.i_category = Home)');
});

test('above 1,000 records every default is a number of records, never everything or a recent period, and the backend answer is read as given (must-exclude)', async () => {
  const S = await lib('runScope.js');
  for (const scope of ['records', 'groups', 'recent']) assert.equal(S.firstRunDefault({ ...STAR_PROFILE, default_scope: scope }), scope);
  assert.equal(S.firstRunDefault({ ...STAR_PROFILE, default_scope: '' }), 'records', 'an old answer with no default never reads as everything (must-exclude)');
  const bare = { ...STAR_PROFILE, applies: false, qualifies: false, recommended: [], suggested_groups: [], group_sizes: [], group_column: null, time_column: null,
    recent: null, first_run: { all: 2880404, groups: null, recent: null, records: null } };
  const values = S.withScopeDefaults(S.scopeValues(() => undefined), bare);
  assert.equal(values.run_scope, 'records');
  const records = S.firstRunChoices(bare, values).find((c) => c.id === 'records');
  assert.equal(records.label, 'The first 1,000 records; this technique reads records together and no column groups them, so a group may be cut in this MVP Test Run');
  assert.equal(records.available, true);
  assert.deepEqual(S.scopeProblems(values, 'first_run'), []);
  assert.deepEqual(S.scopeProblems({ ...values, run_scope: 'all' }, 'first_run'), [], 'everything is still a choice someone can make');
  const standalone = { ...bare, standalone: true };
  assert.equal(S.firstRunChoices(standalone, values).find((c) => c.id === 'records').label, 'The first 1,000 records');
});

test('a custom first run is refused on the First run step only, and is never described as a run Inspire can do', async () => {
  const S = await lib('runScope.js');
  const values = { ...S.scopeValues(() => undefined), run_scope: 'custom' };
  assert.deepEqual(S.scopeProblems(values, 'first_run'), [`MVP Test Run is 'custom': ${S.CUSTOM_SQL_REFUSED}`]);
  assert.deepEqual(S.scopeProblems(values, 'grouping'), []);
  assert.equal(S.runScopeProblem('custom'), `MVP Test Run is 'custom': ${S.CUSTOM_SQL_REFUSED}`);
  assert.equal(S.runScopeProblem('records'), '');
  assert.equal(S.firstRunChoices(STAR_PROFILE, values).some((c) => c.id === 'custom'), false);
  assert.equal(S.scopeText(values), S.SCOPE_ALL_TEXT);
});

test('a first run on records of a grouping technique takes whole groups, and falls back to the first records with a plain note when the table has none', async () => {
  const S = await lib('runScope.js');
  const values = { ...S.scopeValues(() => undefined), group_by: 'ss_store_sk, item.i_category', run_scope: 'records', scope_records: '1000000' };
  assert.deepEqual(S.recordGroups(STAR_PROFILE, values), [{ value: '1', records: 490000 }, { value: '7', records: 470000 }]);
  assert.equal(S.recordGroups(STAR_PROFILE, { ...values, group_by: 'all' }), null, 'the whole data as one group has no group to keep whole');
  assert.equal(S.recordGroupsText(STAR_PROFILE, { ...values, group_by: 'all' }), 'The first 1,000,000 records of the whole data, which is one group');
  assert.equal(S.recordGroups(STAR_PROFILE, { ...values, group_by: 'ss_sold_date_sk' }), null,
    'whole groups of another column than the profiled one are not counted until they are read (must-exclude)');
  assert.equal(S.recordGroups(STAR_PROFILE, { ...values, group_by: 'item.i_category, ss_store_sk' }).length, 2, 'the finest column of the main table decides, whatever the joined one');
  assert.equal(S.recordGroupsText({ ...STAR_PROFILE, group_column: 'item.i_category' }, values), 'About 1,000,000 records, in whole groups of ss_store_sk so no group is cut');
  assert.deepEqual(S.scopeProblems(values, 'first_run'), []);
  const none = { ...STAR_PROFILE, group_sizes: [] };
  assert.deepEqual(S.scopeProblems(values, 'first_run'), []);
  assert.match(S.recordGroupsText(none, values), /^The first 1,000,000 records; this technique reads records together/);
});

test('a first run on about 1,000 records names the real count when every whole group is larger, and never calls it about 1,000 (must-exclude)', async () => {
  const S = await lib('runScope.js');
  const profile = { table: 't', standalone: false, group_column: 'store', group_sizes: [{ value: 'A', records: 480000 }, { value: 'B', records: 470000 }] };
  const said = S.recordGroupsText(profile, { scope_records: '1000' });
  assert.equal(said, '470,000 records in the smallest whole group, since every group of store holds more than 1,000 records, so no group is cut: store = B, 470,000 records');
  assert.doesNotMatch(said, /About 1,000/);
  assert.equal(S.recordGroupsText({ ...profile, group_sizes: [{ value: 'A', records: 600 }, { value: 'B', records: 300 }] }, { scope_records: '1000' }),
    'About 1,000 records, in 2 whole groups so no group is cut: store = A, 600 records; store = B, 300 records');
  assert.equal(S.recordGroupsText({ ...profile, standalone: true }, { scope_records: '1000' }), 'The first 1,000 records');
});

test('the wizard pre-selects Deep discovery\u2019s grouping, else the recommended grouping with a joined column by its table and column, and Global only when nothing qualifies (must-exclude)', async () => {
  const S = await lib('runScope.js');
  assert.equal(S.groupingDefault(PROFILE), 'region, country');
  assert.equal(S.groupingDefault(STAR_PROFILE), 'ss_store_sk, item.i_category', 'a joined column is named by its table and column, never as a grouping SQL');
  assert.notEqual(S.groupingDefault(STAR_PROFILE), 'custom');
  assert.equal(S.groupingDefault({ ...STAR_PROFILE, deep_suggestion: { columns: ['item.i_category'] } }), 'item.i_category', 'Deep discovery wins over the build-time recommendation');
  assert.equal(S.groupingDefault({ ...PROFILE, qualifies: false, deep_suggestion: { columns: ['region'] } }), 'region', 'Deep discovery names a grouping even when no profiled column qualifies');
  assert.equal(S.groupingDefault({ ...STAR_PROFILE, recommended: ['ss_store_sk'] }), 'ss_store_sk');
  assert.equal(S.groupingDefault({ ...PROFILE, qualifies: false, recommended: [] }), 'all');
  assert.equal(S.groupingDefault({ ...PROFILE, applies: false }), 'all');
  assert.equal(S.groupingDefault(null), 'all');
  assert.notEqual(S.groupingDefault(PROFILE), 'all', 'a qualifying profile never defaults to Global');
  assert.equal(S.withGroupingDefault(S.scopeValues(() => undefined), PROFILE).group_by, 'region, country');
  assert.equal(S.withGroupingDefault(S.scopeValues((n) => (n === 'group_by' ? 'country' : undefined)), PROFILE).group_by, 'country', 'a grouping already chosen stays');
});

test('a grouping on a joined column is one choice that names its join, never a grouping SQL, and a mixed grouping is still refused (must-exclude)', async () => {
  const S = await lib('runScope.js');
  assert.deepEqual(S.scopeProblems({ group_by: 'ss_store_sk, item.i_category', run_scope: 'all' }, 'grouping'), []);
  assert.deepEqual(S.scopeProblems({ group_by: 'ss_store_sk', run_scope: 'all' }, 'grouping'), []);
  assert.equal(S.scopeProblems({ group_by: 'all, item.i_category', run_scope: 'all' }, 'grouping').length, 1);
  const choices = S.groupingChoices(STAR_PROFILE);
  const joined = choices.find((c) => c.value === 'item.i_category');
  assert.equal(joined.sql, undefined);
  assert.equal(joined.note, `item.i_category joins on ss_item_sk = i_item_sk. ${S.GROUPING_JOINED_NOTE}`);
  assert.equal(choices.find((c) => c.value === 'ss_store_sk').note, undefined, 'a column of the main table names no join');
  assert.equal(choices.filter((c) => S.sameGrouping(c.value, 'item.i_category')).length, 1, 'one candidate list: the joined column is listed once');
});

test('First run never counts or lists the groups of another column than the chosen Data groups, and reads them again instead (must-exclude)', async () => {
  const S = await lib('runScope.js');
  const PAY = { ...PROFILE, recommended: ['paymentMethod'], group_column: 'paymentMethod', groups_for: 'paymentMethod', example: { column: 'paymentMethod' },
    first_run: { ...PROFILE.first_run, groups: 3333 }, suggested_groups: [{ value: 'mastercard', records: 1144, kind: 'biggest' }, { value: 'visa', records: 1083, kind: 'smallest' }],
    group_list: [{ value: 'mastercard', records: 1144, parts: [{ column: 'paymentMethod', value: 'mastercard' }] }, { value: 'visa', records: 1083, parts: [{ column: 'paymentMethod', value: 'visa' }] }],
    column_groups: { paymentMethod: [{ value: 'mastercard', records: 1144 }, { value: 'visa', records: 1083 }] } };
  const other = { ...S.scopeValues(() => undefined), group_by: 'product', run_scope: 'groups', scope_groups: 'mastercard' };
  assert.equal(S.groupingProfiled(other, PAY), false);
  assert.deepEqual(S.firstRunChoices(PAY, other).filter((c) => c.scope === 'groups').map((c) => [c.id, c.available, c.records]), [['one', false, null], ['groups', false, null]]);
  assert.equal(S.groupsReadNeeded(PAY, 'product'), true);
  assert.equal(S.groupsPickedByRunText(other),
    'Inspire profiled the groups of another column, so the run picks whole groups of product itself; type groups below to choose them.');
  const same = { ...other, group_by: 'paymentMethod', scope_groups: 'mastercard, visa' };
  assert.equal(S.groupingProfiled(same, PAY), true);
  assert.equal(S.firstRunChoices(PAY, same).find((c) => c.id === 'groups').records, 2227, 'the records of the groups picked, never the count of other groups');
  assert.equal(S.groupingProfiled({ ...other, group_by: 'all' }, PAY), true);
});

test('a first run on about 1,000 records of a small table with groups of about 550 takes three whole groups, never one, and names the real count (must-exclude)', async () => {
  const S = await lib('runScope.js');
  const sizes = [['Ginger', 586], ['Oatmeal', 571], ['Pecan', 560], ['Mint', 549], ['Lemon', 540], ['Cocoa', 527]].map(([value, records]) => ({ value, records }));
  const picked = S.wholeGroups(sizes, '1000');
  assert.deepEqual(picked.map((g) => g.value), ['Ginger', 'Pecan', 'Cocoa'], 'the biggest, a typical and the smallest product');
  assert.notEqual(picked.length, 1, 'one product is never the whole first run when three fit (must-exclude)');
  const said = S.recordGroupsText({ table: 't', standalone: false, group_column: 'product', group_sizes: sizes }, { scope_records: '1000' });
  assert.equal(said, '1,673 records, in 3 whole groups, so the MVP Test Run sees more than one group and no group is cut: product = Ginger, 586 records; '
    + 'product = Pecan, 560 records; product = Cocoa, 527 records');
  assert.doesNotMatch(said, /smallest whole group|About 1,000/);
  assert.deepEqual(S.wholeGroups([{ value: 'A', records: 900 }, { value: 'B', records: 5000 }], '1000').map((g) => g.value), ['A'], 'only one group fits, so one group runs');
  assert.equal(S.WHOLE_GROUPS_MIN, 3);
});

test('what a v1.4.0 build saved reads in the App as the notebook runs it, from the shared cases (must-exclude: a suggested all is never the default)', async () => {
  const S = await lib('runScope.js');
  assert.ok(LEGACY.v1_4_0.length >= 8);
  for (const c of LEGACY.v1_4_0) {
    const read = S.recordedRunScope(S.scopeValues((name) => c.widgets[name])).values;
    const values = S.withScopeDefaults(read, { default_scope: c.spec.default });
    assert.equal(values.run_scope, c.app.run_scope, c.name);
    assert.equal(S.firstRunChoiceOf(values), c.app.choice, c.name);
    assert.deepEqual(S.scopeProblems(values), c.app.problems, c.name);
    if (c.widgets.group_sql) assert.ok(S.customSqlProblems(c.widgets).some((p) => p.startsWith('group_sql: ')), c.name);
  }
});

test('with Data groups as the whole data, saved groups name their own column and say where they came from, never "groups of all" (must-exclude)', async () => {
  const S = await lib('runScope.js');
  const values = { ...S.scopeValues(() => undefined), group_by: 'all', run_scope: 'groups', scope_groups: 'USA, Spain' };
  const covers = S.firstRunCoversText(PROFILE, values);
  assert.match(covers, /covers 2 groups of country: country = USA; country = Spain/);
  assert.doesNotMatch(covers, /of all/);
  assert.equal(S.groupsPickedByRunText(values), S.GROUPS_FROM_EARLIER);
  assert.match(S.groupsPickedByRunText({ group_by: 'region, store_id' }), /whole groups of store_id itself/);
  assert.equal(S.groupsPickedByRunText({ group_by: '' }), '');
  const unnamed = S.firstRunCoversText({ ...PROFILE, group_column: null, recommended: [] }, { ...values, scope_groups: 'USA' });
  assert.doesNotMatch(unnamed, / of :|of all/, unnamed);
});

test('with one group picked, only One group carries its count, never Several groups (must-exclude)', async () => {
  const S = await lib('runScope.js');
  const one = { ...S.scopeValues(() => undefined), group_by: 'country', run_scope: 'groups', scope_groups: 'USA' };
  const many = { ...one, scope_groups: 'USA, Spain' };
  const counts = (values) => Object.fromEntries(S.firstRunChoices(PROFILE, values).filter((c) => c.scope === 'groups').map((c) => [c.id, c.records]));
  assert.equal(counts(one).groups, null);
  assert.notEqual(counts(one).one, undefined);
  assert.equal(counts(many).one, null);
});

const WIDE = {
  ...PROFILE, recommended: ['region'],
  columns: Array.from({ length: 20 }, (_v, i) => ({ name: `col_${String(i + 1).padStart(2, '0')}`, type: 'string', distinct: (i + 1) * 3, smallest: 10, largest: 900, nulls: 0, parent: null }))
    .concat([{ name: 'region', type: 'string', distinct: 4, smallest: 210, largest: 30110, nulls: 0, parent: null }]),
  group_list: [], column_groups: {},
};

test('a 20-column table shows the pick and the top cards, hides the rest behind Show all, and search finds a hidden one (must-exclude)', async () => {
  const S = await lib('runScope.js');
  const choices = S.groupingChoices(WIDE);
  assert.equal(choices.filter((c) => c.columns.length === 1).length, 21);
  const best = S.groupingBest(WIDE, choices);
  assert.equal(best.value, 'region');
  const keep = (c) => !c.columns.length || c.value === best.value;
  const shown = S.topShown(choices, { keep });
  assert.equal(shown.length, S.GROUPING_SHOWN);
  assert.ok(shown.some((c) => c.value === 'all') && shown.some((c) => c.value === 'region'), 'the whole-data card and the pick always show');
  assert.equal(shown.some((c) => c.value === 'col_20'), false, 'a column past the top cards is hidden until Show all (must-exclude)');
  assert.equal(S.topShown(choices, { keep, open: true }).length, choices.length, 'Show all lists every column');
  const found = S.topShown(choices, { keep, open: true, query: 'COL_20', textOf: (c) => c.label });
  assert.deepEqual(found.map((c) => c.value), ['all', 'region', 'col_20'], 'search keeps the pick and finds the hidden column');
  const picked = S.topShown(choices, { keep: (c) => keep(c) || c.value === 'col_17' });
  assert.ok(picked.some((c) => c.value === 'col_17'), 'a picked column far down the list stays on screen');
  assert.equal(S.topShown(WIDE.columns, { limit: 6 }).length, 6, 'the Combine columns row is cut the same way');
  assert.deepEqual(S.topShown([], {}), []);
});

test('every grouping card says how many groups it makes, the whole data is 1 group, and the lead names the pick and its count', async () => {
  const S = await lib('runScope.js');
  const choices = S.groupingChoices(WIDE);
  assert.equal(S.groupingCount(choices.find((c) => c.value === 'all'), WIDE), 1);
  assert.equal(S.groupingCountText(1), '1 group');
  assert.equal(S.groupingCount(choices.find((c) => c.value === 'col_05'), WIDE), 15);
  assert.equal(S.groupingCountText(15), '15 groups');
  assert.equal(S.groupingCount({ columns: ['region', 'col_01'] }, WIDE), null, 'a combination the profile did not list has no count yet');
  assert.equal(S.groupingCountText(null), S.GROUPING_UNCOUNTED);
  assert.equal(S.groupingCount({ columns: ['region', 'country'] }, PROFILE), 4, 'a listed combination counts its listed groups');
  assert.deepEqual(S.groupingLead(WIDE, choices), { label: 'region', groups: 4 });
  assert.equal(S.groupingLead({ ...WIDE, recommended: [], applies: false, columns: [] }), null, 'whole data has no lead column');
});
