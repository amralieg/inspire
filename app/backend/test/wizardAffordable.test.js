const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const lib = (name) => import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', name)).href);
const UC = { id: 'N01-U01', use_case: 'Predict churn', primary_table: 'main.s.orders', tables_involved: 'main.s.orders' };
const ON = { apps: true, genie_spaces: true, alerts: true };
const APP_DENIED = { ok: false, detail: 'you lack CREATE TABLE on main.n01_u01', grants: ['GRANT USE SCHEMA, CREATE TABLE ON SCHEMA `main`.`n01_u01` TO `sp`'] };

test('an option the person cannot afford is blocked, is never the default, and the badge moves to the best one that works', async () => {
  const H = await lib('recommended.js');
  const w = await lib('implementWizard.js');
  const open = H.affordable(['a', 'b', 'c'], {}, (id) => `why ${id}`);
  assert.deepEqual([open.best, open.none], [{ id: 'a', reason: 'why a' }, '']);
  const moved = H.affordable(['a', 'b', 'c'], { a: { why: 'Off here.' } }, (id) => `why ${id}`);
  assert.deepEqual(moved.open, ['b', 'c']);
  assert.deepEqual(moved.best, { id: 'b', reason: 'why b' }, 'the badge moves to the first option that works');
  assert.equal(H.bestOutput({ app: w.blockOf(w.OFF_IN_WORKSPACE.app, w.OFF_DETAILS) }).id, 'genie_space', 'App blocked: the Genie Agent is Recommended');
  assert.equal(H.bestOutput(w.outputBlocks(ON, { app: APP_DENIED })).id, 'genie_space', 'App denied by the access check: the badge moves too');
  assert.equal(H.bestOutput(w.outputBlocks(ON, null)).id, 'app');
});

test('when no option works, the wizard says so in one line and blocks Next with that reason', async () => {
  const H = await lib('recommended.js');
  const w = await lib('implementWizard.js');
  const none = H.affordable(['a', 'b'], { a: { why: 'Off here.' }, b: { why: 'Needs access.' } }, () => '', (id) => id.toUpperCase());
  assert.equal(none.best, null);
  assert.equal(none.none, `${H.NONE_WORKS}: A, off here; B, needs access.`);
  const all = Object.fromEntries(w.IMPLEMENT_OUTPUTS.map((o) => [o.id, { why: 'Off here.' }]));
  const spec = w.defaultSpecFromUseCase(UC, { warehouseId: 'wh', inspireDatabase: 'main.inspire' });
  const problems = w.blockedOutputProblems(spec, all);
  assert.match(problems[0], new RegExp(`^${H.NONE_WORKS}: `));
  assert.ok(w.stepErrors('delivery', spec, { outputBlocks: all }).includes(problems[0]), 'Delivery cannot move on');
  assert.deepEqual(w.blockedOutputProblems(spec, {}), [], 'nothing blocked, nothing to say (must-exclude)');
});

test('one shared block shape: a short plain reason, and Details with the exact grant', async () => {
  const w = await lib('implementWizard.js');
  const off = w.outputBlocks({ apps: false, genie_spaces: false, alerts: false }, null);
  assert.deepEqual(Object.keys(off).sort(), ['alert', 'app', 'genie_space']);
  for (const block of Object.values(off)) assert.deepEqual(Object.keys(block).sort(), ['details', 'why']);
  const denied = w.outputBlocks(ON, null, {}, { checks: { app_access: APP_DENIED } });
  assert.equal(denied.app.why, 'Needs access Inspire does not have on the schema.', 'CREATE TABLE is a right on the schema, not a table');
  assert.match(denied.app.details, /GRANT USE SCHEMA, CREATE TABLE ON SCHEMA `main`.`n01_u01` TO `sp`/);
  assert.deepEqual(w.outputBlocks(ON, { app: APP_DENIED }, { app: 'churn-desk' }), {}, 'an App that already exists is kept, never blocked (must-exclude)');
  assert.deepEqual(w.outputBlocks(ON, { app: { ok: true } }, {}, { checks: { app_access: { ok: true } } }), {});
  const unticked = w.outputBlocks(ON, null, {}, { checks: {}, new_app: APP_DENIED });
  assert.equal(unticked.app.why, denied.app.why, 'the check run with the App off still blocks the App Inspire cannot build');
  assert.deepEqual(w.outputBlocks(ON, null, {}, { checks: {}, new_app: { ok: true } }), {}, 'a new App Inspire can build is not blocked (must-exclude)');
  assert.deepEqual(w.outputBlocks(ON, null, { app: 'churn-desk' }, { checks: {}, new_app: APP_DENIED }), {}, 'an App that already exists is never blocked by the new App check (must-exclude)');
  assert.doesNotMatch(`${w.needsAccess()} ${w.CANNOT_HERE} ${Object.values(w.OFF_IN_WORKSPACE).join(' ')}`, /[\u2013\u2014]/);
});

