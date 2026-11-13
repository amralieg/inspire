// v1.5.3-rc.2 (REQ-164): the Launch button never shows "Starting the run…" forever. A backend that never answers ends in the reason.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FAKE_CLOCK, closeBrowser, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

const PICK = async (page) => {
  await page.getByPlaceholder('e.g. Contoso, Acme Corp, Retail Division').fill('Acme');
  await page.locator('button[title="main"]').click();
  await page.locator('button[title="s"]').click();
  await page.locator('button[title="orders"]').click();
};

test('a launch whose check never answers ends the spinner with the reason, and the button is usable again', async () => {
  const ui = await openUi('launch', { catalogs: ['main'], schemas: { main: ['s'] }, tables: { 'main.s': ['orders'] }, checkHold: true }, '', { ...FAKE_CLOCK });
  const { page, pageErrors, made } = ui;
  try {
    await PICK(page);
    const button = page.getByRole('button', { name: /Get Started|Starting the run/ });
    await page.getByRole('button', { name: 'Get Started' }).click();
    await page.getByText('Starting the run…').waitFor({ timeout: 15000 });
    await page.clock.fastForward(241000);
    await page.getByText(/did not answer within 4 minutes/).waitFor({ timeout: 15000 });
    assert.equal(await page.getByText('Starting the run…').count(), 0, 'the spinner stops at the deadline (must-exclude)');
    assert.match(await button.first().innerText(), /Get Started/);
    assert.equal(made.launches.length, 0, 'no launch was sent after the check stalled');
    assert.deepEqual(pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a launch the backend refuses shows the backend reason and stops the spinner at once', async () => {
  const ui = await openUi('launch', { catalogs: ['main'], schemas: { main: ['s'] }, tables: { 'main.s': ['orders'] },
    runAnswer: [400, { error: 'Cluster configuration is invalid for this workspace' }] }, '', { ...FAKE_CLOCK });
  const { page, made } = ui;
  try {
    await PICK(page);
    await page.getByRole('button', { name: 'Get Started' }).click();
    await page.getByText('Cluster configuration is invalid for this workspace').waitFor({ timeout: 15000 });
    assert.equal(await page.getByText('Starting the run…').count(), 0);
    assert.equal(made.launches.length, 1);
  } finally {
    await ui.close();
  }
});
