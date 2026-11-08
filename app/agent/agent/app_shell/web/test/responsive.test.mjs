import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { appInfo, chartsDrawn, framed, moved, openApp, resizeTo, serveDist } from './harness.mjs';

const WIDTHS = [1600, 1280, 768, 375];
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

function measure(scrollers) {
  const shown = (el) => !!el && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden' && el.getBoundingClientRect().width > 0;
  const inView = (el) => { const r = el.getBoundingClientRect(); return r.left >= -1 && r.right <= window.innerWidth + 1; };
  const bleeding = [...document.querySelectorAll('.app *')].filter((el) => {
    if (!shown(el) || el.closest(scrollers) || el.closest('.side:not(.is-open)')) return false;
    const r = el.getBoundingClientRect();
    return r.right > window.innerWidth + 1 || r.left < -1;
  }).slice(0, 5).map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`);
  const cards = [...document.querySelectorAll('[data-card]')];
  return {
    pageScroll: document.documentElement.scrollWidth - window.innerWidth,
    bleeding,
    kpiColumns: getComputedStyle(document.querySelector('.kpis')).gridTemplateColumns.split(' ').length,
    kpiClipped: [...document.querySelectorAll('.kpi')].filter((k) => k.scrollWidth > k.clientWidth + 1).length,
    chartColumns: getComputedStyle(document.querySelector('.charts')).gridTemplateColumns.split(' ').length,
    chartWidths: cards.map((c) => Math.round(c.querySelector('canvas')?.getBoundingClientRect().width || 0)),
    chartsFit: cards.every((c) => { const cv = c.querySelector('canvas'); return cv && cv.getBoundingClientRect().width <= c.getBoundingClientRect().width + 1; }),
    menu: shown(document.querySelector('.menu-btn')),
    tabs: shown(document.querySelector('.tabs')),
    drawerOpen: shown(document.querySelector('.side')) && inView(document.querySelector('.side')),
    sideInline: shown(document.querySelector('.side')) && getComputedStyle(document.querySelector('.side')).position !== 'absolute',
  };
}

const snapshot = (page) => page.evaluate(measure, SCROLLERS);
const FIRST = '#/n01_u05';

async function openPage(info, width) {
  const opened = await openApp(browser, served.base, info, { width });
  await opened.page.goto(`${served.base}${FIRST}`);
  await opened.page.waitForFunction(() => document.querySelector('.ph h1')?.textContent === 'Price-loss decision desk');
  return opened;
}

async function resize(page, width) {
  await resizeTo(page, width);
  await page.waitForFunction(chartsDrawn, 4);
}

for (const layout of ['sidebar', 'tabs', 'home']) {
  test(`the ${layout} layout fits 1600, 1280, 768 and 375 pixels with no sideways scroll`, async () => {
    const { page, seen, context } = await openPage(appInfo({ layout }, 6), WIDTHS[0]);
    await page.waitForFunction(chartsDrawn, 4);
    const widths = {};
    for (const width of WIDTHS) {
      await resize(page, width);
      const m = await snapshot(page);
      const at = `${layout} at ${width}px`;
      widths[width] = m.chartWidths;
      assert.equal(m.pageScroll, 0, `${at} scrolls sideways`);
      assert.deepEqual(m.bleeding, [], `${at} has elements outside the screen`);
      assert.equal(m.kpiClipped, 0, `${at} clips a KPI`);
      assert.equal(m.kpiColumns, width >= 1280 ? 3 : 2, `${at} KPI columns`);
      assert.equal(m.chartColumns, width >= 1280 ? 2 : 1, `${at} chart columns`);
      assert.ok(m.chartsFit, `${at} draws a chart wider than its card`);
      assert.equal(m.menu, width < 860, `${at} menu button`);
      assert.equal(m.drawerOpen, width >= 860, `${at} section rail`);
      assert.equal(m.tabs, false, `${at} tab strip`);
      assert.equal(m.sideInline, width >= 860, `${at} inline rail`);
    }
    assert.ok(widths[375][0] < widths[768][0] && widths[768][0] <= widths[1600][0], `charts resize with the screen: ${JSON.stringify(widths)}`);
    assert.deepEqual(seen.errors, []);
    await context.close();
  });
}

const sideOpen = (page) => page.evaluate(() => {
  const el = document.querySelector('.side');
  const r = el.getBoundingClientRect();
  return getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden' && r.width > 0 && r.left >= -1 && r.right <= window.innerWidth + 1;
});

test('on a phone the sections sit behind the menu and the switcher lists every use case', async () => {
  const { page, seen, context } = await openPage(appInfo({}, 6), 375);
  await page.waitForFunction(chartsDrawn, 4);
  assert.equal(await page.locator('.side').isVisible(), false);
  await page.getByRole('button', { name: 'Open the sections' }).click();
  await page.waitForTimeout(300);
  assert.ok(await sideOpen(page), 'the menu opens the sections on screen');
  assert.deepEqual(await page.locator('[data-rail]').evaluateAll((all) => all.map((r) => r.dataset.rail)), ['dashboard', 'work', 'performance', 'runs', 'settings']);
  await page.locator('[data-rail="runs"]').click();
  await page.waitForTimeout(300);
  assert.equal(await sideOpen(page), false, 'picking a section closes the menu');
  await page.getByRole('button', { name: 'Open the sections' }).click();
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  assert.equal(await sideOpen(page), false, 'Escape closes the menu');
  await page.locator('[data-switcher]').click();
  assert.equal(await page.locator('[data-case]').count(), 6);
  await page.locator('[data-case]', { hasText: 'Second desk 3' }).click();
  await page.waitForFunction(() => document.querySelector('.ph h1')?.textContent === 'Second desk 3');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the three styles and the open Genie panel stay on a phone screen', async () => {
  for (const style of ['a', 'b', 'c']) {
    const { page, seen, context } = await openPage(appInfo({ style, layout: 'tabs' }, 6), 375);
    await page.waitForFunction(chartsDrawn, 4);
    let m = await snapshot(page);
    assert.equal(m.pageScroll, 0, `style ${style}`);
    assert.deepEqual(m.bleeding, [], `style ${style}`);
    await page.getByRole('button', { name: 'Ask Genie', exact: true }).click();
    await page.locator('.genie').waitFor();
    m = await snapshot(page);
    assert.equal(m.pageScroll, 0, `style ${style} with Ask Genie open`);
    assert.deepEqual(m.bleeding, [], `style ${style} with Ask Genie open`);
    assert.deepEqual(seen.errors, []);
    await context.close();
  }
});

test('a long App title and subtitle end in an ellipsis instead of widening the page', async () => {
  const title = 'N05-U01 Recommend Cross-Sell Item Bundles with Next-Best-Offer Playbook';
  for (const layout of ['sidebar', 'tabs', 'home']) {
    const { page, seen, context } = await openPage(appInfo({ layout, title, subtitle: `${title} · built by Inspire` }, 2), 1600);
    await page.waitForFunction(chartsDrawn, 4);
    for (const width of [1280, 768, 375]) {
      await resize(page, width);
      const at = `${layout} at ${width}px`;
      assert.equal((await snapshot(page)).pageScroll, 0, `${at} scrolls sideways`);
      const cut = await page.locator('.mark-t b').evaluate((b) => ({
        ellipsis: getComputedStyle(b).textOverflow === 'ellipsis', clipped: b.scrollWidth > b.clientWidth, right: Math.round(b.getBoundingClientRect().right),
      }));
      assert.ok(cut.right <= width, `${at}: the title ends on screen ${JSON.stringify(cut)}`);
      if (width === 375) assert.ok(cut.clipped && cut.ellipsis, `${at}: the title is cut with an ellipsis ${JSON.stringify(cut)}`);
      assert.ok(await page.getByRole('button', { name: 'Ask Genie', exact: true }).isVisible(), `${at}: Ask Genie stays on screen`);
    }
    assert.deepEqual(seen.errors, []);
    await context.close();
  }
});

test('on a phone the calendar icon stays beside the first line of the data date when the line wraps', async () => {
  const sponsor = 'Head of Merchandising and Category Planning for the Gulf region';
  const { page, seen, context } = await openApp(browser, served.base, appInfo({}, 1, { sponsor }), { width: 375 });
  await page.waitForFunction(chartsDrawn, 4);
  const meta = () => page.locator('.ph-meta').evaluate((el) => {
    const icon = el.querySelector('svg').getBoundingClientRect();
    const text = el.querySelector('span') || el;
    const range = document.createRange();
    range.selectNodeContents(text);
    const lines = [...range.getClientRects()].map((r) => Math.round(r.top));
    const first = Math.min(...lines);
    return { text: text.textContent, rows: new Set(lines).size, iconTop: Math.round(icon.top), iconRight: Math.round(icon.right), first,
             left: Math.round(Math.min(...[...range.getClientRects()].map((r) => r.left))) };
  });
  const m = await meta();
  assert.match(m.text, new RegExp(`sponsor ${sponsor}`));
  assert.ok(m.rows >= 2, `the probe needs a wrapped line: ${JSON.stringify(m)}`);
  assert.ok(Math.abs(m.iconTop - m.first) <= 6, `the icon sits on the first line: ${JSON.stringify(m)}`);
  assert.ok(m.iconRight <= m.left, `the icon is left of the text: ${JSON.stringify(m)}`);
  assert.equal((await snapshot(page)).pageScroll, 0);
  await page.addStyleTag({ content: '.ph-meta{flex-wrap:wrap;align-items:center}.ph-meta>span{min-width:max-content}' });
  await framed(page);
  const broken = await meta();
  assert.ok(Math.abs(broken.iconTop - broken.first) > 6 || broken.iconRight > broken.left, `the check catches the old wrap: ${JSON.stringify(broken)}`);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the check catches a page that does not fit the phone', async () => {
  const { page, context } = await openPage(appInfo({}, 2), 375);
  await page.waitForFunction(chartsDrawn, 4);
  await page.addStyleTag({ content: '.ph h1{min-width:620px}' });
  await framed(page);
  const m = await snapshot(page);
  assert.ok(m.bleeding.includes('h1.'), JSON.stringify(m.bleeding));
  await context.close();
});
