const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const backend = require('../lib/inspireImplement');
const served = (spec, options) => backend.validateImplementSpec(backend.withInspireUrl(spec, 'https://inspire.example.com'), options);
const { appShellCatalog, appShellPayload, bundledAppShellText } = require('../lib/appShell');

const libUrl = pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', 'implementWizard.js')).href;
const load = () => import(libUrl);

const UC = { id: 'N01-U01', Name: 'Predict churn', statement: 'Cut churn in the top segment', sponsor: 'Head of Retention' };
const SHELL = appShellCatalog();

async function appSpec(outputs = {}) {
  const w = await load();
  const spec = w.defaultSpecFromUseCase(UC, { warehouseId: 'wh1', inspireDatabase: 'main.inspire' });
  return { w, spec: { ...spec, outputs: { ...spec.outputs, app: true, genie_space: true, ...outputs } } };
}

test('the wizard offers exactly the App choices the backend and the App shell accept, with the C1 defaults', async () => {
  const w = await load();
  assert.deepEqual(w.APP_LOOK_DEFAULT, backend.IMPLEMENT_APP_LOOK_DEFAULT);
  assert.deepEqual(w.APP_OPTION_KEYS, backend.IMPLEMENT_APP_OPTION_KEYS);
  assert.deepEqual(w.PER_USER_OFF, backend.IMPLEMENT_PER_USER_OFF);
  assert.deepEqual(w.MERGE_OUTPUTS, backend.IMPLEMENT_MERGE_OUTPUTS);
  assert.deepEqual(w.ALERT_OPERATORS, backend.IMPLEMENT_ALERT_OPERATORS);
  assert.deepEqual(w.ALERT_THRESHOLD_BASES.map((b) => b.id), backend.IMPLEMENT_ALERT_THRESHOLD_BASES);
  assert.deepEqual(w.ALERT_BASELINE_DIRECTIONS, backend.IMPLEMENT_ALERT_BASELINE_DIRECTIONS);
  assert.deepEqual(w.APP_ACCESS_CHOICES.map((c) => c.id).sort(), [...SHELL.auths].sort());
  assert.equal(w.APP_ACCESS_CHOICES[0].id, w.APP_ACCESS_DEFAULT, 'the default access comes first');
  assert.deepEqual(w.APP_STYLES.map((s) => s.id), SHELL.styles);
  assert.deepEqual(w.APP_LAYOUTS.map((l) => l.id), SHELL.layouts);
  assert.deepEqual(w.APP_THEMES.map((t) => t.id), SHELL.themes);
  assert.deepEqual(w.APP_OPTIONS.map((o) => o.id), backend.IMPLEMENT_APP_OPTION_KEYS.filter((o) => o !== 'replace_edits'));
  assert.deepEqual(w.APP_ACCESS_CHOICES.map((c) => c.label), [
    'Sensitive data: each person signs in as themselves (per-user)',
    'Internal data: everyone sees the same rows',
  ]);
  assert.deepEqual(w.APP_BACKEND_CHOICES.map((c) => c.label), ['Fast pages (Lakebase)', 'Delta'], 'the storage choice names both paths, as the user asked');
  for (const text of [...w.APP_ACCESS_CHOICES.flatMap((c) => [c.label, c.blurb]), w.APP_ACCESS_NOTE,
    ...w.APP_BACKEND_CHOICES.flatMap((c) => [c.blurb]).filter(Boolean), w.LAKEBASE_PER_USER_REASON, w.LAKEBASE_ABSENT, w.LAKEBASE_UNCHECKED]) {
    assert.doesNotMatch(text, /service principal|lakebase|delta/i, `plain words: ${text}`);
  }
  assert.equal(w.LAKEVIEW_STYLE_NOTE, 'Only style A matches the Lakeview dashboard look.');
  assert.deepEqual(w.APP_OPTIONS.map((o) => o.label), ['Let people edit data', 'Record decisions', 'Send alerts']);
  assert.match(w.APP_OPTIONS.find((o) => o.id === 'decisions').blurb, /They own, track and dismiss each flagged record \(the action tracker\)\.$/);
  assert.doesNotMatch(w.APP_OPTIONS.find((o) => o.id === 'modify').blurb, /action tracker/);
  assert.equal(w.APP_NO_DOWNLOADS, 'The App offers no data downloads.');
  assert.equal(w.APP_REFRESH_NOTE, 'Refresh now: only the owners of this use case can run it now, the person who asks for this version and the App owners it names. '
    + 'One refresh runs at a time.');
  for (const text of [...w.APP_OPTIONS.flatMap((o) => [o.label, o.blurb]), w.PER_USER_REASON, w.APP_REFRESH_NOTE, w.APP_NO_DOWNLOADS,
    ...w.REPLACE_EDITS_CHOICES.map((c) => c.blurb)]) {
    assert.doesNotMatch(text, /\u2014|\u2013/, `no dashes: ${text}`);
  }
  assert.doesNotMatch(w.APP_OPTIONS.map((o) => `${o.label} ${o.blurb}`).join(' '), /download|export|csv/i, 'no option offers a download');
  assert.equal(w.REPLACE_EDITS_QUESTION, 'Should a new run replace edited records?');
  assert.deepEqual(w.REPLACE_EDITS_CHOICES.map((c) => [c.id, c.label]), [[false, 'No'], [true, 'Yes']], 'No comes first, as the default');
});

