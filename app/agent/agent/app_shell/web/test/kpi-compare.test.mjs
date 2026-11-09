import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { appInfo, idle, openApp, pageData, serveDist } from './harness.mjs';

let served;
let browser;
before(async () => { served = await serveDist(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

const KPIS = [
  { id: 'total_loss', label: 'Loss to discounts', dataset: 'trend', expression: 'SUM(loss)', format: 'currency', currency: 'USD', good: 'down' },
  { id: 'loss_rate', label: 'Loss rate', dataset: 'trend', expression: 'SUM(loss) / NULLIF(SUM(revenue), 0) * 100', format: 'percent', good: 'down' },
  { id: 'items', label: 'Items on the list', dataset: 'records', expression: 'COUNT(*)', format: 'integer', good: 'down', compare: true },
];

async function open(items, kpis = KPIS) {
  const routes = {
    page: ({ route, json, seen }) => {
      const body = route.request().postDataJSON();
      seen.pages.push(body);
      const data = pageData(body.filters);
      return json(200, { ...data, kpis: { ...data.kpis, total_loss: { now: 1234567, before: 1100000 }, items }, errors: {} });
    },
  };
  const opened = await openApp(browser, served.base, appInfo({}, 1, { kpis }), { routes });
  await opened.page.waitForFunction(() => document.querySelectorAll('.kpi .kpi-v').length === 3);
  return opened;
}

const itemsTile = (page) => page.locator('.kpi').nth(2).locator('.kpi-s').innerText();
const VS = appInfo({}, 1, { kpis: KPIS }).pages[0].kpis[2].vs;

test('the tile names what it compares with in the one text shell_sql holds', () => {
  assert.equal(VS, 'vs previous run');
});

test('a compared KPI reads its change against the previous run, whatever run dates are picked', async () => {
  const { page, seen, context } = await open({ now: 48, before: 40 });
  assert.equal(await itemsTile(page), `\u25b2 20.0% ${VS}`);
  assert.equal(await page.locator('.kpi .delta.is-bad').count(), 1, 'more items on the list is bad when the KPI says down');
  await page.locator('.fld--range select').selectOption('3m');
  await idle(page);
  assert.deepEqual(seen.pages.at(-1).filters.run_date, { from: '2026-08-01', to: '2026-10-15' });
  assert.equal(await itemsTile(page), `\u25b2 20.0% ${VS}`, 'the comparison never names the picked dates');
  assert.equal(await page.locator('.kpi').first().locator('.kpi-s').innerText(), '\u00a0', 'a KPI without compare shows no change');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a previous run that differs only outside the filter shows no change', async () => {
  const { page, context } = await open({ now: 12, before: 12 });
  assert.equal(await itemsTile(page), '\u25a0 unchanged vs previous run');
  await context.close();
});

test('a change too small to show reads as unchanged, with the marks and words shell_sql holds, never a rise of 0.0%', async () => {
  const shell = appInfo({}, 1, { kpis: KPIS }).pages[0].kpis[2];
  assert.deepEqual(shell.marks, { up: '\u25b2', down: '\u25bc', same: '\u25a0' });
  assert.deepEqual(shell.words, { same: 'unchanged', from_zero: 'from 0', none: 'No earlier run to compare', story_none: 'with no earlier run to compare' });
  for (const [now, before] of [[100.00000001, 100], [250.0000001, 250]]) {
    const { page, context } = await open({ now, before });
    assert.equal(await itemsTile(page), '\u25a0 unchanged vs previous run', `${now} against ${before}`);
    assert.equal(await page.locator('.kpi').nth(2).locator('.delta.is-good, .delta.is-bad').count(), 0, 'no change is neither good nor bad');
    assert.ok((await page.locator('.story').innerText()).includes(`the list holds ${Math.round(now)} items, unchanged on the previous run.`));
    await context.close();
  }
});

test('a real 0.1% change keeps its mark and number, and a zero previous reads from 0, never as no earlier run', async () => {
  const real = await open({ now: 100.1, before: 100 });
  assert.equal(await itemsTile(real.page), `\u25b2 0.1% ${VS}`);
  assert.equal(await real.page.locator('.kpi').nth(2).locator('.delta.is-bad').count(), 1);
  await real.context.close();
  const zero = await open({ now: 4, before: 0 });
  assert.equal(await itemsTile(zero.page), '\u25b2 from 0 vs previous run');
  assert.equal(await zero.page.locator('.kpi').nth(2).locator('.delta.is-bad').count(), 1, 'a rise from 0 is bad when the KPI says down');
  assert.match(await zero.page.locator('.story').innerText(), /the list holds 4 items, up from 0 on the previous run\./);
  await zero.context.close();
});

test('a first run says there is no earlier run to compare, on the tile and in the story', async () => {
  const { page, context } = await open({ now: 48, before: null });
  assert.equal(await itemsTile(page), 'No earlier run to compare');
  assert.match(await page.locator('.story').innerText(), /the list holds 48 items, with no earlier run to compare\./);
  const text = await page.locator('.kpis').innerText();
  assert.doesNotMatch(text, /period|months before/);
  await context.close();
});

test('a compared KPI with a caption still says there is no earlier run on a first run', async () => {
  const captioned = KPIS.map((k) => (k.id === 'items' ? { ...k, caption: 'from the latest run' } : k));
  const { page, context } = await open({ now: 48, before: null }, captioned);
  assert.equal(await itemsTile(page), 'from the latest run \u00b7 No earlier run to compare');
  await context.close();
});

test('a previous run that held 0 reads as a change from 0, never as no earlier run', async () => {
  const { page, context } = await open({ now: 5, before: 0 });
  assert.equal(await itemsTile(page), '\u25b2 from 0 vs previous run');
  assert.match(await page.locator('.story').innerText(), /the list holds 5 items, up from 0 on the previous run\./);
  await context.close();
  const still = await open({ now: 0, before: 0 });
  assert.equal(await itemsTile(still.page), '\u25a0 unchanged vs previous run');
  await still.context.close();
});

test('a story whose number did not load is left out, never read with Not recorded in place of the number', async () => {
  const { page, seen, context } = await open({ now: null, before: null });
  assert.equal(await page.locator('.story').count(), 0);
  assert.doesNotMatch(await page.locator('main').innerText(), /holds Not recorded|Not recorded items/);
  assert.deepEqual(seen.errors, []);
  await context.close();
});
