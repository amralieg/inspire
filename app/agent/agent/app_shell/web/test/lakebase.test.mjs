import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { appInfo, openApp, pageData, serveDist } from './harness.mjs';
import { backendNotes, backendText } from '../src/freshness.js';

const NOW = Date.parse('2026-10-28T02:00:00Z');
const VIEW = 'main.pricing_lb.n01_u05__trend';
const BACKEND = {
  kind: 'lakebase', pipeline_id: 'pipeline-1',
  tables: { [VIEW]: { pg: 'n01_u05_app.n01_u05__trend', columns: [{ name: 'as_of_date', type: 'DATE' }, { name: 'loss', type: 'DOUBLE' }] } },
  datasets: { n01_u05: { trend: VIEW } },
};
const CATCHING_UP = 'Showing your latest changes from Delta tables until Lakebase syncs them, usually within a few minutes';
const UNREACHABLE = 'This App reads Delta tables because it could not reach Lakebase: the App has no Lakebase database to read: PGHOST, '
  + 'PGDATABASE, PGUSER, LAKEBASE_ENDPOINT is not set, so add its postgres resource';

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

const notes = (page) => page.locator('[data-backend-note]').allInnerTexts();

test('the header names Lakebase and when it synced, and says nothing for a Delta App', () => {
  assert.equal(backendText({ kind: 'lakebase', synced_at: '2026-10-28T01:48:00Z' }, NOW), 'Read from Lakebase, synced 12 min ago');
  assert.equal(backendText({ kind: 'lakebase', synced_at: null }, NOW), 'Read from Lakebase');
  assert.equal(backendText({ kind: 'delta', note: UNREACHABLE }, NOW), '');
  assert.equal(backendText(undefined, NOW), '');
  assert.deepEqual(backendNotes({ kind: 'delta', note: '' }, { catching_up: false }), []);
  assert.deepEqual(backendNotes({ kind: 'lakebase', note: 'Lakebase could not run a query' }, { catching_up: true }),
    ['Lakebase could not run a query', CATCHING_UP]);
  assert.deepEqual(backendNotes(undefined, undefined), []);
});

test('a Lakebase App says so in the header, and says it reads Delta while saved changes wait for a sync', async () => {
  const info = { ...appInfo(), backend: { kind: 'lakebase', note: '', catching_up: false, synced_at: '2026-10-28T01:48:00Z' } };
  let pending = false;
  const routes = {
    page: ({ route, json, seen }) => {
      const body = route.request().postDataJSON();
      seen.pages.push(body);
      return json(200, { ...pageData(body.filters), errors: {}, served: [pending ? 'delta' : 'lakebase'], catching_up: pending });
    },
  };
  const { page, seen, context } = await openApp(browser, served.base, info, { routes, clock: NOW });
  assert.match(await page.locator('.ph-meta').innerText(), / · Read from Lakebase, synced 12 min ago$/);
  assert.deepEqual(await notes(page), []);
  pending = true;
  await page.reload();
  await page.waitForSelector('.kpi-v');
  await page.waitForFunction((text) => [...document.querySelectorAll('[data-backend-note]')].some((n) => n.textContent === text), CATCHING_UP);
  assert.deepEqual(await notes(page), [CATCHING_UP]);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a Lakebase App that cannot reach Lakebase reads Delta and says why on every page', async () => {
  const info = appInfo({ backend: BACKEND });
  assert.equal(info.backend.kind, 'delta');
  const { page, seen, context } = await openApp(browser, served.base, info);
  assert.deepEqual(await notes(page), [UNREACHABLE]);
  assert.doesNotMatch(await page.locator('.ph-meta').innerText(), /Lakebase/);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a Delta App shows no backend note and no Lakebase label', async () => {
  const info = appInfo();
  assert.deepEqual(info.backend, { kind: 'delta', note: '', catching_up: false, synced_at: null });
  const { page, seen, context } = await openApp(browser, served.base, info);
  assert.deepEqual(await notes(page), []);
  assert.doesNotMatch(await page.locator('.ph-meta').innerText(), /Lakebase/);
  assert.deepEqual(seen.errors, []);
  await context.close();
});
