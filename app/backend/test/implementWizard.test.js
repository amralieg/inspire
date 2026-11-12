const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const backend = require('../lib/inspireImplement');
const served = (spec, options) => backend.validateImplementSpec(backend.withInspireUrl(spec, 'https://inspire.example.com'), options);

const libUrl = pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', 'implementWizard.js')).href;
const load = () => import(libUrl);

const UC = { id: 'N01-U01', Name: 'Predict churn', statement: 'Cut churn in the top segment', sponsor: 'Head of Retention' };

test('the wizard offers exactly the outputs, tiers and operators the backend validates', async () => {
  const w = await load();
  assert.deepEqual(w.IMPLEMENT_OUTPUTS.map((o) => o.id), backend.IMPLEMENT_OUTPUTS);
  assert.deepEqual(w.IMPLEMENT_OUTPUTS.map((o) => o.label), backend.IMPLEMENT_OUTPUTS.map((o) => backend.IMPLEMENT_OUTPUT_LABELS[o]));
  assert.deepEqual(w.ALERT_TIER_OPTIONS.map((t) => t.id), Object.keys(backend.IMPLEMENT_ALERT_TIER_SETS));
  assert.deepEqual(w.ALERT_TIER_OPTIONS.map((t) => t.label), Object.values(backend.IMPLEMENT_ALERT_TIER_SETS).map((s) => s.join(' or ')));
  assert.deepEqual(w.ALERT_OPERATORS, backend.IMPLEMENT_ALERT_OPERATORS);
});

test('the default spec carries every output option and validates clean once an owner and warehouse are set', async () => {
  const w = await load();
  const spec = w.defaultSpecFromUseCase(UC, { warehouseId: 'wh1', inspireDatabase: 'main.inspire', owner: 'amr@example.com' });
  for (const name of backend.IMPLEMENT_OUTPUTS) {
    assert.ok(name in spec.outputs, name);
    for (const option of backend.IMPLEMENT_OUTPUT_OPTIONS[name]) assert.ok(option in spec.outputs, `${name}.${option}`);
  }
  assert.equal(spec.outputs.alert, false);
  const { errors, spec: normalized } = served(spec);
  assert.deepEqual(errors, []);
  assert.deepEqual([normalized.outputs.alert_tiers, normalized.outputs.alert_operator, normalized.outputs.alert_threshold], ['act_now', '>=', 1]);
  const withAlert = { ...spec, outputs: { ...spec.outputs, alert: true, alert_recipients: w.defaultAlertRecipients(spec) } };
  assert.deepEqual(served(withAlert).errors, []);
});

test('a use case is found by its catalog id, then its number, then its implement row id', async () => {
  const w = await load();
  assert.equal(w.caseIdOf({ id: 'N01-U01', No: 'N09-U09', use_case_id: 'N08-U08' }), 'N01-U01');
  assert.equal(w.caseIdOf({ id: null, No: 'N01-U02', use_case_id: 'N08-U08' }), 'N01-U02');
  assert.equal(w.caseIdOf({ use_case_id: 'N01-U03' }), 'N01-U03');
  assert.equal(w.caseIdOf({ id: ' N01-U04 ' }), 'N01-U04');
  assert.equal(w.caseIdOf({ id: 7 }), '7');
  for (const empty of [null, undefined, {}, { id: '' }, 'N01-U01']) assert.equal(w.caseIdOf(empty), '', String(empty));
});

test('an edit never carries a retry forward', async () => {
  const w = await load();
  const fallback = w.defaultSpecFromUseCase(UC, { warehouseId: 'wh1', inspireDatabase: 'main.inspire' });
  const latest = { spec_version: 3, spec_json: { ...fallback, retry_outputs: ['dashboard'], outputs: { ...fallback.outputs, alert: true } } };
  const edited = w.specFromLatest(latest, fallback);
  assert.equal('retry_outputs' in edited, false);
  assert.equal(edited.based_on_version, 3);
  assert.equal(edited.outputs.alert, true);
  const next = w.nextSpecFrom(latest, { schedule: { enabled: true } });
  assert.equal('retry_outputs' in next, false);
  assert.equal(next.based_on_version, 3);
  assert.deepEqual(next.schedule, { enabled: true });
  assert.deepEqual(w.nextSpecFrom(latest, { retry_outputs: ['alert'] }).retry_outputs, ['alert']);
  assert.deepEqual(w.nextSpecFrom(null, {}), { based_on_version: null });
});

test('a confirmation to overwrite notebook edits applies to its own version only', async () => {
  const w = await load();
  const fallback = w.defaultSpecFromUseCase(UC, { warehouseId: 'wh1', inspireDatabase: 'main.inspire' });
  assert.equal(fallback.confirm_notebook_overwrite, false);
  const latest = { spec_version: 4, spec_json: { ...fallback, confirm_notebook_overwrite: true, retry_outputs: ['dashboard'] } };
  const edited = w.specFromLatest(latest, fallback);
  assert.equal(edited.confirm_notebook_overwrite, false, 'an Edit after a confirmed rebuild starts unconfirmed');
  assert.equal(served(edited).spec.confirm_notebook_overwrite, false);
  const next = w.nextSpecFrom(latest, { schedule: { enabled: true } });
  assert.equal('confirm_notebook_overwrite' in next, false);
  assert.equal(served(next).spec.confirm_notebook_overwrite, false);
  const confirmed = w.nextSpecFrom(latest, { confirm_notebook_overwrite: true });
  assert.equal(confirmed.confirm_notebook_overwrite, true);
  assert.equal(confirmed.based_on_version, 4);
  assert.equal('retry_outputs' in confirmed, false);
  assert.equal(served(confirmed).spec.confirm_notebook_overwrite, true);
});

test('a notebook counts as edited only when the agent recorded the edit', async () => {
  const w = await load();
  const at = 1761400000000;
  assert.deepEqual(w.editedNotebook({ status: 'failed', asset_status: { notebook: { modified_at: 1, state: 'edited', edited_at: at } } }),
    { edited_at: at });
  assert.deepEqual(w.editedNotebook({ status: 'ready', asset_status: { notebook: { state: 'edited' } } }), { edited_at: null });
  for (const latest of [null, {}, { asset_status: null }, { asset_status: {} }, { asset_status: { notebook: null } },
    { asset_status: { notebook: { modified_at: at, spec_version: 3 } } },
    { asset_status: { notebook: { modified_at: at, rewriting: { spec_version: 4, run_id: '11' } } } },
    { asset_status: { dashboard: { state: 'edited' } } }]) {
    assert.equal(w.editedNotebook(latest), null, JSON.stringify(latest));
  }
});

test('only failed outputs that are still selected on a version with warnings can be retried', async () => {
  const w = await load();
  const latest = {
    status: 'ready_with_warnings',
    spec_version: 8,
    spec_json: { outputs: { dashboard: true, genie_space: true, app: false, alert: true } },
    asset_status: {
      dashboard: { state: 'ready' },
      genie_space: { state: 'failed', error: 'space create 403' },
      app: { state: 'failed', error: 'old' },
      alert: { state: 'failed', spec_version: 7 },
    },
  };
  assert.deepEqual(w.retryableOutputs(latest).map((o) => [o.id, o.error, o.spec_version]),
    [['genie_space', 'space create 403', 8], ['alert', '', 7]], 'a failure carried from an older version names the version it failed on');
  assert.deepEqual(w.retryableOutputs({ ...latest, status: 'failed' }), []);
  assert.deepEqual(w.retryableOutputs({ ...latest, status: 'ready' }), []);
  assert.deepEqual(w.retryableOutputs(null), []);
  assert.deepEqual(w.retryableOutputs({ status: 'ready_with_warnings', spec_json: {}, asset_status: null }), []);
});

test('only an output that was built and still works can be rebuilt, and only once the MVP is ready', async () => {
  const w = await load();
  const latest = {
    status: 'ready_with_warnings',
    spec_json: { outputs: { dashboard: true, genie_space: true, app: true, alert: false } },
    asset_status: {
      dashboard: { state: 'ready' },
      genie_space: { state: 'failed', error: 'space create 403' },
      app: { state: 'ready', health: 'running' },
      alert: { state: 'ready' },
    },
  };
  assert.deepEqual(w.rebuildableOutputs(latest).map((o) => o.id), ['dashboard', 'app'],
    'a failed output belongs to the retries and an unticked one is not rebuilt');
  assert.deepEqual(w.rebuildableOutputs({ ...latest, status: 'ready' }).map((o) => o.id), ['dashboard', 'app']);
  for (const status of ['queued', 'filling', 'building_outputs', 'failed']) {
    assert.deepEqual(w.rebuildableOutputs({ ...latest, status }), [], status);
  }
  assert.deepEqual(w.rebuildableOutputs({ ...latest, asset_status: { app: { state: 'unmanaged' }, dashboard: { state: 'deleted' } } }), []);
  assert.deepEqual(w.rebuildableOutputs(null), []);
});

test('alert recipients default to the decision owner and the users it is shared with, never groups', async () => {
  const w = await load();
  const spec = {
    use_case: { decision_owner: 'Owner@Example.com' },
    sharing: { principals: [
      { type: 'user', name: 'owner@example.com' }, { type: 'user', name: 'b@example.com' },
      { type: 'group', name: 'planners' }, { type: 'user', name: 'not an email' }, { type: 'service_principal', name: 'sp@example.com' },
    ] },
  };
  assert.deepEqual(w.defaultAlertRecipients(spec), ['Owner@Example.com', 'b@example.com']);
  assert.deepEqual(w.defaultAlertRecipients({ use_case: { decision_owner: 'Head of Retention' }, sharing: { principals: [] } }), []);
  assert.deepEqual(w.defaultAlertRecipients({}), []);
});

test('the Delivery step accepts an alert on its own and blocks one nobody would receive', async () => {
  const w = await load();
  const base = w.defaultSpecFromUseCase(UC, { warehouseId: 'wh1', inspireDatabase: 'main.inspire' });
  const only = (outputs) => ({ ...base, outputs: { ...base.outputs, dashboard: false, genie_space: false, app: false, ...outputs } });
  assert.deepEqual(w.stepErrors('delivery', only({ alert: true, alert_recipients: ['a@example.com'] })), []);
  assert.deepEqual(w.stepErrors('delivery', only({ alert: true, alert_destinations: [{ id: '1234abcd-ef' }] })), []);
  assert.deepEqual(w.stepErrors('delivery', only({})), [], 'Notebook alone is a valid delivery: the notebook is always built');
  assert.ok(w.stepErrors('delivery', only({ alert: true })).includes('an alert needs at least one recipient email or notification destination'));
  assert.ok(w.stepErrors('delivery', only({ alert: true, alert_recipients: ['nope'] })).some((e) => e.includes('not an email address: nope')));
  assert.ok(w.stepErrors('delivery', only({ alert: true, alert_recipients: ['a@example.com'], alert_threshold: '-1' }))
    .includes('the alert threshold must be a number of rows, 0 or more'));
  assert.deepEqual(w.stepErrors('delivery', only({ alert: true, alert_recipients: ['a@example.com'], alert_threshold: '' })), []);
  assert.deepEqual(w.sectionErrors('use_it', only({ alert: true })), [], 'the tile choice itself is fine; the alert details are their own section');
  assert.deepEqual(w.sectionErrors('alert', only({ alert: false, alert_recipients: ['nope'] })), [], 'an alert that is off is never checked');
});

test('a baseline alert fires only on a rise or a fall, like the agent checks', async () => {
  const w = await load();
  const base = w.defaultSpecFromUseCase(UC, { warehouseId: 'wh1', inspireDatabase: 'main.inspire' });
  const alert = (outputs) => ({ ...base, outputs: { ...base.outputs, alert: true, alert_recipients: ['a@example.com'], ...outputs } });
  assert.equal(base.outputs.alert_threshold_basis, 'fixed');
  for (const op of ['>=', '>', '<=', '<']) {
    assert.deepEqual(w.sectionErrors('alert', alert({ alert_threshold_basis: 'baseline', alert_operator: op })), [], op);
  }
  for (const op of ['=', '!=']) {
    assert.deepEqual(w.sectionErrors('alert', alert({ alert_threshold_basis: 'baseline', alert_operator: op })),
      ['compared with earlier runs, the alert fires on a rise or a fall, so pick one of >= > <= <'], op);
    assert.deepEqual(w.sectionErrors('alert', alert({ alert_threshold_basis: 'fixed', alert_operator: op })), [], `fixed ${op}`);
    assert.equal(w.baselineOperatorOk(op), false, op);
  }
  assert.equal(w.baselineOperatorOk(''), true);
  assert.equal(w.baselineOperatorOk('constructor'), false);
});

test('each Full MVP step runs the checks of every section it shows, and only those', async () => {
  const w = await load();
  assert.deepEqual(w.IMPLEMENT_STEPS.map((s) => [s.id, s.label]), [['delivery', 'What to deliver'], ['data', 'Data & results'], ['run', 'Run it']]);
  assert.equal(w.IMPLEMENT_STEPS.some((s) => s.id === 'use_case'), false, 'there is no Use case step: the use case is a strip with Details (must-exclude)');
  assert.ok(w.IMPLEMENT_STEPS.find((s) => s.id === 'data').sections.includes('use_case'), 'the goal and decision owner are still checked, on Data & results');
  assert.deepEqual(w.IMPLEMENT_STEPS.find((s) => s.id === 'data').sections.filter((x) => x === 'results'), ['results'], 'the result table is on Data & results');
  assert.equal(w.DELIVERY_QUESTION, 'How will people use this use case?');
  assert.deepEqual([w.SUMMARY_STEP.id, w.SUMMARY_STEP.label, w.SUMMARY_STEP.sections, w.SUMMARY_STEP.panels], ['summary', 'Review & build', ['vibes'], ['summary', 'vibes']], 'the optional Vibes box sits on Summary');
  assert.deepEqual([w.APP_STEP.id, w.APP_STEP.label, w.APP_STEP.sections, w.APP_STEP.panels], ['app', 'Who uses the App', ['app_access', 'app_features'], ['app_access', 'app_features']], 'Who uses the App asks who sees which rows and which App features are on');
  const deliver = w.IMPLEMENT_STEPS.find((s) => s.id === 'delivery');
  assert.deepEqual([deliver.sections, deliver.panels], [['use_it', 'app_owners', 'alert'], ['delivery']], 'What to deliver holds only the outputs');
  const where = w.wizardSteps('mvp', { outputs: { app: true } }).find((s) => s.id === 'where');
  assert.deepEqual([where.label, where.sections, where.panels], ['Where it lives', ['app_place', 'app_pages'], ['app_place', 'app_pages']], 'where the App goes and its pages are one step, after What to deliver');
  assert.equal(w.wizardSteps('mvp', { outputs: { app: false } }).some((s) => s.id === 'where'), false, 'Where it lives is skipped when no App is chosen');
  assert.equal(w.APP_STEP.panels.includes('app_place'), false, 'never on Who uses the App (must-exclude)');
  assert.equal(w.APP_PAGES_STEP, undefined, 'the App pages are part of Where it lives, not a step of their own (must-exclude)');
  assert.deepEqual([w.APP_LOOK_STEP.id, w.APP_LOOK_STEP.label, w.APP_LOOK_STEP.panels], ['app_look', 'App look', ['app_look']], 'the look is a step of its own');
  assert.deepEqual([w.RUN_STEP.label, w.RUN_STEP.panels], ['Run it', ['measure']]);
  assert.equal(w.SETTINGS_STEP, undefined, 'Team capacity and the use case settings are set in the App, never in the wizard');
  const all = [...w.wizardSteps('mvp', { outputs: { app: true } }, { grouping: true, firstRun: true }), ...w.NOTEBOOK_STEPS];
  assert.deepEqual([...new Set(all.flatMap((s) => s.sections))].sort(), ['alert', 'app_access', 'app_features', 'app_look', 'app_owners', 'app_pages', 'app_place', 'configure', 'data', 'first_run', 'fresh', 'grouping', 'holdout', 'kpi', 'results', 'schedule', 'use_case', 'use_it', 'vibes']);
  assert.equal(all.some((s) => s.sections.includes('settings') || s.sections.includes('capacity')), false, 'no step checks settings or capacity (must-exclude)');
  for (const s of all) assert.ok(s.advanced.every((a) => s.sections.includes(a)), s.id);
  assert.deepEqual(w.BUILD_STEP_IDS, ['delivery', 'where', 'app', 'app_look', 'summary']);
  assert.equal(w.SUMMARY_STEP.label, 'Review & build');
  const spec = w.defaultSpecFromUseCase(UC, { warehouseId: '', inspireDatabase: 'main.inspire' });
  const bad = { ...spec, use_case: { ...spec.use_case, decision_owner: '' }, schedule: { ...spec.schedule, enabled: true, cron: '0 0 25 * * ?' },
    config: { ...spec.config, result_table: 'main.inspire' },
    outputs: { ...spec.outputs, dashboard: false, genie_space: false, app: true, app_name: 'X', alert: true } };
  assert.deepEqual(w.stepErrors('data', bad).filter((e) => /decision owner|goal/.test(e)), ['name the decision owner'], 'the decision owner is checked on Data');
  assert.deepEqual(w.stepErrors('data', bad), ['name the decision owner', 'pick a SQL warehouse', 'pick a catalog and a schema, and name the result table'], 'Data & results checks the use case, the warehouse and the table');
  const cron = "the cron is not valid: the hour value '25' is not 0 to 23";
  assert.deepEqual(w.sectionErrors('results', bad), ['pick a catalog and a schema, and name the result table'], 'the result table is checked on its own');
  assert.deepEqual(w.stepErrors('run', bad), [cron], 'Run it checks Keep it fresh');
  assert.deepEqual(w.stepErrors('run', { ...bad, kpi: { target: 'Revenue' } }, { kpiOptions: [{ name: 'Churn rate' }] }),
    [cron, "'Revenue' is not one of this use case\u2019s KPIs, so pick one from the list or Let Inspire pick"], 'and Measure impact on the same step');
  assert.deepEqual(w.stepErrors('delivery', bad), [
    w.GENIE_FOR_APP_NOTE,
    'an alert needs at least one recipient email or notification destination',
  ]);
  assert.deepEqual(w.stepErrors('where', bad), ['app name must be 3-30 lowercase letters, digits and dashes'], 'the App name is checked on Where it lives');
  assert.deepEqual(w.advancedErrors('delivery', bad), [
    'an alert needs at least one recipient email or notification destination',
  ], 'the App name is a main question on Deliver, never hidden under Advanced');
  assert.deepEqual(w.stepErrors('app', bad), [], 'Who uses the App no longer checks the App name (must-exclude)');
  assert.deepEqual(w.advancedErrors('data', bad), ['pick a SQL warehouse'], 'the goal and decision owner sit on the use case strip, never under Advanced');
  assert.deepEqual(w.advancedErrors('data', bad).filter((e) => /catalog|schema/.test(e)), [], 'the catalog and schema show on Data & results itself, so their problem never opens Advanced');
  assert.deepEqual(w.advancedErrors('run', bad), [cron], 'the cron sits under Advanced on Keep it fresh');
  assert.deepEqual(w.advancedErrors('run', { ...bad, schedule: spec.schedule, config: { ...spec.config, result_table: 'main.inspire.churn_scores' }, kpi: { target: 'Revenue' } }, { kpiOptions: [{ name: 'Churn rate' }] }), [],
    'the KPI target shows on Measure impact, so its problem never opens Advanced');
  assert.deepEqual(w.advancedErrors('app', bad), [], 'the App name shows on the App step, so its problem never opens Advanced');
  const named = { ...bad, outputs: { ...bad.outputs, app_name: 'churn-desk' } };
  assert.deepEqual(w.stepErrors('app', named), [], 'the App starts with everyone seeing the same rows, so the step passes as made');
  assert.deepEqual(w.stepErrors('app', { ...named, outputs: { ...named.outputs, app_access: '' } }),
    ['choose who sees which rows: everyone the same rows, or each person only their own']);
  const shell = { styles: ['a', 'b', 'c'], layouts: ['sidebar', 'tabs', 'home'], palettes: ['default', 'mono'], themes: ['light', 'dark'] };
  assert.deepEqual(w.stepErrors('app_look', named, { appLook: shell }), []);
  assert.deepEqual(w.stepErrors('app_look', w.withAppLook(named, 'palette', 'neon'), { appLook: shell }), ["pick one of the App's palettes"]);
  assert.throws(() => w.stepErrors('use_it', bad), /unknown wizard step 'use_it'/);
  assert.throws(() => w.advancedErrors('review', bad), /unknown wizard step 'review'/);
  assert.throws(() => w.stepErrors('app', { ...bad, outputs: { ...bad.outputs, app: false } }), /unknown wizard step 'app'/,
    'without an App the wizard has no App step');
  assert.throws(() => w.stepErrors('choose', bad), /unknown wizard step 'choose'/);
  assert.throws(() => w.stepErrors('settings', bad, { scopeSteps: { grouping: true, firstRun: true } }), /unknown wizard step 'settings'/, 'the wizard has no Settings step');
  assert.deepEqual(w.stepErrors('summary', bad), [], 'Summary checks only the optional vibes box');
});

test('the App name is the use case name cut at a word inside the 30-character limit, else the use case id', async () => {
  const w = await load();
  const cases = [
    ['Predict churn', 'N01-U01', 'predict-churn'],
    ['Recommend Next-Best Products to Lift Basket Size', 'N05-U01', 'recommend-next-best-products'],
    ['Forecast demand by zone to reduce idle time', 'N02-U03', 'forecast-demand-by-zone-to'],
    ['Supercalifragilisticexpialidocious forecasting', 'N01-U02', 'supercalifragilisticexpialidoc'],
    ['Café Ünïcode churn', 'N01-U03', 'cafe-unicode-churn'],
    ['360 customer view', 'N01-U04', 'uc-360-customer-view'],
    ['  --Churn!!  risk--  ', 'N01-U05', 'churn-risk'],
    ['توقع فقدان العملاء', 'N07-U02', 'n07-u02'],
    ['AI', 'N03-U01', 'n03-u01'],
    ['', 'N03-U02', 'n03-u02'],
    ['', '', ''],
  ];
  for (const [name, id, want] of cases) {
    const got = w.appNameOf(name, id);
    assert.equal(got, want, name);
    if (got) {
      assert.match(got, w.APP_NAME_RE, name);
      assert.ok(got.length <= 30, name);
      assert.ok(!got.endsWith('-'), name);
    }
  }
  const spec = w.defaultSpecFromUseCase({ ...UC, Name: 'Recommend Next-Best Products to Lift Basket Size' }, { warehouseId: 'wh1', inspireDatabase: 'main.inspire', owner: 'amr@example.com' });
  assert.equal(spec.outputs.app_name, 'recommend-next-best-products');
  assert.equal(w.defaultSpecFromUseCase({ ...UC, short_name: 'Churn desk' }).outputs.app_name, 'churn-desk', 'a short name wins over the full name');
  const withApp = { ...spec, outputs: { ...spec.outputs, app: true, app_access: 'sp' } };
  assert.deepEqual(served(withApp).errors, []);
  assert.equal(served(withApp).spec.outputs.app_name, 'recommend-next-best-products');
});

