import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { appInfo, FILTERS, idle, openApp, pageData, serveDist, toastSays, until } from './harness.mjs';
import { VIEWS_KEY, decodeFilters, encodeFilters, parseHash } from '../src/links.js';

let served;
let base;
let browser;

before(async () => {
  served = await serveDist();
  base = served.base;
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  served?.close();
});

const EXAMPLE = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'example_page.json'), 'utf8'));
const LIST = 'Decision list';
const TIERS = ['Act now', 'Review', 'Monitor'];
const CATS = ['Books', 'Music', 'Home', 'Garden', 'Toys', 'Sports'];
const RECORDS = { ...EXAMPLE.records, column_filters: [{ column: 'priority_tier' }, { column: 'category' }, { column: 'value' }] };
const COLUMNS = {
  list: [{ column: 'priority_tier', type: 'multi_select', label: 'Tier', options: TIERS, searchable: false },
    { column: 'category', type: 'multi_select', label: 'Category', options: CATS, searchable: false },
    { column: 'value', type: 'number_range', label: 'Loss' }],
  tables: {},
};
const WORST = { id: 'worst', title: 'Worst categories', dataset: 'trend', columns: [{ column: 'category', label: 'Category', format: 'text' },
  { column: 'loss', label: 'Loss', format: 'currency', currency: 'USD' }], column_filters: [{ column: 'category' }] };
const hashOf = (page) => new URL(page.url()).hash;
const linkOf = (page) => decodeFilters(parseHash(hashOf(page)).f);
const card = (page, name) => page.locator('section.card--table', { has: page.getByRole('heading', { name, exact: true }) });

function lister({ route, json, seen }) {
  const body = route.request().postDataJSON();
  seen.records.push(body);
  const picked = body.column_filters || {};
  const all = pageData(body.filters).records.rows.filter((r) => (!picked.priority_tier || picked.priority_tier.includes(r.priority_tier))
    && (!picked.category || picked.category.includes(r.category))
    && (picked.value?.min == null || r.value >= picked.value.min) && (picked.value?.max == null || r.value <= picked.value.max));
  const offset = body.offset || 0;
  return json(200, { rows: all.slice(offset, offset + (body.limit || 25)), total: all.length, offset, limit: body.limit || 25, actions: false, changes: false,
    summary: null, errors: {} });
}

const routes = (columns) => ({ filters: ({ json }) => json(200, { ...FILTERS, columns }), records: lister });

async function openList(hash = '', columns = COLUMNS, info = appInfo({}, 1, { records: RECORDS })) {
  const opened = await openApp(browser, base, info, { routes: routes(columns), hash, ready: hash ? '.kpi-v' : undefined });
  await card(opened.page, LIST).locator('tbody tr').first().waitFor();
  return opened;
}

const lastList = (seen) => seen.records.at(-1);
const shownTiers = (page) => card(page, LIST).locator('tbody .tier').allInnerTexts();

