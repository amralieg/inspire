import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { appInfo, chartsDrawn, goRail, openApp, pageData, pickCase, serveDist, until } from './harness.mjs';

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

const open = (info, options) => openApp(browser, base, info, options);
const DATA_DOWNLOAD = /csv|download (the )?(data|answer)/i;

test('the page renders KPIs, four charts, the story and the decision list', async () => {
  const info = appInfo();
  assert.deepEqual(info.pages[0].kpis.map((k) => k.vs), ['vs previous run', 'vs previous run', 'vs previous run'],
    'the App tile says what it compares with, in the words shell_sql holds for it');
  const { page, seen, context } = await open(info);
  assert.equal(await page.locator('.ph h1').innerText(), 'Price-loss decision desk');
  assert.deepEqual(await page.locator('.kpi-v').allInnerTexts(), ['$1.23M', '4.2%', '48']);
  const tiles = await page.locator('.kpi').allInnerTexts();
  assert.ok(!tiles.some((t) => /vs the|before|period/.test(t)), 'only a compared KPI shows a change, and only against the previous run');
  assert.match(tiles[2], /from the latest run/, 'a compared KPI with no earlier run keeps its caption');
  assert.match(await page.locator('.story').innerText(), /Discounts cost \$1\.23M in the selected period; the list holds 48 items, with no earlier run to compare\./);
  await page.waitForFunction(chartsDrawn, 4);
  assert.deepEqual(await page.locator('.charts > .card').evaluateAll((cards) => cards.map((c) => c.classList.contains('card--wide'))), [true, false, false, true]);
  await page.locator('[data-rail="work"]').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-work] .card--table tbody tr').length === 25);
  assert.equal(await page.locator('.pager-n').innerText(), 'Showing 1 to 25 of 30');
  assert.deepEqual(seen.pages[0].filters, { run_date: { from: '2025-11-01', to: '2026-10-15' } });
  assert.deepEqual(seen.records.find((r) => r.limit === 25), { page: 'n01_u05', filters: { run_date: { from: '2025-11-01', to: '2026-10-15' } }, ai: {}, search: '',
    offset: 0, limit: 25, mine: false, changed: false }, 'no sort until the person picks one');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('filters change the request, chips clear them, and a record opens its drawer', async () => {
  const { page, seen, context } = await open(appInfo());
  await page.getByRole('button', { name: /^All/ }).first().click();
  await page.getByRole('listbox', { name: 'Category' }).getByText('Music').click();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('.chip'));
  await until(() => JSON.stringify(seen.pages.at(-1)?.filters.category) === JSON.stringify(['Music']));
  await page.waitForFunction(() => document.querySelector('.kpi-v')?.innerText === '$205.8K');
  await page.locator('.fld--range select').selectOption('3m');
  await until(() => seen.pages.at(-1)?.filters.run_date?.from !== '2025-11-01');
  assert.deepEqual(seen.pages.at(-1).filters.run_date, { from: '2026-08-01', to: '2026-10-15' });
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await until(() => seen.pages.at(-1)?.filters.category === undefined);
  await page.locator('[data-rail="work"]').click();
  await page.locator('.cell-t').first().click();
  const drawer = page.locator('dialog.drawer');
  await drawer.waitFor({ state: 'visible' });
  assert.match(await drawer.innerText(), /Cut the standing discount to 10%/);
  assert.match(await drawer.innerText(), /high discount depth/);
  await page.keyboard.press('Escape');
  await drawer.waitFor({ state: 'hidden' });
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a decision list whose rows share a key shows only the rows of the latest answer', async () => {
  const shared = (filters) => {
    const data = pageData(filters);
    const rows = data.records.rows.map((r, i) => ({ ...r, entity_id: `R${i % 10}`, entity_label: `Offer ${i + 1}` }));
    const picked = filters?.category?.length ? rows.filter((r) => filters.category.includes(r.category)) : rows;
    return { ...data, records: { ...data.records, rows: picked } };
  };
  const routes = {
    records: ({ route, json, seen }) => {
      const body = route.request().postDataJSON();
      seen.records.push(body);
      const rows = shared(body.filters).records.rows;
      return json(200, { rows: rows.slice(body.offset, body.offset + body.limit), total: rows.length, offset: body.offset, limit: body.limit, errors: {} });
    },
  };
  const { page, seen, context } = await open(appInfo(), { routes, hash: '#/n01_u05/work' });
  const labels = () => page.locator('.card--table tbody tr .cell-t').allInnerTexts();
  await page.waitForFunction(() => document.querySelectorAll('.card--table tbody tr').length === 25);
  await page.getByRole('button', { name: /^All/ }).first().click();
  await page.getByRole('listbox', { name: 'Category' }).getByText('Music').click();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('.chip'));
  const music = shared({ category: ['Music'] }).records.rows.map((r) => r.entity_label);
  await page.waitForFunction((n) => document.querySelectorAll('.card--table tbody tr').length === n, music.length);
  assert.deepEqual((await labels()).map((t) => t.split('\n')[0]).sort(), [...music].sort());
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.card--table tbody tr').length === 25);
  assert.equal(new Set(await labels()).size, 25);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('Ask Genie shows the step, then streams the answer with its SQL', async () => {
  const { page, seen, context } = await open(appInfo());
  await page.getByRole('button', { name: 'Ask Genie', exact: true }).click();
  await page.getByRole('button', { name: 'Which category lost the most to discounts last quarter?' }).click();
  await page.locator('.g-step').waitFor();
  assert.match(await page.locator('.g-step').innerText(), /Reading your question|Writing the SQL/);
  await page.locator('.cursor').waitFor();
  await page.waitForFunction(() => !document.querySelector('.cursor') && document.querySelector('.msg-sql'), null, { timeout: 15000 });
  assert.match(await page.locator('.msg--genie .msg-b p').innerText(), /^Books lost the most to discounts last quarter, about a third of the total\.$/);
  assert.equal(await page.locator('.msg-t td').first().innerText(), 'Books');
  assert.equal(await page.getByRole('button', { name: 'Download answer' }).count(), 0);
  assert.equal(seen.asks[0].question, 'Which category lost the most to discounts last quarter?');
  await page.locator('.g-in input').fill('And by channel?');
  await page.locator('.g-in button').click();
  await page.waitForFunction(() => document.querySelectorAll('.msg--genie .msg-sql').length === 2, null, { timeout: 15000 });
  assert.equal(seen.asks[1].conversation_id, 'c1');
  const second = page.locator('.msg--genie .msg-b').nth(1);
  assert.equal(await second.locator('.msg-h').innerText(), 'By channel');
  assert.deepEqual(await second.locator('li').allInnerTexts(), ['Online: 180,000', 'Stores: 120,000']);
  assert.deepEqual(await second.locator('strong').allInnerTexts(), ['more', 'Online', 'Stores']);
  assert.deepEqual(await second.locator('code').allInnerTexts(), ['180,000', '120,000']);
  const shown = await second.innerText();
  for (const raw of ['**', '`', '###', '- ']) assert.ok(!shown.includes(raw), `the answer never shows ${raw}`);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('Ask Genie off shows the reason and blocks the input', async () => {
  const { page, context } = await open(appInfo({ genie: null, genie_note: 'The Genie Agent did not build: the warehouse was stopped.' }));
  await page.getByRole('button', { name: 'Ask Genie', exact: true }).click();
  assert.match(await page.locator('.g-off').innerText(), /warehouse was stopped/);
  assert.equal(await page.locator('.g-in input').isDisabled(), true);
  await context.close();
});

test('image export follows the auth mode and the App offers no data download', async () => {
  let { page, seen, context } = await open(appInfo());
  await page.waitForFunction(chartsDrawn, 4);
  assert.equal(await page.getByRole('button', { name: DATA_DOWNLOAD }).count(), 0);
  await page.getByRole('button', { name: 'Export Where the loss sits' }).click();
  assert.deepEqual(await page.getByRole('menuitem').allInnerTexts(), ['Download PNG', 'Download SVG']);
  assert.equal(await page.getByRole('menuitem', { name: DATA_DOWNLOAD }).count(), 0);
  const png = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Download PNG' }).click();
  assert.equal((await png).suggestedFilename(), 'n01_u05_by_category.png');
  assert.deepEqual(seen.errors, []);
  await context.close();

  ({ page, context } = await open(appInfo({ auth: 'user' })));
  assert.equal(await page.getByRole('button', { name: /^Export / }).count(), 0);
  await page.locator('[data-rail="settings"]').click();
  assert.match(await page.locator('[data-settings] .auth').textContent(), /Your view/);
  await context.close();
});

test('a time chart of run dates exported as SVG keeps its last date label inside the image', async () => {
  const days = ['2026-07-15', '2026-08-15', '2026-09-15', '2026-10-15'];
  const routes = { page: ({ route, json, seen }) => {
    const body = route.request().postDataJSON();
    seen.pages.push(body);
    const data = pageData(body.filters);
    return json(200, { ...data, charts: { ...data.charts, loss_trend: { columns: [], rows: days.map((x, i) => ({ x, y0: 90000 + i * 4000 })), truncated: false } }, errors: {} });
  } };
  const { page, seen, context } = await open(appInfo(), { routes });
  await page.waitForFunction(chartsDrawn, 4);
  await page.getByRole('button', { name: 'Export Loss to discounts by month' }).click();
  const file = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Download SVG' }).click();
  const svg = await readFile(await (await file).path(), 'utf8');
  const width = Number(/<svg width="(\d+)"/.exec(svg)[1]);
  const last = Number(/translate\(([\d.]+) [\d.]+\)"[^>]*>Oct 15, 2026<\/text>/.exec(svg)[1]);
  assert.ok(last + ('Oct 15, 2026'.length * 5) / 2 <= width, `the last date label is cut off: centre ${last} of ${width}`);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the three styles and dark mode apply their tokens', async () => {
  for (const style of ['a', 'b', 'c']) {
    const { page, seen, context } = await open(appInfo({ style }));
    assert.equal(await page.evaluate(() => document.documentElement.dataset.look), style);
    assert.equal(await page.locator('form.ask').count(), style === 'c' ? 1 : 0);
    const light = await page.evaluate(() => getComputedStyle(document.querySelector('.kpi')).backgroundColor);
    await goRail(page, 'settings');
    await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
    await goRail(page, 'dashboard');
    await page.waitForSelector('.kpi-v');
    const dark = await page.evaluate(() => getComputedStyle(document.querySelector('.kpi')).backgroundColor);
    if (style !== 'c') assert.notEqual(light, dark);
    await page.reload();
    await page.waitForSelector('.kpi-v');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
    assert.deepEqual(seen.errors, []);
    await context.close();
  }
});

test('the App opens on the first use case dashboard, #/home opens the last one used, and the switcher moves between use cases', async () => {
  const { page, seen, context } = await open(appInfo({}, 2));
  await page.waitForFunction(() => location.hash === '#/n01_u05/dashboard' && document.querySelector('.ph h1')?.textContent === 'Price-loss decision desk');
  assert.equal(await page.locator('.hcard, .crumb').count(), 0);
  await pickCase(page, 'Second desk 1');
  await page.waitForFunction(() => document.querySelector('.ph h1')?.textContent === 'Second desk 1');
  await until(() => seen.pages.some((p) => p.page === 'n02_u01'));
  assert.equal(seen.pages.at(-1).page, 'n02_u01');
  assert.match(page.url(), /#\/n02_u01\/dashboard$/);
  await page.goto(`${base}#/home`);
  await page.waitForFunction(() => location.hash === '#/n02_u01/dashboard');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a phone screen has no sideways scroll and stacks the charts', async () => {
  const { page, seen, context } = await open(appInfo({ layout: 'sidebar' }, 2), { width: 390, height: 844 });
  await page.goto(`${base}#/n01_u05`);
  await page.waitForFunction(chartsDrawn, 4);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  const columns = await page.evaluate(() => getComputedStyle(document.querySelector('.charts')).gridTemplateColumns.split(' ').length);
  assert.equal(columns, 1);
  assert.equal(await page.locator('.side').evaluate((el) => el.getBoundingClientRect().right <= 0), true);
  await page.getByRole('button', { name: 'Open the sections' }).click();
  await page.waitForFunction(() => document.querySelector('.side').getBoundingClientRect().left >= 0);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a failed tile says why while the rest of the page renders', async () => {
  const { page, seen, context } = await open(appInfo(), { width: 1280, errors: { 'chart:pareto': 'TABLE_OR_VIEW_NOT_FOUND' } });
  await page.waitForSelector('.tile-err');
  assert.equal(await page.locator('[data-card="pareto"] .tile-err').innerText(), 'This chart could not load: only an error code came back, listed under Details');
  assert.equal(await page.locator('[data-card="pareto"] [data-technical-details] pre').textContent(), 'TABLE_OR_VIEW_NOT_FOUND');
  await page.waitForFunction(chartsDrawn, 3);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a 401 from the App shows the sign-in message', async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.route('**/api/**', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'sign in to the workspace to see this App' }) }));
  await page.goto(base);
  await page.waitForSelector('.fatal');
  assert.match(await page.locator('.fatal').innerText(), /Sign in to see this App/);
  await context.close();
});
