const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const I = require('../lib/inspireImplement');

const lib = (name) => import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', name)).href);

const stage = (id, state, extra = {}) => ({ id, label: id, state, elapsed: '', ...extra });

test('the Build page tiles are App, Dashboard, Genie Agent, Alerts, Notebook and Job, in that order', async () => {
  const C = await lib('implementControl.js');
  assert.deepEqual(C.ASSET_TILES.map((t) => [t.id, t.label]),
    [['app', 'App'], ['dashboard', 'Dashboard'], ['genie_space', 'Genie Agent'], ['alert', 'Alerts'], ['notebook', 'Notebook'], ['job', 'Job']]);
  for (const gone of ['MVP_TABS', 'BUILD_TAB', 'idleMvpTab', 'implementDefaultTab', 'collectedNoteText']) assert.equal(C[gone], undefined, gone);
});

test('the stage chips group the planned stages into steps, drop the skipped ones and show the worst state of each step', async () => {
  const P = await lib('mvpProgress.js');
  const steps = P.stageSteps([
    stage('Vibe', 'done'), stage('Plan', 'done'), stage('Instruction', 'done'),
    stage('Genie Code', 'done'), stage('Genie build', 'running', { elapsed: '2m' }),
    stage('Preview run', 'waiting'),
    stage('Dashboard', 'skipped'), stage('App', 'waiting'),
    stage('Self-fix', 'skipped'), stage('Done', 'waiting'),
  ]);
  assert.deepEqual(steps.map((s) => [s.id, s.state]), [['Job', 'done'], ['Notebook', 'running'], ['App', 'waiting'], ['Finish', 'waiting']]);
  assert.ok(!steps.some((s) => s.id === 'Plan'), 'the plan is the job being built, so no Plan chip');
  assert.ok(!steps.some((s) => s.id === 'Dashboard'), 'a stage this build does not plan shows no chip');
  assert.equal(steps[1].elapsed, '2m', 'the running step shows how long it has run');
  assert.equal(steps[0].title, 'Vibe, Plan, Preview run');
  assert.equal(steps[1].title, 'Instruction, Genie Code, Genie build');
  assert.equal(steps[0].elapsed, '', 'a finished step with no recorded times shows no clock');
  const min = 60000;
  const timed = P.stageSteps([stage('Plan', 'done', { started: null, ended: 0 }), stage('Instruction', 'done', { started: 5000, ended: 5000 + 165000 }),
    stage('Genie build', 'done', { started: 3 * min, ended: 4 * min })]);
  assert.equal(timed[1].elapsed, '3m 45s', 'a finished step shows the time its stages ran, without the gaps between them');
  const gap = P.stageSteps([stage('Plan', 'done', { started: 0, ended: 0 }), stage('Preview run', 'done', { started: 5000, ended: 170000 })]);
  assert.equal(gap[0].elapsed, '2m 45s', 'the wait before a stage starts is not counted');
  const failed = P.stageSteps([stage('Plan', 'done'), stage('Genie Code', 'done', { started: 0, ended: min }),
    stage('Genie build', 'error', { started: min, ended: 3 * min }), stage('Done', 'not_reached')]);
  assert.deepEqual(failed.map((s) => [s.id, s.state]), [['Job', 'done'], ['Notebook', 'error'], ['Finish', 'not_reached']]);
  assert.equal(failed[1].elapsed, '3m 0s', 'a failed step shows how long it ran');
  assert.equal(failed[2].elapsed, '', 'a step never reached has no clock');
  const warned = P.stageSteps([stage('Genie Code', 'done'), stage('Genie build', 'warning')]);
  assert.deepEqual(warned.map((s) => s.state), ['warning']);
  assert.deepEqual(P.stageSteps([stage('Dashboard', 'skipped')]), [], 'only skipped stages show no chip at all');
  assert.deepEqual(P.stageSteps(null), []);
});

