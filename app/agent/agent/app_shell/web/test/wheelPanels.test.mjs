import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { FILTERS, appInfo, openApp, serveDist, tracked } from './harness.mjs';
import { STREAMED_ANSWER, dropCopies, fillWithCopies, followsOnlyAtBottom, wheelScrolls } from '../../../../../frontend/test/ui/wheelScroll.mjs';

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

test('Ask Genie follows a streaming answer only while the person is at the bottom, and wheel up keeps their place with a New messages button', async () => {
  const streamed = { 'genie/message': ({ json }) => json(200, { state: 'done', text: STREAMED_ANSWER, sql: 'SELECT 1', columns: [], rows: [], truncated: false }) };
  const { page, seen, context } = await openApp(browser, served.base, appInfo(), { width: 1024, height: 700, routes: tracked(streamed).routes });
  await page.getByRole('button', { name: 'Ask Genie', exact: true }).click();
  const box = page.locator('aside.genie').getByRole('textbox', { name: 'Your question' });
  await box.fill('List every line');
  await box.press('Enter');
  await followsOnlyAtBottom(page, page.getByRole('log', { name: 'Genie conversation' }), 'Ask Genie');
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

test('the mouse wheel scrolls a chart Export menu to its last item at 1280x800 and 1024x700', async () => {
  const { page, seen, context } = await openApp(browser, served.base, appInfo(), { width: 1280, height: 800, routes: tracked().routes });
  await page.getByRole('button', { name: 'Export Where the loss sits' }).click();
  const menu = page.getByRole('menu', { name: 'Export Where the loss sits' });
  await menu.waitFor();
  const list = menu.locator('.menu-list');
  await wheelScrolls(page, menu, () => list.locator('[data-wheel-copy]').last(), { name: 'chart Export menu', ...copies(list, ':scope > *', 30) });
  const box = await menu.boundingBox();
  const { height } = page.viewportSize();
  assert.ok(box.y >= 0 && box.y + box.height <= height, `the menu stays on the screen ${JSON.stringify(box)}`);
  assert.deepEqual(real(seen.errors), []);
  await context.close();
});
