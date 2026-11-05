import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { defaultSpecFromUseCase } from '../../src/lib/implementWizard.js';
import { HARNESS_INSPIRE_URL, HARNESS_USE_CASE, HARNESS_SETTINGS, HARNESS_SESSION_ID, MVP_JOB } from './implementFixtures.js';
import { closeAsset, closeBrowser, expandBuild, featuresBox, featuresHeld, featuresText, lowContrast, openAsset, openFeatures, openSettings, openUi, painted, setDark, shot, until } from './uiSupport.mjs';

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
const TILE_ORDER = ['app', 'dashboard', 'genie_space', 'alert', 'notebook', 'job'];
const panel = (page) => page.locator('[data-mvp-panel]');
const partsOf = (page) => panel(page).getByRole('tablist', { name: 'Pick a part', exact: true });
const features = (page) => page.locator('[data-vibe-features]');
async function showAsset(page, output) {
  if (output !== 'build') {
    await openAsset(page, output);
    return;
  }
  if (await panel(page).count()) await closeAsset(page);
}
async function pick(page, id) {
  await showAsset(page, OUTPUT_OF(id));
  const part = partsOf(page).locator(`[data-tab="${id}"]`);
  if (await part.count()) await part.click();
  const card = panel(page).locator(`[data-vibe-card="${id}"]`);
  await card.waitFor();
  return card;
}
const picked = (page, id) => panel(page).locator(`[data-vibe-card="${id}"]`);
const dialog = (page) => page.locator('[data-vibe-features-dialog]');
const vibeBox = featuresBox;
const mvpBox = featuresText;
const addVibes = (page) => vibeBox(page).getByRole('button', { name: 'Add vibe', exact: true });
const rebuildButton = (page) => dialog(page).locator('[data-rebuild]');
const waiting = (page) => dialog(page).locator('[data-waiting]').evaluateAll((items) => items.map((li) => [li.dataset.waiting, li.querySelector('span').textContent]));
const heldOf = featuresHeld;
const text = async (el) => (await el.textContent()).trim();
const storedVibes = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('inspire.collected_vibes.v1') || '{}'));

async function openTower(state = STATE, { expand = true } = {}) {
  const ui = await openUi('implement', state);
  try {
    await ui.page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    await ui.page.locator('[data-asset-tiles]').waitFor({ timeout: 15000 });
    await openAsset(ui.page, 'job');
    await ui.page.getByRole('region', { name: 'History', exact: true }).getByText(/^\d+ spec versions? · /).waitFor({ timeout: 15000 });
    await closeAsset(ui.page);
    if (expand) await expandBuild(ui.page);
  } catch (e) {
    await ui.close();
    throw e;
  }
  return ui;
}

test('the build page has one tile per asset in a fixed order; each asset opens a drawer that lists only its own parts with their pills, the first is picked, and picking another shows it', async () => {
  const ui = await openTower();
  const { page } = ui;
  try {
    assert.deepEqual(await page.locator('[data-asset-tiles] [data-asset-tile]').evaluateAll((tiles) => tiles.map((t) => t.dataset.assetTile)), TILE_ORDER);
    assert.equal(await page.getByRole('tablist', { name: 'MVP views' }).count(), 0, 'the tiles replace the tabs');
    assert.equal(await panel(page).count(), 0, 'no drawer until a tile opens one');
    assert.equal(await page.getByRole('dialog').count(), 0);
    await showAsset(page, 'app');
    assert.deepEqual(await partsOf(page).getByRole('tab').evaluateAll((items) => items.map((b) => [b.dataset.tab, b.getAttribute('aria-label'), b.getAttribute('aria-selected')])), [
      ['app', 'The whole App, Ready', 'true'], [PAGE, 'Page: Decisions, Ready', 'false'], ['app:page:detail', 'Page: Row detail, Ready', 'false'],
    ], 'the whole App first, picked from the start, then one tab per page of this App only');
    const whole = picked(page, 'app');
    assert.equal(await whole.getByRole('heading').textContent(), 'The whole App');
    assert.equal(await panel(page).locator('textarea').count(), 0, 'no part has a vibe box of its own');
    const live = panel(page).locator('[data-asset-panel="app"]');
    await live.getByRole('link', { name: /^Open/ }).waitFor();
    await live.getByRole('button', { name: 'Uninstall', exact: true }).waitFor();
    await showAsset(page, 'genie_space');
    const agent = panel(page).locator('[data-asset-panel="genie_space"]');
    assert.equal(await agent.getByRole('button', { name: 'Uninstall', exact: true }).isDisabled(), true, 'the Agent waits for the App that asks it');
    assert.match(await agent.locator('[data-uninstall-blocked]').textContent(), /Uninstall the App first\.$/);
    await showAsset(page, 'app');
    const card = await pick(page, PAGE);
    const part = panel(page).getByRole('tabpanel');
    assert.equal(await part.getAttribute('aria-labelledby'), await partsOf(page).locator(`[data-tab="${PAGE}"]`).getAttribute('id'), 'the card is the picked part\'s panel');
    assert.equal(await part.locator(`[data-vibe-card="${PAGE}"]`).count(), 1);
    assert.equal(await card.getByRole('heading').textContent(), 'Page: Decisions');
    await card.getByText('The rows to act on, with their filters', { exact: true }).waitFor();
    assert.match(await card.locator('[data-live]').textContent(), /^Version 3, built .+/);
    assert.equal(await card.locator('[data-built-with], [data-held-ask]').count(), 0, 'the asks a part holds are listed in Vibe/Add/Remove Features, not on the part');
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
      await showAsset(page, output);
      await panel(page).locator(`[data-vibe-card="${first}"]`).waitFor();
      parts[output] = await partsOf(page).getByRole('tab').evaluateAll((items) => items.map((b) => b.getAttribute('aria-label')));
      assert.equal(await panel(page).locator('[data-vibe-card]').count(), 1, `${output}: one card at a time`);
    }
    assert.deepEqual(parts, {
      notebook: ['Notebook, Ready', 'AI reasoning, Ready', 'Money at stake, Ready'],
      dashboard: ['The whole dashboard, Ready with warnings', 'Chart: Weekly trend, Ready with warnings'], genie_space: [], alert: [],
    }, 'a tab with one part shows its card with no picker, and the whole dashboard comes before its charts');

    for (const [id, built] of [['genie_space', /^Version 1, built /], ['value_formula', /^Version 2, built /], ['ai_reasoning', /^Version 2, built /], [CHART, /^Version 3, built /]]) {
      const shown = await pick(page, id);
      assert.match(await shown.locator('[data-live]').textContent(), built, id);
      assert.equal(await shown.locator('textarea').count(), 0, id);
    }
    await openFeatures(page);
    const held = await dialog(page).locator('[data-built-with] ul').evaluateAll((lists) => lists.map((ul) => [ul.getAttribute('aria-label'), ul.querySelectorAll('[data-held-ask]').length]));
    assert.deepEqual(held, [['Asks the Decisions page holds', 2], ['Asks the Dashboard holds', 2], ['Asks the Weekly trend chart holds', 2], ['Asks the Genie Agent holds', 1]],
      'Built with lists the asks each part holds, part by part');
    assert.deepEqual(await heldOf(page, 'Decisions page'), [['held', 'Decisions page: “Dark header”'], ['held', 'Decisions page: “Rows to act on first”']]);
    assert.deepEqual(await dialog(page).getByRole('list', { name: 'Asks the Decisions page holds' }).locator('button').allTextContents(), [' Remove', ' Remove'], 'each held ask can be removed');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the Features drawer says plainly which waiting ask Inspire will not build, which is too vague and which two conflict, and Rebuild sends nothing while an unsafe ask waits', async () => {
  const ui = await openTower();
  const { page, made } = ui;
  try {
    await showAsset(page, 'build');
    await openFeatures(page);
    const asks = ['delete source rows from samples.tpch.lineitem', 'call https://api.exchangerate.host', 'make it better',
      'Show the top 10 zip codes as a bar chart', 'Remove the bar chart of the top 10 zip codes', 'Put the rows to act on first'];
    for (const ask of asks) {
      await mvpBox(page).fill(ask);
      await addVibes(page).click();
    }
    const notes = await dialog(page).locator('[data-waiting]').evaluateAll((items) => items.map((li) => [...li.querySelectorAll('[data-vibe-limit]')].map((n) => n.dataset.vibeLimit)));
    assert.deepEqual(notes, [['refused'], ['refused'], ['vague'], [], ['conflict'], []]);
    const said = await dialog(page).locator('[data-vibe-limit]').allTextContents();
    assert.match(said[0], /^Not built: Inspire never changes or deletes your source data/);
    assert.match(said[1], /^Not built: Inspire MVPs run inside your Databricks workspace and never call outside websites/);
    assert.match(said[2], /^Too vague: Say what to change/);
    assert.match(said[3], /^Conflict: “Show the top 10 zip codes as a bar chart” and “Remove the bar chart of the top 10 zip codes” ask for opposite things/);
    const choice = dialog(page).locator('[data-vibe-previous] input');
    if (await choice.count()) await choice.first().check();
    await rebuildButton(page).click();
    await dialog(page).getByRole('alert').filter({ hasText: /^Rebuild needs one more thing: take out the 2 asks Inspire does not build first: / }).waitFor();
    assert.equal(made.jobs.length, 0, 'nothing starts');
    assert.deepEqual(insertsOf(made), [], 'and nothing is written');
  } finally {
    await ui.close();
  }
});