test('the sorted-to line counts the changes the build carries and names the parts Inspire sent them to, once each', async () => {
  const P = await lib('mvpProgress.js');
  const latest = (routes, text) => ({ spec_version: 3, spec_json: { vibes: text }, asset_status: { vibe: { spec_version: 3, text, routes } } });
  const two = P.sortedTo([], latest({ app: 'Answer in euros', dashboard: 'Add a map', genie_space: 'Answer in euros' }, 'Answer in euros\nAdd a map'));
  assert.equal(two.count, 2);
  assert.deepEqual(two.parts, ['App', 'Dashboard', 'Genie Agent']);
  assert.equal(two.text, 'This build carries 2 changes. Inspire sorted them to: App, Dashboard, Genie Agent.');
  const one = P.sortedTo([], latest({ app: 'Answer in euros' }, 'Answer in euros'));
  assert.equal(one.text, 'This build carries 1 change. Inspire sorted it to: App.');
  assert.equal(P.sortedTo([], latest({}, 'Answer in euros')), null, 'nothing sorted yet shows no line');
  assert.equal(P.sortedTo([], { spec_version: 3, spec_json: {}, asset_status: { vibe: { spec_version: 2, text: 'old', routes: { app: 'old' } } } }), null,
    'the routes of another version never show');
  assert.equal(P.sortedTo([], null), null);
});

test('the rail progress reads the percent and the current step from the same status the detail reads', async () => {
  const P = await lib('mvpProgress.js');
  const row = (phase, status, time) => ({ step_id: 1, step_name: phase, sub_step_name: 'n01-u01', status, last_updated: `2026-01-02T${time}.000Z`,
    result_json: { use_case_id: 'N01-U01', phase } });
  const latest = (status) => ({ status, spec_version: 1, created_at: '2026-01-02T10:00:00.000Z', spec_json: { outputs: { dashboard: true } } });
  const steps = [row('Plan', 'ended_success', '10:01:00'), row('Instruction', 'started', '10:01:05')];
  const now = Date.parse('2026-01-02T10:02:00Z');
  const got = P.statusProgress({ latest: latest('filling'), steps }, now);
  assert.ok(got.percent > 0 && got.percent < 100, String(got.percent));
  assert.ok(got.step.length > 0 && !got.step.endsWith('…'), got.step);
  assert.deepEqual(P.statusProgress({ latest: latest('ready'), steps }, now).percent, 100, 'a ready build is 100 percent');
  assert.deepEqual(P.statusProgress({ latest: latest('failed'), steps: [] }, now), { percent: 0, step: '' }, 'a failed build with no steps reads 0 and no step');
  assert.deepEqual(P.railProgress({ tone: 'busy' }, { percent: 40, headline: 'Genie is writing the notebook…' }), { percent: 40, step: 'Genie is writing the notebook' });
});

test('Rebuild sends the waiting vibes as the next version, and asks what happens to the built version only when there is one and a vibe to send', async () => {
  const C = await lib('implementControl.js');
  const W = await lib('implementWizard.js');
  const spec = { use_case_id: 'N01-U01', vibes: 'Old ask', vibe_previous: 'keep', retry_outputs: ['app'], data: {}, outputs: { dashboard: true, dashboard_vibes: 'Arabic labels\nDark header' } };
  const latest = { spec_version: 4, spec_json: spec };
  const entries = [{ kind: 'ask', text: 'Answer in euros' }, { kind: 'remove', id: 'dashboard', label: 'Dashboard', text: 'Arabic labels' }];
  const next = C.rebuildSpec(latest, entries, 3, 'remove');
  assert.equal(next.vibes, 'Answer in euros', 'only the new asks are the vibes of the next version');
  assert.equal(next.outputs.dashboard_vibes, 'Dark header', 'the ask taken out leaves the part');
  assert.equal(next.vibe_previous, 'remove');
  assert.equal(next.based_on_version, 4);
  assert.equal(next.retry_outputs, undefined, 'one-version keys never carry over');
  assert.deepEqual(W.vibesProblems(next, 3), []);
  const unchosen = C.rebuildSpec(latest, entries, 3, '');
  assert.equal(unchosen.vibe_previous, undefined, 'the choice of the last version never carries over');
  assert.equal(W.vibesProblems(unchosen, 3).length, 1, 'Rebuild refuses to send a vibe without the choice');
  const removalOnly = C.rebuildSpec(latest, entries.slice(1), 3, 'keep');
  assert.equal(removalOnly.vibe_previous, undefined, 'taking an ask out sends no vibe, so no choice is sent');
  assert.equal(String(removalOnly.vibes ?? ''), '');
  assert.equal(C.rebuildSpec(latest, entries, null, 'keep').vibe_previous, undefined, 'nothing built yet, nothing to keep or remove');
});

