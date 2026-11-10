import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { defaultSpecFromUseCase } from '../../src/lib/implementWizard.js';
import { HARNESS_INSPIRE_URL, HARNESS_USE_CASE, HARNESS_SETTINGS, HARNESS_SESSION_ID } from './implementFixtures.js';
import { closeBrowser, expandBuild, lowContrast, onStep, openAsset, openSettings, openUi, setDark, toSummary, until } from './uiSupport.mjs';

const OWNER = ['owner', 'example.com'].join('@');
const OTHER = ['someone', 'example.com'].join('@');
const PAGE = 'app:page:decisions';
const HELD_VIBES = 'Put the riskiest customers first\nAnswer in euros\nCount returns by week\nAdd a map by region';

test.after(closeBrowser);

const builtSpec = (outputs = {}, top = {}) => {
  const spec = defaultSpecFromUseCase(HARNESS_USE_CASE, { warehouseId: HARNESS_SETTINGS.warehouseId, inspireDatabase: HARNESS_SETTINGS.inspireDatabase, sessionId: HARNESS_SESSION_ID, owner: OWNER });
  return { ...spec, ...top, outputs: { ...spec.outputs, genie_space: true, app: true, app_name: 'churn-desk', app_access: 'sp', alert: false,
    inspire_url: HARNESS_INSPIRE_URL, ...outputs } };
};

const ready = (version, extra = {}) => ({ state: 'ready', spec_version: version, ...extra });
const ASSETS = (version) => ({ notebook: { spec_version: 2, modified_at: 1 }, dashboard: ready(version, { snapshot: true }), genie_space: ready(version, { snapshot: true }),
  app: ready(version, { snapshot: true }), [PAGE]: ready(version, { name: 'Decisions', what: 'The rows to act on' }) });

const versionRow = (version, { outputs = {}, assets = {}, top = {}, ...extra } = {}) => ({
  session_id: '42', use_case_id: 'N01-U01', spec_version: version, status: 'ready', change_classes: version === 1 ? 'initial' : 'outputs', created_by: OWNER,
  updated_at: `2026-10-2${version}T04:00:00Z`, spec_json: JSON.stringify(builtSpec(outputs, top)), job_id: '77', last_preview_run_id: '9001', result_rows: '3',
  dashboard_id: 'd1', dashboard_url: 'https://workspace.example.com/dashboardsv3/d1/published',
  genie_space_id: 'g1', genie_space_url: 'https://workspace.example.com/genie/rooms/g1',
  app_name: 'churn-desk', app_url: 'https://churn-desk-1.aws.example.com',
  asset_status: JSON.stringify(assets),
  ...extra,
});

const CHECKLIST = [
  { n: 1, requirement: 'Put the riskiest customers first', part: PAGE, where: 'records', status: 'met', evidence: 'The decision list sorts by risk', rounds: 1,
    tried: [], checks: [{ name: 'sorted by risk', passed: true }], published_anyway: null },
  { n: 2, requirement: 'Answer in euros', part: 'genie_space', where: 'sample answers', status: 'not_met', evidence: 'The answers are in dollars', rounds: 3,
    tried: ['round 1: Asked Genie to answer in euros', 'round 2: Added a currency instruction', 'round 3: Converted the sample answers'], checks: [{ name: 'currency is EUR', passed: false }],
    published_anyway: null },
  { n: 3, requirement: 'Count returns by week', part: 'notebook', where: 'result table', status: 'met', evidence: 'The result has a week column', rounds: 2,
    tried: [], checks: [], published_anyway: null },
  { n: 4, requirement: 'Add a map by region', part: '', where: '', status: 'not_met', evidence: 'It names the Alert, which this MVP does not build; tick the Alert in Delivery',
    rounds: 3, tried: ['round 1: Looked for a part to send it to', 'round 2: Asked the router again', 'round 3: Checked the outputs ticked'], checks: [], published_anyway: null },
];

