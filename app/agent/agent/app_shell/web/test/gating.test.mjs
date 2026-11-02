import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { TABLE, appInfo, chartsDrawn, openApp, serveDist } from './harness.mjs';

const ALL_ON = { modify: true, replace_edits: true, decisions: true };
const DATA_DOWNLOAD = /csv|download (the )?(data|answer)/i;
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

async function askOnce(page) {
  await page.getByRole('button', { name: 'Ask Genie', exact: true }).click();
  await page.getByRole('button', { name: 'Which category lost the most to discounts last quarter?' }).click();
  await page.waitForFunction(() => !document.querySelector('.cursor') && document.querySelector('.msg-sql'), null, { timeout: 15000 });
}

const watchDownloads = (page) => {
  const asked = [];
  page.on('request', (r) => { if (/\/api\/download\b/.test(r.url())) asked.push(r.url()); });
  return asked;
};

test('a per-user App shows no download and no chart export anywhere', async () => {
  const info = appInfo({ auth: 'user', options: { ...ALL_ON, decisions: false } }, 1, TABLE);
  assert.deepEqual([info.options.decisions, info.image_export, info.options.modify], [false, false, true]);
  assert.equal('download' in info.options, false);
  const { page, seen, context } = await openApp(browser, served.base, info);
  const asked = watchDownloads(page);
  await page.waitForFunction(chartsDrawn, 4);
  assert.equal(await page.getByRole('button', { name: /Download/ }).count(), 0);
  assert.equal(await page.getByRole('button', { name: /^Export / }).count(), 0);
  await askOnce(page);
  assert.equal(await page.getByRole('button', { name: DATA_DOWNLOAD }).count(), 0);
  assert.deepEqual(asked, []);
  assert.match(await page.locator('.auth').innerText(), /Your view/);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a shared-view App with every option on exports images but never the data', async () => {
  const on = await openApp(browser, served.base, appInfo({ options: ALL_ON }, 1, TABLE));
  const asked = watchDownloads(on.page);
  await on.page.waitForFunction(chartsDrawn, 4);
  assert.equal(await on.page.getByRole('button', { name: DATA_DOWNLOAD }).count(), 0);
  await on.page.getByRole('button', { name: 'Export Where the loss sits' }).click();
  assert.deepEqual(await on.page.getByRole('menuitem').allInnerTexts(), ['Download PNG', 'Download SVG']);
  await on.page.keyboard.press('Escape');
  await askOnce(on.page);
  assert.equal(await on.page.getByRole('button', { name: DATA_DOWNLOAD }).count(), 0);
  assert.equal(await on.page.getByText(DATA_DOWNLOAD).count(), 0);
  assert.deepEqual(asked, []);
  assert.deepEqual(on.seen.errors, []);
  await on.context.close();
});

test('an App settings file that still offers downloads fails loudly instead of loading', () => {
  assert.throws(() => appInfo({ options: { ...ALL_ON, download: false } }), /the App options name download, which the App does not offer/);
  assert.throws(() => appInfo({ options: { ...ALL_ON, download: true } }), /the App options name download, which the App does not offer/);
});
