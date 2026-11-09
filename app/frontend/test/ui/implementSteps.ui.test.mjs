import test from 'node:test';
import assert from 'node:assert/strict';
import { INSIDE_WAREHOUSE_TOGGLE } from '../../src/lib/implementWizard.js';
import { BUILD_IT, closeBrowser, lowContrast, onStep, openAdvanced, openUi, setDark, toSummary, wizardInScreen, goToStep } from './uiSupport.mjs';

test.after(closeBrowser);

const OWNER = ['owner', 'example.com'].join('@');
const ME = { me: { userName: OWNER, displayName: 'Owner' } };
const FULL_MVP_STEPS = ['Use case', 'Data', 'First run', 'Results', 'Deliver', 'Who uses the App', 'App pages and look', 'Run it', 'Summary'];
const next = (page) => page.getByRole('button', { name: 'Next' }).click();
const startButton = (page) => page.getByRole('button', { name: BUILD_IT, exact: true });
const stepLabels = async (page) => (await page.locator('[data-wizard-header] ol li').allTextContents()).map((l) => l.replace(/^\d+\. /, ''));
const summary = (page) => page.getByRole('region', { name: 'What Inspire picked' });
const appRow = (page) => summary(page).locator('[data-picked-row="app"] [data-picked-value]').innerText();
const startOn = (page) => page.waitForFunction((label) => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === label && !b.disabled),
  BUILD_IT, { timeout: 15000 });

function submittedSpec(made) {
  const inserts = made.sqlCalls.filter((c) => String(c.sql).includes('INSERT INTO') && (c.parameters || []).some((p) => p.name === 'spec'));
  assert.equal(inserts.length, 1);
  return JSON.parse(inserts[0].parameters.find((p) => p.name === 'spec').value);
}