test('Vibe/Add/Remove Features opens one tall box for the whole use case: Add vibe keeps an ask in this browser, spaces, a repeat and an ask over the limit add nothing, nothing is written or started, the button counts it, and Take it out lets it go', async () => {
  const ui = await openTower();
  const { page, made } = ui;
  try {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    for (const output of TILE_ORDER) {
      await showAsset(page, output);
      assert.equal(await panel(page).locator('textarea').count(), 0, `${output}: no drawer has a vibe box of its own`);
      assert.equal(await panel(page).getByRole('button', { name: /^Add vibes?$/ }).count(), 0, `${output}: and no Add vibe`);
    }
    await showAsset(page, 'build');
    assert.equal(await page.locator('textarea').count(), 0, 'no vibe box on the page itself');
    assert.equal(await text(features(page)), 'Vibe/Add/Remove Features (0)');
    assert.equal(await features(page).getAttribute('data-collected'), '0');
    assert.doesNotMatch(await features(page).getAttribute('class'), /edit-mvp-invite/, 'no invitation while nothing waits');
    await openFeatures(page);
    await dialog(page).getByRole('heading', { name: `Vibe/Add/Remove Features: ${HARNESS_USE_CASE.Name}`, exact: true }).waitFor();
    assert.equal(await dialog(page).locator('textarea').count(), 1, 'one box for the whole use case');
    const size = await mvpBox(page).evaluate((el) => ({ height: el.getBoundingClientRect().height, resize: getComputedStyle(el).resize }));
    assert.ok(size.height >= 220, `the box is at least 220 px tall (${size.height})`);
    assert.equal(size.resize, 'vertical', 'and the person can make it taller');
    assert.equal(await mvpBox(page).getAttribute('placeholder'), 'For example: put the rows to act on first on the App, answer in euros in the Genie Agent, and count returns by week');
    await dialog(page).getByText('No changes waiting yet.', { exact: true }).waitFor();
    assert.equal(await text(rebuildButton(page)), 'Rebuild', 'with nothing waiting the primary is plain Rebuild');
    await mvpBox(page).fill('   ');
    assert.equal(await addVibes(page).isDisabled(), true, 'only spaces is nothing to add');
    await mvpBox(page).fill('Put the rows to act on first');
    await addVibes(page).click();
    assert.equal(await mvpBox(page).inputValue(), '', 'the box empties for the next ask');
    assert.deepEqual(await waiting(page), [['ask', '“Put the rows to act on first”']]);
    assert.equal(await text(rebuildButton(page)), 'Rebuild with 1 vibe');
    assert.deepEqual(Object.values(await storedVibes(page)), [[{ kind: 'ask', text: 'Put the rows to act on first' }]]);
    assert.equal(made.jobs.length, 0, 'adding an ask starts nothing');
    assert.deepEqual(insertsOf(made), [], 'and writes nothing');
    await mvpBox(page).fill('put the rows to act on FIRST');
    await addVibes(page).click();
    assert.deepEqual(await waiting(page), [['ask', '“Put the rows to act on first”']], 'the same ask twice is kept once');

    await closeAsset(page);
    assert.equal(await text(features(page)), 'Vibe/Add/Remove Features (1)');
    assert.equal(await features(page).getAttribute('data-collected'), '1');
    assert.match(await features(page).getAttribute('class'), /edit-mvp-invite/);
    assert.equal(await features(page).evaluate((el) => getComputedStyle(el).animationName), 'editMvpInvite', 'the button pulses to invite the click');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await features(page).evaluate((el) => getComputedStyle(el).animationName), 'none', 'no pulse for a person who asked for less motion');
    assert.notEqual(await features(page).evaluate((el) => getComputedStyle(el).boxShadow), 'none', 'it still stands out with a still ring');

    await openFeatures(page);
    await dialog(page).getByRole('button', { name: 'Take it out', exact: true }).click();
    await dialog(page).getByText('No changes waiting yet.', { exact: true }).waitFor();
    assert.equal(await features(page).getAttribute('data-collected'), '0');
    assert.deepEqual(await storedVibes(page), {}, 'the browser keeps nothing once the last ask is taken out');

    await mvpBox(page).fill('x'.repeat(2001));
    await vibeBox(page).getByText('the MVP vibes are 2001 characters; at most 2000 are allowed').waitFor();
    assert.equal(await addVibes(page).isDisabled(), true, 'an ask over the limit cannot be added');
    await mvpBox(page).fill('a'.repeat(1500));
    await addVibes(page).click();
    await mvpBox(page).fill('b'.repeat(600));
    await vibeBox(page).getByText('with the asks waiting, the MVP vibes would be 2101 characters; at most 2000 are allowed', { exact: true }).waitFor();
    assert.equal(await addVibes(page).isDisabled(), true, 'the asks waiting and the new one must fit the one box a build sends');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the asks you add and the held asks you remove survive a reload; Rebuild with N vibes asks what happens to the live version, then builds them all in one version with the removals applied', async () => {
  const ui = await openTower();
  const { page, made } = ui;
  try {
    await openFeatures(page);
    await mvpBox(page).fill('  Put the rows to act on first,\n  then a map by region  ');
    await addVibes(page).click();
    await mvpBox(page).fill('Show the last 12 weeks');
    await addVibes(page).click();
    await dialog(page).getByRole('button', { name: 'Remove “Arabic labels”', exact: true }).click();
    await page.reload();
    await features(page).and(page.locator('[data-collected="3"]')).waitFor({ timeout: 15000 });
    assert.equal(await text(features(page)), 'Vibe/Add/Remove Features (3)');
    await openFeatures(page);
    assert.deepEqual(await waiting(page), [['ask', '“Put the rows to act on first,\n  then a map by region”'], ['ask', '“Show the last 12 weeks”'],
      ['remove', 'Take out of the Dashboard: “Arabic labels”']], 'the browser kept them');
    assert.deepEqual(await heldOf(page, 'Dashboard'), [['held', 'Dashboard: “Put the weekly trend first”'],
      ['removing', 'Dashboard: “Arabic labels”, taken out on the next build']]);
    assert.equal(await text(rebuildButton(page)), 'Rebuild with 3 vibes');
    const choice = dialog(page).getByRole('group', { name: 'What happens to v3?' });
    await choice.getByRole('radio', { name: /^Keep v3 live/ }).waitFor();
    await rebuildButton(page).click();
    const problem = dialog(page).getByRole('alert');
    await problem.waitFor();
    assert.equal(await text(problem), 'Rebuild needs one more thing: choose what happens to v3, the version before this vibe: keep it live or remove it.');
    assert.equal(made.jobs.length, 0, 'nothing is built until the choice is made');
    await choice.getByRole('radio', { name: /^Remove v3 once v4 is ready/ }).check();
    await rebuildButton(page).click();
    await until(() => made.jobs.length === 1, 'the build with every ask');
    const [built] = insertsOf(made);
    assert.deepEqual([built.spec.vibes, built.spec.vibe_previous], ['Put the rows to act on first,\nthen a map by region\nShow the last 12 weeks', 'remove']);
    assert.equal(built.spec.outputs.dashboard_vibes, 'Put the weekly trend first', 'the removed ask leaves the part that held it');
    for (const key of ['genie_space_vibes', `${PAGE}_vibes`, `${CHART}_vibes`]) assert.equal(built.spec.outputs[key], V3_OUTPUTS[key], `${key} is carried as it was`);
    assert.ok(built.classes.split(',').includes('vibe'), built.classes);
    await dialog(page).waitFor({ state: 'detached' });
    await features(page).and(page.locator('[data-collected="0"]')).waitFor({ timeout: 15000 });
    assert.deepEqual(await storedVibes(page), {}, 'a build that took them clears them');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Rebuild takes the asks it sends out of Changes waiting at the click, before the build answers, and puts them back when it fails', async () => {
  const ui = await openTower();
  const { page, made } = ui;
  try {
    let release = () => {};
    const held = new Promise((resolve) => { release = resolve; });
    let fail = true;
    await page.route('**/api/inspire/implement/submit', async (route) => {
      await held;
      if (fail) await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'the warehouse is stopped' }) });
      else await route.continue();
    });
    await openFeatures(page);
    await mvpBox(page).fill('Show the last 12 weeks');
    await addVibes(page).click();
    const choice = dialog(page).getByRole('group', { name: 'What happens to v3?' });
    await choice.getByRole('radio', { name: /^Keep v3 live/ }).check();
    await rebuildButton(page).click();
    await features(page).and(page.locator('[data-collected="0"]')).waitFor({ timeout: 15000 });
    assert.equal(made.jobs.length, 0, 'the build has not answered yet');
    release();
    await features(page).and(page.locator('[data-collected="1"]')).waitFor({ timeout: 15000 });
    assert.deepEqual(Object.values(await storedVibes(page)), [[{ kind: 'ask', text: 'Show the last 12 weeks' }]], 'a failed build keeps the ask');
    fail = false;
    await rebuildButton(page).click();
    await until(() => made.jobs.length === 1, 'the build with the ask');
    await features(page).and(page.locator('[data-collected="0"]')).waitFor({ timeout: 15000 });
  } finally {
    await ui.close();
  }
});

