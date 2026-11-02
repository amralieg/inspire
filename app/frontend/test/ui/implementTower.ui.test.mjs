import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { defaultSpecFromUseCase } from '../../src/lib/implementWizard.js';
import { HARNESS_INSPIRE_URL, HARNESS_USE_CASE, HARNESS_SETTINGS, HARNESS_SESSION_ID } from './implementFixtures.js';
import { closeBrowser, lowContrast, onStep, openUi, painted, setDark, until } from './uiSupport.mjs';

const OWNER = ['owner', 'example.com'].join('@');
const PAGE = 'app:page:decisions';
const CHART = 'dashboard:w1a2b3c4';
const NOT_BUILT = 'Inspire has not built the dashboard chart w1a2b3c4 on this MVP, so it cannot rebuild it with your vibes; pick one this MVP built';

test.after(closeBrowser);

const checks = (...items) => items.map(([ask, status, evidence]) => ({ ask, status, evidence }));
const ready = (version, extra = {}) => ({ state: 'ready', spec_version: version, ...extra });

const builtSpec = (outputs = {}, top = {}) => {
  const spec = defaultSpecFromUseCase(HARNESS_USE_CASE, { warehouseId: HARNESS_SETTINGS.warehouseId, inspireDatabase: HARNESS_SETTINGS.inspireDatabase, sessionId: HARNESS_SESSION_ID, owner: OWNER });
  return {
    ...spec,
    ...top,
    outputs: { ...spec.outputs, genie_space: true, app: true, app_name: 'churn-desk', app_access: 'sp', alert: true, alert_recipients: [OWNER],
      inspire_url: HARNESS_INSPIRE_URL, ...outputs },
  };
};

const versionRow = (version, { outputs = {}, assets = {}, top = {}, ...extra } = {}) => ({
  session_id: '42', use_case_id: 'N01-U01', spec_version: version, status: 'ready', change_classes: version === 1 ? 'initial' : 'outputs', created_by: OWNER,
  updated_at: `2026-10-2${version}T04:00:00Z`, spec_json: JSON.stringify(builtSpec(outputs, top)), job_id: '77', last_preview_run_id: '9001', result_rows: '3',
  dashboard_id: 'd1', dashboard_url: 'https://workspace.example.com/dashboardsv3/d1/published',
  genie_space_id: 'g1', genie_space_url: 'https://workspace.example.com/genie/rooms/g1',
  app_name: 'churn-desk', app_url: 'https://churn-desk-1.aws.example.com',
  alert_id: 'a1', alert_url: 'https://workspace.example.com/sql/alerts-v2/a1',
  asset_status: JSON.stringify(assets),
  ...extra,
});

const V3_OUTPUTS = {
  dashboard_vibes: 'Put the weekly trend first\nArabic labels',
  genie_space_vibes: 'Answer in euros, name the rows you counted and add a question about returns',
  [`${PAGE}_vibes`]: 'Dark header\nRows to act on first',
  [`${CHART}_vibes`]: 'Bars by week\nA map by region',
};

const V3_ASSETS = {
  notebook: { spec_version: 2, modified_at: 1 },
  dashboard: ready(3, { snapshot: true, vibes_checks: checks(['Put the weekly trend first', 'done', 'The first widget is the weekly trend'],
    ['Arabic labels', 'missing', 'The dashboard has no Arabic font']) }),
  [CHART]: { state: 'ready_with_warnings', spec_version: 3, name: 'Weekly trend', what: 'Bars by week, the last 8 weeks', vibes_checks: checks(
    ['Bars by week', 'done', 'Checked by running the rebuilt chart query'], ['A map by region', 'missing', 'The result table has no region column']) },
  genie_space: ready(1, { snapshot: true }),
  app: ready(3, { snapshot: true }),
  [PAGE]: ready(3, { name: 'Decisions', what: 'The rows to act on, with their filters', vibes_checks: checks(
    ['Dark header', 'done', 'Checked by opening the rebuilt page with the latest data'], ['Rows to act on first', 'done', 'The decision list opens the page']) }),
  'app:page:detail': ready(2, { title: 'Row detail' }),
  alert: ready(1),
  ai_reasoning: ready(2),
  value_formula: ready(2),
};

const HISTORY = [
  versionRow(3, { outputs: V3_OUTPUTS, assets: V3_ASSETS, status: 'ready_with_warnings' }),
  versionRow(2, {
    outputs: { dashboard_vibes: 'Make the trend weekly' },
    assets: { dashboard: ready(2, { snapshot: true, vibes_checks: checks(['Make the trend weekly', 'done', 'The trend is weekly']) }), genie_space: ready(1, { snapshot: true }),
      app: ready(2, { snapshot: true }), alert: ready(1) },
  }),
  versionRow(1, { assets: { dashboard: ready(1, { snapshot: false }), app: ready(1, { snapshot: true }), alert: ready(1),
    genie_space: ready(1, { snapshot: true, vibes_checks: checks(['Answer in euros', 'missing', 'The answers are in dollars'], ['Name the rows you counted', 'done', 'Checked by asking Genie 5 test questions'],
      ['Add a question about returns', 'missing', '']) }) } }),
];

const STATE = {
  history: HISTORY, appExists: true,
  app: { name: 'churn-desk', description: 'Inspire use case N01-U01 (session 42): Predict churn', compute_status: { state: 'ACTIVE' }, app_status: { state: 'RUNNING' } },
  responses: { 'GET /api/2.0/alerts/a1': [{ display_name: 'Churn over 25' }] },
};

function insertsOf(made) {
  return made.sqlCalls.filter((c) => String(c.sql).includes('INSERT INTO') && (c.parameters || []).some((p) => p.name === 'spec'))
    .map((c) => ({ spec: JSON.parse(c.parameters.find((p) => p.name === 'spec').value), classes: c.parameters.find((p) => p.name === 'classes').value }));
}

const OUTPUT_OF = (id) => (id.startsWith('app:') ? 'app' : id.startsWith('dashboard:') ? 'dashboard' : ['ai_reasoning', 'value_formula'].includes(id) ? 'notebook' : id);
const mvpTab = (page, output) => page.locator(`[data-mvp-tab="${output}"]`);
const panel = (page) => page.locator('[data-mvp-panel]');
const partsOf = (page) => panel(page).getByRole('tablist', { name: 'Pick a part', exact: true });
const editMvp = (page) => page.locator('[data-edit-mvp]');
async function showTab(page, output) {
  const tab = mvpTab(page, output);
  if (await tab.getAttribute('aria-selected') !== 'true') await tab.click();
  await page.locator(`[data-mvp-panel="${output}"]`).waitFor();
}
async function pick(page, id) {
  await showTab(page, OUTPUT_OF(id));
  const part = partsOf(page).locator(`[data-tab="${id}"]`);
  if (await part.count()) await part.click();
  const card = panel(page).locator(`[data-vibe-card="${id}"]`);
  await card.waitFor();
  return card;
}
const picked = (page, id) => panel(page).locator(`[data-vibe-card="${id}"]`);
const vibeBox = (page) => page.locator('[data-vibe-box="mvp"]');
const mvpBox = (page) => vibeBox(page).getByRole('textbox', { name: 'Vibes for the MVP', exact: true });
const addVibes = (page) => vibeBox(page).getByRole('button', { name: 'Add vibes', exact: true });
const waiting = (page) => vibeBox(page).locator('[data-waiting]').evaluateAll((items) => items.map((li) => [li.dataset.waiting, li.querySelector('span').textContent]));
const heldOf = (card) => card.locator('[data-held-ask]').evaluateAll((items) => items.map((li) => [li.dataset.heldAsk, li.querySelector('span').textContent]));
const text = async (el) => (await el.textContent()).trim();
const storedVibes = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('inspire.collected_vibes.v1') || '{}'));

async function openTower(state = STATE) {
  const ui = await openUi('implement', state);
  try {
    await ui.page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    await ui.page.getByRole('tablist', { name: 'MVP views' }).waitFor({ timeout: 15000 });
    await showTab(ui.page, 'build');
    await ui.page.getByRole('region', { name: 'History', exact: true }).getByText(/^\d+ spec versions? · /).waitFor({ timeout: 15000 });
  } catch (e) {
    await ui.close();
    throw e;
  }
  return ui;
}