test('a taken App name suggests the next free-looking name and stays inside the limit', async () => {
  const w = await load();
  assert.equal(w.nextAppName('predict-churn'), 'predict-churn-2');
  assert.equal(w.nextAppName('predict-churn-2'), 'predict-churn-3');
  assert.equal(w.nextAppName('predict-churn-9'), 'predict-churn-10');
  assert.equal(w.nextAppName('n07-u02'), 'n07-u02-2', 'an id ending in letters and digits is not a counter');
  assert.equal(w.nextAppName('uc-360'), 'uc-360-2', 'a three-digit number is part of the name');
  assert.equal(w.nextAppName('predict-churn-1'), 'predict-churn-1-2', 'a -1 is part of the name, not a counter');
  assert.equal(w.nextAppName('recommend-next-best-products'), 'recommend-next-best-products-2');
  assert.equal(w.nextAppName('supercalifragilisticexpialidoc'), 'supercalifragilisticexpialid-2');
  assert.equal(w.nextAppName('forecast-demand-by-zone-to-red'), 'forecast-demand-by-zone-to-2');
  for (const name of ['predict-churn', 'recommend-next-best-products', 'supercalifragilisticexpialidoc', 'forecast-demand-by-zone-to-red', 'n07-u02']) {
    let next = name;
    for (let i = 0; i < 12; i += 1) {
      next = w.nextAppName(next);
      assert.match(next, w.APP_NAME_RE, next);
      assert.notEqual(next, name);
    }
  }
});

test('Keep it fresh maps Off, Daily and Weekly onto the schedule, and shows Custom for any other cron', async () => {
  const w = await load();
  const spec = w.defaultSpecFromUseCase(UC, { warehouseId: 'wh1', inspireDatabase: 'main.inspire', owner: 'amr@example.com' });
  assert.equal(w.freshnessOf(spec.schedule), 'daily', 'a new use case starts on Daily, its Recommended option');
  assert.equal(spec.schedule.enabled, true);
  const saved = w.specFromLatest({ spec_version: 2, spec_json: { ...spec, schedule: { ...spec.schedule, enabled: false } } }, spec);
  assert.equal(w.freshnessOf(saved.schedule), 'off', 'a saved version someone turned off stays off (must-exclude)');
  const daily = w.withFreshness(spec, 'daily');
  assert.deepEqual([daily.schedule.enabled, daily.schedule.cron], [true, '0 0 6 * * ?']);
  assert.equal(w.freshnessOf(daily.schedule), 'daily');
  const weekly = w.withFreshness(daily, 'weekly');
  assert.deepEqual([weekly.schedule.enabled, weekly.schedule.cron], [true, '0 0 6 ? * MON']);
  assert.equal(w.freshnessOf(weekly.schedule), 'weekly');
  const off = w.withFreshness(weekly, 'off');
  assert.deepEqual([off.schedule.enabled, off.schedule.cron], [false, '0 0 6 ? * MON'], 'Off keeps the cron for the next time it is turned on');
  assert.equal(w.freshnessOf(off.schedule), 'off');
  assert.equal(w.freshnessOf({ enabled: true, cron: '0 30 2 1 * ?' }), 'custom');
  assert.equal(w.freshnessOf({ enabled: true, cron: ' 0 0 6 * * ? ' }), 'daily');
  assert.equal(w.freshnessOf(null), 'off');
  for (const option of w.FRESHNESS_OPTIONS.filter((o) => o.cron)) {
    assert.equal(w.cronProblem(option.cron), '', option.id);
    assert.deepEqual(w.stepErrors('delivery', w.withFreshness(spec, option.id)), [], option.id);
    assert.deepEqual(served(w.withFreshness(spec, option.id)).errors, [], option.id);
  }
  assert.equal(spec.schedule.enabled, true, 'withFreshness never mutates the spec it was given');
  assert.equal(w.freshnessOf(spec.schedule), 'daily');
  assert.throws(() => w.withFreshness(spec, 'hourly'), /unknown freshness 'hourly'/);
  assert.throws(() => w.withFreshness(spec, 'custom'), /unknown freshness 'custom'/);
});

test('an edit offers the use case App name in place of the old id default unless an App was built under it, and keeps a typed name', async () => {
  const w = await load();
  const fallback = w.defaultSpecFromUseCase(UC, { warehouseId: 'wh1', inspireDatabase: 'main.inspire', owner: 'amr@example.com' });
  const stored = served({ ...fallback, outputs: { ...fallback.outputs, app: false } }).spec;
  const saved = (outputs) => ({ spec_version: 2, spec_json: { ...stored, outputs: { ...stored.outputs, ...outputs } } });
  assert.equal(stored.outputs.app_name, '', 'the backend stores no App name when the App is off');
  const noApp = w.specFromLatest({ spec_version: 2, spec_json: stored }, fallback);
  assert.equal(noApp.outputs.app_name, 'predict-churn');
  const legacy = w.specFromLatest(saved({ app_name: 'n01-u01' }), fallback);
  assert.equal(legacy.outputs.app_name, 'predict-churn', 'a name kept from an App that was never built is replaced');
  const tickedNeverBuilt = w.specFromLatest(saved({ app: true, app_name: 'n01-u01' }), fallback, {});
  assert.equal(tickedNeverBuilt.outputs.app_name, 'predict-churn', 'the old wizard ticked the App under the id default, and the run failed before building it');
  assert.equal(tickedNeverBuilt.outputs.app, true, 'the App stays ticked; only its name changes');
  const builtUnderId = w.specFromLatest(saved({ app: true, app_name: 'n01-u01' }), fallback, { app: 'n01-u01' });
  assert.equal(builtUnderId.outputs.app_name, 'n01-u01', 'renaming a built App would build a second one');
  const typed = w.specFromLatest(saved({ app: true, app_name: 'churn-desk' }), fallback, {});
  assert.equal(typed.outputs.app_name, 'churn-desk', 'a name the user typed is theirs');
  const live = w.specFromLatest({ spec_version: 3, spec_json: { ...stored, outputs: { ...stored.outputs, app: true, app_name: 'n01-u01-churn' } } }, fallback, { app: 'n01-u01-churn' });
  assert.equal(live.outputs.app_name, 'n01-u01-churn', 'renaming a live App would build a second one');
  assert.equal(live.outputs.app, true);
});

test('the trigger reads the same as the one the agent writes on the alert', async () => {
  const w = await load();
  assert.ok(FIXTURE.alert_triggers.length >= 6);
  for (const [outputs, text] of FIXTURE.alert_triggers) assert.equal(w.alertTriggerText(outputs), text, JSON.stringify(outputs));
});

const FIXTURE = require('../../agent/tests/fixtures/implement_change_classes.json');
const ROW = { id: 'N01-U01', primary_table: 'main.s.orders', tables_involved: 'main.s.orders,main.s.returns,main.s.web' };

function specWith(w, data) {
  const spec = w.defaultSpecFromUseCase(ROW, { warehouseId: 'wh1', inspireDatabase: 'main.inspire', owner: 'amr@example.com' });
  return { ...spec, data: { ...spec.data, ...data } };
}

test('the wizard lists the same tables the backend and the agent enforce', async () => {
  const w = await load();
  for (const c of FIXTURE.table_names) {
    const row = { tables_involved: c.tables_involved, primary_table: c.primary_table };
    assert.deepEqual(w.tablesOf(row), backend.useCaseTables(row), JSON.stringify(c));
    assert.equal(w.primaryTableOf(row), backend.primaryTableOf(row));
  }
  assert.deepEqual(w.tablesOf({ Tables: 'main.s.a, main.s.b', 'Primary Table': 'main.s.c' }), ['main.s.a', 'main.s.b', 'main.s.c']);
});

test('removing a table clears its swap, roles and filters, says so, and validates clean', async () => {
  const w = await load();
  const spec = specWith(w, {
    tables: { 'main.s.returns': 'main.s.returns_v2' },
    column_roles: { entity_id: 'main.s.orders.customer_id', segment: 'main.s.returns_v2.region', label: 'main.s.returns.reason' },
    filters: [{ table: 'main.s.returns_v2', column: 'region', op: 'in', values: ['EU'] },
      { table: 'main.s.orders', column: 'channel', op: 'not in', values: ['test'] }],
  });
  const { spec: next, cleared } = w.removeTable(spec, 'main.s.returns');
  assert.deepEqual(next.data.removed_tables, ['main.s.returns']);
  assert.deepEqual(next.data.tables, {});
  assert.deepEqual(next.data.column_roles, { entity_id: 'main.s.orders.customer_id' });
  assert.deepEqual(next.data.filters, [{ table: 'main.s.orders', column: 'channel', op: 'not in', values: ['test'] }]);
  assert.deepEqual(cleared, { roles: ['segment', 'label'], filters: 1 });
  assert.deepEqual(served(next).errors, []);
  assert.deepEqual(backend.removedTableProblems(served(next).spec, backend.useCaseTables(ROW), backend.primaryTableOf(ROW)), []);
  assert.deepEqual(w.removeTable(next, 'MAIN.S.RETURNS').spec.data.removed_tables, ['main.s.returns']);
  assert.deepEqual(w.restoreTable(next, 'MAIN.S.RETURNS').data.removed_tables, []);
});

test('the primary table and the last kept table cannot be removed', async () => {
  const w = await load();
  const spec = specWith(w, {});
  assert.equal(w.removalBlocker(ROW, spec, 'main.s.orders'), 'the primary table can be swapped, not removed');
  assert.equal(w.removalBlocker(ROW, spec, 'main.s.returns'), '');
  const two = w.removeTable(spec, 'main.s.returns').spec;
  assert.equal(w.removalBlocker({ ...ROW, primary_table: '' }, w.removeTable(two, 'main.s.web').spec, 'main.s.orders'), 'keep at least one table');
});

test('segment and exclusion filters are set, replaced and dropped by column and operator', async () => {
  const w = await load();
  let spec = specWith(w, {});
  spec = w.setFilterValues(spec, 'main.s.web', 'region', 'in', ['EU', 'UK']);
  spec = w.setFilterValues(spec, 'main.s.web', 'region', 'not in', ['XX']);
  assert.deepEqual(w.filterValues(spec, 'main.s.web', 'region', 'in'), ['EU', 'UK']);
  spec = w.setFilterValues(spec, 'main.s.web', 'region', 'in', ['EU']);
  assert.equal(spec.data.filters.length, 2);
  assert.deepEqual(served(spec).spec.data.filters, [
    { table: 'main.s.web', column: 'region', op: 'not in', values: ['XX'] },
    { table: 'main.s.web', column: 'region', op: 'in', values: ['EU'] },
  ]);
  assert.deepEqual(w.sectionErrors('data', spec), []);
  const clash = w.setFilterValues(spec, 'main.s.web', 'region', 'not in', ['EU']);
  assert.deepEqual(w.sectionErrors('data', clash), ['main.s.web.region both keeps and excludes EU']);
  assert.deepEqual(w.setFilterValues(spec, 'main.s.web', 'region', 'in', []).data.filters, [
    { table: 'main.s.web', column: 'region', op: 'not in', values: ['XX'] },
  ]);
});

test('the live check reads only the primary table, after its swap', async () => {
  const w = await load();
  const spec = specWith(w, {
    tables: { 'main.s.orders': 'main.s.orders_v2' },
    column_roles: { entity_id: 'main.s.orders_v2.customer_id', event_date: 'main.s.orders_v2.order_date', segment: 'main.s.web.region' },
    filters: [{ table: 'main.s.web', column: 'region', op: 'in', values: ['EU'] },
      { table: 'main.s.orders_v2', column: 'channel', op: 'not in', values: ['test'] }],
    window: { start: '2026-01-01', end: '2026-06-30' },
  });
  assert.deepEqual(w.readinessScope(spec, ROW), {
    table: 'main.s.orders_v2',
    columns: ['customer_id', 'order_date'],
    filters: [{ table: 'main.s.orders_v2', column: 'channel', op: 'not in', values: ['test'] }],
    window: { column: 'order_date', start: '2026-01-01', end: '2026-06-30' },
    uncounted: ['the filters on main.s.web'],
  });
  const elsewhere = { ...spec, data: { ...spec.data, column_roles: { event_date: 'main.s.web.visit_date' } } };
  assert.deepEqual(w.readinessScope(elsewhere, ROW).window, {});
  assert.deepEqual(w.readinessScope(elsewhere, ROW).uncounted, ['the date window on main.s.web', 'the filters on main.s.web']);
  const unmapped = { ...spec, data: { ...spec.data, column_roles: {}, filters: [] } };
  assert.deepEqual(w.readinessScope(unmapped, ROW).uncounted, ['the date window, which has no event date column']);
  const open = { ...spec, data: { ...spec.data, column_roles: { event_date: 'main.s.web.visit_date' }, filters: [], window: { start: '', end: '' } } };
  assert.deepEqual(w.readinessScope(open, ROW).uncounted, [], 'an empty window is not left out of anything');
});

test('a use case is named by its card first, then its tracking row, then any plain name', async () => {
  const w = await load();
  const { nameOfUseCase } = await import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', 'useCaseFields.js')).href);
  assert.equal(nameOfUseCase({ Name: 'Predict churn', use_case: 'Keep customers who would leave' }), 'Predict churn');
  assert.equal(nameOfUseCase({ use_case: ' Keep customers who would leave ' }), 'Keep customers who would leave');
  assert.equal(nameOfUseCase({ name: 'churn' }), 'churn');
  assert.equal(nameOfUseCase({}), '');
  assert.equal(nameOfUseCase(null), '');
  assert.equal(w.defaultSpecFromUseCase({ id: 'N01-U01', Name: 'Predict churn', use_case: 'Keep customers' }).use_case_name, 'Predict churn');
});

test('the row count says what it left out, and an empty scope is a warning that names what to widen, never a block', async () => {
  const w = await load();
  const scope = (over) => ({ table: 'main.s.orders', columns: [], filters: [], window: {}, uncounted: [], ...over });
  assert.equal(w.readinessText({ skipped: true, row_count: null }, scope()), '');
  assert.equal(w.readinessText(null, scope()), '');
  assert.equal(w.readinessText({ skipped: false, row_count: 0 }, scope()), '', 'an empty count leaves the line to the warning');
  assert.equal(w.readinessText({ skipped: false, row_count: 2879789 }, scope()),
    'Inspire found 2,879,789 rows to work with in main.s.orders.');
  assert.equal(w.readinessText({ skipped: false, row_count: 2879789 }, scope({ uncounted: ['the date window on main.s.dates'] })),
    'Inspire found 2,879,789 rows to work with in main.s.orders. This count leaves out the date window on main.s.dates; the preview run applies it.');
  assert.equal(w.readinessText({ skipped: false, row_count: 5 }, scope({ uncounted: ['the date window on main.s.dates', 'the filters on main.s.web'] })),
    'Inspire found 5 rows to work with in main.s.orders. This count leaves out the date window on main.s.dates and the filters on main.s.web; the preview run applies them.');

  const window = { column: 'order_date', start: '2026-10-26', end: '2026-10-28' };
  const filters = [{ table: 'main.s.orders', column: 'channel', op: 'in', values: ['web'] }];
  assert.deepEqual(w.scopeNarrowing(scope()), []);
  assert.deepEqual(w.scopeNarrowing(scope({ window: { column: 'order_date', start: '', end: '' } })), [], 'a mapped column with no dates narrows nothing');
  assert.deepEqual(w.scopeNarrowing(scope({ window, filters })), ['window', 'filters']);
  const go = 'You can go on.';
  assert.equal(w.emptyScopeWarning(scope()), `Warning: main.s.orders is empty, so the First run may write no rows. ${go}`);
  assert.equal(w.emptyScopeWarning(scope(), ['main.s.orders']),
    `Warning: main.s.orders, the only table you picked, is empty, so no use case can be grounded in rows. ${go}`);
  assert.equal(w.emptyScopeWarning(scope(), ['main.s.orders', 'main.s.web']),
    `Warning: every table you picked is empty (main.s.orders, main.s.web), so no use case can be grounded in rows. ${go}`);
  assert.equal(w.emptyScopeWarning(scope({ window })),
    'Warning: main.s.orders has no rows inside the date window you picked. You can go on, or widen or clear it under Change data settings on Data.');
  assert.equal(w.emptyScopeWarning(scope({ filters })),
    'Warning: main.s.orders has no rows that pass the filters you picked. You can go on, or widen or clear them under Change data settings on Data.');
  assert.equal(w.emptyScopeWarning(scope({ window, filters }), ['main.s.orders']),
    'Warning: main.s.orders has no rows inside the date window that pass the filters you picked. You can go on, or widen or clear them under Change data settings on Data.',
    'a narrowed scope never claims the tables are empty (must-exclude)');
  for (const text of [w.emptyScopeWarning(scope()), w.emptyScopeWarning(scope(), ['main.s.orders']), w.emptyScopeWarning(scope({ filters }))]) {
    assert.match(text, /^Warning: /);
    assert.doesNotMatch(text, /No rows to work with|Change it to a table with rows/, 'the old block wording is gone (must-exclude)');
  }
  assert.equal(w.emptyScopeError, undefined, 'no blocking empty-scope error is left to call');
});

test('only when every picked table counts zero rows is the scope all empty; a table with rows, a failed or skipped count, or a narrowed scope is not (must-exclude)', async () => {
  const w = await load();
  const scope = (over) => ({ table: 'main.s.orders', columns: [], filters: [], window: {}, uncounted: [], ...over });
  const zero = { skipped: false, row_count: 0 };
  assert.deepEqual(w.otherScopeTables(scope(), ['main.s.orders', 'MAIN.S.WEB', 'main.s.web', '', 'main.s.items']), ['MAIN.S.WEB', 'main.s.items']);
  assert.deepEqual(w.otherScopeTables(scope({ filters: [{ table: 'main.s.orders', column: 'c', op: 'in', values: ['x'] }] }), ['main.s.web']), []);
  assert.deepEqual(w.allEmptyTables(scope(), [], []), ['main.s.orders'], 'the only table counts as every table');
  assert.deepEqual(w.allEmptyTables(scope(), ['main.s.web'], [zero]), ['main.s.orders', 'main.s.web']);
  assert.deepEqual(w.allEmptyTables(scope(), ['main.s.web'], [{ skipped: false, row_count: 3 }]), []);
  assert.deepEqual(w.allEmptyTables(scope(), ['main.s.web'], [null]), [], 'a failed count is not an empty table');
  assert.deepEqual(w.allEmptyTables(scope(), ['main.s.web'], [{ skipped: true, row_count: null }]), []);
  assert.deepEqual(w.allEmptyTables(scope({ window: { column: 'd', start: '2026-01-01' } }), [], []), [], 'a narrowed scope is never all empty');
  const asked = [];
  const counter = (counts) => (table) => { asked.push(table); const c = counts[table]; if (c instanceof Error) throw c; return c; };
  assert.equal(await w.emptyScopeWarningOf(scope(), ['main.s.orders', 'main.s.web'], counter({ 'main.s.web': zero })),
    w.emptyScopeWarning(scope(), ['main.s.orders', 'main.s.web']));
  assert.deepEqual(asked, ['main.s.web'], 'the main table is never counted twice');
  assert.equal(await w.emptyScopeWarningOf(scope(), ['main.s.orders', 'main.s.web'], counter({ 'main.s.web': new Error('denied') })), w.emptyScopeWarning(scope()),
    'a count that throws is not an empty table (must-exclude)');
  assert.equal(await w.emptyScopeWarningOf(scope(), ['main.s.orders', 'main.s.web'], () => Promise.reject(new Error('down'))), w.emptyScopeWarning(scope()));
  assert.equal(await w.emptyScopeWarningOf(scope(), ['main.s.orders'], () => { throw new Error('never asked'); }), w.emptyScopeWarning(scope(), ['main.s.orders']));
});

test('plan lines say what the edit builds, refreshes, deletes and keeps', async () => {
  const w = await load();
  assert.deepEqual(w.planLines(null), []);
  assert.deepEqual(w.planLines({ classes: ['outputs'], refill: false, build: ['genie_space', 'alert'], refresh: ['dashboard'],
    delete: ['app'], keep_unmanaged: [], schedule: false }), [
    'Changes: outputs',
    'The built notebook is kept as it is',
    'Builds: Genie Agent, Alert',
    'Refreshes: Dashboard',
    'Deletes: App',
  ]);
  assert.deepEqual(w.planLines({ classes: ['data'], refill: true, build: [], refresh: ['dashboard'], delete: [], keep_unmanaged: ['app'], schedule: true }), [
    'Changes: data',
    'Genie rewrites the notebook and Inspire re-runs the preview',
    'Refreshes: Dashboard',
    'Leaves in place, no longer managed: App',
    'Updates the job schedule',
  ]);
});

test('before a vibe is built, the plan never claims the notebook is kept, because Inspire decides what the vibe rebuilds when it reads it', async () => {
  const w = await load();
  const vibe = w.planLines({ classes: ['vibe'], refill: false, build: [], refresh: [], delete: [], keep_unmanaged: [], schedule: false });
  assert.deepEqual(vibe, ['Changes: vibe',
    'Inspire reads your vibe first and rebuilds only the parts it changes; an ask that changes the analysis rebuilds the notebook and every part after it']);
  assert.ok(!vibe.includes('The built notebook is kept as it is'));
  assert.equal(w.planLines({ classes: ['initial', 'vibe'], refill: true })[1], 'Genie rewrites the notebook and Inspire re-runs the preview', 'a first build writes the notebook either way');
  assert.equal(w.planLines({ classes: ['outputs'], refill: false })[1], 'The built notebook is kept as it is', 'without a vibe the plan reads as before');
});

