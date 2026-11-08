const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const I = require('../lib/inspireImplement');
const { makeApp, listen } = require('./support/implementApp');
const FIXTURE = require('../../agent/tests/fixtures/implement_change_classes.json');

const lib = (name) => import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', name)).href);

const OWNER = ['owner', 'example.com'].join('@');
const APP_OWNER = ['lee', 'example.com'].join('@');
const OTHER = ['someone.else', 'example.com'].join('@');
const PERSON = 'person-token';
const APP_URL = 'https://churn-desk-1.aws.databricksapps.com';
const DB = { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42' };
const Q = 'inspire_database=main.inspire&warehouse_id=wh1&session_id=42&use_case_id=N01-U01';
const BASE = {
  use_case_id: 'N01-U01',
  use_case_name: 'Predict churn',
  config: { warehouse_id: 'wh1', result_table: 'main.inspire.churn_out', widgets: { act_now_share: '0.05' } },
  outputs: { dashboard: true, inspire_url: 'https://inspire.example.com' },
};
const MODEL = [
  { name: 'WEEKS_LEFT', label: 'Weeks left', group: 'impact', kind: 'number', low: 1, high: 52, allowed: '1 to 52', source: 'assumption', default: 12,
    reason: 'the value the notebook defines', applies: 'app_and_run' },
  { name: 'act_now_share', label: 'Act now share', group: 'flagging', kind: 'percent', low: 0, high: 1, allowed: '0 to 1', source: 'widget', default: '0.05',
    reason: "Inspire's default", applies: 'run' },
  { name: 'review_share', label: 'Review share', group: 'flagging', kind: 'percent', low: 0, high: 1, allowed: '0 to 1', source: 'widget', default: '0.15',
    reason: "Inspire's default", applies: 'run' },
];
const WIDGETS = [{ name: 'act_now_share', type: 'text', default: '0.05', allowed: '0 to 1' }, { name: 'review_share', type: 'text', default: '0.15', allowed: '0 to 1' },
  { name: 'top_k', type: 'text', default: '25', allowed: 'whole number, at least 1' }];

function clean(top = {}) {
  const out = I.validateImplementSpec({ ...JSON.parse(JSON.stringify(BASE)), ...top });
  assert.deepEqual(out.errors, [], JSON.stringify(top));
  return out.spec;
}

const builtRow = ({ assets = {}, ...extra } = {}) => ({
  session_id: '42', use_case_id: 'N01-U01', spec_version: 1, status: 'ready', created_by: OWNER, updated_at: '2026-10-21T04:00:00Z',
  spec_json: JSON.stringify({ ...clean(), outputs: { dashboard: true, app: true, app_name: 'churn-desk', app_access: 'sp', app_owners: [APP_OWNER], genie_space: true, inspire_url: 'https://inspire.example.com' } }),
  notebook_path: '/W/impl/N01-U01', job_id: '77', dashboard_id: 'd1', dashboard_url: 'https://w/d1', app_name: 'churn-desk', app_url: APP_URL,
  genie_widgets: JSON.stringify(WIDGETS),
  asset_status: JSON.stringify({ dashboard: { state: 'ready', spec_version: 1 }, notebook: { state: 'ready', spec_version: 1, result_history: 1 },
    app: { state: 'ready', spec_version: 1 }, settings: MODEL, ...assets }),
  ...extra,
});

async function withApp(overrides, run) {
  const made = makeApp({ history: [builtRow()], ...overrides });
  const srv = await listen(made.app);
  try {
    await run(srv.url, made);
  } finally {
    await srv.close();
  }
}

async function call(base, url, { method = 'GET', body, who = OWNER } = {}) {
  const resp = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'x-forwarded-email': who }, body: body ? JSON.stringify(body) : undefined });
  return { status: resp.status, data: await resp.json() };
}

