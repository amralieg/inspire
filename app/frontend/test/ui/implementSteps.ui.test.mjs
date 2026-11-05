import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, lowContrast, onStep, openAdvanced, openUi, setDark, toVibes, wizardFits } from './uiSupport.mjs';

test.after(closeBrowser);

const OWNER = ['owner', 'example.com'].join('@');
const ME = { me: { userName: OWNER, displayName: 'Owner' } };
const FULL_MVP_STEPS = ['Choose', 'Data', 'First run', 'Results', 'Delivery', 'App placement', 'App access', 'App look', 'Settings', 'Vibes'];
const next = (page) => page.getByRole('button', { name: 'Next' }).click();
const startButton = (page) => page.getByRole('button', { name: 'Start MVP', exact: true });
const stepLabels = async (page) => (await page.locator('[data-wizard-header] ol li').allTextContents()).map((l) => l.replace(/^\d+\. /, ''));
const summary = (page) => page.getByRole('region', { name: 'What Inspire picked' });
const appRow = (page) => summary(page).locator('[data-picked-row="app"] dd').innerText();
const startOn = (page) => page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Start MVP' && !b.disabled),
  null, { timeout: 15000 });

function submittedSpec(made) {
  const inserts = made.sqlCalls.filter((c) => String(c.sql).includes('INSERT INTO') && (c.parameters || []).some((p) => p.name === 'spec'));
  assert.equal(inserts.length, 1);
  return JSON.parse(inserts[0].parameters.find((p) => p.name === 'spec').value);
}

test('a fresh Full MVP shows every step in the step bar, with no shortcut that hides them', async () => {
  const ui = await openUi('wizard', ME);
  const { page } = ui;
  try {
    await onStep(page, 'Choose');
    assert.deepEqual(await stepLabels(page), FULL_MVP_STEPS);
    assert.equal(await page.getByRole('button', { name: 'Customize' }).count(), 0);
    await next(page);
    await onStep(page, 'Data');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Data, Results, Delivery, App placement and App access show the business settings and keep the technical ones under Advanced settings until it is opened', async () => {
  const ui = await openUi('wizard', ME);
  const { page } = ui;
  const field = (label) => page.getByLabel(new RegExp(`^${label.replace(/[()]/g, '\\$&')}`));
  const hidden = async (label) => assert.equal(await field(label).count(), 0, `${label} shows before Advanced settings is opened`);
  const shown = (label) => field(label).first().waitFor();
  const open = () => openAdvanced(page);
  try {
    await next(page);
    await onStep(page, 'Data');
    await page.getByRole('heading', { name: 'Source tables' }).waitFor();
    for (const label of ['SQL warehouse id', 'Window start', 'Window end', 'Entity key']) await hidden(label);
    await open();
    for (const label of ['SQL warehouse id', 'Window start', 'Window end', 'Entity key']) await shown(label);
    for (const step of ['First run', 'Results']) {
      await next(page);
      await onStep(page, step);
    }
    await shown('Table name');
    await page.getByRole('checkbox', { name: /^Hold back/ }).check();
    for (const label of ['Catalog', 'Schema', 'Share of records held back', 'Rows the team can act on each run']) await hidden(label);
    await open();
    for (const label of ['Catalog', 'Schema', 'Share of records held back', 'Rows the team can act on each run']) await shown(label);
    await next(page);
    await onStep(page, 'Delivery');
    await page.getByRole('group', { name: 'Keep it fresh' }).waitFor();
    for (const label of ['Cron (Quartz)', 'Timezone']) await hidden(label);
    await open();
    for (const label of ['Cron (Quartz)', 'Timezone']) await shown(label);
    const picker = page.locator('[data-app-warehouse="pick"]');
    await next(page);
    await onStep(page, 'App placement');
    const placed = await page.locator('input[name="app-place"]:checked').getAttribute('value');
    await page.locator('[data-app-place="inspire"] input[type="radio"]').check();
    await page.locator('[data-app-place="inspire"] [data-placement-blurb]').waitFor();
    assert.equal(await picker.count(), 0, 'the App SQL warehouse shows on App placement before Advanced settings is opened');
    await open();
    await picker.waitFor();
    await page.locator(`input[name="app-place"][value="${placed}"]`).check();
    await next(page);
    await onStep(page, 'App access');
    assert.equal(await picker.count(), 0, 'the App SQL warehouse shows on App access before Advanced settings is opened');
    await open();
    await picker.waitFor();
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the last step reviews what Inspire picked, with the step to change each on, and no earlier step shows it', async () => {
  const ui = await openUi('wizard', ME);
  const { page } = ui;
  try {
    await next(page);
    await onStep(page, 'Data');
    assert.equal(await summary(page).count(), 0);
    await toVibes(page);
    await summary(page).waitFor();
    const rows = await summary(page).locator('[data-picked-row]').evaluateAll((items) => items.map((r) => r.dataset.pickedRow));
    assert.deepEqual(rows, ['data', 'result', 'outputs', 'app', 'schedule']);
    const result = await summary(page).locator('[data-picked-row="result"] dd').innerText();
    assert.match(result, /\(change it on Results\)$/);
    await startOn(page);
    await startButton(page).click();
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    assert.ok(result.startsWith(submittedSpec(ui.made).config.result_table), 'the review shows the result table it sends');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Notebook only keeps its own three steps and shows no review', async () => {
  const ui = await openUi('wizard', ME);
  const { page } = ui;
  try {
    await onStep(page, 'Choose');
    await page.getByRole('radio', { name: /^Notebook only/ }).check();
    assert.deepEqual(await stepLabels(page), ['Choose', 'Data', 'Notebook']);
    assert.equal(await summary(page).count(), 0);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the last step with its review fits a 1440x900 screen and reads at 4.5:1 in light and dark', async () => {
  const ui = await openUi('wizard', ME);
  const { page } = ui;
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await toVibes(page);
    await summary(page).waitFor();
    await wizardFits(page, 'review-vibes');
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
    await toVibes(ui.page);
    const name = (await appRow(ui.page)).split(' ')[0];
    assert.match(name, /^[a-z0-9-]+$/);
    return name;
  } finally {
    await ui.close();
  }
}

test('a default App name another App already uses is changed to a free one with a suffix, and Start MVP stays on', async () => {
  const taken = await defaultAppName();
  const ui = await openUi('wizard', { ...ME, appsByName: { [taken]: { name: taken, ...OTHER_APP } } });
  const { page } = ui;
  try {
    await toVibes(page);
    await page.locator('[data-app-renamed]').waitFor({ timeout: 15000 });
    assert.match(await page.locator('[data-app-renamed]').innerText(), new RegExp(`'${taken}' is used by another App.*'${taken}-2'`));
    assert.ok((await appRow(page)).startsWith(`${taken}-2`));
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
    await toVibes(page);
    const field = page.locator('[data-last-app-name]');
    await field.waitFor({ timeout: 15000 });
    assert.match(await field.innerText(), new RegExp(`'${taken}' is used by another App in this workspace; pick another name`));
    await page.locator('[role="alert"] p', { hasText: '(fix it on App placement)' }).waitFor();
    assert.equal(await startButton(page).isDisabled(), true);
    await field.locator('input').fill('quality-desk');
    await startOn(page);
    await onStep(page, 'Vibes');
    assert.match(await field.innerText(), /'quality-desk' is free/);
    await startButton(page).click();
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    assert.equal(submittedSpec(ui.made).outputs.app_name, 'quality-desk');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
