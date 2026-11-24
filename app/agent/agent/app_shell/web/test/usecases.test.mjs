import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { DECIDE, appInfo, openApp, serveDist } from './harness.mjs';
import { dashboardRoutes } from './exampleRoutes.mjs';

let served;
let browser;
before(async () => { served = await serveDist(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

const go = async (page, id, section) => {
  await page.evaluate(([p, s]) => { window.location.hash = `#/${p}/${s}`; }, [id, section]);
  await page.waitForFunction((s) => window.location.hash.includes(`/${s}`), section);
};

test('the use case switcher sits before the user avatar and is switched off when the App holds no other use case', async () => {
  const info = appInfo(DECIDE, 1);
  const { page, seen, context } = await openApp(browser, served.base, info);
  await page.locator('[data-switcher]').waitFor();
  const order = await page.evaluate(() => {
    const cases = document.querySelector('[data-switcher]');
    const avatar = document.querySelector('header.top [data-avatar-menu]');
    return (cases.compareDocumentPosition(avatar) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  });
  assert.equal(order, true, 'the switcher comes before the user avatar');
  assert.equal((await page.locator('[data-switcher] .switch-t b').innerText()).trim(), info.pages[0].title);
  assert.equal(await page.locator('[data-switcher]').isDisabled(), true, 'a lone use case has nothing to switch to');
  assert.equal(await page.locator('[data-case], [data-no-cases]').count(), 0, 'no list opens for a lone use case');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the use case switcher lists every use case of the App, marks the open one, and opens the one picked', async () => {
  const info = appInfo(DECIDE, 3);
  const { page, seen, context } = await openApp(browser, served.base, info);
  await page.locator('[data-switcher]').waitFor();
  const current = info.pages[0];
  await go(page, current.id, 'dashboard');
  await page.locator('[data-switcher]').click();
  await page.locator('[data-no-cases], [data-case], [data-sibling]').first().waitFor();
  const listed = await page.locator('[data-case]').evaluateAll((all) => all.map((el) => [el.dataset.case, el.getAttribute('aria-selected')]));
  assert.deepEqual(listed, info.pages.map((p) => [p.id, String(p.id === current.id)]), 'the three use cases, with only the open one selected');
  assert.equal(await page.locator('[data-no-cases]').count(), 0);
  await page.locator(`[data-case="${info.pages[2].id}"]`).click();
  await page.waitForFunction((id) => window.location.hash.startsWith(`#/${id}/`), info.pages[2].id);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the Explore Work view of a page with no list says it has no row or bulk actions', async () => {
  const info = appInfo(DECIDE, 1, {}, 'examples/dashboard.json');
  const { page, seen, context } = await openApp(browser, served.base, info, { routes: dashboardRoutes([]) });
  await page.locator('[data-avatar-menu]').first().waitFor();
  await go(page, info.pages[0].id, 'work');
  await page.locator('[data-no-list]').waitFor();
  const text = (await page.locator('[data-no-list]').innerText()).trim();
  assert.match(text, /no row or bulk actions/);
  assert.equal(await page.locator('[data-act-all], [data-bulk]').count(), 0, 'no action control is shown for a page with no list');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the use case switcher lists the other Apps Inspire delivered for the business, each one a link to that App', async () => {
  const base = appInfo(DECIDE, 1);
  const siblings = [{ use_case_id: 'N05-U02', name: 'Second desk', url: 'https://second-desk.example.com/' }, { use_case_id: 'N06-U01', name: 'Third desk', url: 'https://third-desk.example.com/' }];
  const info = { ...base, siblings };
  const { page, seen, context } = await openApp(browser, served.base, info);
  await page.locator('[data-switcher]').waitFor();
  await page.locator('[data-switcher]').click();
  await page.locator('[data-no-cases], [data-case], [data-sibling]').first().waitFor();
  assert.equal(await page.locator('[data-no-cases]').count(), 0, 'the empty message is not shown when other Apps exist');
  const links = await page.locator('[data-siblings] a[data-sibling]').evaluateAll((all) => all.map((a) => [a.dataset.sibling, a.getAttribute('href')]));
  assert.deepEqual(links, [['N05-U02', 'https://second-desk.example.com/'], ['N06-U01', 'https://third-desk.example.com/']]);
  assert.deepEqual(seen.errors, []);
  await context.close();
});