const inserts = (made) => made.sqlCalls.filter((c) => String(c.sql).includes('INSERT INTO') && (c.parameters || []).some((p) => p.name === 'spec'))
  .map((c) => JSON.parse(c.parameters.find((p) => p.name === 'spec').value));

const editOf = (config) => ({ ...BASE, based_on_version: 1, outputs: { dashboard: true, app: true, app_name: 'churn-desk', app_access: 'sp', app_owners: [APP_OWNER], genie_space: true },
  config: { ...BASE.config, ...config } });

test('the change classes and plans of a notebook built with settings are the agent fixture rows, so only a value-only change of a setting it reads skips the rebuild', () => {
  const rows = FIXTURE.cases.filter((c) => Object.hasOwn(c, 'built_settings') || c.name === 'the same widget value change on an older notebook');
  assert.equal(rows.length, 11);
  for (const c of rows) {
    const previous = c.previous ? I.validateImplementSpec(c.previous).spec : null;
    assert.deepEqual(I.classifyImplementChange(previous, I.validateImplementSpec(c.current).spec, c.built_settings), c.classes, c.name);
  }
  const plans = FIXTURE.plans.filter((p) => rows.some((c) => c.name === p.case));
  assert.equal(plans.length, 7);
  for (const p of plans) {
    const c = FIXTURE.cases.find((x) => x.name === p.case);
    const s = I.implementChangeSummary(I.validateImplementSpec(c.previous).spec, I.validateImplementSpec(c.current).spec, p.assets, c.built_settings);
    assert.deepEqual([s.classes, s.refill, [...s.build].sort(), [...s.refresh].sort(), s.schedule],
      [p.summary.classes, p.summary.refill, p.summary.build, p.summary.refresh, p.summary.schedule], p.name);
  }
  assert.ok(I.IMPLEMENT_CHANGE_CLASSES.includes('settings'));
  assert.deepEqual(I.implementBuiltSettings({ settings: MODEL }), ['act_now_share', 'review_share'], 'only widget settings are built into the notebook');
  assert.deepEqual(I.implementBuiltSettings({}), []);
  assert.deepEqual(I.validateImplementSpec(BASE).spec.config.assumptions, {}, 'the spec always carries the assumptions it sets, like the agent');
});

test('a setting value and an assumption range are decided exactly as the agent decides them, in the backend and in the wizard', async () => {
  const S = await lib('useCaseSettings.js');
  assert.ok(FIXTURE.setting_values.length >= 30);
  for (const row of FIXTURE.setting_values) {
    assert.equal(I.implementSettingProblem(row.setting, row.value), row.problem, `backend ${JSON.stringify(row)}`);
    assert.equal(S.settingProblem(row.setting, row.value), row.problem, `wizard ${JSON.stringify(row)}`);
  }
  assert.equal(FIXTURE.assumption_settings.length, 8);
  for (const row of FIXTURE.assumption_settings) {
    assert.deepEqual(I.implementAssumptionSetting(row.name, row.kind, row.low, row.high), row.setting, `backend ${row.name}`);
    assert.deepEqual(S.assumptionSetting(row.name, row.kind, row.low, row.high), row.setting, `wizard ${row.name}`);
  }
  const tables = FIXTURE.contract_tables;
  assert.deepEqual([S.SETTING_ALL, S.ASSUMPTION_BOUNDS, S.NOT_SETTINGS, S.TIER_SETTINGS, S.FAMILY_FLAGGING, S.SETTING_GROUPS],
    [tables.INSPIRE_SETTING_ALL, tables.INSPIRE_ASSUMPTION_BOUNDS, tables.INSPIRE_NOT_SETTINGS, tables.INSPIRE_TIER_SETTINGS, tables.INSPIRE_FAMILY_FLAGGING,
      tables.INSPIRE_SETTING_GROUPS]);
});