test('Rebuild is named by the number of vibes waiting, and the build-running and nothing-changed notes say why it waits', async () => {
  const C = await lib('implementControl.js');
  assert.equal(C.REBUILD_WAITS, 'A build is running. Vibes you add wait for the next build.');
  assert.equal(C.REBUILD_NOTHING, 'Add a vibe or take one out first: nothing changed since the last build.');
  assert.equal(C.rebuildLabel([{ kind: 'ask', text: 'a' }, { kind: 'ask', text: 'b' }, { kind: 'remove', id: 'app', text: 'c' }]), 'Rebuild with 3 vibes');
  assert.equal(C.vibeFeaturesLabel(null), 'Vibe/Add/Remove Features (0)');
});

test('the backend and the App name the same way to all settings, so no text points at a button that is gone', async () => {
  const W = await lib('implementWizard.js');
  assert.ok(I.IMPLEMENT_ALL_SETTINGS.includes(W.VIBE_FEATURES_LABEL), I.IMPLEMENT_ALL_SETTINGS);
  assert.ok(I.IMPLEMENT_ALL_SETTINGS.includes(W.OPEN_ALL_SETTINGS), I.IMPLEMENT_ALL_SETTINGS);
  assert.ok(I.IMPLEMENT_SETTINGS_NO_APP.includes(I.IMPLEMENT_ALL_SETTINGS));
  const fs = require('node:fs');
  const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(path.join(dir, d.name)) : d.isFile() ? [path.join(dir, d.name)] : []));
  const agent = path.resolve(__dirname, '..', '..', 'agent', 'agent');
  const sources = [
    ...files(path.resolve(__dirname, '..', '..', 'frontend', 'src')), ...files(path.resolve(__dirname, '..', 'lib')),
    ...files(path.join(agent, 'app_shell', 'server')), ...files(path.join(agent, 'app_shell', 'web', 'src')),
    path.join(agent, 'dbx_inspire_ai_agent.ipynb'), path.resolve(__dirname, '..', '..', 'dbx_inspire_ai_agent.ipynb'),
  ].filter((f) => /\.(js|jsx|py|ipynb)$/.test(f));
  const stale = sources.filter((f) => ['Edit MVP', 'Build again'].some((old) => fs.readFileSync(f, 'utf8').includes(old)));
  assert.deepEqual(stale.map((f) => path.relative(path.resolve(__dirname, '..', '..'), f)), []);
});

test('the Plan stage folds into the Job step: one Job chip first, its clock is plan plus preview run, and a failed plan fails the Job with its message', async () => {
  const P = await lib('mvpProgress.js');
  const min = 60000;
  const done = P.stageSteps([
    stage('Plan', 'done', { started: 0, ended: min }), stage('Genie Code', 'done', { started: min, ended: 3 * min }),
    stage('Preview run', 'done', { started: 3 * min, ended: 5 * min }), stage('Dashboard', 'done', { started: 5 * min, ended: 6 * min }), stage('Done', 'done'),
  ]);
  assert.deepEqual(done.map((s) => [s.id, s.state]), [['Job', 'done'], ['Notebook', 'done'], ['Dashboard', 'done'], ['Finish', 'done']]);
  assert.equal(done[0].elapsed, '3m 0s', 'Job = 1m of planning + 2m of preview run');
  assert.equal(done.filter((s) => s.id === 'Job').length, 1, 'never two Job chips');
  const planning = P.stageSteps([stage('Plan', 'running', { started: 0, elapsed: '12s' }), stage('Genie Code', 'waiting'), stage('Preview run', 'waiting'), stage('Done', 'waiting')]);
  assert.deepEqual(planning.map((s) => [s.id, s.state, s.elapsed]), [['Job', 'running', '12s'], ['Notebook', 'waiting', ''], ['Finish', 'waiting', '']]);
  const previewing = P.stageSteps([stage('Plan', 'done', { started: 0, ended: min }), stage('Genie Code', 'done'), stage('Preview run', 'running', { elapsed: '40s' })]);
  assert.deepEqual(previewing.map((s) => [s.id, s.state, s.elapsed]), [['Job', 'running', '40s'], ['Notebook', 'done', '']]);
  const broken = P.stageSteps([stage('Plan', 'error', { started: 0, ended: min, message: 'the warehouse is stopped' }), stage('Genie Code', 'not_reached'), stage('Done', 'not_reached')]);
  assert.deepEqual(broken.map((s) => [s.id, s.state]), [['Job', 'error'], ['Notebook', 'not_reached'], ['Finish', 'not_reached']]);
  assert.equal(broken[0].message, 'the warehouse is stopped');
  assert.equal(broken[0].title, 'Plan: the warehouse is stopped');
  assert.equal(done[0].message, '', 'a step that did not fail carries no message');
});

