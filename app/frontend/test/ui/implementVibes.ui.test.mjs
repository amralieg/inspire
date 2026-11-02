import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { defaultSpecFromUseCase } from '../../src/lib/implementWizard.js';
import { HARNESS_USE_CASE, HARNESS_SETTINGS, HARNESS_SESSION_ID } from './implementFixtures.js';
import { clippedExamples, closeBrowser, lowContrast, onStep, openUi, setDark, startMvp, toAppAccess, dataToResults, toVibes, until, wizardFits } from './uiSupport.mjs';

const OWNER = ['owner', 'example.com'].join('@');
const SHOTS = process.env.VIBES_SHOTS || '';
const LONG_ASK = 'Put the weekly trend first, show the twenty rows to act on today, and colour every overdue row so it stands out at once';

test.after(closeBrowser);

const next = (page) => page.getByRole('button', { name: 'Next' }).click();
const footerErrors = (page) => page.locator('[role="alert"] p').allTextContents();
const ONE_BOX = 'Vibes for the MVP';
const wizardBox = (page) => page.getByRole('region', { name: 'Vibes', exact: true }).getByRole('textbox', { name: ONE_BOX, exact: true });

async function toDelivery(page) {
  await onStep(page, 'Choose');
  await next(page);
  await onStep(page, 'Data');
  await dataToResults(page);
  await next(page);
  await onStep(page, 'Delivery');
}

function insertsOf(made) {
  return made.sqlCalls.filter((c) => String(c.sql).includes('INSERT INTO') && (c.parameters || []).some((p) => p.name === 'spec'))
    .map((c) => ({ spec: JSON.parse(c.parameters.find((p) => p.name === 'spec').value), classes: c.parameters.find((p) => p.name === 'classes').value }));
}

async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

async function readable(page, selectors, name) {
  for (const dark of [false, true]) {
    await setDark(page, dark);
    const result = await lowContrast(page, selectors);
    assert.ok(result.checked >= 10, `${name}: measured ${result.checked} elements`);
    assert.deepEqual(result.low, [], `${name} ${dark ? 'dark' : 'light'}`);
    await shot(page, `${name}-${dark ? 'dark' : 'light'}`);
  }
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
}

const STEPS_WITH_APP = ['1. Choose', '2. Data', '3. First run', '4. Results', '5. Delivery', '6. App placement', '7. App access', '8. App look', '9. Settings', '10. Vibes'];
const boxLabels = (panel) => panel.locator('textarea').evaluateAll((boxes) => boxes.map((b) => b.getAttribute('aria-label')));

async function grayExamples(page, panel) {
  return panel.locator('textarea').evaluateAll((boxes) => boxes.map((b) => {
    const rgb = (c) => c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
    return { label: b.getAttribute('aria-label'), text: b.placeholder, value: b.value, example: rgb(getComputedStyle(b, '::placeholder').color), typed: rgb(getComputedStyle(b).color) };
  }));
}

function assertGray(examples, mode) {
  for (const e of examples) {
    assert.match(e.text, /^For example: \S/, `${mode} ${e.label}: the example reads as an example`);
    assert.ok(Math.max(...e.example) - Math.min(...e.example) <= 16, `${mode} ${e.label}: the example is gray, ${e.example}`);
    assert.ok(Math.max(...e.example) >= 80 && Math.max(...e.example) <= 180, `${mode} ${e.label}: the example is a mid gray, ${e.example}`);
    assert.notDeepEqual(e.example, e.typed, `${mode} ${e.label}: typed words never look like the example`);
  }
}