test('the result table place uses the same rule: a blocked place is never the default', async () => {
  const H = await lib('recommended.js');
  const ok = H.resultPlaceBlocks({ place: 'own' }, 'main.n01_u01.out', 'main.inspire.n01_u01_out', 'main');
  assert.deepEqual(ok, {});
  assert.equal(H.bestResultPlace(ok, 'main').id, 'own');
  const denied = H.resultPlaceBlocks({ place: 'inspire', note: 'no CREATE SCHEMA on main' }, 'main.n01_u01.out', 'main.inspire.n01_u01_out', 'main');
  assert.deepEqual(Object.keys(denied), ['own']);
  assert.equal(denied.own.details, 'no CREATE SCHEMA on main');
  assert.equal(H.bestResultPlace(denied, 'main').id, 'inspire', 'the badge moves to the Inspire schema');
  const both = H.resultPlaceBlocks({ place: 'inspire' }, '', '', 'main');
  assert.equal(H.bestResultPlace(both, 'main').id, 'pick', 'with neither, the person picks a place');
});

test('the Summary of an MVP build states what is built, never only a notebook, and names what was dropped', async () => {
  const w = await lib('implementWizard.js');
  const spec = w.defaultSpecFromUseCase(UC, { warehouseId: 'wh', inspireDatabase: 'main.inspire' });
  for (const ids of [['app', 'genie_space'], ['dashboard'], ['genie_space', 'alert'], []]) {
    const outputs = Object.fromEntries(w.IMPLEMENT_OUTPUTS.map((o) => [o.id, ids.includes(o.id)]));
    const text = w.pickedSummary({ ...spec, outputs: { ...spec.outputs, ...outputs } }).find((r) => r.id === 'outputs').value;
    assert.match(text, /^The MVP: /, JSON.stringify(ids));
    assert.doesNotMatch(text, /^The MVP: Notebook|^Notebook/, 'never reads as a notebook build');
    for (const id of ids) assert.ok(text.includes(w.IMPLEMENT_OUTPUTS.find((o) => o.id === id).label), id);
    assert.ok(text.includes('the result table'));
  }
  const why = w.needsAccess('GRANT USE SCHEMA ON SCHEMA `main`.`s` TO `sp`');
  const blocks = { app: w.blockOf(why, 'GRANT ...') };
  const before = { ...spec, outputs: { ...spec.outputs, app: true, genie_space: true } };
  const after = w.withoutUnavailableOutputs(before, ['app']);
  const dropped = w.droppedOutputs(before, after, blocks);
  assert.deepEqual(dropped, [{ id: 'app', label: 'App', why }]);
  const rows = w.pickedSummary(after, [], { dropped });
  assert.deepEqual(rows.find((r) => r.id === 'dropped'), { id: 'dropped', step: 'delivery', label: 'Not built', value: `App: ${why}` });
  assert.ok(!rows.find((r) => r.id === 'outputs').value.includes('App,'), 'the dropped App is not listed as built');
  assert.equal(w.pickedSummary(after).some((r) => r.id === 'dropped'), false, 'nothing dropped, no row (must-exclude)');
  assert.deepEqual(w.droppedOutputs(before, after, {}), [], 'a person unticking it is not a drop');
});