test('the storage guide says why fast pages are recommended for Apps and when Delta fits, and the default follows who signs in', async () => {
  const w = await load();
  assert.equal(w.APP_BACKEND_GUIDE.length, 2);
  assert.equal(w.APP_BACKEND_GUIDE[0], 'Fast pages (Lakebase) is the default and the recommended choice for Apps: pages read a Postgres copy that is synced from your tables, so most pages open at once without waiting for a SQL warehouse. Pages are as fresh as the last sync.');
  assert.equal(w.APP_BACKEND_GUIDE[1], 'Pick Delta when Lakebase is not available here, the tables are very large, or instant pages do not matter.');
  const shared = { outputs: { app: true, app_access: 'sp' } };
  assert.equal(w.appBackendDefault(shared, { state: 'available' }), 'lakebase', 'a shared App reads the fast copy by default');
  assert.equal(w.appBackendDefault({ outputs: { app: true, app_access: 'user' } }, { state: 'available' }), 'delta', 'a per-user App reads Delta');
  assert.equal(w.appBackendOf(shared, { state: 'absent' }), 'delta', 'no Lakebase here means Delta');
});

test('a per-user App never claims fast pages are recommended: it says why Lakebase is not possible and pre-selects Delta', async () => {
  const w = await load();
  assert.equal(w.LAKEBASE_PER_USER_REASON, "Each person signs in as themselves. Inspire checks which tables Fast pages can keep to each person's rows, and this App uses Standard pages until it has checked them."); // P c0c9a045 new contract
  assert.equal(w.PER_USER_GUIDE, 'Each person signs in as themselves, so pages read your tables directly. Pick Delta here.');
  const perUser = { outputs: { app: true, app_access: 'user' } };
  assert.equal(w.appBackendOf(perUser, { state: 'available' }), 'delta', 'the pre-selected choice is Delta');
  assert.equal(w.bestAppBackend ? w.bestAppBackend(perUser, { state: 'available' }) : null, null, 'no Recommended badge on a per-user App');
});

test('a new spec has the Genie Agent and App on and the dashboard and alert off, signs each viewer in as themselves, and validates as made', async () => {
  const { w, spec } = await appSpec();
  const fresh = w.defaultSpecFromUseCase(UC, {});
  assert.deepEqual(['dashboard', 'genie_space', 'app', 'alert'].map((k) => fresh.outputs[k]), [false, true, true, false], 'the dashboard starts off but stays a choice');
  assert.ok(w.IMPLEMENT_OUTPUTS.some((o) => o.id === 'dashboard') && w.IMPLEMENT_OUTPUTS.some((o) => o.id === 'alert'), 'Dashboard and Alert are still offered');
  assert.equal(fresh.outputs.app_access, 'user');
  assert.equal(w.appBackendOf(fresh, { state: 'available' }), 'delta', 'a per-user App reads Delta tables even where Lakebase is offered');
  const shared = { ...fresh, outputs: { ...fresh.outputs, app_access: 'sp' } };
  assert.equal(w.appBackendOf(shared, { state: 'available' }), 'lakebase', 'a shared App in a workspace with Lakebase gets Lakebase by default');
  assert.equal(w.appBackendOf(fresh, { state: 'absent' }), 'delta');
  assert.deepEqual(Object.keys(w.appBackendBlocks(fresh, { state: 'available' })), ['lakebase'], 'per-user keeps Lakebase off');
  assert.deepEqual(w.appBackendBlocks(shared, { state: 'available' }), {});
  assert.match(w.APP_ACCESS_NOTE, /^Each person signs in as themselves and sees only the rows their access allows\.$/);
  for (const note of [w.APP_ACCESS_NOTE, w.FRESH_HELP]) assert.ok(note.split(' ').length <= 15, `${note} is over 15 words (must-fail on the long copy)`);
  assert.match(w.APP_ACCESS_CHOICES.find((c) => c.id === 'sp').blurb, /^The App reads with its own access/);
  assert.deepEqual(fresh.outputs.app_look, { style: 'a', layout: 'sidebar', palette: 'default', theme: 'light' });
  assert.deepEqual(fresh.outputs.app_options, { modify: false, replace_edits: false, decisions: true, alerts: false }, 'record decisions start on, alerts start off');
  assert.deepEqual(fresh.outputs.merge, { app: '', dashboard: '', genie_space: '' });
  assert.deepEqual(served(spec).errors, []);
  const unchosen = { ...spec, outputs: { ...spec.outputs, app_access: '' } };
  assert.ok(served(unchosen).errors.some((e) => e.startsWith('choose who the App reads its data as')));
  const chosen = w.withAppAccess(unchosen, 'sp');
  assert.deepEqual(served(chosen).errors, []);
  assert.deepEqual(served(chosen).spec.outputs.app_look, fresh.outputs.app_look);
});

