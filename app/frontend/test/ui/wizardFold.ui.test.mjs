import test from 'node:test';
import assert from 'node:assert/strict';
import { GROUPING_INSTRUCTION, GROUPING_PROFILE, HARNESS_USE_CASE, OWNER } from './implementFixtures.js';
import { closeBrowser, goToStep, openUi, profileAt, shot } from './uiSupport.mjs';

test.after(closeBrowser);

const ME = { me: { userName: OWNER, displayName: 'Owner' } };
const next = (page) => page.getByRole('button', { name: 'Next', exact: true }).click();
const withData = { ...ME, useCase: { ...HARNESS_USE_CASE, genie_instruction: GROUPING_INSTRUCTION } };
const WITH_PROFILE = { init: profileAt([], GROUPING_PROFILE) };
const folded = (page, label) => page.locator(`[data-fold-line="${label}"]`).count();

test('steps fold one at a time: the first section opens, Next folds it and opens the next', async () => {
  const ui = await openUi('wizard', withData, '', WITH_PROFILE);
  const { page } = ui;
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await goToStep(page, 'Who uses the App');
    assert.equal(await folded(page, 'Who sees which rows'), 0, 'the first section is open');
    assert.equal(await folded(page, 'What people can do'), 1, 'the later sections are folded');
    assert.equal(await folded(page, 'Page storage'), 1);
    await next(page);
    assert.equal(await folded(page, 'Who sees which rows'), 1, 'Next folds the section it ends');
    assert.equal(await folded(page, 'What people can do'), 0, 'Next opens the following section');
    await next(page);
    assert.equal(await folded(page, 'What people can do'), 1);
    assert.equal(await folded(page, 'Page storage'), 0, 'the storage section opens last');
    await shot(page, 'fold-app-storage', false);
  } finally {
    await page.close();
  }
});

test('Keep it fresh defaults to Daily inside First run, and Run it is not a step', async () => {
  const ui = await openUi('wizard', withData, '', WITH_PROFILE);
  const { page } = ui;
  try {
    await goToStep(page, 'First run');
    assert.equal(await page.locator('[aria-current="step"]').innerText().then((t) => t.includes('First run')), true);
    if (await folded(page, 'Keep it fresh')) await page.getByRole('button', { name: 'Change Keep it fresh', exact: true }).click();
    const daily = page.locator('[data-option="daily"]');
    assert.equal(await daily.getAttribute('aria-pressed'), 'true', 'Daily stays the default');
    assert.equal(await page.locator('[data-option="off"]').innerText().then((t) => t.trim()), 'Run once now', 'the off option reads Run once now');
    assert.equal(await page.locator('[data-wizard-header] ol li', { hasText: 'Run it' }).count(), 0, 'no Run it step (must-exclude)');
  } finally {
    await page.close();
  }
});