test('a percent setting reads as a whole percent and is never shown as a raw fraction with a percent sign', async () => {
  const S = await lib('useCaseSettings.js');
  const percent = { name: 'act_now_share', kind: 'percent', unit: '%' };
  for (const [value, text] of [['0.99', '99%'], ['0.08', '8%'], ['0.1', '10%'], [0.05, '5%'], ['0.125', '12.5%'], ['1', '100%'], ['0', '0%'], ['0.07', '7%']]) {
    assert.equal(S.settingValueText(percent, value), text, String(value));
  }
  assert.equal(S.settingValueText(percent, 'n/a'), 'n/a', 'text that is not a number is shown as it is');
  assert.equal(S.settingValueText(percent, ''), '');
  assert.equal(S.settingValueText({ kind: 'number', unit: '%' }, '12'), '12%', 'a value already in percent keeps its number');
  assert.equal(S.settingValueText({ kind: 'number', unit: 'days' }, '30'), '30 days');
  assert.equal(S.settingValueText({ kind: 'number' }, '3'), '3');
  assert.equal(S.settingUnitLabel(percent), '', 'the field label names no unit for a percent the text already shows');
  assert.equal(S.settingUnitLabel({ kind: 'number', unit: 'days' }), ' (days)');
  assert.equal(S.settingHistoryLine({ name: 'act_now_share', kind: 'percent', value: '0.08', changed_by: OWNER }, [{ ...percent, label: 'Act now share' }]),
    `${OWNER} set Act now share to 8%`);
});

test('a value-only settings change from Vibe/Add/Remove Features saves without a rebuild and only for an owner, while a value for a widget the notebook does not read still rebuilds', async () => {
  await withApp({}, async (url, made) => {
    const plan = await call(url, '/api/inspire/implement/plan', { method: 'POST', body: { ...DB, spec: editOf({ widgets: { act_now_share: '0.1' } }) } });
    assert.equal(plan.status, 200, JSON.stringify(plan.data));
    assert.deepEqual([plan.data.summary.classes, plan.data.summary.refill, plan.data.summary.refresh, plan.data.summary.schedule], [['settings'], false, [], false]);
    const other = await call(url, '/api/inspire/implement/submit', { method: 'POST', body: { ...DB, spec: editOf({ widgets: { act_now_share: '0.1' } }) }, who: OTHER });
    assert.deepEqual([other.status, other.data.error],
      [403, 'Only the owners of this use case can change its settings: the person who asked for v1 and the App owners it names']);
    assert.equal(made.jobs.length, 0, 'a refused settings change starts nothing');
    const owner = await call(url, '/api/inspire/implement/submit', { method: 'POST', body: { ...DB, spec: editOf({ widgets: { act_now_share: '0.1' } }) }, who: APP_OWNER });
    assert.equal(owner.status, 200, JSON.stringify(owner.data));
    assert.deepEqual(inserts(made)[0].config.widgets, { act_now_share: '0.1' });
    assert.equal(made.jobs.length, 1, 'the agent saves the value as a setting in its run, with no Genie round');
  });
  await withApp({}, async (url) => {
    const plan = await call(url, '/api/inspire/implement/plan', { method: 'POST', body: { ...DB, spec: editOf({ widgets: { act_now_share: '0.05', top_k: '10' } }) }, who: OTHER });
    assert.equal(plan.status, 200, JSON.stringify(plan.data));
    assert.deepEqual([plan.data.summary.classes, plan.data.summary.refill], [['config'], true], 'a widget the settings model does not read rebuilds, as before');
  });
  await withApp({ history: [builtRow({ asset_status: JSON.stringify({ dashboard: { state: 'ready', spec_version: 1 }, notebook: { state: 'ready', spec_version: 1 } }) })] }, async (url) => {
    const plan = await call(url, '/api/inspire/implement/plan', { method: 'POST', body: { ...DB, spec: editOf({ widgets: { act_now_share: '0.1' } }) } });
    assert.deepEqual([plan.data.summary.classes, plan.data.summary.refill], [['config'], true], 'a notebook built before settings rebuilds');
  });
});

