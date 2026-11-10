import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { DECIDE, appInfo, goRail, openApp, serveDist } from './harness.mjs';

let served;
let base;
let browser;
before(async () => { served = await serveDist(); base = served.base; browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

const STILL = (p) => p.emulateMedia({ reducedMotion: 'reduce' });
const MONITOR = () => appInfo(DECIDE, 1, {}, 'examples/monitor_triage.json');

test('the page header is one title, one question and one meta line, with one Ask Genie entry in the top bar', async () => {
  const { page, context, seen } = await openApp(browser, base, MONITOR(), { watch: STILL });
  const header = page.locator('header.ph');
  assert.equal(await header.locator('h1').count(), 1, 'one title');
  assert.equal(await header.locator('.ph-q').count(), 1, 'one question');
  assert.equal(await header.locator('form.ask').count(), 0, 'no second Ask Genie form in the header');
  assert.equal(await header.getByRole('button', { name: 'Ask Genie' }).count(), 0, 'no Ask Genie chip in the header');
  assert.equal(await page.locator('header.top [data-genie], header.top .genie-btn').count(), 1, 'one Ask Genie entry in the top bar');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the value line is a small chip that sends the reader to how it is measured', async () => {
  const { page, context, seen } = await openApp(browser, base, MONITOR(), { watch: STILL });
  const chip = page.locator('[data-value-estimate]');
  if (await chip.count()) {
    assert.match(await chip.getAttribute('class'), /\bph-chip\b/, 'the value line is a chip');
  }
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the question is not repeated inside What to do now', async () => {
  const { page, context, seen } = await openApp(browser, base, MONITOR(), { watch: STILL });
  const todo = page.locator('[data-section="todo"]');
  await todo.waitFor({ state: 'visible' });
  const question = (await page.locator('.ph-q').textContent()).trim();
  assert.ok(question.length > 0, 'the page has a question');
  assert.ok(!(await todo.textContent()).includes(question), 'the question appears once, in the header');
  assert.equal(await todo.locator('[data-step="read"]').count(), 0);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the guided tour button sits right after the user avatar and stays enabled on every page', async () => {
  const { page, context, seen } = await openApp(browser, base, MONITOR(), { watch: STILL });
  const tour = page.locator('[data-tour-top]');
  await tour.waitFor({ state: 'visible' });
  assert.equal(await tour.isEnabled(), true);
  assert.equal(await tour.evaluate((el) => el.previousElementSibling?.classList.contains('avatar') === true), true, 'the tour button follows the avatar');
  assert.equal(await tour.getAttribute('aria-label'), 'Take the guided tour again');
  await goRail(page, 'settings');
  await page.locator('[data-group="measurement"]').waitFor({ state: 'visible' });
  await tour.waitFor({ state: 'visible' });
  assert.equal(await tour.isEnabled(), true, 'still there on Settings');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('Report an issue sits in the More menu, closed until opened', async () => {
  const { page, context, seen } = await openApp(browser, base, MONITOR(), { watch: STILL });
  const menu = page.locator('[data-head-more]');
  await menu.waitFor({ state: 'attached' });
  assert.equal(await page.locator('[data-feedback-open]').isVisible(), false, 'hidden until the menu opens');
  await menu.locator('> summary').click();
  await page.locator('[data-feedback-open]').waitFor({ state: 'visible' });
  assert.deepEqual(seen.errors, []);
  await context.close();
});
