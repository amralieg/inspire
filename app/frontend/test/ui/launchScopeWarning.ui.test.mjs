import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

const LONGER = 'so this run will likely take longer.';
const names = (n, prefix) => Array.from({ length: n }, (_, i) => `${prefix}_${i + 1}`);
const scopeUi = () => openUi('launch', {
  catalogs: ['samples'],
  schemas: { samples: ['bakehouse', 'big'] },
  tables: { 'samples.bakehouse': names(6, 'sales'), 'samples.big': names(12, 'fact') },
});
const warning = (page) => page.getByText(new RegExp(`${LONGER.replace(/\./g, '\\.')}$`));

test('a whole schema of 6 tables raises no take-longer warning, because it is under the table threshold (must-exclude)', async () => {
  const ui = await scopeUi();
  const { page, pageErrors } = ui;
  try {
    await page.locator('button[title="samples"]').click();
    await page.locator('button[title="bakehouse"]').click();
    await page.locator('button[title="sales_6"]').waitFor({ timeout: 15000 });
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(await warning(page).count(), 0);
    assert.equal(await page.getByText('entire schema', { exact: false }).count(), 0);
    assert.deepEqual(pageErrors.filter((line) => !/status of 40[13]/.test(line)), []);
  } finally {
    await ui.close();
  }
});

test('a whole schema over the threshold warns in a full sentence that names the schema and its table count', async () => {
  const ui = await scopeUi();
  const { page } = ui;
  try {
    await page.locator('button[title="samples"]').click();
    await page.locator('button[title="big"]').click();
    const heading = warning(page).first();
    await heading.waitFor({ timeout: 15000 });
    assert.equal(await heading.innerText(), `The schema samples.big holds 12 tables, ${LONGER}`);
  } finally {
    await ui.close();
  }
});

test('a whole catalog warns in a full sentence that starts with a capital letter', async () => {
  const ui = await scopeUi();
  const { page } = ui;
  try {
    await page.locator('button[title="samples"]').click();
    const heading = warning(page).first();
    await heading.waitFor({ timeout: 15000 });
    assert.equal(await heading.innerText(), `The whole catalog samples is in scope, with all its schemas and tables, ${LONGER}`);
  } finally {
    await ui.close();
  }
});
