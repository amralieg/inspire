import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appInfo, idle, openApp, pageData, serveDist } from './harness.mjs';

let served;
let browser;
before(async () => { served = await serveDist(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

const REASON = 'No forecast yet: the forecast starts after the last date in the data (2016-02-07)';
const KPIS = [
  { id: 'total_loss', label: 'Loss to discounts', dataset: 'trend', expression: 'SUM(loss)', format: 'currency', currency: 'USD', good: 'down' },
  { id: 'loss_rate', label: 'Loss rate', dataset: 'trend', expression: 'SUM(loss) / NULLIF(SUM(revenue), 0) * 100', format: 'percent', good: 'down' },
  { id: 'next_day', label: 'Trips forecast next day', dataset: 'records', expression: 'COUNT(*)', format: 'integer', good: 'neutral', compare: true },
];

async function open(items, options = {}) {
  const routes = {
    page: ({ route, json, seen }) => {
      const body = route.request().postDataJSON();
      seen.pages.push(body);
      const data = pageData(body.filters);
      return json(200, { ...data, kpis: { ...data.kpis, total_loss: { now: 1234567, before: 1100000 }, next_day: items }, errors: {} });
    },
  };
  const info = appInfo({}, 1, { kpis: KPIS });
  const opened = await openApp(browser, served.base, info, { routes, hash: `#/${info.pages[0].id}/dashboard`, ...options });
  await opened.page.waitForFunction(() => document.querySelectorAll('.kpi .kpi-v').length === 3);
  return opened;
}

const tile = (page) => page.locator('.kpi').nth(2);

test('a forecast KPI with no rows behind it shows no number and says why, instead of a bare 0', async () => {
  const { page, context } = await open({ now: null, before: null, empty: reasonsFor('2016-02-07') });
  await idle(page);
  assert.equal(await tile(page).locator('.kpi-v').innerText(), 'Not recorded');
  assert.equal(await tile(page).locator('.kpi-s').innerText(), REASON);
  assert.equal(await tile(page).locator('[data-empty-reason]').count(), 1);
  await context.close();
});

test('a measured zero with rows behind it stays a 0 with no reason line', async () => {
  const { page, context } = await open({ now: 0, before: 4 });
  await idle(page);
  assert.equal(await tile(page).locator('.kpi-v').innerText(), '0');
  assert.equal(await tile(page).locator('[data-empty-reason]').count(), 0);
  await context.close();
});

// The App's words for each language come from kinds.json's tour registry, the same file the server reads.
const KINDS = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'kinds.json'), 'utf8'));
const LANGUAGES = Object.values(KINDS.tour.languages);
const fill = (text, through) => text.replace('{through}', through);
const reasonsFor = (through) => Object.fromEntries(LANGUAGES.map((l) => [l.code, fill(l.reasons.forecast_not_yet, through)]));

test('a non-English browser reads the forecast reason in its own language, from the App registry', async () => {
  const french = LANGUAGES.find((l) => l.code === 'fr').reasons.forecast_not_yet.replace('{through}', '2016-02-07');
  const { page, context } = await open({ now: null, before: null, empty: reasonsFor('2016-02-07') }, { locale: 'fr-FR' });
  await idle(page);
  assert.equal(await tile(page).locator('[data-empty-reason]').innerText(), french);
  assert.notEqual(french, REASON, 'the French text is not the English one');
  await context.close();
});

test('a browser in a language the App does not carry reads the English reason', async () => {
  const { page, context } = await open({ now: null, before: null, empty: reasonsFor('2016-02-07') }, { locale: 'xx-YY' });
  await idle(page);
  assert.equal(await tile(page).locator('[data-empty-reason]').innerText(), REASON);
  await context.close();
});