test('Results holds only the table place; Run it holds Keep it fresh and Measure impact; the wizard has no Team capacity', async () => {
  const w = await lib('implementWizard.js');
  const steps = w.wizardSteps('mvp', { outputs: { app: true } }, { grouping: true, firstRun: true });
  const results = steps.find((s) => s.id === 'results');
  assert.deepEqual(results.sections, ['results']);
  assert.deepEqual(steps.find((s) => s.id === 'run').sections, ['schedule', 'kpi', 'holdout']);
  assert.deepEqual(steps.find((s) => s.id === 'run').panels, ['fresh', 'measure'], 'Keep it fresh comes first');
  assert.equal(steps.flatMap((s) => s.sections).includes('capacity'), false);
  const spec = w.defaultSpecFromUseCase(UC, { warehouseId: 'wh', inspireDatabase: 'main.inspire' });
  assert.deepEqual([spec.schedule.enabled, w.freshnessOf(spec.schedule)], [true, 'daily'], 'Keep it fresh starts on, Daily');
  assert.match(w.FRESH_HELP, /\S/);
  assert.doesNotMatch(w.FRESH_HELP, /[\u2013\u2014]|cron|Quartz/i);
});

test('the step list stays the same while the access checks come back; only a person\'s choice changes it', async () => {
  const w = await lib('implementWizard.js');
  const spec = { outputs: { app: true, genie_space: true } };
  const before = w.wizardSteps('mvp', spec).map((s) => s.id);
  w.outputBlocks(ON, { app: APP_DENIED });
  assert.deepEqual(w.wizardSteps('mvp', spec).map((s) => s.id), before, 'a failed check blocks Next; it never unticks the App');
  const blocked = w.stepErrors('delivery', { ...w.defaultSpecFromUseCase(UC, { warehouseId: 'wh', inspireDatabase: 'main.inspire' }), outputs: { ...w.defaultSpecFromUseCase(UC, { warehouseId: 'wh', inspireDatabase: 'main.inspire' }).outputs, app: true } },
    { outputBlocks: w.outputBlocks(ON, { app: APP_DENIED }) });
  assert.ok(blocked.some((e) => e.startsWith('App cannot be built: ')), blocked.join(' | '));
  assert.notDeepEqual(w.wizardSteps('mvp', { outputs: { app: false, dashboard: true } }).map((s) => s.id), before, 'unticking the App does change the steps');
});

test('the short reason names the place Inspire lacks access to, never a schema when the gap is the warehouse', async () => {
  const w = await lib('implementWizard.js');
  const warehouse = 'Inspire cannot manage wh1, so it cannot give a new App access to it: ask the warehouse owner to grant Inspire CAN MANAGE on it';
  assert.equal(w.blockWhy(warehouse), 'Needs access Inspire does not have on the SQL warehouse.');
  assert.equal(w.blockWhy('its service principal needs USE CATALOG on catalog `main`; Inspire cannot manage the warehouse wh1'),
    'Needs access Inspire does not have on the catalog and the SQL warehouse.');
  assert.equal(w.blockWhy('you lack USE CATALOG, USE SCHEMA and CREATE TABLE'), 'Needs access Inspire does not have yet.', 'a right named alone is no place (must-exclude)');
  assert.equal(w.blockWhy('its service principal needs USE CATALOG on catalog `main`. Ask the owner to run: GRANT MANAGE ON CATALOG `main`; or choose a result table in a catalog and schema Inspire manages'),
    'Needs access Inspire does not have on the catalog.', 'advice that names a table or schema adds no place (must-exclude)');
  assert.equal(w.blockWhy('the name is taken'), w.CANNOT_HERE, 'not an access gap (must-exclude)');
  const blocks = w.outputBlocks(ON, null, {}, { checks: { app_access: { ok: false, detail: warehouse } } });
  assert.doesNotMatch(blocks.app.why, /schema/i);
});

test('the badge reason says the App cannot be built here, never that Apps are off, when the App is only blocked', async () => {
  const H = await lib('recommended.js');
  const w = await lib('implementWizard.js');
  const best = H.bestOutput(w.outputBlocks(ON, { app: APP_DENIED }));
  assert.equal(best.id, 'genie_space');
  assert.doesNotMatch(best.reason, /off/i);
  assert.match(best.reason, /^The App cannot be built here/);
});

test('checks of an output the person no longer builds never block the Summary or Build', async () => {
  const w = await lib('implementWizard.js');
  const checks = { output: { ok: true }, app_access: { ok: false, detail: 'Inspire cannot manage wh1' }, apps: { ok: true }, app_name: { ok: true },
    app_warehouse: { ok: false }, genie_spaces: { ok: false }, alerts: { ok: true } };
  assert.deepEqual(w.checksFor(checks, { app: false, genie_space: true, alert: false }).map(([k]) => k), ['output', 'genie_spaces']);
  assert.deepEqual(w.checksFor(checks, { app: true, genie_space: true, alert: true }).map(([k]) => k), Object.keys(checks), 'a chosen output keeps all its checks (must-exclude)');
  assert.deepEqual(w.checksFor(null, {}), []);
});