const HELD = versionRow(5, {
  status: 'vibe_not_met', change_classes: 'vibe', updated_at: '2026-10-30T04:00:00Z',
  outputs: { genie_space_vibes: 'Answer in euros', [`${PAGE}_vibes`]: 'Put the riskiest customers first' },
  top: { vibes: HELD_VIBES, vibe_previous: 'keep', retry_outputs: [PAGE], data: { ...builtSpec().data, notes: 'Count returns by week' } },
  assets: { ...ASSETS(4), checklist: CHECKLIST, checklist_summary: { met: 2, total: 4 }, held: { parts: ['genie_space', PAGE], reason: 'Two asks were not met after 3 rounds' } },
});
const LIVE = versionRow(4, { outputs: { dashboard_vibes: 'Weekly bars' }, assets: { ...ASSETS(4), checklist: [
  { n: 1, requirement: 'Weekly bars', part: 'dashboard', where: '', status: 'met', evidence: 'The trend is weekly', rounds: 1, tried: [], checks: [], published_anyway: null }] } });
const OLDER = versionRow(3, { assets: ASSETS(3) });

const APP = { name: 'churn-desk', description: 'Inspire use case N01-U01 (session 42): Predict churn', compute_status: { state: 'ACTIVE' }, app_status: { state: 'RUNNING' } };
const STATE = { history: [HELD, LIVE, OLDER], appExists: true, app: APP, me: { userName: OWNER, displayName: 'Owner' } };

const insertsOf = (made) => made.sqlCalls.filter((c) => String(c.sql).includes('INSERT INTO') && (c.parameters || []).some((p) => p.name === 'spec'))
  .map((c) => ({ spec: JSON.parse(c.parameters.find((p) => p.name === 'spec').value), classes: c.parameters.find((p) => p.name === 'classes').value }));
const checklistOf = (page, version) => page.getByRole('region', { name: `Vibe checklist of v${version}`, exact: true });
const rowsOf = (scope) => scope.locator('[data-requirement]');
const heldBox = (page, version = 5) => page.getByRole('region', { name: `v${version} is held`, exact: true });
const mvpBox = (page) => page.locator('[data-vibe-box="mvp"]').getByRole('textbox', { name: 'Vibes for the MVP', exact: true });
const waiting = (page) => page.locator('[data-vibe-features-dialog] [data-waiting]').evaluateAll((items) => items.map((li) => [li.dataset.waiting, li.querySelector('span').textContent]));
const ACTIONS = /^(Rephrase|Try again|Publish anyway)$/;

async function openBuild(state = STATE) {
  const ui = await openUi('implement', state);
  try {
    await ui.page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    await expandBuild(ui.page);
  } catch (e) {
    await ui.close();
    throw e;
  }
  return ui;
}

