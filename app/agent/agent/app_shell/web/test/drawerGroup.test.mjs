import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { DECIDE, appInfo, goRail, openApp, pageData, serveDist, TABLE } from './harness.mjs';

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

test('the record drawer of an entity-matching cluster offers Merge group for the cluster, the same action as the cluster bar', async () => {
  const records = ({ route, json, seen }) => {
    const body = route.request().postDataJSON();
    seen.records.push(body);
    const rows = pageData(body.filters).records.rows.slice(0, 4).map((r, i) => ({ ...r, community: 'C1', _inspire_version: String(100 + i) }));
    return json(200, { rows, total: rows.length, offset: 0, limit: body.limit || 25, actions: true, changes: false, summary: null, errors: {} });
  };
  const info = appInfo({ ...DECIDE }, 1, { ...TABLE }, 'examples/entity_matching.json');
  const { page, context } = await openApp(browser, served.base, info, { routes: { records } });
  try {
    await goRail(page, 'work');
    await page.locator('.card--table tbody tr .cell-t').first().waitFor({ timeout: 20000 });
    await page.locator('.cell-t').first().click();
    await page.locator('dialog[open] [data-cluster="C1"]').waitFor({ timeout: 15000 });
    assert.equal(await page.locator('dialog[open] [data-group-merge]').count(), 1, 'the drawer offers Merge group for the cluster');
  } finally {
    await context.close();
  }
});