test('Vibes is the last step: Delivery asks for no vibes, the step has one box for the whole MVP with a gray example, a first build asks nothing about a version before, and the step names what Genie does not build', async () => {
  const ui = await openUi('wizard', { me: { userName: OWNER, displayName: 'Owner' } });
  const { page } = ui;
  try {
    await toDelivery(page);
    assert.deepEqual(await page.locator('ol li').allTextContents(), STEPS_WITH_APP);
    assert.equal(await page.getByRole('button', { name: /vibes/i }).count(), 0, 'Delivery has no vibes button');
    assert.equal(await page.getByRole('textbox', { name: /vibes/i }).count(), 0, 'Delivery has no vibes box');
    assert.equal(await page.getByRole('region', { name: 'Vibes' }).count(), 0);
    await page.getByRole('checkbox', { name: /^App / }).uncheck();
    assert.deepEqual(await page.locator('ol li').allTextContents(), ['1. Choose', '2. Data', '3. First run', '4. Results', '5. Delivery', '6. Settings', '7. Vibes'], 'Vibes stays last without an App');
    await toVibes(page);
    const panel = page.getByRole('region', { name: 'Vibes' });
    await panel.getByRole('heading', { name: 'Anything else Genie should build in?' }).waitFor();
    await panel.getByText('There is one box for the whole MVP: Inspire sends each ask to the part it changes, and an ask that changes the analysis rebuilds the notebook and every '
      + 'part after it. The box is optional, and its gray text is only an example.', { exact: false }).waitFor();
    assert.deepEqual(await boxLabels(panel), [ONE_BOX], 'one box, never one per asset');
    assert.equal(await panel.getByRole('tablist').count(), 0, 'no tab per asset');
    assert.equal(await panel.locator('[data-vibe-previous]').count(), 0);
    await wizardBox(page).fill('Put the weekly trend first');
    assert.equal(await panel.getByRole('group', { name: /^What happens to v/ }).count(), 0, 'a first build has no version before to keep or remove');
    await wizardBox(page).fill('');
    assert.equal(await panel.locator('[data-vibes-skipped]').textContent(),
      'Genie builds only what you picked in the Delivery step, so an ask for the App and the Alert is not done. To vibe them, go Back to Delivery and pick them.');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), ONE_BOX, 'the box has the focus');
    for (const dark of [false, true]) {
      await page.evaluate((on) => document.documentElement.classList.toggle('dark', on), dark);
      const examples = await grayExamples(page, panel);
      assert.equal(examples.length, 1);
      assertGray(examples, dark ? 'dark' : 'light');
    }
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
    assert.deepEqual((await grayExamples(page, panel)).map((e) => e.value), [''], 'the example is never typed into the box');

    await page.getByRole('button', { name: 'Back' }).click();
    await onStep(page, 'Settings');
    await page.getByRole('button', { name: 'Back' }).click();
    await onStep(page, 'Delivery');
    for (const name of [/^App /, /^Alert/]) await page.getByRole('checkbox', { name }).check();
    await page.getByText(`Emails ${OWNER} when`, { exact: false }).waitFor();
    await toAppAccess(page);
    await page.getByRole('radio', { name: /^Internal data/ }).check();
    await toVibes(page);
    assert.deepEqual(await boxLabels(panel), [ONE_BOX], 'still one box with every output picked');
    assert.equal(await panel.locator('[data-vibes-skipped]').count(), 0, 'every output picked, nothing to name');
    assertGray(await grayExamples(page, panel), 'every output');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the one box on the Vibes step takes the full width, is 8 lines tall and grows, and keeps what was typed when the person goes Back and returns', async () => {
  const ui = await openUi('wizard', { me: { userName: OWNER, displayName: 'Owner' } });
  const { page } = ui;
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await toDelivery(page);
    await page.getByRole('checkbox', { name: /^Alert/ }).check();
    await page.getByText(`Emails ${OWNER} when`, { exact: false }).waitFor();
    await toAppAccess(page);
    await page.getByRole('radio', { name: /^Internal data/ }).check();
    await toVibes(page);
    const box = wizardBox(page);
    const size = await box.evaluate((el) => ({ rows: el.rows, resize: getComputedStyle(el).resize, width: el.getBoundingClientRect().width,
      panel: el.closest('section').getBoundingClientRect().width }));
    assert.deepEqual([size.rows, size.resize], [8, 'vertical'], 'the box is 8 lines tall and the person can make it taller');
    assert.ok(size.width >= size.panel - 2, `the box takes the full width of the step (${size.width} of ${size.panel})`);
    const before = await box.boundingBox();
    await page.mouse.move(before.x + before.width - 3, before.y + before.height - 3);
    await page.mouse.down();
    await page.mouse.move(before.x + before.width - 3, before.y + before.height + 120, { steps: 6 });
    await page.mouse.up();
    const after = await box.boundingBox();
    assert.ok(after.height > before.height + 60, `dragging the corner makes the box taller (${before.height} to ${after.height})`);
    await box.fill('Make the trend weekly\nAnswer in euros');
    await page.getByRole('button', { name: 'Back' }).click();
    await onStep(page, 'Settings');
    await page.getByRole('button', { name: 'Back' }).click();
    await onStep(page, 'App look');
    await toVibes(page);
    assert.equal(await wizardBox(page).inputValue(), 'Make the trend weekly\nAnswer in euros', 'coming back keeps the asks');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the gray example of the one box on the Vibes step shows in full, on a desktop and on a phone', async () => {
  const ui = await openUi('wizard', { me: { userName: OWNER, displayName: 'Owner' } });
  const { page } = ui;
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await toDelivery(page);
    await page.getByRole('checkbox', { name: /^Alert/ }).check();
    await page.getByText(`Emails ${OWNER} when`, { exact: false }).waitFor();
    await toVibes(page);
    assert.equal(await page.getByRole('region', { name: 'Vibes', exact: true }).locator('textarea').count(), 1, 'one box for the notebook and every output');
    for (const [width, height, device] of [[1440, 900, 'desktop'], [390, 844, 'phone']]) {
      await page.setViewportSize({ width, height });
      assert.deepEqual(await clippedExamples(page, wizardBox(page)), [], device);
    }
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the Vibes step keeps a live counter, an ask over 2000 characters stops Start with the shared message and focuses the box, and a first build sends the vibe with no choice for a version before', async () => {
  const ui = await openUi('wizard', { me: { userName: OWNER, displayName: 'Owner' } });
  const { page, made } = ui;
  try {
    await toDelivery(page);
    await page.getByRole('checkbox', { name: /^Alert/ }).check();
    await page.getByText(`Emails ${OWNER} when`, { exact: false }).waitFor();
    await toAppAccess(page);
    await page.getByRole('radio', { name: /^Internal data/ }).check();
    await toVibes(page);
    const one = page.getByRole('region', { name: 'Vibes' }).locator('[data-vibes="mvp"]');
    await wizardBox(page).fill(`  ${LONG_ASK}  `);
    assert.equal(await one.locator('[data-vibes-count]').textContent(), `${LONG_ASK.length}/2000`, 'the counter counts the trimmed ask');
    await wizardBox(page).fill('g'.repeat(2001));
    const count = one.locator('[data-vibes-count]');
    assert.equal(await count.textContent(), '2001/2000');
    assert.match(await count.getAttribute('class'), /text-error-fg/, 'the counter turns to the error style over the limit');
    await one.getByText('the MVP vibes are 2001 characters; at most 2000 are allowed').waitFor();
    assert.equal(await wizardBox(page).getAttribute('aria-invalid'), 'true');
    await page.getByRole('button', { name: 'Back' }).focus();
    await page.getByRole('button', { name: 'Start MVP', exact: true }).click();
    await page.locator('[role="alert"]').waitFor();
    assert.deepEqual(await footerErrors(page), ['the MVP vibes are 2001 characters; at most 2000 are allowed']);
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), ONE_BOX, 'Start moves the focus to the box to shorten');
    await onStep(page, 'Vibes');
    assert.equal(made.jobs.length, 0, 'an ask over the limit starts nothing');
    assert.equal(insertsOf(made).length, 0, 'and records no version');

    await wizardBox(page).fill(`  ${LONG_ASK}\nOne page: the decision list on the left and the row detail on the right  `);
    assert.doesNotMatch(await count.getAttribute('class'), /text-error-fg/);
    await page.locator('[role="alert"]').waitFor({ state: 'detached' });
    await startMvp(page);
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    const [{ spec, classes }] = insertsOf(made);
    assert.equal(spec.vibes, `${LONG_ASK}\nOne page: the decision list on the left and the row detail on the right`, 'the one box is sent as the vibe the agent routes');
    assert.equal('vibe_previous' in spec, false, 'a first build sends no choice for a version before');
    assert.deepEqual([spec.data.notes, spec.outputs.dashboard_vibes, spec.outputs.app_vibes, spec.outputs.alert_vibes], ['', '', '', ''], 'no part holds an ask before the agent routes it');
    assert.equal(classes, 'initial');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the Vibes step with every output picked fits 1440x900 with its box filled past the limit, and reads at 4.5:1 in light and dark', async () => {
  const ui = await openUi('wizard', { me: { userName: OWNER, displayName: 'Owner' } });
  const { page } = ui;
  const fits = (name) => wizardFits(page, name);
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await toDelivery(page);
    await page.getByRole('checkbox', { name: /^Alert/ }).check();
    await page.getByText(`Emails ${OWNER} when`, { exact: false }).waitFor();
    await fits('vibes-wizard-tiles');
    await toAppAccess(page);
    await page.getByRole('radio', { name: /^Internal data/ }).check();
    await toVibes(page);
    await fits('vibes-step-empty');
    await wizardBox(page).fill([LONG_ASK, 'Score the baseline and every model on the same held-out rows', 'Answer in plain words and always say which rows you counted',
      'One page: the decision list on the left and the row detail on the right', 'a'.repeat(1700)].join('\n'));
    await fits('vibes-step-filled');
    await readable(page, ['[role="dialog"]'], 'vibes-step');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

