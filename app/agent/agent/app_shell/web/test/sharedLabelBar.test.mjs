import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { FILTERS, appInfo, idle, openApp, pageData, serveDist, until } from './harness.mjs';

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

const CATS = ['Books', 'Music', 'Home', 'Garden', 'Toys', 'Sports'];
const WORST = { id: 'worst', title: 'Worst categories', dataset: 'trend', columns: [{ column: 'category', label: 'Category', format: 'text' },
  { column: 'loss', label: 'Loss', format: 'currency', currency: 'USD' }], column_filters: [{ column: 'category' }] };
const SHARES = { id: 'shares', title: 'Shares by category', dataset: 'trend', columns: [{ column: 'category', label: 'Category', format: 'text' },
  { column: 'loss', label: 'Loss', format: 'currency', currency: 'USD' }], column_filters: [{ column: 'category' }] };
const COLUMN = { type: 'multi_select', label: 'Category', options: CATS, searchable: false };

const card = (page, name) => page.locator('section.card--table', { has: page.getByRole('heading', { name, exact: true }) });

function pagedTables(route, json, seen) {
  const body = route.request().postDataJSON();
  seen.pages.push(body);
  const picked = body.table_filters?.worst?.category || body.table_filters?.shares?.category || null;
  const rows = (values) => CATS.filter((v) => !picked || picked.includes(v)).map((v, i) => ({ category: v, loss: 9000 - i * 100 }));
  return json(200, { ...pageData(body.filters), tables: { worst: { columns: [], rows: rows(), truncated: false }, shares: { columns: [], rows: rows(), truncated: false } }, errors: {} });
}

test('two tables that filter the same label show one Category filter in the bar, and a choice there narrows both tables', async () => {
  const columns = { list: [], tables: { worst: [{ column: 'category', ...COLUMN }], shares: [{ column: 'category', ...COLUMN }] } };
  const info = appInfo({}, 1, { tables: [WORST, SHARES] });
  const routes = {
    filters: ({ json }) => json(200, { filters: FILTERS.filters.filter((f) => f.type === 'date_range'), columns }),
    page: ({ route, json, seen }) => pagedTables(route, json, seen),
  };
  const opened = await openApp(browser, served.base, info, { routes });
  const { page, seen, context } = opened;
  try {
    await card(page, 'Worst categories').locator('tbody tr').first().waitFor();
    await card(page, 'Shares by category').locator('tbody tr').first().waitFor();
    await idle(page);
    const bar = page.locator('.fbar');
    assert.equal(await bar.locator('span', { hasText: /^Category$/ }).count(), 1, 'the bar shows one Category filter');
    await page.locator('.fbar .fld').filter({ hasText: /^Category/ }).locator('.msel').click();
    await page.getByRole('listbox', { name: 'Category' }).getByText('Toys').click();
    await page.keyboard.press('Escape');
    await until(() => JSON.stringify(seen.pages.at(-1).table_filters?.worst?.category) === JSON.stringify(['Toys']));
    assert.deepEqual(seen.pages.at(-1).table_filters, { worst: { category: ['Toys'] }, shares: { category: ['Toys'] } }, 'the bar choice reaches both tables: ' + JSON.stringify(seen.pages.map((b) => b.table_filters)));
    assert.deepEqual(seen.pages.at(-1).table_filters, { worst: { category: ['Toys'] }, shares: { category: ['Toys'] } },
      'both tables get the bar choice as their own column filter');
    await page.waitForFunction(() => [...document.querySelectorAll('section.card--table')].every((s) => s.querySelectorAll('tbody tr').length === 1));
    assert.equal(await card(page, 'Worst categories').locator('tbody tr td').first().innerText(), 'Toys');
    assert.equal(await card(page, 'Shares by category').locator('tbody tr td').first().innerText(), 'Toys');
  } finally {
    await context.close();
  }
});