test('Genie Agents turned off also blocks a new App, so Deliver unticks both and Next is never refused, and the reason never asks for a grant (must-exclude)', async () => {
  const w = await lib('implementWizard.js');
  const blocks = w.outputBlocks({ apps: true, genie_spaces: false, alerts: true }, null);
  assert.deepEqual(Object.keys(blocks), ['app', 'genie_space']);
  assert.equal(blocks.app.why, w.APP_NEEDS_GENIE);
  const spec = { outputs: { dashboard: false, genie_space: true, app: true, alert: false, merge: {} }, removed_outputs: {} };
  const kept = w.withoutUnavailableOutputs(spec, Object.keys(blocks), {});
  assert.deepEqual([kept.outputs.app, kept.outputs.genie_space], [false, false]);
  assert.equal(w.outputBlocks({ apps: true, genie_spaces: false, alerts: true }, null, { app: 'ops-desk' }).app, undefined, 'an App this use case already has keeps its own Genie Agent');
  const problems = w.blockedOutputProblems(spec, blocks);
  assert.ok(problems.length > 0);
  for (const p of problems) {
    assert.match(p, /ask a workspace admin to turn it on/);
    assert.doesNotMatch(p, /run the grant/);
  }
  assert.match(w.blockedOutputProblems({ outputs: { app: true } }, { app: { why: 'Needs access.', details: 'GRANT X' } })[0], /run the grant under Details/);
  assert.equal(w.vibesSkippedText({ outputs: { dashboard: true, genie_space: false, app: false, alert: false } }, blocks), 'Not picked in What to deliver, so not built: the Alert.');
});

test('the Run it cost line does not repeat the schedule the sentence before it names', async () => {
  const w = await lib('implementWizard.js');
  const spec = { outputs: {}, schedule: { enabled: true, cron: '0 0 6 * * ?', timezone: 'Europe/London' } };
  const said = w.costHint(spec, { scheduleSaid: true });
  assert.match(said, /^one preview run now, then about \d+(\.\d)? full serverless runs a month\.$/);
  assert.ok(w.costHint(spec).length > said.length + 5, 'without the flag the line still names the schedule');
  assert.ok(w.costHint(spec).includes(w.cronInWords(spec.schedule.cron, spec.schedule.timezone)));
});

test('a use case with no business domain never creates or names a domain App: a new App goes to the App for all use cases, and the domain choice says why it is off', async () => {
  const w = await lib('implementWizard.js');
  const R = await lib('recommended.js');
  const none = { business: 'Acme', domain: '' };
  const spec = w.defaultSpecFromUseCase({ ...UC, business_domain: '' }, { businessName: 'Acme' });
  assert.equal(w.newAppPlacementBlock(spec, null, none, 'domain'), w.NO_DOMAIN_APP);
  const made = w.withNewApp(spec, 'domain', null, none);
  assert.deepEqual([made.outputs.app_placement, made.outputs.app_name], ['business', w.hubAppName('Acme')], 'picking the domain choice never sticks (must-exclude)');
  assert.equal(w.withAppPlacement(spec, 'domain', { app: [] }, none).outputs.app_placement, 'business');
  assert.equal(R.bestAppPolicy(spec, null, none).id, 'business', 'the badge sits on the choice the wizard picks');
  assert.equal(w.withNewApp(spec, 'domain', null, { business: '', domain: '' }).outputs.app_placement, 'use_case', 'no business and no domain: an App of its own');
  const scope = { business: 'Acme', domain: 'Customer' };
  const withDomain = w.defaultSpecFromUseCase({ ...UC, business_domain: 'Customer' }, { businessName: 'Acme' });
  assert.equal(w.newAppPlacementBlock(withDomain, null, scope, 'domain'), '');
  assert.deepEqual([w.withNewApp(withDomain, 'domain', null, scope).outputs.app_placement, w.withNewApp(withDomain, 'domain', null, scope).outputs.app_name],
    ['domain', w.domainAppName('Acme', 'Customer')]);
  assert.equal(R.bestAppPolicy(withDomain, null, scope).id, 'domain');
});