test('plan lines say first when the results move to the use case\'s own table, and the Build page note reads the same', async () => {
  const w = await load();
  const moved = { from: 'main.s.n01_u01_out', to: 'main.s.n01_u01_s42_out', detail: 'results move to main.s.n01_u01_s42_out, because main.s.n01_u01_out holds the results of use case N01-U01 of session 7' };
  assert.deepEqual(w.planLines({ classes: ['config'], refill: true, result_table_moved: moved }).slice(0, 2), [
    'Result table: results move to main.s.n01_u01_s42_out, because main.s.n01_u01_out holds the results of use case N01-U01 of session 7',
    'Changes: config',
  ]);
  assert.equal(w.resultTableMoveNote({ result_table_moved: moved }), w.planLines({ result_table_moved: moved })[0]);
  assert.equal(w.resultTableMoveNote({ classes: ['config'] }), '');
  assert.equal(w.resultTableMoveNote({ result_table_moved: { detail: '  ' } }), '');
  assert.equal(w.resultTableMoveNote(null), '');
  assert.equal(w.planLines({ classes: ['config'], refill: true })[0], 'Changes: config', 'no move, no line');
});

test('failure emails start as the decision owner and follow the owner until the user edits them', async () => {
  const w = await load();
  const spec = w.defaultSpecFromUseCase(UC, { warehouseId: 'wh1', inspireDatabase: 'main.inspire', owner: 'amr@example.com' });
  assert.deepEqual(spec.schedule.failure_emails, ['amr@example.com']);
  assert.deepEqual(served(spec).spec.schedule.failure_emails, ['amr@example.com']);
  assert.deepEqual(w.defaultSpecFromUseCase(UC, {}).schedule.failure_emails, []);
  const moved = w.withDecisionOwner(spec, 'lead@example.com');
  assert.equal(moved.use_case.decision_owner, 'lead@example.com');
  assert.deepEqual(moved.schedule.failure_emails, ['lead@example.com']);
  assert.deepEqual(w.withDecisionOwner(moved, 'Head of Pricing').schedule.failure_emails, []);
  assert.deepEqual(w.withDecisionOwner(w.withDecisionOwner(moved, 'Head of Pricing'), 'x@example.com').schedule.failure_emails, ['x@example.com']);
  const edited = { ...moved, schedule: { ...moved.schedule, failure_emails: ['ops@example.com'] } };
  assert.deepEqual(w.withDecisionOwner(edited, 'other@example.com').schedule.failure_emails, ['ops@example.com']);
  const cleared = { ...moved, schedule: { ...moved.schedule, failure_emails: [] } };
  assert.deepEqual(w.withDecisionOwner(cleared, 'other@example.com').schedule.failure_emails, []);
  assert.deepEqual(w.withDecisionOwner({ ...moved, schedule: { ...moved.schedule, failure_emails: ['LEAD@example.com'] } }, 'new@example.com')
    .schedule.failure_emails, ['new@example.com']);
});

test('sharing starts with the decision owner and follows the owner until the user edits it', async () => {
  const w = await load();
  const spec = w.defaultSpecFromUseCase(UC, { warehouseId: 'wh1', inspireDatabase: 'main.inspire', owner: 'amr@example.com' });
  assert.deepEqual(spec.sharing.principals, [{ type: 'user', name: 'amr@example.com' }]);
  assert.deepEqual(served(spec).spec.sharing.principals, [{ type: 'user', name: 'amr@example.com' }]);
  assert.deepEqual(w.defaultSpecFromUseCase(UC, {}).sharing.principals, []);
  const moved = w.withDecisionOwner(spec, 'lead@example.com');
  assert.deepEqual(moved.sharing.principals, [{ type: 'user', name: 'lead@example.com' }]);
  const named = w.withDecisionOwner(moved, 'Head of Pricing');
  assert.deepEqual(named.sharing.principals, []);
  assert.deepEqual(w.withDecisionOwner(named, 'x@example.com').sharing.principals, [{ type: 'user', name: 'x@example.com' }]);
  const edited = { ...moved, sharing: { principals: [{ type: 'user', name: 'lead@example.com' }, { type: 'group', name: 'analysts' }] } };
  assert.deepEqual(w.withDecisionOwner(edited, 'other@example.com').sharing.principals, edited.sharing.principals);
  const cleared = { ...moved, sharing: { principals: [] } };
  assert.deepEqual(w.withDecisionOwner(cleared, 'other@example.com').sharing.principals, []);
  const group = { ...moved, sharing: { principals: [{ type: 'group', name: 'lead@example.com' }] } };
  assert.deepEqual(w.withDecisionOwner(group, 'other@example.com').sharing.principals, group.sharing.principals);
  assert.deepEqual(w.withDecisionOwner({ ...moved, sharing: { principals: [{ type: 'user', name: 'LEAD@example.com' }] } }, 'new@example.com')
    .sharing.principals, [{ type: 'user', name: 'new@example.com' }]);
  const kept = w.specFromLatest({ spec_version: 2, spec_json: { ...spec, sharing: { principals: [] } } }, spec);
  assert.deepEqual(kept.sharing.principals, []);
});

test('a cron is shown in plain words, and one it cannot read is called custom rather than guessed', async () => {
  const w = await load();
  const cases = [
    ['0 0 * * * ?', 'every hour, on the hour'],
    ['0 0 6 * * ?', 'every day at 06:00 Asia/Dubai'],
    ['0 0 6 ? * MON', 'every Monday at 06:00 Asia/Dubai'],
    ['0 0 6 1 * ?', 'on day 1 of every month at 06:00 Asia/Dubai'],
    ['0 0 6 1 1,4,7,10 ?', 'on day 1 of January, April, July and October at 06:00 Asia/Dubai'],
    ['0 0 6 1 1 ?', 'on day 1 of January at 06:00 Asia/Dubai'],
    ['0 30 18 ? * MON-FRI', 'every Monday to Friday at 18:30 Asia/Dubai'],
    ['0 0 6,18 ? * 2,4,6', 'every Monday, Wednesday and Friday at 06:00 and 18:00 Asia/Dubai'],
    ['0 15 7 L * ?', 'on the last day of every month at 07:15 Asia/Dubai'],
    ['0 0/15 * * * ?', 'every 15 minutes'],
    ['0 */1 * * * ?', 'every minute'],
    ['0 30 */6 * * ?', 'every 6 hours at minute 30'],
    ['0 0 6 * * ? 2027', 'a custom schedule (0 0 6 * * ? 2027)'],
    ['0 0 6 ? * 6L', 'a custom schedule (0 0 6 ? * 6L)'],
    ['0 0 6 ? 1 MON', 'a custom schedule (0 0 6 ? 1 MON)'],
    ['0 0 25 * * ?', 'a custom schedule (0 0 25 * * ?)'],
    ['30 0 6 * * ?', 'a custom schedule (30 0 6 * * ?)'],
    ['0 6 * * *', 'a custom schedule (0 6 * * *)'],
    ['', 'no schedule'],
  ];
  for (const [cron, words] of cases) assert.equal(w.cronInWords(cron, 'Asia/Dubai'), words, cron);
  assert.equal(w.cronInWords('0 0 6 * * ?', ''), 'every day at 06:00 UTC');
  const invalid = ['0 6 * * *', '0 0 25 * * ?'];
  for (const [cron] of cases.filter(([c]) => c)) {
    assert.equal(served({ schedule: { cron } }).errors.some((e) => e.includes('is not a valid Quartz cron')), invalid.includes(cron), cron);
    assert.equal(Boolean(w.cronProblem(cron)), invalid.includes(cron), cron);
  }
});

test('the wizard checks crons and widget values with the same rules and words as the backend and the agent', async () => {
  const w = await load();
  for (const cron of FIXTURE.crons.valid) assert.equal(w.cronProblem(cron), backend.cronProblem(cron), cron);
  for (const [cron, problem] of FIXTURE.crons.invalid) {
    assert.equal(w.cronProblem(cron), problem, cron);
    assert.equal(backend.cronProblem(cron), problem, cron);
  }
  for (const [text, rule, printed] of FIXTURE.widget_ranges.allowed) {
    assert.deepEqual(w.allowedRule(text), rule, text);
    if (rule) assert.equal(w.allowedText(rule), printed, text);
  }
  for (const [name, value, allowed, problem] of FIXTURE.widget_ranges.values) assert.equal(w.widgetValueProblem(name, value, allowed), problem, `${name}=${value}`);
  for (const item of FIXTURE.widget_ranges.problems) {
    assert.deepEqual(w.widgetProblems(item.widgets, item.values), item.problems, item.name);
    assert.deepEqual(backend.widgetProblems(item.widgets, item.values), item.problems, item.name);
  }
});

test('the wizard and the server check notebook widget values with one implementation, and refuse and accept the same values', async () => {
  const w = await load();
  const shared = await import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', 'useCaseSettings.js')).href);
  for (const name of ['allowedRule', 'allowedText', 'widgetValueProblem', 'widgetSetProblems', 'widgetProblems']) {
    assert.equal(backend[name], shared[name], `server ${name}`);
    assert.equal(w[name], shared[name], `wizard ${name}`);
  }
  const TOP_K = { name: 'top_k', allowed: 'whole number, at least 1', default: '10' };
  const SHARES = [{ name: 'act_now_share', allowed: '0 to 1', default: '0.2' }, { name: 'review_share', allowed: '0 to 1', default: '0.3' }];
  const SCOPE = { name: 'run_scope', allowed: 'a number', default: '5' };
  const cases = [
    [[TOP_K], { top_k: '3' }, []],
    [[TOP_K], { top_k: '0' }, ["top_k is '0'; allowed: whole number, at least 1"]],
    [[TOP_K], { top_k: '2.5' }, ["top_k is '2.5'; allowed: whole number, at least 1"]],
    [SHARES, { act_now_share: '0.5' }, []],
    [SHARES, { act_now_share: '0.8' }, ['act_now_share + review_share is 1.1; allowed: at most 1']],
    [[{ name: 'min_age', default: '1' }, { name: 'max_age', default: '9' }], { min_age: '10' }, ['min_age is 10, above max_age 9']],
    [[SCOPE], { run_scope: 'recent' }, []],
    [[SCOPE], { run_scope: '' }, []],
    [[SCOPE], { run_scope: '5' }, ["run_scope is '5'; allowed: all, groups, recent, records"]],
    [[], { run_scope: 'everything' }, ["run_scope is 'everything'; allowed: all, groups, recent, records"]],
  ];
  for (const [widgets, values, problems] of cases) {
    assert.deepEqual(w.widgetProblems(widgets, values), problems, `wizard ${JSON.stringify(values)}`);
    assert.deepEqual(backend.widgetProblems(widgets, values), problems, `server ${JSON.stringify(values)}`);
  }
});

test('Next is blocked on a bad cron, an out-of-range widget or profile value, and never on a field the step does not show', async () => {
  const w = await load();
  const spec = w.defaultSpecFromUseCase(UC, { warehouseId: 'wh1', inspireDatabase: 'main.inspire', owner: 'amr@example.com' });
  const widgets = [{ name: 'act_now_share', default: '0.05', allowed: '0 to 1' }, { name: 'review_share', default: '0.2', allowed: '0 to 1' }, { name: 'note', default: '', allowed: '' }];
  assert.deepEqual(w.sectionErrors('configure', spec, { widgets }), []);
  const bad = JSON.parse(JSON.stringify(spec));
  bad.config.widgets = { act_now_share: '1.2', note: 'anything' };
  bad.config.profiles.training.window_days = '30.5';
  bad.config.profiles.retrain.drift_threshold = '2';
  assert.deepEqual(w.sectionErrors('configure', bad, { widgets }), ["training window days is '30.5'; allowed: whole number, at least 1"],
    'the Data step checks only the widgets it shows; the settings are checked on the Settings step');
  assert.deepEqual(w.sectionErrors('configure', bad, { widgets, trainsModel: false }), []);
  const S = await import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', 'useCaseSettings.js')).href);
  assert.deepEqual(w.sectionErrors('settings', bad, { settings: S.wizardSettings({ widgets, spec: bad, editing: true }) }), [
    "act_now_share is '1.2'; allowed: 0 to 1",
    'act_now_share + review_share is 1.4; allowed: at most 1',
  ]);
  bad.schedule.cron = '0 0 25 * * ?';
  assert.deepEqual(w.sectionErrors('schedule', bad), [
    "the cron is not valid: the hour value '25' is not 0 to 23",
    "retrain drift threshold is '2'; allowed: above 0, at most 1",
  ]);
  assert.deepEqual(w.sectionErrors('schedule', bad, { trainsModel: false }), ["the cron is not valid: the hour value '25' is not 0 to 23"]);
  assert.deepEqual(w.sectionErrors('schedule', spec), []);
  for (const drift of ['0', '0.0', '-0.1', 'abc']) {
    assert.equal(w.profileFieldProblem('retrain.drift_threshold', drift), `retrain drift threshold is '${drift}'; allowed: above 0, at most 1`, drift);
  }
  for (const drift of ['0.2', ' 1 ', '', null]) assert.equal(w.profileFieldProblem('retrain.drift_threshold', drift), '', String(drift));
  assert.equal(w.profileFieldProblem('training.window_days', ' 30 '), '');
  assert.equal(w.profileFieldProblem('training.window_days', '0'), "training window days is '0'; allowed: whole number, at least 1");
});

test('every profile value Next accepts is one the server accepts', async () => {
  const w = await load();
  const { validateImplementSpec } = backend;
  const spec = w.defaultSpecFromUseCase(UC, { warehouseId: 'wh1', inspireDatabase: 'main.inspire' });
  for (const [path, values] of [['retrain.drift_threshold', ['0', '0.0', '0.5', '1', '1.5', '-1', 'abc', '.5']],
    ['training.window_days', ['0', '1', '30', '2.5', '-3', 'x', '1e3']], ['preview.entity_cap', ['1', '0', '7.0']]]) {
    for (const value of values) {
      const [section, field] = path.split('.');
      const candidate = JSON.parse(JSON.stringify(spec));
      candidate.config.profiles[section][field] = value;
      const serverErrors = validateImplementSpec(candidate).errors.filter((e) => e.includes(field));
      if (!w.profileFieldProblem(path, value)) assert.deepEqual(serverErrors, [], `${path}=${value} passes Next but not the server`);
      else assert.ok(serverErrors.length || value === '.5', `${path}=${value} is blocked at Next for no server reason`);
    }
  }
});

test('the run count and cost hint follow the cron', async () => {
  const w = await load();
  const near = (cron, expected) => assert.ok(Math.abs(w.cronRunsPerMonth(cron) - expected) < 0.01, `${cron}: ${w.cronRunsPerMonth(cron)}`);
  near('0 0 6 * * ?', 30.44);
  near('0 0 6 ? * MON-FRI', 5 * 30.44 / 7);
  near('0 0 6 ? * MON', 30.44 / 7);
  near('0 0/15 * * * ?', 4 * 24 * 30.44);
  near('0 0 6,18 * * ?', 2 * 30.44);
  near('0 0 22-2 * * ?', 5 * 30.44);
  near('0 0 6 1 * ?', 1);
  near('0 0 6 1 1,4,7,10 ?', 4 / 12);
  near('0 15 7 L * ?', 1);
  near('0 0 6 ? * MON#2', 1);
  near('0 0 6 ? * 6L', 1);
  near('0 0 6 ? JAN-MAR MON-FRI', (5 * 30.44 / 7) * (3 / 12));
  assert.equal(w.cronRunsPerMonth('0 0 25 * * ?'), null);
  assert.equal(w.cronRunsPerMonth(''), null);
  const spec = w.defaultSpecFromUseCase(UC, { warehouseId: 'wh1', inspireDatabase: 'main.inspire' });
  const on = (cron, extra = {}) => ({ ...spec, schedule: { ...spec.schedule, enabled: true, cron, timezone: 'Asia/Dubai' }, outputs: { ...spec.outputs, ...extra } });
  assert.equal(w.costHint({ ...spec, schedule: { ...spec.schedule, enabled: false } }), 'one preview run now; no scheduled runs until you turn the schedule on.');
  assert.equal(w.costHint(on('0 0 6 * * ?')), 'one preview run now, then about 30 full serverless runs a month (every day at 06:00 Asia/Dubai).');
  assert.equal(w.costHint(on('0 0 6 1 1,4,7,10 ?', { alert: true })),
    'one preview run now, then about 0.3 full serverless runs a month (on day 1 of January, April, July and October at 06:00 Asia/Dubai), plus one alert check after each full run.');
  assert.equal(w.costHint(on('0 0 6 * * ? 2027')), 'one preview run now, then about 30 full serverless runs a month (a custom schedule (0 0 6 * * ? 2027)), only in 2027.');
  assert.equal(w.costHint(on('0 0 25 * * ?')), "one preview run now; the schedule's run count is unknown until its cron is valid.");
});

test('profile estimates come from the discovery evidence in either mode, and say unknown when there is none', async () => {
  const w = await load();
  const evidence = { tables: { 'main.s.orders': { rows: 3650, sampled: false, date_ranges: { order_date: { min: '2024-01-01', max: '2024-12-31' } } },
    'main.s.events': { rows: 500, sampled: true, date_ranges: {} } } };
  const base = { evidence, table: 'main.s.orders', dateColumn: 'order_date', dataWindow: {} };
  assert.equal(w.profileEstimate({ ...base, discoveryType: 'Standard Discovery' }).rows, 3650, 'Standard Discovery counts rows too');
  assert.deepEqual(w.profileEstimate({ ...base, evidence: null }), { rows: null, text: 'unknown: discovery read no rows' });
  assert.equal(w.profileEstimate({ ...base, table: 'main.s.orders_v2' }).text, 'unknown: discovery has no row count for main.s.orders_v2');
  assert.deepEqual(w.profileEstimate(base), { rows: 3650, text: 'about 3,650 rows of main.s.orders (366 of 366 days of order_date)' });
  assert.equal(w.profileEstimate({ ...base, windowDays: '30' }).rows, Math.round(3650 * 30 / 366));
  const windowed = w.profileEstimate({ ...base, dataWindow: { start: '2024-07-01', end: '2024-07-31' }, windowDays: '90' });
  assert.deepEqual(windowed, { rows: Math.round(3650 * 31 / 366), text: `about ${Math.round(3650 * 31 / 366)} rows of main.s.orders (31 of 366 days of order_date)` });
  assert.equal(w.profileEstimate({ ...base, table: 'MAIN.S.ORDERS', sampleEntities: '200', entityCap: '50' }).text,
    'about 3,650 rows of MAIN.S.ORDERS (366 of 366 days of order_date; then a sample of 200 entities; capped at 50 entities)');
  assert.equal(w.profileEstimate({ ...base, table: 'main.s.events', windowDays: '30' }).text,
    'at most 500 rows of main.s.events (no date range was profiled, so this is the whole table)');
  assert.equal(w.profileEstimate({ ...base, table: 'main.s.events', dateColumn: '', windowDays: '30' }).text,
    "at most 500 rows of main.s.events (no event date column is set here, so this is the whole table; the MVP applies the "
    + "window to the instruction's date)");
});

test('every permission check the preflight can return has a label', async () => {
  const w = await load();
  for (const key of ['warehouse', 'output', 'result_grant', 'app_name', 'apps', 'genie_spaces', 'alerts']) assert.ok(w.PREFLIGHT_LABELS[key], key);
  assert.deepEqual(Object.keys(w.PROFILE_FIELDS).sort(), ['full_load.window_days', 'preview.entity_cap', 'retrain.drift_threshold',
    'retrain.every_runs', 'training.sample_entities', 'training.window_days']);
});

test('the Implement page shows lost tables from a refused re-run first, else only from a failed latest version that recorded them', async () => {
  const w = await load();
  const lost = [{ table: 'main.s.returns', reason: 'not found' }];
  const failed = { status: 'failed', spec_version: 4, asset_status: { data: { state: 'failed', spec_version: 4, missing_tables: lost } } };
  assert.deepEqual(w.lostTables(failed, null), lost);
  assert.deepEqual(w.lostTables({ status: 'ready' }, { missing_tables: lost }), lost);
  assert.deepEqual(w.lostTables({ ...failed, status: 'ready' }, null), []);
  assert.deepEqual(w.lostTables({ ...failed, spec_version: 5 }, null), [], 'an entry from an older version is not this version\'s problem');
  assert.deepEqual(w.lostTables({ ...failed, asset_status: { data: { ...failed.asset_status.data, state: 'ready' } } }, null), []);
  assert.deepEqual(w.lostTables({ ...failed, asset_status: { data: { state: 'failed', spec_version: 4, missing_tables: 'x' } } }, null), []);
  assert.deepEqual(w.lostTables(null, { missing_tables: [] }), []);
  assert.deepEqual(w.lostTables(undefined, undefined), []);
  assert.equal(w.lostTablesText(lost), 'These source tables are missing or not readable: main.s.returns (not found). '
    + 'Swap each for a table with the same role or remove it.');
  assert.equal(w.lostTablesText([{ table: 'main.s.pax', reason: 'not found', primary: true }]),
    'These source tables are missing or not readable: main.s.pax (the primary table, not found). '
    + 'Swap main.s.pax for a table with the same role, because the primary table can be swapped, not removed.');
  assert.equal(w.lostTablesText([{ table: 'main.s.pax', reason: 'not found', primary: true }, ...lost]),
    'These source tables are missing or not readable: main.s.pax (the primary table, not found), main.s.returns (not found). '
    + 'Swap main.s.pax for a table with the same role, because the primary table can be swapped, not removed, and swap or remove the others.');
  assert.equal(w.lostTablesText([]), '');
  assert.equal(w.lostTablesText(undefined), '');
});

test('the business Hub App is inspire-hub- and the business name, at most 30 characters, and a fresh App of a known business takes that name', async () => {
  const w = await load();
  assert.equal(w.hubAppName('TPCDS Retail V130 Ship'), 'inspire-hub-tpcds-retail-v130');
  assert.equal(w.hubAppName('Acme'), 'inspire-hub-acme');
  assert.equal(w.hubAppName('  Société Générale & Co  '), 'inspire-hub-societe-generale');
  assert.equal(w.hubAppName('Supercalifragilisticexpialidocious'), 'inspire-hub-supercalifragilist');
  assert.equal(w.hubAppName('A'), 'inspire-hub-a');
  assert.equal(w.hubAppName(''), '');
  assert.equal(w.hubAppName('&&&'), '');
  assert.equal(w.hubAppName(undefined), '');
  for (const biz of ['TPCDS Retail V130 Ship', 'Acme', 'Supercalifragilisticexpialidocious', 'x'.repeat(80), 'a-b-c-d-e-f-g-h-i-j-k-l-m-n-o-p']) {
    const name = w.hubAppName(biz);
    assert.ok(w.APP_NAME_RE.test(name) && name.length <= 30 && name.startsWith('inspire-hub-'), `${biz}: ${name}`);
  }
  assert.equal(w.defaultSpecFromUseCase(UC, { businessName: 'Acme' }).outputs.app_name, 'inspire-hub-acme');
  assert.equal(w.defaultSpecFromUseCase(UC).outputs.app_name, 'predict-churn', 'with no business name the App keeps the use case name');
  assert.equal(w.defaultSpecFromUseCase(UC, { businessName: '***' }).outputs.app_name, 'predict-churn');
});

