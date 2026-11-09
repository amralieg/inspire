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
  one(H.bestFreshness({ outputs: { alert: false } }), W.FRESHNESS_OPTIONS.map((o) => o.id));
  assert.equal(H.bestFreshness({ outputs: { alert: true } }).id, 'daily');
  assert.equal(H.bestFreshness({ outputs: { alert: false } }).id, 'daily', 'Keep it fresh is Highly Recommended on Daily, with or without an alert');
  assert.notEqual(H.bestFreshness({ outputs: { alert: false } }).reason, H.bestFreshness({ outputs: { alert: true } }).reason);
  one(H.bestHoldout(), [true, false]);
  assert.equal(H.bestKpi([{ name: 'Churn rate' }], { record: { name: 'churn rate' } }).id, 'churn rate');
  assert.equal(H.bestKpi([{ name: 'Churn rate' }], { record: { name: 'Revenue' } }).id, '', 'a tracked KPI not in the list is not recommended (must-exclude)');
  one(H.bestAppAccess(), ['user', 'sp']);
  assert.equal(H.bestAppAccess({ personal: 'owner_email' }).id, 'user');
  assert.equal(H.bestAppAccess({ inside: true }).id, 'user');
  const app = { outputs: { app: true, app_access: 'sp', merge: {} } };
  assert.equal(H.bestAppBackend(app, { state: 'available' }).id, 'lakebase');
  assert.equal(H.bestAppBackend(app, { state: 'absent' }).id, 'delta');
  for (const offer of [null, { state: 'unknown', detail: 'timeout' }, { state: 'denied', detail: 'no' }]) {
    assert.equal(H.bestAppBackend(app, offer).id, 'delta', `Lakebase Inspire could not check is never recommended (must-exclude) ${JSON.stringify(offer)}`);
  }
  assert.equal(H.bestAppBackend({ outputs: { ...app.outputs, app_access: 'user' } }, { state: 'available' }).id, 'delta');
  assert.equal(H.bestAppBackend({ outputs: { app: false } }, { state: 'available' }), null);
  one(H.bestRemoved(), ['delete', 'keep']);
  assert.equal(H.bestRemoved().id, W.REMOVED_OUTPUT_DEFAULT);
  one(H.bestVibePrevious(3), W.vibePreviousChoices(3, 4).map((c) => c.id));
  assert.equal(H.bestVibePrevious(3).id, W.VIBE_PREVIOUS_DEFAULT);
  one(H.bestReplaceEdits(), [false, true]);
  assert.equal(H.bestHeldApp(''), null);
  assert.equal(H.bestResultTable(''), null);
  assert.equal(H.bestResultTable('own').id, 'own');
  assert.equal(H.bestResultTable('inspire', 'main').id, 'inspire');
  assert.match(H.bestResultTable('inspire', 'main').reason, /CREATE SCHEMA on main/);
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

test('every Highly Recommended pick is the option the wizard starts on', async () => {
  const H = await lib('highlyRecommended.js');
  const W = await lib('implementWizard.js');
  const uc = { id: 'N01-U01', primary_table: 'main.s.orders', tables_involved: 'main.s.orders', business_domain: 'Customer' };
  const spec = W.defaultSpecFromUseCase(uc, { warehouseId: 'wh1', inspireDatabase: 'main.inspire', businessName: 'Acme' });
  assert.equal(H.bestFreshness(spec).id, W.freshnessOf(spec.schedule), 'Keep it fresh starts on its badge');
  const alerted = W.withOutput(spec, 'alert', true);
  assert.equal(H.bestFreshness(alerted).id, 'daily');
  assert.equal(W.freshnessOf(alerted.schedule), 'daily', 'ticking the alert moves the schedule to the badge');
  const weekly = W.withOutput(W.withFreshness(spec, 'weekly'), 'alert', true);
  assert.equal(W.freshnessOf(weekly.schedule), 'weekly', 'a schedule someone set stays (must-exclude)');
  assert.equal(H.bestHoldout().id, W.holdoutOf(spec).enabled);
  assert.equal(H.bestReplaceEdits().id, Boolean(spec.outputs.app_options.replace_edits));
  assert.equal(H.bestAppAccess().id, spec.outputs.app_access);
  assert.equal(H.bestMode().id, 'mvp');
  assert.ok(spec.outputs[H.bestOutput([]).id]);
  for (const offer of [null, { state: 'available' }, { state: 'absent' }, { state: 'unknown' }, { state: 'denied', detail: 'x' }]) {
    assert.equal(H.bestAppBackend(spec, offer).id, W.appBackendOf(spec, offer), JSON.stringify(offer));
  }
  for (const kind of ['style', 'layout', 'theme', 'palette']) assert.equal(H.bestLook(kind, spec).id, spec.outputs.app_look[kind], kind);
  const assets = { dashboard: 'd1' };
  const removed = W.withOutput({ ...spec, outputs: { ...spec.outputs, dashboard: true } }, 'dashboard', false, assets);
  assert.equal(removed.removed_outputs.dashboard, H.bestRemoved().id, 'an output turned off keeps its asset, as Highly Recommended');
  assert.equal(W.withOutput(removed, 'dashboard', true, assets).removed_outputs.dashboard, undefined);
});

test('each wizard step shows one Highly Recommended, the first of its questions that has one', async () => {
  const H = await lib('highlyRecommended.js');
  const pick = (id) => ({ id, reason: id });
  const all = Object.fromEntries(Object.values(H.STEP_BEST).flat().map((k) => [k, pick(k)]));
  const kept = H.oneBestPerStep({ ...all, result: pick('own'), freshness: pick('daily') });
  for (const [step, keys] of Object.entries(H.STEP_BEST)) {
    assert.deepEqual(keys.filter((k) => kept[k]), [keys[0]], `${step} keeps one badge`);
  }
  assert.deepEqual([kept.result.id, kept.freshness.id], ['own', 'daily'], 'a step with one question keeps its badge');
  const later = H.oneBestPerStep({ ...all, appPlace: null, output: null });
  assert.deepEqual([later.appTarget?.id, later.appAccess, later.removed?.id], ['appTarget', null, 'removed'], 'with no first badge the next question keeps it');
  assert.deepEqual(Object.keys(H.STEP_BEST), ['delivery', 'app', 'run'], 'Deliver, App and Run it each show one');
  assert.deepEqual(Object.keys(H.STEP_BEST).filter((s) => (H.STEP_BEST[s].filter((k) => H.oneBestPerStep(all)[k]).length !== 1)), [], 'never two (must-exclude)');
});
