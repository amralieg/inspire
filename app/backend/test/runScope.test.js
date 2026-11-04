const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const lib = (name) => import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', name)).href);

const PROFILE = {
  table: 'main.sales.orders', records: 48210, qualifies: true, reason: 'anomaly detection compares each record with its group', standalone: false,
  columns: [{ name: 'region', type: 'string', distinct: 4, smallest: 210, largest: 30110, nulls: 0, parent: null },
    { name: 'country', type: 'string', distinct: 31, smallest: 12, largest: 18200, nulls: 3, parent: 'region' }],
  recommended: ['region', 'country'],
  example: { column: 'country', small_groups: [{ value: 'Cyprus', records: 12 }], moves_to: 'Europe' },
  time_column: 'order_date', recent: { days: 30, records: 3120 },
  suggested_groups: [{ value: 'USA', records: 18200, kind: 'biggest' }, { value: 'Spain', records: 1400, kind: 'typical' }, { value: 'Cyprus', records: 12, kind: 'smallest' }],
  first_run: { all: 48210, groups: 19612, recent: 3120, records: null }, default_scope: 'groups', read_at: '2026-11-01T15:00:00Z',
};

test('the scope settings carry the contract keys, labels and defaults, and an empty value reads as its default', async () => {
  const S = await lib('runScope.js');
  assert.deepEqual(S.SCOPE_SETTINGS, ['group_by', 'run_scope', 'scope_groups', 'scope_days', 'scope_records']);
  assert.deepEqual(Object.values(S.SCOPE_LABELS), ['Grouping', 'First run', 'Groups to run on', 'Days to run on', 'Records to run on']);
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
  assert.equal(S.firstRunDefault(PROFILE), 'groups');
  assert.equal(S.firstRunDefault({ ...PROFILE, records: 1000, default_scope: 'all' }), 'all', 'the backend answers all at 1,000 records or fewer');
  assert.equal(S.firstRunDefault({ ...PROFILE, records: 1001, default_scope: 'recent' }), 'recent');
  assert.equal(S.firstRunDefault({ ...PROFILE, default_scope: 'nonsense' }), 'all');
  assert.equal(S.firstRunDefault(null), '');
  const fresh = S.withScopeDefaults(S.scopeValues(() => undefined), PROFILE);
  assert.deepEqual([fresh.run_scope, fresh.scope_groups], ['groups', 'USA, Spain, Cyprus'], 'the suggested biggest, typical and smallest groups are ticked');
  const chosen = S.withScopeDefaults({ ...S.scopeValues(() => undefined), run_scope: 'all' }, PROFILE);
  assert.deepEqual([chosen.run_scope, chosen.scope_groups], ['all', ''], 'the person chose everything, so the default does not apply');
  assert.equal(S.withScopeDefaults({ run_scope: '' }, { ...PROFILE, records: 400, default_scope: 'all' }).run_scope, 'all');
});

test('Grouping offers Global first, the recommended columns coarse to fine, each column, and Custom last, with a real example', async () => {
  const S = await lib('runScope.js');
  assert.deepEqual(S.groupingChoices(PROFILE).map((c) => [c.value, c.label, Boolean(c.recommended)]), [
    ['all', 'Global (All)', false], ['region, country', 'region, then country', true], ['region', 'region', false], ['country', 'country', false], ['custom', 'Custom', false]]);
  assert.deepEqual(S.groupingChoices(null, ['store', 'all']).map((c) => c.value), ['all', 'store', 'custom'], 'without a profile the columns the agent read are offered');
  assert.deepEqual(S.groupingChoices(null).map((c) => c.value), ['all', 'custom'], 'Global and Custom are always offered');
  assert.equal(S.groupingExampleText(PROFILE),
    'USA has 18,200 records and Cyprus has 12 records. Grouped by country, each country is compared only with its own records, so what is normal for USA does not hide what stands out in Cyprus.');
  assert.equal(S.groupingMovesUpText(PROFILE), 'A group too small to compare fairly moves up a level: Cyprus has 12 records, so it is measured with Europe.');
  assert.equal(S.groupingExampleText({ ...PROFILE, suggested_groups: [] }), '');
  assert.equal(S.groupingMovesUpText({ ...PROFILE, example: null }), '');
  assert.ok(S.sameGrouping('Region , country', 'region,country'));
  assert.ok(S.sameGrouping('', 'all'));
  assert.ok(!S.sameGrouping('country', 'region, country'));
});

