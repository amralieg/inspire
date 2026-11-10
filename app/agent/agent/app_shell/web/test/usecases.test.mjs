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

test('the Use cases dropdown sits next to the user and says so when the App holds no other use case', async () => {
  const info = appInfo(DECIDE, 1);
  const { page, seen, context } = await openApp(browser, served.base, info);
  await page.locator('[data-use-cases]').waitFor();
  const order = await page.evaluate(() => {
    const cases = document.querySelector('[data-use-cases]');
    const avatar = document.querySelector('header.top .avatar');
    return cases.compareDocumentPosition(avatar) === Node.DOCUMENT_POSITION_FOLLOWING;
  });
  assert.equal(order, true, 'the Use cases button comes right before the user avatar');
  assert.equal((await page.locator('[data-use-cases]').innerText()).trim(), 'Use cases');
  await page.locator('[data-use-cases]').click();
  assert.equal((await page.locator('[data-no-cases]').innerText()).trim(), 'No other use cases yet');
  assert.equal(await page.locator('[data-case]').count(), 0, 'the current use case is not listed as another one');
  await page.keyboard.press('Escape');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the Use cases dropdown lists the other use cases of the App and opens the one picked', async () => {
  const info = appInfo(DECIDE, 3);
  const { page, seen, context } = await openApp(browser, served.base, info);
  await page.locator('[data-use-cases]').waitFor();
  const current = info.pages[0];
  await go(page, current.id, 'dashboard');
  await page.locator('[data-use-cases]').click();
  const listed = await page.locator('[data-case]').evaluateAll((all) => all.map((el) => el.dataset.case));
  assert.deepEqual(listed, info.pages.slice(1).map((p) => p.id), 'the other two use cases, not the one open');
  assert.equal(await page.locator('[data-no-cases]').count(), 0);
  await page.locator(`[data-case="${info.pages[2].id}"]`).click();
  await page.waitForFunction((id) => window.location.hash.startsWith(`#/${id}/`), info.pages[2].id);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the Explore Work view of a page with no list says it has no row or bulk actions', async () => {
  const info = appInfo(DECIDE, 1, {}, 'examples/dashboard.json');
  const { page, seen, context } = await openApp(browser, served.base, info, { routes: dashboardRoutes([]) });
  await page.locator('[data-rail]').first().waitFor();
  await go(page, info.pages[0].id, 'work');
  await page.locator('[data-no-list]').waitFor();
  const text = (await page.locator('[data-no-list]').innerText()).trim();
  assert.match(text, /no row or bulk actions/);
  assert.equal(await page.locator('[data-act-all], [data-bulk]').count(), 0, 'no action control is shown for a page with no list');
  assert.deepEqual(seen.errors, []);
  await context.close();
});
