const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const I = require('../lib/inspireImplement');

const lib = (name) => import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', name)).href);
const UC = { id: 'N01-U01', Name: 'Predict churn', statement: 'Cut churn in the top segment', sponsor: 'Head of Retention' };
const NOTE = 'this page uses the look and access of the App inspire-hub (style a)';

const step = (phase, status, time, extra = {}) => ({
  step_id: phase.length, step_name: `Inspire is working on ${phase.toLowerCase()}`, sub_step_name: 'Completed: n01-u01', status,
  last_updated: `2026-01-02T${time}.000Z`, result_json: JSON.stringify({ use_case_id: 'N01-U01', phase, spec_version: 3, ...extra }),
});
const PLAN = { classes: ['outputs'], build: ['app'], refresh: [], restyle: [], repoint: [], delete: [], keep_unmanaged: [], rollback: {}, rollback_built: {} };
const STEPS = [step('Plan', 'ended_success', '10:01:00', { plan: PLAN }), step('App', 'started', '10:02:00'), step('App', 'ended_success', '10:09:00'),
  step('Done', 'ended_success', '10:09:30')];
const built = (status, appEntry) => ({ status, spec_version: 3, created_at: '2026-01-02T10:00:00.000Z', spec_json: { outputs: { app: true, genie_space: true } },
  asset_status: { app: appEntry, checklist: [{ n: 1, requirement: 'x', status: 'met' }] } });

test('an App step that ended with info notes only is green and carries its notes, read from the asset of the same version', async () => {
  const { mvpStages } = await lib('mvpProgress.js');
  const { statusChip } = await lib('implementWizard.js');
  const stages = mvpStages(STEPS, built('ready', { state: 'ready', spec_version: 3, notes: [NOTE, NOTE, ' '] }));
  const app = stages.find((s) => s.id === 'App');
  assert.deepEqual([app.state, app.notes], ['done', [`App: ${NOTE}`]], 'one note, once, and no blank ones, named after its part');
  assert.equal(stages.find((s) => s.id === 'Done').state, 'done');
  assert.equal(statusChip('ready').tone, 'success');
  const older = mvpStages(STEPS, built('ready', { state: 'ready', spec_version: 2, notes: [NOTE] }));
  assert.deepEqual(older.find((s) => s.id === 'App').notes, [], 'a note of an older version is not shown under this build');
  const running = mvpStages(STEPS.slice(0, 2), built('building_outputs', { state: 'ready', spec_version: 3, notes: [NOTE] }));
  assert.deepEqual(running.find((s) => s.id === 'App').notes, [], 'a step still running shows no note');
});

test('a real warning still turns the use case and its last step yellow', async () => {
  const { mvpStages } = await lib('mvpProgress.js');
  const { statusChip } = await lib('implementWizard.js');
  const warned = [...STEPS.slice(0, 3), step('Done', 'ended_warning', '10:09:30')];
  const stages = mvpStages(warned, built('ready_with_warnings', { state: 'ready', spec_version: 3, warnings: ['the App was not tagged'] }));
  assert.equal(stages.find((s) => s.id === 'Done').state, 'warning');
  assert.equal(statusChip('ready_with_warnings').tone, 'warning');
});

test('the control tower shows the notes of an asset next to its warnings, and an asset holding a list is read safely', async () => {
  const v = await lib('implementControl.js');
  const { assetNotes } = await lib('mvpProgress.js');
  const latest = { ...built('ready', { state: 'ready', spec_version: 3, notes: [NOTE], warnings: ['Refresh now cannot start a run'] }),
    app_name: 'inspire-hub', app_url: 'https://hub' };
  const rows = v.controlRows({ targets: { app: 'inspire-hub' }, assets: { app: { ok: true, name: 'inspire-hub', compute_state: 'ACTIVE', app_state: 'RUNNING' } } },
    latest);
  const app = rows.find((r) => r.id === 'app');
  assert.deepEqual([app.notes, app.warnings], [[NOTE], ['Refresh now cannot start a run']]);
  assert.deepEqual(assetNotes(latest, 'checklist'), [], 'a list-valued record has no notes');
  assert.deepEqual(assetNotes({ asset_status: { app: { notes: 'not a list' } } }, 'app'), []);
});

async function joiner(outputs = {}) {
  const w = await lib('implementWizard.js');
  const spec = w.defaultSpecFromUseCase(UC, { warehouseId: 'wh1', inspireDatabase: 'main.inspire' });
  return { w, spec: { ...spec, outputs: { ...spec.outputs, app: true, genie_space: true, ...outputs } } };
}