test('a Deep discovery grouping is picked first and marked, a profile without one keeps Global, and a person\u2019s pick is never replaced (must-exclude)', async () => {
  const S = await lib('runScope.js');
  const DEEP = { ...PROFILE, deep_suggestion: { columns: ['stores.region', 'store_id'], record_level: 'order_id' } };
  assert.deepEqual(S.groupingChoices(DEEP).map((c) => [c.value, c.label, Boolean(c.deep), Boolean(c.recommended)]), [
    ['all', 'Global (All)', false, false], ['stores.region, store_id', 'stores.region, then store_id', true, false],
    ['region, country', 'region, then country', false, true], ['region', 'region', false, false], ['country', 'country', false, false], ['custom', 'Custom', false, false]]);
  const same = S.groupingChoices({ ...PROFILE, deep_suggestion: { columns: ['Region', 'country'] } });
  assert.deepEqual(same.map((c) => [c.value, Boolean(c.deep), Boolean(c.recommended)]), [['all', false, false], ['Region, country', true, true],
    ['region', false, false], ['country', false, false], ['custom', false, false]], 'Deep and the profile agreeing is one choice with both marks');
  assert.equal(S.GROUPING_DEEP_MARK, 'Suggested by Deep discovery');
  const fresh = S.scopeValues(() => undefined);
  assert.equal(S.withGroupingDefault(fresh, DEEP, '').group_by, 'stores.region, store_id', 'nothing picked yet, so the Deep grouping is picked');
  assert.equal(S.withGroupingDefault(fresh, PROFILE, '').group_by, 'all', 'no Deep grouping: the build-time profile only marks its recommendation');
  assert.equal(S.withGroupingDefault(fresh, null, '').group_by, 'all');
  assert.equal(S.withGroupingDefault({ ...fresh, group_by: 'all' }, DEEP, 'all').group_by, 'all', 'the person picked Global, so it stays');
  assert.equal(S.withGroupingDefault({ ...fresh, group_by: 'country' }, DEEP, 'country').group_by, 'country', 'the person picked a column, so it stays');
  assert.equal(S.withGroupingDefault(fresh, { ...DEEP, deep_suggestion: { columns: ['', null] } }, '').group_by, 'all');
  assert.deepEqual(S.scopeStepsOf('ready', { ...DEEP, qualifies: false }), { grouping: true, firstRun: true }, 'a Deep grouping shows the Grouping step');
  assert.deepEqual(S.scopeStepsOf('ready', { ...PROFILE, qualifies: false, deep_suggestion: null }), { grouping: false, firstRun: true });
  const deepFirst = S.withScopeDefaults(S.withGroupingDefault(fresh, DEEP, ''), DEEP);
  assert.deepEqual([deepFirst.run_scope, deepFirst.scope_groups], ['groups', ''],
    'the profile groups are countries, not store_id values, so the run picks the largest groups of the Grouping itself');
  const profiled = S.withScopeDefaults({ ...fresh, group_by: 'region, country' }, PROFILE);
  assert.deepEqual([profiled.run_scope, profiled.scope_groups], ['groups', 'USA, Spain, Cyprus']);
  const other = S.withScopeDefaults({ ...fresh, group_by: 'region' }, PROFILE);
  assert.equal(other.scope_groups, '', 'a Grouping whose finest column is not the profiled one gets no country values');
});

