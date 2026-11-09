import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { appInfo, openApp, serveDist } from './harness.mjs';
import { EXAMPLES } from './exampleRoutes.mjs';
import { activeRing, unnamedControls, weakFocus } from './access.mjs';

const SCROLLERS = '.tbl-wrap, .msg-t, .tabs';
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

async function openExample(file, size) {
  const example = EXAMPLES[file];
  const opened = await openApp(browser, served.base, appInfo(example.settings, 1, {}, `examples/${file}`), { ...size, routes: example.routes() });
  await example.ready(opened.page);
  return opened;
}

const bleeding = (page) => page.evaluate((scrollers) => [...document.querySelectorAll('.main *')].filter((el) => {
  if (el.closest(scrollers) || !el.getClientRects().length) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1);
}).slice(0, 5).map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`), SCROLLERS);

for (const file of Object.keys(EXAMPLES)) {
  test(`${file} at 1280x800 names every control for a screen reader and shows a ring of at least 3:1 contrast on every control the keyboard reaches`, async () => {
    const { page, seen, context } = await openExample(file, { width: 1280, height: 800 });
    try {
      assert.deepEqual(await unnamedControls(page, '.app'), [], `${file}: controls a screen reader reads with no name`);
      const walk = await weakFocus(page, { max: 40 });
      assert.ok(walk.checked >= 8, `${file}: the keyboard reached ${walk.checked} controls`);
      assert.deepEqual(walk.weak, [], `${file}: controls with no visible focus`);
      assert.deepEqual(seen.errors, []);
    } finally {
      await context.close();
    }
  });

  test(`${file} at 200% zoom of a 1280x800 screen keeps every part of the page on screen, wide tables scroll inside their own box`, async () => {
    const { page, context } = await openExample(file, { width: 640, height: 400 });
    try {
      assert.deepEqual(await bleeding(page), [], `${file}: parts of the page sit off screen`);
    } finally {
      await context.close();
    }
  });
}

test('a menu opened from the keyboard and the Views popover show a 3:1 ring on the item the keyboard is on, not only a tinted background', async () => {
  const { page, context } = await openExample('forecast_cockpit.json', { width: 1280, height: 800 });
  try {
    const exportButton = page.getByRole('button', { name: /^Export / }).first();
    await exportButton.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('menu').waitFor();
    await page.keyboard.press('ArrowDown');
    const item = await activeRing(page);
    assert.match(item.what, /^button /);
    assert.ok(item.ok, `the menu item ${item.what} shows ${item.strong} of ${item.need} ring pixels`);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Views', exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Save this view' }).waitFor();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    const save = await activeRing(page);
    assert.match(save.what, /Save this view/);
    assert.ok(save.ok, `Save this view shows ${save.strong} of ${save.need} ring pixels`);
  } finally {
    await context.close();
  }
});

test('under right to left the back, next, send and undo icons point the reading way (must-exclude: left to right and other icons stay as drawn)', async () => {
  const { page, context } = await openExample('forecast_cockpit.json', { width: 1280, height: 800 });
  try {
    const read = () => page.evaluate(() => [...document.querySelectorAll('svg.i')].filter((el) => el.getClientRects().length)
      .map((el) => [/\bi-(left|right|send|undo)\b/.test(el.getAttribute('class')), getComputedStyle(el).scale]));
    const ltr = await read();
    assert.ok(ltr.some(([turns]) => turns) && ltr.some(([turns]) => !turns), 'the page draws direction icons and other icons');
    assert.ok(ltr.every(([, scale]) => scale === 'none'));
    await page.evaluate(() => { document.documentElement.dir = 'rtl'; });
    const rtl = await read();
    assert.ok(rtl.every(([turns, scale]) => scale === (turns ? '-1 1' : 'none')), JSON.stringify(rtl));
  } finally {
    await context.close();
  }
});

test('the checks catch an unnamed progress bar and a filter button named only by its value (must-exclude)', async () => {
  const { page, context } = await openExample('forecast_cockpit.json', { width: 1280, height: 800 });
  try {
    await page.evaluate(() => document.querySelector('.main').insertAdjacentHTML('afterbegin',
      '<div id="seeded"><div role="progressbar" aria-valuenow="3" aria-valuemax="9"></div><button type="button" aria-labelledby="nothing-here"></button>'
      + '<table style="width:2000px"><tr><td>wide</td></tr></table></div>'));
    assert.deepEqual(await unnamedControls(page, '#seeded'), ['- progressbar', '- button']);
    await page.setViewportSize({ width: 640, height: 400 });
    assert.deepEqual((await bleeding(page)).slice(0, 4), ['table.', 'tbody.', 'tr.', 'td.']);
  } finally {
    await context.close();
  }
});