test('assumption values are checked against the recorded ranges before any work, with the agent text', async () => {
  await withApp({}, async (url, made) => {
    const high = await call(url, '/api/inspire/implement/submit', { method: 'POST', body: { ...DB, spec: editOf({ assumptions: { WEEKS_LEFT: 60 } }) } });
    assert.deepEqual([high.status, high.data.error], [400, "assumption values are out of range: WEEKS_LEFT is '60'; allowed: 1 to 52"]);
    const unknown = await call(url, '/api/inspire/implement/plan', { method: 'POST', body: { ...DB, spec: editOf({ assumptions: { NOPE: 1, WEEKS_LEFT: '0.5' } }) } });
    assert.deepEqual([unknown.status, unknown.data.error],
      [400, "assumption values are out of range: the notebook has no assumption NOPE; its assumptions: WEEKS_LEFT; WEEKS_LEFT is '0.5'; allowed: 1 to 52"]);
    assert.equal(made.jobs.length, 0);
    const ok = await call(url, '/api/inspire/implement/plan', { method: 'POST', body: { ...DB, spec: editOf({ assumptions: { WEEKS_LEFT: '20' } }) } });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.deepEqual(ok.data.summary.classes, ['settings']);
  });
  assert.deepEqual(I.implementAssumptionProblems({ config: { assumptions: { WEEKS_LEFT: 60 } } }, null), [], 'with no recorded model the agent decides at build');
});

test('the Build page reads, previews, saves and runs the settings through the use case\u2019s App with the person\u2019s own sign-in and never the Inspire token', async () => {
  const view = { settings: [{ ...MODEL[1], value: '0.05', saved: false, editable: true }], history: [], editable: true, why: '', can_run: true, job: true };
  const appApi = {
    'GET /api/settings': [view],
    'POST /api/settings/preview': [{ exact: true, moves: [{ from: 'Review', to: 'Act now', n: 4 }], text: '4 records from Review to Act now.' }],
    'POST /api/settings/save': [{ ...view, settings: [{ ...view.settings[0], value: '0.1', saved: true }] }],
    'POST /api/settings/run': [{ ok: true, run_id: 12 }],
  };
  await withApp({ forwardedToken: PERSON, appApi }, async (url, made) => {
    const got = await call(url, `/api/inspire/implement/settings?${Q}`);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.deepEqual([got.data.source, got.data.editable, got.data.can_run, got.data.settings[0].name], ['app', true, true, 'act_now_share']);
    assert.deepEqual(got.data.app, { url: APP_URL, page: 'n01_u01' });
    const preview = await call(url, `/api/inspire/implement/settings/preview?${Q}`, { method: 'POST', body: { name: 'act_now_share', value: '0.1' } });
    assert.deepEqual(preview.data, appApi['POST /api/settings/preview'][0]);
    const saved = await call(url, `/api/inspire/implement/settings/save?${Q}`, { method: 'POST', body: { name: 'act_now_share', value: '0.1', was: '0.05', note: 'more to act on' } });
    assert.equal(saved.data.settings[0].value, '0.1');
    const ran = await call(url, `/api/inspire/implement/settings/run?${Q}`, { method: 'POST', body: {} });
    assert.equal(ran.status, 200);
    assert.deepEqual(made.appCalls.map((c) => [c.method, c.url, c.body]), [
      ['GET', `${APP_URL}/api/settings?page=n01_u01`, null],
      ['POST', `${APP_URL}/api/settings/preview`, { page: 'n01_u01', name: 'act_now_share', value: '0.1' }],
      ['POST', `${APP_URL}/api/settings/save`, { page: 'n01_u01', name: 'act_now_share', value: '0.1', was: '0.05', note: 'more to act on' }],
      ['POST', `${APP_URL}/api/settings/run`, { page: 'n01_u01' }],
    ]);
    assert.ok(made.appCalls.every((c) => c.headers.Authorization === `Bearer ${PERSON}`), 'every call carries the person\u2019s own token');
    assert.ok(made.appCalls.every((c) => !JSON.stringify(c.headers).includes('tok"') && !JSON.stringify(c.headers).includes('Bearer tok')), 'and never the Inspire token');
  });
  const refusal = 'Only the owners of this use case can change its settings';
  await withApp({ forwardedToken: PERSON, appApi: { 'POST /api/settings/save': [{ error: refusal }, 403], 'POST /api/settings/run': [{ error: 'a run is already active' }, 409] } }, async (url) => {
    const save = await call(url, `/api/inspire/implement/settings/save?${Q}`, { method: 'POST', body: { name: 'act_now_share', value: '0.1', was: '0.05' }, who: OTHER });
    assert.deepEqual([save.status, save.data.error], [403, refusal], 'the App\u2019s own owner check and text');
    const run = await call(url, `/api/inspire/implement/settings/run?${Q}`, { method: 'POST', body: {} });
    assert.deepEqual([run.status, run.data.error], [409, 'a run is already active']);
  });
  const joined = builtRow({ assets: { app: { state: 'ready', spec_version: 1, merged_into: 'churn-hub', page: 'n01_u01_s42' } } });
  await withApp({ forwardedToken: PERSON, history: [joined], appApi }, async (url, made) => {
    await call(url, `/api/inspire/implement/settings?${Q}`);
    assert.equal(made.appCalls[0].url, `${APP_URL}/api/settings?page=n01_u01_s42`, 'a joined App\u2019s page is the one the agent recorded');
  });
  assert.deepEqual(['N01-U01', '9x-1', 'Ab.C'].map(I.implementAppPageId), ['n01_u01', 'p_9x_1', 'ab_c']);
});