test('First run offers a number of records only when each record stands alone, a recent period only with a date column, and counts each choice', async () => {
  const S = await lib('runScope.js');
  const values = S.withScopeDefaults(S.scopeValues(() => undefined), PROFILE);
  const choices = S.firstRunChoices(PROFILE, values);
  assert.deepEqual(choices.map((c) => [c.id, c.available, c.records]), [['groups', true, 19612], ['recent', true, 3120], ['records', false, 1000], ['all', true, 48210]]);
  assert.equal(choices[1].label, 'The last 30 days of order_date');
  const two = S.firstRunChoices(PROFILE, { ...values, scope_groups: 'USA, Cyprus' });
  assert.equal(two[0].records, 18212, 'the records of the ticked groups');
  const week = S.firstRunChoices(PROFILE, { ...values, scope_days: '7' });
  assert.equal(week[1].label, 'The last 7 days of order_date');
  const standalone = S.firstRunChoices({ ...PROFILE, standalone: true, time_column: null, recent: null }, { ...values, scope_records: '500' });
  assert.deepEqual(standalone.map((c) => [c.id, c.available]), [['groups', true], ['recent', false], ['records', true], ['all', true]]);
  assert.equal(standalone[2].label, 'The first 500 records');
  assert.equal(standalone[2].records, 500);
  const via = { ...PROFILE, records: 718931, suggested_groups: [], first_run: { all: 718931, groups: null, recent: 21000, records: null }, default_scope: 'recent',
    time_column: 'ws_ship_date_sk', time_via: { table: 'samples.tpcds_sf1.date_dim', key: 'd_date_sk', date: 'd_date' }, recent: { days: 30, records: 21000 } };
  const viaValues = S.withScopeDefaults(S.scopeValues(() => undefined), via);
  assert.equal(viaValues.run_scope, 'recent', '718,931 records first run on part of the data');
  const dated = S.firstRunChoices(via, viaValues);
  assert.deepEqual(dated.filter((c) => c.available).map((c) => [c.id, c.records]), [['recent', 21000], ['all', 718931]]);
  assert.equal(dated[1].label, 'The last 30 days of d_date in samples.tpcds_sf1.date_dim, through ws_ship_date_sk');
});

test('the scope checks refuse what the agent would refuse, and accept what it runs', async () => {
  const S = await lib('runScope.js');
  const base = S.scopeValues(() => undefined);
  assert.deepEqual(S.scopeProblems({ ...base, run_scope: 'records' }, PROFILE),
    ['A first run on a number of records works only when each record stands alone; choose chosen groups, a recent period or everything']);
  assert.deepEqual(S.scopeProblems({ ...base, run_scope: 'records' }, { ...PROFILE, standalone: true }), []);
  assert.deepEqual(S.scopeProblems({ ...base, run_scope: 'recent', scope_days: '0' }, PROFILE), ["Days to run on is '0'; allowed: a whole number, at least 1"]);
  assert.deepEqual(S.scopeProblems({ ...base, run_scope: 'recent', scope_days: '2.5' }, PROFILE), ["Days to run on is '2.5'; allowed: a whole number, at least 1"]);
  assert.deepEqual(S.scopeProblems({ ...base, run_scope: 'everything' }), ["First run is 'everything'; allowed: all, groups, recent, records"]);
  assert.deepEqual(S.scopeProblems({ ...base, group_by: 'all, country' }), ["Grouping is 'all, country'; choose all, custom or column names, not a mix"]);
  assert.deepEqual(S.scopeProblems({ ...base, run_scope: 'groups', group_by: 'region, country' }, PROFILE), []);
});

test('the scope reads as the agent writes it, and counts carry thousands separators', async () => {
  const S = await lib('runScope.js');
  const P = await lib('plural.js');
  assert.equal(S.scopeText({ run_scope: 'all' }), 'All records');
  assert.equal(S.scopeText({ run_scope: '' }), 'All records');
  assert.equal(S.scopeText({ run_scope: 'groups', scope_groups: 'USA, Spain' }), 'First run: 2 groups (USA, Spain)');
  assert.equal(S.scopeText({ run_scope: 'recent', scope_days: '1' }), 'First run: the last 1 day');
  assert.equal(S.scopeText({ run_scope: 'records', scope_records: '1500' }), 'First run: the first 1,500 records');
  assert.equal(P.counted(48210, 'record'), '48,210 records');
  assert.equal(P.counted(1, 'record'), '1 record');
  assert.equal(S.profileHeldText(PROFILE), 'main.sales.orders holds 48,210 records, so Inspire suggests a smaller first run to show results sooner.');
  assert.equal(S.profileHeldText({ ...PROFILE, records: 800, default_scope: 'all' }), 'main.sales.orders holds 800 records.');
});

