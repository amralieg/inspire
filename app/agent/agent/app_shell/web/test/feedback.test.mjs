import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { HISTORY, PERSON, TABLE, appInfo, openApp, reportIssue, serveDist, toastSays, until } from './harness.mjs';
import { FEEDBACK_CHARS, feedbackProblem, feedbackStatusText } from '../src/feedback.js';

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'assets');

let served;
let browser;
before(async () => { served = await serveDist(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

const THANKS = 'Thanks. The owners of this use case see your report on its Build page in Inspire.';

function feedbackRoutes(sent, answer = null) {
  return {
    feedback: ({ route, json }) => {
      if (route.request().method() === 'GET') {
        return json(200, { items: sent.map((b, i) => ({ feedback_id: `f${i}`, section: b.section, text: b.text, reported_by: PERSON, reported_at: '2026-11-08 10:00:00', status: 'new' })),
          everyone: false, missing: false, limit: FEEDBACK_CHARS });
      }
      const body = route.request().postDataJSON();
      if (answer) return answer({ json, body });
      sent.push(body);
      return json(200, { items: sent.map((b, i) => ({ feedback_id: `f${i}`, section: b.section, text: b.text, reported_by: PERSON, status: 'new' })),
        everyone: false, missing: false, limit: FEEDBACK_CHARS, sent: 'f0' });
    },
  };
}

test('the limits read the same as the server: 2,000 characters counted by letter, and the stored statuses', () => {
  assert.equal(feedbackProblem('é'.repeat(2000)), '');
  assert.equal(feedbackProblem('x'.repeat(2001)), 'Keep the report to 2,000 characters; it has 2,001.');
  assert.equal(feedbackProblem(`  ${'x'.repeat(2000)}  `), '', 'outer spaces do not count, as on the server');
  assert.deepEqual(['new', 'vibe', 'closed', 'other'].map(feedbackStatusText), ['New', 'Turned into vibe', 'Closed', '']);
});

test('Report an issue on Work sends the section, the filters and the open record', async () => {
  const sent = [];
  const { page, seen, context } = await openApp(browser, served.base, appInfo({}, 1, TABLE), { hash: '#/n01_u05/work', ready: '.cell-t', routes: { ...feedbackRoutes(sent), 'records/history': ({ json }) => json(200, HISTORY) } });
  await page.locator('.cell-t').first().click();
  await page.locator('[data-dock="record"] dialog.drawer').waitFor();
  await page.locator('[data-head-more] > summary').click();
  await page.locator('[data-feedback-open]').click();
  const form = page.locator('.pop [data-feedback-form]');
  await form.waitFor();
  assert.match(await form.locator('[data-feedback-context]').innerText(), /the work section.*record R001/);
  assert.ok(await form.locator('[data-feedback-send]').isDisabled(), 'an empty report cannot be sent');
  await form.locator('textarea').fill('x'.repeat(2001));
  assert.ok(await form.locator('[data-feedback-send]').isDisabled());
  assert.equal(await form.getByRole('alert').innerText(), 'Keep the report to 2,000 characters; it has 2,001.');
  await form.locator('textarea').fill("The due date is wrong'); DROP TABLE x; --");
  assert.equal(await form.locator('[data-feedback-count]').innerText(), '41 / 2,000');
  await form.locator('[data-feedback-send]').click();
  await toastSays(page, THANKS);
  await until(() => sent.length === 1);
  assert.deepEqual({ ...sent[0], filters: typeof sent[0].filters }, { page: 'n01_u05', section: 'work', text: "The due date is wrong'); DROP TABLE x; --", record_key: 'R001', filters: 'string' });
  await page.waitForFunction(() => !document.querySelector('.pop [data-feedback-form]'));
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the Settings section holds App Feedback, picks the section it is about, lists your reports and shows a refusal', async () => {
  const sent = [];
  const { page, seen, context } = await openApp(browser, served.base, appInfo({}, 1, TABLE), { hash: '#/n01_u05/settings', ready: '[data-group="feedback"]', routes: feedbackRoutes(sent) });
  const group = page.locator('[data-group="feedback"]');
  assert.equal(await group.locator('h3').innerText(), 'App Feedback');
  await group.locator('select[name="feedback_section"]').selectOption('dashboard');
  await group.locator('textarea').fill('The money chart double counts returns');
  await group.locator('[data-feedback-send]').click();
  await toastSays(page, THANKS);
  assert.equal(sent[0].section, 'dashboard');
  await group.locator('[data-feedback-item="f0"]').waitFor();
  assert.match(await group.locator('[data-feedback-list]').innerText(), /Your reports[\s\S]*The money chart double counts returns[\s\S]*dashboard · New/);
  await context.close();
  const limited = await openApp(browser, served.base, appInfo({}, 1, TABLE), { hash: '#/n01_u05/settings', ready: '[data-group="feedback"]',
    routes: feedbackRoutes([], ({ json }) => json(429, { error: 'you reported 10 issues in the last hour, the most the App takes from one person; try again in 12 minutes' })) });
  const box = limited.page.locator('[data-group="feedback"]');
  await box.locator('textarea').fill('again');
  await box.locator('[data-feedback-send]').click();
  await box.getByText('try again in 12 minutes', { exact: false }).waitFor();
  assert.equal(await box.locator('textarea').inputValue(), 'again', 'a refused report keeps what the person wrote');
  assert.deepEqual(seen.errors, []);
  await limited.context.close();
});

test('Report an issue is offered on every page type; a page with a results table opens the form, and an older App without a reports table says where to send the report', async () => {
  const bare = await openApp(browser, served.base, appInfo(), { hash: '#/n01_u05/settings', ready: '[data-group="look"]' });
  await bare.page.locator('[data-group="feedback"]').waitFor();
  await bare.page.locator('[data-rail="dashboard"]').click();
  await bare.page.locator('.ph h1').waitFor();
  await reportIssue(bare.page);
  await bare.page.locator('[data-feedback-note]').waitFor();
  assert.equal(await bare.page.locator('[data-feedback-form]').count(), 0);
  await bare.context.close();
  const { page, seen, context } = await openApp(browser, served.base, appInfo({}, 1, TABLE), {});
  await page.locator('[data-head-more]').waitFor({ state: 'attached' });
  await page.locator('[data-rail="runs"]').click();
  await page.waitForFunction(() => window.location.hash === '#/n01_u05/runs');
  await page.locator('[data-section-title]', { hasText: 'Runs' }).waitFor();
  await reportIssue(page);
  await page.locator('[data-feedback-form]').waitFor();
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the report form loads in its own chunk, so the main bundle carries none of it', () => {
  const main = readFileSync(join(ASSETS, 'app.js'), 'utf8');
  const chunks = readdirSync(ASSETS).filter((f) => f.endsWith('.js') && f !== 'app.js' && readFileSync(join(ASSETS, f), 'utf8').includes('data-feedback-form'));
  assert.equal(chunks.length, 1, `one chunk holds the report form: ${chunks.join(', ')}`);
  assert.ok(!main.includes('data-feedback-form') && !main.includes('see your report on its Build page'), 'the main bundle has no report form');
});
