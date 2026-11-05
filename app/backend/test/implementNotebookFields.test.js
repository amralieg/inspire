const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const I = require('../lib/inspireImplement');
const { makeApp, listen } = require('./support/implementApp');
const FIXTURE = require('../../agent/tests/fixtures/implement_notebook_parity.json');
const CLEAN = require('../../agent/tests/fixtures/implement_spec_parity.json').clean;

const lib = (name) => import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', name)).href);
const OWNER = ['owner', 'example.com'].join('@');
const HOURS = { kind: 'hours', unit: 'hours', kpi: 'Analyst hours' };
const DB = { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42' };
const copy = (value) => JSON.parse(JSON.stringify(value));
const valid = (spec) => {
  const out = I.validateImplementSpec(I.withInspireUrl(spec, 'https://inspire.example.com'));
  assert.deepEqual(out.errors, [], JSON.stringify(spec).slice(0, 200));
  return out.spec;
};
const SHARED = ['classes', 'refill', 'build', 'refresh', 'rollback', 'delete', 'keep_unmanaged', 'schedule'];
const shared = (s) => Object.fromEntries(SHARED.map((k) => [k, Array.isArray(s[k]) && k !== 'classes' ? [...s[k]].sort() : s[k]]));

function row(version, { status = 'ready', notebook = { state: 'ready', spec_version: version, result_history: 1, impact: HOURS }, extra = {}, assets = {}, spec = CLEAN } = {}) {
  return {
    session_id: '42', use_case_id: 'N01-U01', spec_version: version, status, created_by: OWNER, notebook_path: '/W/impl/N01-U01', job_id: '77',
    dashboard_id: 'd1', spec_json: copy(spec),
    asset_status: { notebook, settings: [{ name: 'top_k', label: 'Top K', group: 'scope', kind: 'integer', source: 'widget', allowed: 'whole number, at least 1' }], ...assets },
    ...extra,
  };
}

test('the value at stake part is named in the KPI unit by one helper in the backend and one in the web, exactly as the agent names it', async () => {
  const T = await lib('targetKpi.js');
  const W = await lib('implementWizard.js');
  assert.ok(FIXTURE.stake.length >= 10);
  for (const c of FIXTURE.stake) {
    assert.equal(I.implementStakeWords(c.impact), c.words, JSON.stringify(c.impact));
    assert.equal(I.implementPart('value_formula', c.impact).label, c.label, JSON.stringify(c.impact));
    assert.equal(I.implementPart('ai_reasoning', c.impact).label, c.ai_reasoning);
    assert.equal(T.stakeWords(c.impact), c.words, `web ${JSON.stringify(c.impact)}`);
    assert.equal(W.partOf('value_formula', c.impact).label, c.label, `web ${JSON.stringify(c.impact)}`);
    assert.equal(W.assetLabel('value_formula', c.impact), c.label);
  }
  assert.equal(W.partLabel('value_formula', 'Money formula', T.rowImpact({ asset_status: { notebook: { impact: HOURS } } })), 'hours at stake formula');
});

test('the validator names the value formula in the impact it is given, as the agent validator does, and keeps AI reasoning as it is', () => {
  assert.ok(FIXTURE.validator.length >= 9);
  for (const c of FIXTURE.validator) assert.deepEqual(I.validateImplementSpec(I.withInspireUrl(c.spec, 'https://inspire.example.com'), { impact: c.impact }).errors, c.errors, `${c.name} ${JSON.stringify(c.impact)}`);
});

test('a changed vibe for the value formula names it in the impact the built notebook records', () => {
  assert.ok(FIXTURE.part_problems.length >= 6);
  for (const c of FIXTURE.part_problems) {
    const history = [row(1, { assets: c.asset_status, notebook: c.asset_status.notebook, spec: c.previous })];
    const why = `${c.name} ${JSON.stringify(c.asset_status.notebook.impact)}`;
    if (c.problems.length) assert.throws(() => I.planSubmission(history, valid(c.spec)), { message: c.problems.join('; ') }, why);
    else assert.deepEqual(I.planSubmission(history, valid(c.spec)).spec.retry_outputs, c.retry, why);
  }
});

test('the plan refills the notebook as the agent plans it: retrying only the AI reasoning previews, and a notebook that cannot be reused refills', () => {
  assert.ok(FIXTURE.plans.length >= 6);
  for (const c of FIXTURE.plans) {
    const summary = I.implementChangeSummary(valid(c.previous), valid(c.current), c.assets, null, c.has_built_notebook);
    assert.deepEqual(shared(summary), c.summary, c.name);
  }
});

test('the plan asks the agent records whether the notebook can be reused: its path, the version that wrote it and the result history it keeps', () => {
  const widened = { ...copy(CLEAN), based_on_version: 2, config: { ...copy(CLEAN.config), widgets: { top_k: '12' } } };
  const plan = (history) => I.planSubmission(history, valid(widened), null, { requester: OWNER }).summary;
  const older = row(2, { notebook: { state: 'ready', spec_version: 2, impact: HOURS } });
  assert.deepEqual([plan([row(2), row(1)]).classes, plan([row(2), row(1)]).refill], [['settings'], false], 'a reusable notebook saves the setting');
  assert.deepEqual([plan([older]).classes, plan([older]).refill], [['config'], true], 'a notebook without result history is rebuilt, as the agent upgrades it');
  assert.equal(I.implementHasBuiltNotebook([row(2), row(1)]), true);
  assert.equal(I.implementHasBuiltNotebook([older]), false);
  const later = row(2, { notebook: { state: 'ready', spec_version: 3, result_history: 1, impact: HOURS } });
  assert.equal(I.implementHasBuiltNotebook([later]), false, 'a notebook written by a version after the one built is not reused');
  const pathless = row(2, { extra: { notebook_path: '' } });
  assert.equal(I.implementHasBuiltNotebook([pathless]), false, 'no notebook path, nothing to reuse');
  const deleted = row(2, { notebook: { state: 'deleted', spec_version: 2, result_history: 1 } });
  assert.equal(I.implementHasBuiltNotebook([deleted]), false, 'a deleted notebook is never carried');
  const held = row(3, { status: 'vibe_not_met', notebook: { state: 'ready', spec_version: 3, impact: HOURS } });
  assert.equal(I.implementHasBuiltNotebook([held, row(2)]), true, 'a held version is not carried, so the live notebook still counts');
  assert.equal(I.implementHasBuiltNotebook([row(3, { status: 'uninstalled' }), row(2)]), false, 'after Uninstall All nothing is reused');
  assert.equal(I.implementHasBuiltNotebook([row(1, { status: 'failed' })]), false, 'no built version, nothing to reuse');
  assert.equal(I.implementHasBuiltNotebook([row(2, { notebook: { state: 'ready', spec_version: '2', result_history: 1 } })]), true, 'a version written as text still counts');
  assert.equal(I.implementHasBuiltNotebook([row(2, { notebook: { state: 'ready', spec_version: '2.5', result_history: 1 } })]), false);
});

test('a held version never carries its outputs or its notebook into the next plan, as the agent carries only the versions it kept', () => {
  const held = row(3, { status: 'vibe_not_met', extra: { dashboard_id: 'candidate' }, notebook: { state: 'ready', spec_version: 3, impact: { kind: 'money', unit: 'USD' } } });
  assert.deepEqual(I.carriedAssets([held, row(2)]), { dashboard: 'd1' });
  assert.deepEqual(I.implementNotebookImpact(I.implementCarried([held, row(2)]).status), HOURS);
  assert.equal(I.implementNotebookImpact({}), null);
  assert.equal(I.implementNotebookImpact({ notebook: { state: 'ready' } }), null);
});

test('Vibe/Add/Remove Features validates with the impact the built notebook records, so a too long value formula vibe names its own unit', async () => {
  const history = [{ ...row(1), spec_json: JSON.stringify(row(1).spec_json), asset_status: JSON.stringify(row(1).asset_status) }];
  const made = makeApp({ history });
  const srv = await listen(made.app);
  try {
    const spec = { ...copy(CLEAN), outputs: { ...copy(CLEAN.outputs), value_formula_vibes: 'v'.repeat(2001) } };
    const resp = await fetch(`${srv.url}/api/inspire/implement/plan`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-email': OWNER },
      body: JSON.stringify({ ...DB, spec }) });
    const data = await resp.json();
    assert.equal(resp.status, 400, JSON.stringify(data));
    assert.match(data.error, /the hours at stake formula vibes are 2001 characters; at most 2000 are allowed/);
  } finally {
    await srv.close();
  }
});