test('a domain App is inspire-, the business and the domain, at most 30 characters, with the domain kept to 15', async () => {
  const w = await load();
  assert.equal(w.domainAppName('Acme', 'Customer'), 'inspire-acme-customer');
  assert.equal(w.domainAppName('TPCDS Retail V130 Ship', 'Merchandising and Pricing'), 'inspire-tpcds-merchandising');
  assert.equal(w.domainAppName('', 'Finance'), 'inspire-finance');
  assert.equal(w.domainAppName('Acme', ''), '', 'no domain, no domain App');
  assert.equal(w.domainAppName('Acme', '&&&'), '');
  assert.equal(w.domainAppName(undefined, undefined), '');
  for (const [biz, domain] of [['Supercalifragilisticexpialidocious', 'Operations'], ['x'.repeat(80), 'y'.repeat(80)], ['Société Générale', 'Risk & Compliance']]) {
    const name = w.domainAppName(biz, domain);
    assert.ok(w.APP_NAME_RE.test(name) && name.length <= 30 && name.startsWith('inspire-'), `${biz}/${domain}: ${name}`);
  }
  const uc = { ...UC, business_domain: 'Customer' };
  const spec = w.defaultSpecFromUseCase(uc, { businessName: 'Acme' });
  assert.deepEqual([spec.outputs.app_placement, spec.outputs.app_name], ['domain', 'inspire-acme-customer'], 'a new use case defaults to its domain App');
  assert.equal(w.defaultSpecFromUseCase(UC, { businessName: 'Acme' }).outputs.app_name, 'inspire-hub-acme', 'a use case with no domain takes the business App');
  assert.equal(w.domainOf({ _domain: ' Finance ' }), 'Finance');
  assert.equal(w.domainOf({ 'Business Domain': 'Risk' }), 'Risk');
  assert.equal(w.domainOf(null), '');
  assert.equal(w.caseAppNameOf(UC), 'predict-churn');
});

const ACME = { business: 'Acme', domain: 'Customer' };
const holder = (use_case_id, business, domain, extra = {}) => ({ session_id: '42', use_case_id, name: use_case_id, business, domain, placement: 'domain', updated_at: '2026-10-20T00:00:00Z', ...extra });
const appTarget = (id, useCases, extra = {}) => ({ id, name: id, access: 'sp', per_user_block: `${id} shows everyone the same rows`, use_cases: useCases, ...extra });

test('an App fits only when it holds this business and domain, flags other domains, and does not fit another business or an unknown one', async () => {
  const w = await load();
  const fit = (target, placement = 'domain', scope = ACME) => w.appPlacementFit(target, { ...scope, placement });
  assert.deepEqual(fit(appTarget('a', [holder('N01-U01', 'Acme', 'Customer')])), { fit: 'recommended', reason: '' });
  assert.equal(fit(appTarget('a', [holder('N01-U01', ' acme ', 'CUSTOMER ')])).fit, 'recommended', 'names match without case or spaces');
  assert.deepEqual(fit(appTarget('a', [holder('N01-U01', 'Acme', 'Customer'), holder('N02-U01', 'Acme', 'Finance'), holder('N03-U01', 'Acme', 'Risk')])),
    { fit: 'other_domains', reason: 'People who open it for Customer also see its Finance and Risk use cases.' });
  assert.deepEqual(fit(appTarget('a', [holder('N02-U01', 'Acme', 'Finance')])), { fit: 'not_recommended',
    reason: "It holds only Finance use cases, not Customer, so the people who use it could see another domain's data or use cases unrelated to their work." });
  assert.equal(fit(appTarget('a', [holder('N02-U01', 'Acme', 'Finance')]), 'business').fit, 'recommended', 'one App for all use cases takes every domain of the business');
  assert.deepEqual(fit(appTarget('a', [holder('N01-U01', 'Acme', 'Customer'), holder('N09-U01', 'Globex', 'Customer')]), 'business'), { fit: 'not_recommended',
    reason: "It holds use cases of Globex, another business, so the people who use it could see that business's data." });
  assert.equal(fit(appTarget('a', [holder('N09-U01', '', 'Customer')])).reason,
    "It holds use cases of an unnamed business, another business, so the people who use it could see that business's data.");
  const unknown = { fit: 'not_recommended', reason: 'Inspire cannot tell which business and domain its use cases belong to, so it cannot tell who should use it.' };
  assert.deepEqual(fit(appTarget('a', [holder('N01-U01', null, null)])), unknown, 'a use case Inspire cannot place is never Recommended');
  assert.deepEqual(fit(appTarget('a', [holder('N01-U01', 'Acme', 'Customer'), holder('N01-U02', 'Acme', null)])), unknown);
  assert.deepEqual(fit(appTarget('a', [])), unknown);
  assert.deepEqual(fit(null), unknown);
  assert.equal(fit(appTarget('a', [holder('N01-U01', 'Acme', '')]), 'domain', { business: 'Acme', domain: '' }).fit, 'recommended');
  assert.equal(fit(appTarget('a', [holder('N01-U01', 'Acme', 'Customer')]), 'domain', { business: 'Acme', domain: '' }).fit, 'not_recommended');
});

test('the Apps to join list Recommended first, then Apps with other domains, then Not recommended, and say which ones a per-user use case cannot join', async () => {
  const w = await load();
  const other = appTarget('inspire-acme-finance', [holder('N02-U01', 'Acme', 'Finance')]);
  const mixed = appTarget('ops-desk', [holder('N01-U03', 'Acme', 'Customer'), holder('N02-U02', 'Acme', 'Finance')]);
  const same = appTarget('inspire-acme-customer', [holder('N01-U02', 'Acme', 'Customer')]);
  const fresh = w.withOutput(w.defaultSpecFromUseCase({ ...UC, business_domain: 'Customer' }, { businessName: 'Acme' }), 'app', true);
  assert.equal(w.appPlacementChoices(fresh, { app: [same] }, ACME)[0].block, 'inspire-acme-customer shows everyone the same rows',
    'a new use case signs each viewer in, so it cannot join a shared App until someone picks that everyone sees the same rows (must-exclude)');
  const spec = w.withAppAccess(fresh, 'sp');
  const choices = w.appPlacementChoices(spec, { app: [other, mixed, same] }, ACME);
  assert.deepEqual(choices.map((c) => [c.target.id, c.fit, c.block]), [['inspire-acme-customer', 'recommended', ''], ['ops-desk', 'other_domains', ''], ['inspire-acme-finance', 'not_recommended', '']]);
  const perUser = w.appPlacementChoices(w.withAppAccess(spec, 'user'), { app: [same] }, ACME);
  assert.equal(perUser[0].block, 'inspire-acme-customer shows everyone the same rows');
  assert.deepEqual(w.appPlacementChoices(spec, null, ACME), []);
  assert.deepEqual(w.appPlacementChoices(spec, { app: [] }, ACME), []);
});

test('the wizard remembers the last App placement of the business, and says so, but never one of another business', async () => {
  const w = await load();
  const targets = { app: [
    appTarget('a', [holder('N01-U01', 'Acme', 'Customer', { placement: 'domain', updated_at: '2026-10-20T00:00:00Z' })]),
    appTarget('b', [holder('N01-U02', 'acme', 'Finance', { placement: 'use_case', updated_at: '2026-10-22T00:00:00Z' }),
      holder('N01-U03', 'Acme', 'Finance', { placement: '', updated_at: '2026-10-29T00:00:00Z' })]),
    appTarget('c', [holder('N09-U01', 'Globex', 'Customer', { placement: 'business', updated_at: '2026-10-30T00:00:00Z' })]),
  ] };
  assert.equal(w.rememberedPlacement(targets, 'Acme'), 'use_case', 'the newest placement of this business wins; a use case with none is skipped');
  assert.equal(w.placementMemoryText(targets, 'Acme'), 'Last time for Acme: One App per use case.');
  assert.equal(w.rememberedPlacement(targets, 'Globex'), 'business');
  assert.equal(w.rememberedPlacement(targets, 'Initech'), 'domain', 'a business with no App yet gets one App per business domain');
  assert.equal(w.placementMemoryText(targets, 'Initech'), '');
  assert.equal(w.rememberedPlacement(targets, ''), 'domain', 'an unnamed business remembers nothing');
  assert.equal(w.placementMemoryText(null, 'Acme'), '');
  assert.equal(w.rememberedPlacement(undefined, 'Acme'), w.APP_PLACEMENT_DEFAULT);
  assert.deepEqual(w.APP_PLACEMENTS.map((p) => [p.id, p.label]),
    [['domain', 'One App per business domain'], ['use_case', 'One App per use case'], ['business', 'One App for all use cases'], ['inspire', 'Inside Inspire']]);
  const inside = { app: [appTarget('d', [holder('N01-U04', 'Acme', 'Customer', { placement: 'inspire', updated_at: '2026-10-31T00:00:00Z' })])] };
  assert.equal(w.placementMemoryText(inside, 'Acme'), 'Last time for Acme: Inside Inspire.', 'a remembered placement is named by its label');
});

test('the new App name follows the placement and never takes the name of an App Inspire already built', async () => {
  const w = await load();
  const scope = { ...ACME, useCaseAppName: 'predict-churn' };
  assert.equal(w.placementAppName('use_case', scope), 'predict-churn');
  assert.equal(w.placementAppName('business', scope), 'inspire-hub-acme');
  assert.equal(w.placementAppName('domain', scope), 'inspire-acme-customer');
  assert.equal(w.placementAppName('domain', { ...scope, domain: '' }), 'inspire-hub-acme', 'with no domain the domain App is the business App');
  assert.equal(w.placementAppName('business', { ...scope, business: '' }), 'predict-churn');
  assert.equal(w.placementAppName('domain', scope, { app: [{ id: 'inspire-acme-customer' }] }), 'inspire-acme-customer-2');
  assert.equal(w.placementAppName('domain', scope, { app: [{ id: 'inspire-acme-customer' }, { id: 'inspire-acme-customer-2' }] }), 'inspire-acme-customer-3');
  assert.equal(w.placementAppName('use_case', { ...scope, useCaseAppName: '' }), '');
});

test('a placement joins the App of that placement when it fits, else creates one, and never joins an App another use case made for itself', async () => {
  const w = await load();
  const uc = { ...UC, business_domain: 'Customer' };
  const spec = w.withAppAccess(w.withOutput(w.defaultSpecFromUseCase(uc, { businessName: 'Acme' }), 'app', true), 'sp');
  const scope = { ...ACME, useCaseAppName: 'predict-churn' };
  const domainApp = appTarget('inspire-acme-customer', [holder('N01-U02', 'Acme', 'Customer')], { look: { palette: 'ocean' } });
  const hub = appTarget('inspire-hub-acme', [holder('N02-U01', 'Acme', 'Finance', { placement: 'business' })]);
  const ownApp = appTarget('score-suppliers', [holder('N01-U03', 'Acme', 'Customer', { placement: 'use_case' })]);
  const joined = w.withAppPlacement(spec, 'domain', { app: [domainApp, hub] }, scope);
  assert.deepEqual([joined.outputs.app_placement, joined.outputs.merge.app, joined.outputs.app_name, joined.outputs.app_look.palette],
    ['domain', 'inspire-acme-customer', 'inspire-acme-customer', 'ocean']);
  const business = w.withAppPlacement(spec, 'business', { app: [domainApp, hub] }, scope);
  assert.deepEqual([business.outputs.merge.app, business.outputs.app_name], ['inspire-hub-acme', 'inspire-hub-acme']);
  const own = w.withAppPlacement(spec, 'domain', { app: [ownApp] }, scope);
  assert.deepEqual([own.outputs.merge?.app || '', own.outputs.app_name], ['', 'inspire-acme-customer'], 'an App placed per use case is not taken over');
  const placedByDomain = appTarget('customer-desk', [holder('N01-U04', 'Acme', 'Customer', { placement: 'domain' })]);
  assert.equal(w.withAppPlacement(spec, 'domain', { app: [ownApp, placedByDomain] }, scope).outputs.merge.app, 'customer-desk',
    'an App whose use cases chose one App per domain is that domain App, whatever its name');
  const before = { placement: '' };
  const older = appTarget('n01-u02-retention', [holder('N01-U02', 'Acme', 'Customer', before)]);
  const olderPair = appTarget('customer-pair', [holder('N01-U06', 'Acme', 'Customer', before), holder('N01-U07', 'Acme', 'Customer', before)]);
  const olderFinance = appTarget('n02-u04-cash', [holder('N02-U04', 'Acme', 'Finance', before)]);
  assert.equal(w.withAppPlacement(spec, 'domain', { app: [olderFinance, older] }, scope).outputs.merge.app, 'n01-u02-retention',
    'an App built before App placement that holds only this domain is that domain App, whatever its name');
  assert.equal(w.withAppPlacement(spec, 'domain', { app: [older, olderPair] }, scope).outputs.merge.app, 'customer-pair',
    'of two such Apps, the one holding more use cases of this domain is joined');
  assert.equal(w.withAppPlacement(spec, 'domain', { app: [ownApp, older] }, scope).outputs.merge.app, 'n01-u02-retention');
  const mixedOlder = appTarget('mixed-desk', [holder('N01-U08', 'Acme', 'Customer', before), holder('N01-U09', 'Acme', 'Customer', { placement: 'use_case' })]);
  assert.deepEqual([w.withAppPlacement(spec, 'domain', { app: [mixedOlder, olderFinance] }, scope).outputs.merge?.app || '',
    w.withAppPlacement(spec, 'domain', { app: [mixedOlder, olderFinance] }, scope).outputs.app_name], ['', 'inspire-acme-customer'],
    'an App one of its use cases made for itself, or one of another domain, is never joined');
  assert.deepEqual([w.withAppPlacement(spec, 'business', { app: [older] }, scope).outputs.merge?.app || '', w.withAppPlacement(spec, 'business', { app: [older] }, scope).outputs.app_name],
    ['', 'inspire-hub-acme'], 'one App for the business joins only its Hub, never an older App of one domain');
  const perCase = w.withAppPlacement(spec, 'use_case', { app: [domainApp, hub] }, scope);
  assert.deepEqual([perCase.outputs.merge?.app || '', perCase.outputs.app_name], ['', 'predict-churn'], 'one App per use case never joins');
  const blocked = w.withAppPlacement(w.withAppAccess(spec, 'user'), 'domain', { app: [domainApp] }, scope);
  assert.deepEqual([blocked.outputs.merge?.app || '', blocked.outputs.app_name], ['', 'inspire-acme-customer-2'], 'a per-user use case gets its own domain App');
  const mixedHub = appTarget('inspire-hub-acme', [holder('N02-U01', 'Acme', 'Finance'), holder('N09-U01', 'Globex', 'Finance')]);
  assert.equal(w.withAppPlacement(spec, 'business', { app: [mixedHub] }, scope).outputs.app_name, 'inspire-hub-acme-2', 'a Hub holding another business is not joined');
  const fresh = w.withNewApp(joined, 'domain', { app: [domainApp] }, scope);
  assert.deepEqual([fresh.outputs.merge.app, fresh.outputs.app_name, fresh.outputs.app_placement], ['', 'inspire-acme-customer-2', 'domain'], 'Create new leaves the App it had joined');
  const renamed = w.withNewApp(spec, 'use_case', null, { ...scope, useCaseAppName: '' });
  assert.equal(renamed.outputs.app_name, spec.outputs.app_name, 'with no name to give, the App keeps its name');
});

test('the App placement default keeps a rebuild where it is, takes the remembered placement, and does nothing without an App', async () => {
  const w = await load();
  const uc = { ...UC, business_domain: 'Customer' };
  const perUser = w.withOutput(w.defaultSpecFromUseCase(uc, { businessName: 'Acme' }), 'app', true);
  const spec = w.withAppAccess(perUser, 'sp');
  const scope = { ...ACME, useCaseAppName: 'predict-churn' };
  const domainApp = appTarget('inspire-acme-customer', [holder('N01-U02', 'Acme', 'Customer')]);
  assert.equal(w.withPlacementDefault(perUser, { app: [domainApp] }, scope).outputs.merge?.app || '', '',
    'a new per-user use case does not join a shared domain App (must-exclude)');
  const remembered = appTarget('other-desk', [holder('N01-U05', 'Acme', 'Finance', { placement: 'use_case', updated_at: '2026-10-29T00:00:00Z' })]);
  assert.equal(w.withPlacementDefault(spec, { app: [domainApp] }, scope).outputs.merge.app, 'inspire-acme-customer', 'a new use case joins its domain App');
  const asked = w.withPlacementDefault(spec, { app: [domainApp, remembered] }, scope);
  assert.deepEqual([asked.outputs.app_placement, asked.outputs.merge?.app || '', asked.outputs.app_name], ['use_case', '', 'predict-churn'], 'the business last chose one App per use case');
  const saved = w.withPlacementDefault(spec, { app: [domainApp] }, { ...scope, saved: 'business', savedApp: true });
  assert.deepEqual([saved.outputs.app_placement, saved.outputs.merge?.app || '', saved.outputs.app_name], ['business', '', spec.outputs.app_name], 'a rebuild keeps its own placement and App');
  const typed = w.withPlacementDefault({ ...spec, outputs: { ...spec.outputs, app_name: 'my-churn' } }, { app: [domainApp] }, { ...scope, saved: 'domain', savedApp: true });
  assert.deepEqual([typed.outputs.merge?.app || '', typed.outputs.app_name], ['', 'my-churn'], 'a failed build keeps the App name the person typed');
  const later = w.withPlacementDefault(spec, { app: [domainApp] }, { ...scope, saved: 'domain' });
  assert.equal(later.outputs.merge.app, 'inspire-acme-customer', 'an App ticked on only now joins its domain App');
  const legacy = w.withPlacementDefault(spec, { app: [domainApp, remembered] }, { ...scope, savedApp: true });
  assert.deepEqual([legacy.outputs.app_placement, legacy.outputs.merge?.app || '', legacy.outputs.app_name], ['domain', '', spec.outputs.app_name],
    'a version with no placement keeps its App and records the placement its App is, never the business\'s last choice');
  const held = w.withPlacementDefault(spec, { app: [domainApp] }, { ...scope, held: { app: 'predict-churn' } });
  assert.deepEqual([held.outputs.app_placement, held.outputs.merge?.app || '', held.outputs.app_name], ['use_case', '', spec.outputs.app_name],
    'a use case with its own App keeps it, and its App is one of its own');
  const picked = w.withMergeTarget(spec, 'app', remembered);
  assert.equal(w.withPlacementDefault(picked, { app: [domainApp] }, scope).outputs.merge.app, 'other-desk', 'a choice already made stays');
  const off = w.withOutput(spec, 'app', false);
  assert.equal(w.withPlacementDefault(off, { app: [domainApp] }, scope), off);
  assert.equal(w.withPlacementDefault(spec, null, scope).outputs.app_name, 'inspire-acme-customer');
});

test('an output that no longer exists is not held, so the use case can join its domain App, and the wizard says which one is gone', async () => {
  const w = await load();
  assert.deepEqual(w.heldAssets({ dashboard: 'd1', genie_space: 'g1', app: 'old-desk', alert: 'a1' }, ['app', 'dashboard']), { genie_space: 'g1', alert: 'a1' });
  assert.deepEqual(w.heldAssets({ app: 'old-desk' }, undefined), { app: 'old-desk' });
  assert.deepEqual(w.heldAssets(undefined, ['app']), {});
  assert.equal(w.goneAssetText('App', 'old-desk'), 'The App this use case had, old-desk, no longer exists, so Genie can add the use case to one Inspire built or create a new one.');
  const uc = { ...UC, business_domain: 'Customer' };
  const spec = w.withAppAccess(w.withOutput(w.defaultSpecFromUseCase(uc, { businessName: 'Acme' }), 'app', true), 'sp');
  const targets = { app: [appTarget('inspire-acme-customer', [holder('N01-U02', 'Acme', 'Customer')])] };
  const assets = { app: 'old-desk' };
  assert.equal(w.withPlacementDefault(spec, targets, { ...ACME, held: w.heldAssets(assets, []) }).outputs.merge?.app || '', '', 'a live App of its own stays');
  assert.equal(w.withPlacementDefault(spec, targets, { ...ACME, held: w.heldAssets(assets, ['app']) }).outputs.merge.app, 'inspire-acme-customer', 'a gone App of its own lets it join');
  const gone = w.withPlacementDefault(spec, targets, { ...ACME, held: w.heldAssets(assets, ['app']), saved: 'domain', savedApp: false });
  assert.equal(gone.outputs.merge.app, 'inspire-acme-customer', 'a saved placement still finds a new home for a gone App');
  const own = w.withPlacementDefault(spec, targets, { ...ACME, held: w.heldAssets(assets, ['app']), saved: 'use_case', savedApp: false });
  assert.deepEqual([own.outputs.merge?.app || '', own.outputs.app_placement], ['', 'use_case'], 'one App per use case makes a new App for it');
});

