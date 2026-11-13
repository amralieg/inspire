import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { appInfo, openApp, resizeTo, serveDist } from './harness.mjs';

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

const BRAND = 'Databricks Inspire Use Case Hub';
const TITLE = 'Passenger profiles that may belong to the same person';
const WIDTHS = [1280, 1440];

function ownerInfo() {
  const info = appInfo();
  info.pages[0].is_owner = true;
  info.pages[0].reports = { ready: true, note: '', where: '' };
  return info;
}

for (const width of WIDTHS) {
  test(`at ${width}px the left nav lists no Feedback or Reported issues, and Settings holds both`, async () => {
    const { page, context, seen } = await openApp(browser, served.base, ownerInfo(), { width, height: 900 });
    try {
      await page.locator('nav.side.rail [data-rail="settings"]').waitFor({ timeout: 20000 });
      const rail = page.locator('nav.side.rail');
      assert.equal(await rail.locator('[data-rail="feedback"], [data-rail="reports"]').count(), 0, 'no feedback or reports rail item');
      const labels = await rail.locator('.nav-t b').allInnerTexts();
      assert.ok(labels.length > 0, 'the rail lists sections');
      assert.deepEqual(labels.filter((t) => /feedback|reported issues|report an issue/i.test(t)), [], 'no feedback wording in the nav');

      await rail.locator('[data-rail="settings"]').click();
      const feedback = page.locator('[data-group="feedback"]');
      await feedback.waitFor({ timeout: 20000 });
      assert.equal(await feedback.locator('h3').innerText(), 'Feedback', 'Feedback is a Settings group');
      assert.ok(await feedback.getByRole('button', { name: 'Report an issue', exact: true }).isVisible(), 'Report an issue is in Settings');
      const reported = page.locator('[data-group="reports"]');
      await reported.waitFor({ timeout: 20000 });
      assert.equal(await reported.locator('h3').innerText(), 'Reported issues', 'the owner sees Reported issues in Settings');
      assert.deepEqual(seen.errors, []);
    } finally {
      await context.close();
    }
  });
}

for (const width of WIDTHS) {
  for (const open of [true, false]) {
    test(`at ${width}px with Ask Genie ${open ? 'open' : 'closed'}, the header runs brand, then the centred use case title, then Ask Genie, on one line`, async () => {
      const { page, context, seen } = await openApp(browser, served.base, appInfo({ title: BRAND }, 1, { title: TITLE }), { width, height: 800, genie: open ? 'open' : 'closed' });
      try {
        await page.locator('[data-switcher] .switch-t b').waitFor({ timeout: 20000 });
        if (open) await page.locator('aside.genie.is-open').waitFor({ timeout: 20000 });
        else await page.locator('.genie-btn').waitFor({ timeout: 20000 });
        await resizeTo(page, width, 800);
        const order = await page.evaluate(() => {
          const mark = document.querySelector('header.top > .mark');
          const title = document.querySelector('header.top [data-switcher]');
          const genie = document.querySelector('header.top .genie-btn');
          const following = (a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
          const mid = (el) => { const b = el.getBoundingClientRect(); return b.top + b.height / 2; };
          return {
            brand: mark.querySelector('.mark-t b')?.innerText,
            markBeforeTitle: following(mark, title),
            titleBeforeGenie: following(title, genie),
            sameLine: Math.abs(mid(mark) - mid(title)) < 8 && Math.abs(mid(title) - mid(genie)) < 8,
            genieOpen: document.querySelector('aside.genie')?.classList.contains('is-open') || false,
          };
        });
        assert.equal(order.genieOpen, open, `the Genie panel is ${open ? 'open' : 'closed'} for this check`);
        assert.equal(order.brand, BRAND, 'the brand is the first header item');
        assert.ok(order.markBeforeTitle, 'the brand comes before the use case title in the DOM');
        assert.ok(order.titleBeforeGenie, 'the use case title comes before Ask Genie in the DOM');
        assert.ok(order.sameLine, 'brand, title and Ask Genie sit on one line');
        assert.deepEqual(seen.errors, []);
      } finally {
        await context.close();
      }
    });
  }
}