test('without the person\u2019s own sign-in, an App or a Databricks App address, the Build page shows the settings as built and writes nothing', async () => {
  await withApp({}, async (url, made) => {
    const got = await call(url, `/api/inspire/implement/settings?${Q}`);
    assert.deepEqual([got.status, got.data.source, got.data.editable, got.data.why], [200, 'recorded', false, I.IMPLEMENT_SETTINGS_NO_SIGN_IN]);
    assert.deepEqual(got.data.settings.map((s) => [s.name, s.value, s.saved]), [['WEEKS_LEFT', '12', false], ['act_now_share', '0.05', false], ['review_share', '0.15', false]]);
    const save = await call(url, `/api/inspire/implement/settings/save?${Q}`, { method: 'POST', body: { name: 'act_now_share', value: '0.1', was: '0.05' } });
    assert.deepEqual([save.status, save.data.error], [401, I.IMPLEMENT_SETTINGS_NO_SIGN_IN]);
    assert.equal(made.appCalls.length, 0);
  });
  const noApp = builtRow({ app_url: null, app_name: null });
  await withApp({ forwardedToken: PERSON, history: [noApp] }, async (url, made) => {
    const got = await call(url, `/api/inspire/implement/settings?${Q}`);
    assert.deepEqual([got.data.source, got.data.why, got.data.app], ['recorded', I.IMPLEMENT_SETTINGS_NO_APP, null]);
    const run = await call(url, `/api/inspire/implement/settings/run?${Q}`, { method: 'POST', body: {} });
    assert.deepEqual([run.status, run.data.error], [409, I.IMPLEMENT_SETTINGS_NO_APP]);
    assert.equal(made.appCalls.length, 0);
  });
  for (const address of ['http://churn-desk-1.aws.databricksapps.com', 'https://evil.example.com', 'https://databricksapps.com.example.com']) {
    await withApp({ forwardedToken: PERSON, history: [builtRow({ app_url: address })] }, async (url, made) => {
      const got = await call(url, `/api/inspire/implement/settings?${Q}`);
      assert.deepEqual([got.data.source, got.data.why], ['recorded', I.IMPLEMENT_SETTINGS_NOT_APP_URL], address);
      assert.equal(made.appCalls.length, 0, `${address} never receives the person\u2019s token`);
    });
  }
  await withApp({ forwardedToken: PERSON, appThrows: 'connect ECONNREFUSED' }, async (url) => {
    const got = await call(url, `/api/inspire/implement/settings?${Q}`);
    assert.deepEqual([got.data.source, got.data.why], ['recorded', 'The App\u2019s settings could not be read: connect ECONNREFUSED']);
  });
  await withApp({ forwardedToken: PERSON, history: [] }, async (url) => {
    const got = await call(url, `/api/inspire/implement/settings?${Q}`);
    assert.deepEqual([got.data.source, got.data.settings, got.data.why], ['recorded', [], I.IMPLEMENT_SETTINGS_NOT_BUILT]);
  });
});