test('Deliver checks the App placement, the App name and the App it joins', async () => {
  const w = await load();
  const spec = w.withOutput(w.defaultSpecFromUseCase({ ...UC, business_domain: 'Customer' }, { businessName: 'Acme', warehouseId: 'w' }), 'app', true);
  assert.deepEqual(w.sectionErrors('app_place', spec), []);
  assert.deepEqual(w.sectionErrors('app_place', { ...spec, outputs: { ...spec.outputs, app_placement: 'team' } }), ['choose how Inspire organizes Apps']);
  assert.ok(w.stepErrors('where', { ...spec, outputs: { ...spec.outputs, app_placement: 'team' } }).includes('choose how Inspire organizes Apps'));
  assert.deepEqual(w.stepErrors('delivery', { ...spec, outputs: { ...spec.outputs, app_placement: 'team' } }), [], 'What to deliver does not check the placement');
  assert.deepEqual(w.stepErrors('app', { ...spec, outputs: { ...spec.outputs, app_placement: 'team' } }), [], 'and Who uses the App does not (must-exclude)');
  assert.ok(w.stepErrors('where', { ...spec, outputs: { ...spec.outputs, app_name: 'X' } }).includes('app name must be 3-30 lowercase letters, digits and dashes'));
  const target = appTarget('inspire-acme-customer', [holder('N01-U02', 'Acme', 'Customer')]);
  const perUser = w.withMergeTarget(w.withAppAccess(spec, 'user'), 'app', target);
  assert.ok(w.stepErrors('where', perUser, { mergeTargets: { app: [target] } }).includes('inspire-acme-customer shows everyone the same rows'));
  assert.equal(w.APP_NEXT_NOTE, 'You pick where it goes on the next step.');
  assert.throws(() => w.stepErrors('app', w.withOutput(spec, 'app', false)), /unknown wizard step 'app'/, 'without an App there is no App step');
});

test('a rebuild that inherits a swap to a gone table goes back to the use case\'s own table, clears what pointed at the gone one, and says so', async () => {
  const w = await load();
  const uc = { primary_table: 'main.s.orders', tables_involved: 'main.s.orders,main.s.returns,main.s.items' };
  const spec = w.defaultSpecFromUseCase({ ...UC, ...uc });
  const inherited = { ...spec, data: { ...spec.data,
    tables: { 'MAIN.S.RETURNS': 'main.s.returns_old', 'main.s.items': 'main.s.items_v2', 'main.s.orders': 'main.s.orders_v9' },
    column_roles: { event_date: 'main.s.returns_old.returned_on', segment: 'main.s.items_v2.category' },
    filters: [{ table: 'main.s.returns_old', column: 'reason', op: 'in', values: ['damaged'] }, { table: 'main.s.items_v2', column: 'kind', op: 'in', values: ['a'] }] } };
  const lost = [{ table: 'main.s.returns_old', reason: 'not found' }, { table: 'main.s.orders_v9', reason: 'not found' }, { table: 'main.s.orders', reason: 'no read access' }];
  const { spec: next, reverted } = w.revertLostSwaps(inherited, uc, lost);
  assert.deepEqual(next.data.tables, { 'main.s.items': 'main.s.items_v2', 'main.s.orders': 'main.s.orders_v9' },
    'the gone swap goes back; a live swap stays; a gone swap whose own table is gone too stays for the person to fix');
  assert.deepEqual(next.data.column_roles, { segment: 'main.s.items_v2.category' });
  assert.deepEqual(next.data.filters, [{ table: 'main.s.items_v2', column: 'kind', op: 'in', values: ['a'] }]);
  assert.deepEqual(next.data.removed_tables, []);
  assert.deepEqual(reverted, [{ original: 'main.s.returns', chosen: 'main.s.returns_old', reason: 'not found', cleared: { roles: ['event_date'], filters: 1 } }]);
  assert.equal(w.revertedSwapsText(reverted), 'main.s.returns_old is missing or not readable (not found), so this version goes back to main.s.returns, '
    + 'the table Inspire picked, and clears its column roles (event date) and 1 filter on it. Use Change to pick another table.');
  assert.equal(w.revertedSwapsText([{ original: 'a.b.c', chosen: 'a.b.d', reason: 'no read access', cleared: { roles: [], filters: 0 } }]),
    'a.b.d is missing or not readable (no read access), so this version goes back to a.b.c, the table Inspire picked. Use Change to pick another table.');
  assert.equal(w.revertedSwapsText([]), '');
  const removedToo = { ...inherited, data: { ...inherited.data, removed_tables: ['main.s.returns'] } };
  assert.deepEqual(w.revertLostSwaps(removedToo, uc, lost).reverted, [], 'a removed table is not brought back');
  assert.equal(w.revertLostSwaps(inherited, uc, []).spec, inherited, 'with nothing lost the spec is untouched');
  assert.equal(w.revertLostSwaps(inherited, uc, undefined).spec, inherited);
  assert.equal(w.clearedText({ roles: ['event_date', 'segment'], filters: 2 }), 'its column roles (event date, segment) and 2 filters on it');
  assert.equal(w.clearedText({ roles: [], filters: 1 }), '1 filter on it');
  assert.equal(w.clearedText({ roles: [], filters: 0 }), '');
});

test('the widgets a Genie Code notebook keeps at their defaults are counted with words that agree with the count', async () => {
  const w = await load();
  assert.equal(w.keptDefaultsText(['retention_days']), '1 more widget keeps its default here: retention_days. To change a default, edit the notebook.');
  assert.equal(w.keptDefaultsText(['retention_days', 'region']),
    '2 more widgets keep their defaults here: retention_days, region. To change a default, edit the notebook.');
  assert.equal(w.keptDefaultsText([]), '');
  assert.equal(w.keptDefaultsText(undefined), '');
});

test('the use case name is the catalogue Name: a saved version with an old name takes the current Name, so Inspire and the App show one title', async () => {
  const w = await load();
  const catalogue = "Review which sales channels drove each month's revenue change";
  const fallback = w.defaultSpecFromUseCase({ ...UC, Name: catalogue }, { warehouseId: 'wh', inspireDatabase: 'main.inspire' });
  const latest = { spec_version: 3, spec_json: { ...fallback, use_case_name: 'Isolate Channel Revenue Drivers' } };
  const spec = w.specFromLatest(latest, fallback, {});
  assert.equal(spec.use_case_name, catalogue, 'the catalogue Name is the single title');
  assert.equal(w.sentSpec(spec, null).use_case_name, catalogue, 'the build sends the catalogue Name');
});

test('Rebuild as is: an unchanged version is refused unless the person asks to rebuild it as is', async () => {
  const w = await load();
  assert.equal(w.rebuildNeedsChoice({ unchanged: true }, false), true, 'nothing changed blocks Build until the person picks Rebuild as is');
  assert.equal(w.rebuildNeedsChoice({ unchanged: true }, true), false, 'Rebuild as is lets the same spec build again');
  assert.equal(w.rebuildNeedsChoice({ unchanged: false }, false), false, 'a changed spec never needs the choice');
  assert.match(w.REBUILD_AS_IS_NOTE, /^Rebuild as is: build the current choices again/);
});

test('Edit opens the wizard on the step it was asked for, and on Data otherwise, with old step links landing on the step that now holds them', async () => {
  const w = await load();
  assert.equal(w.initialStepIndex({ step: 'use_case' }), 1, 'the use case lives on Data & results (its Details strip), so an old Use case link lands there');
  assert.equal(w.initialStepIndex({ step: 'data' }), 1);
  assert.equal(w.initialStepIndex({ step: 'choose' }), 1, 'an old Choose link lands on Data & results');
  assert.equal(w.initialStepIndex({ step: 'results' }), 1, 'an old Results link lands on Data & results');
  assert.equal(w.initialStepIndex({ step: 'delivery' }), 0, 'What to deliver is the first step');
  for (const section of ['configure', 'grouping']) assert.equal(w.initialStepIndex({ step: section }), 1, `${section} lands on Data & results when Data groups are no step`);
  assert.equal(w.initialStepIndex({ step: 'grouping' }, 'mvp', null, { grouping: true, firstRun: false }), 2, 'and on Data groups when they are');
  for (const section of ['use_it', 'alert']) assert.equal(w.initialStepIndex({ step: section }), 0, section);
  for (const old of ['kpi', 'holdout', 'schedule']) assert.equal(w.initialStepIndex({ step: old }), 3, `${old} lives on Run it`);
  assert.equal(w.initialStepIndex({ step: 'fresh' }), 1, 'fresh lives on Data & results, Keep it fresh is no longer on Run it');
  assert.equal(w.initialStepIndex({ step: 'measure' }), 2, 'an old Measure impact link lands on Measure, its own step');
  assert.equal(w.initialStepIndex({ step: 'stake' }), 2, 'the Measure step is its own step');
  for (const old of ['summary', 'review', 'vibes', 'settings']) assert.equal(w.initialStepIndex({ step: old }), 4, `${old} lands on Review & build`);
  const withApp = { outputs: { app: true } };
  for (const old of ['app', 'app_access']) assert.equal(w.initialStepIndex({ step: old }, 'mvp', withApp), 4, `${old} lands on Who uses the App`);
  assert.equal(w.initialStepIndex({ step: 'app_place' }, 'mvp', withApp), 3, 'where the App goes lands on Where it lives');
  assert.equal(w.initialStepIndex({ step: 'app_pages' }, 'mvp', withApp), 3, 'app_pages lands on Where it lives, which now holds the pages');
  assert.equal(w.initialStepIndex({ step: 'app_features' }, 'mvp', withApp), 4, 'app_features lands on Who uses the App, its own step');
  assert.equal(w.initialStepIndex({ step: 'app_look' }, 'mvp', withApp), 5, 'app_look lands on App look');
  const joined = { outputs: { app: true, merge: { app: 'finance-desk' } } };
  assert.equal(w.initialStepIndex({ step: 'app_look' }, 'mvp', joined), 3, 'a joined App has no App steps, so its links land on Where it lives');
  assert.equal(w.stepIndexOf(w.wizardSteps('mvp', joined), 'app_pages'), 3);
  assert.equal(w.stepIndexOf(w.wizardSteps('mvp', joined), 'app_access'), 3);
  assert.equal(w.wizardSteps('mvp', joined).some((s) => s.id === 'app' || s.id === 'app_look'), false, 'the App it joins keeps its sign-in, pages and look (must-exclude)');
  assert.equal(w.initialStepIndex({ step: 'run' }, 'mvp', withApp), 6, 'Run it comes after the App');
  assert.equal(w.initialStepIndex({ step: 'review' }, 'mvp', withApp), 7);
  assert.equal(w.initialStepIndex({ step: 'app_place' }), 0, 'with no App the old placement link lands on What to deliver, where the App is ticked');
  assert.equal(w.initialStepIndex({ step: 'nope' }), 0);
  assert.equal(w.initialStepIndex(null), 0);
  assert.equal(w.initialStepId(null), 'delivery', 'the wizard opens on What to deliver');
  assert.equal(w.initialStepId({ step: 'settings' }), 'summary', 'a Settings link has no Settings step to open (must-exclude)');
  assert.equal(w.initialStepIndex({ step: 'notebook' }, 'notebook'), 1);
  assert.equal(w.initialStepIndex({ step: 'review' }, 'notebook'), 1);
});

test('Data groups are a step of their own after Data, First run follows them only before the first run, and the step a person is on keeps its place when it appears', async () => {
  const w = await load();
  const both = { grouping: true, firstRun: true };
  assert.equal(w.FIRST_RUN_STEP.label, 'First run');
  assert.deepEqual([w.GROUPING_STEP.id, w.GROUPING_STEP.label, w.GROUPING_STEP.sections, w.GROUPING_STEP.panels], ['grouping', 'Data groups', ['grouping'], ['grouping']]);
  assert.deepEqual(w.wizardSteps('mvp', null, both).map((s) => s.label), ['What to deliver', 'Data & results', 'Data groups', 'First run', 'Measure', 'Run it', 'Review & build']);
  assert.deepEqual(w.wizardSteps('mvp', null, both).find((s) => s.id === 'data').panels, ['data', 'results', 'fresh'], 'Data & results shows Keep it fresh and no groups (must-exclude)');
  assert.equal(w.wizardSteps('mvp', null, both)[0].sections.includes('grouping'), false, 'and checks none (must-exclude)');
  assert.equal(w.wizardSteps('mvp', null, { grouping: false, firstRun: true }).some((s) => s.id === 'grouping'), false, 'no Data groups step when groups do not apply (must-exclude)');
  assert.deepEqual(w.wizardSteps('mvp', null, { grouping: true, firstRun: false }).map((s) => s.id), ['delivery', 'data', 'grouping', 'stake', 'run', 'summary'], 'runs 2 onward have no First run step');
  assert.deepEqual(w.wizardSteps('mvp').map((s) => s.id), ['delivery', 'data', 'stake', 'run', 'summary'], 'no profile, no Data groups and no First run');
  assert.deepEqual(w.wizardSteps('mvp', { outputs: { app: true } }, both).map((s) => s.label),
    ['What to deliver', 'Data & results', 'Data groups', 'First run', 'Measure', 'Where it lives', 'Who uses the App', 'App look', 'Run it', 'Review & build']);
  for (const scope of [both, { grouping: false, firstRun: false }]) {
    for (const spec of [null, { outputs: { app: true } }, { outputs: { app: true, merge: { app: 'finance-desk' } } }]) {
      const listed = w.wizardSteps('mvp', spec, scope);
      assert.ok(listed.length <= w.WIZARD_STEPS_MAX, `${listed.length} steps`);
      assert.equal(new Set(listed.map((s) => s.id)).size, listed.length);
    }
  }
  assert.equal(w.WIZARD_STEPS_MAX, 10);
  assert.equal(w.wizardSteps('mvp', { outputs: { app: true } }, both).length, 10, 'every step at once is 10, at the cap');
  assert.deepEqual(w.wizardSteps('notebook', null, both).map((s) => s.id), ['data', 'notebook'], 'with Genie Code off only the notebook is written');
  const before = w.wizardSteps('mvp');
  const after = w.wizardSteps('mvp', null, both);
  assert.equal(w.stepIndexOf(before, 'results'), 1);
  assert.equal(w.stepIndexOf(after, 'results'), 1, 'the person on Data & results stays there when Data groups and First run appear after it');
  assert.equal(w.stepIndexOf(before, 'first_run'), 0, 'an id the list does not have lands on the first step');
  assert.equal(w.stepIndexOf(before, 'grouping'), 1, 'a person on Data groups when they stop applying lands on Data & results');
  assert.equal(w.nextStepAfter(after, 'data'), 'grouping', 'Next on Data goes to Data groups');
  assert.equal(w.initialStepIndex({ step: 'first_run' }, 'mvp', null, both), 3);
  const spec = w.defaultSpecFromUseCase(UC, { warehouseId: 'wh1', inspireDatabase: 'main.inspire' });
  const extras = { scopeSteps: both, scopeProfile: { standalone: false } };
  assert.deepEqual(w.stepErrors('data', spec, extras).filter((e) => !/catalog and a schema/.test(e)), [], 'the default spec names no result table yet, the only thing Data & results asks');
  assert.deepEqual(w.stepErrors('grouping', spec, extras), []);
  assert.deepEqual(w.stepErrors('first_run', spec, extras), []);
  const mixed = { ...spec, config: { ...spec.config, widgets: { group_by: 'all, country', run_scope: 'records', scope_records: '0' } } };
  assert.deepEqual(w.stepErrors('grouping', mixed, extras), ["Data groups is 'all, country'; choose all or column names, not a mix"]);
  assert.deepEqual(w.stepErrors('data', mixed, extras).filter((e) => !/catalog and a schema/.test(e)), [], 'Data no longer checks the groups (must-exclude)');
  assert.throws(() => w.stepErrors('grouping', mixed, { scopeSteps: { grouping: false, firstRun: true } }), /unknown wizard step 'grouping'/, 'groups that do not apply have no step to check');
  assert.deepEqual(w.stepErrors('first_run', mixed, extras), ["Records to run on is '0'; allowed: a whole number, at least 1"]);
  const thousand = { ...spec, config: { ...spec.config, widgets: { run_scope: 'records', scope_records: '1000' } } };
  assert.deepEqual(w.stepErrors('first_run', thousand, extras), [], 'about 1,000 records is a first run for every technique: whole groups or the first records');
  assert.deepEqual(w.stepErrors('first_run', thousand, { ...extras, scopeProfile: { standalone: true } }), []);
  assert.throws(() => w.stepErrors('first_run', spec, { scopeSteps: { grouping: true, firstRun: false } }), /unknown wizard step 'first_run'/);
});

test('the wizard opens on Data with no MVP or notebook choice, Notebook alone is a delivery, and with Genie Code off only the notebook is written', async () => {
  const w = await load();
  assert.equal(w.IMPLEMENT_MODES, undefined, 'there is no mode page (must-exclude)');
  assert.deepEqual([w.NOTEBOOK_CARD.id, w.NOTEBOOK_CARD.label], ['notebook', 'Notebook']);
  assert.match(w.NOTEBOOK_CARD.blurb, /Always built\.$/);
  const fs = require('node:fs');
  const src = path.resolve(__dirname, '..', '..', 'frontend', 'src');
  const files = fs.readdirSync(src, { recursive: true, withFileTypes: true }).filter((e) => e.isFile() && /\.(js|jsx)$/.test(e.name))
    .map((e) => path.relative(src, path.join(e.parentPath, e.name)));
  const named = files.filter((f) => /Full MVP|Notebook only|Inspire builds the MVP|I will build it myself/.test(fs.readFileSync(path.join(src, f), 'utf8')));
  assert.deepEqual(named, [path.join('lib', 'implementWizard.js')], 'no page shows the old mode names');
  const spec = w.defaultSpecFromUseCase(UC, { warehouseId: 'wh1', inspireDatabase: 'main.inspire' });
  const notebookOnly = { ...spec, outputs: { ...spec.outputs, dashboard: false, genie_space: false, app: false, alert: false } };
  assert.deepEqual(w.wizardSteps('mvp', notebookOnly).map((s) => s.label), ['What to deliver', 'Data & results', 'Measure', 'Run it', 'Review & build']);
  assert.deepEqual(w.stepErrors('delivery', notebookOnly), []);
  assert.equal(w.builtSentence(notebookOnly), 'The MVP: the result table and the notebook that fills it.');
  assert.equal(w.builtSentence({ ...notebookOnly, outputs: { ...notebookOnly.outputs, app: true, genie_space: true } }),
    'The MVP: Genie Agent, App, the result table and the notebook that fills it.');
  assert.deepEqual(w.contextSettings({ widgets: [] }, null), []);
  assert.deepEqual(w.contextSettings(null, null), []);
  const share = [{ name: 'act_now_share', type: 'text', default: '0.05', allowed: '0 to 1' }];
  assert.equal(w.contextSettings({ widgets: share }, null).some((s) => s.name === 'act_now_share'), false, 'a first build sets the act now share in the App');
  assert.ok(w.contextSettings({ widgets: share, latest: { spec_version: 1 } }, null).some((s) => s.name === 'act_now_share'), 'an Edit of a built version shows it');
  assert.deepEqual(w.wizardSteps('notebook').map((s) => [s.id, s.label]), [['data', 'Data'], ['notebook', 'Notebook']]);
  assert.throws(() => w.wizardSteps('both'), /unknown implement mode 'both'/);
  assert.throws(() => w.wizardSteps(undefined), /unknown implement mode 'undefined'/);
  const bad = { ...spec, use_case: { ...spec.use_case, decision_owner: '' } };
  assert.ok(w.stepErrors('data', bad).length > 0, 'the MVP checks the use case on Data');
  assert.deepEqual(w.sectionErrors('results', bad).filter((e) => /decision owner/.test(e)), [], 'and the result table does not check the decision owner (must-exclude)');
  for (const id of ['data', 'notebook']) {
    assert.deepEqual(w.stepErrors(id, bad, {}, 'notebook'), [], id);
    assert.deepEqual(w.advancedErrors(id, bad, {}, 'notebook'), [], id);
  }
  assert.throws(() => w.stepErrors('notebook', bad), /unknown wizard step 'notebook'/);
});

const RUN = (state, extra = {}) => ({ run_id: 7, job_id: 3, state, url: 'https://w/#job/3/run/7', ...extra });

test('a use case notebook reads ready, running, failed or requested from its flags and the session notebook run', async () => {
  const w = await load();
  for (const has of ['Y', 'Yes', 'yes', ' y ', 'TRUE']) {
    assert.equal(w.notebookStatus({ has_genie_code: has, generate_genie_code_instruction: 'Yes' }, RUN('running')).label, 'Notebook ready', has);
  }
  for (const flag of ['No', 'N', '', null, undefined, 'maybe']) {
    assert.equal(w.notebookStatus({ has_genie_code: 'N', generate_genie_code_instruction: flag }, RUN('running')), null, String(flag));
  }
  const asked = { has_genie_code: 'N', generate_genie_code_instruction: 'Yes' };
  assert.deepEqual(w.notebookStatus(asked, RUN('running')), { state: 'running', label: 'Notebook running', tone: 'busy', reason: '', url: 'https://w/#job/3/run/7' });
  const failed = w.notebookStatus(asked, RUN('failed', { result_state: 'FAILED', message: 'Cell 4 raised' }));
  assert.equal(failed.label, 'Notebook failed');
  assert.equal(failed.reason, 'The notebook run ended FAILED: Cell 4 raised.');
  assert.equal(w.notebookStatus(asked, RUN('failed', { life_cycle_state: 'INTERNAL_ERROR' })).reason, 'The notebook run ended INTERNAL_ERROR.');
  assert.match(w.notebookStatus(asked, RUN('succeeded')).reason, /finished without writing this notebook/);
  assert.equal(w.notebookStatus(asked, RUN('succeeded')).state, 'failed');
  const requested = w.notebookStatus(asked, null);
  assert.equal(requested.state, 'requested');
  assert.equal(requested.url, '');
  assert.equal(w.notebookStatus({}, null), null);
  assert.equal(w.notebookStatus(null, RUN('running')), null);
});

test('the MVP state outranks the notebook, and a stopped MVP run counts as failed', async () => {
  const w = await load();
  const ready = { state: 'ready', label: 'Notebook ready', tone: 'success' };
  const cases = [
    [{ status: 'ready' }, ready, 'ready', 'MVP ready'],
    [{ status: 'ready_with_warnings' }, null, 'ready', 'MVP ready with warnings'],
    [{ status: 'failed' }, ready, 'failed', 'MVP failed'],
    [{ status: 'filling', stalled: { reason: 'run ended' } }, null, 'failed', 'MVP stopped'],
    [{ status: 'previewing', stalled: null }, ready, 'in_progress', 'MVP running'],
    [{ status: 'queued' }, null, 'in_progress', 'MVP running'],
    [{ status: 'building_outputs' }, null, 'in_progress', 'MVP running'],
    [{ status: 'archived_v2' }, null, 'in_progress', 'MVP archived v2'],
    [null, ready, 'ready', 'Notebook ready'],
    [null, { state: 'running', label: 'Notebook running', tone: 'busy' }, 'in_progress', 'Notebook running'],
    [null, { state: 'failed', label: 'Notebook failed', tone: 'error' }, 'failed', 'Notebook failed'],
    [null, { state: 'requested', label: 'Notebook requested', tone: 'idle' }, 'not_started', 'Notebook requested'],
    [{ status: '' }, null, 'not_started', ''],
    [null, null, 'not_started', ''],
  ];
  for (const [latest, notebook, group, label] of cases) {
    const got = w.implementState(latest, notebook);
    assert.deepEqual([got.group, got.label], [group, label], JSON.stringify([latest, notebook]));
  }
  assert.equal(w.implementState({ status: 'ready' }, ready).kind, 'mvp');
  assert.equal(w.implementState(null, ready).kind, 'notebook');
  assert.equal(w.implementState(null, null).kind, 'none');
});

