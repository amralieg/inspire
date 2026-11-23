import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { appInfo, openApp, serveDist } from './harness.mjs';

let served;
let browser;
before(async () => { served = await serveDist(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

// REQ-506: no side rail and no header menu. Settings is an item of the avatar menu, and Report an issue is in its Feedback group.
const goSettings = async (page) => {
  await page.locator('[data-avatar-menu] button').first().click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
};
const reportIssue = async (page) => {
  await goSettings(page);
  const group = page.locator('[data-group="feedback"]');
  await group.waitFor();
  await group.getByRole('button', { name: 'Report an issue', exact: true }).click();
};

const READY = { ready: true, note: '', where: 'Your report goes to the owner of this use case, who sees it on its Build page in Inspire.' };
const NOT_READY = { ready: false, note: 'Reports cannot be saved for this App yet. Send the report to the owner of this use case, or through Inspire\'s Build page for it.', where: '' };

test('Report an issue shows where the report goes before Send, when the App keeps reports', async () => {
  const info = appInfo({}, 1, {});
  info.pages[0].reports = READY;
  const { page, context } = await openApp(browser, served.base, info);
  await reportIssue(page);
  await page.locator('[data-feedback-form]').waitFor();
  assert.match(await page.locator('[data-feedback-where]').textContent(), /goes to the owner of this use case/);
  assert.equal(await page.locator('[data-feedback-note]').count(), 0);
  await context.close();
});

test('an App that cannot keep reports shows the plain note in place of the form, and no Send button', async () => {
  const info = appInfo({}, 1, {});
  info.pages[0].reports = NOT_READY;
  const { page, context } = await openApp(browser, served.base, info);
  await reportIssue(page);
  const note = page.locator('[data-feedback-note]');
  await note.waitFor();
  assert.match(await note.textContent(), /Send the report to the owner of this use case/);
  assert.equal(await page.locator('[data-feedback-form]').count(), 0);
  assert.equal(await page.locator('[data-feedback-send]').count(), 0);
  await context.close();
});

test('Report an issue in Settings shows the same note on an App that cannot keep reports', async () => {
  const info = appInfo({}, 1, {});
  info.pages[0].reports = NOT_READY;
  info.pages[0].is_owner = false;
  const { page, context } = await openApp(browser, served.base, info);
  await reportIssue(page);
  await page.locator('.pop [data-feedback-note]').waitFor();
  assert.equal(await page.locator('.pop [data-feedback-form]').count(), 0);
  await context.close();
});