test('the Run tab reads the last two runs of the use case\u2019s App with the person\u2019s own sign-in, and says why when it cannot', async () => {
  const run = (id, scope) => ({ run_id: id, status: 'succeeded', scope: { scope, key: scope }, scope_text: scope === 'all' ? 'All records' : 'First run: 2 groups of country (USA, Spain)',
    facts: scope === 'all' ? { covered: '', everything: '' } : { covered: 'The first run covered 19,600 of 48,210 records (2 groups) in 4 minutes.',
      everything: 'Run on everything covers all 48,210 records, about 10 minutes at this run\u2019s pace.' } });
  const appApi = { 'GET /api/runs': [{ runs: [run('r3', 'groups'), run('r2', 'all'), run('r1', 'all')], total: 3, offset: 0, limit: 20 }] };
  await withApp({ forwardedToken: PERSON, appApi }, async (url, made) => {
    const got = await call(url, `/api/inspire/implement/runs?${Q}`);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.deepEqual(got.data.runs.map((r) => r.run_id), ['r3', 'r2'], 'the latest run and the one before it, enough to say whether the scope changed');
    assert.equal(got.data.runs[0].facts.everything, 'Run on everything covers all 48,210 records, about 10 minutes at this run\u2019s pace.');
    assert.equal(got.data.why, '');
    assert.deepEqual(made.appCalls.map((c) => [c.method, c.url, c.headers.Authorization]), [['GET', `${APP_URL}/api/runs?page=n01_u01`, `Bearer ${PERSON}`]]);
  });
  await withApp({}, async (url, made) => {
    const got = await call(url, `/api/inspire/implement/runs?${Q}`);
    assert.deepEqual([got.status, got.data.runs, got.data.why], [200, [], I.IMPLEMENT_SETTINGS_NO_SIGN_IN]);
    assert.equal(made.appCalls.length, 0);
  });
  await withApp({ forwardedToken: PERSON, appApi: { 'GET /api/runs': [{ error: 'Only the owners of this use case can read its runs' }, 403] } }, async (url) => {
    const got = await call(url, `/api/inspire/implement/runs?${Q}`);
    assert.deepEqual([got.data.runs, got.data.why], [[], 'Only the owners of this use case can read its runs']);
  });
  await withApp({ forwardedToken: PERSON, appThrows: 'connect ECONNREFUSED' }, async (url) => {
    const got = await call(url, `/api/inspire/implement/runs?${Q}`);
    assert.equal(got.data.why, 'The App\u2019s runs could not be read: connect ECONNREFUSED');
  });
  await withApp({ forwardedToken: PERSON, history: [builtRow({ app_url: 'https://evil.example.com' })] }, async (url, made) => {
    const got = await call(url, `/api/inspire/implement/runs?${Q}`);
    assert.equal(got.data.why, I.IMPLEMENT_SETTINGS_NOT_APP_URL);
    assert.equal(made.appCalls.length, 0, 'an address that is not a Databricks App never receives the person\u2019s token');
  });
});