test('the Implement page groups every use case in a fixed order, keeps MVPs of unlisted use cases, and searches id, name, the business title on the card and domain', async () => {
  const w = await load();
  const useCases = [
    { id: 'N01-U01', Name: 'Predict churn', _domain: 'Retention', description: 'Keep loyal members from leaving' },
    { id: 'N01-U02', Name: 'Basket growth', _domain: 'Sales', has_genie_code: 'Y' },
    { id: 'N02-U01', Name: 'Stock outs', _domain: 'Supply', generate_genie_code_instruction: 'Yes', has_genie_code: 'N' },
    { id: 'N02-U02', Name: 'Fraud flags', _domain: 'Risk' },
    { No: '', Name: 'No id at all' },
  ];
  const latest = [
    { use_case_id: 'N01-U01', status: 'filling', stalled: null },
    { use_case_id: 'N02-U02', status: 'failed' },
    { use_case_id: 'N09-U09', use_case_name: 'Removed from the catalog', status: 'ready' },
  ];
  const groups = w.implementGroups(useCases, latest, RUN('running'));
  assert.deepEqual(groups.map((g) => g.label), ['Building', 'Needs attention', 'Ready', 'Not built'], 'four groups, building first');
  assert.deepEqual(groups.map((g) => g.items.map((i) => i.id)), [['N01-U01', 'N02-U01'], ['N02-U02'], ['N01-U02', 'N09-U09'], []]);
  assert.equal(groups[2].items[1].name, 'Removed from the catalog');
  assert.equal(groups[0].items[1].state.label, 'Notebook running');
  const afterRun = w.implementGroups(useCases, [], RUN('failed', { result_state: 'FAILED' }));
  assert.deepEqual(afterRun.map((g) => g.items.map((i) => i.id)), [[], ['N02-U01'], ['N01-U02'], ['N01-U01', 'N02-U02']]);
  const search = (q) => w.implementGroups(useCases, latest, null, q).flatMap((g) => g.items.map((i) => i.id));
  assert.deepEqual(search('churn'), ['N01-U01']);
  assert.deepEqual(search('  SUPPLY  '), ['N02-U01']);
  assert.deepEqual(search('n02 fraud'), ['N02-U02']);
  assert.deepEqual(search('fraud churn'), []);
  assert.deepEqual(search('Keep loyal members from leaving'), ['N01-U01'], 'the business title the card shows under the name finds it');
  assert.deepEqual(search('loyal fraud'), [], 'every word must match');
  const live = [{ id: 'N04-U01', Name: 'Forecast pickups', _domain: 'Demand', description: 'Forecast pickups', usecase: 'Cut idle time' }];
  assert.deepEqual(w.implementGroups(live, [], null, 'cut idle').flatMap((g) => g.items.map((i) => i.id)), ['N04-U01'],
    'a description that repeats the name still lets the business title find it');
  assert.equal(search('').length, 5);
  assert.deepEqual(w.implementGroups(null, undefined, null).map((g) => g.items.length), [0, 0, 0, 0]);
});

test('the Genie tab lists the questions recorded in the space, else the ones the user asked for', async () => {
  const w = await load();
  const asked = { spec_json: { outputs: { genie_questions: ['Which act now?'] } } };
  assert.deepEqual(w.genieQuestions({ ...asked, asset_status: { genie_space: { sample_questions: ['A?', 'B?'] } } }),
    { source: 'space', questions: ['A?', 'B?'], notes: ['', ''] });
  assert.deepEqual(w.genieQuestions({ ...asked, asset_status: { genie_space: { sample_questions: [] } } }),
    { source: 'spec', questions: ['Which act now?'], notes: [''] });
  assert.deepEqual(w.genieQuestions(asked), { source: 'spec', questions: ['Which act now?'], notes: [''] });
  assert.deepEqual(w.genieQuestions(null), { source: 'spec', questions: [], notes: [] });
});

test('the Genie tab shows the note on a question of the user that the results cannot answer as asked', async () => {
  const w = await load();
  const space = {
    sample_questions: ['Which stores act now?', 'How many  customers are in Act now?', 'Who is next?'],
    question_notes: [{ question: 'how many customers are in act now?', note: 'The rows are stores, so it counts stores.' },
      { question: 'Who is next?', note: '' }, { note: 'no question' }, null, { question: 'Not in the space?', note: 'x' }],
  };
  assert.deepEqual(w.genieQuestions({ asset_status: { genie_space: space } }), {
    source: 'space', questions: space.sample_questions, notes: ['', 'The rows are stores, so it counts stores.', ''],
  });
  assert.deepEqual(w.genieQuestions({ asset_status: { genie_space: { ...space, question_notes: 'not a list' } } }).notes, ['', '', '']);
});

test('the App tab shows the live state, the last deployment and the health check in words', async () => {
  const w = await load();
  const live = { ok: true, app_state: 'RUNNING', app_message: 'App is running', compute_state: 'ACTIVE', deployment_state: 'SUCCEEDED',
    deployment_message: 'App started successfully', deployed_at: '2026-10-25T03:00:00Z' };
  assert.deepEqual(w.appStatusRows(live, { health: 'running', spec_version: 4 }), [
    ['App', 'RUNNING: App is running'], ['Compute', 'ACTIVE'], ['Last deployment', 'SUCCEEDED: App started successfully (2026-10-25T03:00:00Z)'],
    ['Health check', 'running: it answers behind workspace sign-in'], ['Built on', 'v4']]);
  assert.deepEqual(w.appStatusRows({ ok: true }, { health: 'unverified: HTTP 502' }), [
    ['App', 'unknown'], ['Compute', 'unknown'], ['Last deployment', 'none'], ['Health check', 'unverified: HTTP 502']]);
  assert.deepEqual(w.appStatusRows({ ok: false, error: 'the App no longer exists' }, {}), [['Live status', 'the App no longer exists']]);
  assert.deepEqual(w.appStatusRows(null, null), []);
});

test('the run profile reads as the job default when none is chosen', async () => {
  const w = await load();
  assert.equal(w.resultTierOptions, undefined);
  assert.equal(w.runProfileText('preview'), 'preview');
  assert.equal(w.runProfileText(''), 'full (job default)');
});

test('the Implement page gives the reason only for a warning or a failure', async () => {
  const w = await load();
  const why = 'Decision list: no row of the latest run reached Act now or Review (1000 Monitor), so it has nobody to act on yet';
  assert.equal(w.statusReason({ status: 'ready_with_warnings', status_message: ` ${why} ` }), why);
  assert.equal(w.statusReason({ status: 'failed', status_message: 'the preview run did not write rows: stopped' }),
    'the preview run did not write rows: stopped');
  for (const quiet of [{ status: 'ready', status_message: 'ready: preview wrote 12 row(s)' },
    { status: 'previewing', status_message: 'Dashboard: Genie round 1/3' }, { status: 'ready_with_warnings' },
    { status: 'failed', status_message: null }, null, undefined]) {
    assert.equal(w.statusReason(quiet), '', JSON.stringify(quiet));
  }
});

test('a build whose job ended before Inspire picked the version up says so in plain words, and offers scope, notebook and report choices (must-exclude)', async () => {
  const w = await load();
  const latest = { spec_version: 2, use_case_id: 'N01-U01', status: 'failed', status_message: 'the run building v2 ended (Finished) while v2 was still queued' };
  const queued = { run_id: '5555555555555555', run_url: 'https://x/run/5555555555555555', reason: latest.status_message, ended: true };
  const reason = w.statusReason(latest, queued);
  assert.equal(reason, 'The build job ended before Inspire started building v2. Rebuild in Vibe/Add/Remove Features submits a new version.');
  assert.doesNotMatch(reason, /Finished|still queued/, 'the raw job state is not shown to the person');
  const { newIssueUrl } = await import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', 'issues.js')).href);
  assert.equal(w.stoppedChoices(latest, { stalled: queued }).find((c) => c.id === 'report').url, '', 'the wizard module names no internet host; the page supplies the link');
  const choices = w.stoppedChoices(latest, { stalled: queued, notebookUrl: '', issueUrl: newIssueUrl });
  assert.deepEqual(choices.map((c) => c.id), ['scope', 'notebook', 'report']);
  assert.equal(choices.find((c) => c.id === 'notebook').url, '', 'without a notebook link the choice writes one');
  const report = new URL(choices.find((c) => c.id === 'report').url);
  assert.equal(report.hostname, 'github.com');
  assert.match(report.searchParams.get('body'), /version v2/);
  assert.doesNotMatch(`${report.searchParams.get('title')} ${report.searchParams.get('body')}`, /5555555555555555|https?:|@/,
    'the public report holds no run id, run link or person');
  assert.deepEqual(w.stoppedChoices(latest, { stalled: queued, notebookUrl: 'https://x/nb' }).find((c) => c.id === 'notebook').url, 'https://x/nb');
  const filling = { ...queued, reason: 'the run building v2 ended (CANCELED) while v2 was still filling' };
  assert.equal(w.stoppedWords(filling), 'the run building v2 ended (CANCELED) while v2 was still filling', 'a run that stopped while filling keeps its own words');
  assert.equal(w.stoppedWords({ reason: 'the run building v2 ended (Finished) while v3 was still queued' }), 'the run building v2 ended (Finished) while v3 was still queued', 'the version in the reason must match');
});

test('a stalled version reads as stopped, frees the Implement page actions, says why, and the History calls older active versions stopped', async () => {
  const w = await load();
  assert.deepEqual(w.IMPLEMENT_ACTIVE_STATUSES, backend.IMPLEMENT_ACTIVE_STATUSES);
  const latest = { spec_version: 4, status: 'filling', status_message: 'filling' };
  const stalled = { run_id: '77', run_url: 'https://x/run/77', reason: 'the run building v4 ended (CANCELED) while v4 was still filling' };
  assert.equal(w.versionActive(latest), true);
  assert.equal(w.versionActive(latest, stalled), false);
  for (const status of ['ready', 'ready_with_warnings', 'failed', '']) assert.equal(w.versionActive({ status }), false, status);
  assert.equal(w.versionActive(null), false);
  assert.deepEqual(w.statusChip('filling', stalled), { label: 'Stopped', tone: 'error' });
  assert.deepEqual(w.statusChip('building_outputs'), { label: 'building outputs', tone: 'busy' });
  assert.deepEqual(w.statusChip('ready', stalled), { label: 'Ready', tone: 'success' });
  assert.equal(w.statusReason(latest, stalled), 'the run building v4 ended (CANCELED) while v4 was still filling. Rebuild in Vibe/Add/Remove Features submits a new version.');
  assert.equal(w.statusReason(latest), '');
  assert.equal(w.statusReason({ status: 'failed', status_message: 'boom' }, stalled), 'boom');
  assert.equal(w.historyStatus({ spec_version: 3, status: 'previewing' }, latest), 'stopped before it finished');
  assert.equal(w.historyStatus(latest, latest), 'filling');
  assert.equal(w.historyStatus(latest, latest, stalled), 'stopped before it finished');
  assert.equal(w.historyStatus({ spec_version: 2, status: 'ready_with_warnings' }, latest, stalled), 'ready_with_warnings');
  const recorded = { spec_version: 4, status: 'failed', status_message: stalled.reason };
  const ended = { ...stalled, ended: true };
  assert.deepEqual(w.statusChip('failed', ended), { label: 'Stopped', tone: 'error' }, 'the failed record Inspire wrote for the ended run');
  assert.deepEqual(w.statusChip('failed', stalled), { label: 'Failed', tone: 'error' });
  assert.equal(w.statusReason(recorded, ended), 'the run building v4 ended (CANCELED) while v4 was still filling. Rebuild in Vibe/Add/Remove Features submits a new version.');
  assert.equal(w.historyStatus(recorded, recorded, ended), 'stopped before it finished');
  assert.equal(w.historyStatus(recorded, recorded, stalled), 'failed');
  assert.equal(w.historyStatus({ spec_version: 3, status: 'failed' }, recorded, ended), 'failed', 'an older failed version stays failed');
  assert.equal(w.versionActive(recorded, ended), false);
  assert.deepEqual([w.runStopped('failed', ended), w.runStopped('failed', stalled), w.runStopped('filling', stalled), w.runStopped('ready', ended), w.runStopped('failed', null)],
    [true, false, true, false, false]);
  assert.equal(w.implementState({ ...recorded, stalled: ended }).label, 'MVP stopped');
  assert.equal(w.implementState({ ...recorded, stalled }).label, 'MVP failed');
});

test('a notebook run counts as ended when it stops running or a newer finished run replaces it, never on the first read', async () => {
  const w = await load();
  const run = (id, state) => ({ run_id: id, state });
  assert.equal(w.notebookRunEnded(run(1, 'running'), run(1, 'succeeded')), true);
  assert.equal(w.notebookRunEnded(run(1, 'running'), run(1, 'failed')), true);
  assert.equal(w.notebookRunEnded(run(1, 'succeeded'), run(2, 'failed')), true, 'a run that started and ended between two reads');
  assert.equal(w.notebookRunEnded(run(1, 'running'), run(1, 'running')), false);
  assert.equal(w.notebookRunEnded(run(1, 'succeeded'), run(2, 'running')), false);
  assert.equal(w.notebookRunEnded(run(1, 'succeeded'), run(1, 'succeeded')), false);
  assert.equal(w.notebookRunEnded(null, run(1, 'succeeded')), false);
  assert.equal(w.notebookRunEnded(run(1, 'running'), null), false);
  assert.equal(w.notebookRunEnded({ run_id: 7, state: 'succeeded' }, { run_id: '7', state: 'failed' }), false, 'ids compare as text');
});


test('the wizard judges column roles by the rules and cases the agent shares', async () => {
  const w = await load();
  const rules = FIXTURE.role_rules;
  assert.deepEqual(w.ROLE_RULES.keyNameSuffixes, rules.key_name_suffixes);
  assert.deepEqual(w.ROLE_RULES.keyNamePrefixes, rules.key_name_prefixes);
  assert.deepEqual(w.ROLE_RULES.genericKeyNames, rules.generic_key_names);
  assert.deepEqual(w.ROLE_RULES.codeNames, rules.code_names);
  assert.deepEqual(w.ROLE_RULES.concatKeySuffixes, rules.concat_key_suffixes);
  assert.deepEqual(w.ROLE_RULES.textNameTokens, rules.text_name_tokens);
  assert.deepEqual(w.ROLE_RULES.personNameTokens, rules.person_name_tokens);
  for (const c of rules.cases) {
    assert.equal(w.isDateKeyColumn(c.column, c.type), c.date_key, `${c.column} date key`);
    assert.equal(w.columnRoleProblem(c.role, c.column, c.type) === '', c.fits, `${c.role} ${c.column}`);
  }
  assert.equal(w.columnRoleProblem('label', 'c_first_name', 'STRING', { trainsModel: false }), '');
});

test('the Data step names each column role that does not fit and leaves unset roles to Inspire', async () => {
  const w = await load();
  const columnsByTable = {
    'samples.tpcds_sf1.web_sales': [{ column_name: 'ws_sold_date_sk', data_type: 'INT' }, { column_name: 'ws_quantity', data_type: 'INT' }],
    'samples.tpcds_sf1.customer': [{ column_name: 'c_first_name', data_type: 'STRING' }, { column_name: 'c_last_review_date', data_type: 'INT' }],
  };
  const guessed = specWith(w, { column_roles: {
    entity_id: 'samples.tpcds_sf1.web_sales.ws_sold_date_sk', event_date: 'samples.tpcds_sf1.customer.c_last_review_date',
    label: 'samples.tpcds_sf1.customer.c_first_name', measure: 'samples.tpcds_sf1.web_sales.ws_quantity' } });
  const errors = w.sectionErrors('data', guessed, { columnsByTable, trainsModel: true });
  assert.deepEqual(errors.filter((e) => /^(entity id|event date|label|measure|segment) samples\./.test(e)), [
    'entity id samples.tpcds_sf1.web_sales.ws_sold_date_sk: a date, a date key or a measure is not the entity the decision acts on',
    'event date samples.tpcds_sf1.customer.c_last_review_date: pick a DATE or TIMESTAMP column, or a date key that joins a date table',
    'label samples.tpcds_sf1.customer.c_first_name: an outcome is a flag, a number or a category, never a date, a key, a name or free text',
  ]);
  const hint = "Reset roles to Inspire's choice, under Change data settings, sets every role back at once";
  assert.equal(w.RESET_ROLES_LABEL, "Reset roles to Inspire's choice");
  assert.equal(errors.filter((e) => e === hint).length, 1, 'the footer names the one-click reset once, after the role problems');
  assert.ok(errors.indexOf(hint) > errors.findIndex((e) => e.startsWith('label samples.')));
  const unset = specWith(w, { column_roles: {} });
  assert.deepEqual(w.sectionErrors('data', unset, { columnsByTable }).filter((e) => e.includes('samples.')), []);
  assert.ok(!w.sectionErrors('data', unset, { columnsByTable }).includes(hint), 'no role problem, no reset hint');
  const fits = specWith(w, { column_roles: { measure: 'samples.tpcds_sf1.web_sales.ws_quantity' } });
  assert.ok(!w.sectionErrors('data', fits, { columnsByTable, trainsModel: true }).includes(hint), 'a role that fits needs no reset');
  assert.deepEqual(w.defaultSpecFromUseCase(ROW, {}).data.column_roles, {});
  const gone = specWith(w, { column_roles: { measure: 'samples.tpcds_sf1.web_sales.ws_gone' } });
  assert.deepEqual(w.sectionErrors('data', gone, { columnsByTable }).filter((e) => e.includes('ws_gone')), [],
    'a saved role on a column that is gone never blocks the Data step');
  const dropped = w.withoutMissingRoles(specWith(w, { column_roles: {
    measure: 'samples.tpcds_sf1.web_sales.ws_gone', label: 'samples.tpcds_sf1.customer.c_first_name',
    segment: 'samples.other.t.col' } }), columnsByTable);
  assert.deepEqual(dropped.spec.data.column_roles, { label: 'samples.tpcds_sf1.customer.c_first_name', segment: 'samples.other.t.col' },
    'only the role on a missing column of a known table is dropped');
  assert.equal(dropped.note, 'Dropped measure samples.tpcds_sf1.web_sales.ws_gone: that column no longer exists. Pick another one if you need it.');
  const kept = specWith(w, { column_roles: { measure: 'samples.tpcds_sf1.web_sales.ws_quantity' } });
  assert.deepEqual(w.withoutMissingRoles(kept, columnsByTable), { spec: kept, note: '' });
  assert.deepEqual(w.withoutMissingRoles(gone, {}), { spec: gone, note: '' }, 'columns not read yet drop nothing');
});

test('a saved App look not in the bundle lists falls back to the first option, and a look that fits is kept', async () => {
  const w = await load();
  const look = Object.fromEntries(Object.values(w.APP_LOOK_LISTS).map((list) => [list, [`${list}-a`, `${list}-b`]]));
  const [key, list] = Object.entries(w.APP_LOOK_LISTS)[0];
  const [otherKey, otherList] = Object.entries(w.APP_LOOK_LISTS)[1] || [key, list];
  const spec = { outputs: { app: true, app_look: { [key]: 'gone-theme', [otherKey]: `${otherList}-b` } } };
  const fixed = w.withAppLookDefaults(spec, look);
  assert.equal(fixed.outputs.app_look[key], `${list}-a`);
  assert.equal(fixed.outputs.app_look[otherKey], `${otherList}-b`);
  const fits = w.withAppLookDefaults(fixed, look);
  assert.equal(w.withAppLookDefaults(fits, look), fits, 'a look that fits is returned unchanged');
  const noApp = { outputs: { app: false, app_look: { [key]: 'gone-theme' } } };
  assert.equal(w.withAppLookDefaults(noApp, look), noApp);
  assert.equal(w.withAppLookDefaults(spec, null), spec, 'no bundle lists yet, nothing changes');
});

test('the wizard never fills a column role on its own', () => {
  const fs = require('node:fs');
  const source = fs.readFileSync(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'pages', 'ImplementWizard.jsx'), 'utf8');
  assert.doesNotMatch(source, /guessColumnRole|confirmedRoles|unconfirmedRoles/);
  assert.match(source, /<option value="">Inspire&apos;s choice<\/option>/);
  assert.doesNotMatch(source, /column_roles: roles/);
});

test('every MVP state falls in one bucket: ready and with warnings are live, running is building, failed and stopped are failed, and a notebook run or an uninstalled MVP is no MVP', async () => {
  const w = await load();
  const bucket = (latest, notebook = null) => w.mvpBucketOf(w.implementState(latest, notebook));
  assert.equal(bucket({ status: 'ready' }), 'live');
  assert.equal(bucket({ status: 'ready_with_warnings' }), 'live');
  for (const status of backend.IMPLEMENT_ACTIVE_STATUSES) assert.equal(bucket({ status }), 'building', status);
  assert.equal(bucket({ status: 'filling', stalled: { message: 'gone' } }), 'failed', 'a stopped build is failed, not building');
  assert.equal(bucket({ status: 'failed' }), 'failed');
  assert.equal(bucket({ status: 'some_new_state' }), 'building');
  assert.equal(bucket({ status: 'uninstalled' }), 'none');
  assert.equal(bucket(null, w.notebookStatus({ has_genie_code: 'Y' }, null)), 'none', 'a notebook alone is not an MVP');
  assert.equal(bucket(null), 'none');
  assert.equal(w.mvpBucketOf(null), 'none');
  assert.equal(w.mvpBucketOf(undefined), 'none');
});