const builtSpec = (vibes = {}) => {
  const spec = defaultSpecFromUseCase(HARNESS_USE_CASE, { warehouseId: HARNESS_SETTINGS.warehouseId, inspireDatabase: HARNESS_SETTINGS.inspireDatabase, sessionId: HARNESS_SESSION_ID, owner: OWNER });
  return {
    ...spec,
    outputs: { ...spec.outputs, genie_space: true, app: true, app_name: 'churn-desk', app_access: 'sp', alert: true, alert_recipients: [OWNER], ...vibes },
  };
};

const ready = (version, extra = {}) => ({ state: 'ready', spec_version: version, ...extra });

const versionRow = (version, { vibes = {}, assets = {}, ...extra } = {}) => ({
  session_id: '42', use_case_id: 'N01-U01', spec_version: version, status: 'ready', change_classes: version === 1 ? 'initial' : 'outputs', created_by: OWNER,
  updated_at: `2026-10-2${version}T04:00:00Z`, spec_json: JSON.stringify(builtSpec(vibes)), job_id: '77', last_preview_run_id: '9001', result_rows: '3',
  dashboard_id: 'd1', dashboard_url: 'https://workspace.example.com/dashboardsv3/d1/published',
  genie_space_id: 'g1', genie_space_url: 'https://workspace.example.com/genie/rooms/g1',
  app_name: 'churn-desk', app_url: 'https://churn-desk-1.aws.example.com',
  alert_id: 'a1', alert_url: 'https://workspace.example.com/sql/alerts-v2/a1',
  asset_status: JSON.stringify(assets),
  ...extra,
});

