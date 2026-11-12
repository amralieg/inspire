import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { appInfo, openApp, serveDist, toastSays } from './harness.mjs';

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

const THANKS = 'Thanks. The owners of this use case see your report on its Build page in Inspire.';

function owned(sent, items = []) {
  return {
    feedback: ({ route, json }) => {
      if (route.request().method() === 'GET') return json(200, { items, everyone: true, missing: false, limit: 2000 });
      const body = route.request().postDataJSON();
      sent.push(body);
      return json(200, { items: [...items, { feedback_id: 'f0', section: body.section, text: body.text, reported_by: 'someone', status: 'new' }], everyone: true, missing: false, limit: 2000, sent: 'f0' });
    },
  };
}

function ownerInfo() {
  const info = appInfo();
  info.pages[0].is_owner = true;
  info.pages[0].reports = { ready: true, note: '', where: '' };
  return info;
}

test('the left nav has no Feedback or Reported issues entry, even for the owner', async () => {
  const { page, context } = await openApp(browser, served.base, ownerInfo(), {});
  try {
    await page.locator('[data-rail="settings"]').waitFor({ timeout: 20000 });
    assert.equal(await page.locator('[data-rail="feedback"]').count(), 0, 'Feedback left the nav');
    assert.equal(await page.locator('[data-rail="reports"]').count(), 0, 'Reported issues left the nav');
  } finally {
    await context.close();
  }
});

test('Settings holds Feedback with a Report an issue button, and the owner sees Reported issues', async () => {
  const sent = [];
  const { page, seen, context } = await openApp(browser, served.base, ownerInfo(), { routes: owned(sent) });
  try {
    await page.locator('[data-rail="settings"]').click();
    const feedback = page.locator('[data-group="feedback"]');
    await feedback.waitFor({ timeout: 20000 });
    assert.equal(await feedback.locator('h3').innerText(), 'Feedback');
    const report = feedback.getByRole('button', { name: 'Report an issue', exact: true });
    assert.ok(await report.isVisible(), 'the Report an issue button sits in Settings');
    assert.equal(await page.locator('[data-feedback-form]').count(), 0, 'the form waits behind the button');
    await report.click();
    const form = page.locator('.pop [data-feedback-form]');
    await form.waitFor({ timeout: 10000 });
    await form.locator('textarea').fill('The margin column is blank for June');
    await form.locator('[data-feedback-send]').click();
    await toastSays(page, THANKS);
    assert.equal(sent.length, 1, 'the report reached the server once');
    assert.equal(sent[0].text, 'The margin column is blank for June');
    const reported = page.locator('[data-group="reports"]');
    await reported.waitFor({ timeout: 10000 });
    assert.equal(await reported.locator('h3').innerText(), 'Reported issues');
    await reported.locator('[data-feedback-item="f0"]').waitFor({ timeout: 10000 });
    assert.deepEqual(seen.errors, []);
  } finally {
    await context.close();
  }
});

test('the owner sees the empty Reported issues note, and a non-owner gets no Reported issues group', async () => {
  const owner = await openApp(browser, served.base, ownerInfo(), { routes: owned([]) });
  try {
    await owner.page.locator('[data-rail="settings"]').click();
    await owner.page.locator('[data-group="reports"] [data-feedback-empty]').waitFor({ timeout: 20000 });
    assert.equal(await owner.page.locator('[data-group="reports"] [data-feedback-empty]').innerText(), 'Nobody has reported an issue with this App yet.');
  } finally {
    await owner.context.close();
  }
  const member = await openApp(browser, served.base, appInfo(), { routes: owned([]) });
  try {
    await member.page.locator('[data-rail="settings"]').click();
    await member.page.locator('[data-group="feedback"]').waitFor({ timeout: 20000 });
    assert.equal(await member.page.locator('[data-group="reports"]').count(), 0, 'only the owner gets Reported issues');
  } finally {
    await member.context.close();
  }
});
