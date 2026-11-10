import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { SRC, appInfo, bundleEntry, goRail, openApp, openBundle, pageData, serveDist } from './harness.mjs';
import { EXAMPLES } from './exampleRoutes.mjs';
import { fillTourText, holeOf, pickTourLanguage, placeTour, sentencesOf, tourSection } from '../src/tour.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(HERE, '..', 'dist', 'assets');
const KINDS = JSON.parse(readFileSync(join(HERE, '..', '..', 'kinds.json'), 'utf8'));
const WORDS = KINDS.tour.languages;
const STILL = (p) => p.emulateMedia({ reducedMotion: 'reduce' });
const ROWS = pageData({}).records.rows;
const WRITTEN = [
  { anchor: 'decision', title: 'Stop the discounts that lose margin', text: 'This desk ranks discounts by the margin they lose. {open_count} are waiting.' },
  { anchor: 'kpis', title: 'Margin lost so far', text: 'The first tile is the margin lost to discounts, {kpi:total_loss} in this window.' },
  { anchor: 'records', title: 'Your discount list', text: 'Each discount here needs a keep or stop decision. {open_count} wait for you now.' },
  { anchor: 'top_record', title: 'Start with the worst', text: 'Start with {top_record}, it loses the most margin.' },
  { anchor: 'alerts', title: 'Hear about new losses', text: 'Set an email alert to hear when a new run finds a new loss.' },
  { anchor: 'genie', title: 'Ask why', text: 'Ask Genie why a discount loses margin, in your own words.' },
];