test('the MVP filter keeps only its bucket, Has an MVP keeps every bucket but none, and Any keeps everything', async () => {
  const w = await load();
  const states = { live: w.implementState({ status: 'ready' }), building: w.implementState({ status: 'filling' }),
    held: w.implementState({ status: w.IMPLEMENT_VIBE_NOT_MET }), failed: w.implementState({ status: 'failed' }), none: w.implementState(null) };
  const kept = (filter) => Object.entries(states).filter(([, state]) => w.mvpFilterMatches(filter, state)).map(([name]) => name);
  assert.deepEqual(kept('all'), ['live', 'building', 'held', 'failed', 'none']);
  assert.deepEqual(kept(''), ['live', 'building', 'held', 'failed', 'none']);
  assert.deepEqual(kept('has'), ['live', 'building', 'held', 'failed']);
  assert.deepEqual(kept('none'), ['none']);
  assert.deepEqual(kept('live'), ['live']);
  assert.deepEqual(kept('building'), ['building']);
  assert.deepEqual(kept('held'), ['held']);
  assert.deepEqual(kept('failed'), ['failed']);
  assert.equal(w.mvpFilterMatches('none', null), true, 'a use case without an id has no MVP');
  assert.deepEqual(w.MVP_FILTERS.map((f) => f.id), ['all', 'has', 'none', 'live', 'building', 'held', 'failed']);
});

test('the MVP counts add up: started is live plus building plus held plus failed, and started plus none is every use case', async () => {
  const w = await load();
  const states = [{ status: 'ready' }, { status: 'ready_with_warnings' }, { status: 'checking' }, { status: w.IMPLEMENT_VIBE_NOT_MET }, { status: 'failed' },
    { status: 'uninstalled' }, null].map((latest) => w.implementState(latest));
  const counts = w.mvpCounts([...states, null]);
  assert.deepEqual(counts, { useCases: 8, has: 5, none: 3, live: 2, building: 1, held: 1, failed: 1 });
  assert.equal(counts.has, counts.live + counts.building + counts.held + counts.failed);
  assert.equal(counts.has + counts.none, counts.useCases);
  assert.deepEqual(w.mvpCounts([]), { useCases: 0, has: 0, none: 0, live: 0, building: 0, held: 0, failed: 0 });
  assert.deepEqual(w.mvpCounts(undefined), { useCases: 0, has: 0, none: 0, live: 0, building: 0, held: 0, failed: 0 });
});

test('Try again is offered on a failed or stopped version, never on an uninstall, a hand-edited notebook or missing source tables', async () => {
  const w = await load();
  const failed = (top = {}) => ({ spec_version: 2, status: 'failed', spec_json: {}, ...top });
  assert.equal(w.canBuildAgain(failed()), true);
  assert.equal(w.canBuildAgain(failed({ status: 'filling' })), true, 'a stopped version');
  assert.equal(w.canBuildAgain(failed({ spec_version: '3' })), true, 'a version number read as text');
  for (const version of [null, undefined, '', 'v2', 2.5]) assert.equal(w.canBuildAgain(failed({ spec_version: version })), false, String(version));
  assert.equal(w.canBuildAgain(null), false);
  assert.equal(w.canBuildAgain(failed({ status: w.IMPLEMENT_UNINSTALLED })), false);
  assert.equal(w.canBuildAgain(failed({ spec_json: { uninstall: true } })), false, 'Uninstall all tries an uninstall again');
  assert.equal(w.canBuildAgain(failed(), { edited: { edited_at: null } }), false);
  assert.equal(w.canBuildAgain(failed(), { missing: ['main.s.orders'] }), false);
  assert.equal(w.canBuildAgain(failed(), { missing: null }), true);
  assert.equal(w.buildAgainHint(failed({ spec_version: '2' })),
    'Try again asks for v2 again as v3, with the same choices, and Inspire repairs what it can on the way.');
});

test('Try again sends the failed version as the next one with every ask it made, and the backend builds it instead of refusing it', async () => {
  const w = await load();
  const choices = served({
    use_case_id: 'N01-U01', use_case_name: 'Predict churn', config: { warehouse_id: 'wh1', result_table: 'main.inspire.churn_out' },
    outputs: { dashboard: true, genie_space: true, app: true, app_name: 'churn-desk', app_access: 'sp', alert: false },
  }).spec;
  const row = (version, status, spec, built = false) => ({
    session_id: '42', use_case_id: 'N01-U01', spec_version: version, status, spec_json: spec,
    notebook_path: built ? '/W/impl/N01-U01' : null, job_id: built ? '77' : null, dashboard_id: built ? 'd1' : null,
    genie_space_id: built ? 'g1' : null, app_name: built ? 'churn-desk' : null,
    asset_status: built ? Object.fromEntries(['dashboard', 'genie_space', 'app', 'notebook'].map((n) => [n, { state: 'ready', spec_version: version }])) : null,
  });
  const submit = (history, sent) => {
    const { spec, errors } = served(sent);
    assert.deepEqual(errors, []);
    const plan = backend.planSubmission(history, spec);
    backend.refuseUnchanged(plan);
    return { spec, plan };
  };

  const never = [row(2, 'failed', { ...choices, based_on_version: 1 }), row(1, 'failed', choices)];
  const first = submit(never, w.nextSpecFrom(never[0], w.buildAgainChanges(never[0])));
  assert.deepEqual([first.spec.based_on_version, first.plan.nextVersion, first.plan.built, first.plan.unchanged], [2, 3, null, false]);
  assert.ok(first.plan.summary.classes.includes('initial'), 'nothing was ever built, so it builds everything');

  const asked = { ...choices, based_on_version: 2, vibes: 'Put the riskiest first', vibe_previous: 'keep' };
  const vibed = [row(3, 'failed', asked), row(2, 'ready', choices, true)];
  assert.deepEqual(w.buildAgainChanges(vibed[0]),
    { vibes: 'Put the riskiest first', vibe_previous: 'keep', retry_outputs: [], rollback_outputs: {}, confirm_notebook_overwrite: false });
  const again = submit(vibed, w.nextSpecFrom(vibed[0], w.buildAgainChanges(vibed[0])));
  assert.deepEqual([again.spec.based_on_version, again.plan.nextVersion, again.spec.vibes], [3, 4, 'Put the riskiest first']);
  assert.deepEqual(again.plan.summary.classes, ['vibe'], 'the failed vibe is asked again');
  const dropped = submit(vibed, w.nextSpecFrom(vibed[0], {}));
  assert.equal(dropped.plan.summary.nothing_to_do, true, 'without the asks of the failed version there is nothing to build');
  assert.deepEqual(w.buildAgainChanges({ spec_json: null }), {});
  assert.deepEqual(w.buildAgainChanges({ spec_json: ['vibes'] }), {});
});

test('App look lists every page with its switch: Things to fix and Ask Genie always on, Runs and Impact on until turned off, Alerts with Send alerts and never per user', async () => {
  const w = await load();
  assert.deepEqual(w.APP_LOOK_TABS.map((t) => t.id), ['style', 'palette', 'layout', 'charts']);
  const spec = w.defaultSpecFromUseCase(UC, { warehouseId: 'wh1', inspireDatabase: 'main.inspire', owner: 'amr@example.com' });
  const state = (s) => w.appPagesOf(s).map((p) => [p.id, p.on, Boolean(p.fixed), p.off || '']);
  const fixText = (s) => w.appPagesOf(s).find((p) => p.id === 'fix').blurb;
  const withOutputs = (patch, options = {}) => ({ ...spec, outputs: { ...spec.outputs, ...patch, app_options: { ...spec.outputs.app_options, ...options } } });
  assert.deepEqual(state(spec), [['fix', true, true, ''], ['runs', true, false, ''], ['alerts', false, false, w.PER_USER_REASON], ['impact', true, false, ''], ['genie', true, true, '']],
    'the default App signs each viewer in: every page on but Alerts, which a per-user App does not send');
  assert.deepEqual(state(withOutputs({ app_access: 'sp' }))[2], ['alerts', false, false, ''], 'a shared App waits for Send alerts');
  assert.doesNotMatch(fixText(spec), /edit a record/);
  assert.match(fixText(spec), /People own, track and dismiss each flagged record\.$/, 'the default App records decisions');
  assert.doesNotMatch(fixText(withOutputs({}, { decisions: false })), /own, track and dismiss/, 'decisions turned off: the page says nothing about them');
  const all = withOutputs({ app_access: 'sp' }, { modify: true, decisions: true, alerts: true });
  assert.equal(w.appPagesOf(all).find((p) => p.id === 'alerts').on, true);
  assert.match(fixText(all), /People can edit a record, and Inspire keeps who changed what\. People own, track and dismiss each flagged record\.$/);
  const perUser = withOutputs({ app_access: 'user' }, { modify: true, decisions: true, alerts: true });
  assert.deepEqual(state(perUser)[2], ['alerts', false, false, w.PER_USER_REASON], 'a per-user App has Alerts off, with the reason');
  assert.match(fixText(perUser), /People can edit a record/);
  assert.match(fixText(perUser), /own, track and dismiss/, 'a per-user App records decisions on the records each person can read');
  for (const empty of [undefined, null, {}, { outputs: null }]) {
    assert.deepEqual(state(empty).map(([id, on]) => [id, on]), [['fix', true], ['runs', true], ['alerts', false], ['impact', true], ['genie', true]], JSON.stringify(empty));
  }

  const noImpact = w.withAppPage(spec, 'impact', false);
  assert.deepEqual(noImpact.outputs.app_pages, { runs: true, impact: false });
  assert.deepEqual(w.appScreensOf(noImpact), { runs: true, impact: false });
  const noRuns = w.withAppPage(noImpact, 'runs', false);
  assert.deepEqual(state(noRuns).map(([id, on]) => [id, on]), [['fix', true], ['runs', false], ['alerts', false], ['impact', false], ['genie', true]]);
  assert.deepEqual(w.withAppPage(w.withAppPage(noRuns, 'runs', true), 'impact', true).outputs.app_pages, { runs: true, impact: true });
  for (const fixed of ['fix', 'genie', 'nope']) assert.equal(w.withAppPage(spec, fixed, false), spec, `${fixed} cannot be turned off`);
  const alertsOn = w.withAppPage(spec, 'alerts', true);
  assert.equal(alertsOn.outputs.app_options.alerts, true, 'the Alerts switch is the Send alerts option');
  assert.equal(alertsOn.outputs.app_pages, spec.outputs.app_pages, 'and leaves the screens alone');
  assert.equal(w.withAppPage(alertsOn, 'alerts', false).outputs.app_options.alerts, false);
  assert.deepEqual(w.appScreensOf({ outputs: { app_pages: { runs: null, impact: 'no' } } }), { runs: true, impact: true }, 'only false turns a page off');

  const texts = [w.APP_SAMPLE_NOTE, w.APP_CHARTS_NOTE, w.APP_CHARTS_MIN_NOTE, w.APP_CHARTS_RESET, w.APP_PAGES_NOTE, w.APP_ALWAYS_ON,
    ...w.APP_LOOK_TABS.map((t) => t.label), ...w.APP_CHART_KINDS.flatMap((k) => [k.label, k.blurb]), ...w.appPagesOf(all).flatMap((p) => [p.label, p.blurb])];
  for (const text of texts) assert.doesNotMatch(text, /[\u2013\u2014]/, text);
});

test('the App charts start at Inspire\'s pick, take at least 3 kinds, keep the shell\'s order, and go back to Inspire\'s pick when that is what is ticked', async () => {
  const w = await load();
  const spec = w.defaultSpecFromUseCase(UC, { warehouseId: 'wh1', inspireDatabase: 'main.inspire', owner: 'amr@example.com' });
  const look = { chart_kinds: ['trend', 'bars', 'split', 'pareto', 'scatter'], chart_pick: ['trend', 'bars', 'pareto'] };
  assert.deepEqual(w.appChartsOf(spec, look), ['trend', 'bars', 'pareto']);
  assert.equal(w.appChartsPicked(spec), false);
  assert.equal(w.appChartPickText(look), "Inspire's pick: trend over time, bars by segment and biggest first.");
  assert.deepEqual(w.appChartsOf(spec, { chart_pick: ['split', 'scatter', 'bars'] }), ['split', 'scatter', 'bars'], 'the pick comes from the shell when it names one');
  assert.deepEqual(w.appChartsOf(spec, null), w.APP_CHART_PICK);
  assert.equal(w.withAppChart(spec, 'trend', false, look), spec, 'unticking one of 3 would leave 2, so nothing changes');
  const four = w.withAppChart(spec, 'scatter', true, look);
  assert.deepEqual(four.outputs.app_charts, ['trend', 'bars', 'pareto', 'scatter']);
  assert.equal(w.appChartsPicked(four), true);
  const swapped = w.withAppChart(four, 'trend', false, look);
  assert.deepEqual(swapped.outputs.app_charts, ['bars', 'pareto', 'scatter']);
  assert.deepEqual(w.withAppChart(w.withAppChart(swapped, 'split', true, look), 'pareto', false, look).outputs.app_charts, ['bars', 'split', 'scatter']);
  assert.deepEqual(w.withAppChart(four, 'scatter', false, look).outputs.app_charts, [], 'ticking back to Inspire\'s pick is Inspire\'s pick');
  assert.equal(w.withAppChart(swapped, 'bars', false, look), swapped);
  assert.deepEqual(w.withInspireCharts(swapped).outputs.app_charts, []);
  const two = { ...spec, outputs: { ...spec.outputs, app_charts: ['trend', 'bars'] } };
  assert.deepEqual(w.stepErrors('app_look', two), ['pick at least 3 kinds of chart'], 'checked before the App look list loads');
  assert.deepEqual(w.stepErrors('app_look', two, { appLook: { styles: ['a'], layouts: ['sidebar'], palettes: ['default'], themes: ['light'] } }),
    ['pick at least 3 kinds of chart']);
  assert.deepEqual(w.stepErrors('app_look', swapped), []);
  assert.deepEqual(w.stepErrors('app_look', spec), []);
});

test('a use case joining a hub sends no charts or pages, since the hub keeps its own, and asks for no App owners', async () => {
  const w = await load();
  const spec = w.defaultSpecFromUseCase(UC, { warehouseId: 'wh1', inspireDatabase: 'main.inspire', owner: 'amr@example.com' });
  const picked = { ...spec, outputs: { ...spec.outputs, app: true, app_charts: ['bars', 'split', 'scatter'], app_pages: { runs: false, impact: true }, app_owners: ['a@b.co'] } };
  const own = w.sentSpec(picked, null);
  assert.deepEqual([own.outputs.app_charts, own.outputs.app_pages, own.outputs.app_owners], [['bars', 'split', 'scatter'], { runs: false, impact: true }, ['a@b.co']]);
  const joining = w.sentSpec({ ...picked, outputs: { ...picked.outputs, merge: { ...picked.outputs.merge, app: 'inspire-hub-acme' } } }, null);
  assert.equal(Object.prototype.hasOwnProperty.call(joining.outputs, 'app_charts'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(joining.outputs, 'app_pages'), false);
  assert.deepEqual(joining.outputs.app_owners, []);
});

test('a joined App\'s look reads in plain words and says how to get a look of its own', async () => {
  const w = await load();
  const look = { style: 'a', layout: 'tabs', palette: 'ocean', theme: 'dark' };
  assert.equal(w.lookText(look), 'Style A, Top tabs, the Ocean palette and Dark mode');
  assert.deepEqual([w.lookLabel('palette', ''), w.lookLabel('style', 'z'), w.lookLabel('layout', undefined), w.lookLabel('other', 'x')], ['', 'z', '', 'x'],
    'an unknown value shows as it is');
  const hub = { name: 'inspire-hub-acme', access: 'sp', use_cases: [{ use_case_id: 'N01-U01', name: 'Forecast demand' }] };
  const head = 'It keeps the look of inspire-hub-acme';
  const tail = 'its sign-in and its data source, so everyone who opens it sees the same rows. For your own, choose Create new.';
  const text = w.joinedAppText({ ...hub, look });
  assert.equal(text, `${head} (Style A, Top tabs, the Ocean palette and Dark mode), ${tail}`);
  assert.equal(w.joinedAppText({ ...hub, look: { palette: 'earth' } }), `${head} (Style A, Sidebar, the Earth palette and Light mode), ${tail}`,
    'a partly recorded look fills in the defaults the agent fills in');
  assert.equal(w.joinedAppText({ ...hub, look: null }), `${head}, ${tail}`, 'never a guessed look');
  assert.match(w.joinedAppText({ ...hub, access: 'user', look: null }), /so each person sees only the rows their own access allows\./,
    'an App that signs each person in says so');
  assert.doesNotMatch(text, /[\u2013\u2014]/);
  assert.match(text, /choose Create new\.$/, 'it says how to get a look of its own, on the step where Create new is');
});

const STICK_UC = {
  id: 'N01-U07', Name: 'Predict which customers will churn next month', statement: 'Cut churn among loyal customers',
  primary_table: 'main.s.orders', tables_involved: 'main.s.orders,main.s.customers',
  elite_assessment: JSON.stringify({ decision: 'Which customers get a retention call this week', entity_key_column: 'main.s.orders.order_id' }),
};
const STICK_COLUMNS = {
  'main.s.orders': [{ column_name: 'order_id', data_type: 'STRING' }, { column_name: 'customer_id', data_type: 'STRING' },
    { column_name: 'order_date', data_type: 'DATE' }, { column_name: 'amount', data_type: 'DOUBLE' }],
  'main.s.customers': [{ column_name: 'customer_id', data_type: 'STRING' }, { column_name: 'segment', data_type: 'STRING' }],
};
const STICK_TABLES = ['main.s.orders', 'main.s.customers'];

test('the data step warns when one row of the result is not the use case\'s subject and names the key to group by', async () => {
  const w = await load();
  const spec = w.defaultSpecFromUseCase(STICK_UC, { warehouseId: 'wh1', inspireDatabase: 'main.inspire', owner: 'amr@example.com' });
  assert.deepEqual([w.keyNoun('customer_id'), w.keyNoun('custkey'), w.keyNoun('ws_bill_customer_sk'), w.keyNoun('OrderID'), w.keyNoun('amount')],
    ['customer', 'cust', 'customer', 'order', '']);
  const check = w.grainCheck(spec, STICK_UC, STICK_COLUMNS, STICK_TABLES);
  assert.equal(check.state, 'mismatch');
  assert.deepEqual([check.subject.noun, check.rowNoun, check.row.ref, check.row.chosen, check.suggest.ref],
    ['customer', 'order', 'main.s.orders.order_id', false, 'main.s.orders.customer_id'], 'the key is grouped inside the table the rows come from');
  assert.equal(w.grainText(check), 'This use case is about customers, but one row of the result would be one order (main.s.orders.order_id). '
    + 'Group the rows by customer_id so one row is one customer.');
  const grouped = w.withEntityKey(spec, check.suggest.ref);
  assert.equal(grouped.data.column_roles.entity_id, 'main.s.orders.customer_id');
  const ok = w.grainCheck(grouped, STICK_UC, STICK_COLUMNS, STICK_TABLES);
  assert.equal(ok.state, 'ok');
  assert.equal(w.grainText(ok), 'One row of the result is one customer (main.s.orders.customer_id).');
  const kept = w.withEntityKey(spec, 'main.s.orders.order_id');
  const chosen = w.grainCheck(kept, STICK_UC, STICK_COLUMNS, STICK_TABLES);
  assert.deepEqual([chosen.state, chosen.row.chosen], ['mismatch', true]);
  assert.equal(w.grainText(chosen), 'One row of the result is one order (main.s.orders.order_id), as you chose. This use case is about customers: '
    + 'group by customer_id instead if one row should be one customer.');
  assert.deepEqual(w.stepErrors('data', kept, { columnsByTable: STICK_COLUMNS }).filter((e) => !/catalog and a schema/.test(e)), [], 'the person\'s choice never blocks the step');
  assert.deepEqual(w.entityKeyOptions(STICK_COLUMNS, STICK_TABLES).map((k) => k.ref),
    ['main.s.orders.order_id', 'main.s.orders.customer_id', 'main.s.customers.customer_id']);
  assert.equal(w.withEntityKey(kept, '').data.column_roles.entity_id, undefined, 'Inspire\'s choice clears the person\'s key');
  const swapped = { ...spec, data: { ...spec.data, tables: { 'main.s.orders': 'main.s.orders_v2' } } };
  assert.equal(w.rowKeyOf(swapped, STICK_UC).ref, 'main.s.orders_v2.order_id', 'Inspire\'s key follows a swapped table');
  const unknown = w.grainCheck(spec, { ...STICK_UC, Name: 'Forecast demand', statement: 'Plan stock', elite_assessment: '{}' }, STICK_COLUMNS, STICK_TABLES);
  assert.equal(unknown.state, 'unknown');
  assert.equal(w.grainText(unknown), '');
  const aligned = { ...STICK_UC, elite_assessment: JSON.stringify({ entity_key_column: 'main.s.customers.customer_id' }) };
  assert.equal(w.grainCheck(spec, aligned, STICK_COLUMNS, STICK_TABLES).state, 'ok');
  const category = w.grainCheck(spec, { ...STICK_UC, Name: 'Reprice categories', elite_assessment: JSON.stringify({ entity_key_column: 'main.s.orders.order_id' }) },
    { 'main.s.orders': [{ column_name: 'order_id', data_type: 'STRING' }, { column_name: 'category_id', data_type: 'STRING' }] }, ['main.s.orders']);
  assert.equal(w.grainText(category), 'This use case is about categories, but one row of the result would be one order (main.s.orders.order_id). '
    + 'Group the rows by category_id so one row is one category.');
});

test('the weekly value email is on by default when the alert has recipients and the person can turn it off', async () => {
  const w = await load();
  const spec = w.defaultSpecFromUseCase(STICK_UC, { warehouseId: 'wh1', inspireDatabase: 'main.inspire', owner: 'amr@example.com' });
  assert.equal(spec.outputs.alert_digest, true);
  const alerting = w.withOutput(spec, 'alert', true);
  assert.equal(w.digestOn(alerting.outputs), true, 'the alert picks the decision owner, so the email goes to them');
  assert.equal(w.digestOn(spec.outputs), false, 'no alert, no email');
  assert.equal(w.digestOn({ ...alerting.outputs, alert_recipients: [], alert_destinations: [] }), false, 'nobody to send it to');
  assert.equal(w.digestOn({ ...alerting.outputs, alert_recipients: [], alert_destinations: [{ id: 'dest-0001', name: 'Slack' }] }), true);
  const off = w.withDigest(alerting, false);
  assert.equal(off.outputs.alert_digest, false);
  assert.equal(w.digestOn(off.outputs), false);
  assert.equal(w.digestOn(w.withDigest(off, true).outputs), true);
  assert.match(w.DIGEST_BLURB, /what people acted on, how much of the target KPI is at stake, what changed against the records kept aside/);
  assert.match(w.DIGEST_BLURB, /Not reliable yet/);
  assert.deepEqual(served({ ...off, outputs: { ...off.outputs, alert_recipients: ['amr@example.com'] } }).errors, []);
});

test('the email when the alert clears is on by default when the alert has recipients and the person can turn it off', async () => {
  const w = await load();
  const spec = w.defaultSpecFromUseCase(STICK_UC, { warehouseId: 'wh1', inspireDatabase: 'main.inspire', owner: 'amr@example.com' });
  assert.equal(spec.outputs.alert_notify_on_ok, true);
  const alerting = w.withOutput(spec, 'alert', true);
  assert.equal(w.clearsOn(alerting.outputs), true);
  assert.equal(w.clearsOn(spec.outputs), false, 'no alert, no email when it clears');
  assert.equal(w.clearsOn({ ...alerting.outputs, alert_recipients: [], alert_destinations: [] }), false, 'nobody to send it to');
  const off = w.withClears(alerting, false);
  assert.equal(off.outputs.alert_notify_on_ok, false);
  assert.equal(w.clearsOn(off.outputs), false);
  assert.equal(w.digestOn(off.outputs), true, 'the weekly email is its own choice');
  assert.equal(w.clearsOn(w.withClears(off, true).outputs), true);
  const checked = served({ ...off, outputs: { ...off.outputs, alert_recipients: ['amr@example.com'] } });
  assert.deepEqual(checked.errors, []);
  assert.equal(checked.spec.outputs.alert_notify_on_ok, false, 'the backend keeps what the wizard sent');
});

const SHARED = {
  app: { id: 'churn-desk', use_cases: [{ session_id: '42', use_case_id: 'N01-U02', name: 'Forecast demand' }] },
  dashboard: null,
  genie_space: { id: 'g1', use_cases: [{ session_id: '7', use_case_id: 'N03-U04', name: '' }, { session_id: '42', use_case_id: 'N01-U05', name: 'Plan stock' }] },
};
const TAKE_OUT = "Take this use case's part out of churn-desk; it stays for Forecast demand";

test('a removed output other use cases share is taken out of, not deleted, in the plan, and an output only this use case holds is still deleted', async () => {
  const w = await load();
  const summary = { classes: ['deselect'], refill: false, build: [], refresh: [], delete: ['app', 'dashboard'], keep_unmanaged: [], schedule: false };
  assert.deepEqual(w.planLines(summary, { shared: SHARED }), [
    'Changes: deselect',
    'The built notebook is kept as it is',
    'Deletes: Dashboard',
    TAKE_OUT,
  ]);
  assert.deepEqual(w.planLines(summary).slice(-1), ['Deletes: App, Dashboard'], 'without a sharing check the plan reads as before');
  assert.deepEqual(w.planLines({ ...summary, delete: ['app'] }, { shared: { ...SHARED, app: null } }).slice(-1), ['Deletes: App'],
    'an App the check found no other use case in is deleted');
  assert.deepEqual(w.planLines({ ...summary, delete: ['app'] }, { shared: SHARED }).filter((l) => l.startsWith('Deletes')), [],
    'no empty Deletes line when every removed output is shared');
  assert.deepEqual(w.planLines({ ...summary, delete: [], keep_unmanaged: ['app'] }, { shared: SHARED }).slice(-1), ['Leaves in place, no longer managed: App'],
    'an output kept unmanaged is not taken out of anything');
});

test('the shared holding names the asset from the live check when it can, names each use case and shortens a long list', async () => {
  const w = await load();
  assert.equal(w.sharedHolding('app', null), null);
  assert.equal(w.sharedHolding('dashboard', SHARED), null, 'a dashboard only this use case holds is not shared');
  assert.equal(w.sharedHolding('alert', SHARED), null, 'an alert is never shared');
  assert.equal(w.sharedHolding('app', { app: { id: 'churn-desk', use_cases: [] } }), null, 'nobody else holds it');
  assert.equal(w.takeOutText(w.sharedHolding('app', SHARED)), TAKE_OUT);
  assert.equal(w.takeOutText(w.sharedHolding('genie_space', SHARED)), "Take this use case's part out of g1; it stays for N03-U04 and Plan stock",
    'a use case without a name is named by its id');
  const live = { assets: { genie_space: { ok: true, title: 'Churn agent' }, app: { ok: true, name: 'churn-desk' } } };
  assert.equal(w.takeOutText(w.sharedHolding('genie_space', SHARED, live)), "Take this use case's part out of Churn agent; it stays for N03-U04 and Plan stock");
  const many = (n) => ({ app: { id: 'hub', use_cases: Array.from({ length: n }, (_, i) => ({ use_case_id: `N0${i + 1}-U01`, name: `Use case ${i + 1}` })) } });
  assert.equal(w.takeOutText(w.sharedHolding('app', many(3))), "Take this use case's part out of hub; it stays for Use case 1, Use case 2 and Use case 3");
  assert.equal(w.takeOutText(w.sharedHolding('app', many(5))), "Take this use case's part out of hub; it stays for Use case 1, Use case 2 and 3 more use cases");
  assert.equal(w.holdersText(['A']), 'A');
});

test('the latest plan check of who shares an output wins over the Build page live check, which counts only until a plan has checked', async () => {
  const w = await load();
  const live = { shared: { app: { id: 'churn-desk', use_cases: [{ use_case_id: 'N01-U09', name: 'Old holder' }] } } };
  assert.equal(w.sharedSource(SHARED, live), SHARED);
  assert.equal(w.sharedSource(null, live), live.shared);
  assert.equal(w.sharedSource(undefined, { shared: null }), null, 'a live check that could not read the registry knows nothing');
  assert.equal(w.sharedSource(null, null), null);
  assert.equal(w.sharedHolding('app', w.sharedSource({ ...SHARED, app: null }, live)), null,
    'once the plan found nobody else in the App, an older live check that did never brings the take-out wording back');
  assert.equal(w.takeOutText(w.sharedHolding('app', w.sharedSource(null, live))), "Take this use case's part out of churn-desk; it stays for Old holder");
});

const fs = require('node:fs');
const frontendSources = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  if (entry.isDirectory()) return frontendSources(full);
  return entry.isFile() && /\.(js|jsx)$/.test(entry.name) ? [full] : [];
});