test('the decision list puts a filter in each filterable column header, and picking Act now with the keyboard narrows the rows and the count', async () => {
  const { page, seen, context } = await openList();
  const list = card(page, LIST);
  assert.deepEqual(await list.locator('thead .cf-b').evaluateAll((all) => all.map((b) => b.getAttribute('aria-label'))),
    ['Filter Category', 'Filter Tier', 'Filter Loss']);
  assert.equal(await list.locator('thead th', { has: page.locator('.cf-b--named') }).locator('.th-sort').textContent(), 'Item');
  assert.match(await list.locator('.card-h p').first().innerText(), /^30 records/);
  const tier = list.getByRole('button', { name: 'Filter Tier' });
  await tier.focus();
  await page.keyboard.press('Enter');
  const pop = page.getByRole('dialog', { name: 'Tier' });
  await pop.waitFor();
  await page.waitForFunction(() => document.activeElement?.type === 'checkbox');
  await page.keyboard.press('Space');
  await until(() => JSON.stringify(lastList(seen).column_filters) === JSON.stringify({ priority_tier: ['Act now'] }));
  await page.keyboard.press('Escape');
  await pop.waitFor({ state: 'detached' });
  assert.match(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), /^Filter Tier, Act now$/);
  await page.waitForFunction(() => /^10 records/.test(document.querySelector('section.card--table .card-h p')?.textContent || ''));
  assert.deepEqual([...new Set(await shownTiers(page))], ['Act now']);
  assert.equal(await list.locator('.cf-n').innerText(), '1 column filter on');
  assert.equal(await list.locator('.cf-b.is-on').count(), 1);
  assert.deepEqual(lastList(seen).filters, { run_date: { from: '2025-11-01', to: '2026-10-15' } }, 'the page filters stay as they were');
  await page.waitForFunction(() => location.hash.includes('f='));
  assert.deepEqual(linkOf(page), { c: { l: { priority_tier: ['Act now'] } } });
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a range on the loss refuses a From above its To, then narrows the list, and Clear filters brings every record back', async () => {
  const { page, seen, context } = await openList();
  const list = card(page, LIST);
  await list.getByRole('button', { name: 'Filter Loss' }).click();
  const pop = page.getByRole('dialog', { name: 'Filter Loss' });
  await pop.getByLabel('From').fill('45000');
  await pop.getByLabel('To').fill('100');
  assert.equal(await pop.getByRole('alert').innerText(), 'The From value is above the To value');
  assert.equal(await pop.getByRole('button', { name: 'Apply' }).isDisabled(), true);
  const asked = seen.records.length;
  await pop.getByLabel('To').fill('');
  await pop.getByRole('button', { name: 'Apply' }).click();
  await until(() => JSON.stringify(lastList(seen).column_filters) === JSON.stringify({ value: { min: 45000, max: null } }));
  assert.ok(seen.records.slice(asked).every((b) => b.column_filters?.value?.max !== 100), 'the refused range was never sent');
  await page.waitForFunction(() => /^6 records/.test(document.querySelector('section.card--table .card-h p')?.textContent || ''));
  assert.equal(await list.getByRole('button', { name: 'Filter Loss, from 45,000' }).count(), 1);
  await list.getByRole('button', { name: 'Filter Category' }).click();
  await page.getByRole('listbox', { name: 'Category' }).getByText('Books').click();
  await page.keyboard.press('Escape');
  await until(() => JSON.stringify(lastList(seen).column_filters) === JSON.stringify({ value: { min: 45000, max: null }, category: ['Books'] }));
  assert.equal(await list.locator('.cf-n').innerText(), '2 column filters on');
  await list.getByRole('button', { name: 'Clear filters' }).click();
  await until(() => !('column_filters' in lastList(seen)));
  await page.waitForFunction(() => /^30 records/.test(document.querySelector('section.card--table .card-h p')?.textContent || ''));
  assert.equal(await list.locator('.cf-n').innerText(), '');
  assert.equal(await list.getByRole('button', { name: 'Clear filters' }).count(), 0);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a link and a saved view carry the column filters, and opening them narrows the list again', async () => {
  const f = encodeFilters({ c: { l: { priority_tier: ['Review'] } } });
  const { page, seen, context } = await openList(`#/n01_u05?f=${f}`);
  await until(() => JSON.stringify(lastList(seen)?.column_filters) === JSON.stringify({ priority_tier: ['Review'] }));
  await page.waitForFunction(() => /^10 records/.test(document.querySelector('section.card--table .card-h p')?.textContent || ''));
  assert.deepEqual([...new Set(await shownTiers(page))], ['Review']);
  assert.equal(await page.locator('.toast').count(), 0);
  await page.getByRole('button', { name: 'Views', exact: true }).click();
  await page.getByRole('dialog', { name: 'Saved views' }).getByRole('button', { name: 'Save this view' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save this view' });
  await dialog.getByRole('textbox', { name: 'Name' }).fill('Review only');
  await dialog.getByRole('button', { name: 'Save view' }).click();
  await toastSays(page, 'Saved the view "Review only"');
  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), VIEWS_KEY);
  assert.deepEqual(stored.n01_u05, [{ name: 'Review only', view: 'overview', filters: { c: { l: { priority_tier: ['Review'] } } } }]);
  await card(page, LIST).getByRole('button', { name: 'Clear filters' }).click();
  await until(() => !('column_filters' in lastList(seen)));
  await page.getByRole('button', { name: 'Views', exact: true }).click();
  await page.getByRole('dialog', { name: 'Saved views' }).getByRole('button', { name: 'Review only', exact: true }).click();
  await toastSays(page, 'Showing the view "Review only"');
  await until(() => JSON.stringify(lastList(seen).column_filters) === JSON.stringify({ priority_tier: ['Review'] }));
  assert.equal(await card(page, LIST).locator('.cf-n').innerText(), '1 column filter on');
  const stale = encodeFilters({ c: { l: { priority_tier: ['Gone'] } } });
  await page.evaluate((h) => { location.hash = h; }, `#/n01_u05?f=${stale}`);
  await toastSays(page, 'Some filters in this link no longer apply');
  await until(() => !('column_filters' in lastList(seen)));
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a page whose tables carry no column filters draws no filter control and sends no column filter', async () => {
  const { page, seen, context } = await openList('', { list: [], tables: {} }, appInfo());
  const list = card(page, LIST);
  await idle(page);
  assert.equal(await list.locator('.cf-b').count(), 0);
  assert.equal(await list.locator('.cf-n').count(), 0);
  assert.equal(await list.getByRole('button', { name: 'Clear filters' }).count(), 0);
  assert.ok(seen.records.length > 0 && seen.records.every((b) => !('column_filters' in b)));
  assert.ok(seen.pages.every((b) => !('table_filters' in b)));
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('an extra table on the page gets the same column filter, which narrows only that table', async () => {
  const info = appInfo({}, 1, { tables: [WORST] });
  const columns = { list: [], tables: { worst: [{ column: 'category', type: 'multi_select', label: 'Category', options: CATS, searchable: false }] } };
  const opened = await openApp(browser, base, info, {
    routes: {
      ...routes(columns),
      page: ({ route, json, seen }) => {
        const body = route.request().postDataJSON();
        seen.pages.push(body);
        const picked = body.table_filters?.worst?.category;
        const rows = CATS.filter((c) => !picked || picked.includes(c)).map((c, i) => ({ category: c, loss: 9000 - i * 100 }));
        return json(200, { ...pageData(body.filters), tables: { worst: { columns: [], rows, truncated: false } }, errors: {} });
      },
    },
  });
  const { page, seen, context } = opened;
  const worst = card(page, 'Worst categories');
  await worst.locator('tbody tr').first().waitFor();
  assert.equal(await worst.locator('tbody tr').count(), 6);
  assert.equal(await card(page, LIST).locator('.cf-b').count(), 0, 'the decision list has no column filters of its own here');
  await worst.getByRole('button', { name: 'Filter Category' }).click();
  await page.getByRole('listbox', { name: 'Category' }).getByText('Toys').click();
  await page.keyboard.press('Escape');
  await until(() => JSON.stringify(seen.pages.at(-1).table_filters) === JSON.stringify({ worst: { category: ['Toys'] } }));
  await page.waitForFunction(() => [...document.querySelectorAll('section.card--table')].some((s) => s.querySelector('h2')?.textContent === 'Worst categories'
    && s.querySelectorAll('tbody tr').length === 1));
  assert.equal(await worst.locator('tbody tr td').first().innerText(), 'Toys');
  assert.equal(await worst.locator('.cf-n').innerText(), '1 column filter on');
  assert.ok(seen.records.every((b) => !('column_filters' in b)), 'a table filter never reaches the decision list');
  assert.deepEqual(linkOf(page), { c: { t: { worst: { category: ['Toys'] } } } });
  await worst.getByRole('button', { name: 'Clear filters' }).click();
  await until(() => !('table_filters' in seen.pages.at(-1)));
  assert.deepEqual(seen.errors, []);
  await context.close();
});