test('the build page has one tab per output in a fixed order; each output tab lists only its own parts with their pills, the first is picked, and picking another shows it', async () => {
  const ui = await openTower();
  const { page } = ui;
  try {
    assert.deepEqual(await page.getByRole('tablist', { name: 'MVP views' }).getByRole('tab').allTextContents(), ['Build', 'App', 'Dashboard', 'Alert', 'Agent', 'Notebook']);
    assert.equal(await page.locator('[data-details-drawer]').count(), 0, 'no drawer: every output has its own tab');
    assert.equal(await page.getByRole('dialog').count(), 0);
    await showTab(page, 'app');
    assert.deepEqual(await partsOf(page).getByRole('tab').evaluateAll((items) => items.map((b) => [b.dataset.tab, b.getAttribute('aria-label'), b.getAttribute('aria-selected')])), [
      ['app', 'The whole App, Ready', 'true'], [PAGE, 'Page: Decisions, Ready', 'false'], ['app:page:detail', 'Page: Row detail, Ready', 'false'],
    ], 'the whole App first, picked from the start, then one tab per page of this App only');
    const whole = picked(page, 'app');
    assert.equal(await whole.getByRole('heading').textContent(), 'The whole App');
    assert.equal(await panel(page).locator('textarea').count(), 0, 'no part has a vibe box of its own');
    const live = panel(page).locator('[data-asset-panel="app"]');
    await live.getByRole('link', { name: /^Open/ }).waitFor();
    await live.getByRole('button', { name: 'Uninstall', exact: true }).waitFor();
    await showTab(page, 'genie_space');
    const agent = panel(page).locator('[data-asset-panel="genie_space"]');
    assert.equal(await agent.getByRole('button', { name: 'Uninstall', exact: true }).isDisabled(), true, 'the Agent waits for the App that asks it');
    assert.match(await agent.locator('[data-uninstall-blocked]').textContent(), /Uninstall the App first\.$/);
    await showTab(page, 'app');
    const card = await pick(page, PAGE);
    const part = panel(page).getByRole('tabpanel');
    assert.equal(await part.getAttribute('aria-labelledby'), await partsOf(page).locator(`[data-tab="${PAGE}"]`).getAttribute('id'), 'the card is the picked part\'s panel');
    assert.equal(await part.locator(`[data-vibe-card="${PAGE}"]`).count(), 1);
    assert.equal(await card.getByRole('heading').textContent(), 'Page: Decisions');
    await card.getByText('The rows to act on, with their filters', { exact: true }).waitFor();
    assert.match(await card.locator('[data-live]').textContent(), /^Version 3, built .+/);
    assert.deepEqual(await heldOf(card), [['held', '“Dark header”'], ['held', '“Rows to act on first”']], 'Built with lists each ask the page holds, one per line');
    await card.locator('[data-built-with]').getByText('Built with', { exact: true }).waitFor();
    assert.deepEqual(await card.locator('[data-held-ask] button').allTextContents(), [' Remove', ' Remove'], 'each held ask can be removed');
    assert.equal(await card.locator('textarea').count(), 0);
    const versions = panel(page).getByRole('region', { name: 'Versions' });
    await versions.getByText('Roll back puts the whole App of an earlier version live again').waitFor();
    assert.deepEqual(await versions.locator('[data-version]').evaluateAll((rows) => rows.map((r) => r.dataset.version)), ['3', '2', '1']);
    await versions.locator('[data-live-version]').getByText('Live', { exact: true }).waitFor();
    await versions.getByRole('button', { name: 'Roll back to version 2', exact: true }).waitFor();
    await partsOf(page).locator('[data-tab="app:page:detail"]').click();
    await picked(page, 'app:page:detail').waitFor();
    assert.equal(await partsOf(page).locator(`[data-tab="${PAGE}"]`).getAttribute('aria-selected'), 'false', 'the earlier pick is let go');
    await picked(page, PAGE).waitFor({ state: 'detached' });
    await partsOf(page).locator('[data-tab="app:page:detail"]').focus();
    await page.keyboard.press('ArrowLeft');
    await picked(page, PAGE).waitFor();
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.tab), PAGE, 'the arrow keys move between parts');
    await page.keyboard.press('End');
    await picked(page, 'app:page:detail').waitFor();

    const parts = {};
    for (const [output, first] of [['notebook', 'notebook'], ['dashboard', 'dashboard'], ['genie_space', 'genie_space'], ['alert', 'alert']]) {
      await showTab(page, output);
      await panel(page).locator(`[data-vibe-card="${first}"]`).waitFor();
      parts[output] = await partsOf(page).getByRole('tab').evaluateAll((items) => items.map((b) => b.getAttribute('aria-label')));
      assert.equal(await panel(page).locator('[data-vibe-card]').count(), 1, `${output}: one card at a time`);
    }
    assert.deepEqual(parts, {
      notebook: ['Notebook, Ready', 'AI reasoning, Ready', 'Money at stake, Ready'],
      dashboard: ['The whole dashboard, Ready with warnings', 'Chart: Weekly trend, Ready with warnings'], genie_space: [], alert: [],
    }, 'a tab with one part shows its card with no picker, and the whole dashboard comes before its charts');

    for (const [id, built, held] of [
      ['genie_space', /^Version 1, built /, ['“Answer in euros, name the rows you counted and add a question about returns”']],
      ['value_formula', /^Version 2, built /, []],
      ['ai_reasoning', /^Version 2, built /, []],
      [CHART, /^Version 3, built /, ['“Bars by week”', '“A map by region”']],
    ]) {
      const shown = await pick(page, id);
      assert.match(await shown.locator('[data-live]').textContent(), built, id);
      assert.deepEqual((await heldOf(shown)).map(([, ask]) => ask), held, id);
      assert.equal(await shown.locator('textarea').count(), 0, id);
    }
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the one vibe box sits above the tabs on every tab: Add vibes keeps an ask in this browser, spaces, a repeat and an ask over the limit add nothing, nothing is written or started, Edit MVP counts it, and Take it out lets it go', async () => {
  const ui = await openTower();
  const { page, made } = ui;
  try {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    for (const output of ['build', 'app', 'dashboard', 'alert', 'genie_space', 'notebook']) {
      await showTab(page, output);
      assert.equal(await vibeBox(page).count(), 1, `${output}: the one box`);
      assert.equal(await panel(page).locator('textarea').count(), 0, `${output}: no tab has a vibe box of its own`);
    }
    const [boxAt, tabsAt] = await Promise.all([vibeBox(page).boundingBox(), page.locator('[data-pinned-tabs]').boundingBox()]);
    assert.ok(boxAt.y + boxAt.height <= tabsAt.y + 1, `the box sits above the tabs (${Math.round(boxAt.y + boxAt.height)} <= ${Math.round(tabsAt.y)})`);
    await vibeBox(page).getByRole('heading', { name: 'Vibe this MVP', exact: true }).waitFor();
    await vibeBox(page).getByText('Say what to change, in your own words. Inspire sends each ask to the part it changes, and an ask that changes the analysis rebuilds the notebook and every part after it.', { exact: true }).waitFor();
    assert.deepEqual(await mvpBox(page).evaluate((el) => [el.rows, getComputedStyle(el).resize]), [8, 'vertical'], 'the same tall box as the wizard, which the person can make taller');
    assert.equal(await mvpBox(page).getAttribute('placeholder'), 'For example: put the rows to act on first on the App, answer in euros in the Genie Agent, and count returns by week');
    await mvpBox(page).fill('   ');
    assert.equal(await addVibes(page).isDisabled(), true, 'only spaces is nothing to add');
    assert.equal(await editMvp(page).getAttribute('data-collected'), null);
    assert.equal((await editMvp(page).textContent()).trim(), 'Edit MVP');
    assert.doesNotMatch(await editMvp(page).getAttribute('class'), /edit-mvp-invite|(^| )0( |$)/, 'no invitation and no stray class while nothing waits');
    await mvpBox(page).fill('Put the rows to act on first');
    await showTab(page, 'dashboard');
    assert.equal(await mvpBox(page).inputValue(), 'Put the rows to act on first', 'what is typed stays when the tab changes');
    await addVibes(page).click();
    assert.equal(await mvpBox(page).inputValue(), '', 'the box empties for the next ask');
    assert.deepEqual(await waiting(page), [['ask', '“Put the rows to act on first”']]);
    assert.equal(await editMvp(page).getAttribute('aria-label'), 'Edit MVP, 1 ask waiting');
    assert.equal(await editMvp(page).getAttribute('data-collected'), '1');
    assert.match(await editMvp(page).getAttribute('class'), /edit-mvp-invite/);
    assert.equal(await editMvp(page).evaluate((el) => getComputedStyle(el).animationName), 'editMvpInvite', 'Edit MVP pulses to invite the click');
    assert.equal(await page.locator('[data-collected-note]').textContent(), 'One ask is waiting. Edit MVP opens it in the Vibes step so one build carries it.');
    assert.deepEqual(Object.values(await storedVibes(page)), [[{ kind: 'ask', text: 'Put the rows to act on first' }]]);
    assert.deepEqual(await page.getByRole('tablist', { name: 'MVP views' }).getByRole('tab').allTextContents(), ['Build', 'App', 'Dashboard', 'Alert', 'Agent', 'Notebook'],
      'no tab counts asks: they belong to the whole MVP');
    assert.equal(made.jobs.length, 0, 'adding an ask starts nothing');
    assert.deepEqual(insertsOf(made), [], 'and writes nothing');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await editMvp(page).evaluate((el) => getComputedStyle(el).animationName), 'none', 'no pulse for a person who asked for less motion');
    assert.notEqual(await editMvp(page).evaluate((el) => getComputedStyle(el).boxShadow), 'none', 'it still stands out with a still ring');

    await mvpBox(page).fill('put the rows to act on FIRST');
    await addVibes(page).click();
    assert.deepEqual(await waiting(page), [['ask', '“Put the rows to act on first”']], 'the same ask twice is kept once');
    await vibeBox(page).getByRole('button', { name: 'Take it out', exact: true }).click();
    await editMvp(page).and(page.locator(':not([data-collected])')).waitFor();
    assert.equal(await page.locator('[data-collected-note]').count(), 0);
    assert.deepEqual(await storedVibes(page), {}, 'the browser keeps nothing once the last ask is taken out');

    await mvpBox(page).fill('x'.repeat(2001));
    await vibeBox(page).getByText('the MVP vibes are 2001 characters; at most 2000 are allowed').waitFor();
    assert.equal(await addVibes(page).isDisabled(), true, 'an ask over the limit cannot be added');
    await mvpBox(page).fill('a'.repeat(1500));
    await addVibes(page).click();
    await mvpBox(page).fill('b'.repeat(600));
    await vibeBox(page).getByText('with the asks waiting, the MVP vibes would be 2101 characters; at most 2000 are allowed', { exact: true }).waitFor();
    assert.equal(await addVibes(page).isDisabled(), true, 'the asks waiting and the new one must fit the one box Edit MVP sends');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the asks you add and the held asks you remove survive a reload; Edit MVP puts the asks in its one box with the removals applied, asks what happens to the live version, and builds it all in one version', async () => {
  const ui = await openTower();
  const { page, made } = ui;
  try {
    await mvpBox(page).fill('  Put the rows to act on first,\n  then a map by region  ');
    await addVibes(page).click();
    await mvpBox(page).fill('Show the last 12 weeks');
    await addVibes(page).click();
    const dash = await pick(page, 'dashboard');
    await dash.getByRole('button', { name: 'Remove “Arabic labels”', exact: true }).click();
    await page.reload();
    await page.getByRole('tablist', { name: 'MVP views' }).waitFor({ timeout: 15000 });
    await editMvp(page).and(page.locator('[data-collected="3"]')).waitFor({ timeout: 15000 });
    assert.equal(await page.locator('[data-collected-note]').textContent(),
      '3 asks are waiting, 1 of them to take out. Edit MVP opens them in the Vibes step so one build carries them all.');
    assert.deepEqual(await waiting(page), [['ask', '“Put the rows to act on first,\n  then a map by region”'], ['ask', '“Show the last 12 weeks”'],
      ['remove', 'Take out of the Dashboard: “Arabic labels”']], 'the browser kept them');
    assert.deepEqual(await heldOf(await pick(page, 'dashboard')), [['held', '“Put the weekly trend first”'], ['removing', '“Arabic labels”, taken out when Edit MVP builds']]);

    await editMvp(page).click();
    const wizard = page.getByRole('dialog', { name: /^Start Use Case MVP with Genie/ });
    await wizard.waitFor();
    await onStep(page, 'Vibes');
    assert.equal(await wizard.locator('[data-collected-vibes]').textContent(),
      'The 2 asks you collected are in the box below. Check them, then build. Inspire also takes out the earlier ask you removed.');
    assert.equal(await wizard.getByRole('textbox', { name: 'Vibes for the MVP', exact: true }).inputValue(), 'Put the rows to act on first,\nthen a map by region\nShow the last 12 weeks');
    assert.equal(await wizard.getByRole('region', { name: 'Vibes' }).locator('textarea').count(), 1, 'one box, no box per asset');
    const choice = wizard.getByRole('group', { name: 'What happens to v3?' });
    await choice.getByRole('radio', { name: /^Keep v3 live/ }).waitFor();
    await page.getByRole('button', { name: 'Start MVP', exact: true }).click();
    await page.locator('[role="alert"]').waitFor();
    assert.deepEqual(await page.locator('[role="alert"] p').allTextContents(), ['choose what happens to v3, the version before this vibe: keep it live or remove it']);
    assert.equal(await page.evaluate(() => document.activeElement?.name), 'vibe-previous', 'Start moves the focus to the choice');
    assert.equal(made.jobs.length, 0, 'nothing is built until the choice is made');
    await choice.getByRole('radio', { name: /^Remove v3 once v4 is ready/ }).check();
    await page.getByRole('button', { name: 'Start MVP', exact: true }).click();
    await until(() => made.jobs.length === 1, 'the build with every ask');
    const [built] = insertsOf(made);
    assert.deepEqual([built.spec.vibes, built.spec.vibe_previous], ['Put the rows to act on first,\nthen a map by region\nShow the last 12 weeks', 'remove']);
    assert.equal(built.spec.outputs.dashboard_vibes, 'Put the weekly trend first', 'the removed ask leaves the part that held it');
    for (const key of ['genie_space_vibes', `${PAGE}_vibes`, `${CHART}_vibes`]) assert.equal(built.spec.outputs[key], V3_OUTPUTS[key], `${key} is carried as it was`);
    assert.ok(built.classes.split(',').includes('vibe'), built.classes);
    await wizard.waitFor({ state: 'detached' });
    await editMvp(page).and(page.locator(':not([data-collected])')).waitFor({ timeout: 15000 });
    assert.deepEqual(await storedVibes(page), {}, 'a build that took them clears them');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('closing Edit MVP without building keeps every ask you added', async () => {
  const ui = await openTower();
  const { page, made } = ui;
  try {
    await mvpBox(page).fill('Answer in Arabic');
    await addVibes(page).click();
    await editMvp(page).click();
    const wizard = page.getByRole('dialog', { name: /^Start Use Case MVP with Genie/ });
    await onStep(page, 'Vibes');
    await wizard.getByRole('button', { name: 'Close', exact: true }).click();
    await wizard.waitFor({ state: 'detached' });
    assert.equal(await editMvp(page).getAttribute('data-collected'), '1');
    assert.equal(Object.values(await storedVibes(page))[0][0].text, 'Answer in Arabic');
    assert.equal(made.jobs.length, 0);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a part lists the asks it holds with Remove on each: a removed ask waits for Edit MVP, Keep it brings it back, and the build takes it out of that part alone', async () => {
  const ui = await openTower();
  const { page, made } = ui;
  try {
    const chart = await pick(page, CHART);
    assert.deepEqual(await heldOf(chart), [['held', '“Bars by week”'], ['held', '“A map by region”']]);
    await chart.getByRole('button', { name: 'Remove “A map by region”', exact: true }).click();
    assert.deepEqual(await heldOf(chart), [['held', '“Bars by week”'], ['removing', '“A map by region”, taken out when Edit MVP builds']]);
    await chart.getByText('Edit MVP builds the next version without the asks you remove.', { exact: true }).waitFor();
    assert.deepEqual(await waiting(page), [['remove', 'Take out of the Weekly trend chart: “A map by region”']]);
    assert.equal(await editMvp(page).getAttribute('aria-label'), 'Edit MVP, 1 ask waiting');
    assert.deepEqual(Object.values(await storedVibes(page)), [[{ kind: 'remove', id: CHART, label: 'Weekly trend chart', text: 'A map by region' }]]);
    assert.deepEqual([made.jobs.length, insertsOf(made).length], [0, 0], 'Remove writes nothing until Edit MVP builds');
    await chart.getByRole('button', { name: 'Keep “A map by region”', exact: true }).click();
    assert.deepEqual(await heldOf(chart), [['held', '“Bars by week”'], ['held', '“A map by region”']]);
    await editMvp(page).and(page.locator(':not([data-collected])')).waitFor();

    await chart.getByRole('button', { name: 'Remove “A map by region”', exact: true }).click();
    await editMvp(page).click();
    const wizard = page.getByRole('dialog', { name: /^Start Use Case MVP with Genie/ });
    await onStep(page, 'Vibes');
    assert.equal(await wizard.locator('[data-collected-vibes]').textContent(), 'Inspire takes out the earlier ask you removed.');
    assert.equal(await wizard.getByRole('textbox', { name: 'Vibes for the MVP', exact: true }).inputValue(), '');
    assert.equal(await wizard.getByRole('group', { name: 'What happens to v3?' }).count(), 0, 'no vibe, so no choice for the live version');
    await page.getByRole('button', { name: 'Start MVP', exact: true }).click();
    await until(() => made.jobs.length === 1, 'the build without the removed ask');
    const [built] = insertsOf(made);
    assert.deepEqual([built.spec.outputs[`${CHART}_vibes`], built.spec.retry_outputs, 'vibes' in built.spec, 'vibe_previous' in built.spec],
      ['Bars by week', [CHART], false, false], 'only the chart is rebuilt, without that ask');
    assert.equal(built.spec.outputs.dashboard_vibes, V3_OUTPUTS.dashboard_vibes, 'the whole dashboard keeps its asks');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('an older record that marked an ask as not doable reads Not done yet like any missing ask, never Cannot be done here, and Try again sends it back to Genie', async () => {
  const unable = versionRow(3, {
    outputs: V3_OUTPUTS, status: 'ready_with_warnings',
    assets: { ...V3_ASSETS, [CHART]: { ...V3_ASSETS[CHART], vibes_checks: [
      { ask: 'Bars by week', status: 'done', evidence: 'Checked by running the rebuilt chart query' },
      { ask: 'A map by region', status: 'missing', evidence: 'The result table has no region column', doable: false },
      { ask: 'Label each bar', status: 'missing', evidence: 'The bars have no labels' },
    ] } },
  });
  const ui = await openTower({ ...STATE, history: [unable, ...HISTORY.slice(1)] });
  const { page, made } = ui;
  try {
    const list = (await pick(page, CHART)).locator('[data-checks]');
    const tally = list.getByText('You asked for 3 things. Done: 1 of 3.', { exact: true });
    await tally.waitFor();
    assert.match(await tally.getAttribute('class'), /text-error-fg/);
    const items = list.getByRole('listitem');
    assert.deepEqual(await items.evaluateAll((li) => li.map((x) => x.dataset.check)), ['done', 'missing', 'missing']);
    assert.equal(await items.nth(1).textContent(),
      '!Not done yet: A map by regionNot done yet. The result table has no region column. This chart is marked ready with warnings.');
    assert.equal(await items.nth(2).textContent(), '!Not done yet: Label each barNot done yet. The bars have no labels. This chart is marked ready with warnings.');
    assert.equal(await page.getByText(/cannot be done here/i).count(), 0, 'no verdict says an ask cannot be done');
    for (const dark of [false, true]) {
      await setDark(page, dark);
      const result = await lowContrast(page, ['[data-mvp-panel] [data-checks]']);
      assert.ok(result.checked >= 6, `measured ${result.checked} elements`);
      assert.deepEqual(result.low, [], dark ? 'dark' : 'light');
    }
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
    await list.getByRole('button', { name: 'Try again with the 2 missing things', exact: true }).click();
    await until(() => made.jobs.length === 1, 'the try again');
    const [retried] = insertsOf(made);
    assert.deepEqual(retried.spec.retry_asks, { [CHART]: ['A map by region', 'Label each bar'] }, 'every missing ask goes back to Genie');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('an asset whose asks were all done says You asked for 2 things. Done: 2 of 2. with how each was checked, and offers no Try again', async () => {
  const ui = await openTower();
  const { page } = ui;
  try {
    const list = (await pick(page, PAGE)).locator('[data-checks]');
    const tally = list.getByText('You asked for 2 things. Done: 2 of 2.', { exact: true });
    await tally.waitFor();
    assert.match(await tally.getAttribute('class'), /text-success-fg/);
    const items = list.getByRole('list', { name: 'What you asked for on the Decisions page' }).getByRole('listitem');
    assert.deepEqual(await items.evaluateAll((li) => li.map((x) => x.dataset.check)), ['done', 'done']);
    assert.deepEqual(await items.allTextContents(), [
      '✓Done: Dark headerChecked by opening the rebuilt page with the latest data. Version 3.',
      '✓Done: Rows to act on firstThe decision list opens the page. Version 3.',
    ]);
    assert.equal(await list.getByRole('button', { name: /^Try again/ }).count(), 0);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a missing ask reads not done yet with the asset ready with warnings, and Try again rebuilds that asset with only the missing asks, keeping the vibes as written', async () => {
  const ui = await openTower();
  const { page, made } = ui;
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    const chart = await pick(page, CHART);
    const list = chart.locator('[data-checks]');
    const tally = list.getByText('You asked for 2 things. Done: 1 of 2.', { exact: true });
    await tally.waitFor();
    assert.match(await tally.getAttribute('class'), /text-error-fg/);
    const items = list.getByRole('listitem');
    assert.deepEqual(await items.evaluateAll((li) => li.map((x) => x.dataset.check)), ['done', 'missing']);
    assert.equal(await items.nth(1).textContent(),
      '!Not done yet: A map by regionNot done yet. The result table has no region column. This chart is marked ready with warnings.');
    await chart.getByText('Ready with warnings', { exact: true }).waitFor();
    await list.getByText('Only what is missing is rebuilt.').waitFor();
    const sizes = await page.evaluate(() => {
      const card = document.querySelector('[data-mvp-panel] [data-vibe-card]');
      return { page: document.scrollingElement.scrollWidth, wide: card.scrollWidth <= card.clientWidth + 1 };
    });
    assert.ok(sizes.page <= 1440 && sizes.wide, JSON.stringify(sizes));
    for (const dark of [false, true]) {
      await setDark(page, dark);
      const result = await lowContrast(page, ['[data-mvp-panel]']);
      assert.ok(result.checked >= 10, `measured ${result.checked} elements`);
      assert.deepEqual(result.low, [], dark ? 'dark' : 'light');
    }
    await page.evaluate(() => document.documentElement.classList.remove('dark'));

    await list.getByRole('button', { name: 'Try again with the missing thing', exact: true }).click();
    await until(() => made.jobs.length === 1, 'the chart try again');
    const [retried] = insertsOf(made);
    assert.deepEqual([retried.spec.retry_outputs, retried.spec.retry_asks, retried.classes], [[CHART], { [CHART]: ['A map by region'] }, 'retry'],
      'only the missing ask is rebuilt, on the chart alone');
    assert.equal(retried.spec.outputs[`${CHART}_vibes`], V3_OUTPUTS[`${CHART}_vibes`], 'the vibes stay exactly as the user wrote them');

    const genie = await pick(page, 'genie_space');
    await genie.locator('[data-checks]').getByText('You asked for 3 things. Done: 1 of 3.', { exact: true }).waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('[data-mvp-panel] [data-checks] button')].some((b) => !b.disabled));
    await genie.getByRole('button', { name: 'Try again with the 2 missing things', exact: true }).click();
    await until(() => made.jobs.length === 2, 'the Genie Agent try again');
    const whole = insertsOf(made)[1];
    assert.deepEqual([whole.spec.retry_outputs, whole.spec.retry_asks, whole.spec.outputs.genie_space_vibes, whole.classes],
      [['genie_space'], { genie_space: ['Answer in euros', 'Add a question about returns'] }, V3_OUTPUTS.genie_space_vibes, 'retry']);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('while a version rebuilds the picked asset, it reads Rebuilding with the three steps and the asks being built, Edit MVP waits, and a vibe can still be added for later', async () => {
  const building = versionRow(4, {
    status: 'building_outputs', implement_run_id: '5555555555555555', updated_at: new Date().toISOString(), change_classes: 'retry',
    outputs: { ...V3_OUTPUTS, [`${PAGE}_vibes`]: 'Rows first, then a map by region and a filter' }, top: { retry_outputs: [PAGE] }, assets: {},
  });
  const ui = await openTower({ ...STATE, history: [building, ...HISTORY], implementRun: { run_id: 5555555555555555, state: { life_cycle_state: 'RUNNING' } } });
  const { page, made } = ui;
  try {
    const card = await pick(page, PAGE);
    const nav = partsOf(page);
    await nav.getByRole('tab', { name: 'Page: Decisions, Rebuilding', exact: true }).waitFor();
    await nav.getByRole('tab', { name: 'Page: Row detail, Ready', exact: true }).waitFor();
    assert.equal(await nav.getByRole('tab', { name: /, Rebuilding$/ }).count(), 1, 'only the page is rebuilding');
    const steps = card.getByRole('list', { name: 'Rebuilding the Decisions page' }).getByRole('listitem');
    assert.deepEqual(await steps.evaluateAll((li) => li.map((x) => [x.dataset.step, x.textContent])), [
      ['done', '✓Reading what you asked: 3 things'],
      ['now', '2Rebuilding the Decisions page only. Nothing else changes.'],
      ['next', '3Checking each thing you asked for'],
    ]);
    assert.deepEqual(await heldOf(card), [['held', '“Rows first, then a map by region and a filter”']], 'the asks being built show');
    assert.equal(await card.locator('[data-checks]').count(), 0, 'the checklist comes back once the build ends');
    assert.equal(await editMvp(page).isDisabled(), true, 'Edit MVP waits for the build');
    const detail = await pick(page, 'app:page:detail');
    await detail.getByText('A version is building now; roll backs apply after it finishes, and the asks you add or remove wait for Edit MVP.').waitFor();
    await vibeBox(page).getByText('A version is building now; the asks you add wait for Edit MVP.', { exact: true }).waitFor();
    await mvpBox(page).fill('Add a filter by region');
    await addVibes(page).click();
    assert.equal(await page.locator('[data-collected-note]').textContent(),
      'One ask is waiting. After this build finishes, Edit MVP opens it in the Vibes step so one build carries it.');
    assert.equal(await editMvp(page).isDisabled(), true);
    assert.doesNotMatch(await editMvp(page).getAttribute('class'), /edit-mvp-invite/, 'no invitation to click a button that is waiting');
    assert.equal(made.jobs.length, 0);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('an App this use case was taken out of says whose App it was and who keeps it, readable in light and dark, and a deleted alert says nothing more', async () => {
  const takenOut = versionRow(4, {
    outputs: { app: false, alert: false }, change_classes: 'outputs',
    assets: { ...V3_ASSETS, app: { state: 'released', note: "not this use case's App", taken_out_of: 'sales-hub', stays_for: ['Forecast demand', 'Score leads'] },
      alert: { state: 'deleted', note: 'deleted' } },
    app_name: null, app_url: null, alert_id: null, alert_url: null,
  });
  const ui = await openTower({ ...STATE, history: [takenOut, ...HISTORY] });
  const { page } = ui;
  try {
    await showTab(page, 'app');
    const off = page.locator('[data-asset-panel="app"][data-tile-kind="off"]');
    await off.getByText('App: not in this MVP', { exact: true }).waitFor();
    assert.equal(await off.locator('[data-asset-note]').textContent(),
      "This use case's pages were taken out of sales-hub, which stays for Forecast demand and Score leads.");
    for (const dark of [false, true]) {
      await setDark(page, dark);
      const result = await lowContrast(page, ['[data-asset-panel="app"]']);
      assert.ok(result.checked >= 3, `measured ${result.checked} elements`);
      assert.deepEqual(result.low, [], dark ? 'dark' : 'light');
    }
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
    await showTab(page, 'alert');
    const alert = page.locator('[data-asset-panel="alert"][data-tile-kind="off"]');
    await alert.getByText('Alert: not in this MVP', { exact: true }).waitFor();
    assert.equal(await alert.locator('[data-asset-note]').count(), 0, 'an alert this use case deleted was not taken out of anything');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the use case list sits on the left; on the right the name, then its MVP progress, then Use case details, Edit MVP and Uninstall all, then the tabs', async () => {
  const ui = await openTower();
  const { page } = ui;
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    const pane = page.getByRole('region', { name: 'Use case', exact: true });
    const [list, right] = [await page.locator('[data-implement-rail]').boundingBox(), await pane.boundingBox()];
    assert.ok(list.x + list.width <= right.x, `the list is left of the use case (${Math.round(list.x + list.width)} <= ${Math.round(right.x)})`);
    const name = pane.locator('[data-pinned-name]');
    assert.equal(await name.locator('h2').textContent(), HARNESS_USE_CASE.Name);
    assert.equal(await name.locator('[data-pinned-percent]').textContent(), '100% built');
    const buttons = await Promise.all(['Use case details', 'Edit MVP', 'Uninstall all']
      .map((label) => pane.getByRole('button', { name: label, exact: true }).boundingBox()));
    const [nameBox, progress, tabs] = await Promise.all([name, pane.locator('[data-mvp-progress]'), pane.locator('[data-pinned-tabs]')].map((el) => el.boundingBox()));
    assert.ok(nameBox.y < progress.y, 'the MVP progress is right below the name');
    assert.ok(progress.y + progress.height <= buttons[0].y, 'the buttons are below the MVP progress');
    assert.ok(buttons.every((b) => Math.abs(b.y - buttons[0].y) <= 1), 'the three buttons share one row');
    assert.ok(buttons[0].x < buttons[1].x && buttons[1].x < buttons[2].x, 'in the order Use case details, Edit MVP, Uninstall all');
    assert.ok(buttons[0].y + buttons[0].height <= tabs.y, 'the tabs are below the buttons');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('every output tab has its Open link and its Uninstall and no vibe box of its own, and the one box above the tabs serves them all', async () => {
  const ui = await openTower({ ...STATE, useCase: { ...HARNESS_USE_CASE, has_genie_code: 'Y', notebook_path: '/Users/owner@example.com/inspire/Acme/N01-U01' } });
  const { page } = ui;
  try {
    const seen = {};
    for (const id of ['app', 'dashboard', 'alert', 'genie_space', 'notebook']) {
      await showTab(page, id);
      const tabPanel = page.locator(`[data-mvp-panel="${id}"]`);
      await tabPanel.getByRole('link', { name: /^Open( the notebook)?$/ }).first().waitFor({ timeout: 15000 });
      seen[id] = {
        open: await tabPanel.getByRole('link', { name: /^Open( the notebook)?$/ }).count() >= 1,
        uninstall: await tabPanel.getByRole('button', { name: /^(Uninstall|Remove from .+)$/ }).count(),
        box: await tabPanel.locator('textarea').count(),
        add: await tabPanel.getByRole('button', { name: 'Add vibes', exact: true }).count(),
        mvp: await vibeBox(page).count(),
      };
    }
    const each = { open: true, uninstall: 1, box: 0, add: 0, mvp: 1 };
    assert.deepEqual(seen, { app: each, dashboard: each, alert: each, genie_space: each, notebook: each });
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

const holder = (uc, name, extra) => ({
  session_id: '42', use_case_id: uc, spec_version: 1, status: 'ready', updated_at: '2026-10-26T00:00:00Z', asset_status: null,
  spec_json: JSON.stringify({ use_case_id: uc, use_case_name: name, outputs: { app: true } }), dashboard_id: null, genie_space_id: null, app_name: null, ...extra,
});

test('the App tab of an App another use case shares offers Remove from it, says only this use case\'s pages come out, and sends that as the next version', async () => {
  const ui = await openTower({
    ...STATE,
    registry: [holder('N01-U01', 'Predict churn', { app_name: 'churn-desk', dashboard_id: 'd1', genie_space_id: 'g1' }), holder('N01-U02', 'Forecast demand', { app_name: 'churn-desk' })],
  });
  const { page, made } = ui;
  try {
    await showTab(page, 'dashboard');
    await page.locator('[data-asset-panel="dashboard"]').getByRole('button', { name: 'Uninstall', exact: true }).waitFor({ timeout: 15000 });
    await showTab(page, 'app');
    const app = page.locator('[data-asset-panel="app"]');
    const remove = app.getByRole('button', { name: 'Remove from churn-desk', exact: true });
    await remove.waitFor({ timeout: 15000 });
    assert.equal(await app.getByRole('button', { name: 'Uninstall', exact: true }).count(), 0, 'a shared App is never offered for deletion');
    await remove.click();
    const dialog = page.getByRole('dialog', { name: 'Remove this use case from churn-desk' });
    await dialog.getByText("Inspire takes this use case's pages out of churn-desk in a new version of this MVP and keeps the other outputs. "
      + 'churn-desk stays for Forecast demand. If no other use case holds it by the time the job runs, Inspire deletes it instead.', { exact: true }).waitFor();
    await dialog.getByRole('textbox', { name: 'Type the use case id to confirm' }).fill('N01-U01');
    await dialog.getByRole('button', { name: 'Remove from churn-desk', exact: true }).click();
    await until(() => insertsOf(made).length === 1, 'the removal version');
    const [sent] = insertsOf(made);
    assert.equal(sent.spec.outputs.app, false);
    assert.equal(sent.spec.removed_outputs.app, 'delete', 'the job decides at run time whether it deletes or takes this use case out');
    assert.equal(sent.spec.outputs.dashboard, true, 'the other outputs stay');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

const JOINER_STATE = {
  ...STATE,
  history: [versionRow(3, {
    outputs: { ...V3_OUTPUTS, app_name: 'sales-hub', merge: { app: 'sales-hub', dashboard: '', genie_space: '' } },
    assets: { ...V3_ASSETS, app: { ...V3_ASSETS.app, merged_into: 'sales-hub', page: 'n01_u01_s42' } },
    app_name: 'sales-hub', app_url: 'https://sales-hub-1.aws.example.com',
  }), ...HISTORY.slice(1)],
  app: { name: 'sales-hub', url: 'https://sales-hub-1.aws.example.com', description: 'Inspire use case N01-U02 (session 42): Forecast demand',
    compute_status: { state: 'ACTIVE' }, app_status: { state: 'RUNNING', message: 'App is running' } },
  registry: [holder('N01-U01', 'Predict churn', { app_name: 'sales-hub', dashboard_id: 'd1', spec_version: 3 }),
    holder('N01-U02', 'Forecast demand', { app_name: 'sales-hub', dashboard_id: 'd1' }), holder('N01-U03', 'Score leads', { app_name: 'sales-hub' })],
  responses: { ...STATE.responses, 'POST /api/2.0/apps/sales-hub/stop': [{}] },
};

test('a use case that joined another use case\'s App reads it live as part of a shared App, names who built it and who else holds it, and stops it only after a confirm that names them', async () => {
  const ui = await openTower(JOINER_STATE);
  const { page, made } = ui;
  const controls = [];
  page.on('request', (r) => { if (r.url().includes('/api/inspire/implement/control')) controls.push(JSON.parse(r.postData() || '{}')); });
  try {
    await showTab(page, 'app');
    const app = page.locator('[data-asset-panel="app"]');
    await app.locator('[data-shared-note]').waitFor({ timeout: 15000 });
    assert.equal(await app.getAttribute('data-tile-kind'), 'live');
    assert.equal(await app.locator('[data-shared-note]').textContent(),
      "This use case's pages are part of sales-hub, which Forecast demand built. It also holds the pages of Score leads.");
    assert.equal(await page.locator('[data-implement-page]').getByText("no longer this use case's App", { exact: false }).count(), 0, 'the live status reads the App');
    assert.equal(await app.getByText('Cannot read', { exact: true }).count(), 0);
    await page.locator('[data-asset-facts="app"]').getByText('RUNNING: App is running', { exact: true }).waitFor({ timeout: 15000 });
    assert.equal(await app.getByRole('link', { name: 'Open', exact: true }).getAttribute('href'), 'https://sales-hub-1.aws.example.com');
    assert.equal(await app.getByRole('button', { name: 'Remove from sales-hub', exact: true }).count(), 1, 'its uninstall takes only this use case out');
    const result = await lowContrast(page, ['[data-asset-panel="app"]']);
    assert.deepEqual(result.low, []);

    await app.getByRole('button', { name: 'Stop the App', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Stop the App for every use case in it' });
    await dialog.getByText("Inspire stops sales-hub for every use case in it: the pages of Forecast demand and Score leads stop with this use case's pages.",
      { exact: true }).waitFor();
    assert.deepEqual(controls, [], 'nothing is sent before the confirm');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.deepEqual(controls, [], 'and nothing after a cancel');
    await app.getByRole('button', { name: 'Stop the App', exact: true }).click();
    await dialog.getByRole('textbox', { name: 'Type the use case id to confirm' }).fill('N01-U01');
    await dialog.getByRole('button', { name: 'Stop the App', exact: true }).click();
    await until(() => made.fetches.some((f) => f.path === '/api/2.0/apps/sales-hub/stop'), 'the confirmed stop');
    assert.deepEqual(controls, [{ asset: 'app', action: 'stop', confirm_shared: true }]);

    await showTab(page, 'dashboard');
    const board = page.locator('[data-asset-panel="dashboard"]');
    assert.equal(await board.locator('[data-shared-note]').textContent(), 'Dashboard also holds the pages of Forecast demand.');
    await board.getByRole('button', { name: 'Unpublish', exact: true }).click();
    const unpublish = page.getByRole('dialog', { name: 'Unpublish for every use case in it' });
    await unpublish.getByText("Inspire unpublishes Dashboard for every use case in it: the pages of Forecast demand are unpublished with this use case's pages.",
      { exact: true }).waitFor();
    await unpublish.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(controls.length, 1, 'a cancelled unpublish sends nothing');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('when Inspire cannot read who else holds a joined App, its tab names only who built it, and a stop asks a confirm that says Inspire could not check', async () => {
  const ui = await openTower({ ...JOINER_STATE, registryError: 'warehouse is stopped' });
  const { page, made } = ui;
  const controls = [];
  page.on('request', (r) => { if (r.url().includes('/api/inspire/implement/control')) controls.push(JSON.parse(r.postData() || '{}')); });
  try {
    await showTab(page, 'app');
    const app = page.locator('[data-asset-panel="app"]');
    await app.locator('[data-shared-note]').waitFor({ timeout: 15000 });
    assert.equal(await app.locator('[data-shared-note]').textContent(), "This use case's pages are part of sales-hub, which Forecast demand built.");
    await app.getByRole('button', { name: 'Stop the App', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Stop the App for every use case in it' });
    await dialog.getByText('Inspire could not check whether other use cases hold pages in sales-hub. If one does, its pages stop with it too.', { exact: true }).waitFor();
    assert.deepEqual(controls, [], 'nothing is sent before the confirm');
    await dialog.getByRole('textbox', { name: 'Type the use case id to confirm' }).fill('N01-U01');
    await dialog.getByRole('button', { name: 'Stop the App', exact: true }).click();
    await until(() => made.fetches.some((f) => f.path === '/api/2.0/apps/sales-hub/stop'), 'the confirmed stop');
    assert.deepEqual(controls, [{ asset: 'app', action: 'stop', confirm_shared: true }]);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a Genie Agent rebuilt while the use case has an App says the App page is pointed at it', async () => {
  const building = versionRow(4, {
    status: 'building_outputs', implement_run_id: '5555555555555555', updated_at: new Date().toISOString(), change_classes: 'retry',
    outputs: V3_OUTPUTS, top: { retry_outputs: ['genie_space'] }, assets: {},
  });
  const ui = await openTower({ ...STATE, history: [building, ...HISTORY], implementRun: { run_id: 5555555555555555, state: { life_cycle_state: 'RUNNING' } } });
  try {
    const card = await pick(ui.page, 'genie_space');
    const steps = card.getByRole('list', { name: 'Rebuilding the Genie Agent' }).getByRole('listitem');
    assert.deepEqual(await steps.evaluateAll((li) => li.map((x) => x.textContent.slice(1))), [
      'Reading what you asked: 3 things',
      'Rebuilding the Genie Agent, then pointing the App page at it. Nothing else changes.',
      'Checking each thing you asked for',
    ]);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

const VIBE = 'the action plan table needs a filter on every column so I can pick Act now';
const APP_PLAN = { build: [], classes: ['outputs', 'retry', 'vibe'], delete: [], keep_unmanaged: [], preview: false, refill: false, refresh: ['app'], repoint: [],
  restyle: [], rollback: {}, rollback_built: {}, schedule: false, sharing: true };
const agoIso = (seconds) => new Date(Date.now() - seconds * 1000).toISOString();
const stepRow = (phase, status, seconds, payload = {}, message = '') => ({
  step_id: String(1000 + seconds), session_id: '42', stage_name: 'Implement Use Cases', step_name: `Inspire is working on ${phase.toLowerCase()}`,
  sub_step_name: status === 'started' ? 'In progress: n01-u01' : 'Completed: n01-u01', status, message, last_updated: agoIso(seconds),
  result_json: JSON.stringify({ use_case_id: 'N01-U01', phase, event_at: agoIso(seconds), ...payload }),
});
const vibeVersion = (status) => versionRow(4, {
  status, implement_run_id: '5555555555555555', updated_at: new Date().toISOString(), change_classes: 'outputs,retry,vibe',
  outputs: V3_OUTPUTS, top: { vibes: VIBE, vibe_previous: 'remove' }, assets: V3_ASSETS,
});
const stagesOf = (page) => page.locator('[data-mvp-progress] [aria-label="Build stages"] > li')
  .evaluateAll((items) => items.map((li) => [li.dataset.stage, li.querySelector('[data-stage-label]').textContent, li.dataset.stageState]));

test('a vibe Inspire sent to the App alone rebuilds only the App: the stepper, the kept line and the tiles follow the recorded plan', async () => {
  const lines = [`sent to App: ${VIBE}`];
  const steps = [
    stepRow('Vibe', 'started', 90, { spec_version: 4 }),
    stepRow('Vibe', 'ended_success', 86, { spec_version: 4, lines }, `Inspire has completed vibe: ${lines.join('\n')}`),
    stepRow('Plan', 'ended_success', 80, { spec_version: 4, plan: APP_PLAN }),
    stepRow('Genie Code', 'started', 60), stepRow('Genie Code', 'ended_success', 50),
    stepRow('App', 'started', 30, { spec_version: 4, round: 1, rounds: 3 }),
  ];
  const run = { run_id: 5555555555555555, state: { life_cycle_state: 'RUNNING' } };
  const ui = await openTower({ ...STATE, history: [vibeVersion('building_outputs'), ...HISTORY], steps, implementRun: run });
  const { page } = ui;
  try {
    const progress = page.locator('[data-mvp-progress]');
    await progress.locator('[data-stage="App"][data-stage-state="running"]').waitFor({ timeout: 15000 });
    assert.deepEqual(await stagesOf(page), [
      ['Vibe', 'Vibe', 'done'], ['Plan', 'Plan', 'done'], ['Genie Code', 'Start Genie Code', 'done'], ['App', 'Rebuild the App', 'running'], ['Done', 'Done', 'waiting'],
    ]);
    for (const absent of ['Dashboard', 'Genie Agent', 'Alert', 'Instruction', 'Genie build', 'Preview run']) {
      assert.equal(await progress.locator(`[data-stage="${absent}"]`).count(), 0, `the ${absent} stage must not show`);
    }
    await progress.getByText('Genie is rebuilding the App…', { exact: true }).waitFor();
    assert.equal(await text(progress.locator('[data-scope-note="kept"]')), 'Kept as is: the notebook, the Dashboard, the Genie Agent and the Alert');
    assert.equal(await progress.locator('[data-scope-note="refill"]').count(), 0, 'an App vibe never says the notebook is rebuilt');
    assert.equal(await text(progress.locator('[data-vibe-route="route"]')), `Sent to the App: “${VIBE}”`);
    assert.equal(await progress.locator('[data-vibe-route]').count(), 1, 'one line for the one ask, and no count of asks no part can do');

    const building = {};
    for (const id of ['app', 'dashboard', 'genie_space', 'alert']) {
      await showTab(page, id);
      const tile = page.locator(`[data-asset-panel="${id}"]`);
      await tile.waitFor();
      await page.waitForFunction((which) => document.querySelector(`[data-asset-panel="${which}"]`)?.dataset.tileKind === 'live', id, { timeout: 20000 });
      building[id] = await tile.getAttribute('data-tile-building');
    }
    assert.deepEqual(building, { app: 'now', dashboard: null, genie_space: null, alert: null }, 'only the App tile is building');
    await showTab(page, 'app');
    await page.locator('[data-asset-panel="app"]').getByText('Genie is rebuilding it now', { exact: true }).waitFor();
    const whole = await pick(page, 'app');
    const appSteps = whole.getByRole('list', { name: 'Rebuilding the App' }).getByRole('listitem');
    assert.equal((await appSteps.nth(1).textContent()).slice(1), 'Rebuilding the App only. Nothing else changes.');
    const dash = await pick(page, 'dashboard');
    assert.equal(await dash.getByRole('list', { name: 'Rebuilding the Dashboard' }).count(), 0, 'the dashboard card is not rebuilding');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('before the plan lands, the stepper shows only the vibe and the plan, and every live output stays live', async () => {
  const run = { run_id: 5555555555555555, state: { life_cycle_state: 'RUNNING' } };
  const ui = await openTower({ ...STATE, history: [vibeVersion('queued'), ...HISTORY], steps: [stepRow('Vibe', 'started', 5, { spec_version: 4 })], implementRun: run });
  const { page } = ui;
  try {
    const progress = page.locator('[data-mvp-progress]');
    await progress.locator('[data-stage="Vibe"][data-stage-state="running"]').waitFor({ timeout: 15000 });
    assert.deepEqual(await stagesOf(page), [['Vibe', 'Vibe', 'running'], ['Plan', 'Plan', 'waiting']], 'never the full list');
    await progress.getByText('Inspire is reading your vibe to send each ask to the part it changes…', { exact: true }).waitFor();
    assert.equal(await page.getByRole('progressbar', { name: 'Build progress' }).getAttribute('aria-valuenow'), '0');
    await showTab(page, 'dashboard');
    await page.waitForFunction(() => document.querySelector('[data-asset-panel="dashboard"]')?.dataset.tileKind === 'live', null, { timeout: 20000 });
    assert.equal(await page.locator('[data-asset-panel="dashboard"]').getAttribute('data-tile-building'), null);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('when Inspire puts back what no ask targets, the stepper shows a done Self-fix stage before Done and the live checklist reads it in green', async () => {
  const fixture = createRequire(import.meta.url)('../../../backend/test/fixtures/implement_self_fix_cases.json');
  const agent = fixture.cases.find((c) => c.name.startsWith('Inspire put back two'));
  const fix = agent.steps.find((s) => s.step_name === fixture.self_fix_step);
  const listed = agent.steps.find((s) => s.step_name === fixture.checklist_step);
  const steps = [
    stepRow('Vibe', 'ended_success', 90, { spec_version: 4 }),
    stepRow('Plan', 'ended_success', 80, { spec_version: 4, plan: APP_PLAN }),
    stepRow('Genie Code', 'started', 60), stepRow('Genie Code', 'ended_success', 50),
    stepRow('App', 'ended_success', 20, { spec_version: 4 }),
    stepRow(fixture.checklist_step, listed.status, 12, { ...listed.result_json, use_case_id: 'N01-U01', spec_version: 4 }, listed.message),
    stepRow(fixture.self_fix_step, fix.status, 10, { ...fix.result_json, use_case_id: 'N01-U01', spec_version: 4 }, fix.message),
  ];
  const run = { run_id: 5555555555555555, state: { life_cycle_state: 'RUNNING' } };
  const ui = await openTower({ ...STATE, history: [vibeVersion('building_outputs'), ...HISTORY], steps, implementRun: run });
  const { page } = ui;
  try {
    const progress = page.locator('[data-mvp-progress]');
    await progress.locator('[data-stage="Self-fix"][data-stage-state="done"]').waitFor({ timeout: 15000 });
    assert.deepEqual(await stagesOf(page), [
      ['Vibe', 'Vibe', 'done'], ['Plan', 'Plan', 'done'], ['Genie Code', 'Start Genie Code', 'done'], ['App', 'Rebuild the App', 'done'],
      ['Self-fix', 'Self-fix', 'done'], ['Done', 'Done', 'next'],
    ]);
    const list = page.getByRole('region', { name: 'Vibe checklist of v4', exact: true });
    await list.waitFor({ timeout: 15000 });
    assert.deepEqual(await list.locator('[data-requirement]').evaluateAll((rows) => rows.map((r) => r.dataset.requirement)), ['self_fixed', 'self_fixed']);
    assert.deepEqual(await list.locator('[data-requirement-status]').allTextContents(), agent.entries.map((e) => `Put back by Inspire. ${e.evidence}.`));
    const headline = list.locator('[data-checklist-headline]');
    assert.equal(await headline.textContent(), listed.message, 'the agent step message, byte for byte');
    assert.equal(listed.message, '0 of 0 vibe requirements met; Inspire put back 2 elements no ask targets');
    assert.match(await headline.getAttribute('class'), /\btext-success-fg\b/, 'a fix is green, never a warning');
    const contrast = await lowContrast(page, ['[aria-label="Vibe checklist of v4"]']);
    assert.ok(contrast.checked >= 5, `measured ${contrast.checked}`);
    assert.deepEqual(contrast.low, []);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a rolled back output shows the checklist of the version it rolled back to, its Versions card marks Live, and Roll back still works from its tab', async () => {
  const rolled = [
    versionRow(4, {
      outputs: { ...V3_OUTPUTS, dashboard_vibes: 'Make the trend weekly', [`${CHART}_vibes`]: '' }, top: { rollback_outputs: { dashboard: 2 } }, change_classes: 'rollback',
      assets: { ...V3_ASSETS, dashboard: ready(4, { snapshot: true }), [CHART]: undefined },
    }),
    ...HISTORY,
  ];
  const ui = await openTower({ ...STATE, history: rolled });
  const { page, made } = ui;
  const sent = [];
  page.on('request', (req) => { if (req.url().includes('/api/inspire/implement/submit')) sent.push(JSON.parse(req.postData())); });
  try {
    const dash = await pick(page, 'dashboard');
    const list = dash.locator('[data-checks]');
    await list.getByText('You asked for 1 thing. Done: 1 of 1.', { exact: true }).waitFor();
    assert.deepEqual(await list.getByRole('listitem').allTextContents(), ['✓Done: Make the trend weeklyThe trend is weekly. Version 2.'], 'the checklist of v2');
    const versions = panel(page).getByRole('region', { name: 'Versions' });
    await versions.getByText('Roll back puts an earlier version live again', { exact: true }).waitFor();
    assert.deepEqual(await versions.locator('[data-version]').evaluateAll((rows) => rows.map((r) => r.dataset.version)), ['4', '3', '2']);
    assert.deepEqual(await versions.locator('[data-version-checks]').allTextContents(), ['You asked for 2 things. Done: 1 of 2.', 'You asked for 1 thing. Done: 1 of 1.']);
    const row = versions.locator('[data-version="3"]');
    await row.getByRole('button', { name: 'Roll back to version 3', exact: true }).click();
    const confirm = row.getByRole('group', { name: 'Confirm the roll back to version 3' });
    await confirm.getByText('Roll back the Dashboard to version 3? This replaces the live Dashboard; Genie is not called.').waitFor();
    await confirm.getByRole('button', { name: 'Roll back', exact: true }).click();
    await until(() => made.jobs.length === 1, 'the roll back');
    assert.deepEqual([sent[0].spec.rollback_outputs, sent[0].spec.outputs.dashboard_vibes], [{ dashboard: 3 }, V3_OUTPUTS.dashboard_vibes]);
    const [stored] = insertsOf(made);
    assert.deepEqual(stored.spec.rollback_outputs, { dashboard: 3 });
    assert.equal(stored.spec.outputs[`${CHART}_vibes`], V3_OUTPUTS[`${CHART}_vibes`], 'the chart gets back the asks of v3 with its dashboard');
    assert.deepEqual(stored.classes.split(','), ['outputs', 'rollback']);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a roll back of a dashboard that no longer exists says Genie builds a new one, and while it runs it shows the build steps, not a roll back', async () => {
  const noChart = { ...V3_ASSETS, [CHART]: undefined };
  const lost = versionRow(3, {
    outputs: V3_OUTPUTS, status: 'ready_with_warnings', dashboard_id: null, dashboard_url: null,
    assets: { ...noChart, dashboard: { state: 'failed', spec_version: 3, error: 'the warehouse is stopped' } },
  });
  const live = versionRow(3, { outputs: V3_OUTPUTS, status: 'ready_with_warnings', assets: noChart });
  const rolling = versionRow(4, {
    status: 'building_outputs', implement_run_id: '5555555555555555', updated_at: new Date().toISOString(), change_classes: 'rollback',
    outputs: { ...V3_OUTPUTS, dashboard_vibes: 'Make the trend weekly' }, top: { rollback_outputs: { dashboard: 2 } }, assets: {},
  });
  let ui = await openTower({ ...STATE, history: [lost, ...HISTORY.slice(1)] });
  try {
    await pick(ui.page, 'dashboard');
    const row = panel(ui.page).getByRole('region', { name: 'Versions' }).locator('[data-version="2"]');
    await row.getByRole('button', { name: 'Roll back to version 2', exact: true }).click();
    await row.getByRole('group', { name: 'Confirm the roll back to version 2' })
      .getByText('Roll back the Dashboard to version 2? The Dashboard no longer exists, so Genie builds a new one from the vibes of version 2.', { exact: true })
      .waitFor();
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
  const run = { run_id: 5555555555555555, state: { life_cycle_state: 'RUNNING' } };
  for (const [base, builds] of [[lost, true], [live, false]]) {
    ui = await openTower({ ...STATE, history: [rolling, base, ...HISTORY.slice(1)], implementRun: run });
    try {
      const card = await pick(ui.page, 'dashboard');
      const steps = card.getByRole('list', { name: 'Rebuilding the Dashboard' });
      const back = card.locator('[data-rolling-back]');
      if (builds) {
        await steps.waitFor();
        assert.equal(await back.count(), 0, 'a dashboard that is gone is built by Genie, so it never says Genie is not called');
      } else {
        await back.waitFor();
        assert.equal((await back.textContent()).trim(), 'Putting version 2 live again. Genie is not called and nothing else changes.');
        assert.equal(await steps.count(), 0);
      }
      assert.deepEqual(ui.pageErrors, []);
    } finally {
      await ui.close();
    }
  }
});

test('a notebook Try again that would read a swapped table that is gone is refused on its card with the table named, and nothing is written or started', async () => {
  const gone = '[TABLE_OR_VIEW_NOT_FOUND] The table or view `main`.`s`.`returns_old` cannot be found. Verify the spelling. SQLSTATE: 42P01';
  const assets = { ...V3_ASSETS, ai_reasoning: ready(3, { vibes_checks: checks(['One sentence per decision', 'missing', 'Some reasons run to three sentences']) }) };
  const lost = versionRow(3, { outputs: V3_OUTPUTS, assets, status: 'ready_with_warnings', top: { data: { ...builtSpec().data, tables: { 'main.s.returns': 'main.s.returns_old' } } } });
  const ui = await openTower({ ...STATE, history: [lost, ...HISTORY.slice(1)], probeErrors: { '`main`.`s`.`returns_old`': gone } });
  const { page, made } = ui;
  try {
    const card = await pick(page, 'ai_reasoning');
    await card.getByRole('button', { name: 'Try again with the missing thing', exact: true }).click();
    const alert = card.getByRole('alert');
    await alert.waitFor();
    assert.equal((await alert.textContent()).trim(), 'the preview cannot run because these source tables are missing or not readable: main.s.returns_old (not found). '
      + 'Open Edit, Data step, to swap each for a table with the same role or remove it');
    assert.equal(made.jobs.length, 0);
    assert.deepEqual(insertsOf(made), []);
  } finally {
    await ui.close();
  }
});

test('a Try again on a part the build no longer has is refused with a clear message on its card, and nothing is written or started', async () => {
  const ui = await openTower();
  const { page, made } = ui;
  try {
    const card = await pick(page, CHART);
    const { [CHART]: _gone, ...rest } = V3_ASSETS;
    made.state.history = [{ ...HISTORY[0], asset_status: JSON.stringify(rest) }, ...HISTORY.slice(1)];
    await card.getByRole('button', { name: 'Try again with the missing thing', exact: true }).click();
    const alert = card.getByRole('alert');
    await alert.waitFor();
    assert.equal((await alert.textContent()).trim(), NOT_BUILT);
    assert.equal(made.jobs.length, 0);
    assert.deepEqual(insertsOf(made), []);
    await showTab(page, 'notebook');
    assert.equal(await panel(page).getByRole('alert').count(), 0, 'another tab does not carry the card error');
    assert.deepEqual(ui.pageErrors.filter((e) => !/status of 400/.test(e)), []);
  } finally {
    await ui.close();
  }
});

test('the name, its percent and the tabs stay pinned while the page scrolls, the use case list stays in view and resizes, and its width survives a reload', async () => {
  const ui = await openTower();
  const { page } = ui;
  try {
    await page.setViewportSize({ width: 1440, height: 520 });
    const name = page.locator('[data-pinned-name]');
    const tabs = page.locator('[data-pinned-tabs]');
    const rail = page.locator('[data-implement-rail]');
    assert.equal(await name.locator('[data-pinned-percent]').textContent(), '100% built');
    const past = await tabs.evaluate((el) => {
      const goal = el.getBoundingClientRect().top + window.scrollY - 104 + 60;
      return { goal, room: document.scrollingElement.scrollHeight - window.innerHeight };
    });
    assert.ok(past.room >= past.goal, `the page can scroll past the tabs (${JSON.stringify(past)})`);
    await page.evaluate((y) => window.scrollTo(0, y), past.goal);
    await page.waitForFunction((y) => Math.round(window.scrollY) === Math.round(y), past.goal);
    await painted(page);
    const at = async (el) => (await el.boundingBox()).y;
    assert.equal(await page.evaluate(() => Math.round(window.scrollY)), Math.round(past.goal), 'the page scrolled 60 px past where the tabs sit');
    assert.ok(Math.abs(await at(name) - 56) <= 1, `the name sits under the header (${await at(name)})`);
    assert.ok(Math.abs(await at(tabs) - 104) <= 1, `the tabs sit under the name (${await at(tabs)})`);
    assert.ok(Math.abs(await at(rail) - 72) <= 1, `the use case list stays in view (${await at(rail)})`);
    assert.equal(await name.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), true, 'the name keeps to one line');

    const handle = page.getByRole('separator', { name: 'Resize the use case list' });
    assert.equal(await handle.getAttribute('aria-valuenow'), '320');
    const width = async () => Math.round((await rail.boundingBox()).width);
    assert.equal(await width(), 320);
    await handle.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    assert.equal(await width(), 352, 'the arrow keys resize it in 16 px steps');
    await page.keyboard.press('End');
    assert.equal(await width(), 520, 'never wider than 520 px');
    const grip = await handle.boundingBox();
    await page.mouse.move(grip.x + grip.width / 2, grip.y + 40);
    await page.mouse.down();
    await page.mouse.move(grip.x + grip.width / 2 - 600, grip.y + 40, { steps: 6 });
    await page.mouse.up();
    assert.equal(await width(), 240, 'dragging is held at 240 px');
    await page.keyboard.press('ArrowRight');
    assert.equal(await handle.getAttribute('aria-valuenow'), '256');
    await page.reload();
    await page.locator('[data-implement-rail]').waitFor();
    assert.equal(await width(), 256, 'the width it was left at comes back');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('on a phone the use case list sits above the use case, which keeps the width of the screen, and the list has no resize handle', async () => {
  const ui = await openTower();
  const { page } = ui;
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    const rail = page.locator('[data-implement-rail]');
    const pane = page.getByRole('region', { name: 'Use case', exact: true });
    await page.locator('[data-mvp-panel]').waitFor();
    const box = async (el) => el.boundingBox();
    const [list, detail] = [await box(rail), await box(pane)];
    assert.ok(detail.width >= 330, `the use case is as wide as the screen allows (${Math.round(detail.width)} px)`);
    assert.ok(Math.abs(list.width - detail.width) <= 1, `the list is as wide as the use case (${Math.round(list.width)} px)`);
    assert.ok(list.y + list.height <= detail.y, 'the list sits above the use case');
    assert.ok(list.height <= 844 / 2 + 1, `the list takes at most half the screen (${Math.round(list.height)} px)`);
    assert.equal(await page.getByRole('separator', { name: 'Resize the use case list' }).isVisible(), false, 'nothing to resize on a phone');
    const scroll = await page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1);
    assert.equal(scroll, true, 'the page never scrolls sideways');
    await page.setViewportSize({ width: 1440, height: 900 });
    assert.equal(Math.round((await box(rail)).width), 320, 'a wide screen puts the list back beside the use case at its width');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a use case that is building sits at the top of the list and pulses in color, and holds still for a person who asked for less motion', async () => {
  const building = versionRow(4, {
    status: 'building_outputs', implement_run_id: '5555555555555555', updated_at: new Date().toISOString(), change_classes: 'retry',
    outputs: V3_OUTPUTS, top: { retry_outputs: ['genie_space'] }, assets: {},
  });
  const ui = await openTower({ ...STATE, history: [building, ...HISTORY], implementRun: { run_id: 5555555555555555, state: { life_cycle_state: 'RUNNING' } } });
  const { page } = ui;
  try {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const list = page.getByRole('navigation', { name: 'Use cases' });
    assert.equal(await list.locator('section').first().getAttribute('aria-label'), 'In progress', 'the building group is first');
    const item = list.getByRole('region', { name: 'In progress' }).locator('[data-building]');
    assert.equal(await item.count(), 1, 'the use case that builds is in it');
    await item.waitFor();
    assert.equal(await item.evaluate((el) => getComputedStyle(el).animationName), 'railBuilding');
    const shades = new Set(await item.evaluate((el) => {
      const pulse = el.getAnimations().find((a) => a.animationName === 'railBuilding');
      const length = pulse.effect.getComputedTiming().duration;
      pulse.pause();
      return [0, 0.25, 0.5, 0.75].map((share) => {
        pulse.currentTime = length * share;
        return getComputedStyle(el).backgroundColor;
      });
    }));
    assert.ok(shades.size >= 2, `its color changes while it builds (${[...shades].join(' | ')})`);
    assert.equal(await list.getByRole('region', { name: 'Ready' }).locator('[data-building]').count(), 0, 'nothing that is done pulses');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await item.evaluate((el) => getComputedStyle(el).animationName), 'none');
    assert.notEqual(await item.evaluate((el) => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)', 'it keeps a still tint so it still stands out');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
