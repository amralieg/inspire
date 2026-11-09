const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const I = require('../lib/inspireImplement');

const lib = (name) => import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', name)).href);
const UC = { id: 'N05-U01', Name: 'Forecast demand', statement: 'Plan the fleet', sponsor: 'Head of Operations', business_domain: 'Demand' };
const BUSINESS = 'NYC Taxi Operations';
const SCOPE = { business: BUSINESS, domain: 'Demand', useCaseAppName: 'forecast-demand' };
const use = (id, domain, placement, business = BUSINESS) => ({ use_case_id: id, session_id: '42', name: id, business, domain, placement });
const HUB = { id: 'inspire-hub-nyc-taxi', name: 'inspire-hub-nyc-taxi', access: 'sp', placement: '',
  per_user_block: 'inspire-hub-nyc-taxi shows everyone the same rows',
  use_cases: [use('N01-U01', 'Demand', 'domain'), use('N02-U01', 'Fares', 'domain'), use('N03-U01', 'Fleet', '')] };
const SPLIT = { id: 'inspire-hub-nyc-taxi-03', name: 'inspire-hub-nyc-taxi-03', access: 'sp', placement: 'domain', use_cases: [use('N03-U02', 'Fleet', 'domain')] };

async function fresh(outputs = {}) {
  const w = await lib('implementWizard.js');
  const spec = w.defaultSpecFromUseCase(UC, { warehouseId: 'wh1', inspireDatabase: 'main.inspire', businessName: BUSINESS });
  return { w, spec: { ...spec, outputs: { ...spec.outputs, app: true, genie_space: true, ...outputs } } };
}

test('the App of all use cases of a business is the one its builder placed for the business, else the one with its name', async () => {
  const { w } = await fresh();
  assert.equal(w.businessHubOf({ app: [SPLIT, HUB] }, BUSINESS), HUB, 'the hub is found by its name when its builder recorded no placement');
  const placed = { ...SPLIT, id: 'nyc-everything', name: 'nyc-everything', placement: 'business' };
  assert.equal(w.businessHubOf({ app: [HUB, placed] }, BUSINESS), placed, 'a recorded placement wins over a name');
  const other = { ...HUB, use_cases: [use('N09-U01', 'Demand', 'business', 'NYC Taxi Analytics')] };
  assert.equal(w.businessHubOf({ app: [other] }, BUSINESS), null, 'an App of another business with the same name is not this business\'s');
  const unknown = { ...HUB, use_cases: [{ ...use('N01-U01', null, ''), domain: null }] };
  assert.equal(w.businessHubOf({ app: [unknown] }, BUSINESS), unknown, 'a holder whose domain Inspire cannot read does not hide the hub');
  assert.equal(w.appPlacementFit(unknown, { ...SCOPE, placement: 'domain' }).fit, 'not_recommended', 'one App per domain still needs the domain');
});

test('a use case already in the hub records the hub\'s placement, never the default placement', async () => {
  const { w, spec } = await fresh({ merge: { app: 'inspire-hub-nyc-taxi', dashboard: '', genie_space: '' }, app_name: 'inspire-hub-nyc-taxi' });
  const opened = w.withPlacementDefault(spec, { app: [HUB] }, { held: { app: 'inspire-hub-nyc-taxi' }, saved: '', savedApp: true, ...SCOPE });
  assert.equal(opened.outputs.app_placement, 'business');
  const stamped = { ...spec, outputs: { ...spec.outputs, app_placement: 'domain' } };
  assert.equal(w.sentSpec(stamped, null, null, { app: [HUB] }, SCOPE).outputs.app_placement, 'business', 'the spec sent says where the use case is');
  const own = { ...spec, outputs: { ...spec.outputs, merge: { app: '', dashboard: '', genie_space: '' }, app_name: 'forecast-demand' } };
  assert.equal(w.withPlacementDefault(own, { app: [] }, { held: { app: 'forecast-demand' }, saved: '', savedApp: true, ...SCOPE })
    .outputs.app_placement, 'use_case');
  assert.equal(w.withPlacementDefault(own, { app: [] }, { held: { app: 'forecast-demand' }, saved: 'domain', savedApp: true, ...SCOPE })
    .outputs.app_placement, 'domain', 'a placement the user chose for an App of its own is kept');
});

test('a new use case of a business whose use cases live in its hub joins that hub', async () => {
  const { w, spec } = await fresh();
  const hub = { ...HUB, use_cases: HUB.use_cases.map((u) => ({ ...u, placement: 'business', updated_at: '2026-10-31T10:00:00Z' })) };
  const joined = w.withPlacementDefault(spec, { app: [SPLIT, hub] }, SCOPE);
  assert.deepEqual([joined.outputs.app_placement, joined.outputs.merge.app], ['business', 'inspire-hub-nyc-taxi']);
  const picked = w.withAppPlacement(spec, 'business', { app: [SPLIT, HUB] }, SCOPE);
  assert.equal(picked.outputs.merge.app, 'inspire-hub-nyc-taxi', 'One App for all use cases joins the hub even before its holders record it');
});