test('a vibe route to the value formula is read in any unit the agent names it, and in the money wording of older runs', async () => {
  const P = await lib('mvpProgress.js');
  for (const heading of ['Hours at stake formula', 'Money at stake formula', 'Late shipments at stake formula', 'Amount at stake formula']) {
    assert.deepEqual(P.vibeLine(`sent to ${heading}: Count only open cases`), { id: 'value_formula', words: 'Count only open cases', note: '' }, heading);
  }
  assert.equal(P.vibeLine('sent to Hours at stake: Count'), null, 'a heading that is not a part is not read as one');
});

test('the settings note is validated as the agent validates it: trimmed, empty when not given, refused and cleared past 300 characters or when it is not text, and never a change by itself', async () => {
  const base = valid(copy(CLEAN));
  const noted = I.validateImplementSpec({ ...copy(CLEAN), config: { ...copy(CLEAN.config), settings_note: '  more to act on  ' } });
  assert.deepEqual([noted.errors, noted.spec.config.settings_note], [[], 'more to act on']);
  for (const empty of ['', '   ', null, undefined]) {
    assert.equal(I.validateImplementSpec({ ...copy(CLEAN), config: { ...copy(CLEAN.config), settings_note: empty } }).spec.config.settings_note, '');
  }
  const long = I.validateImplementSpec({ ...copy(CLEAN), config: { ...copy(CLEAN.config), settings_note: 'n'.repeat(301) } });
  assert.deepEqual([long.errors, long.spec.config.settings_note], [['config.settings_note must be at most 300 characters, not 301'], ''], 'a note too long is refused and cleared');
  assert.equal(I.validateImplementSpec({ ...copy(CLEAN), config: { ...copy(CLEAN.config), settings_note: '\u{1F600}'.repeat(300) } }).errors.length, 0, 'the limit counts characters');
  assert.deepEqual(I.validateImplementSpec({ ...copy(CLEAN), config: { ...copy(CLEAN.config), settings_note: 5 } }).errors, ['config.settings_note must be text, not 5']);
  assert.equal(I.IMPLEMENT_SETTINGS_NOTE_MAX, 300);
  assert.deepEqual(I.classifyImplementChange(base, noted.spec), [], 'a note alone changes nothing');
  const setting = valid({ ...copy(CLEAN), config: { ...copy(CLEAN.config), widgets: { top_k: '12' }, settings_note: 'more to act on' } });
  assert.deepEqual(I.classifyImplementChange(base, setting, ['top_k']), ['settings']);
  const S = await lib('useCaseSettings.js');
  const W = await lib('implementWizard.js');
  const withNote = S.withSettingsNote(base, 'why');
  assert.equal(S.settingsNoteOf(withNote), 'why');
  assert.equal(S.settingsNoteOf(S.withSettingsNote(withNote, '  ')), '');
  assert.deepEqual(S.withSettingsNote({ use_case_id: 'x' }, ''), { use_case_id: 'x' }, 'a spec with no config stays as it is');
  assert.equal(S.settingsNoteProblem(S.withSettingsNote(base, 'n'.repeat(301))), 'config.settings_note must be at most 300 characters, not 301');
  assert.deepEqual(S.settingsProblems(S.withSettingsNote(base, 'n'.repeat(301)), []), ['config.settings_note must be at most 300 characters, not 301']);
  assert.equal(S.settingsNoteProblem(S.withSettingsNote(base, '\u{1F600}'.repeat(300))), '', 'the wizard counts characters as the agent does');
  const latest = { spec_version: 2, status: 'ready', spec_json: { ...setting } };
  const fallback = W.defaultSpecFromUseCase({ No: 'N01-U01', Name: 'Basket' }, {});
  assert.equal(W.specFromLatest(latest, fallback).config.settings_note, '', 'Vibe/Add/Remove Features starts each change without the note of the version before');
  assert.equal(W.nextSpecFrom(latest, { retry_outputs: ['dashboard'] }).config.settings_note, '', 'the Build page never sends an old note again');
  const held = { spec_version: 3, status: 'vibe_not_met', spec_json: { ...setting } };
  assert.equal(W.specFromHeld(held, { publish: true }).config.settings_note, 'more to act on', 'Publish anyway sends the held version exactly as it was held');
});

test('the App owners limit names what is at stake in the impact the notebook records, as the agent writes it', () => {
  assert.ok(FIXTURE.owners.length >= 6);
  assert.ok(new Set(FIXTURE.owners.map((c) => c.errors[0])).size >= 4, 'the cases cover more than one unit');
  for (const c of FIXTURE.owners) assert.deepEqual(I.validateImplementSpec(I.withInspireUrl(c.spec, 'https://inspire.example.com'), { impact: c.impact }).errors, c.errors, JSON.stringify(c.impact));
});