test('a use case added to an existing App takes that App\'s look and sign-in, so the build never finds a difference', async () => {
  const { w, spec } = await joiner({ app_look: { style: 'c', layout: 'home', palette: 'neon', theme: 'dark' } });
  const hub = { id: 'inspire-hub', name: 'inspire-hub', access: 'user', look: { style: 'a', layout: 'tabs', palette: 'ocean', theme: 'light' },
    use_cases: [{ use_case_id: 'N01-U01', name: 'Trips' }] };
  const joined = w.withMergeTarget({ ...spec, outputs: { ...spec.outputs, app_options: { modify: true, decisions: true, alerts: true } } }, 'app', hub);
  assert.equal(joined.outputs.app_access, 'sp', 'while editing, the use case keeps its own access choice, so another App can still be picked');
  const sent = w.sentSpec(joined, null, null, { app: [hub] });
  assert.deepEqual([sent.outputs.app_look, sent.outputs.app_access], [hub.look, 'user'], 'the spec the build gets carries the hub\'s values');
  assert.deepEqual([sent.outputs.app_options.decisions, sent.outputs.app_options.alerts], [true, false], 'per-user keeps decisions and turns alerts off');
  const stale = { ...joined, outputs: { ...joined.outputs, app_look: { style: 'b', layout: 'sidebar', palette: 'default', theme: 'light' } } };
  assert.deepEqual(w.sentSpec(stale, null, null, { app: [hub] }).outputs.app_look, hub.look, 'a reopened join with an old look sends the hub\'s look');
  assert.deepEqual(w.sentSpec(stale, null, null, { app: [] }).outputs.app_look, stale.outputs.app_look,
    'a hub Inspire cannot list leaves the spec as it was, and the build notes the difference');
  assert.deepEqual(w.sentSpec(stale, null).outputs.app_look, stale.outputs.app_look, 'no targets loaded yet: nothing is changed');
  const sp = { ...hub, access: 'sp', per_user_block: 'inspire-hub signs everyone in with its own service principal' };
  const sensitive = w.withMergeTarget({ ...spec, outputs: { ...spec.outputs, app_access: 'user' } }, 'app', sp);
  assert.equal(w.sentSpec(sensitive, null, null, { app: [sp] }).outputs.app_access, 'user',
    'a sensitive use case is never quietly switched to a shared sign-in');
  assert.equal(w.appMergeBlock(sensitive, sp), sp.per_user_block, 'so the wizard still blocks it');
  const plain = w.sentSpec(spec, null, null, { app: [hub] });
  assert.deepEqual([plain.outputs.app_look, plain.outputs.app_access], [spec.outputs.app_look, spec.outputs.app_access],
    'a use case that builds its own App keeps its own look and access');
});

test('the wizard turns off a trend chart when the input tables carry no date, and says why', async () => {
  const w = await lib('implementWizard.js');
  const tables = ['main.s.trips', 'main.s.zones'];
  const dated = { 'main.s.trips': [{ column_name: 'pickup_at', data_type: 'TIMESTAMP' }], 'main.s.zones': [{ column_name: 'zone', data_type: 'STRING' }] };
  const undated = { 'main.s.trips': [{ column_name: 'fare', data_type: 'DOUBLE' }], 'main.s.zones': [{ column_name: 'zone', data_type: 'STRING' }] };
  assert.equal(w.appInputDates(dated, tables), true);
  assert.equal(w.appInputDates(undated, tables), false);
  assert.equal(w.appInputDates({ 'main.s.trips': [] }, tables), null, 'not every table is profiled yet, so the wizard does not decide');
  const { spec } = await joiner();
  assert.deepEqual(w.appChartsOf(spec, null, false), ['bars', 'pareto']);
  assert.deepEqual(w.appChartsOf(spec, null, true), ['trend', 'bars', 'pareto']);
  assert.equal(w.withAppChart(spec, 'trend', true, null, false), spec, 'a trend cannot be picked with no date');
  const picked = { ...spec, outputs: { ...spec.outputs, app_charts: ['trend', 'bars', 'split'] } };
  assert.deepEqual(w.stepErrors('app_look', picked, { columnsByTable: undated, sourceTables: tables }),
    [`${w.APP_TREND_NO_DATE} Pick another kind of chart`]);
  assert.deepEqual(w.stepErrors('app_look', picked, { columnsByTable: dated, sourceTables: tables }), []);
  assert.deepEqual(w.stepErrors('app_look', picked, {}), [], 'with no profiles the wizard leaves the pick alone');
  assert.deepEqual(w.withAppChart(picked, 'pareto', true, null, false).outputs.app_charts, ['bars', 'split', 'pareto']);
  assert.equal(w.appChartPickText(null, false), "Inspire's pick: bars by segment and biggest first.");
  assert.equal(w.appChartPickText(null, true), "Inspire's pick: trend over time, bars by segment and biggest first.");
});

test('a merge target App shows the sign-in and look its live settings hold, and falls back to its owner\'s spec', () => {
  const holder = (uc, outputs) => ({ session_id: '42', use_case_id: uc, use_case_name: uc, app_access: outputs.app_access, app_look: outputs.app_look || null,
    app_placement: '', updated_at: '2026-10-21T00:00:00Z' });
  const entry = { id: 'hub', holders: [holder('N01-U02', { app_access: 'sp', app_look: { style: 'b' } }), holder('N01-U03', { app_access: 'user' })] };
  const got = { ok: true, data: { name: 'hub', description: 'Inspire use case N01-U02 (session 42): Demand', active_deployment: { source_code_path: '/W/apps/hub/' } } };
  assert.equal(I.appSettingsPath(got), '/W/apps/hub/inspire_app.json');
  assert.equal(I.appSettingsPath({ ok: true, data: {} }), '');
  const live = I.mergeTarget('app', entry, got, '', { auth: 'sp', style: 'a', layout: 'tabs', palette: 'ocean', theme: 'dark' });
  assert.deepEqual([live.access, live.look], ['sp', { style: 'a', layout: 'tabs', palette: 'ocean', theme: 'dark' }]);
  const unread = I.mergeTarget('app', entry, got, '', null);
  assert.deepEqual([unread.access, unread.look], ['sp', { style: 'b' }], 'a per-user joiner does not make the owner\'s shared App per-user');
  assert.match(unread.per_user_block, /^hub signs everyone in with its own service principal/);
});
