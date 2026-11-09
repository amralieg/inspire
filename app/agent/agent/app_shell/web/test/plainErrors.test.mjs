import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { appInfo, NO_JOB, openApp, serveDist } from './harness.mjs';
import { CODE_ONLY_TEXT, splitTechnical } from '../src/plainText.js';

const DENIED = '[INSUFFICIENT_PERMISSIONS] Insufficient privileges: User does not have SELECT on Table `main`.`sales`.`loss`. Ask the owner to run: GRANT SELECT ON TABLE main.sales.loss TO `sam@example.com` SQLSTATE: 42501';

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

const shown = (page, selector) => page.locator(selector).evaluateAll((els) => els.map((e) => e.innerText));

test('the shell and the Inspire App split errors with one helper', () => {
  const { plain, details } = splitTechnical(DENIED);
  assert.equal(plain, 'Insufficient privileges: User does not have SELECT on Table `main`.`sales`.`loss`. Ask the owner to give you the access listed under Details');
  assert.deepEqual(details, ['GRANT SELECT ON TABLE main.sales.loss TO `sam@example.com`', 'INSUFFICIENT_PERMISSIONS', 'SQLSTATE: 42501']);
  assert.deepEqual(splitTechnical('Keep WEEKS_LEFT under 52'), { plain: 'Keep WEEKS_LEFT under 52', details: [] });
  assert.deepEqual(splitTechnical('Set WEEKS_LEFT'), { plain: 'Set WEEKS_LEFT', details: [] });
  assert.deepEqual(splitTechnical('TABLE_OR_VIEW_NOT_FOUND'), { plain: CODE_ONLY_TEXT, details: ['TABLE_OR_VIEW_NOT_FOUND'] });
  assert.deepEqual(splitTechnical('This chart could not load: TABLE_OR_VIEW_NOT_FOUND'),
    { plain: 'This chart could not load: only an error code came back, listed under Details', details: ['TABLE_OR_VIEW_NOT_FOUND'] });
  assert.deepEqual(splitTechnical('The runs could not load: GET /api/2.2/jobs/runs/list answered HTTP 403: no access'),
    { plain: 'The runs could not load: no access', details: ['GET /api/2.2/jobs/runs/list', 'answered HTTP 403'] });
});

test('a chart that cannot load says so in a sentence and keeps the error code and the grant under Details', async () => {
  const { page, seen, context } = await openApp(browser, served.base, appInfo(), { errors: { 'chart:pareto': DENIED } });
  const card = page.locator('[data-card="pareto"]');
  await card.locator('.tile-err').waitFor();
  const text = await card.locator('.tile-err').innerText();
  assert.match(text, /^This chart could not load: Insufficient privileges/);
  for (const raw of ['INSUFFICIENT_PERMISSIONS', 'GRANT SELECT', 'SQLSTATE']) assert.ok(!text.includes(raw), `${raw} stays out of the sentence: ${text}`);
  const details = card.locator('[data-technical-details]');
  assert.equal(await details.locator('summary').innerText(), 'Details');
  assert.equal(await details.getAttribute('open'), null);
  await details.locator('summary').click();
  assert.match(await details.locator('pre').innerText(), /GRANT SELECT ON TABLE main\.sales\.loss TO `sam@example\.com`/);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('an error without codes shows as it is, with no Details', async () => {
  const { page, context } = await openApp(browser, served.base, appInfo(), { errors: { 'chart:pareto': 'the warehouse is stopped' } });
  await page.locator('[data-card="pareto"] .tile-err').waitFor();
  assert.equal(await page.locator('[data-card="pareto"] .tile-err').innerText(), 'This chart could not load: the warehouse is stopped');
  assert.equal(await page.locator('[data-card="pareto"] [data-technical-details]').count(), 0);
  await context.close();
});

test('an App that cannot start reads as a sentence, and the error code sits under Details', async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.route('**/api/**', (route) => route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: DENIED }) }));
  await page.goto(served.base);
  await page.locator('.fatal').waitFor();
  const said = await shown(page, '.fatal p');
  assert.equal(said.length, 1);
  assert.ok(!/INSUFFICIENT_PERMISSIONS|GRANT|SQLSTATE/.test(said[0]), said[0]);
  assert.match(await page.locator('.fatal [data-technical-details] pre').textContent(), /GRANT SELECT/);
  await context.close();
});

test('the reason a page cannot be refreshed names no job', async () => {
  assert.ok(!/\bjob\b/i.test(NO_JOB.reason), NO_JOB.reason);
  const { page, context } = await openApp(browser, served.base, appInfo());
  const button = page.getByRole('button', { name: 'Refresh now' });
  await button.waitFor();
  assert.equal(await page.locator(`#${await button.getAttribute('aria-describedby')}`).innerText(), NO_JOB.reason);
  await context.close();
});