test('a build stored before the fold still reads its recorded Plan step as the Job chip', async () => {
  const P = await lib('mvpProgress.js');
  const row = (phase, status, time, extra = {}) => ({ step_id: 1, step_name: `Inspire is working on ${phase.toLowerCase()}`, status, message: extra.message || '',
    last_updated: `2026-01-02T${time}.000Z`, result_json: { use_case_id: 'N01-U01', phase, spec_version: 1 } });
  const latest = (status) => ({ status, spec_version: 1, created_at: '2026-01-02T10:00:00.000Z', spec_json: { outputs: { dashboard: true } } });
  const steps = [row('Plan', 'started', '10:00:00'), row('Plan', 'ended_success', '10:01:00'), row('Genie Code', 'started', '10:01:00'), row('Genie Code', 'ended_success', '10:03:00'),
    row('Preview run', 'started', '10:03:00'), row('Preview run', 'ended_success', '10:05:00'), row('Dashboard', 'started', '10:05:00'), row('Dashboard', 'ended_success', '10:06:00')];
  const chips = P.stageSteps(P.mvpStages(steps, latest('ready'), { now: Date.parse('2026-01-02T10:07:00Z') }));
  assert.deepEqual(chips.map((s) => [s.id, s.state, s.elapsed]), [['Job', 'done', '3m 0s'], ['Notebook', 'done', '2m 0s'], ['Dashboard', 'done', '1m 0s'], ['Finish', 'done', '']]);
  const failed = P.stageSteps(P.mvpStages([row('Plan', 'started', '10:00:00'), row('Plan', 'ended_error', '10:00:30', { message: 'no warehouse' })], latest('failed'),
    { now: Date.parse('2026-01-02T10:07:00Z') }));
  assert.deepEqual(failed[0], { id: 'Job', label: 'Job', title: 'Plan, Preview run: no warehouse', state: 'error', elapsed: '30s', message: 'no warehouse' });
});

test('the asset cards that animate are the ones whose step is live in the progress line, and only while the build runs', async () => {
  const P = await lib('mvpProgress.js');
  const C = await lib('implementControl.js');
  assert.deepEqual(C.ASSET_TILES.map((t) => t.id).sort(), [...new Set(Object.values(P.STEP_ASSET))].sort(), 'every tile has one step, every step one tile');
  const planning = [stage('Plan', 'running'), stage('Genie Code', 'waiting'), stage('Preview run', 'waiting'), stage('App', 'waiting'), stage('Done', 'waiting')];
  assert.deepEqual([...P.buildingAssets(planning, true)], ['job'], 'planning animates the Job card');
  const app = [stage('Plan', 'done'), stage('Genie Code', 'done'), stage('App', 'running'), stage('Done', 'waiting')];
  assert.deepEqual([...P.buildingAssets(app, true)], ['app']);
  assert.deepEqual([...P.buildingAssets([stage('Plan', 'done'), stage('Genie Code', 'next')], true)], ['notebook'], 'a step about to start animates too, as its chip does');
  assert.deepEqual([...P.buildingAssets(app, false)], [], 'a build that is not running animates nothing');
  assert.deepEqual([...P.buildingAssets([stage('Plan', 'done'), stage('Done', 'running')], true)], [], 'finishing is no asset');
  assert.deepEqual([...P.buildingAssets([stage('Plan', 'done'), stage('Genie build', 'error')], true)], [], 'a failed step does not animate');
});

test('the warnings of a version are the parts of its status message, counted once, and only on a version with warnings', async () => {
  const C = await lib('implementControl.js');
  const message = 'Notebook: no candidate passed; Not reliable yet: the run said why; Notebook: no candidate passed';
  assert.deepEqual(C.statusWarnings({ status: 'ready_with_warnings', status_message: message }), ['Notebook: no candidate passed', 'Not reliable yet: the run said why']);
  assert.deepEqual(C.statusWarnings({ status: 'ready', status_message: 'ready: preview wrote 3 rows' }), []);
  assert.deepEqual(C.statusWarnings({ status: 'failed', status_message: 'Notebook: it broke' }), []);
  assert.deepEqual(C.statusWarnings(null), []);
});