test('per-user sign-in keeps record decisions, hides and clears alerts, and the replace question shows only while edits are on', async () => {
  const { w, spec } = await appSpec({ app_access: 'sp', app_options: { modify: false, replace_edits: false, decisions: true, alerts: true } });
  assert.deepEqual(['modify', 'decisions', 'replace_edits', 'alerts'].map((k) => w.appOptionShown(spec, k)), [true, true, false, true]);
  const perUser = w.withAppAccess(spec, 'user');
  assert.deepEqual(perUser.outputs.app_options, { modify: false, replace_edits: false, decisions: true, alerts: false });
  assert.deepEqual(['modify', 'decisions', 'alerts'].map((k) => w.appOptionShown(perUser, k)), [true, true, false]);
  assert.equal(w.withAppAccess(w.withAppOption(spec, 'decisions', false), 'user').outputs.app_options.decisions, false,
    'switching to per-user keeps a decisions choice that was turned off');
  assert.match(w.PER_USER_REASON, /people record decisions only on the records they can read, and the App sends no alerts and offers no chart image export\.$/);
  assert.doesNotMatch(w.PER_USER_REASON, /[\u2013\u2014]/);
  assert.doesNotMatch(w.PER_USER_REASON, /download/i);
  const core = appShellPayload(bundledAppShellText()).files['shell_core.py'];
  if (/image_export/.test(core)) assert.match(core, /"image_export": s\["auth"\] == "sp"/, 'the App shell offers chart image export only to a shared App');
  const editing = w.withAppOption(perUser, 'modify', true);
  assert.equal(w.appOptionShown(editing, 'replace_edits'), true);
  assert.equal(editing.outputs.app_options.replace_edits, false, 'a new run keeps edits unless asked');
  const replacing = w.withAppOption(editing, 'replace_edits', true);
  assert.equal(replacing.outputs.app_options.replace_edits, true);
  assert.equal(w.withAppOption(replacing, 'modify', false).outputs.app_options.replace_edits, false, 'turning edits off clears the replace answer');
  assert.deepEqual(w.withAppAccess(replacing, 'sp').outputs.app_options, replacing.outputs.app_options, 'internal access leaves the options alone');
});

test('ticking the App ticks the Genie Agent and locks it, and the lock refuses an untick', async () => {
  const w = await load();
  const spec = w.defaultSpecFromUseCase(UC, { warehouseId: 'wh1', inspireDatabase: 'main.inspire' });
  const ticked = w.withOutput(spec, 'app', true);
  assert.deepEqual([ticked.outputs.app, ticked.outputs.genie_space], [true, true]);
  assert.equal(w.withOutput(ticked, 'genie_space', false), ticked, 'the Genie Agent cannot be unticked while the App is ticked');
  const off = w.withOutput(ticked, 'app', false);
  assert.deepEqual([off.outputs.app, off.outputs.genie_space], [false, true], 'unticking the App leaves the Genie Agent as it is');
  assert.equal(w.withOutput(off, 'genie_space', false).outputs.genie_space, false);
  assert.deepEqual(w.withOutput(spec, 'alert', true).outputs.alert_recipients, w.defaultAlertRecipients(spec));
  assert.deepEqual(w.wizardSteps('mvp', ticked).map((s) => s.id), ['delivery', 'data', 'stake', 'where', 'app', 'app_look', 'run', 'summary']);
  assert.deepEqual(w.wizardSteps('mvp', off).map((s) => s.id), ['delivery', 'data', 'stake', 'run', 'summary'], 'with Apps unticked no App step shows');
  assert.deepEqual(w.stepErrors('delivery', { ...ticked, outputs: { ...ticked.outputs, genie_space: false } }), [w.GENIE_FOR_APP_NOTE]);
});

