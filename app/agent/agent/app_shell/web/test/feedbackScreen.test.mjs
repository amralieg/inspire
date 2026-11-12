import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { appInfo, openApp, serveDist } from './harness.mjs';

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

test('the Feedback page offers Report an issue, and the button opens the report form', async () => {
  const info = appInfo();
  info.pages[0].reports = { ready: true, note: '', where: '' };
  const { page, context } = await openApp(browser, served.base, info, {});
  try {
    await page.locator('[data-rail="feedback"]').click();
    const report = page.locator('[data-feedback-screen]').getByRole('button', { name: 'Report an issue', exact: true });
    await report.waitFor({ timeout: 20000 });
    assert.equal(await page.locator('[data-feedback-form]').count(), 0, 'the form waits behind the button');
    await report.click();
    const form = page.locator('[data-feedback-form]');
    await form.waitFor({ timeout: 10000 });
    assert.ok(await form.getByRole('textbox', { name: 'What is wrong, or what would you change?' }).isVisible(), 'the report box opens');
    assert.ok(await form.getByRole('button', { name: 'Send', exact: true }).isVisible(), 'the report can be sent');
  } finally {
    await context.close();
  }
});
