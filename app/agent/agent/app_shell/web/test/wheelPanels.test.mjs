import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { FILTERS, appInfo, openApp, serveDist, tracked } from './harness.mjs';
import { dropCopies, fillWithCopies, wheelScrolls } from '../../../../../frontend/test/ui/wheelScroll.mjs';

let served;
let browser;

before(async () => {
  served = await serveDist();
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  served?.close();
});

const copies = (region, item, n) => ({ fill: () => fillWithCopies(region, item, n), unfill: () => dropCopies(region) });
const real = (errors) => errors.filter((e) => !/Failed to load resource/.test(e));

test('the mouse wheel scrolls the Ask Genie conversation to its last message at 1280x800 and 1024x700', async () => {
  const { page, seen, context } = await openApp(browser, served.base, appInfo(), { width: 1280, height: 800, routes: tracked().routes });
  await page.getByRole('button', { name: 'Ask Genie', exact: true }).click();
  const box = page.locator('aside.genie').getByRole('textbox', { name: 'Your question' });
  await box.fill('Which category lost the most?');
  await box.press('Enter');
  const log = page.getByRole('log', { name: 'Genie conversation' });
  await log.locator('.msg--genie .msg-b').first().waitFor({ timeout: 15000 });
  await wheelScrolls(page, log, () => log.locator('[data-wheel-copy]').last(), { name: 'Ask Genie conversation', ...copies(log, ':scope > *', 12) });
  assert.deepEqual(real(seen.errors), []);
  await context.close();
});

test('the mouse wheel scrolls a filter with 500 choices to the last of the 200 it shows at 1280x800 and 1024x700', async () => {
  const many = { filters: FILTERS.filters.map((f) => (f.id === 'category' ? { ...f, options: Array.from({ length: 500 }, (_, i) => `v${String(i).padStart(3, '0')}`), searchable: true } : f)) };
  const { page, seen, context } = await openApp(browser, served.base, appInfo(), { width: 1280, height: 800, routes: tracked({ filters: ({ json }) => json(200, many) }).routes });
  await page.locator('.fld', { hasText: 'Category' }).locator('button.msel').click();
  const pop = page.locator('.msel-pop');
  await page.getByRole('listbox', { name: 'Category' }).getByText('v199', { exact: true }).waitFor({ state: 'attached' });
  assert.equal(await pop.locator('.opt').count(), 200);
  await wheelScrolls(page, pop, () => pop.getByText('v199', { exact: true }), { name: 'filter choices' });
  assert.deepEqual(real(seen.errors), []);
  await context.close();
});
