const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const I = require('../lib/inspireImplement');
const { bundledBuildStamp } = require('../lib/appShell');
const { makeApp, listen } = require('./support/implementApp');

const lib = (name) => import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', name)).href);

const OWNER = ['owner', 'example.com'].join('@');
const APP_OWNER = ['lee', 'example.com'].join('@');
const OTHER = ['someone.else', 'example.com'].join('@');
const CURRENT = bundledBuildStamp();
const OLD = { version: 'v1.3.0', shell: 'a'.repeat(64) };
const DB = { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42' };
const Q = 'inspire_database=main.inspire&warehouse_id=wh1&session_id=42&use_case_id=N01-U01';
const SPEC = I.validateImplementSpec({
  use_case_id: 'N01-U01', use_case_name: 'Predict churn', config: { warehouse_id: 'wh1', result_table: 'main.inspire.churn_out' },
  outputs: { dashboard: true, app: true, app_name: 'churn-desk', app_access: 'sp', app_owners: [APP_OWNER], app_vibes: 'a dark theme', inspire_url: 'https://inspire.example.com', genie_space: true, alert: false },
}).spec;
const row = (version, status, assets, extra = {}) => ({
  session_id: '42', use_case_id: 'N01-U01', spec_version: version, status, created_by: OWNER, updated_at: `2026-11-0${version}T00:00:00Z`,
  spec_json: SPEC, notebook_path: '/W/impl/N01-U01', job_id: '77', dashboard_id: 'd1', genie_space_id: 'g1', app_name: 'churn-desk', app_url: 'https://churn-desk.example.com',
  asset_status: { notebook: { state: 'ready', spec_version: 1, result_history: 1 }, genie_space: { state: 'ready', spec_version: 1 }, dashboard: { state: 'ready', spec_version: version }, ...assets }, ...extra,
});
const APP_V1 = { state: 'ready', spec_version: 1, snapshot: true };
const builtOnOld = row(1, 'ready', { app: APP_V1, built_with: OLD });
const dashboardOnly = row(2, 'ready', { app: { state: 'ready', spec_version: 1 }, built_with: CURRENT });
const history = () => [dashboardOnly, builtOnOld].map((r) => JSON.parse(JSON.stringify(r)));

async function withApp(rows, run) {
  const made = makeApp({ history: rows, moneySummary: [] });
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

test('an App last deployed by an older release is found even when a later version rebuilt only the dashboard with this release (fail-before)', () => {
  assert.equal(I.olderBuildNote(history(), CURRENT), 'Built with Inspire v1.3.0. Rebuild to get the latest fixes.',
    'the note reads the code of the live App, deployed by v1, not the newest version that rebuilt only the dashboard');
  assert.equal(I.olderBuildNote([row(2, 'ready', { app: { state: 'ready', spec_version: 2, snapshot: true }, built_with: CURRENT }), builtOnOld], CURRENT), '',
    'must-exclude: an App deployed with this release says nothing, even when an older version was built with an older one');
  assert.equal(I.olderBuildNote([row(2, 'ready', { built_with: OLD }, { app_name: null }), row(1, 'ready', { built_with: CURRENT }, { app_name: null })], CURRENT),
    'Built with Inspire v1.3.0. Rebuild to get the latest fixes.', 'with no App the live version itself says what it was built with');
  const heldNewest = [row(3, 'vibe_not_met', { app: { state: 'ready', spec_version: 1 }, built_with: CURRENT }), ...history()];
  assert.equal(I.olderBuildNote(heldNewest, CURRENT), 'Built with Inspire v1.3.0. Rebuild to get the latest fixes.', 'a held newest version built now does not hide the live App code');
  const update = I.appShellUpdate(history(), CURRENT);
  assert.equal(update.version, 1, 'the App is put back at the version that deployed it');
  assert.equal(update.text, `The App runs the App code of Inspire v1.3.0. Update it to Inspire ${CURRENT.version}: Inspire deploys the same pages, settings and data `
    + 'with the App code of this release, without calling Genie.');
  const sameRelease = I.appShellUpdate([row(1, 'ready', { app: APP_V1, built_with: { version: CURRENT.version, shell: 'b'.repeat(64) } })], CURRENT);
  assert.match(sameRelease.text, new RegExp(`an earlier build of Inspire ${CURRENT.version.replace(/\./g, '\\.')}`));
  assert.match(I.appShellUpdate([row(1, 'ready', { app: APP_V1 })], CURRENT).text, /an earlier Inspire release/, 'a record from before the stamp is older');
  const held = [row(3, 'vibe_not_met', { app: { state: 'ready', spec_version: 1 } }), ...history()];
  assert.equal(I.appShellUpdate(held, CURRENT).version, 1, 'a held newest version does not hide the live App');
});

test('no update is offered when there is nothing to update or nothing to put back (must-exclude)', () => {
  assert.equal(I.appShellUpdate([row(1, 'ready', { app: APP_V1, built_with: CURRENT })], CURRENT), null, 'the App already runs this release');
  assert.equal(I.appShellUpdate([row(1, 'ready', { app: { state: 'ready', spec_version: 1 }, built_with: OLD })], CURRENT), null, 'no saved App page to deploy again');
  assert.equal(I.appShellUpdate([row(1, 'ready', { app: { ...APP_V1, state: 'failed' }, built_with: OLD })], CURRENT), null, 'a failed App is rebuilt, not updated');
  assert.equal(I.appShellUpdate([row(1, 'ready', { built_with: OLD }, { app_name: null })], CURRENT), null, 'no App');
  assert.equal(I.appShellUpdate([row(2, 'uninstalled', {}), builtOnOld], CURRENT), null, 'an uninstalled MVP has no App');
  assert.equal(I.appShellUpdate([row(1, 'building_outputs', {}), builtOnOld].slice(1), { version: '', shell: '' }), null, 'no bundled stamp');
  const hosted = row(1, 'ready', { app: { ...APP_V1, placement: 'inspire', hosted: { id: 'p1', source: '/W/x', version: 1, warehouse_id: 'wh1' } }, built_with: OLD });
  assert.equal(I.appShellUpdate([hosted], CURRENT), null, 'a page inside the Inspire App already runs the installed Inspire');
});

test('the Build page gets the update with an Update the App action that redeploys the live App page and calls no Genie, only for an owner', async () => {
  const C = await lib('implementControl.js');
  const W = await lib('implementWizard.js');
  await withApp(history(), async (url, made) => {
    const status = await call(url, `/api/inspire/implement/status?${Q}`);
    assert.equal(status.status, 200, JSON.stringify(status.data));
    const latest = status.data.latest;
    assert.equal(latest.app_update.version, 1);
    const notOwner = await call(url, `/api/inspire/implement/status?${Q}`, { who: OTHER });
    assert.equal(notOwner.data.latest.app_update, null, 'only an owner is offered the update');
    const changes = C.appUpdateChanges(latest, status.data.history);
    assert.deepEqual(changes, { rollback_outputs: { app: 1 }, outputs: { ...SPEC.outputs, app_vibes: 'a dark theme' } });
    const spec = W.nextSpecFrom(latest, changes);
    const plan = await call(url, '/api/inspire/implement/plan', { method: 'POST', body: { ...DB, spec } });
    assert.equal(plan.status, 200, JSON.stringify(plan.data));
    assert.deepEqual([plan.data.summary.refill, plan.data.summary.build, plan.data.summary.refresh, plan.data.summary.rollback], [false, [], [], ['app']]);
    const other = await call(url, '/api/inspire/implement/submit', { method: 'POST', body: { ...DB, spec }, who: OTHER });
    assert.deepEqual([other.status, other.data.error], [403, 'Only the owners of this App can update it: the person who asked for v2 and the App owners it names']);
    assert.equal(made.jobs.length, 0, 'a refused update starts nothing');
    const owner = await call(url, '/api/inspire/implement/submit', { method: 'POST', body: { ...DB, spec }, who: APP_OWNER });
    assert.equal(owner.status, 200, JSON.stringify(owner.data));
    assert.deepEqual(inserts(made)[0].rollback_outputs, { app: 1 });
    assert.equal(made.jobs.length, 1);
  });
  await withApp([row(1, 'ready', { app: APP_V1, built_with: CURRENT })], async (url) => {
    const status = await call(url, `/api/inspire/implement/status?${Q}`);
    assert.equal(status.data.latest.app_update, null);
    assert.equal(C.appUpdateChanges(status.data.latest, status.data.history), null, 'no action when the App is current');
  });
  const rebuilt = [row(2, 'ready', { app: { state: 'ready', spec_version: 2, snapshot: true }, built_with: CURRENT }), builtOnOld];
  const back = I.validateImplementSpec({ ...SPEC, based_on_version: 2, rollback_outputs: { app: 1 } }).spec;
  assert.deepEqual(I.planSubmission(rebuilt, back, null, { requester: OTHER }).summary.rollback, ['app'], 'a roll back to an older App version keeps its own rules');
});

test('an App update reads as App updated to the current Inspire App code in the plan, the build steps, the card and History, never as a roll back (fail-before)', async () => {
  const W = await lib('implementWizard.js');
  const M = await lib('mvpProgress.js');
  const C = await lib('implementControl.js');
  assert.equal(W.APP_UPDATED_TEXT, 'App updated to the current Inspire App code');
  const rows = history();
  const update = I.validateImplementSpec({ ...SPEC, based_on_version: 2, rollback_outputs: { app: 1 } }).spec;
  const planned = I.planSubmission(rows, update, null, { requester: OWNER });
  assert.deepEqual([planned.summary.rollback, planned.summary.update], [['app'], ['app']]);
  assert.deepEqual(W.planLines(planned.summary).filter((l) => /App/.test(l)), ['Updates the App to the current Inspire App code']);
  const rebuilt = [row(2, 'ready', { app: { state: 'ready', spec_version: 2, snapshot: true }, built_with: CURRENT }), builtOnOld];
  const back = I.planSubmission(rebuilt, I.validateImplementSpec({ ...SPEC, based_on_version: 2, rollback_outputs: { app: 1 } }).spec, null, { requester: OTHER });
  assert.equal(back.summary.update, undefined, 'must-exclude: putting an older App version back is a roll back');
  assert.ok(W.planLines(back.summary).includes('Rolls back: App'));

  const plan = { classes: ['rollback'], build: [], refresh: [], restyle: [], repoint: [], relink: [], delete: [], keep_unmanaged: [], rollback: { app: 1 }, rollback_built: {}, update: ['app'] };
  const steps = [{ step_name: 'Inspire is working on Plan', result_json: { phase: 'Plan', spec_version: 3, plan } }];
  const building = row(3, 'building_outputs', { app: { state: 'ready', spec_version: 1 } }, { spec_json: update });
  const recorded = M.versionPlan(steps, building);
  assert.deepEqual(M.planActions(recorded), [{ id: 'app', action: 'update', version: 1 }]);
  assert.deepEqual(M.planActionText(M.planActions(recorded)[0]), { label: 'Update the App to the current Inspire App code',
    working: 'Inspire is updating the App to the current Inspire App code', now: 'Inspire is updating it now' });
  assert.equal(M.planActions(M.versionPlan([{ ...steps[0], result_json: { ...steps[0].result_json, plan: { ...plan, update: [] } } }], building))[0].action, 'rollback');

  const all = [building, ...rows];
  const card = C.vibeCards(all, building, null, '', recorded).find((c) => c.id === 'app');
  assert.equal(card.building.update, true);
  assert.equal(C.rollingBackText(card), 'Updating the App to the current Inspire App code. Genie is not called and nothing else changes.');
  const legacy = C.vibeCards(all, building, null, '', null).find((c) => c.id === 'app');
  assert.equal(legacy.building.update, true, 'a version with no recorded plan reads the same');
  assert.equal(W.isAppUpdate(all, building), true);
  assert.equal(W.isAppUpdate(all, rows[0]), false, 'a version with no roll back is no App update');
  const older = row(3, 'ready', {}, { spec_json: { ...update, rollback_outputs: { app: 1 } } });
  assert.equal(W.isAppUpdate([older, ...rebuilt], older), false, 'must-exclude: v1 was not the live App when v3 put it back');
});

test('the notebook logs an App update with the same words the App shows', async () => {
  const W = await lib('implementWizard.js');
  const nb = JSON.parse(require('node:fs').readFileSync(path.join(__dirname, '..', '..', 'agent', 'agent', 'dbx_inspire_ai_agent.ipynb'), 'utf8'));
  const code = [].concat(nb.cells[1].source).join('');
  assert.ok(code.includes(`IMPLEMENT_APP_UPDATED = "${W.APP_UPDATED_TEXT}"`));
  assert.match(code, /\[IMPLEMENT-APP-UPDATE\][^\n]*IMPLEMENT_APP_UPDATED/);
});
