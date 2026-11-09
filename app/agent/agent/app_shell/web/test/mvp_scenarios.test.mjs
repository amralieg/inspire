import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { DECIDE, ROWS, TABLE, appInfo, idle, openApp, pageData, serveDist, tracked } from './harness.mjs';
import { dashboardRoutes, explainerRoutes, forecastRoutes, monitorRoutes, plannerRoutes, scenarioRoutes } from './exampleRoutes.mjs';

let served;
let browser;
before(async () => { served = await serveDist(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

const JUNK = /\bundefined\b|\bNaN\b|\[object Object\]|\{"error"/;
const screenAudit = (page) => page.evaluate(() => ({ scroll: document.documentElement.scrollWidth - window.innerWidth, text: document.body.innerText }));

test('every page kind fits a 1280x800 screen with no sideways scroll and no raw values in what the person reads', async () => {
  const kinds = [['examples/forecast_cockpit.json', forecastRoutes([])], ['examples/planner.json', plannerRoutes([], [])],
    ['examples/monitor_triage.json', monitorRoutes()], ['examples/performance_explainer.json', explainerRoutes()],
    ['examples/dashboard.json', dashboardRoutes([])], ['examples/scenario_lab.json', scenarioRoutes([], [])]];
  for (const [file, routes] of kinds) {
    const info = appInfo(DECIDE, 1, {}, file);
    const { page, seen, context } = await openApp(browser, served.base, info, { routes, width: 1280, height: 800 });
    await page.waitForFunction(() => document.querySelectorAll('[data-section] canvas').length >= 1 || document.querySelector('[data-lever]'));
    await idle(page);
    const { scroll, text } = await screenAudit(page);
    assert.ok(scroll <= 0, `${file}: the page scrolls sideways by ${scroll}px`);
    assert.doesNotMatch(text, JUNK, file);
    assert.equal(await page.locator('[data-section="todo"]').count(), 1, `${file} opens with What to do now`);
    assert.deepEqual(seen.errors, [], file);
    await context.close();
  }
});

test('a list of 10,000 records pages 25 at a time and says how many there are, with digit grouping', async () => {
  const info = appInfo(DECIDE, 1, TABLE);
  const { routes } = tracked();
  const asked = [];
  routes.records = ({ route, json, seen }) => {
    const body = route.request().postDataJSON();
    seen.records.push(body);
    asked.push(body.offset || 0);
    const rows = Array.from({ length: Math.min(body.limit || 25, 10000 - (body.offset || 0)) }, (_, i) => {
      const n = (body.offset || 0) + i;
      return { ...ROWS[n % ROWS.length], record_key: `R${n}`, _inspire_key: `R${n}`, entity_id: `R${n}`, entity_label: `Item number ${n + 1}` };
    });
    return json(200, { rows, total: 10000, offset: body.offset || 0, limit: body.limit || 25, actions: true, changes: true,
      summary: { open: 0, done: 0, resolved: 0, left: 0, owners: [] }, errors: {} });
  };
  const { page, seen, context } = await openApp(browser, served.base, info, { routes, width: 1280, height: 800 });
  await page.getByText('Item number 1', { exact: true }).first().waitFor();
  const main = await page.locator('main').innerText();
  assert.match(main, /10,000/);
  assert.doesNotMatch(main, /\b10000\b/, 'counts are grouped');
  assert.equal(await page.locator('tbody tr').filter({ hasText: /^Item number|Item number \d+/ }).count() <= 25, true, 'one page of rows, never all 10,000');
  assert.match(await page.locator('[data-todo-count]').innerText(), /^10,000 of 10,000 waiting for you$/);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a slow warehouse shows the page loading, never an error, and then the numbers', async () => {
  const info = appInfo();
  let release;
  const held = new Promise((r) => { release = r; });
  const { routes } = tracked();
  const pageRoute = async ({ route, json, seen }) => {
    await held;
    seen.pages.push(route.request().postDataJSON());
    return json(200, { ...pageData({}), errors: {} });
  };
  const opened = openApp(browser, served.base, info, { routes: { ...routes, page: pageRoute }, width: 1280, height: 800, ready: 'main' });
  const { page, seen, context } = await opened;
  await new Promise((r) => setTimeout(r, 3000));
  const waiting = await page.locator('main').innerText();
  assert.doesNotMatch(waiting, /could not|failed|error/i, 'a slow answer is not an error');
  assert.ok(await page.locator('[aria-busy="true"], .skel, .skeleton').count() > 0, 'the page shows it is loading');
  release();
  await page.locator('.kpi-v').first().waitFor({ timeout: 15000 });
  assert.doesNotMatch(await page.locator('main').innerText(), JUNK);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a list the App may not read says so in a sentence, never raw JSON, and offers no action on rows it cannot see', async () => {
  const info = appInfo(DECIDE, 1, TABLE);
  const { routes } = tracked();
  routes.records = ({ json }) => json(403, { error: 'This App may not read part of its data yet: ask a data owner to give it SELECT on c.s.orders' });
  const { page, seen, context } = await openApp(browser, served.base, info, { routes, width: 1280, height: 800, ready: 'main' });
  await page.getByText(/may not read part of its data/).first().waitFor();
  const text = await page.locator('main').innerText();
  assert.doesNotMatch(text, JUNK);
  assert.equal(await page.locator('[data-act-all], [data-accept], [data-bulk]').count(), 0);
  assert.equal(await page.locator('[data-todo-count]').count(), 0, 'no count of records the App could not read');
  assert.ok(seen.errors.every((e) => /403/.test(e)), seen.errors.join('\n'));
  await context.close();
});

test('an empty run says the list is empty, offers no bulk action and counts nothing as waiting', async () => {
  const info = appInfo(DECIDE, 1, TABLE);
  const { routes } = tracked();
  routes.records = ({ route, json, seen }) => {
    const body = route.request().postDataJSON();
    seen.records.push(body);
    return json(200, { rows: [], total: 0, offset: 0, limit: body.limit || 25, actions: true, changes: true,
      summary: { open: 0, done: 0, resolved: 0, left: 0, owners: [] }, errors: {} });
  };
  const { page, seen, context } = await openApp(browser, served.base, info, { routes, width: 1280, height: 800, ready: 'main' });
  await page.locator('[data-todo-count]').waitFor();
  assert.equal(await page.locator('[data-todo-count]').innerText(), 'Nothing is waiting for you right now');
  assert.equal(await page.locator('.todo-bar').count(), 0);
  assert.equal(await page.locator('[data-act-all]').count(), 0);
  assert.doesNotMatch(await page.locator('main').innerText(), JUNK);
  assert.deepEqual(seen.errors, []);
  await context.close();
});