test('the wizard shows only the business settings; the technical ones Genie declared keep their values for the App owner', async () => {
  const S = await lib('useCaseSettings.js');
  const widgets = [
    { name: 'act_now_share', allowed: '0 to 1', default: '0.05' }, { name: 'review_share', allowed: '0 to 1', default: '0.2' },
    { name: 'min_score', allowed: 'at least 0', default: '0' }, { name: 'items_per_entity', allowed: 'whole number, 1 to 100', default: '10' },
    { name: 'run_scope', type: 'text', default: 'all' }, { name: 'min_rows', allowed: 'whole number, at least 1', default: '1' },
    { name: 'min_join_coverage', allowed: '0 to 1', default: '0.8' }, { name: 'svd_factors', allowed: 'whole number, at least 2', default: '20' },
    { name: 'neighbors_per_item', allowed: 'whole number, at least 1', default: '50' }, { name: 'holdout_days', default: 'ceil(0.2 x days)' },
  ];
  const model = [...MODEL, { name: 'min_interactions', label: 'Minimum interactions', group: 'scope', kind: 'integer', low: 1, high: null, allowed: 'whole number, at least 1',
    source: 'widget', default: '1000', reason: 'Genie Code chose it when it built the notebook', applies: 'run' }];
  const fromWidgets = S.wizardSettings({ widgets, family: 'D' }).map((s) => s.name);
  assert.deepEqual(fromWidgets, ['act_now_share', 'review_share', 'min_score', 'items_per_entity', 'run_scope']);
  const fromModel = S.wizardSettings({ model, widgets, family: 'D' }).map((s) => s.name);
  assert.ok(fromModel.includes('WEEKS_LEFT') && fromModel.includes('act_now_share'), 'the impact and flagging settings stay');
  for (const technical of ['min_interactions', 'min_rows', 'min_join_coverage', 'svd_factors', 'neighbors_per_item', 'holdout_days']) {
    assert.ok(!fromModel.includes(technical) && !fromWidgets.includes(technical), `${technical} is not in the wizard`);
  }
  assert.deepEqual(S.BUSINESS_SETTING_GROUPS, S.SETTING_GROUPS.filter((g) => g !== 'scope'));
  assert.equal(S.isBusinessSetting({ name: 'group_by', group: 'scope' }), true, 'the grouping keeps its own step');
  assert.equal(S.isBusinessSetting({ name: 'min_rows', group: 'scope' }), false);
  assert.equal(S.isBusinessSetting({ name: 'alert_threshold', group: 'alerts' }), true);
});