test('a version whose every vibe requirement is met shows its checklist with no Rephrase, Try again or Publish anyway', async () => {
  const met = versionRow(6, { status: 'ready', change_classes: 'vibe', top: { vibes: 'Put the riskiest customers first' }, assets: { ...ASSETS(6), checklist: [CHECKLIST[0], CHECKLIST[2]] } });
  const ui = await openBuild({ ...STATE, history: [met, LIVE, OLDER] });
  const { page } = ui;
  try {
    const panel = checklistOf(page, 6);
    assert.equal(await panel.locator('[data-checklist-headline]').textContent(), '2 of 2 vibe requirements met');
    assert.match(await panel.locator('[data-checklist-headline]').getAttribute('class'), /text-success-fg/);
    assert.equal(await heldBox(page).count(), 0, 'nothing is held');
    assert.equal(await page.locator('[data-mvp-progress]').getByRole('button', { name: ACTIONS }).count(), 0, 'a met checklist offers no action');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the live Vibe checklist step fills the panel while the version builds, before its record lands, and a step of another version never does', async () => {
  const agoIso = (seconds) => new Date(Date.now() - seconds * 1000).toISOString();
  const stepRow = (version, status, seconds, checklist) => ({
    step_id: String(2000 + seconds), session_id: '42', stage_name: 'Implement Use Cases', step_name: 'Inspire is working on vibe checklist',
    sub_step_name: 'In progress: n01-u01', status, message: checklist ? `${checklist.filter((e) => e.status === 'met').length} of ${checklist.length} vibe requirements met` : '',
    last_updated: agoIso(seconds), result_json: JSON.stringify({ use_case_id: 'N01-U01', phase: 'Vibe checklist', spec_version: version, event_at: agoIso(seconds),
      ...(checklist ? { checklist, met: checklist.filter((e) => e.status === 'met').length, total: checklist.length } : {}) }),
  });
  const building = versionRow(5, { status: 'building_outputs', implement_run_id: '5555555555555555', updated_at: new Date().toISOString(), change_classes: 'vibe',
    top: { vibes: HELD_VIBES, vibe_previous: 'keep' }, assets: ASSETS(4) });
  const state = { ...STATE, history: [building, LIVE, OLDER], implementRun: { run_id: 5555555555555555, state: { life_cycle_state: 'RUNNING' } },
    steps: [stepRow(5, 'started', 30, CHECKLIST.slice(0, 2)), stepRow(4, 'ended_success', 5, [CHECKLIST[2]])] };
  const ui = await openBuild(state);
  const { page } = ui;
  try {
    const panel = checklistOf(page, 5);
    await panel.waitFor();
    assert.equal(await panel.getAttribute('data-checklist-live'), '');
    assert.equal(await panel.locator('[data-checklist-headline]').textContent(), '1 of 2 vibe requirements met');
    await panel.getByText('Inspire is checking each requirement on this build; the list fills as it checks.', { exact: true }).waitFor();
    assert.deepEqual(await rowsOf(panel).evaluateAll((li) => li.map((x) => x.querySelector('p').textContent)),
      ['Met: “Put the riskiest customers first”', 'Not met: “Answer in euros”'], 'the step of v4 is not in the checklist of v5');
    assert.equal(await heldBox(page).count(), 0, 'nothing is held while it builds');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a settings change the agent refused shows as a refused settings change with its reason: its own step, its own headline, and no vibe ask to rephrase, try again or publish anyway', async () => {
  const refused = createRequire(import.meta.url)('../../../backend/test/fixtures/implement_settings_refused.json');
  const [row] = refused.rows;
  const at = (second) => `2026-10-31T10:00:0${second}.000Z`;
  const step = (phase, status, second, payload, message) => ({
    step_id: String(3000 + second), session_id: '42', stage_name: 'Implement Use Cases', step_name: `Inspire is working on ${phase.toLowerCase()}`,
    sub_step_name: 'Completed: n01-u01', status, message, last_updated: at(second),
    result_json: JSON.stringify({ use_case_id: 'N01-U01', phase, spec_version: 3, event_at: at(second), ...payload }),
  });
  const version = versionRow(3, { status: 'failed', status_message: row.refusal, change_classes: 'settings', updated_at: '2026-10-31T10:00:03Z',
    assets: { ...ASSETS(2), checklist: row.entries, checklist_summary: row.summary } });
  const state = { ...STATE, history: [version, versionRow(2, { assets: ASSETS(2) })],
    steps: [step(refused.step, 'ended_error', 2, { checklist: row.entries, ...row.summary }, row.step_message), step('Implement', 'ended_error', 3, {}, row.refusal)] };
  const ui = await openBuild(state);
  const { page } = ui;
  try {
    const panel = page.locator('[data-mvp-progress]');
    const banner = panel.getByRole('region', { name: 'Build failed', exact: true });
    await banner.waitFor({ timeout: 15000 });
    await banner.getByText('Settings change', { exact: true }).waitFor();
    await banner.getByText(row.refusal, { exact: true }).waitFor();
    const list = panel.getByRole('region', { name: 'Settings changes of v3', exact: true }).first();
    await list.waitFor();
    assert.equal(await list.locator('[data-checklist-headline]').textContent(), row.step_message, 'the agent step message, byte for byte');
    assert.deepEqual(await list.locator('[data-requirement]').evaluateAll((items) => items.map((li) => li.dataset.requirement)), ['refused', 'refused']);
    assert.deepEqual(await list.locator('[data-requirement-status]').allTextContents(), row.entries.map(() => 'Settings change refused.'), 'the refusal is said once, above');
    assert.equal(await panel.getByRole('region', { name: 'Vibe checklist of v3', exact: true }).count(), 0, 'never a vibe checklist');
    assert.equal(await panel.getByText(/vibe requirements? met/).count(), 0, 'never 0 of 2 vibe requirements met');
    assert.equal(await panel.getByRole('button', { name: /^(Rephrase|Publish anyway)$/ }).count(), 0, 'no Rephrase or Publish anyway');
    assert.equal(await panel.getByRole('button', { name: 'Try again', exact: true }).count(), await banner.getByRole('button', { name: 'Try again', exact: true }).count(),
      'the only Try again builds the failed version again, never a vibe ask');
    const contrast = await lowContrast(page, ['[aria-label="Settings changes of v3"]']);
    assert.deepEqual(contrast.low, []);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
