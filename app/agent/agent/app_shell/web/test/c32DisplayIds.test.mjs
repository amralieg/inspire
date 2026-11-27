import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { DECIDE, appInfo, openApp, serveDist } from './harness.mjs';
import { dashboardRoutes } from './exampleRoutes.mjs';

let served;
let browser;
before(async () => { served = await serveDist(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

const OLD = /\bN\d+-U\d+\b/;
const change = { id: 'n05_u01', use_case_id: 'N05-U01', title: 'N05-U01 Recommend the next price', question: 'For N05-U01, which items lose margin?' };

const openOld = async (extra = {}) => {
  const base = appInfo({ ...DECIDE, title: 'N05-U01 Pricing desk', ...extra }, 2, change, 'examples/dashboard.json');
  const siblings = [{ use_case_id: 'N05-U02', name: 'N05-U02 Second desk', url: 'https://second-desk.example.com/' }];
  const info = { ...base, siblings };
  const opened = await openApp(browser, served.base, info, { routes: dashboardRoutes([]) });
  await opened.page.locator('[data-switcher]').waitFor();
  return { ...opened, info };
};

test('an App saved with Nx-Ux ids shows AIx-UCx in the header, tab title, page, switcher and sibling list', async () => {
  const { page, seen, context, info } = await openOld();
  await page.locator('[data-avatar-menu]').first().waitFor();
  await page.waitForFunction(() => document.title.includes('Recommend'));
  assert.doesNotMatch(await page.title(), OLD);
  assert.match(await page.title(), /AI05-UC01 Recommend the next price/);
  assert.match((await page.locator('[data-switcher] .switch-t b').innerText()), /^AI05-UC01 Recommend/);
  assert.doesNotMatch(await page.locator('header.top').innerText(), OLD);
  assert.doesNotMatch(await page.locator('body').innerText(), OLD, 'no Nx-Ux id reaches the page');
  await page.locator('[data-switcher]').click();
  await page.locator('[data-sibling]').first().waitFor();
  const menu = await page.locator('[data-siblings]').innerText();
  assert.match(menu, /AI05-UC02 Second desk/);
  assert.doesNotMatch(await page.locator('body').innerText(), OLD, 'no Nx-Ux id in the open switcher');
  assert.deepEqual(await page.locator('[data-sibling]').evaluateAll((all) => all.map((a) => [a.dataset.sibling, a.getAttribute('href')])), [['N05-U02', 'https://second-desk.example.com/']], 'the stored id and href are unchanged');
  assert.equal((await page.locator('[data-case]').first().getAttribute('data-case')), info.pages[0].id, 'the page id key is unchanged');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the switcher finds a page by its stored or its displayed id', async () => {
  const { page, seen, context } = await openOld();
  await page.locator('[data-switcher]').click();
  const box = page.locator('input[aria-label="Find a use case"]');
  await box.waitFor();
  for (const word of ['N05-U01', 'AI05-UC01']) {
    await box.fill(word);
    await page.waitForFunction(() => document.querySelectorAll('[data-case]').length === 1, null, { timeout: 3000 }).catch(() => {});
    assert.equal(await page.locator('[data-case]').count(), 1, `${word} finds the page`);
  }
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a use case already in the new form is unchanged', async () => {
  const base = appInfo({ ...DECIDE, title: 'AI07-UC03 Desk' }, 1, { use_case_id: 'AI07-UC03', title: 'AI07-UC03 Recommend' }, 'examples/dashboard.json');
  const { page, seen, context } = await openApp(browser, served.base, base, { routes: dashboardRoutes([]) });
  await page.locator('[data-switcher]').waitFor();
  assert.match(await page.locator('[data-switcher] .switch-t b').innerText(), /^AI07-UC03 Recommend$/);
  assert.deepEqual(seen.errors, []);
  await context.close();
});
