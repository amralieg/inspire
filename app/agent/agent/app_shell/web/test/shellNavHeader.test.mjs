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

const openMenu = (page) => page.locator('[data-avatar-menu] button').first().click();

for (const width of WIDTHS) {
  test(`at ${width}px the avatar menu lists no Feedback or Reported issues, and Settings holds both`, async () => {
    const { page, context, seen } = await openApp(browser, served.base, ownerInfo(), { width, height: 900 });
    try {
      await page.locator('[data-avatar-menu] button').first().waitFor({ timeout: 20000 });
      assert.equal(await page.locator('.side, [data-rail]').count(), 0, 'there is no left nav');
      await openMenu(page);
      await page.getByRole('menuitem', { name: 'Settings' }).waitFor({ timeout: 20000 });
      const labels = await page.locator('[data-avatar-menu] [role="menuitem"]').allInnerTexts();
      assert.ok(labels.length > 0, 'the menu lists items');
      assert.deepEqual(labels.filter((t) => /feedback|reported issues|report an issue/i.test(t)), [], 'no feedback wording in the menu');

      await page.getByRole('menuitem', { name: 'Settings' }).click();
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
  for (const genie of [false, true]) {
    test(`at ${width}px in ${genie ? 'Genie' : 'Screen'} mode, the header runs the use case switcher, then the Screen and Genie buttons, then the avatar, on one line`, async () => {
      const { page, context, seen } = await openApp(browser, served.base, appInfo({ title: BRAND }, 1, { title: TITLE }), { width, height: 800 });
      try {
        await page.locator('[data-switcher] .switch-t b').waitFor({ timeout: 20000 });
        if (genie) {
          await page.locator('[data-mode="genie"]').click();
          await page.locator('[data-genie-full]').waitFor({ timeout: 20000 });
        }
        await resizeTo(page, width, 800);
        const order = await page.evaluate(() => {
          const title = document.querySelector('header.top [data-switcher]');
          const modes = document.querySelector('header.top [data-mode-switch]');
          const avatar = document.querySelector('header.top [data-avatar-menu]');
          const following = (a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
          const mid = (el) => { const b = el.getBoundingClientRect(); return b.top + b.height / 2; };
          return {
            switcherText: title.querySelector('.switch-t b')?.innerText,
            titleBeforeModes: following(title, modes),
            modesBeforeAvatar: following(modes, avatar),
            sameLine: Math.abs(mid(title) - mid(modes)) < 8 && Math.abs(mid(modes) - mid(avatar)) < 8,
            genieOn: modes.querySelector('[data-mode="genie"]').getAttribute('aria-pressed') === 'true',
          };
        });
        assert.equal(order.genieOn, genie, `Genie mode is ${genie ? 'on' : 'off'} for this check`);
        assert.equal(order.switcherText, TITLE, 'the switcher shows the use case title');
        assert.ok(order.titleBeforeModes, 'the use case title comes before the Screen and Genie buttons in the DOM');
        assert.ok(order.modesBeforeAvatar, 'the Screen and Genie buttons come before the avatar in the DOM');
        assert.ok(order.sameLine, 'switcher, mode buttons and avatar sit on one line');
        assert.deepEqual(seen.errors, []);
      } finally {
        await context.close();
      }
    });
  }
}

// PRODUCT GAP (REQ-506): the header has no brand; the App title is only in document.title (App.jsx:184), so `header.top > .mark .mark-t b` is gone.
test('the header starts with the App brand, before the use case title', async () => {
  const { page, context } = await openApp(browser, served.base, appInfo({ title: BRAND }, 1, { title: TITLE }), { width: 1280, height: 800 });
  try {
    await page.locator('[data-switcher] .switch-t b').waitFor({ timeout: 20000 });
    const brand = await page.locator('header.top > .mark .mark-t b').innerText({ timeout: 3000 });
    assert.equal(brand, BRAND, 'the brand is the first header item');
  } finally {
    await context.close();
  }
});