test('joining an existing App deploys to it with its look, Create new brings the use case name back, and per-user into a service-principal App is blocked', async () => {
  const { w, spec } = await appSpec({ app_access: 'user' });
  const sp = { id: 'churn-desk', name: 'churn-desk', access: 'sp', look: { style: 'b', palette: 'ocean' }, per_user_block: 'churn-desk is internal only',
    use_cases: [{ use_case_id: 'N01-U02', name: 'Forecast demand' }, { use_case_id: 'N01-U03', name: 'Score suppliers' },
      { use_case_id: 'N01-U04', name: 'Plan stock' }, { use_case_id: 'N01-U05', name: 'Route vans' }] };
  const user = { id: 'care-desk', name: 'care-desk', access: 'user', use_cases: [{ use_case_id: 'N02-U01', name: 'Care calls' }] };
  const targets = { app: [sp, user], dashboard: [], genie_space: [] };
  const joined = w.withMergeTarget(spec, 'app', sp, 'predict-churn');
  assert.deepEqual([joined.outputs.merge.app, joined.outputs.app_name], ['churn-desk', 'churn-desk']);
  assert.deepEqual(joined.outputs.app_look, { style: 'b', layout: 'sidebar', palette: 'ocean', theme: 'light' });
  assert.equal(w.appMergeBlock(joined, sp), 'churn-desk is internal only');
  assert.deepEqual(w.stepErrors('where', joined, { mergeTargets: targets }), ['churn-desk is internal only'], 'the block shows on Where it lives, where the App is picked');
  assert.throws(() => w.stepErrors('app', joined, { mergeTargets: targets }), /unknown wizard step 'app'/, 'a joined App has no Who uses the App step (must-exclude)');
  assert.deepEqual(w.stepErrors('delivery', w.withAppAccess(joined, 'sp'), { mergeTargets: targets }), []);
  assert.equal(w.appMergeBlock(w.withMergeTarget(spec, 'app', user), user), '', 'per-user may join a per-user App');
  const back = w.withMergeTarget(joined, 'app', null, 'predict-churn');
  assert.deepEqual([back.outputs.merge.app, back.outputs.app_name], ['', 'predict-churn']);
  assert.deepEqual(back.outputs.app_look, w.APP_LOOK_DEFAULT, 'a new App starts from the default look, not the one it nearly joined');
  assert.deepEqual(w.withMergeTarget(joined, 'app', user).outputs.app_look, w.APP_LOOK_DEFAULT, 'an App with no recorded look shows the default');
  assert.deepEqual(w.withMergeTarget(joined, 'dashboard', { id: 'd1' }).outputs.app_look, joined.outputs.app_look, 'a dashboard pick leaves the App look alone');
  assert.equal(w.mergeTargetText(sp), 'Forecast demand, Score suppliers, Plan stock and 1 more');
  assert.equal(w.mergeTargetText(user), 'Care calls');
  const stale = w.withMergeTarget(w.withOutput(w.withAppAccess(spec, 'sp'), 'dashboard', true), 'dashboard', { id: 'gone' });
  assert.deepEqual(w.stepErrors('delivery', stale, { mergeTargets: targets }), ['pick a Dashboard Inspire built to add to, or choose Create new']);
  assert.deepEqual(w.stepErrors('delivery', stale, { mergeTargets: targets, held: { dashboard: 'gone' } }), [], 'the one it already holds is fine');
  assert.deepEqual(w.stepErrors('delivery', stale, {}), [], 'nothing is judged before the list loads');
});

test('a use case that joins an existing App skips App access and App look, shows and checks no App owners, and sends none', async () => {
  const { w, spec } = await appSpec({ app_access: 'sp', app_owners: ['nope', 'lee@example.com'] });
  const hub = { id: 'inspire-hub-acme', name: 'inspire-hub-acme', access: 'sp', use_cases: [{ use_case_id: 'N01-U02', name: 'Forecast demand' }] };
  const targets = { app: [hub], dashboard: [], genie_space: [] };
  const joined = w.withMergeTarget(spec, 'app', hub, 'predict-churn');
  const fresh = w.withMergeTarget(joined, 'app', null, 'predict-churn');
  assert.deepEqual([w.joinsApp(joined), w.joinsApp(fresh), w.joinsApp({ ...joined, outputs: { ...joined.outputs, app: false } }), w.joinsApp(null)], [true, false, false, false]);
  assert.equal(w.wizardSteps('mvp', joined).find((s) => s.id === 'app'), undefined, 'the existing App keeps its sign-in, data source and look');
  assert.deepEqual(w.wizardSteps('mvp', joined).find((s) => s.id === 'where').panels, ['app_place'], 'where it goes is still picked on Where it lives');
  assert.deepEqual(w.wizardSteps('mvp', fresh).find((s) => s.id === 'app').panels, ['app_access']);
  assert.deepEqual(w.wizardSteps('mvp', fresh).find((s) => s.id === 'where').panels, ['app_place', 'app_features']);
  assert.deepEqual(w.wizardSteps('mvp', joined).map((s) => s.id), w.wizardSteps('mvp', fresh).map((s) => s.id).filter((id) => id !== 'app' && id !== 'app_look'),
    'a joined App keeps its own pages, look and sign-in, so it has no App steps (must-exclude)');
  assert.deepEqual(w.stepErrors('delivery', joined, { mergeTargets: targets }), [], 'no hidden App owner blocks Next');
  assert.deepEqual(w.advancedErrors('delivery', joined, { mergeTargets: targets }), []);
  assert.deepEqual(w.stepErrors('delivery', fresh, { mergeTargets: targets }), ['App owners must be email addresses: nope'], 'a new App still checks its owners');
  assert.deepEqual(w.sentSpec(joined, null).outputs.app_owners, [], 'owners typed before picking the existing App are not sent');
  assert.deepEqual(w.sentSpec(fresh, null).outputs.app_owners, ['nope', 'lee@example.com']);
  const plain = w.withMergeTarget({ ...spec, outputs: { ...spec.outputs, app_owners: [] } }, 'app', hub);
  const { app_charts: _charts, app_pages: _pages, ...kept } = w.specWithBackend(plain, null).outputs;
  assert.deepEqual(w.sentSpec(plain, null), { ...w.specWithBackend(plain, null), outputs: kept }, 'with no owners typed, only the charts and pages are dropped, since the hub keeps its own');
  assert.doesNotMatch(w.joinedAppText(hub), /[\u2013\u2014]/);
  assert.doesNotMatch(w.joinedAppText(hub), /access and look next/, 'the join text never promises the App steps it skips');
  assert.doesNotMatch(w.IMPLEMENT_OUTPUTS.find((o) => o.id === 'app').blurb, /next/, 'the App tile says what comes next only for a new App');
});