const HISTORY = [
  versionRow(3, {
    vibes: { dashboard_vibes: 'Make the trend weekly', app_vibes: 'Dark header' },
    assets: { dashboard: ready(3, { snapshot: true }), genie_space: ready(1, { snapshot: true }), app: ready(3, { snapshot: true }), alert: ready(1) },
    status: 'ready_with_warnings',
    status_message: 'Dashboard vibe not done: put it in Arabic: the dashboard has no Arabic font; App vibe not done: a logo: no logo file was given',
  }),
  versionRow(2, {
    vibes: { dashboard_vibes: LONG_ASK, app_vibes: '' },
    assets: { dashboard: ready(2, { snapshot: true }), genie_space: ready(1, { snapshot: true }), app: ready(2, { snapshot: true }), alert: ready(1) },
  }),
  versionRow(1, { assets: { dashboard: ready(1, { snapshot: false }), genie_space: ready(1, { snapshot: true }), app: ready(1, { snapshot: true }), alert: ready(1) } }),
];

const STATE = { history: HISTORY, appExists: true, app: { name: 'churn-desk', description: 'Inspire use case N01-U01 (session 42): Predict churn', compute_status: { state: 'ACTIVE' }, app_status: { state: 'RUNNING' } } };

const OUTPUTS = ['dashboard', 'genie_space', 'app', 'alert'];

async function openVibes(state = STATE) {
  const ui = await openUi('implement', state);
  try {
    await ui.page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    await ui.page.getByRole('tablist', { name: 'MVP views' }).waitFor({ timeout: 15000 });
  } catch (e) {
    await ui.close();
    throw e;
  }
  return ui;
}

async function showTab(page, output) {
  const tab = page.locator(`[data-mvp-tab="${output}"]`);
  if (await tab.getAttribute('aria-selected') !== 'true') await tab.click();
  const panel = page.locator(`[data-mvp-panel="${output}"]`);
  await panel.waitFor();
  return panel;
}

const card = (scope, id) => scope.locator(`[data-vibe-card="${id}"]`);
const cardIds = (scope) => scope.locator('[data-vibe-card]').evaluateAll((cards) => cards.map((c) => c.dataset.vibeCard));
const mvpBox = (page) => page.locator('[data-vibe-box="mvp"]').getByRole('textbox', { name: ONE_BOX, exact: true });
const addVibes = (page) => page.locator('[data-vibe-box="mvp"]').getByRole('button', { name: 'Add vibes', exact: true });
const heldOf = (scope) => scope.locator('[data-held-ask]').evaluateAll((items) => items.map((li) => li.querySelector('span').textContent));
const editMvp = (page) => page.locator('[data-edit-mvp]');
const versionIds = (scope) => scope.getByRole('region', { name: 'Versions' }).locator('[data-version]').evaluateAll((rows) => rows.map((r) => r.dataset.version));
const rollbacks = (page) => page.locator('[data-mvp-panel]').getByRole('button', { name: /^Roll back to version / });

