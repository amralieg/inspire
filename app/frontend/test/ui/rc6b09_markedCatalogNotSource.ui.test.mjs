// RC6-B-09: a catalog marked "Inspire needs access" is never a run source. Clicking or keyboard-selecting it opens it to browse and shows
// the access help, but it is never a Selected Metadata chip, and the scope stays as it was ("Nothing picked yet" when empty).
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, idle, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

const BUSINESS = 'e.g. Contoso, Acme Corp, Retail Division';
const mount = (app) => {
  app.get('/api/catalogs', (_req, res) => res.json({ catalogs: [
    { name: 'main', inspire_readable: true },
    { name: 'ops', inspire_readable: false },
  ], truncated: false }));
  app.get('/api/catalogs/:catalog/schemas', (_req, res) => res.json({ schemas: [] }));
  app.get('/api/tables/:catalog/:schema', (_req, res) => res.json({ tables: [], count: 0, metric_views: [] }));
};

async function open() {
  const ui = await openUi('launch', {}, '', { mount });
  await ui.page.getByPlaceholder(BUSINESS).fill('Acme');
  await ui.page.locator('button[title="ops"]').waitFor({ timeout: 15000 });
  await idle(ui.page);
  return ui;
}

test('RC6-B-09: clicking a marked catalog adds no chip, leaves "Nothing picked yet", and shows the access help', async () => {
  const ui = await open();
  const { page } = ui;
  try {
    await page.locator('button[title="ops"]').click();
    await idle(page);
    assert.equal(await page.getByRole('button', { name: 'Remove ops', exact: true }).count(), 0, 'no ops chip');
    assert.equal(await page.locator('[data-scope-empty]').count(), 1, 'Nothing picked yet stays');
    assert.equal(await page.locator('[data-inspire-access-help="ops"]').count(), 1, 'the access help opens');
  } finally {
    await ui.close();
  }
});

test('RC6-B-09: keyboard-selecting a marked catalog adds no chip and a readable catalog still does (must-keep)', async () => {
  const ui = await open();
  const { page } = ui;
  try {
    await page.locator('button[title="ops"]').focus();
    await page.keyboard.press('Enter');
    await idle(page);
    assert.equal(await page.getByRole('button', { name: 'Remove ops', exact: true }).count(), 0, 'no ops chip');
    assert.equal(await page.locator('[data-scope-empty]').count(), 1);
    assert.equal(await page.locator('[data-inspire-access-help="ops"]').count(), 1);
    await page.locator('button[title="main"]').click();
    await idle(page);
    assert.equal(await page.getByRole('button', { name: 'Remove main', exact: true }).count(), 1, 'a readable catalog is still a chip');
    assert.equal(await page.getByRole('button', { name: 'Remove ops', exact: true }).count(), 0, 'ops is still no chip beside it');
  } finally {
    await ui.close();
  }
});