test('custom SQL for Grouping or First run is refused before anything runs, at every route that takes settings', async () => {
  const S = require('../../frontend/src/lib/runScope.js');
  const refused = S.CUSTOM_SQL_REFUSED;
  const view = { settings: [{ ...MODEL[1], value: '0.05', saved: false, editable: true }], history: [], editable: true, why: '', can_run: true, job: true };
  const appApi = { 'POST /api/settings/save': [view], 'POST /api/settings/preview': [{ exact: true, moves: [], text: '' }] };
  await withApp({ forwardedToken: PERSON, appApi }, async (url, made) => {
    for (const [action, body] of [
      ['save', { name: 'group_sql', value: 'SELECT order_id, region AS group_name FROM main.sales.orders', was: '' }],
      ['save', { name: 'scope_sql', value: 'SELECT order_id FROM main.sales.orders', was: '' }],
      ['save', { name: 'group_by', value: 'custom', was: 'all' }],
      ['save', { name: 'group_by', value: 'region, Custom', was: 'all' }],
      ['save', { name: 'run_scope', value: 'custom', was: 'records' }],
      ['preview', { name: 'group_sql', value: 'SELECT 1' }],
    ]) {
      const got = await call(url, `/api/inspire/implement/settings/${action}?${Q}`, { method: 'POST', body });
      assert.equal(got.status, 400, `${action} ${body.name}=${body.value}`);
      assert.ok(got.data.error.endsWith(refused), got.data.error);
    }
    assert.equal(made.appCalls.length, 0, 'nothing reached the App');
    const kept = await call(url, `/api/inspire/implement/settings/save?${Q}`, { method: 'POST', body: { name: 'group_by', value: 'customer_segment', was: 'all' } });
    assert.equal(kept.status, 200, 'a column whose name starts with custom is a column, not custom SQL');
    assert.deepEqual(made.appCalls.map((c) => c.body.name), ['group_by']);
  });
  await withApp({}, async (url, made) => {
    for (const route of ['/api/grouping/preview', '/api/grouping/save']) {
      const resp = await fetch(`${url}${route}?${Q}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-email': OWNER },
        body: JSON.stringify({ ...DB, use_case_id: 'N01-U01', main_table: 'main.sales.orders', key_columns: ['order_id'], sql: 'SELECT order_id, region AS group_name FROM main.sales.orders' }) });
      assert.equal(resp.status, 404, `${route} is gone`);
    }
    assert.equal(made.sqlCalls.filter((c) => String(c.sql).includes('group_name')).length, 0, 'no typed SQL ran');
  });
  const R = require('../lib/routePolicy');
  assert.equal(Object.keys(R.ROUTE_POLICY || {}).some((k) => k.includes('/api/grouping/preview') || k.includes('/api/grouping/save')), false);
  assert.deepEqual(I.widgetProblems([{ name: 'group_by', default: 'all' }], { group_by: 'custom', group_sql: 'SELECT 1', run_scope: 'custom' }), [
    `group_by is 'custom': ${refused}`, `group_sql: ${refused}`, `run_scope is 'custom': ${refused}`]);
  assert.deepEqual(I.widgetProblems([{ name: 'group_by', default: 'all' }], { group_by: 'region, country', group_sql: '', run_scope: 'records' }), [], 'columns, an empty SQL setting and a first run choice pass');
  assert.deepEqual(I.customSqlProblems({ group_by: 'all', scope_sql: '  ' }), []);
  assert.deepEqual(I.customSqlProblems({ group_by: 'custom', group_sql: 'SELECT 1' }), [`group_by is 'custom': ${refused}`, `group_sql: ${refused}`]);
});

test('a re-run of a build that carried custom SQL is refused, so the old SQL never runs again', async () => {
  const spec = { use_case_id: 'N01-U01', outputs: {}, config: { result_table: 'main.out.risk', widgets: { group_by: 'custom', group_sql: 'SELECT order_id, region AS group_name FROM main.sales.orders' } } };
  const history = [{ spec_version: 2, status: 'ready', use_case_id: 'N01-U01', job_id: 77, spec_json: JSON.stringify(spec),
    genie_widgets: JSON.stringify([{ name: 'top_k', type: 'text', default: '25' }]) }];
  await withApp({ history }, async (url, made) => {
    const got = await call(url, `/api/inspire/implement/rerun?${Q}`, { method: 'POST', body: { overrides: {} } });
    assert.equal(got.status, 400);
    assert.match(got.data.error, /Build this use case again to re-run it\.$/);
    assert.equal(made.fetches.some((f) => f.path === '/api/2.1/jobs/run-now'), false);
  });
  const clean = [{ ...history[0], spec_json: JSON.stringify({ ...spec, config: { ...spec.config, widgets: { group_by: 'region' } } }) }];
  await withApp({ history: clean }, async (url, made) => {
    const got = await call(url, `/api/inspire/implement/rerun?${Q}`, { method: 'POST', body: { overrides: {} } });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(made.fetches.some((f) => f.path === '/api/2.1/jobs/run-now'), true);
  });
});