test('one helper writes every A, B and C list on the wizard and the Build page, and use cases past three are counted', async () => {
  const w = await load();
  assert.deepEqual([[], ['A'], ['A', 'B'], ['A', 'B', 'C'], ['A', 'B', 'C', 'D']].map(w.joinWords), ['', 'A', 'A and B', 'A, B and C', 'A, B, C and D']);
  assert.deepEqual([['A'], ['A', 'B'], ['A', 'B', 'C'], ['A', 'B', 'C', 'D']].map(w.holdersText), ['A', 'A and B', 'A, B and C', 'A, B and 2 more use cases']);
  const c = await import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', 'implementControl.js')).href);
  assert.equal(c.takenOutText({ state: 'released', taken_out_of: 'hub', stays_for: ['A', 'B', 'C', 'D'] }, 'app'),
    "This use case's pages were taken out of hub, which stays for A, B and 2 more use cases.");
  const root = path.resolve(__dirname, '..', '..', 'frontend', 'src');
  const copies = frontendSources(root).flatMap((file) => [...fs.readFileSync(file, 'utf8').matchAll(/\.slice\(0, -1\)\.join\(', '\)/g)]
    .map(() => path.relative(root, file)));
  assert.deepEqual(copies, [path.join('lib', 'implementWizard.js')], 'every list joins through joinWords, never its own copy');
  const named = frontendSources(root).filter((file) => /function (namesText|andList)\b/.test(fs.readFileSync(file, 'utf8')));
  assert.deepEqual(named, []);
});

test('personal or card-number columns are never offered or accepted as the key of the result, and the data step says why (must-exclude)', async () => {
  const w = await load();
  const P = await import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', 'personalColumns.js')).href);
  const G = require('../lib/groupingRule.js');
  assert.equal(G.PERSONAL_NAME_RE, P.PERSONAL_NAME_RE, 'one personal-column rule for grouping and the result key');
  const columns = { 'main.s.payments': ['payment_id', 'customer_id', 'cardNumber', 'card_no', 'email_id', 'phone_number', 'ssn', 'iban', 'account_number', 'card_type']
    .map((column_name) => ({ column_name, data_type: 'STRING' })) };
  const offered = w.entityKeyOptions(columns, ['main.s.payments']).map((k) => k.column);
  for (const personal of ['cardNumber', 'card_no', 'email_id', 'phone_number', 'account_number']) assert.ok(!offered.includes(personal), personal);
  assert.deepEqual(offered.filter((c) => ['payment_id', 'customer_id'].includes(c)), ['payment_id', 'customer_id'], 'entity ids stay (must-keep)');
  assert.equal(w.columnRoleProblem('entity_id', 'cardNumber', 'STRING'), P.PERSONAL_KEY_REASON);
  assert.equal(w.columnRoleProblem('entity_id', 'customer_id', 'STRING'), '');
  assert.equal(w.columnRoleProblem('segment', 'card_type', 'STRING'), '', 'only the key role is refused');
  const uc = { ...STICK_UC, Name: 'Flag risky payments', statement: 'Flag payments for review',
    elite_assessment: JSON.stringify({ entity_key_column: 'main.s.payments.cardNumber' }) };
  const spec = w.defaultSpecFromUseCase(uc, { warehouseId: 'wh1', inspireDatabase: 'main.inspire', owner: 'amr@example.com' });
  const check = w.grainCheck(spec, uc, columns, ['main.s.payments']);
  assert.equal(check.state, 'personal');
  assert.equal(check.suggest.ref, 'main.s.payments.payment_id');
  assert.equal(w.grainText(check), "Inspire's own key main.s.payments.cardNumber holds personal details, so the build keys the result on "
    + 'another key of its table, or on a hashed copy when there is none. Pick the entity key below to choose it yourself.');
  const picked = w.withEntityKey(spec, 'main.s.payments.cardNumber');
  assert.equal(w.grainText(w.grainCheck(picked, uc, columns, ['main.s.payments'])),
    `main.s.payments.cardNumber cannot be the key of the result: ${P.PERSONAL_KEY_REASON}.`, 'a key the user picked is refused');
  assert.deepEqual(w.columnRoleProblems(picked.data.column_roles, columns), [`entity id main.s.payments.cardNumber: ${P.PERSONAL_KEY_REASON}`]);
  assert.equal(w.grainCheck(w.withEntityKey(spec, 'main.s.payments.payment_id'), uc, columns, ['main.s.payments']).state === 'personal', false);
});

test('a column with an innocent name but a PII, personal or sensitive Unity Catalog tag is never the result key; an untagged one is', async () => {
  const w = await load();
  const P = await import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', 'personalColumns.js')).href);
  const columns = { 'main.s.payments': [
    { column_name: 'payment_id', data_type: 'STRING', tags: {} },
    { column_name: 'ref_code', data_type: 'STRING', tags: { data_class: 'pii' } },
    { column_name: 'member_ref', data_type: 'STRING', tags: { Classification: 'Sensitive' } },
    { column_name: 'holder_key', data_type: 'STRING', tags: { PERSONAL_DATA: '' } },
    { column_name: 'store_code', data_type: 'STRING', tags: { owner: 'finance', tier: 'gold' } },
  ] };
  const offered = w.entityKeyOptions(columns, ['main.s.payments']).map((k) => k.column);
  for (const tagged of ['ref_code', 'member_ref', 'holder_key']) assert.ok(!offered.includes(tagged), tagged);
  assert.ok(offered.includes('payment_id') && offered.includes('store_code'), 'untagged or ordinary-tagged keys stay (must-keep)');
  const roles = { entity_id: 'main.s.payments.ref_code' };
  assert.deepEqual(w.columnRoleProblems(roles, columns), [`entity id main.s.payments.ref_code: ${P.PERSONAL_KEY_REASON}`]);
  assert.deepEqual(w.columnRoleProblems({ entity_id: 'main.s.payments.store_code' }, columns), []);
  const uc = { ...STICK_UC, Name: 'Flag risky payments', statement: 'Flag payments for review',
    elite_assessment: JSON.stringify({ entity_key_column: 'main.s.payments.ref_code' }) };
  const spec = w.defaultSpecFromUseCase(uc, { warehouseId: 'wh1', inspireDatabase: 'main.inspire', owner: 'amr@example.com' });
  assert.equal(w.grainCheck(spec, uc, columns, ['main.s.payments']).state, 'personal', 'a tagged key Inspire picked is flagged too');
  assert.equal(P.personalColumn('ref_code', {}), false, 'without tags the innocent name passes the name rule');
});

test('a column Data Classification tagged class.* with no value is never the result key, in the wizard default, its options and the submit check', async () => {
  const w = await load();
  const P = await import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', 'personalColumns.js')).href);
  const I = require('../lib/inspireImplement.js');
  const classified = { 'class.email_address': '' };
  const columns = { 'main.s.members': [
    { column_name: 'member_id', data_type: 'STRING', tags: {} },
    { column_name: 'contact_ref', data_type: 'STRING', tags: classified },
    { column_name: 'holder_code', data_type: 'STRING', tags: { 'class.credit_card': '' } },
    { column_name: 'plan_code', data_type: 'STRING', tags: { class: 'internal', subclass: 'x', 'business.class': 'gold' } },
  ] };
  assert.equal(P.personalColumn('contact_ref', classified), true);
  assert.equal(P.personalColumn('contact_ref', { 'class.name': '' }), true);
  assert.equal(P.personalColumn('plan_code', { class: 'internal', 'business.class': 'gold' }), false, 'a tag named class with no dot is not a classification (must-exclude)');
  const offered = w.entityKeyOptions(columns, ['main.s.members']).map((k) => k.column);
  assert.ok(!offered.includes('contact_ref') && !offered.includes('holder_code'), 'classified columns are never offered');
  assert.ok(offered.includes('member_id') && offered.includes('plan_code'), 'unclassified keys stay (must-keep)');
  const uc = { ...STICK_UC, Name: 'Win back lapsed members', statement: 'Find members to win back',
    elite_assessment: JSON.stringify({ entity_key_column: 'main.s.members.contact_ref' }) };
  const spec = w.defaultSpecFromUseCase(uc, { warehouseId: 'wh1', inspireDatabase: 'main.inspire', owner: 'amr@example.com' });
  const check = w.grainCheck(spec, uc, columns, ['main.s.members']);
  assert.equal(check.state, 'personal', 'the auto-picked classified key is flagged on the wizard default');
  assert.equal(check.suggest.ref, 'main.s.members.member_id');
  const tags = { 'main.s.members.contact_ref': classified };
  assert.equal(I.personalKeyOf(spec, uc, tags), '', "Inspire's own classified key never blocks the build: the build keys on another key");
  assert.equal(I.personalKeyOf(w.withEntityKey(spec, 'main.s.members.contact_ref'), uc, tags),
    `column role entity_id main.s.members.contact_ref: ${P.PERSONAL_KEY_REASON}`, 'a classified key the user picked is refused (must-exclude)');
  assert.equal(I.personalKeyOf(w.withEntityKey(spec, 'main.s.members.member_id'), uc, tags), '', 'the chosen unclassified key passes the submit check');
});

test('a fresh Full MVP lists every step and the wizard offers no shortcut that hides them', async () => {
  const w = await load();
  assert.deepEqual(w.wizardSteps('mvp', { outputs: { app: true } }, { grouping: true, firstRun: true }).map((s) => s.label),
    ['What to deliver', 'Data & results', 'Data groups', 'First run', 'Measure', 'Where it lives', 'Who uses the App', 'App look', 'Run it', 'Review & build']);
  assert.deepEqual(w.wizardSteps('mvp', { outputs: { app: false, dashboard: true } }, { grouping: true, firstRun: true }).map((s) => s.label),
    ['What to deliver', 'Data & results', 'Data groups', 'First run', 'Measure', 'Run it', 'Review & build'], 'with Apps unticked both App steps are hidden');
  assert.equal(w.BUILD_IT_LABEL, 'All Good, Build it Now');
  for (const gone of ['shownSteps', 'quickSteps', 'customizeFromFocus', 'hiddenStepGaps', 'START_STEP', 'QUICK_PATH_NOTE', 'CUSTOMIZE_LABEL', 'quickSummary']) {
    assert.equal(w[gone], undefined, gone);
  }
  assert.throws(() => w.stepErrors('start', w.defaultSpecFromUseCase(UC, { warehouseId: 'wh', inspireDatabase: 'main.inspire' })), /unknown wizard step 'start'/);
});

test('Summary lists every chosen option with the step that changes it, holds no vibes or settings row, and Change returns to Summary', async () => {
  const w = await load();
  const spec = w.defaultSpecFromUseCase(UC, { warehouseId: 'wh', inspireDatabase: 'main.inspire' });
  const picked = { ...spec, config: { ...spec.config, result_table: 'main.inspire.churn_out' },
    outputs: { ...spec.outputs, dashboard: true, genie_space: true, app: false, alert: false }, schedule: { enabled: true, cron: '0 0 6 * * ?', timezone: 'UTC' } };
  const built = 'The MVP: Dashboard, Genie Agent, the result table and the notebook that fills it';
  assert.deepEqual(w.pickedSummary(picked, ['main.s.orders', 'main.s.returns']).map((r) => [r.id, r.value, r.step]), [
    ['outputs', built, 'delivery'], ['data', 'main.s.orders, main.s.returns', 'data'], ['result', 'main.inspire.churn_out', 'data'],
    ['kpi', 'Inspire picks', 'run'], ['holdout', 'On, 10% kept aside', 'run'], ['schedule', 'Daily, runs every day at 06:00 UTC', 'data']]);
  assert.equal(w.builtSentence(picked), `${built}.`);
  const bare = w.pickedSummary({ ...picked, config: { ...picked.config, result_table: '' }, schedule: { enabled: true, cron: '0 15 3 * * ?', timezone: 'UTC' } }, []);
  assert.deepEqual(bare.map((r) => r.value), [built, 'none', 'not named yet', 'Inspire picks', 'On, 10% kept aside', 'Custom, runs every day at 03:15 UTC']);
  assert.equal(w.pickedSummary({ ...picked, schedule: { enabled: false } }).find((r) => r.id === 'schedule').value, 'Off, it runs once');
  const withApp = { ...picked, outputs: { ...picked.outputs, app: true, app_name: 'churn-desk-2' } };
  const full = w.pickedSummary(withApp, ['a'], { grouping: 'region · 4 groups', firstRun: 'about 1,000 records', settings: 'Act now share 0.05' });
  assert.deepEqual(full.map((r) => r.id), ['outputs', 'data', 'grouping', 'first_run', 'result', 'kpi', 'holdout', 'schedule', 'app', 'app_access', 'app_features', 'app_look']);
  assert.equal(full.find((r) => r.id === 'app').step, 'where', 'the App row opens Where it lives');
  const steps = w.wizardSteps('mvp', withApp, { grouping: true, firstRun: true }).map((s) => s.id);
  for (const row of full) assert.ok(steps.includes(row.step), `${row.id} changes on a step the wizard shows`);
  assert.equal(full.find((r) => r.id === 'grouping').step, 'grouping', 'Data groups change on Data groups');
  assert.deepEqual(full.filter((r) => r.step === 'where').map((r) => r.id), ['app', 'app_features'], 'the App pages change on Where it lives');
  assert.deepEqual(full.filter((r) => r.step === 'app_look').map((r) => r.id), ['app_look'], 'the App look changes on its own step');
  assert.equal(full.find((r) => r.id === 'app_features').value, 'Record decisions');
  assert.equal(full.some((r) => /capacity|settings|vibes/i.test(`${r.id} ${r.label}`)), false, 'no Team capacity, settings or vibes row (must-exclude)');
  assert.deepEqual(full.find((r) => r.id === 'app'), { id: 'app', step: 'where', label: 'App', value: 'One App per business domain: churn-desk-2' });
  assert.equal(w.pickedSummary({ ...withApp, outputs: { ...withApp.outputs, merge: { app: 'finance-desk' } } }).find((r) => r.id === 'app').value, 'Joins finance-desk');
  assert.equal(w.pickedSummary({ ...withApp, outputs: { ...withApp.outputs, app: false } }).some((r) => ['app', 'app_access', 'app_features', 'app_look'].includes(r.id)), false,
    'with Apps unticked Summary shows no App row (must-exclude)');
  const dropped = w.pickedSummary(picked, [], { dropped: [{ id: 'app', label: 'App', why: 'Needs access Inspire does not have yet.' }] });
  assert.deepEqual(dropped.find((r) => r.id === 'dropped'), { id: 'dropped', step: 'delivery', label: 'Not built', value: 'App: Needs access Inspire does not have yet.' });
  const list = w.wizardSteps('mvp', withApp);
  assert.equal(w.nextStepAfter(list, 'data'), 'stake');
  assert.equal(w.nextStepAfter(list, 'results', { backToSummary: true, visited: ['data', 'delivery', 'stake', 'where', 'app', 'app_look', 'run'] }), 'summary',
    'Change then Next goes back to Summary');
  assert.equal(w.nextStepAfter(list, 'delivery', { backToSummary: true, visited: ['data', 'delivery', 'stake', 'run'] }), 'where',
    'ticking the App on Change walks Where it lives and the new App steps before Summary');
  assert.equal(w.nextStepAfter(list, 'app', { backToSummary: true, visited: ['data', 'delivery', 'stake', 'where', 'app', 'run'] }), 'app_look');
  assert.equal(w.nextStepAfter(list, 'summary'), 'summary');
  assert.equal(w.appRenamedText('churn-desk', 'churn-desk-2'), "'churn-desk' is used by another App in this workspace, so Inspire named this App 'churn-desk-2'.");
});

test('each step heading is one short question of at most 8 words, and the access question is named (must-exclude: long headings)', async () => {
  const w = await load();
  for (const heading of [w.RUN_IT_TITLE, w.APP_ACCESS_QUESTION, w.DELIVERY_QUESTION]) {
    assert.match(heading, /\?$/, heading);
    assert.ok(heading.split(' ').length <= 8, `${heading} has ${heading.split(' ').length} words`);
  }
  assert.equal(w.RUN_IT_TITLE, 'How often should it run?');
  assert.equal(w.APP_ACCESS_QUESTION, 'Who sees which rows?');
});