test('the one vibe box sits above the tabs with its gray example in full on a desktop, a laptop and a phone, a squeezed box stays 8 lines tall, and no tab has a box of its own', async () => {
  const ui = await openVibes();
  const { page } = ui;
  try {
    for (const [width, device] of [[1440, 'desktop'], [1024, 'laptop'], [390, 'phone']]) {
      await page.setViewportSize({ width, height: 900 });
      assert.deepEqual(await clippedExamples(page, mvpBox(page)), [], device);
      for (const id of [...OUTPUTS, 'build']) {
        const panel = await showTab(page, id);
        assert.equal(await panel.locator('textarea').count(), 0, `${id} on a ${device} has no box of its own`);
        assert.equal(await panel.getByRole('button', { name: /^(Add|Update) vibes$/ }).count(), 0, `${id} on a ${device}`);
      }
    }
    const squeezed = await mvpBox(page).evaluate((el) => {
      const style = getComputedStyle(el);
      return { height: el.offsetHeight, most: parseFloat(style.lineHeight) * 8 + el.offsetHeight - el.clientHeight + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) };
    });
    assert.ok(squeezed.height <= squeezed.most + 2, `a squeezed box stays at most 8 lines tall ${JSON.stringify(squeezed)}`);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('each output tab holds only its own card with the asks it was built with, and an ask being typed in the one box survives the tabs and Use case details until it is added', async () => {
  const ui = await openVibes();
  const { page, made } = ui;
  try {
    const held = {};
    for (const id of OUTPUTS) held[id] = await cardIds(await showTab(page, id));
    assert.deepEqual(held, { dashboard: ['dashboard'], genie_space: ['genie_space'], app: ['app'], alert: ['alert'] }, 'each tab shows only its output\'s card');
    let panel = await showTab(page, 'genie_space');
    assert.match(await card(panel, 'genie_space').locator('[data-live]').textContent(), /^Version 1, built /, 'a carried asset names the version it was built on');
    assert.equal(await card(panel, 'genie_space').locator('[data-built-with]').count(), 0, 'an output that holds no ask lists none');

    panel = await showTab(page, 'dashboard');
    const dash = card(panel, 'dashboard');
    assert.deepEqual(await heldOf(dash), ['\u201cMake the trend weekly\u201d']);
    assert.match(await dash.locator('[data-live]').textContent(), /^Version 3, built .+/);
    assert.deepEqual(await dash.getByRole('list', { name: /^Vibes Genie could not do on the / }).getByRole('listitem').allTextContents(),
      ['Dashboard vibe not done: put it in Arabic: the dashboard has no Arabic font'], 'only this asset\'s warnings show under it');

    await mvpBox(page).fill('  Add a map by region  ');
    await showTab(page, 'app');
    assert.deepEqual(await heldOf(card(page.locator('[data-mvp-panel]'), 'app')), ['\u201cDark header\u201d']);
    await showTab(page, 'build');
    await page.getByRole('button', { name: 'Use case details', exact: true }).click();
    await page.keyboard.press('Escape');
    await showTab(page, 'dashboard');
    assert.equal(await mvpBox(page).inputValue(), '  Add a map by region  ', 'an ask being typed survives the tabs and the details drawer');
    assert.equal(await editMvp(page).getAttribute('data-collected'), null, 'typing alone collects nothing');
    await addVibes(page).click();
    assert.equal(await mvpBox(page).inputValue(), '', 'the box empties once the ask is kept');
    await page.locator('[data-vibe-box="mvp"] [data-waiting="ask"]').getByText('\u201cAdd a map by region\u201d', { exact: true }).waitFor();
    await showTab(page, 'alert');
    assert.equal(await editMvp(page).getAttribute('data-collected'), '1');
    assert.deepEqual([made.jobs.length, insertsOf(made).length], [0, 0], 'nothing is written or started until Edit MVP builds');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Versions in each tab lists the live version and only the earlier ones that kept a snapshot, and a confirmed roll back submits the version and its vibes', async () => {
  const ui = await openVibes();
  const { page, made } = ui;
  const sent = [];
  page.on('request', (req) => { if (req.url().includes('/api/inspire/implement/submit')) sent.push(JSON.parse(req.postData())); });
  try {
    let panel = await showTab(page, 'app');
    await card(panel, 'app').waitFor();
    assert.deepEqual(await versionIds(panel), ['3', '2', '1']);
    await panel.locator('[data-version="2"]').getByText('no vibes', { exact: true }).waitFor();
    for (const id of ['genie_space', 'alert']) {
      panel = await showTab(page, id);
      await card(panel, id).waitFor();
      assert.deepEqual(await versionIds(panel), ['1'], `${id}: only the live version, nothing earlier to roll back to`);
      assert.equal(await rollbacks(page).count(), 0, id);
    }

    panel = await showTab(page, 'dashboard');
    await card(panel, 'dashboard').waitFor();
    assert.deepEqual(await versionIds(panel), ['3', '2'], 'v3 is live and v1 kept no snapshot');
    const row = panel.getByRole('region', { name: 'Versions' }).locator('[data-version="2"]');
    assert.ok((await row.textContent()).includes(`\u201c${LONG_ASK.slice(0, 80).trimEnd()}\u2026\u201d`), await row.textContent());

    await row.getByRole('button', { name: 'Roll back to version 2', exact: true }).click();
    const confirm = row.getByRole('group', { name: 'Confirm the roll back to version 2' });
    await confirm.getByText('Roll back the Dashboard to version 2? This replaces the live Dashboard; Genie is not called.').waitFor();
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await confirm.waitFor({ state: 'detached' });
    assert.equal(made.jobs.length, 0, 'Cancel sends nothing');
    await row.getByRole('button', { name: 'Roll back to version 2', exact: true }).click();
    await confirm.getByRole('button', { name: 'Roll back', exact: true }).click();
    await until(() => made.jobs.length === 1, 'the roll back run');
    assert.equal(sent.length, 1);
    const asked = sent[0].spec;
    assert.deepEqual(asked.rollback_outputs, { dashboard: 2 });
    assert.equal(asked.outputs.dashboard_vibes, LONG_ASK, 'the browser sends the vibes of the version it rolls back to');
    assert.equal(asked.outputs.app_vibes, 'Dark header');
    assert.equal('retry_outputs' in asked, false);
    const [stored] = insertsOf(made);
    assert.deepEqual(stored.spec.rollback_outputs, { dashboard: 2 });
    assert.equal(stored.spec.outputs.dashboard_vibes, LONG_ASK);
    assert.deepEqual(stored.classes.split(','), ['outputs', 'rollback']);
    await confirm.waitFor({ state: 'detached' });
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('while a version builds or a submit is on its way, every roll back on every tab is disabled, and an ask can still be added for later', async () => {
  const building = versionRow(4, { status: 'building_outputs', implement_run_id: '5555555555555555', updated_at: new Date().toISOString(),
    vibes: { dashboard_vibes: 'Make the trend weekly', app_vibes: 'Dark header' }, assets: {} });
  const busy = await openVibes({ ...STATE, history: [building, ...HISTORY], implementRun: { run_id: 5555555555555555, state: { life_cycle_state: 'RUNNING' } } });
  try {
    const { page } = busy;
    let count = 0;
    for (const id of ['dashboard', 'app']) {
      const panel = await showTab(page, id);
      await card(panel, id).getByText('A version is building now; roll backs apply after it finishes, and the asks you add or remove wait for Edit MVP.').waitFor();
      for (const button of await rollbacks(page).all()) assert.equal(await button.isDisabled(), true, id);
      count += await rollbacks(page).count();
      assert.equal(await mvpBox(page).isDisabled(), false, `${id}: an ask can still be written for the next build`);
    }
    assert.equal(count, 3);
    assert.deepEqual(busy.pageErrors, []);
  } finally {
    await busy.close();
  }

  const ui = await openVibes();
  try {
    const { page, made } = ui;
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    await page.route('**/api/inspire/implement/submit', async (route) => { await held; await route.continue(); });
    const app = await showTab(page, 'app');
    const row = app.getByRole('region', { name: 'Versions' }).locator('[data-version="2"]');
    await row.getByRole('button', { name: 'Roll back to version 2', exact: true }).click();
    await row.getByRole('group', { name: 'Confirm the roll back to version 2' }).getByRole('button', { name: 'Roll back', exact: true }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('[data-mvp-panel] button')].filter((b) => /^Roll back to version /.test(b.getAttribute('aria-label') || b.textContent))
      .every((b) => b.disabled));
    await showTab(page, 'dashboard');
    assert.equal(await page.locator('[data-mvp-panel]').getByRole('button', { name: 'Roll back to version 2', exact: true }).isDisabled(), true, 'another tab waits for the submit too');
    release();
    await until(() => made.jobs.length === 1, 'the held roll back');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the Build page cards and versions fit a 1440x900 screen and read at 4.5:1 in light and dark', async () => {
  const ui = await openVibes();
  const { page } = ui;
  const fits = (id) => page.evaluate((which) => {
    const panel = document.querySelector('[data-mvp-panel]').getBoundingClientRect();
    const c = document.querySelector(`[data-vibe-card="${which}"]`);
    const v = document.querySelector('[data-mvp-panel] [aria-label="Versions"]');
    const r = c.getBoundingClientRect();
    const vr = v ? v.getBoundingClientRect() : r;
    return {
      page: document.scrollingElement.scrollWidth, panel: { left: panel.left, right: panel.right },
      card: { left: r.left, right: r.right, wide: c.scrollWidth <= c.clientWidth + 1 }, versions: { left: vr.left, right: vr.right },
    };
  }, id);
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    let panel = await showTab(page, 'dashboard');
    await mvpBox(page).fill('Make the trend weekly and add a map');
    await addVibes(page).click();
    await panel.locator('[data-held-ask]').getByRole('button', { name: 'Remove “Make the trend weekly”', exact: true }).click();
    await panel.locator('[data-version="2"]').getByRole('button', { name: 'Roll back to version 2', exact: true }).click();
    for (const [id, open] of [['dashboard', null], ['alert', async () => mvpBox(page).fill('z'.repeat(2001))]]) {
      if (open) {
        panel = await showTab(page, id);
        await open(panel);
      }
      const sizes = await fits(id);
      assert.ok(sizes.page <= 1440, `the page does not scroll sideways (${sizes.page})`);
      assert.ok(sizes.card.wide && sizes.card.left >= sizes.panel.left && sizes.card.right <= sizes.panel.right + 1, JSON.stringify(sizes));
      assert.ok(sizes.versions.left >= sizes.panel.left && sizes.versions.right <= sizes.panel.right + 1, JSON.stringify(sizes));
      await readable(page, ['[data-mvp-panel]', '[data-vibe-box="mvp"]'], `vibes-build-${id}`);
    }
    panel = await showTab(page, 'app');
    await card(panel, 'app').scrollIntoViewIfNeeded();
    await shot(page, 'vibes-build-versions-light');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a notebook ask the notes hold is removed on the Notebook tab and built without it, and a vibe on a rebuild needs keep or remove before Start', async () => {
  const history = HISTORY.map((row, i) => (i ? row : {
    ...row,
    spec_json: JSON.stringify({ ...JSON.parse(row.spec_json), data: { ...JSON.parse(row.spec_json).data, notes: 'Score on the last 90 days\nCount returns by week' } }),
    asset_status: JSON.stringify({ ...JSON.parse(row.asset_status), notebook: { spec_version: 2, modified_at: 1 } }),
  }));
  const ui = await openVibes({ ...STATE, history });
  const { page, made } = ui;
  try {
    const panel = await showTab(page, 'notebook');
    await card(panel, 'notebook').waitFor();
    assert.deepEqual(await cardIds(panel), ['notebook'], 'the notebook the MVP built has its own card on its tab');
    const nb = card(panel, 'notebook');
    assert.match(await nb.locator('[data-live]').textContent(), /^Version 2, built /);
    assert.deepEqual(await heldOf(nb), ['\u201cScore on the last 90 days\u201d', '\u201cCount returns by week\u201d'], 'the asks the notes hold, one per line');
    await nb.getByRole('button', { name: 'Remove \u201cCount returns by week\u201d', exact: true }).click();
    await editMvp(page).and(page.locator('[data-collected="1"]')).waitFor();
    assert.equal(made.jobs.length, 0, 'removing an ask starts nothing');
    await editMvp(page).click();
    const wizard = page.getByRole('dialog', { name: /^Start Use Case MVP with Genie/ });
    await onStep(page, 'Vibes');
    await wizardBox(page).fill('Score every model on the same held-out baskets');
    const choice = wizard.getByRole('group', { name: 'What happens to v3?' });
    await choice.getByRole('radio', { name: /^Keep v3 live/ }).waitFor();
    await choice.getByText('v3 stays as it is. Inspire builds each changed part again next to it, named v4, so you can compare them. Remove v3 later on the Build page. '
      + 'The alert is changed in place.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Start MVP', exact: true }).click();
    await page.locator('[role="alert"]').waitFor();
    assert.deepEqual(await footerErrors(page), ['choose what happens to v3, the version before this vibe: keep it live or remove it'], 'a rebuild without the choice is refused');
    assert.equal(made.jobs.length, 0);
    await choice.getByRole('radio', { name: /^Keep v3 live/ }).check();
    await page.getByRole('button', { name: 'Start MVP', exact: true }).click();
    await until(() => made.jobs.length === 1, 'the notebook build');
    const [built] = insertsOf(made);
    assert.deepEqual([built.spec.data.notes, built.spec.vibes, built.spec.vibe_previous],
      ['Score on the last 90 days', 'Score every model on the same held-out baskets', 'keep'], 'the removed ask leaves the notes and the new ask goes to the router');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

const FALLBACK = createRequire(import.meta.url)('../../../backend/test/fixtures/implement_vibe_fallback_cases.json');
const LIVE_ASSETS = { dashboard: ready(3), genie_space: ready(1), app: ready(3), alert: ready(1) };

test('an ask the agent sent to another part than the one it names says on that part\u2019s route line where it went and why, from the agent record', async () => {
  for (const c of FALLBACK.cases) {
    const [item] = c.record.fallback;
    const row = {
      ...versionRow(3, { assets: { ...LIVE_ASSETS, vibe: c.record }, status: 'ready_with_warnings', status_message: `Vibe: ${c.fallback_lines[0]}` }),
      spec_json: JSON.stringify({ ...builtSpec(), vibes: c.record.text, vibe_previous: 'keep', based_on_version: 2 }),
    };
    const ui = await openVibes({ ...STATE, history: [row, ...HISTORY.slice(1)] });
    const { page } = ui;
    try {
      const routes = page.locator('[data-mvp-progress] [data-vibe-route="route"]');
      await routes.first().waitFor({ timeout: 15000 });
      const sent = routes.filter({ hasText: 'went here because' });
      assert.equal(await sent.count(), 1, `${c.name}: one route line says why the ask went there`);
      assert.equal(await sent.locator('span').textContent(),
        `\u201c${item.ask.replace(/[.!?]+$/, '')}\u201d went here because ${item.reason}, so Genie tries it there.`, `${c.name}: ${FALLBACK.source}`);
      assert.ok(c.fallback_lines[0].includes(item.reason) && c.fallback_lines[0].startsWith(`'${item.ask}'`), 'the agent line names the same ask and reason');
      assert.match(await sent.textContent(), /^Sent to the /);
      assert.equal(await routes.count(), Object.keys(c.record.routes).length, 'one line per part the agent sent asks to');
      assert.deepEqual(ui.pageErrors, []);
    } finally {
      await ui.close();
    }
  }
});

test('a held version the agent recorded with no reason shows that as an error the person can act on, and fills nothing in for it', async () => {
  const held = versionRow(2, { status: 'vibe_not_met', assets: { ...LIVE_ASSETS, dashboard: ready(1), app: ready(1), held: { parts: ['dashboard'] } } });
  const ui = await openVibes({ ...STATE, history: [held, HISTORY[2]] });
  const { page } = ui;
  try {
    const tab = page.locator('[data-mvp-tab="build"]');
    if (await tab.getAttribute('aria-selected') !== 'true') await tab.click();
    const box = page.getByRole('region', { name: 'v2 is held', exact: true });
    await box.waitFor({ timeout: 15000 });
    const error = box.locator('[data-held-error]');
    const words = 'Inspire held v2 but wrote no reason, so this page cannot say what was not met or what stays live: press Try again to build it again';
    assert.deepEqual([await error.getAttribute('role'), await error.textContent()], ['alert', `${words}.`]);
    assert.deepEqual(await Promise.all(['[data-held-reason]', '[data-held-text]', '[data-held-next]'].map((s) => box.locator(s).count())), [0, 0, 0],
      'no App words stand in for the reason');
    assert.equal(await box.getByRole('button', { name: 'Try again', exact: true }).count(), 1, 'the action the error names is there');
    const progress = await page.locator('[data-mvp-progress]').textContent();
    assert.ok(progress.includes(words) && !progress.includes('Vibes not met, not published'), progress);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