let served;
let base;
let browser;
before(async () => { served = await serveDist(); base = served.base; browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

const written = (steps = WRITTEN, languages = ['English']) => ({ tour: { languages, steps: { English: steps } } });

async function stepNow(page, after = 0) {
  if (!after) await page.waitForSelector('.tour', { state: 'attached', timeout: 15000 });
  const shown = await page.waitForFunction((was) => {
    const tour = document.querySelector('.tour');
    const pop = document.querySelector('.tour-pop');
    if (!tour) return 'ended';
    if (!pop || Number(tour.dataset.tourStep) === was || getComputedStyle(pop).visibility === 'hidden') return false;
    const target = [...document.querySelectorAll(`[data-tour="${tour.dataset.tourOn}"]`)].find((el) => el.getBoundingClientRect().width > 0);
    const hole = document.querySelector('.tour-hole').getBoundingClientRect();
    if (!target) return false;
    const r = target.getBoundingClientRect();
    const near = (a, b) => Math.abs(a - b) <= 8;
    return near(hole.left, Math.max(r.left - 6, 2)) && near(hole.top, Math.max(r.top - 6, 2)) ? 'shown' : false;
  }, after, { timeout: 15000 });
  if (await shown.jsonValue() === 'ended') return null;
  let words = '';
  for (let still = 0; still < 4;) {
    await page.waitForTimeout(150);
    const now = await page.evaluate(() => document.querySelector('.tour-pop')?.textContent || '');
    still = now === words ? still + 1 : 0;
    words = now;
  }
  return page.evaluate(() => {
    const tour = document.querySelector('.tour');
    const pop = document.querySelector('.tour-pop').getBoundingClientRect();
    return {
      at: Number(tour.dataset.tourStep), anchor: tour.dataset.tourOn, title: document.querySelector('#tour-t').textContent,
      text: document.querySelector('#tour-x').textContent, count: document.querySelector('.tour-step').textContent,
      pop: { left: pop.left, top: pop.top, right: pop.right, bottom: pop.bottom, width: pop.width }, view: { width: innerWidth, height: innerHeight },
      sideways: document.documentElement.scrollWidth - innerWidth, hash: location.hash, focus: document.activeElement?.dataset?.tourNext !== undefined,
    };
  });
}

async function walk(page) {
  const seen = [];
  let at = 0;
  for (;;) {
    const now = await stepNow(page, at);
    if (!now) return seen;
    seen.push(now);
    at = now.at;
    await page.locator('[data-tour-next]').click();
    const going = await page.waitForFunction((was) => {
      const tour = document.querySelector('.tour');
      return !tour ? 'ended' : Number(tour.dataset.tourStep) !== was ? 'next' : null;
    }, at, { timeout: 15000 });
    if (await going.jsonValue() === 'ended') return seen;
  }
}

test('placeholders fill from loaded facts and a sentence whose value did not load is dropped cleanly', () => {
  assert.deepEqual(sentencesOf('One. Two is 2.5 now! Three'), ['One. ', 'Two is 2.5 now! ', 'Three']);
  const facts = { kpis: { total_loss: '$12.3K' }, open_count: '14', top_record: 'Blue kettle' };
  assert.equal(fillTourText('Start with {top_record}. {open_count} are open.', facts), 'Start with Blue kettle. 14 are open.');
  assert.equal(fillTourText('Lost {kpi:total_loss} so far.', facts), 'Lost $12.3K so far.');
  assert.equal(fillTourText('Each one needs a decision. {open_count} are open now.', { kpis: {} }), 'Each one needs a decision.');
  assert.equal(fillTourText('Lost {kpi:missing} so far. Act on the top one.', facts), 'Act on the top one.');
  assert.equal(fillTourText('كل عنصر يحتاج قراراً. {open_count} مفتوحة الآن.', {}), 'كل عنصر يحتاج قراراً.');
  assert.equal(fillTourText('从第一项开始。当前是 {top_record}。', {}), '从第一项开始。');
  assert.equal(fillTourText('{top_record} first.', null), '');
});

test('the viewer language picks the tour language, the first written language is the fallback', () => {
  const langs = [{ language: 'English', code: 'en', steps: [{}] }, { language: 'Arabic', code: 'ar', steps: [{}] }, { language: 'French', code: 'fr', steps: [] }];
  assert.equal(pickTourLanguage(langs, ['ar-SA', 'en']).language, 'Arabic');
  assert.equal(pickTourLanguage(langs, ['fr-FR', 'de']).language, 'English', 'a language with no steps is not picked');
  assert.equal(pickTourLanguage(langs, []).language, 'English');
  assert.equal(pickTourLanguage([], ['en']), null);
});

test('the popover sits below, flips above, clamps to the screen and mirrors in right to left', () => {
  const view = { width: 1280, height: 800 };
  const pop = { width: 316, height: 150 };
  assert.deepEqual(placeTour({ left: 100, top: 100, width: 200, height: 40 }, pop, view), { left: 100, top: 154, side: 'below' });
  assert.equal(placeTour({ left: 100, top: 700, width: 200, height: 40 }, pop, view).side, 'above');
  assert.equal(placeTour({ left: 1200, top: 100, width: 70, height: 40 }, pop, view).left, 1280 - 316 - 8);
  assert.equal(placeTour({ left: 900, top: 100, width: 300, height: 40 }, pop, view, 'rtl').left, 900 + 300 - 316);
  const tall = placeTour({ left: 8, top: 4, width: 1264, height: 790 }, pop, view);
  assert.equal(tall.side, 'over');
  assert.ok(tall.left + 316 <= 1280 - 8 && tall.top + 150 <= 800 - 8);
  assert.deepEqual(holeOf({ left: -40, top: 10, right: 2000, bottom: 60 }, view), { left: 2, top: 4, width: 1276, height: 62 });
  assert.equal(tourSection('records', { rail: ['genie'], records: ['records'] }, true), 'work');
  assert.equal(tourSection('records', { rail: ['genie'], records: ['records'] }, false), 'dashboard');
  assert.equal(tourSection('genie', { rail: ['genie'], records: ['records'] }, true), null);
});

test('the tour starts on a first visit only, never under automation unless asked, and the key holds the person, page and version', async () => {
  const parts = await bundleEntry(`import * as start from ${JSON.stringify(join(SRC, 'tourStart.js'))};\nwindow.start = start;`);
  const { page, context, errors } = await openBundle(browser, parts, {});
  const out = await page.evaluate(() => {
    const { tourDue, tourKey, markTourSeen, tourAsked } = window.start;
    localStorage.clear();
    const key = tourKey('pat@example.com', 'n01_u01', 'abc');
    const row = [key, key === tourKey('sam@example.com', 'n01_u01', 'abc'), tourAsked('?tour=auto&x=1'), tourAsked('?x=1'),
      tourDue(key, '', true), tourDue(key, '', false), tourDue(key, 'auto', true)];
    markTourSeen(key);
    row.push(tourDue(key, '', false), tourDue(key, 'auto', true), tourDue(key, '1', true), tourDue(tourKey('pat@example.com', 'n01_u01', 'new'), '', false));
    return row;
  });
  assert.deepEqual(out, ['inspire-tour:v1:pat@example.com:n01_u01:abc', false, 'auto', '', false, true, true, false, false, true, true]);
  assert.deepEqual(errors, []);
  await context.close();
});

test('the engine is its own lazy chunk, so the App bundle does not carry it', () => {
  const files = readdirSync(ASSETS);
  assert.ok(files.includes('Tour.js') && files.includes('Tour.css'), files.join(','));
  const app = readFileSync(join(ASSETS, 'app.js'), 'utf8');
  assert.ok(!app.includes('tour-pop') && !app.includes('tour-hole'));
  assert.ok(readFileSync(join(ASSETS, 'Tour.js'), 'utf8').includes('tour-pop'));
});

test('an automated browser opens the App without a tour, and a first visit asked as real starts it once', async () => {
  const info = appInfo({}, 1, written());
  const plain = await openApp(browser, base, info, { watch: STILL });
  await plain.page.waitForTimeout(1500);
  assert.equal(await plain.page.locator('.tour').count(), 0);
  await plain.context.close();
  const { page, context, seen } = await openApp(browser, base, info, { watch: STILL, hash: '?tour=auto' });
  const first = await stepNow(page);
  assert.equal(first.anchor, 'decision');
  assert.equal(first.title, WRITTEN[0].title);
  await page.keyboard.press('Escape');
  await page.waitForSelector('.tour', { state: 'detached' });
  await page.reload();
  await page.waitForSelector('.kpi-v');
  await page.waitForTimeout(1500);
  assert.equal(await page.locator('.tour').count(), 0, 'the same viewer is not shown it twice');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the tour walks every step it can show, skips a missing anchor, fills live facts and goes back where it started', async () => {
  const info = appInfo({}, 1, written());
  const { page, context, seen } = await openApp(browser, base, info, { watch: STILL, hash: '?tour=1' });
  const steps = await walk(page);
  assert.deepEqual(steps.map((s) => s.anchor), ['decision', 'kpis', 'view', 'records', 'top_record', 'genie'], 'alerts is off in this App, so the tour writes no alerts step and the template fills the place with the view');
  assert.equal(steps[0].text, 'This desk ranks discounts by the margin they lose.', 'the open count had not loaded on the dashboard, so its sentence is dropped');
  assert.match(steps[1].text, /^The first tile is the margin lost to discounts, \S+ in this window\.$/);
  assert.ok(!steps.some((s) => /[{}]/.test(s.text)));
  assert.equal(steps[3].text, `Each discount here needs a keep or stop decision. ${ROWS.length} wait for you now.`);
  assert.equal(steps[4].text, `Start with ${ROWS[0].entity_label}, it loses the most margin.`);
  assert.match(steps[3].hash, /work/, 'the list lives on the work section of a queue page');
  assert.deepEqual(steps.map((s) => s.count), ['1 / 6', '2 / 6', '3 / 6', '4 / 6', '5 / 6', '6 / 6']);
  await page.waitForFunction(() => !/work/.test(location.hash));
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('keys move, Tab stays in the popover, Esc closes and focus returns to Take the tour', async () => {
  const info = appInfo({}, 1, written());
  const { page, context } = await openApp(browser, base, info, { watch: STILL });
  await goRail(page, 'settings');
  await page.locator('[data-take-tour]').click();
  await stepNow(page);
  await page.waitForFunction(() => document.activeElement?.hasAttribute('data-tour-next'), null, { timeout: 3000 });
  await page.keyboard.press('ArrowRight');
  assert.equal((await stepNow(page, 1)).anchor, 'kpis');
  await page.keyboard.press('ArrowLeft');
  assert.equal((await stepNow(page, 2)).anchor, 'decision');
  for (let i = 0; i < 5; i += 1) {
    await page.keyboard.press('Tab');
    assert.ok(await page.evaluate(() => document.querySelector('.tour-pop').contains(document.activeElement)), 'focus stays in the popover');
  }
  await page.keyboard.press('Shift+Tab');
  assert.ok(await page.evaluate(() => document.querySelector('.tour-pop').contains(document.activeElement)));
  await page.keyboard.press('Escape');
  await page.waitForSelector('.tour', { state: 'detached' });
  await page.waitForFunction(() => document.activeElement?.hasAttribute('data-take-tour'));
  assert.match(await page.evaluate(() => location.hash), /settings/, 'the tour returns to the section it started from');
  await page.locator('[data-take-tour]').click();
  await stepNow(page);
  await page.locator('[data-tour-skip]').click();
  await page.waitForSelector('.tour', { state: 'detached' });
  await page.locator('.tour-catch').count().then((n) => assert.equal(n, 0));
  await context.close();
});

test('an Arabic viewer gets the Arabic tour right to left, in the dark theme, with arrows mirrored', async () => {
  const info = { ...appInfo({}, 1, written(WRITTEN, ['English', 'Arabic'])), theme: 'dark' };
  const { page, context: ctx, seen } = await openApp(browser, base, info, { width: 1280, height: 800, scheme: 'dark', watch: async (p) => {
    await STILL(p);
    await p.addInitScript(() => Object.defineProperty(navigator, 'languages', { get: () => ['ar-SA', 'ar'] }));
  }, hash: '?tour=1' });
  const first = await stepNow(page);
  assert.equal(first.title, WORDS.Arabic.steps.decision.title);
  const pop = await page.evaluate(() => {
    const el = document.querySelector('.tour-pop');
    const bg = getComputedStyle(el).backgroundColor.match(/\d+/g).slice(0, 3).map(Number);
    return { dir: el.getAttribute('dir'), lang: el.getAttribute('lang'), next: el.querySelector('[data-tour-next]').textContent, bg };
  });
  assert.deepEqual([pop.dir, pop.lang, pop.next], ['rtl', 'ar', WORDS.Arabic.ui.next]);
  assert.ok(pop.bg.reduce((a, b) => a + b, 0) < 3 * 90, `the popover follows the dark theme, got ${pop.bg}`);
  await page.keyboard.press('ArrowLeft');
  assert.equal((await stepNow(page, 1)).at, 2, 'in right to left the left arrow moves forward');
  await page.keyboard.press('ArrowRight');
  assert.equal((await stepNow(page, 2)).at, 1);
  assert.deepEqual(seen.errors, []);
  await ctx.close();
});

test('reduced motion turns the movement off and print hides the tour', async () => {
  const info = appInfo({}, 1, written());
  const { page, context } = await openApp(browser, base, info, { watch: STILL, hash: '?tour=1' });
  await stepNow(page);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.tour-hole')).transitionDuration.split(',').every((d) => parseFloat(d) === 0)), true);
  await page.emulateMedia({ media: 'print', reducedMotion: 'reduce' });
  assert.equal(await page.evaluate(() => ['.tour-hole', '.tour-catch', '.tour-pop'].every((s) => getComputedStyle(document.querySelector(s)).display === 'none')), true);
  await page.emulateMedia({ media: 'screen', reducedMotion: 'no-preference' });
  assert.notEqual(await page.evaluate(() => getComputedStyle(document.querySelector('.tour-hole')).transitionDuration), '0s');
  await context.close();
});

for (const [width, height] of [[1280, 800], [1440, 900], [640, 400]]) {
  test(`every step fits a ${width}x${height} screen with no sideways scroll`, async () => {
    const info = appInfo({}, 1, written());
    const { page, context } = await openApp(browser, base, info, { width, height, watch: STILL, hash: '?tour=1' });
    const steps = await walk(page);
    assert.ok(steps.length >= 3, steps.map((s) => s.anchor).join(','));
    for (const s of steps) {
      assert.ok(s.pop.left >= 0 && s.pop.right <= s.view.width && s.pop.top >= 0 && s.pop.bottom <= s.view.height, `${s.anchor} ${JSON.stringify(s.pop)}`);
      assert.ok(s.pop.width <= 316 && s.pop.width >= Math.min(316, width - 24) - 1);
      assert.ok(s.sideways <= 0, `${s.anchor} scrolls sideways by ${s.sideways}`);
    }
    await context.close();
  });
}

for (const [file, spec] of Object.entries(EXAMPLES)) {
  test(`the ${file.replace('.json', '')} layout takes its template tour end to end`, async () => {
    const info = appInfo(spec.settings, 1, {}, `examples/${file}`);
    const { page, context, seen } = await openApp(browser, base, info, { routes: spec.routes(), watch: STILL, hash: '?tour=1', ready: '[data-page-section]' });
    const steps = await walk(page);
    const allowed = KINDS.tour.layouts[info.pages[0].layout.id];
    assert.ok(steps.length >= 4, `${file}: ${steps.map((s) => s.anchor).join(',')}`);
    assert.ok(steps.every((s) => allowed.includes(s.anchor) && !/[{}]/.test(s.text) && s.title));
    assert.deepEqual(seen.errors, []);
    await context.close();
  });
}
