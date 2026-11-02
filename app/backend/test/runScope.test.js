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
  for (const id of ['N01 U01', 'a/b & c+d', 'حالة 1', 'x\ny']) {
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
