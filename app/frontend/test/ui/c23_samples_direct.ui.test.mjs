import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, idle, openUi, until } from './uiSupport.mjs';

test.after(closeBrowser);

const BUSINESS = 'e.g. Contoso, Acme Corp, Retail Division';
const STATE = {
  catalogs: ['samples', 'main'],
  schemas: { samples: ['bakehouse'], main: ['inspire'] },
  tables: { 'samples.bakehouse': ['sales_transactions', 'trips'], 'main.inspire': ['notes'] },
};

test('a run on samples shows no "Samples cannot measure value" panel and no Copy button, and Get Started sends the samples pick', async () => {
  const ui = await openUi('launch', STATE);
  const { page, made } = ui;
  try {
    await page.getByPlaceholder(BUSINESS).fill('Acme');
    await page.locator('button[title="main"]').click();
    await page.locator('button[title="samples"]').click();
    await page.locator('button[title="samples.bakehouse"]').click();
    await page.locator('button[title="sales_transactions"]').click();
    await page.locator('button[title="main"]').click();
    await idle(page);
    assert.equal(await page.getByText('Samples cannot measure value').count(), 0, 'no cannot-measure-value panel');
    assert.equal(await page.locator('[data-samples-offer]').count(), 0);
    assert.equal(await page.locator('[data-samples-copy]').count(), 0, 'no Copy button');
    assert.equal(await page.getByRole('button', { name: /Copy into/ }).count(), 0);
    await until(async () => !(await page.getByRole('button', { name: 'Get Started' }).isDisabled()), 'Get Started is ready with no samples choice');
    await page.getByRole('button', { name: 'Get Started' }).click();
    await page.locator('[data-launch-run-unsaved]').click();
    await until(() => made.launches.length === 1, 'the run was sent once');
    assert.equal(made.launches[0].params['01_uc_metadata'], 'samples.bakehouse.sales_transactions');
  } finally {
    await ui.close();
  }
});