test('the App reads Lakebase by default when the workspace has it, Delta tables otherwise, and a per-user App always reads Delta tables', async () => {
  const { w, spec } = await appSpec({ app_access: 'sp' });
  const offer = (state, detail = '') => ({ state, detail });
  assert.deepEqual(w.APP_BACKEND_CHOICES.map((c) => [c.id, c.label]), [
    ['lakebase', 'Fast pages (Lakebase)'], ['delta', 'Delta']]);
  assert.deepEqual(w.APP_BACKENDS, SHELL.backends, 'the wizard offers the backends the App shell reads');
  for (const text of [...w.APP_BACKEND_CHOICES.flatMap((c) => [c.label, c.blurb]).filter(Boolean), w.LAKEBASE_PER_USER_REASON, w.LAKEBASE_CHECKING]) {
    assert.doesNotMatch(text, /\u2014|\u2013/, `no dashes: ${text}`);
  }
  assert.equal(spec.outputs.app_backend, '', 'a new spec leaves the backend to the default');
  assert.equal(w.appBackendOf(spec, offer('available')), 'lakebase');
  for (const state of ['absent', 'denied', 'unknown']) assert.equal(w.appBackendOf(spec, offer(state)), 'delta', state);
  assert.equal(w.appBackendOf(spec, null), 'delta', 'nothing is assumed before the check answers');
  const picked = w.withAppBackend(spec, 'delta');
  assert.equal(w.appBackendOf(picked, offer('available')), 'delta', 'a pick of Delta stays');
  const kept = w.withAppBackend(spec, 'lakebase');
  assert.equal(w.appBackendOf(kept, offer('denied', 'no access')), 'lakebase', 'an App already on Lakebase stays there when the editor cannot use it');
  assert.equal(w.appBackendOf(kept, offer('absent')), 'delta', 'a workspace without Lakebase reads Delta tables');
  const perUser = w.withAppAccess(kept, 'user');
  assert.equal(w.appBackendOf(perUser, offer('available')), 'delta');
  assert.deepEqual(w.appBackendBlocks(perUser, offer('available')), { lakebase: { why: w.LAKEBASE_PER_USER_REASON, details: '' } });
  assert.deepEqual(w.appBackendBlocks(spec, offer('denied', 'PERMISSION_DENIED')), { lakebase: { why: w.needsAccess('PERMISSION_DENIED'), details: 'PERMISSION_DENIED' } },
    'the raw refusal goes under Details, never in the reason');
  assert.deepEqual(w.appBackendBlocks(spec, offer('absent', 'no projects')), { lakebase: { why: w.LAKEBASE_ABSENT, details: 'no projects' } });
  assert.deepEqual(w.appBackendBlocks(spec, offer('unknown')), {}, 'an unchecked workspace blocks nothing');
  assert.deepEqual(w.appBackendBlocks(spec, offer('available')), {});
  assert.equal(w.appBackendOf(w.withAppAccess(perUser, 'sp'), offer('available')), 'lakebase', 'back to a shared App, the pick comes back');
  const joined = w.withMergeTarget(spec, 'app', { id: 'churn-desk', name: 'churn-desk', access: 'sp' });
  assert.equal(w.appBackendOf(joined, offer('available')), 'delta', 'a use case that joins an App sends no new backend of its own');
  assert.equal(w.appBackendOf({ ...spec, outputs: { ...spec.outputs, app: false } }, offer('available')), '');

  const sent = w.specWithBackend(spec, offer('available'));
  assert.equal(sent.outputs.app_backend, 'lakebase');
  assert.equal(w.specWithBackend(sent, offer('available')), sent, 'a spec that already says it is sent as it is');
  assert.deepEqual(served(sent).errors, []);
  assert.equal(served(sent).spec.outputs.app_backend, 'lakebase');
  assert.equal(served(w.specWithBackend(perUser, offer('available'))).spec.outputs.app_backend, 'delta');

  assert.deepEqual(w.stepErrors('app', spec, { lakebase: null }), [w.LAKEBASE_CHECKING], 'Next waits for the Lakebase check');
  assert.deepEqual(w.stepErrors('app', spec, { lakebase: offer('absent') }), []);
  assert.deepEqual(w.stepErrors('app', perUser, { lakebase: null }), [], 'a per-user App does not wait: it reads Delta tables');
  assert.deepEqual(w.stepErrors('app', spec, {}), [], 'a caller that does not check Lakebase is not blocked');
});

