import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { DECIDE, appInfo, idle, openApp, serveDist } from './harness.mjs';
import { CASES, LAYOUT_B_CASES, kindRoutes } from './exampleRoutes.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const LISTS = {
  recommendation_desk: CASES.recommendation_desk,
  process_flow: LAYOUT_B_CASES.process_flow,
  location_view: LAYOUT_B_CASES.location_view,
  network_explorer: LAYOUT_B_CASES.network_explorer,
};

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

function failingRefresh(routes, acts) {
  let broken = false;
  return {
    ...routes,
    records: (ctx) => (broken ? ctx.json(502, { error: 'INSUFFICIENT_PERMISSIONS: the changes view is not granted' }) : routes.records(ctx)),
    'records/act': (ctx) => {
      const out = routes['records/act'](ctx);
      acts.count = (acts.count || 0) + 1;
      broken = true;
      return out;
    },
  };
}

for (const [id, c] of Object.entries(LISTS)) {
  test(`${id}: a decision that fails to refresh keeps the list rows and their decision buttons`, async () => {
    const file = `${id}.json`;
    const info = appInfo(DECIDE, 1, {}, `examples/${file}`);
    const acts = [];
    const routes = failingRefresh(kindRoutes(c.data(), c.rows.map((r) => ({ ...r })), acts, JSON.parse(readFileSync(join(HERE, '..', '..', 'examples', file), 'utf8'))), acts);
    const { page, context, seen } = await openApp(browser, served.base, info, { routes });
    await page.locator('[data-choice-row] [data-choice]').first().waitFor();
    await idle(page);
    const before = await page.locator('[data-choice-row]').count();
    assert.ok(before > 0, 'the list has rows before the decision');
    await page.locator('[data-choice-row] [data-choice]').first().click();
    await idle(page);
    await page.waitForTimeout(300);
    assert.equal(acts.count, 1, 'the decision was written once');
    assert.equal(await page.locator('[data-choice-row]').count(), before, 'no row is lost when the refresh fails');
    assert.ok(await page.locator('[data-choice-row] [data-choice]').count() > 0, 'row decision buttons stay');
    await context.close();
    assert.deepEqual(seen.errors.filter((e) => !/Failed to load resource/.test(e)), []);
  });
}