test('the wizard shows Grouping only when the profile says it applies, First run whenever the table was read or the read failed, and each step names only its own problems', async () => {
  const S = await lib('runScope.js');
  assert.deepEqual(S.scopeStepsOf('ready', PROFILE), { grouping: true, firstRun: true });
  assert.deepEqual(S.scopeStepsOf('ready', { ...PROFILE, qualifies: false }), { grouping: false, firstRun: true });
  assert.deepEqual(S.scopeStepsOf('ready', { ...PROFILE, qualifies: 'yes' }), { grouping: false, firstRun: true }, 'only qualifies true shows Grouping');
  assert.deepEqual(S.scopeStepsOf('error', null), { grouping: false, firstRun: true }, 'a refused read still lets the person pick the first run');
  for (const state of ['loading', 'none', 'off']) assert.deepEqual(S.scopeStepsOf(state, null), { grouping: false, firstRun: false }, state);
  const values = { ...S.scopeValues(() => undefined), group_by: 'all, country', run_scope: 'records' };
  const grouping = "Grouping is 'all, country'; choose all, custom or column names, not a mix";
  const records = 'A first run on a number of records works only when each record stands alone; choose chosen groups, a recent period or everything';
  assert.deepEqual(S.scopeProblems(values, PROFILE, 'grouping'), [grouping]);
  assert.deepEqual(S.scopeProblems(values, PROFILE, 'first_run'), [records]);
  assert.deepEqual(S.scopeProblems(values, PROFILE), [records, grouping]);
});

test('a custom grouping picked now blocks until its SQL is used, and a saved one blocks again when the results move to another table (must-exclude)', async () => {
  const S = await lib('runScope.js');
  const custom = { ...S.scopeValues(() => undefined), group_by: 'custom' };
  const saved = { result_table: 'main.out.risk', group_sql: 'SELECT 1' };
  const moved = 'The custom grouping is saved for main.out.risk, but the results now go to main.out.other; press Preview, then Use this grouping again';
  assert.deepEqual(S.scopeProblems(custom, PROFILE, 'grouping', { saved: null }), [S.GROUPING_CUSTOM_UNSAVED]);
  assert.deepEqual(S.scopeProblems(custom, PROFILE, 'grouping', { saved, resultTable: 'main.out.risk' }), []);
  assert.deepEqual(S.scopeProblems(custom, PROFILE, 'grouping', { saved, resultTable: 'MAIN.out.`risk`' }), [], 'the same table written another way');
  assert.deepEqual(S.scopeProblems(custom, PROFILE, 'grouping', { saved, resultTable: 'main.out.other' }), [moved]);
  assert.deepEqual(S.scopeProblems(custom, PROFILE, 'grouping', { saved }), [], 'a built use case saves where it writes, so no table to compare');
  assert.deepEqual(S.scopeProblems(custom, PROFILE, 'grouping', { saved: undefined }), [], 'custom chosen before this visit is not blocked');
  assert.deepEqual(S.scopeProblems(custom, PROFILE, 'grouping'), []);
  assert.deepEqual(S.scopeProblems({ ...custom, group_by: 'country' }, PROFILE, 'grouping', { saved: null }), [], 'only custom needs its SQL');
  assert.deepEqual(S.scopeProblems(custom, PROFILE, 'first_run', { saved: null }), [], 'the First run step names only its own problems');
});

