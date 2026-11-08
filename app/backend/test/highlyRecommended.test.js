const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const lib = (name) => import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', name)).href);

test('each choice has exactly one Highly Recommended option, with a reason, picked from context', async () => {
  const H = await lib('highlyRecommended.js');
  const W = await lib('implementWizard.js');
  assert.equal(H.HIGHLY_RECOMMENDED, 'Highly Recommended');
  const outputs = W.IMPLEMENT_OUTPUTS.map((o) => o.id);
  const one = (best, ids) => {
    assert.ok(best && best.reason, `a reason for ${JSON.stringify(best)}`);
    assert.equal(ids.filter((id) => H.isBest(best, id)).length, 1, JSON.stringify(best));
  };
  one(H.bestOutput([]), outputs);
  assert.equal(H.bestOutput([]).id, 'app', 'Apps is Highly Recommended');
  assert.equal(H.bestOutput(['app']).id, 'genie_space', 'without Apps the Genie Agent is');
  assert.equal(H.bestOutput(['app', 'genie_space']).id, 'dashboard');
  assert.equal(H.bestOutput(['app', 'genie_space', 'dashboard', 'alert']), null, 'nothing to recommend when nothing can be built (must-exclude)');
  one(H.bestMode(), ['mvp', 'notebook']);
  assert.equal(H.bestMode({ genieOff: 'off' }).id, 'notebook');
  one(H.bestFreshness({ outputs: { alert: false } }), ['daily', 'weekly']);
  assert.equal(H.bestFreshness({ outputs: { alert: true } }).id, 'daily');
  assert.equal(H.bestFreshness({ outputs: { alert: false } }).id, 'weekly');
  one(H.bestHoldout(), [true, false]);
  assert.equal(H.bestKpi([{ name: 'Churn rate' }], { record: { name: 'churn rate' } }).id, 'churn rate');
  assert.equal(H.bestKpi([{ name: 'Churn rate' }], { record: { name: 'Revenue' } }).id, '', 'a tracked KPI not in the list is not recommended (must-exclude)');
  one(H.bestAppAccess(), ['user', 'sp']);
  assert.equal(H.bestAppAccess({ personal: 'owner_email' }).id, 'user');
  assert.equal(H.bestAppAccess({ inside: true }).id, 'user');
  assert.equal(H.bestAppBackend({ state: 'available' }).id, 'lakebase');
  assert.equal(H.bestAppBackend({ state: 'absent' }).id, 'delta');
  assert.equal(H.bestAppBackend({ state: 'available' }, 'blocked').id, 'delta');
  one(H.bestReplaceEdits(), [false, true]);
  assert.equal(H.bestHeldApp(''), null);
  assert.equal(H.bestResultTable(''), null);
  assert.equal(H.bestResultTable('main.inspire.churn_out').id, 'main.inspire.churn_out');
  for (const kind of ['style', 'layout', 'theme', 'palette']) assert.ok(H.bestLook(kind, { outputs: {} })?.reason, kind);
  assert.equal(H.bestLook('nope', {}), null);
});

test('the App layout pick follows how many pages are on, so its two branches differ (must-exclude)', async () => {
  const H = await lib('highlyRecommended.js');
  const W = await lib('implementWizard.js');
  const pages = W.appPagesOf({ outputs: {} });
  const on = (n) => ({ outputs: { app_pages: Object.fromEntries(pages.map((p, i) => [p.id, i < n])) } });
  const few = H.bestLook('layout', on(2));
  const many = H.bestLook('layout', on(pages.length));
  if (pages.length > H.LAYOUT_TABS_MAX) assert.notEqual(few.id, many.id);
  assert.equal(many.id, pages.length > H.LAYOUT_TABS_MAX ? 'sidebar' : 'tabs');
});

test('Data groups recommends the column the profile picks with its group count, and a deep pick says Discovery chose it', async () => {
  const H = await lib('highlyRecommended.js');
  const S = await lib('runScope.js');
  const profile = { applies: true, qualifies: true, recommended: ['region'], columns: [{ name: 'region', distinct: 4 }, { name: 'country', distinct: 31 }] };
  const choices = S.groupingChoices(profile);
  const best = H.bestGrouping(profile, choices);
  assert.equal(best.id, 'region');
  assert.match(best.reason, /4 fair groups/);
  assert.equal(choices.filter((c) => H.isBest(best, c.value)).length, 1);
  const deep = { ...profile, deep_suggestion: { columns: ['country'] } };
  const deepBest = H.bestGrouping(deep, S.groupingChoices(deep));
  assert.deepEqual([deepBest.id, deepBest.reason], ['country', 'Discovery picked it for this use case.']);
  assert.equal(H.bestGrouping({ ...profile, qualifies: false }, choices).id, 'all', 'a profile that does not qualify recommends the whole data (must-exclude)');
  const whole = H.bestGrouping({ applies: false, recommended: [], columns: [] }, S.groupingChoices({ applies: false }));
  assert.equal(whole.id, 'all');
  const firstRun = H.bestFirstRun({ records: 48210, default_scope: 'records' }, [{ id: 'one' }, { id: 'records' }, { id: 'all' }]);
  assert.equal(firstRun.id, 'records');
  assert.match(firstRun.reason, /48,210 records/);
  assert.equal(H.bestFirstRun({}, []), null);
});