test('Edit of an App built before Lakebase keeps it on Delta tables, and one never built keeps the choice open', async () => {
  const w = await load();
  const fallback = w.defaultSpecFromUseCase(UC, { warehouseId: 'wh1', inspireDatabase: 'main.inspire' });
  const outputs = { ...fallback.outputs, app: true, app_access: 'sp' };
  delete outputs.app_backend;
  const latest = { spec_version: 3, spec_json: { ...fallback, outputs } };
  assert.equal(w.specFromLatest(latest, fallback, { app: 'churn-desk' }).outputs.app_backend, 'delta');
  assert.equal(w.specFromLatest(latest, fallback).outputs.app_backend, '');
  const onLakebase = { spec_version: 4, spec_json: { ...fallback, outputs: { ...outputs, app_backend: 'lakebase' } } };
  assert.equal(w.specFromLatest(onLakebase, fallback, { app: 'churn-desk' }).outputs.app_backend, 'lakebase');
});

test('an Edit of a version saved before result tables carried the session keeps the table it was built on', async () => {
  const w = await load();
  const fallback = w.defaultSpecFromUseCase(UC, { warehouseId: 'wh1', inspireDatabase: 'main.inspire', sessionId: '42' });
  const older = { spec_version: 3, spec_json: { ...fallback, config: { ...fallback.config, result_table: 'main.inspire.n01_u01_out' } } };
  const edited = w.specFromLatest(older, fallback);
  assert.equal(fallback.config.result_table, 'main._inspire_n01_u01.n01_u01_results');
  assert.equal(edited.config.result_table, 'main.inspire.n01_u01_out');
  assert.deepEqual(w.sectionErrors('results', edited), []);
  const fresh = w.specFromLatest(null, fallback);
  assert.equal(fresh.config.result_table, 'main._inspire_n01_u01.n01_u01_results');
});

test('the result table is picked as catalog, schema and name, defaults to its own schema and refuses a partial name', async () => {
  const w = await load();
  const spec = w.defaultSpecFromUseCase(UC, { warehouseId: 'wh1', inspireDatabase: 'main.inspire', sessionId: '1111111111111111111' });
  assert.equal(spec.config.result_table, 'main._inspire_n01_u01.n01_u01_results');
  assert.deepEqual(w.resultTableParts(spec.config.result_table), { catalog: 'main', schema: '_inspire_n01_u01', table: 'n01_u01_results' });
  const other = w.defaultSpecFromUseCase(UC, { warehouseId: 'wh1', inspireDatabase: 'main.inspire', sessionId: 2222222222222222222n });
  assert.equal(other.config.result_table, spec.config.result_table, 'the schema name carries no session digits; the context check keeps two sessions apart');
  for (const sessionId of [undefined, '', 'abc', '12 3', null]) {
    assert.equal(w.defaultSpecFromUseCase(UC, { inspireDatabase: 'main.inspire', sessionId }).config.result_table, '',
      `no default without a session id (${String(sessionId)})`);
  }
  assert.equal(w.defaultResultTable('', 'N01-U01', '42'), '');
  assert.equal(w.defaultResultTable('main.inspire', '', '42'), '');
  assert.deepEqual(w.resultTableParts(''), { catalog: '', schema: '', table: '' });
  const moved = w.withResultTable(spec, { catalog: 'sales', schema: 'mvp', table: ' churn_out ' });
  assert.equal(moved.config.result_table, 'sales.mvp.churn_out');
  assert.deepEqual(w.sectionErrors('results', moved), []);
  assert.deepEqual(w.sectionErrors('results', w.withResultTable(spec, { catalog: 'sales', schema: '', table: 'x' })),
    ['pick a catalog and a schema, and name the result table']);
  assert.deepEqual(w.sectionErrors('results', w.withResultTable(spec, { catalog: 'sales', schema: 'mvp', table: 'churn out' })),
    ['the result table can only use catalog, schema and table names of letters, digits, _ and -']);
  assert.equal(w.withResultTable(spec, { catalog: '', schema: '', table: '' }).config.result_table, '');
  assert.match(w.RESULT_TABLE_MOVE_NOTE, /copies its history to the new table and keeps the old one/);
});

