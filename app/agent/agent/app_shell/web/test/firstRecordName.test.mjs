import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { appInfo, openApp, serveDist } from './harness.mjs';
import { EXAMPLES } from './exampleRoutes.mjs';

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

test('the first-record step never names a record by its raw key when the record has no label', async () => {
  const ex = EXAMPLES['network_explorer.json'];
  const info = appInfo(ex.settings, 1, {}, 'examples/network_explorer.json');
  const base = ex.routes();
  const routes = { ...base, records: (arg) => base.records({ ...arg, json: (status, data) => arg.json(status, { ...data, rows: data.rows.map(({ entity_label: _label, ...row }) => row) }) }) };
  const { page, context, seen } = await openApp(browser, served.base, info, { routes });
  await ex.ready(page);
  const todo = await page.locator('[data-section="todo"]').innerText();
  assert.doesNotMatch(todo, /Start with [A-Z]+\d+/, `the step names a raw id: ${todo.replace(/\n+/g, ' | ')}`);
  assert.match(todo, /Start with the first record on the list/);
  assert.deepEqual(seen.errors, []);
  await context.close();
});
