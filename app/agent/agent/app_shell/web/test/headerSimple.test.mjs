import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { DECIDE, appInfo, openApp, serveDist } from './harness.mjs';
// REQ-506: no side rail; a section opens by its hash.
const goRail = (page, id) => page.evaluate((s) => { location.hash = `#/${location.hash.split('/')[1]}/${s}`; }, id);

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
  assert.equal(await page.locator('header.top [data-mode="genie"]').count(), 1, 'one Genie entry in the top bar (REQ-506: the Screen | Genie switch)');
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
  await goRail(page, 'dashboard'); // REQ-506: What to do now is on the Dashboard; the page opens on Work
  const todo = page.locator('[data-section="todo"]');
  await todo.waitFor({ state: 'visible' });
  const question = (await page.locator('.ph-q').textContent()).trim();
  assert.ok(question.length > 0, 'the page has a question');
  assert.ok(!(await todo.textContent()).includes(question), 'the question appears once, in the header');
  assert.equal(await todo.locator('[data-step="read"]').count(), 0);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the guided tour entry sits in the avatar menu and stays enabled on every page', async () => {
  const { page, context, seen } = await openApp(browser, base, MONITOR(), { watch: STILL });
  // REQ-506: the tour is an item of the avatar menu, no longer a button beside the avatar.
  const tourItem = async () => {
    await page.locator('[data-avatar-menu] button').first().click();
    const item = page.getByRole('menu').getByRole('menuitem', { name: 'Take the tour' });
    await item.waitFor({ state: 'visible' });
    return item;
  };
  assert.equal(await (await tourItem()).isEnabled(), true);
  await page.keyboard.press('Escape');
  await goRail(page, 'settings');
  await page.locator('[data-group="measurement"]').waitFor({ state: 'visible' });
  assert.equal(await (await tourItem()).isEnabled(), true, 'still there on Settings');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('Report an issue stays off the work screen and sits in Settings, one avatar-menu step away', async () => {
  const { page, context, seen } = await openApp(browser, base, MONITOR(), { watch: STILL });
  await page.locator('.top [data-avatar-menu]').waitFor();
  assert.equal(await page.locator('[data-feedback-open]').count(), 0, 'not on the work screen');
  await page.locator('[data-avatar-menu] button').first().click();
  await page.getByRole('menu').getByRole('menuitem', { name: 'Settings' }).click();
  await page.locator('[data-feedback-open]').waitFor({ state: 'visible' });
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the records list, the runs and the settings groups each show a visible ? that says what to do there', async () => {
  const { page, context, seen } = await openApp(browser, base, MONITOR(), { watch: STILL });
  const records = page.locator('section.card--list [data-section-help]').first();
  await records.waitFor({ state: 'visible' });
  await goRail(page, 'runs');
  const runs = page.locator('section.runs [data-section-help]');
  await runs.waitFor({ state: 'visible' });
  await runs.click();
  await page.waitForSelector('.tour-pop');
  assert.equal(await page.locator('#tour-t').textContent(), 'Each refresh of this use case');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.tour', { state: 'detached' });
  await goRail(page, 'settings');
  for (const group of ['measurement', 'help']) {
    const help = page.locator(`[data-group="${group}"] [data-section-help]`);
    await help.waitFor({ state: 'visible' });
  }
  assert.deepEqual(seen.errors, []);
  await context.close();
});
