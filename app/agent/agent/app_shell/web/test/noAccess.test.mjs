// REQ-310/311: the no-access banner is the Permission Required dialog (PermissionDialog). Its pins below target that dialog; the
// grant flow (confirm, refuse, copy the SQL) is unchanged.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { appInfo, openApp, said, serveDist, until } from './harness.mjs';

const UNREAD = { 'main.pricing.items': ['GRANT SELECT ON TABLE `main`.`pricing`.`items` TO `sp-1`'] };
const OWNERS = { 'main.pricing.items': 'data-eng' };
const REBUILD = /build (it|the App) again|rebuild|person who built/i;

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

const tileErrors = (page) => page.locator('.tile-err').evaluateAll((els) => els.map((e) => e.innerText.trim()));

test('a page whose data the App cannot read shows one banner naming the table and owner, a short line per tile, and Check again', async () => {
  const errors = { 'chart:pareto': 'No access to main.pricing.items', 'chart:by_category': 'No access to main.pricing.items', 'kpi:total_loss': 'No access to main.pricing.items' };
  // REQ-311: the dialog checks Request for Access once; no destination is set here, so Advanced opens and Check again is in it.
  const routes = { 'access-request/check': ({ json }) => json(200, { offered: false, destinations: [], reason: 'no one has set up where access requests for these go yet' }) };
  const { page, seen, context } = await openApp(browser, served.base, appInfo({ unread: UNREAD, unread_owners: OWNERS }), { errors, routes, hash: '#/n01_u05/dashboard' });
  try {
    const banner = page.locator('[data-permission-dialog]');
    await banner.waitFor();
    assert.equal(await banner.count(), 1, 'one banner per page, not one per tile');
    const said = await banner.innerText();
    assert.match(said, /This App cannot read main\.pricing\.items yet/);
    assert.match(said, /data-eng can give the App read access in Unity Catalog/);
    assert.doesNotMatch(said, REBUILD);
    assert.deepEqual(await tileErrors(page), ['No access to main.pricing.items', 'No access to main.pricing.items', 'No access to main.pricing.items'],
      'each tile says only which data it cannot read');
    assert.equal(await page.locator('[data-card="pareto"] .tile-err').innerText(), 'No access to main.pricing.items', 'the tile drops its "could not load" lead');
    assert.equal(await page.locator('[data-card="loss_trend"] .tile-err').count(), 0, 'a tile that loads shows no error (must-exclude)');

    const asked = seen.pages.length;
    for (const key of Object.keys(errors)) delete errors[key];
    await banner.getByRole('button', { name: 'Check again' }).click();
    await until(() => seen.pages.length > asked, 10000);
    await page.locator('[data-card="pareto"] canvas').waitFor();
    await page.locator('[data-permission-dialog]').waitFor({ state: 'detached' });
    assert.deepEqual(await tileErrors(page), []);
    assert.deepEqual(seen.errors, []);
  } finally {
    await context.close();
  }
});

test('without a recorded owner the banner says your data owner can grant it, and a per-user App says you', async () => {
  const errors = { 'chart:pareto': "No access to part of this App's data yet. Ask your data owner for read access, then try again." };
  const { page, context } = await openApp(browser, served.base, appInfo({ auth: 'user' }), { errors, hash: '#/n01_u05/dashboard' });
  try {
    const banner = page.locator('[data-permission-dialog]');
    await banner.waitFor();
    const said = await banner.innerText();
    assert.match(said, /You cannot read part of its data yet/);
    assert.match(said, /Your data owner can give you read access/);
    assert.doesNotMatch(said, REBUILD);
    assert.equal(await page.locator('[data-card="pareto"] .tile-err').innerText(), 'No access to this data');
  } finally {
    await context.close();
  }
});

test('an error that is not about access keeps its own words and raises no banner (must-exclude)', async () => {
  const { page, context } = await openApp(browser, served.base, appInfo(), { errors: { 'chart:pareto': 'the warehouse is stopped' }, hash: '#/n01_u05/dashboard' });
  try {
    await page.locator('[data-card="pareto"] .tile-err').waitFor();
    assert.equal(await said(page.locator('[data-card="pareto"] .tile-err')), 'This chart could not load: the SQL warehouse is stopped, so start it on the SQL Warehouses page or ask its owner to, then try again.');
    assert.equal(await page.locator('[data-permission-dialog]').count(), 0);
  } finally {
    await context.close();
  }
});