test('closing Vibe/Add/Remove Features or the settings it opens without building keeps every ask you added, and Open all settings carries them to the Vibes step', async () => {
  const ui = await openTower();
  const { page, made } = ui;
  try {
    await openFeatures(page);
    await mvpBox(page).fill('Answer in Arabic');
    await addVibes(page).click();
    await closeAsset(page);
    assert.equal(await features(page).getAttribute('data-collected'), '1');
    const wizard = await openSettings(page);
    assert.equal(await wizard.getByRole('textbox', { name: 'Vibes for the MVP', exact: true }).inputValue(), 'Answer in Arabic');
    await wizard.getByRole('button', { name: 'Close', exact: true }).click();
    await wizard.waitFor({ state: 'detached' });
    assert.equal(await features(page).getAttribute('data-collected'), '1');
    assert.equal(Object.values(await storedVibes(page))[0][0].text, 'Answer in Arabic');
    assert.equal(made.jobs.length, 0);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Built with lists the asks each part holds with Remove on each: a removed ask waits for the next build, Keep it brings it back, and Rebuild takes it out of that part alone', async () => {
  const ui = await openTower();
  const { page, made } = ui;
  try {
    await openFeatures(page);
    assert.deepEqual(await heldOf(page, 'Weekly trend chart'), [['held', 'Weekly trend chart: “Bars by week”'], ['held', 'Weekly trend chart: “A map by region”']]);
    await dialog(page).getByRole('button', { name: 'Remove “A map by region”', exact: true }).click();
    assert.deepEqual((await heldOf(page, 'Weekly trend chart')).map(([state]) => state), ['held', 'removing']);
    assert.deepEqual(await waiting(page), [['remove', 'Take out of the Weekly trend chart: “A map by region”']]);
    assert.equal(await text(features(page)), 'Vibe/Add/Remove Features (1)');
    assert.deepEqual(Object.values(await storedVibes(page)), [[{ kind: 'remove', id: CHART, label: 'Weekly trend chart', text: 'A map by region' }]]);
    assert.deepEqual([made.jobs.length, insertsOf(made).length], [0, 0], 'Remove writes nothing until Rebuild');
    await dialog(page).getByRole('button', { name: 'Keep “A map by region”', exact: true }).click();
    assert.deepEqual((await heldOf(page, 'Weekly trend chart')).map(([state]) => state), ['held', 'held']);
    assert.equal(await features(page).getAttribute('data-collected'), '0');

    await dialog(page).getByRole('button', { name: 'Remove “A map by region”', exact: true }).click();
    assert.equal(await text(rebuildButton(page)), 'Rebuild with 1 vibe');
    assert.equal(await dialog(page).getByRole('group', { name: 'What happens to v3?' }).count(), 0, 'no new ask, so no choice for the live version');
    await rebuildButton(page).click();
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

test('Built with reads the agent verdict per ask: an ask whose part failed to publish waits with the plain reason, and the badge never says ready', async () => {
  const reason = 'built and checked, but not published: Genie built it in v3 and its checks passed, but publishing the Dashboard failed, so the live '
    + 'Dashboard does not have it and the ask waits for the next build: no filter reaches chart w1a2b3c4';
  const row = versionRow(3, { outputs: V3_OUTPUTS, status: 'ready_with_warnings', assets: { ...V3_ASSETS, checklist: [
    { n: 1, requirement: 'Bars by week', part: 'dashboard', status: 'met', evidence: 'Checked by running the rebuilt chart query' },
    { n: 2, requirement: 'A map by region', part: 'dashboard', status: 'not_met', evidence: reason }], checklist_summary: { met: 1, total: 2 } } });
  const ui = await openTower({ ...STATE, history: [row, ...HISTORY.slice(1)] });
  const { page } = ui;
  try {
    assert.equal(await page.getByText('MVP ready with warnings', { exact: true }).count(), 0, 'an ask not met never reads as ready');
    await openFeatures(page);
    const held = await heldOf(page, 'Weekly trend chart');
    assert.deepEqual(held.map(([state]) => state), ['held', 'waiting']);
    assert.ok(held[1][1].includes(`Not in the live Weekly trend chart yet, it waits for the next build: ${reason}`), held[1][1]);
    assert.ok(!held[0][1].includes('Not in the live'), 'the met ask reads as built');
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

test('while a version rebuilds the picked asset, it reads Rebuilding with the three steps, Rebuild waits greyed with the reason, and a vibe can still be added for later', async () => {
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
    assert.equal(await card.locator('[data-checks]').count(), 0, 'the checklist comes back once the build ends');
    const detail = await pick(page, 'app:page:detail');
    await detail.getByText('A version is building now; roll backs apply after it finishes.').waitFor();
    await openFeatures(page);
    assert.equal(await rebuildButton(page).isDisabled(), true, 'Rebuild waits for the build');
    assert.match(await rebuildButton(page).getAttribute('class'), /cursor-not-allowed/, 'and reads greyed');
    assert.equal(await rebuildButton(page).getAttribute('title'), 'A build is running. Vibes you add wait for the next build.');
    assert.equal(await text(dialog(page).locator('[data-rebuild-waits]')), 'A build is running. Vibes you add wait for the next build.');
    await mvpBox(page).fill('Add a filter by region');
    await addVibes(page).click();
    assert.deepEqual(await waiting(page), [['ask', '“Add a filter by region”']], 'the ask waits for the next build');
    assert.equal(await rebuildButton(page).isDisabled(), true);
    await closeAsset(page);
    assert.equal(await text(features(page)), 'Vibe/Add/Remove Features (1)');
    assert.doesNotMatch(await features(page).getAttribute('class'), /edit-mvp-invite/, 'no invitation while the build runs');
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
    const off = page.locator('[data-asset-tile="app"][data-tile-kind="off"]');
    await off.getByText('Not in this MVP', { exact: true }).waitFor();
    assert.equal(await off.locator('[data-asset-note]').textContent(),
      "This use case's pages were taken out of sales-hub, which stays for Forecast demand and Score leads.");
    for (const dark of [false, true]) {
      await setDark(page, dark);
      const result = await lowContrast(page, ['[data-asset-tile="app"]']);
      assert.ok(result.checked >= 3, `measured ${result.checked} elements`);
      assert.deepEqual(result.low, [], dark ? 'dark' : 'light');
    }
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
    const alert = page.locator('[data-asset-tile="alert"][data-tile-kind="off"]');
    await alert.getByText('Not in this MVP', { exact: true }).waitFor();
    assert.equal(await alert.locator('[data-asset-note]').count(), 0, 'an alert this use case deleted was not taken out of anything');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the use case list sits on the left; on the right the name, then Use case details, Vibe/Add/Remove Features and Uninstall all, then one row of tiles, then Build progress filling the rest', async () => {
  const ui = await openTower();
  const { page } = ui;
  try {
    for (const [width, height] of [[1440, 900], [1920, 1080]]) {
      await page.setViewportSize({ width, height });
      await painted(page);
      const pane = page.getByRole('region', { name: 'Use case', exact: true });
      const [list, right] = [await page.locator('[data-implement-rail]').boundingBox(), await pane.boundingBox()];
      assert.ok(list.x + list.width <= right.x, `the list is left of the use case (${Math.round(list.x + list.width)} <= ${Math.round(right.x)})`);
      const name = pane.locator('[data-pinned-name]');
      assert.equal(await name.locator('h2').textContent(), HARNESS_USE_CASE.Name);
      assert.equal(await name.getByRole('progressbar').count(), 0, 'no progress bar while nothing builds');
      const buttons = await Promise.all(['Use case details', 'Vibe/Add/Remove Features (0)', 'Uninstall all']
        .map((label) => name.getByRole('button', { name: label, exact: true }).boundingBox()));
      assert.equal(await pane.getByRole('button', { name: /^Edit MVP/ }).count(), 0, 'Vibe/Add/Remove Features replaces Edit MVP');
      const [heading, tiles, progress] = await Promise.all([name.locator('h2'), pane.locator('[data-asset-tiles]'), pane.locator('[data-mvp-progress]')].map((el) => el.boundingBox()));
      assert.ok(buttons.every((b) => Math.abs(b.y - buttons[0].y) <= 1), 'the three buttons share one row');
      assert.ok(buttons[0].x < buttons[1].x && buttons[1].x < buttons[2].x, 'in the order Use case details, Vibe/Add/Remove Features, Uninstall all');
      assert.ok(heading.y < tiles.y && buttons[0].y + buttons[0].height <= tiles.y, 'the tiles sit below the header');
      const rows = new Set(await pane.locator('[data-asset-tile]').evaluateAll((items) => items.map((li) => Math.round(li.getBoundingClientRect().top))));
      assert.equal(rows.size, 1, `the six tiles share one row at ${width}`);
      assert.ok(tiles.y + tiles.height <= progress.y, 'Build progress sits below the tiles');
      assert.ok(Math.abs(progress.y + progress.height - (right.y + right.height)) <= 2, `Build progress fills the rest of the pane (${Math.round(progress.y + progress.height)} vs ${Math.round(right.y + right.height)})`);
      assert.equal(await page.evaluate(() => document.scrollingElement.scrollHeight <= window.innerHeight + 1), true, `no second page scrollbar at ${width}`);
    }
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('every tile opens its asset in a new tab and has its Versions and per-asset actions, a drawer never carries a vibe box, and the Notebook tile has its Uninstall', async () => {
  const ui = await openTower({ ...STATE, job: MVP_JOB, useCase: { ...HARNESS_USE_CASE, has_genie_code: 'Y', notebook_path: '/Users/owner@example.com/inspire/Acme/N01-U01' } });
  const { page } = ui;
  try {
    await page.locator('[data-asset-tile="notebook"] [data-tile-open="asset"]').waitFor({ timeout: 15000 });
    await page.locator('[data-asset-tile="job"] [data-tile-open="asset"]').waitFor({ timeout: 15000 });
    const seen = {};
    for (const id of TILE_ORDER) {
      const tile = page.locator(`[data-asset-tile="${id}"]`);
      const open = tile.locator('[data-tile-open="asset"]');
      seen[id] = {
        open: [await open.getAttribute('target'), Boolean(await open.getAttribute('href'))],
        versions: await tile.locator('[data-tile-versions]').count(),
        uninstall: await tile.locator('[data-tile-uninstall]').count(),
      };
      await showAsset(page, id);
      seen[id].box = await panel(page).locator('textarea').count();
      seen[id].add = await panel(page).getByRole('button', { name: /^Add vibes?$/ }).count();
    }
    const each = { open: ['_blank', true], versions: 1, uninstall: 1, box: 0, add: 0 };
    assert.deepEqual(seen, { app: each, dashboard: each, genie_space: each, alert: each, notebook: each, job: { ...each, uninstall: 0 } });
    assert.match(await page.locator('[data-asset-tile="job"] [data-tile-open="asset"]').getAttribute('href'), /#job\/77$/);
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
    await showAsset(page, 'dashboard');
    await page.locator('[data-asset-panel="dashboard"]').getByRole('button', { name: 'Uninstall', exact: true }).waitFor({ timeout: 15000 });
    await showAsset(page, 'app');
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
    await showAsset(page, 'app');
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
    assert.match(await app.getByRole('button', { name: 'Remove from sales-hub', exact: true }).getAttribute('class'), /\btext-error-fg\b/, 'a remove button is red again');

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

    await showAsset(page, 'dashboard');
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
    await showAsset(page, 'app');
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
  .evaluateAll((items) => items.map((li) => [li.dataset.stage, li.querySelector('[title]').title, li.dataset.stageState]));
const arrowsOf = (page) => page.locator('[data-mvp-progress] [aria-label="Build stages"] [data-stage-arrow]')
  .evaluateAll((items) => items.map((arrow) => arrow.dataset.stageArrow));

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
      ['Job', 'Vibe, Plan', 'done'], ['Notebook', 'Start Genie Code', 'done'], ['App', 'Rebuild the App', 'running'], ['Finish', 'Done', 'waiting'],
    ], 'only the planned stages, each a chip');
    assert.deepEqual(await arrowsOf(page), ['done', 'done', 'todo'], 'a dark arrow after each done stage, a grey one before what is still to come');
    for (const absent of ['Dashboard', 'Genie Agent', 'Alert', 'Plan', 'Vibe', 'Instruction', 'Genie build', 'Preview run']) {
      assert.equal(await progress.locator(`[data-stage="${absent}"]`).count(), 0, `the ${absent} stage must not show`);
    }
    const [stop, chips] = await Promise.all([progress.locator('[data-stop-build]'), progress.getByRole('list', { name: 'Build stages' })].map((el) => el.boundingBox()));
    assert.ok(stop.y + stop.height <= chips.y + 1, 'Stop the build sits at the top, above the stages');
    assert.equal(await text(progress.locator('[data-stop-build]')), 'Stop the build');
    assert.equal(await text(progress.locator('[data-sorted-to]')), 'This build carries 1 change. Inspire sorted it to: App.');
    const pulse = (id) => progress.locator(`[data-stage="${id}"] [class*="animate-pulse"]`);
    assert.deepEqual([await pulse('App').count(), await pulse('Job').count()], [1, 0], 'only the current stage pulses');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    assert.notEqual(await pulse('App').evaluate((el) => getComputedStyle(el).animationName), 'none');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await pulse('App').evaluate((el) => getComputedStyle(el).animationName), 'none', 'and holds still for a person who asked for less motion');
    await progress.locator('[data-build-headline]').getByText('Genie is rebuilding the App…', { exact: true }).waitFor();
    assert.equal(await text(progress.locator('[data-scope-note="kept"]')), 'Kept as is: the notebook, the Dashboard, the Genie Agent and the Alert');
    assert.equal(await progress.locator('[data-scope-note="refill"]').count(), 0, 'an App vibe never says the notebook is rebuilt');
    assert.equal(await text(progress.locator('[data-vibe-route="route"]')), `Sent to the App: “${VIBE}”`);
    assert.equal(await progress.locator('[data-vibe-route]').count(), 1, 'one line for the one ask, and no count of asks no part can do');

    const building = {};
    for (const id of ['app', 'dashboard', 'genie_space', 'alert']) {
      await page.waitForFunction((which) => document.querySelector(`[data-asset-tile="${which}"]`)?.dataset.tileKind === 'live', id, { timeout: 20000 });
      building[id] = await page.locator(`[data-asset-tile="${id}"]`).getAttribute('data-tile-building');
    }
    assert.deepEqual(building, { app: 'now', dashboard: null, genie_space: null, alert: null }, 'only the App tile is building');
    await page.locator('[data-asset-tile="app"] [data-tile-open="build"]').click();
    assert.equal(await panel(page).count(), 0, 'a building tile shows Build progress, not a drawer');
    await showAsset(page, 'app');
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
    await progress.locator('[data-stage="Job"][data-stage-state="running"]').waitFor({ timeout: 15000 });
    assert.deepEqual(await stagesOf(page), [['Job', 'Vibe, Plan', 'running']], 'never the full list');
    await progress.locator('[data-build-headline]').getByText('Inspire is reading your vibe to send each ask to the part it changes…', { exact: true }).waitFor();
    assert.equal(await page.getByRole('progressbar', { name: 'Build progress' }).getAttribute('aria-valuenow'), '0');
    await page.waitForFunction(() => document.querySelector('[data-asset-tile="dashboard"]')?.dataset.tileKind === 'live', null, { timeout: 20000 });
    assert.equal(await page.locator('[data-asset-tile="dashboard"]').getAttribute('data-tile-building'), null);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('when Inspire puts back what no ask targets, the stepper shows the Self-fix stage in Finish, before Done, and the live checklist reads it in green', async () => {
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
    await progress.locator('[data-stage="App"][data-stage-state="done"]').waitFor({ timeout: 15000 });
    assert.deepEqual(await stagesOf(page), [
      ['Job', 'Vibe, Plan', 'done'], ['Notebook', 'Start Genie Code', 'done'], ['App', 'Rebuild the App', 'done'], ['Finish', 'Self-fix, Done', 'next'],
    ], 'the Self-fix stage sits in Finish, before Done');
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
    await showAsset(page, 'notebook');
    assert.equal(await panel(page).getByRole('alert').count(), 0, 'another tab does not carry the card error');
    assert.deepEqual(ui.pageErrors.filter((e) => !/status of 400/.test(e)), []);
  } finally {
    await ui.close();
  }
});

test('the name and the tiles stay in view while the Genie feed scrolls inside Build progress, the use case list stays in view and resizes, and its width survives a reload', async () => {
  const ui = await openTower();
  const { page } = ui;
  try {
    await page.setViewportSize({ width: 1440, height: 520 });
    const name = page.locator('[data-pinned-name]');
    const tiles = page.locator('[data-asset-tiles]');
    const rail = page.locator('[data-implement-rail]');
    const log = page.locator('[data-mvp-progress] [data-build-log]');
    await painted(page);
    const before = await Promise.all([name, tiles, rail].map(async (el) => (await el.boundingBox()).y));
    const room = await log.evaluate((el) => {
      el.append(Object.assign(document.createElement('div'), { style: 'height:2000px' }));
      el.scrollTop = 600;
      return { top: el.scrollTop, page: document.scrollingElement.scrollHeight - window.innerHeight, overflow: getComputedStyle(el).overflowY };
    });
    await painted(page);
    assert.deepEqual([room.top, room.overflow], [600, 'auto'], 'the feed scrolls inside Build progress');
    assert.ok(room.page <= 1, `the page itself never grows a second scrollbar (${room.page})`);
    const after = await Promise.all([name, tiles, rail].map(async (el) => (await el.boundingBox()).y));
    assert.deepEqual(after, before, 'the name, the tiles and the use case list stay where they are');
    assert.equal(await name.locator('h2').evaluate((el) => el.scrollWidth <= el.clientWidth + 1), true, 'the name keeps to one line');

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
    await page.locator('[data-asset-tiles]').waitFor();
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
    assert.equal(await list.locator('section').first().getAttribute('aria-label'), 'Building', 'the building group is first');
    const item = list.getByRole('region', { name: 'Building' }).locator('[data-building]');
    assert.equal(await item.count(), 1, 'the use case that builds is in it');
    await item.waitFor();
    await page.waitForFunction(() => {
      const rail = document.querySelector('[data-building] [data-rail-progress]')?.dataset.railProgress;
      return rail && `${rail}%` === document.querySelector('[data-progress-percent]')?.textContent.trim();
    }, null, { timeout: 15000 });
    const step = await page.locator('[data-progress-step]').textContent();
    assert.ok(step && (await item.locator('[data-rail-progress]').textContent()).includes(step.replace(/…$/, '')), 'the list shows the step the progress bar shows');
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

const tileClass = (page, id) => page.locator(`[data-asset-tile="${id}"]`).getAttribute('class');
const animatedTiles = (page) => page.locator('[data-asset-tiles] [data-asset-tile]')
  .evaluateAll((tiles) => tiles.filter((t) => t.classList.contains('asset-building')).map((t) => t.dataset.assetTile));

test('while the plan runs, the Job card alone glows with a moving border and a spinner, the line starts at Job with no Plan chip, and less motion holds it still', async () => {
  const run = { run_id: 5555555555555555, state: { life_cycle_state: 'RUNNING' } };
  const ui = await openTower({ ...STATE, history: [vibeVersion('queued'), ...HISTORY], steps: [stepRow('Vibe', 'started', 5, { spec_version: 4 })], implementRun: run });
  const { page } = ui;
  try {
    const progress = page.locator('[data-mvp-progress]');
    await progress.locator('[data-stage="Job"][data-stage-state="running"]').waitFor({ timeout: 15000 });
    assert.equal(await progress.locator('[data-stage="Plan"]').count(), 0, 'the plan is the job being built');
    assert.deepEqual(await stagesOf(page), [['Job', 'Vibe, Plan', 'running']]);
    await page.waitForFunction(() => document.querySelector('[data-asset-tile="dashboard"]')?.dataset.tileKind === 'live', null, { timeout: 20000 });
    assert.deepEqual(await animatedTiles(page), ['job'], 'only the card whose step is running animates');
    const job = page.locator('[data-asset-tile="job"]');
    assert.equal(await job.locator('[data-tile-spinner]').count(), 1);
    assert.equal(await job.getAttribute('data-tile-kind'), 'failed', 'this Job card could not be read');
    assert.equal(await job.locator('[data-tile-state]').textContent(), 'Cannot read', 'it keeps its failed read on the status line while it animates');
    assert.match(await job.locator('[data-tile-state]').getAttribute('class'), /text-error-fg/);
    assert.equal(await page.locator('[data-asset-tiles] [data-tile-spinner]').count(), 1, 'no spinner on a card that is not building');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const moving = await job.evaluate((el) => ({ names: getComputedStyle(el).animationName, spin: getComputedStyle(el.querySelector('[data-tile-spinner]')).animationName }));
    assert.deepEqual(moving.names.split(', ').sort(), ['assetBuildingBorder', 'assetBuildingGlow'], 'a pulsing glow and a moving border');
    await shot(page, 'build-plan-running-job-card');
    assert.notEqual(moving.spin, 'none');
    assert.equal(await page.locator('[data-asset-tile="dashboard"]').evaluate((el) => getComputedStyle(el).animationName), 'none', 'a live card that is not building holds still');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const still = await job.evaluate((el) => ({ name: getComputedStyle(el).animationName, glow: getComputedStyle(el).boxShadow, spin: getComputedStyle(el.querySelector('[data-tile-spinner]')).animationName }));
    assert.equal(still.name, 'none', 'no animation for a person who asked for less motion');
    assert.equal(still.spin, 'none');
    assert.notEqual(still.glow, 'none', 'but the building card still stands out');
    assert.equal(await progress.getAttribute('data-progress-open'), 'true', 'a running build shows its progress open');
    assert.equal(await progress.locator('[data-progress-toggle]').getAttribute('aria-expanded'), 'true');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('while Genie rebuilds the App, the App card animates and the Job and Notebook cards do not; Larger gives the log more room', async () => {
  const steps = [
    stepRow('Vibe', 'ended_success', 86, { spec_version: 4 }),
    stepRow('Plan', 'started', 85, { spec_version: 4 }), stepRow('Plan', 'ended_success', 80, { spec_version: 4, plan: APP_PLAN }),
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
      ['Job', 'Vibe, Plan', 'done'], ['Notebook', 'Start Genie Code', 'done'], ['App', 'Rebuild the App', 'running'], ['Finish', 'Done', 'waiting'],
    ]);
    assert.match(await text(progress.locator('[data-stage="Job"]')), /^Job5s/, 'the Job chip carries the plan time');
    await page.waitForFunction(() => document.querySelector('[data-asset-tile="app"]')?.classList.contains('asset-building'), null, { timeout: 20000 });
    assert.deepEqual(await animatedTiles(page), ['app']);
    assert.equal(await page.locator('[data-asset-tile="app"] [data-tile-state]').textContent(), 'Building', 'a card that read fine says Building');
    assert.equal(await page.locator('[data-asset-tile="app"]').getAttribute('data-tile-building'), 'now', 'and its tile says Genie is on it now, from the same step');
    for (const id of ['job', 'notebook', 'dashboard', 'genie_space']) assert.doesNotMatch(await tileClass(page, id), /asset-building/, id);
    const log = progress.locator('[data-build-log]');
    const before = (await log.boundingBox()).height;
    const larger = progress.getByRole('button', { name: 'Make the build progress larger', exact: true });
    await larger.click();
    assert.equal(await progress.getByRole('button', { name: 'Make the build progress smaller', exact: true }).getAttribute('aria-pressed'), 'true');
    await painted(page);
    const after = (await log.boundingBox()).height;
    assert.ok(after > before + 100, `the log grows (${before} -> ${after})`);
    await shot(page, 'build-app-running-larger');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

const WARNED = 'Notebook: no candidate passed acceptance on the latest run, so every row comes from the fallback seasonal_naive; '
  + 'Not reliable yet: the latest run marked its results not reliable and wrote why in not_reliable of the run summary, which the App shows';
const finished = (status, message) => versionRow(4, {
  status, status_message: message, implement_run_id: '5555555555555555', updated_at: new Date().toISOString(), change_classes: 'outputs',
  outputs: V3_OUTPUTS, assets: V3_ASSETS, created_at: agoIso(400),
});
const doneSteps = () => [
  stepRow('Plan', 'started', 250, { spec_version: 4 }), stepRow('Plan', 'ended_success', 190, { spec_version: 4 }),
  stepRow('Instruction', 'started', 189, { spec_version: 4 }), stepRow('Instruction', 'ended_success', 185, { spec_version: 4 }),
  stepRow('Genie Code', 'started', 184, { spec_version: 4 }), stepRow('Genie Code', 'ended_success', 176, { spec_version: 4 }),
  stepRow('Genie build', 'started', 175, { spec_version: 4 }), stepRow('Genie build', 'ended_success', 141, { spec_version: 4 }),
  stepRow('Preview run', 'started', 140, { spec_version: 4 }), stepRow('Preview run', 'ended_success', 20, { spec_version: 4 }),
  stepRow('Dashboard', 'started', 19, { spec_version: 4 }), stepRow('Dashboard', 'ended_success', 10, { spec_version: 4 }),
];

test('a build that finished with warnings folds to one line with its status, version, time, warning count and the warning, and one click opens it again through every poll', async () => {
  const ui = await openTower({ ...STATE, history: [finished('ready_with_warnings', WARNED), ...HISTORY], steps: doneSteps() }, { expand: false });
  const { page } = ui;
  try {
    const progress = page.locator('[data-mvp-progress]');
    await page.waitForFunction(() => document.querySelector('[data-mvp-progress]')?.dataset.progressOpen === 'false', null, { timeout: 15000 });
    const toggle = progress.locator('[data-progress-toggle]');
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(await toggle.evaluate((el) => el.tagName), 'BUTTON');
    assert.equal(await progress.getByRole('list', { name: 'Build stages' }).count(), 0, 'no stage chips on the folded line');
    assert.equal(await progress.locator('[data-build-log]').isVisible(), false, 'the log is folded away');
    const line = progress.locator('[data-build-summary]');
    assert.match(await text(line), /^Warnings · Took \d+m \d+s · 2 warnings\s*·\s*Notebook: no candidate passed acceptance/);
    assert.match(await text(progress), /Build progress · v4/);
    const reason = progress.locator('[data-build-summary-reason]');
    assert.equal(await reason.getAttribute('title'), WARNED, 'the full warning on hover');
    assert.deepEqual(await reason.evaluate((el) => [getComputedStyle(el).whiteSpace, getComputedStyle(el).textOverflow, el.scrollWidth > el.clientWidth]), ['nowrap', 'ellipsis', true],
      'one line, cut with an ellipsis');
    assert.ok((await progress.boundingBox()).height < 90, 'one summary line');
    assert.equal(await animatedTiles(page).then((t) => t.length), 0, 'nothing animates on a finished build');
    await shot(page, 'build-warnings-folded');
    await toggle.focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-mvp-progress]')?.dataset.progressOpen === 'true');
    assert.equal(await progress.locator('[data-progress-toggle]').getAttribute('aria-expanded'), 'true');
    assert.equal(await text(progress.locator('[data-build-reason]')), WARNED, 'the full warning once opened');
    assert.deepEqual((await stagesOf(page)).map(([id, , state]) => [id, state]), [['Job', 'done'], ['Notebook', 'done'], ['Dashboard', 'done'], ['Finish', 'warning']]);
    assert.match(await text(progress.locator('[data-stage="Job"]')), /^Job3m 0s/, 'Job = 1m of planning + 2m of preview run');
    await shot(page, 'build-warnings-open');
    await page.waitForResponse((r) => r.url().includes('/implement/status'), { timeout: 15000 });
    await painted(page);
    assert.equal(await progress.getAttribute('data-progress-open'), 'true', 'it stays open through a status poll');
    await progress.locator('[data-progress-toggle]').click();
    assert.equal(await progress.getAttribute('data-progress-open'), 'false');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a failed build folds too but keeps what you must act on in view', async () => {
  const failSteps = [stepRow('Plan', 'started', 300, { spec_version: 4 }), stepRow('Plan', 'ended_error', 280, { spec_version: 4 }, 'the warehouse is stopped')];
  const ui = await openTower({ ...STATE, history: [finished('failed', 'the warehouse is stopped'), ...HISTORY], steps: failSteps }, { expand: false });
  const { page } = ui;
  try {
    const progress = page.locator('[data-mvp-progress]');
    await page.waitForFunction(() => document.querySelector('[data-mvp-progress]')?.dataset.progressOpen === 'false', null, { timeout: 15000 });
    await progress.locator('[data-build-attention]').getByRole('region', { name: 'Build failed' }).waitFor();
    await shot(page, 'build-failed-folded');
    await progress.locator('[data-progress-toggle]').click();
    const job = progress.locator('[data-stage="Job"]');
    assert.equal(await job.getAttribute('data-stage-state'), 'error', 'a failed plan fails the Job');
    assert.equal(await job.locator('[title]').getAttribute('title'), 'Plan, Preview run: the warehouse is stopped', 'with the plan message');
    assert.equal(await progress.locator('[data-build-attention]').count(), 0);
    assert.equal(await progress.getByRole('region', { name: 'Build failed' }).count(), 1, 'the banner moves into the open log, shown once');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

async function tileGeometry(page) {
  return page.locator('[data-asset-tiles] [data-asset-tile]').evaluateAll((tiles) => tiles.map((t) => {
    const box = t.getBoundingClientRect();
    const buttons = [...t.querySelectorAll('[data-tile-actions] button, [data-tile-actions] a')].map((b) => {
      const r = b.getBoundingClientRect();
      const label = b.querySelector('.truncate');
      return { h: Math.round(r.height), w: Math.round(r.width), left: r.left, right: r.right, cut: label ? label.scrollWidth > label.clientWidth : false, title: b.title };
    });
    return { id: t.dataset.assetTile, h: Math.round(box.height), w: Math.round(box.width), left: box.left, right: box.right, buttons };
  }));
}

for (const [name, width] of [['wide', 1440], ['narrow', 720]]) {
  test(`the asset cards are one height and their buttons one height, full card width, and a cut label keeps its words in a tooltip (${name} window)`, async () => {
    const ui = await openTower();
    const { page } = ui;
    try {
      await page.setViewportSize({ width, height: 1000 });
      await page.waitForFunction(() => document.querySelector('[data-asset-tile="job"] [data-tile-actions] button'), null, { timeout: 20000 });
      await painted(page);
      const tiles = await tileGeometry(page);
      assert.equal(new Set(tiles.map((t) => t.h)).size, 1, `card heights ${JSON.stringify(tiles.map((t) => [t.id, t.h]))}`);
      const buttons = tiles.flatMap((t) => t.buttons);
      assert.ok(buttons.length >= 8, `measured ${buttons.length} buttons`);
      assert.equal(new Set(buttons.map((b) => b.h)).size, 1, `button heights ${JSON.stringify(buttons.map((b) => b.h))}`);
      for (const t of tiles) {
        assert.ok(new Set(t.buttons.map((b) => b.w)).size <= 1, `${t.id} buttons share one width`);
        for (const b of t.buttons) {
          assert.ok(b.left >= t.left && b.right <= t.right + 0.5, `${t.id} button stays inside its card`);
          if (b.cut) assert.ok(b.title, `${t.id}: a cut label has a tooltip`);
        }
      }
      const job = tiles.find((t) => t.id === 'job');
      assert.ok(job.buttons.some((b) => b.title === 'Resume the schedule' || b.title === 'Pause the schedule'), JSON.stringify(job.buttons));
      await shot(page, `build-cards-${name}`);
      assert.deepEqual(ui.pageErrors, []);
    } finally {
      await ui.close();
    }
  });
}

test('a Build page with short content ends where its content ends: the list and the use case end together, with no empty band below them (must-exclude: no forced full-screen height)', async () => {
  for (const [name, state] of [['not built', {}], ['built, progress folded', STATE]]) {
    const ui = await openUi('implement', state);
    const { page } = ui;
    try {
      await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
      await page.getByRole('region', { name: 'Use case', exact: true }).locator('[data-pinned-name]').waitFor({ timeout: 15000 });
      if (state.history) {
        await page.locator('[data-asset-tiles]').waitFor({ timeout: 15000 });
        assert.equal(await page.locator('[data-mvp-progress]').getAttribute('data-progress-open'), 'false', `${name}: the progress starts folded`);
      }
      for (const [width, height] of [[1440, 900], [1920, 1080]]) {
        await page.setViewportSize({ width, height });
        await painted(page);
        const m = await page.evaluate(() => {
          const bottom = (s) => Math.round(document.querySelector(s).getBoundingClientRect().bottom);
          const pane = document.querySelector('[data-use-case-pane]');
          const content = Math.max(...[...pane.children].map((el) => el.getBoundingClientRect().bottom));
          return { page: bottom('[data-implement-page]'), rail: bottom('[data-implement-rail]'), section: bottom('section[aria-label="Use case"]'),
            content: Math.round(content), vh: window.innerHeight };
        });
        const at = `${name} at ${width}x${height} ${JSON.stringify(m)}`;
        assert.ok(m.page < m.vh - 100, `the page is as tall as its content, not the window: ${at}`);
        assert.ok(Math.abs(m.rail - m.section) <= 2, `the list and the use case end together: ${at}`);
        assert.ok(m.section - m.content <= 40, `the use case holds no empty band under its content: ${at}`);
      }
      assert.deepEqual(ui.pageErrors, []);
    } finally {
      await ui.close();
    }
  }
});