test('One App for all use cases never creates a second hub for the same business', async () => {
  const { w, spec } = await fresh();
  assert.match(w.newAppPlacementBlock(spec, { app: [HUB] }, SCOPE, 'business'), /^inspire-hub-nyc-taxi is the App for all use cases of NYC Taxi Operations: add/);
  assert.equal(w.newAppPlacementBlock(spec, { app: [HUB] }, SCOPE, 'domain'), '');
  const personal = w.withAppAccess(spec, 'user');
  assert.match(w.newAppPlacementBlock(personal, { app: [HUB] }, SCOPE, 'business'), /pick One App per use case$/);
  const own = w.withAppPlacement(personal, 'business', { app: [HUB] }, SCOPE);
  assert.deepEqual([own.outputs.merge.app, own.outputs.app_placement, own.outputs.app_name], ['', 'use_case', 'forecast-demand'],
    'a per-user use case that cannot join the shared hub gets an App of its own, never inspire-hub-nyc-taxi-2');
  const other = { ...HUB, use_cases: [use('N09-U01', 'Demand', 'business', 'NYC Taxi Analytics')] };
  assert.equal(w.withAppPlacement(spec, 'business', { app: [other] }, SCOPE).outputs.app_name, 'inspire-hub-nyc-taxi-2',
    'another business that shares the shortened name gets a hub of its own');
});

test('an App of its own cannot take a name that starts like the App of all use cases of a business', async () => {
  const { w, spec } = await fresh({ merge: { app: '', dashboard: '', genie_space: '' } });
  const typed = (name, placement = 'use_case') => ({ ...spec, outputs: { ...spec.outputs, app_name: name, app_placement: placement } });
  const kept = (s, held = {}) => w.stepErrors('app', s, { held }).includes(w.HUB_NAME_KEPT);
  assert.ok(kept(typed('inspire-hub-nyc-taxi-03')));
  assert.ok(kept(typed('inspire-hub-nyc-taxi')));
  assert.ok(!kept(typed('inspire-hub-nyc-taxi-03'), { app: 'inspire-hub-nyc-taxi-03' }), 'an App the use case already has keeps its name');
  assert.ok(!kept(typed('inspire-hub-nyc-taxi-2', 'business')), 'the App of all use cases takes the hub name');
  assert.ok(!kept(typed('inspire-hub-acme-2', 'domain')), 'a use case with no domain falls back to the business-wide name');
  assert.ok(!kept(typed('fleet-desk')));
});

test('the merge target says where its builder placed it', () => {
  const holder = (uc, placement) => ({ session_id: '42', use_case_id: uc, use_case_name: uc, app_access: 'sp', app_look: null, app_placement: placement,
    updated_at: '2026-10-31T00:00:00Z' });
  const entry = { id: 'hub', holders: [holder('N01-U01', 'business'), holder('N02-U01', 'domain')] };
  const got = { ok: true, data: { name: 'hub', description: 'Inspire use case N01-U01 (session 42): Demand' } };
  assert.equal(I.mergeTarget('app', entry, got).placement, 'business');
});

test('a decision list with nobody to act on shows as a note under Done, for this version only', async () => {
  const { mvpStages, DECISION_LIST_NOTES } = await lib('mvpProgress.js');
  assert.equal(DECISION_LIST_NOTES, 'decision_list', 'the record the agent writes');
  const step = (phase, status, time) => ({ step_id: phase.length, step_name: `Inspire is working on ${phase.toLowerCase()}`, status,
    last_updated: `2026-01-02T${time}.000Z`, result_json: JSON.stringify({ use_case_id: 'N01-U01', phase }) });
  const steps = [step('Preview run', 'ended_success', '10:05:00'), step('Done', 'ended_success', '10:09:30')];
  const row = (version) => ({ status: 'ready', spec_version: 3, created_at: '2026-01-02T10:00:00.000Z', spec_json: { outputs: {} },
    asset_status: { decision_list: { notes: ['no row of the latest run reached Act now or Review (4 Monitor)'], spec_version: version } } });
  const done = mvpStages(steps, row(3)).find((s) => s.id === 'Done');
  assert.deepEqual([done.state, done.notes], ['done', ['Decision list: no row of the latest run reached Act now or Review (4 Monitor)']]);
  assert.deepEqual(mvpStages(steps, row(2)).find((s) => s.id === 'Done').notes, []);
});

test('a use case added to an App sends no App owners from the wizard, and the validator accepts the owners a spec names', async () => {
  const { w, spec } = await fresh({ merge: { app: 'inspire-hub-nyc-taxi', dashboard: '', genie_space: '' }, app_owners: ['owner@example.com'] });
  assert.deepEqual(w.sentSpec(spec, null, null, { app: [HUB] }, SCOPE).outputs.app_owners, []);
  const api = I.validateImplementSpec(spec);
  assert.ok(!api.errors.some((e) => /owner/i.test(e)), api.errors.join('; '));
  assert.deepEqual(api.spec.outputs.app_owners, ['owner@example.com']);
  assert.equal(I.IMPLEMENT_JOINED_OWNERS, undefined, 'each use case of a shared App names its own owners, as the agent does');
});
