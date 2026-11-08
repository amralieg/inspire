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

test('a held version says what stays live, and its checklist shows every entry with the words, part, place, met or not, evidence, rounds and what was tried, as does each version in History', async () => {
  const ui = await openBuild();
  const { page } = ui;
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    const held = heldBox(page);
    await held.getByText('v5 is held', { exact: true }).waitFor();
    assert.equal(await held.locator('[data-held-text]').count(), 0, 'the reason the agent wrote is said once, not again in the App words');
    assert.equal(await held.locator('[data-held-reason]').textContent(), 'Two asks were not met after 3 rounds.');
    assert.equal(await held.locator('[data-held-parts]').textContent(), 'Held: the Genie Agent and the Decisions page.');
    assert.equal(await page.getByRole('region', { name: 'Build failed' }).count(), 0, 'a held version is never shown as failed');
    const summary = page.getByRole('region', { name: 'Build summary', exact: true });
    await summary.getByText('1 not published, because a vibe was not met. Open one to rephrase, try again or publish anyway.', { exact: true }).waitFor();
    assert.equal(await summary.getByText('Every MVP of this session has finished building.').count(), 0, 'the summary never says a held MVP finished');

    const panel = checklistOf(page, 5);
    assert.equal(await panel.locator('[data-checklist-headline]').textContent(), '2 of 4 vibe requirements met');
    assert.match(await panel.locator('[data-checklist-headline]').getAttribute('class'), /text-error-fg/);
    const rows = rowsOf(panel);
    assert.deepEqual(await rows.evaluateAll((li) => li.map((x) => x.dataset.requirement)), ['met', 'not_met', 'met', 'not_met'], 'every entry renders, in order');
    assert.deepEqual(await rows.allTextContents(), [
      '✓Met: “Put the riskiest customers first”Decisions page, recordsMet after 1 round. The decision list sorts by risk.✓ sorted by risk: passed',
      '×Not met: “Answer in euros”Genie Agent, sample answersNot met after 3 rounds. The answers are in dollars.Round 1: Asked Genie to answer in eurosRound 2: Added a currency instruction'
        + 'Round 3: Converted the sample answers× currency is EUR: failed',
      '✓Met: “Count returns by week”Notebook, result tableMet after 2 rounds. The result has a week column.',
      '×Not met: “Add a map by region”Not met after 3 rounds. It names the Alert, which this MVP does not build; tick the Alert in Delivery.'
        + 'Round 1: Looked for a part to send it toRound 2: Asked the router againRound 3: Checked the outputs ticked',
    ]);
    assert.equal(await rows.nth(0).getByRole('list', { name: 'What Genie tried' }).count(), 0, 'a met entry lists nothing tried');
    assert.equal(await rows.nth(1).getByRole('list', { name: 'What Genie tried' }).getByRole('listitem').count(), 3);

    const sizes = await page.evaluate(() => {
      const pane = document.querySelector('[data-progress-panel] [role="dialog"]').getBoundingClientRect();
      const boxes = ['[aria-label="v5 is held"]', '[aria-label="Vibe checklist of v5"]'].map((sel) => {
        const el = document.querySelector(sel);
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, wide: el.scrollWidth <= el.clientWidth + 1 };
      });
      return { page: document.scrollingElement.scrollWidth, pane: { left: pane.left, right: pane.right }, boxes };
    });
    assert.ok(sizes.page <= 1440, `the page does not scroll sideways (${sizes.page})`);
    for (const box of sizes.boxes) assert.ok(box.wide && box.left >= sizes.pane.left && box.right <= sizes.pane.right + 1, JSON.stringify(sizes));
    for (const dark of [false, true]) {
      await setDark(page, dark);
      const result = await lowContrast(page, ['[aria-label="v5 is held"]', '[aria-label="Vibe checklist of v5"]']);
      assert.ok(result.checked >= 20, `measured ${result.checked} elements`);
      assert.deepEqual(result.low, [], dark ? 'dark' : 'light');
    }
    await page.evaluate(() => document.documentElement.classList.remove('dark'));

    const history = (await openAsset(page, 'job')).getByRole('region', { name: 'History', exact: true });
    await history.getByRole('button', { expanded: false }).click();
    const inHistory = (version) => history.locator(`[data-history-version="${version}"]`);
    assert.equal(await rowsOf(checklistOf(inHistory(5), 5)).count(), 4, 'v5 in History shows all four entries');
    assert.equal(await checklistOf(inHistory(4), 4).locator('[data-checklist-headline]').textContent(), '1 of 1 vibe requirement met');
    assert.deepEqual(await rowsOf(checklistOf(inHistory(4), 4)).allTextContents(), ['✓Met: “Weekly bars”DashboardMet after 1 round. The trend is weekly.']);
    assert.equal(await inHistory(3).locator('[data-vibe-checklist]').count(), 0, 'a version with no checklist shows none');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

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

test('Rephrase puts exactly the asks that were not met in the one vibe box, and adding new words takes the old ones out of the Genie Agent and the vibe, so Open all settings builds them without the old words', async () => {
  const ui = await openBuild();
  const { page, made } = ui;
  try {
    await heldBox(page).getByRole('button', { name: 'Rephrase', exact: true }).click();
    assert.equal(await mvpBox(page).inputValue(), 'Answer in euros\nAdd a map by region', 'the two met asks are not in the box');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Vibes for the MVP', 'the box has the focus');
    await page.locator('[data-rephrasing]').getByText('Add vibe takes out the 2 asks that were not met and keeps your new words instead.', { exact: true }).waitFor();
    await mvpBox(page).fill('Answer in euros, rounded to cents\nShow the regions as a bar chart on the dashboard');
    await page.locator('[data-vibe-box="mvp"]').getByRole('button', { name: 'Add vibe', exact: true }).click();
    assert.deepEqual(await waiting(page), [
      ['ask', '“Answer in euros, rounded to cents\nShow the regions as a bar chart on the dashboard”'],
      ['remove', 'Take out of the Genie Agent: “Answer in euros”'],
      ['remove', 'Take out of the vibe of v5: “Add a map by region”'],
    ]);
    assert.equal(await page.locator('[data-rephrasing]').count(), 0, 'the rephrase is done once added');
    assert.deepEqual([made.jobs.length, insertsOf(made).length], [0, 0], 'nothing is built until Open all settings and Start MVP');

    const wizard = await openSettings(page);
    assert.equal(await wizard.getByRole('textbox', { name: 'Vibes for the MVP', exact: true }).inputValue(),
      'Put the riskiest customers first\nCount returns by week\nAnswer in euros, rounded to cents\nShow the regions as a bar chart on the dashboard', 'the old words of the asks not met are gone');
    await wizard.getByRole('group', { name: 'What happens to v4?' }).getByRole('radio', { name: /^Keep v4 live/ }).check();
    await toSummary(page);
    await page.getByRole('button', { name: 'All Good, Build it Now', exact: true }).click();
    await until(() => made.jobs.length === 1, 'the rephrased build');
    const [built] = insertsOf(made);
    assert.equal(built.spec.vibes, 'Put the riskiest customers first\nCount returns by week\nAnswer in euros, rounded to cents\nShow the regions as a bar chart on the dashboard');
    assert.equal(built.spec.outputs.genie_space_vibes, '', 'the Genie Agent no longer holds the old words');
    assert.equal(built.spec.outputs[`${PAGE}_vibes`], 'Put the riskiest customers first', 'a met ask stays where it was');
    assert.equal('publish_held' in built.spec, false);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Try again resubmits the same asks as a new version based on the held one', async () => {
  const ui = await openBuild();
  const { page, made } = ui;
  try {
    await heldBox(page).locator('[data-held-reason]').waitFor();
    assert.equal(await heldBox(page).locator('[data-held-next]').count(), 0, 'the agent reason names the actions once');
    await heldBox(page).getByRole('button', { name: 'Try again', exact: true }).click();
    await until(() => made.jobs.length === 1, 'the try again');
    const [again] = insertsOf(made);
    assert.deepEqual([again.spec.vibes, again.spec.vibe_previous, again.spec.based_on_version ?? null, 'publish_held' in again.spec],
      [HELD_VIBES, 'keep', JSON.parse(HELD.spec_json).based_on_version ?? null, false], 'the held spec as stored');
    assert.deepEqual([again.spec.outputs.genie_space_vibes, again.spec.retry_outputs], ['Answer in euros', [PAGE]], 'the routed asks and the parts they rebuild come along');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Publish anyway is for an owner: it names each ask not met and what goes live, Cancel sends nothing, and it calls the publish route; a person who does not own the MVP never sees it', async () => {
  const other = await openBuild({ ...STATE, me: { userName: OTHER, displayName: 'Someone' } });
  try {
    const held = heldBox(other.page);
    await held.getByRole('button', { name: 'Try again', exact: true }).waitFor();
    await held.getByRole('button', { name: 'Rephrase', exact: true }).waitFor();
    assert.equal(await other.page.getByRole('button', { name: 'Publish anyway' }).count(), 0, 'a person who does not own the MVP sees no Publish anyway');
    assert.deepEqual(other.pageErrors, []);
  } finally {
    await other.close();
  }

  const ui = await openBuild();
  const { page, made } = ui;
  const sent = [];
  page.on('request', (req) => { if (req.url().includes('/api/inspire/implement/publish')) sent.push(JSON.parse(req.postData() || '{}').spec?.publish_held); });
  try {
    const held = heldBox(page);
    await held.getByRole('button', { name: 'Publish anyway', exact: true }).click();
    const confirm = held.getByRole('group', { name: 'Confirm publishing v5 anyway' });
    await confirm.getByText('Publish v5 anyway? These 2 asks are not met:', { exact: true }).waitFor();
    assert.deepEqual(await confirm.getByRole('list', { name: 'Asks not met' }).getByRole('listitem').allTextContents(), ['“Answer in euros”', '“Add a map by region”']);
    assert.equal(await confirm.locator('[data-publish-held-text]').textContent(),
      'Inspire puts the Genie Agent and Decisions page of v5 live in place of v4, with no Genie round, and marks each ask above as published anyway by you.');
    await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
    await confirm.waitFor({ state: 'detached' });
    assert.deepEqual([sent.length, made.jobs.length], [0, 0], 'Cancel sends nothing');
    await held.getByRole('button', { name: 'Publish anyway', exact: true }).click();
    await confirm.getByRole('button', { name: 'Publish anyway', exact: true }).click();
    await until(() => made.jobs.length === 1, 'the publish anyway run');
    assert.deepEqual(sent, [5]);
    const [published] = insertsOf(made);
    assert.equal(published.spec.publish_held, 5);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('after Publish anyway each ask not met says who published it anyway and when', async () => {
  const at = '2026-10-31T05:00:00Z';
  const anyway = { by: OWNER, at };
  const published = versionRow(6, { status: 'ready_with_warnings', change_classes: 'publish', top: { publish_held: 5 }, assets: { ...ASSETS(6), checklist: CHECKLIST.map((e) => (
    e.status === 'not_met' ? { ...e, published_anyway: anyway } : e)) } });
  const ui = await openBuild({ ...STATE, history: [published, HELD, LIVE, OLDER] });
  const { page } = ui;
  try {
    const panel = checklistOf(page, 6);
    const when = await page.evaluate((value) => new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }), at);
    assert.deepEqual(await panel.locator('[data-published-anyway]').allTextContents(), [`Published anyway by ${OWNER} on ${when}.`, `Published anyway by ${OWNER} on ${when}.`]);
    assert.deepEqual(await rowsOf(panel).evaluateAll((li) => li.map((x) => x.dataset.requirement)), ['met', 'not_met', 'met', 'not_met'], 'an ask published anyway is still not met');
    assert.match(await panel.locator('[data-checklist-headline]').getAttribute('class'), /text-warning-fg/);
    assert.equal(await heldBox(page).count(), 0);
    assert.equal(await page.locator('[data-mvp-progress]').getByRole('button', { name: ACTIONS }).count(), 0, 'nothing is left to rephrase or publish');
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
