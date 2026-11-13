import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, idle, openUi, until } from './uiSupport.mjs';

test.after(closeBrowser);

const BUSINESS = 'e.g. Contoso, Acme Corp, Retail Division';
const ORDERS = 'main.s.orders';
const STATE = {
  catalogs: ['main'],
  schemas: { main: ['s'] },
  tables: { 'main.s': ['orders', 'customers'] },
  columnsByTable: { 'main.s.orders': [{ column_name: 'brand_name', data_type: 'STRING', ordinal_position: 1 }] },
};

const launchOf = async (page, made) => {
  await idle(page);
  const block = await page.locator('#launch-block').count() ? await page.locator('#launch-block').innerText() : '';
  const btn = page.getByRole('button', { name: 'Get Started' });
  assert.equal(await btn.isDisabled(), false, `Get Started is disabled (block: '${block}', described by: ${await btn.getAttribute('aria-describedby')})`);
  const before = made.launches.length;
  await btn.click();
  await until(() => made.launches.length === before + 1, 'the launch was sent once');
  return made.launches[made.launches.length - 1].params;
};

test('a table picked under a picked schema is the whole scope, and removing the schema chip keeps that table (v1.5.3-rc.1)', async () => {
  const ui = await openUi('launch', STATE);
  const { page, made } = ui;
  try {
    await page.getByPlaceholder(BUSINESS).fill('Acme');
    await page.locator('button[title="main"]').click();
    await page.locator('button[title="s"]').click();
    await page.locator('button[title="orders"]').click();
    await idle(page);
    assert.equal((await launchOf(page, made))['01_uc_metadata'], ORDERS, 'only the picked table, with its schema and catalog chips on');
    await page.getByRole('button', { name: 'Remove main.s', exact: true }).click();
    await idle(page);
    assert.equal((await launchOf(page, made))['01_uc_metadata'], ORDERS, 'removing the schema chip does not drop the table the person picked');
  } finally {
    await ui.close();
  }
});