test('the editor helpers send the use case, table, key columns and SQL, suggest the table columns, and allow Use only for the previewed SQL', async () => {
  const G = await lib('groupingSql.js');
  const base = { inspire_database: 'main.inspire', session_id: '42', use_case_id: 'N01-U01', warehouse_id: 'wh1' };
  const profile = { ...PROFILE, prefill: { key_columns: ['order_id', ' ', null], sql: 'x' } };
  assert.deepEqual(G.groupingSqlRequest(base, profile, 'SELECT 1'), { ...base, main_table: 'main.sales.orders', key_columns: ['order_id'], sql: 'SELECT 1' });
  assert.deepEqual(G.groupingSqlRequest(base, profile, 'SELECT 1', ' main.out.risk '), { ...base, main_table: 'main.sales.orders', key_columns: ['order_id'], sql: 'SELECT 1',
    result_table: 'main.out.risk' });
  assert.deepEqual(G.groupingSqlRequest(base, null, null), { ...base, main_table: '', key_columns: [], sql: '' });
  assert.deepEqual(G.groupingSqlSchema(profile), { 'main.sales.orders': ['order_id', 'region', 'country'] });
  assert.deepEqual(G.groupingSqlSchema({ table: 'orders' }), {}, 'no schema for a name that is not catalog.schema.table');
  const sql = 'SELECT o.order_id, o.region AS group_name FROM main.sales.orders o';
  const checked = G.checkGroupingSql(`${sql} -- note`);
  assert.equal(G.groupingPreviewFits({ ok: true, sql }, checked), true);
  assert.equal(G.groupingPreviewFits({ ok: false, sql }, checked), false, 'a preview that fails its rules');
  assert.equal(G.groupingPreviewFits({ ok: true, sql: `${sql} WHERE 1 = 1` }, checked), false, 'a preview of other SQL');
  assert.equal(G.groupingPreviewFits({ ok: true, sql: '' }, G.checkGroupingSql('DROP TABLE a.b.c')), false, 'refused SQL never fits');
  assert.equal(G.groupingPreviewFits(null, checked), false);
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
const SCOPE_CASES = [['all', ''], ['groups', ''], ['recent', ''], ['records', ''], ['', ''],
  ['5', `run_scope is '5'; allowed: ${SCOPE_ALLOWED}`], ['everything', `run_scope is 'everything'; allowed: ${SCOPE_ALLOWED}`]];

test('a First run a built version recorded as a number takes every First run choice and refuses a number or another word, in the App and the server alike', async () => {
  const S = await lib('runScope.js');
  const U = await lib('useCaseSettings.js');
  const I = require('../lib/inspireImplement');
  for (const [value, problem] of SCOPE_CASES) {
    assert.equal(S.runScopeProblem(value), problem.replace('run_scope', 'First run'), `First run step ${value}`);
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
  assert.deepEqual(S.scopeStepsOf('ready', { ...PROFILE, qualifies: false }, true), { grouping: false, firstRun: true });
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

test('a First run that cannot be known starts from the default the First run step uses for that table, and everything when the table was not read', async () => {
  const S = await lib('runScope.js');
  const empty = { run_scope: '', scope_groups: '' };
  assert.deepEqual(S.withUnrecordedScope(empty, PROFILE), { run_scope: 'groups', scope_groups: 'USA, Spain, Cyprus' });
  assert.deepEqual(S.withUnrecordedScope(empty, { ...PROFILE, default_scope: 'all' }), { run_scope: 'all', scope_groups: '' });
  for (const profile of [null, undefined, 'x']) assert.deepEqual(S.withUnrecordedScope(empty, profile), { run_scope: 'all', scope_groups: '' }, String(profile));
  assert.deepEqual(S.withUnrecordedScope({ run_scope: 'recent' }, PROFILE), { run_scope: 'recent' }, 'never over a choice');
  assert.equal(S.withUnrecordedScope(empty, null).run_scope, S.firstRunDefault({}));
  for (const { table_default: given, run_scope: expected } of LEGACY.unrecorded_default) {
    assert.equal(S.withUnrecordedScope(empty, given == null ? null : { default_scope: given }).run_scope, expected, String(given));
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