test('a fresh MVP shows every step in the step bar, with no shortcut that hides them', async () => {
  const ui = await openUi('wizard', ME);
  const { page } = ui;
  try {
    await goToStep(page, 'Data');
    assert.deepEqual(await stepLabels(page), FULL_MVP_STEPS);
    await goToStep(page, 'Deliver');
    assert.equal(await page.getByRole('button', { name: 'Customize' }).count(), 0);
    await page.getByRole('heading', { name: 'How will people use this use case?' }).waitFor();
    await page.getByRole('checkbox', { name: /^App/ }).first().uncheck();
    assert.deepEqual(await stepLabels(page), FULL_MVP_STEPS.filter((l) => !/App/.test(l)), 'with Apps unticked both App steps are hidden');
    await page.getByRole('checkbox', { name: /^App/ }).first().check();
    assert.deepEqual(await stepLabels(page), FULL_MVP_STEPS);
    await goToStep(page, 'Data');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Data, Results, Run it and App show the business settings and keep the technical ones under Advanced settings until it is opened', async () => {
  const ui = await openUi('wizard', ME);
  const { page } = ui;
  const field = (label) => page.getByLabel(new RegExp(`^${label.replace(/[()]/g, '\\$&')}`));
  const hidden = async (label) => assert.equal(await field(label).count(), 0, `${label} shows before Advanced settings is opened`);
  const shown = (label) => field(label).first().waitFor();
  const open = () => openAdvanced(page);
  try {
    await goToStep(page, 'Data');
    await page.getByRole('heading', { name: 'Source tables' }).waitFor();
    for (const label of ['SQL warehouse', 'Window start', 'Window end', 'Entity key']) await hidden(label);
    await open();
    for (const label of ['SQL warehouse', 'Window start', 'Window end', 'Entity key']) await shown(label);
    for (const step of ['First run', 'Results']) {
      await next(page);
      await onStep(page, step);
    }
    for (const label of ['Table name', 'Catalog', 'Schema']) await shown(label);
    assert.equal(await page.getByRole('group', { name: 'Keep it fresh' }).count(), 0, 'Results holds only where the result table lives');
    assert.equal(await page.getByRole('group', { name: 'Measure impact' }).count(), 0, 'Results holds only where the result table lives');
    await goToStep(page, 'Run it');
    await page.getByRole('checkbox', { name: /^Hold back/ }).check();
    for (const label of ['Share of records held back', 'Cron (Quartz)', 'Timezone']) await hidden(label);
    await open();
    for (const label of ['Share of records held back', 'Cron (Quartz)', 'Timezone']) await shown(label);
    await hidden('Rows the team can act on each run');
    const picker = page.locator('[data-app-warehouse="pick"]');
    await goToStep(page, 'App placement');
    const placed = await page.locator('input[name="app-place"]:checked').getAttribute('value');
    await page.locator('[data-app-place="inspire"] input[type="radio"]').check();
    await page.locator('[data-app-place="inspire"] [data-placement-blurb]').waitFor();
    assert.equal(await picker.count(), 0, 'the App SQL warehouse waits under its own settings on Deliver');
    assert.equal(await page.getByRole('button', { name: 'Advanced settings', exact: true }).count(), 1, 'one Advanced settings on the step (must-exclude: two of the same name)');
    await openAdvanced(page, INSIDE_WAREHOUSE_TOGGLE);
    await picker.waitFor();
    await page.locator(`input[name="app-place"][value="${placed}"]`).check();
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Summary is the last step, lists every pick with a Change link that jumps to its step and comes back, and builds with All Good, Build it Now', async () => {
  const ui = await openUi('wizard', ME);
  const { page } = ui;
  try {
    await goToStep(page, 'Data');
    assert.equal(await summary(page).count(), 0);
    await toSummary(page);
    await summary(page).waitFor();
    const rows = await summary(page).locator('[data-picked-row]').evaluateAll((items) => items.map((r) => r.dataset.pickedRow));
    for (const id of ['outputs', 'data', 'first_run', 'result', 'kpi', 'holdout', 'schedule', 'app', 'app_access', 'app_features', 'app_look']) assert.ok(rows.includes(id), id);
    for (const id of ['capacity', 'settings', 'vibes']) assert.equal(rows.includes(id), false, `${id} is not a Summary row (must-exclude)`);
    assert.equal(await summary(page).locator('[data-picked-change]').count(), rows.length, 'every row has a Change link');
    assert.match(await summary(page).locator('[data-picked-row="outputs"] [data-picked-value]').innerText(), /^The MVP: /);
    assert.match(await summary(page).locator('[data-picked-row="schedule"] [data-picked-value]').innerText(), /^Daily, runs every day at /);
    const result = await summary(page).locator('[data-picked-row="result"] [data-picked-value]').innerText();
    await summary(page).getByRole('button', { name: 'Change Result table' }).click();
    await onStep(page, 'Results');
    await page.getByRole('button', { name: 'Back to Summary' }).click();
    await onStep(page, 'Summary');
    await summary(page).getByRole('button', { name: 'Change What it builds' }).click();
    await goToStep(page, 'What to build');
    await page.getByRole('button', { name: 'Back to Summary' }).click();
    await onStep(page, 'Summary');
    await startOn(page);
    await startButton(page).click();
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    assert.equal(result, submittedSpec(ui.made).config.result_table, 'Summary shows the result table it sends');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the last step with its review and the vibes box stays inside a 1440x900 screen and reads at 4.5:1 in light and dark', async () => {
  const ui = await openUi('wizard', ME);
  const { page } = ui;
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await toSummary(page);
    await summary(page).waitFor();
    await wizardInScreen(page, 'review-summary');
    for (const dark of [false, true]) {
      await setDark(page, dark);
      const result = await lowContrast(page, ['[role="dialog"]']);
      assert.ok(result.checked >= 10, `measured ${result.checked} elements`);
      assert.deepEqual(result.low, [], dark ? 'dark' : 'light');
    }
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

const OTHER_APP = { description: 'Built by someone else', compute_status: { state: 'ACTIVE' } };

async function defaultAppName() {
  const ui = await openUi('wizard', ME);
  try {
    await toSummary(ui.page);
    const name = (await appRow(ui.page)).split(': ').at(-1);
    assert.match(name, /^[a-z0-9-]+$/);
    return name;
  } finally {
    await ui.close();
  }
}

test('a default App name another App already uses is changed to a free one with a suffix, and the build button stays on', async () => {
  const taken = await defaultAppName();
  const ui = await openUi('wizard', { ...ME, appsByName: { [taken]: { name: taken, ...OTHER_APP } } });
  const { page } = ui;
  try {
    await toSummary(page);
    await page.locator('[data-app-renamed]').waitFor({ timeout: 15000 });
    assert.match(await page.locator('[data-app-renamed]').innerText(), new RegExp(`'${taken}' is used by another App.*'${taken}-2'`));
    assert.ok((await appRow(page)).endsWith(`${taken}-2`));
    await startOn(page);
    assert.equal(await page.locator('[data-last-app-name]').count(), 0);
    await startButton(page).click();
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    assert.equal(submittedSpec(ui.made).outputs.app_name, `${taken}-2`);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('an App name that is still refused is named on the last step with the step to fix it on, and fixed right there', async () => {
  const taken = await defaultAppName();
  const names = [taken, ...[2, 3, 4, 5, 6].map((n) => `${taken}-${n}`)];
  const ui = await openUi('wizard', { ...ME, appsByName: Object.fromEntries(names.map((n) => [n, { name: n, ...OTHER_APP }])) });
  const { page } = ui;
  try {
    await toSummary(page);
    const field = page.locator('[data-last-app-name]');
    await field.waitFor({ timeout: 15000 });
    assert.match(await field.innerText(), new RegExp(`'${taken}' is used by another App in this workspace; pick another name`));
    await page.locator('[role="alert"] p', { hasText: '(fix it on Deliver)' }).waitFor();
    assert.equal(await startButton(page).isDisabled(), true);
    await field.locator('input').fill('quality-desk');
    await startOn(page);
    await onStep(page, 'Summary');
    assert.match(await field.innerText(), /'quality-desk' is free/);
    await startButton(page).click();
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    assert.equal(submittedSpec(ui.made).outputs.app_name, 'quality-desk');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the build SQL warehouse is a drop list of names with their state, and a saved id that is not in the list stays and is named', async () => {
  const listed = { warehouses: [{ id: 'wh1', name: 'Shared SQL', state: 'RUNNING' }, { id: 'wh2', name: 'Night SQL', state: 'STOPPED' }] };
  const ui = await openUi('wizard', { ...ME, warehouses: listed });
  const { page } = ui;
  try {
    await goToStep(page, 'Data');
    await openAdvanced(page);
    const pick = page.locator('[data-build-warehouse="pick"] select');
    await pick.locator('option[value="wh2"]').waitFor({ state: 'attached' });
    assert.deepEqual(await pick.locator('option').allTextContents(), ['Shared SQL (RUNNING)', 'Night SQL (STOPPED)']);
    assert.equal(await pick.inputValue(), 'wh1', 'the saved warehouse is chosen by its id');
    assert.equal(await page.locator('[data-build-warehouse-state]').count(), 0, 'a running warehouse needs no note (must-exclude)');
    await pick.selectOption('wh2');
    assert.equal(await page.locator('[data-build-warehouse-state]').innerText(), 'Night SQL is stopped; it starts when the run uses it, which can take a few minutes.');
    assert.equal(await page.getByLabel('SQL warehouse id').count(), 0, 'no free-text id while the list loads (must-exclude)');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
  const gone = await openUi('wizard', { ...ME, warehouses: { warehouses: [{ id: 'wh9', name: 'Other SQL', state: 'RUNNING' }] } });
  try {
    await goToStep(gone.page, 'Data');
    await openAdvanced(gone.page);
    const pick = gone.page.locator('[data-build-warehouse="pick"] select');
    await pick.locator('option[value="wh9"]').waitFor({ state: 'attached' });
    assert.equal(await pick.inputValue(), 'wh1', 'a saved id outside the list is kept, not swapped');
    assert.deepEqual(await pick.locator('option').allTextContents(), ['wh1 (not in your list of SQL warehouses)', 'Other SQL (RUNNING)']);
  } finally {
    await gone.close();
  }
});

test('the build SQL warehouse falls back to a typed id when the list is empty or cannot be read', async () => {
  const empty = await openUi('wizard', { ...ME, warehouses: { warehouses: [] } });
  try {
    await goToStep(empty.page, 'Data');
    await openAdvanced(empty.page);
    await empty.page.locator('[data-build-warehouse="typed"]').waitFor();
    assert.equal(await empty.page.locator('[data-build-warehouse-note]').innerText(), 'Inspire found no SQL warehouse you can use. Type the warehouse id, or ask an admin for CAN USE on one.');
    assert.equal(await empty.page.getByLabel('SQL warehouse id').inputValue(), 'wh1');
  } finally {
    await empty.close();
  }
  const mount = (app) => {
    app.get('/api/warehouses', (_req, res) => res.status(500).json({ error: 'warehouse list is down' }));
  };
  const failed = await openUi('wizard', ME, '', { mount });
  try {
    await goToStep(failed.page, 'Data');
    await openAdvanced(failed.page);
    await failed.page.locator('[data-build-warehouse="typed"]').waitFor();
    assert.equal((await failed.page.locator('[data-build-warehouse-error]').innerText()).split('\n')[0], 'Inspire could not list the SQL warehouses: warehouse list is down. Type the warehouse id instead.');
    assert.equal(await failed.page.locator('[data-build-warehouse-note]').count(), 0, 'the empty-list note stays away while the list failed (must-exclude)');
    assert.equal(await failed.page.locator('[data-build-warehouse="pick"]').count(), 0, 'no drop list without a list (must-exclude)');
    await failed.page.getByLabel('SQL warehouse id').fill(' wh7 ');
    assert.equal(await failed.page.getByLabel('SQL warehouse id').inputValue(), 'wh7');
  } finally {
    await failed.close();
  }
});