test('Edit of a version the old wizard saved gets every new App setting with its default, and keeps the ones it saved', async () => {
  const w = await load();
  const fallback = w.defaultSpecFromUseCase(UC, { warehouseId: 'wh1', inspireDatabase: 'main.inspire' });
  const old = w.specFromLatest({ spec_version: 1, spec_json: { ...fallback, outputs: { dashboard: true, app: true, app_name: 'churn-desk' } } }, fallback);
  assert.equal(old.outputs.app_access, 'user', 'a version saved before the choice existed gets the default: each viewer signs in');
  const unpicked = w.specFromLatest({ spec_version: 1, spec_json: { ...fallback, outputs: { ...fallback.outputs, app_access: '' } } }, fallback);
  assert.equal(unpicked.outputs.app_access, 'user', 'a saved draft that never picked the access gets the default');
  const shared = w.specFromLatest({ spec_version: 1, spec_json: { ...fallback, outputs: { ...fallback.outputs, app_access: 'sp' } } }, fallback);
  assert.equal(shared.outputs.app_access, 'sp', 'a saved shared choice is kept');
  const perUser = w.specFromLatest({ spec_version: 1, spec_json: { ...fallback, outputs: { ...fallback.outputs, app_access: 'user' } } }, fallback);
  assert.equal(perUser.outputs.app_access, 'user', 'a saved per-user choice is kept');
  const live = w.specFromLatest({ spec_version: 1, spec_json: { ...fallback, outputs: { dashboard: true, app: true, app_name: 'churn-desk' } } }, fallback,
    { app: 'churn-desk' });
  assert.equal(live.outputs.app_access, 'sp', 'an App built before the choice existed signs in with its service principal, and Edit says so');
  assert.deepEqual(old.outputs.app_look, w.APP_LOOK_DEFAULT);
  assert.deepEqual(old.outputs.merge, { app: '', dashboard: '', genie_space: '' });
  const saved = w.specFromLatest({ spec_version: 2, spec_json: { ...fallback, outputs: { ...fallback.outputs, app: true, app_access: 'user',
    app_look: { palette: 'mono' }, app_options: { modify: true }, merge: 'bad' } } }, fallback);
  assert.equal(saved.outputs.app_access, 'user');
  assert.deepEqual(saved.outputs.app_look, { ...w.APP_LOOK_DEFAULT, palette: 'mono' });
  assert.deepEqual(saved.outputs.app_options, { modify: true, replace_edits: false, decisions: true, alerts: false });
  const savedOff = w.specFromLatest({ spec_version: 2, spec_json: { ...fallback, outputs: { ...fallback.outputs, app: true, app_access: 'user',
    app_options: { modify: false, replace_edits: false, decisions: false, alerts: false } } } }, fallback);
  assert.equal(savedOff.outputs.app_options.decisions, false, 'a version saved with decisions turned off keeps them off');
  assert.deepEqual(saved.outputs.merge, { app: '', dashboard: '', genie_space: '' }, 'a merge that is not an object is dropped');
});

test('every user-visible output label and preflight label says Genie Agent', async () => {
  const w = await load();
  assert.equal(w.IMPLEMENT_OUTPUTS.find((o) => o.id === 'genie_space').label, 'Genie Agent');
  assert.equal(w.PREFLIGHT_LABELS.genie_spaces, 'Genie Agents');
  assert.equal(backend.IMPLEMENT_OUTPUT_LABELS.genie_space, 'Genie Agent');
  const fs = require('node:fs');
  const files = [
    path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', 'implementWizard.js'),
    path.resolve(__dirname, '..', '..', 'frontend', 'src', 'pages', 'ImplementWizard.jsx'),
    path.resolve(__dirname, '..', 'lib', 'inspireImplement.js'),
    path.resolve(__dirname, '..', 'implementRoutes.js'),
    path.resolve(__dirname, '..', '..', 'frontend', 'src', 'pages', 'ImplementPage.jsx'),
    path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', 'implementControl.js'),
    path.resolve(__dirname, '..', 'lib', 'implementControl.js'),
    ...['BuildUi.jsx', 'ImplementControlTower.jsx', 'MvpProgress.jsx', 'GenieFeed.jsx', 'ImplementCardActions.jsx', 'ImplementStatusBadge.jsx', 'VibesEditor.jsx']
      .map((name) => path.resolve(__dirname, '..', '..', 'frontend', 'src', 'components', name)),
  ];
  for (const file of files) assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /Genie spaces?\b|Space name/, path.basename(file));
});

