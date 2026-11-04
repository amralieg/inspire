import test from 'node:test';
import assert from 'node:assert/strict';
import { HARNESS_USE_CASE } from './implementFixtures.js';
import { closeBrowser, customize, lowContrast, onStep, openUi, setDark, startMvp, stepsAre, wizardFits } from './uiSupport.mjs';

test.after(closeBrowser);

const OWNER = ['owner', 'example.com'].join('@');
const ME = { me: { userName: OWNER, displayName: 'Owner' } };
const next = (page) => page.getByRole('button', { name: 'Next' }).click();
const startButton = (page) => page.getByRole('button', { name: 'Start MVP', exact: true });
const footerErrors = (page) => page.locator('[role="alert"] p').allTextContents();

function submittedSpec(made) {
  const inserts = made.sqlCalls.filter((c) => String(c.sql).includes('INSERT INTO') && (c.parameters || []).some((p) => p.name === 'spec'));
  assert.equal(inserts.length, 1);
  return JSON.parse(inserts[0].parameters.find((p) => p.name === 'spec').value);
}

async function toStart(page) {
  await onStep(page, 'Choose');
  await stepsAre(page, ['1. Choose', '2. Vibes', '3. Start MVP']);
  await next(page);
  await onStep(page, 'Vibes');
  await next(page);
  await onStep(page, 'Start MVP');
}

test('a fresh MVP is three steps, Choose, Vibes and Start MVP, and it sends the same plan as walking every step', async () => {
  const quick = await openUi('wizard', ME);
  let quickSpec;
  try {
    await toStart(quick.page);
    const summary = quick.page.getByRole('region', { name: 'What Inspire picked' });
    await summary.waitFor();
    const rows = await summary.locator('[data-quick-row]').evaluateAll((items) => items.map((r) => r.dataset.quickRow));
    assert.deepEqual(rows, ['data', 'result', 'outputs', 'schedule']);
    const result = await summary.locator('[data-quick-row="result"] dd').innerText();
    assert.match(result, /\(change it on Results, under Customize\)$/);
    await quick.page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Start MVP' && !b.disabled),
      null, { timeout: 15000 });
    await startButton(quick.page).click();
    await quick.page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    quickSpec = submittedSpec(quick.made);
    assert.ok(result.startsWith(quickSpec.config.result_table), 'Start MVP shows the result table it sends');
    assert.deepEqual(quick.pageErrors, []);
  } finally {
    await quick.close();
  }
  const full = await openUi('wizard', ME);
  try {
    await startMvp(full.page);
    await full.page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    assert.deepEqual(quickSpec, submittedSpec(full.made), 'the three steps send what Customize and Next on every step send');
    assert.deepEqual(full.pageErrors, []);
  } finally {
    await full.close();
  }
});

test('Customize on Start MVP shows every step, Settings included, and lands on Vibes; Customize is gone after', async () => {
  const ui = await openUi('wizard', ME);
  const { page } = ui;
  try {
    await toStart(page);
    await customize(page);
    await onStep(page, 'Vibes');
    const labels = (await page.locator('[data-wizard-header] ol li').allTextContents()).map((l) => l.replace(/^\d+\. /, ''));
    for (const label of ['Choose', 'Data', 'Results', 'Delivery', 'Settings', 'Vibes']) assert.ok(labels.includes(label), label);
    assert.ok(!labels.includes('Start MVP'), 'Vibes is the last step again, with the Start MVP button');
    assert.equal(await page.locator('[data-wizard-customize]').count(), 0);
    await startButton(page).waitFor();
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a problem on a step the three steps hide is shown on Start MVP with the step to fix it on, and Start MVP stays off', async () => {
  const ui = await openUi('wizard', { ...ME, useCase: { ...HARNESS_USE_CASE, statement: '', Statement: '', business_value: '' } });
  const { page } = ui;
  try {
    await toStart(page);
    await page.waitForFunction(() => [...document.querySelectorAll('[role="alert"] p')].some((p) => p.textContent.includes('under Customize)')),
      null, { timeout: 15000 });
    const shown = await footerErrors(page);
    assert.ok(shown.some((e) => e === 'write the goal sentence (fix it on Data, under Customize)'), shown.join(' | '));
    assert.equal(await startButton(page).isDisabled(), true);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Notebook only keeps its own three steps and shows no Customize', async () => {
  const ui = await openUi('wizard', ME);
  const { page } = ui;
  try {
    await onStep(page, 'Choose');
    await page.getByRole('radio', { name: /^Notebook only/ }).check();
    await stepsAre(page, ['1. Choose', '2. Data', '3. Notebook']);
    assert.equal(await page.locator('[data-wizard-customize]').count(), 0);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('each of the three steps fits a 1440x900 screen with nothing to scroll and reads at 4.5:1 in light and dark', async () => {
  const ui = await openUi('wizard', ME);
  const { page } = ui;
  const check = async (name) => {
    await wizardFits(page, name);
    for (const dark of [false, true]) {
      await setDark(page, dark);
      const result = await lowContrast(page, ['[role="dialog"]']);
      assert.ok(result.checked >= 10, `${name}: measured ${result.checked} elements`);
      assert.deepEqual(result.low, [], `${name} ${dark ? 'dark' : 'light'}`);
    }
    await setDark(page, false);
  };
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await onStep(page, 'Choose');
    await check('quick-choose');
    await next(page);
    await onStep(page, 'Vibes');
    await check('quick-vibes');
    await next(page);
    await onStep(page, 'Start MVP');
    await page.getByRole('region', { name: 'What Inspire picked' }).waitFor();
    await check('quick-start');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
