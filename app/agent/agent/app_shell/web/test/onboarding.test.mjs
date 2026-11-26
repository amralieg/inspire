import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { PERSON, appInfo, goRail, openApp, prefsFirst, serveDist } from './harness.mjs';

// REQ-543: "Make it yours", three first-start questions, and the help level that gates the tour's auto-open.
const MY = 'inspire-app-my';
const STILL = (p) => p.emulateMedia({ reducedMotion: 'reduce' });
const DEFAULTS = { workMode: 'auto', help: 'guide', motion: 'calm' };
const STEP = (anchor, title, text) => ({ anchor, title, text });
const SEVEN = [STEP('decision', 'One', 'The first stop.'), STEP('todo', 'Two', 'The second stop.'), STEP('kpis', 'Three', 'The third stop.'),
  STEP('records', 'Four', 'The fourth stop.'), STEP('top_record', 'Five', 'The fifth stop.'), STEP('genie', 'Six', 'The sixth stop.'), STEP('decision', 'Seven', 'The seventh stop.')];
const written = (steps) => ({ tour: { languages: ['English'], steps: { English: steps } } });

let served;
let base;
let browser;
before(async () => { served = await serveDist(); base = served.base; browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

const stored = (page) => page.evaluate(([k, who]) => {
  const all = JSON.parse(localStorage.getItem(k) || '{}')[who] || {};
  return { workMode: all.workMode, help: all.help, motion: all.motion };
}, [MY, PERSON]);
const asking = (page) => page.locator('[data-onboarding]');
const pick = async (page, q, opt) => {
  await page.locator(`[data-onboarding] [data-onb-q="${q}"]`).waitFor();
  await page.locator(`[data-onb-opt="${opt}"]`).click();
  await page.locator('[data-onb-next]').click();
};
const open = (extra = {}) => openApp(browser, base, appInfo({}, 1, written(SEVEN)), { watch: STILL, ...extra });
const tourLater = async (page) => { await page.waitForTimeout(1500); return page.locator('.tour').count(); };

test('the pure rules: auto means one by one up to 20 items, and only an unasked person is asked', async () => {
  const on = await import('../src/onboarding.js');
  assert.equal(on.resolveWorkMode({ workMode: 'auto' }, 20), 'one');
  assert.equal(on.resolveWorkMode({ workMode: 'auto' }, 21), 'all');
  assert.equal(on.resolveWorkMode({ workMode: 'all' }, 3), 'all');
  assert.equal(on.resolveWorkMode({ workMode: 'one' }, 300), 'one');
  assert.equal(on.onboardDue({ workMode: '', help: '', motion: '' }, '', false), true);
  assert.equal(on.onboardDue({ workMode: '', help: '', motion: '' }, '', true), false, 'automation is not asked unless it asks');
  assert.equal(on.onboardDue({ workMode: '', help: '', motion: '' }, '1', true), true);
  assert.equal(on.onboardDue(DEFAULTS, '', false), false);
  assert.equal(on.onboardDue(DEFAULTS, '1', false), false, 'an answered person is not asked again, even when asked for');
});

test('three questions show once, the answers are stored, a reload does not ask again, and Settings shows and changes them', async () => {
  const { page, context, seen } = await open({ hash: '?onboard=1' });
  await asking(page).waitFor();
  assert.equal(await page.locator('[data-onb-q]').count(), 1, 'one screen at a time');
  await pick(page, 'work', 'all');
  await pick(page, 'help', 'guide');
  await pick(page, 'motion', 'lively');
  await asking(page).waitFor({ state: 'detached' });
  assert.deepEqual(await stored(page), { workMode: 'all', help: 'guide', motion: 'lively' });
  await page.reload();
  await page.waitForSelector('.kpi-v');
  await page.waitForTimeout(800);
  assert.equal(await asking(page).count(), 0, 'not asked again after a reload');
  await goRail(page, 'settings');
  const group = page.locator('[data-group="make_it_yours"]');
  await group.waitFor();
  assert.deepEqual(await group.locator('select').evaluateAll((s) => s.map((x) => x.value)), ['all', 'guide', 'lively']);
  await group.locator('select[name="my_motion"]').selectOption('off');
  assert.deepEqual(await stored(page), { workMode: 'all', help: 'guide', motion: 'off' });
  await page.reload();
  await goRail(page, 'settings');
  assert.equal(await page.locator('[data-group="make_it_yours"] select[name="my_motion"]').inputValue(), 'off');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('Skip stores the defaults and never asks again', async () => {
  const { page, context, seen } = await open({ hash: '?onboard=1' });
  await asking(page).waitFor();
  await page.locator('[data-onb-skip]').click();
  await asking(page).waitFor({ state: 'detached' });
  assert.deepEqual(await stored(page), DEFAULTS);
  await page.reload();
  await page.waitForSelector('.kpi-v');
  await page.waitForTimeout(800);
  assert.equal(await asking(page).count(), 0);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

for (const [help, opens] of [['visuals', false], ['expert', false], ['guide', true]]) {
  test(`help ${help}: a first visit ${opens ? 'opens' : 'does not open'} the tour, and Take the tour works`, async () => {
    const { page, context } = await open({ hash: '?tour=auto', watch: async (p) => { await STILL(p); await prefsFirst(MY, PERSON, { ...DEFAULTS, help })(p); } });
    if (opens) await page.waitForSelector('.tour-pop', { state: 'attached', timeout: 15000 });
    else assert.equal(await tourLater(page), 0);
    if (opens) { await page.keyboard.press('Escape'); await page.waitForSelector('.tour', { state: 'detached' }); }
    await page.locator('[data-avatar-menu] button').first().click();
    await page.getByRole('menuitem', { name: 'Take the tour' }).click();
    await page.waitForSelector('.tour-pop', { state: 'attached', timeout: 15000 });
    await context.close();
  });
}

test('a tour written with 7 steps shows at most 5', async () => {
  const { page, context } = await open({ hash: '?tour=1' });
  await page.waitForSelector('.tour-step', { timeout: 15000 });
  assert.equal((await page.locator('.tour-step').textContent()).replace(/^\d+/, 'k'), 'k / 5');
  await context.close();
});

test('motion off, and reduced motion, leave nothing running in the questions; lively animates them', async () => {
  const running = (page) => page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.target?.closest?.('[data-onboarding]')).length);
  const lively = await open({ hash: '?onboard=1', watch: async (p) => { await p.emulateMedia({ reducedMotion: 'no-preference' }); } });
  await asking(lively.page).waitFor();
  assert.ok(await running(lively.page) > 0, 'the previews animate when nothing says otherwise');
  await lively.context.close();
  const off = await open({ hash: '?onboard=1', watch: async (p) => { await p.emulateMedia({ reducedMotion: 'no-preference' }); await prefsFirst(MY, PERSON, { motion: 'off' })(p); } });
  await asking(off.page).waitFor();
  for (const [q, o] of [['work', 'one'], ['help', 'guide']]) {
    assert.equal(await running(off.page), 0, `motion off, screen ${q}`);
    await pick(off.page, q, o);
  }
  assert.equal(await running(off.page), 0, 'motion off, screen motion');
  await off.context.close();
  const still = await open({ hash: '?onboard=1' });
  await asking(still.page).waitFor();
  assert.equal(await running(still.page), 0, 'reduced motion wins');
  await still.context.close();
});

test('keyboard only: focus stays in the dialog, options and buttons work, Esc skips', async () => {
  const { page, context, seen } = await open({ hash: '?onboard=1' });
  await asking(page).waitFor();
  const inside = () => page.evaluate(() => document.querySelector('[data-onboarding]').contains(document.activeElement));
  assert.ok(await inside(), 'focus starts in the dialog');
  const tabTo = async (sel) => { for (let i = 0; i < 12; i += 1) { if (await page.evaluate((s) => !!document.activeElement?.matches(s), sel)) return; await page.keyboard.press('Tab'); assert.ok(await inside()); } assert.fail(`never reached ${sel}`); };
  await tabTo('[data-onb-opt="all"]');
  await page.keyboard.press('Enter');
  await tabTo('[data-onb-next]');
  await page.keyboard.press('Enter');
  await page.locator('[data-onb-q="help"]').waitFor();
  await page.keyboard.press('Escape');
  await asking(page).waitFor({ state: 'detached' });
  assert.deepEqual(await stored(page), DEFAULTS, 'Esc is Skip');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

for (const [width, height] of [[1280, 800], [640, 400]]) {
  test(`every question fits ${width}x${height} with no sideways scroll`, async () => {
    const { page, context } = await open({ hash: '?onboard=1', width, height });
    await asking(page).waitFor();
    for (const [q, o] of [['work', 'one'], ['help', 'guide'], ['motion', 'calm']]) {
      await page.locator(`[data-onb-q="${q}"]`).waitFor();
      await page.waitForTimeout(300);
      const fit = await page.evaluate(() => {
        const r = document.querySelector('[data-onboarding] [role="dialog"]').getBoundingClientRect();
        return { in: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, side: document.documentElement.scrollWidth - innerWidth };
      });
      assert.equal(fit.in, true, `${q} sits inside ${width}x${height}`);
      assert.ok(fit.side <= 0, `${q} scrolls sideways by ${fit.side}`);
      await pick(page, q, o);
    }
    await context.close();
  });
}