test('the wizard offers Send alerts, off by default, in plain words, and hides it with a reason for a per-user App', async () => {
  const { w, spec } = await appSpec({ app_access: 'sp' });
  const option = w.APP_OPTIONS.find((o) => o.id === 'alerts');
  assert.equal(option.label, 'Send alerts');
  assert.match(option.blurb, /^People set up email alerts on what the App shows, each on its own schedule, sent only to people in this workspace\./);
  assert.match(option.blurb, /a record's owner gets an email when someone assigns it to them\.$/);
  assert.doesNotMatch(option.blurb, /\u2014|\u2013/);
  assert.equal(spec.outputs.app_options.alerts, false);
  const on = w.withAppOption(spec, 'alerts', true);
  assert.equal(on.outputs.app_options.alerts, true);
  assert.deepEqual(served(on).errors, []);
  assert.equal(served(on).spec.outputs.app_options.alerts, true);
  const perUser = w.withAppAccess(on, 'user');
  assert.equal(perUser.outputs.app_options.alerts, false);
  assert.equal(w.appOptionShown(perUser, 'alerts'), false);
  assert.match(w.PER_USER_REASON, /no alerts/);
});

test('an output the workspace cannot create starts off, an output already built stays on, and the App goes off before its Genie Agent', async () => {
  const w = await load();
  const fresh = w.defaultSpecFromUseCase(UC, {});
  const all = { apps: true, genie_spaces: true, alerts: true };
  assert.deepEqual(w.unavailableOutputs(all, null, {}), []);
  assert.deepEqual(w.unavailableOutputs(all, { app: { ok: false } }, {}), ['app']);
  assert.deepEqual(w.unavailableOutputs(all, { app: { ok: false } }, { app: 'hub' }), [], 'a built App is not blocked by the create check');
  assert.deepEqual(w.unavailableOutputs({ apps: false, genie_spaces: false, alerts: false }, null, {}), ['app', 'genie_space', 'alert']);
  const off = w.withoutUnavailableOutputs(fresh, ['app'], {});
  assert.deepEqual(['dashboard', 'genie_space', 'app'].map((k) => off.outputs[k]), [false, true, false]);
  assert.equal(w.withoutUnavailableOutputs(fresh, ['app', 'genie_space'], {}).outputs.genie_space, false, 'the App goes off first, so its Genie Agent can too');
  assert.equal(w.withoutUnavailableOutputs(fresh, ['app'], { app: 'hub' }).outputs.app, true, 'an App already built stays, so Edit never drops it');
  assert.equal(w.withoutUnavailableOutputs(fresh, [], {}), fresh);
});

test('the wizard\'s chart kinds, Inspire\'s pick and the pages it can turn off are the App shell\'s own, with the labels Genie is told', async () => {
  const w = await load();
  assert.deepEqual(w.APP_CHART_KINDS.map((k) => k.id), SHELL.chart_kinds);
  assert.deepEqual(w.APP_CHART_PICK, SHELL.chart_pick);
  assert.deepEqual(w.APP_SCREENS, SHELL.screens);
  assert.equal(w.APP_CHARTS_MIN, backend.IMPLEMENT_APP_CHARTS_MIN);
  const sql = appShellPayload(bundledAppShellText()).files['shell_sql.py'];
  const labels = sql.split('\n').find((line) => line.startsWith('CHART_KIND_LABELS = '));
  const block = sql.slice(sql.indexOf(labels), sql.indexOf('}', sql.indexOf(labels)) + 1);
  for (const kind of w.APP_CHART_KINDS) {
    const m = block.match(new RegExp(`"${kind.id}": "([^"]+)"`));
    assert.ok(m, `the shell labels ${kind.id}`);
    assert.equal(kind.label, m[1], `the wizard calls ${kind.id} what Genie is told`);
  }
});

test('a per-user App defaults to Fast pages only when the check says every table keeps each person to their rows, and names each table that reads Delta (must-exclude)', async () => {
  const { w, spec } = await appSpec({ app_access: 'user' });
  const offer = (enforce, state = 'available') => ({ state, detail: '', enforce });
  const enforced = { mapping: { map: 'main.sec.map' }, column: 'region', enforced: true, filtered: true, reason: '' };
  const plain = { enforced: true, filtered: false, reason: '' };
  const refused = { enforced: false, filtered: true, reason: 'the row filter main.sec.fn is not a user-to-key mapping table' };
  assert.equal(w.appBackendDefault(spec, offer({ 'main.s.orders': enforced, 'main.s.plain': plain })), 'lakebase');
  assert.equal(w.appBackendOf(spec, offer({ 'main.s.orders': enforced, 'main.s.plain': plain })), 'lakebase');
  assert.deepEqual(w.appBackendBlocks(spec, offer({ 'main.s.orders': enforced, 'main.s.plain': plain })), {});
  assert.equal(w.appBackendOf(spec, offer({ 'main.s.orders': enforced, 'main.s.returns': refused })), 'delta', 'one refused table keeps the App on Standard pages');
  assert.deepEqual(w.appBackendBlocks(spec, offer({ 'main.s.orders': enforced, 'main.s.returns': refused })),
    { lakebase: { why: 'Fast pages cannot keep each person to their own rows here: main.s.returns uses Standard pages because the row filter main.sec.fn is not a user-to-key mapping table.', details: '' } });
  assert.equal(w.appBackendOf(spec, offer({ 'main.s.a': enforced, 'main.s.b': enforced })), 'lakebase', 'two filtered tables that both map are each ANDed into the view');
  assert.deepEqual(w.appBackendBlocks(spec, offer({ 'main.s.a': enforced, 'main.s.b': enforced })), {});
  assert.equal(w.appBackendOf(spec, offer({ 'main.s.orders': enforced }, 'absent')), 'delta');
  const picked = w.withAppBackend(spec, 'lakebase');
  assert.equal(w.appBackendOf(picked, offer({ 'main.s.orders': refused })), 'delta', 'a Fast pages pick the check refuses falls back to Delta');
});
