import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { appInfo, chartsDrawn, framed, idle, moved, openApp, resizeTo, serveDist } from './harness.mjs';

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
    if (!shown(el) || el.closest(scrollers)) return false;
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
    tabs: shown(document.querySelector('.tabs')),
    // REQ-506: no side rail and no menu button; the header carries the use case switcher, the Screen | Genie switch and the avatar.
    rail: document.querySelectorAll('.side, [data-rail], .menu-btn').length,
    header: ['[data-switcher]', '[data-mode-switch]', '[data-avatar-menu]'].map((q) => shown(document.querySelector(q)) && inView(document.querySelector(q))),
    headerFits: document.querySelector('.top').scrollWidth <= document.querySelector('.top').clientWidth + 1,
  };
}

// The dashboard KPIs and charts are not drawn on the Genie screen, so only the width checks apply there.
function measureGenie(scrollers) {
  const bleeding = [...document.querySelectorAll('.app *')].filter((el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || el.getBoundingClientRect().width <= 0 || el.closest(scrollers)) return false;
    const r = el.getBoundingClientRect();
    return r.right > window.innerWidth + 1 || r.left < -1;
  }).slice(0, 5).map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`);
  return { pageScroll: document.documentElement.scrollWidth - window.innerWidth, bleeding };
}

const snapshot = (page) => page.evaluate(measure, SCROLLERS);
const FIRST = '#/n01_u05/dashboard';

async function openPage(info, width, heading = 'Price-loss decision desk') {
  const opened = await openApp(browser, served.base, info, { width });
  await opened.page.goto(`${served.base}${FIRST}`);
  await opened.page.waitForFunction((h) => document.querySelector('.ph h1')?.textContent === h, heading);
  return opened;
}

async function resize(page, width) {
  await resizeTo(page, width);
  await idle(page);
  await framed(page);
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'), null, { timeout: 10000 });
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
      assert.equal(m.rail, 0, `${at} has no side rail and no menu button`);
      assert.deepEqual(m.header, [true, true, true], `${at} header switcher, Screen | Genie switch and avatar are on screen`);
      assert.ok(m.headerFits, `${at} header does not overflow`);
      assert.equal(m.tabs, false, `${at} tab strip`);
    }
    assert.ok(widths[375][0] < widths[768][0] && widths[768][0] <= widths[1600][0], `charts resize with the screen: ${JSON.stringify(widths)}`);
    assert.deepEqual(seen.errors, []);
    await context.close();
  });
}

const owned = (info) => ({ ...info, pages: info.pages.map((p) => ({ ...p, is_owner: true })) });
const menuNames = (page) => page.locator('[data-avatar-menu] [role="menuitem"]').evaluateAll((all) => all.map((m) => m.textContent.trim()));
const menuOpen = (page) => page.locator('[data-avatar-menu] [role="menu"]').isVisible();

test('on a phone the other screens sit behind the avatar menu and the switcher lists every use case', async () => {
  const { page, seen, context } = await openPage(owned(appInfo({}, 6)), 375);
  await page.waitForFunction(chartsDrawn, 4);
  assert.equal(await page.locator('.side, [data-rail]').count(), 0);
  assert.equal(await menuOpen(page), false);
  await page.locator('[data-avatar-menu] button').first().click();
  await page.locator('[data-avatar-menu] [role="menu"]').waitFor();
  assert.deepEqual(await menuNames(page), ['Switch to dark theme', 'Take the tour', 'Dashboard', 'Settings', 'Runs', 'Performance', 'Admin']);
  await page.getByRole('menuitem', { name: 'Runs' }).click();
  await page.waitForFunction(() => window.location.hash === '#/n01_u05/runs');
  assert.equal(await menuOpen(page), false, 'picking a section closes the menu');
  await page.locator('[data-avatar-menu] button').first().click();
  await page.locator('[data-avatar-menu] [role="menu"]').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('[data-avatar-menu] [role="menu"]').waitFor({ state: 'detached' });
  assert.equal(await menuOpen(page), false, 'Escape closes the menu');
  await page.locator('[data-switcher]').click();
  await page.locator('[data-case]').first().waitFor();
  assert.equal(await page.locator('[data-case]').count(), 6);
  await page.locator('[data-case]', { hasText: 'Second desk 3' }).click();
  await page.waitForFunction(() => document.querySelector('.ph h1')?.textContent === 'Second desk 3');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the three styles and the full-height Genie screen stay on a phone screen', async () => {
  for (const style of ['a', 'b', 'c']) {
    const { page, seen, context } = await openPage(appInfo({ style, layout: 'tabs' }, 6), 375);
    await page.waitForFunction(chartsDrawn, 4);
    let m = await snapshot(page);
    assert.equal(m.pageScroll, 0, `style ${style}`);
    assert.deepEqual(m.bleeding, [], `style ${style}`);
    await page.locator('[data-mode="genie"]').click();
    await page.locator('[data-genie-full]').waitFor();
    m = await page.evaluate(measureGenie, SCROLLERS);
    assert.equal(m.pageScroll, 0, `style ${style} with Genie open`);
    assert.deepEqual(m.bleeding, [], `style ${style} with Genie open`);
    assert.deepEqual(seen.errors, []);
    await context.close();
  }
});

test('a long use case title ends in an ellipsis in the switcher instead of widening the page', async () => {
  const title = 'N05-U01 Recommend Cross-Sell Item Bundles with Next-Best-Offer Playbook';
  for (const layout of ['sidebar', 'tabs', 'home']) {
    const { page, seen, context } = await openPage(appInfo({ layout, title, subtitle: `${title} · built by Inspire` }, 2, { title }), 1600, title);
    await page.waitForFunction(chartsDrawn, 4);
    for (const width of [1280, 768, 375]) {
      await resize(page, width);
      const at = `${layout} at ${width}px`;
      assert.equal((await snapshot(page)).pageScroll, 0, `${at} scrolls sideways`);
      const cut = await page.locator('[data-switcher] .switch-t b').first().evaluate((b) => ({
        ellipsis: getComputedStyle(b).textOverflow === 'ellipsis', clipped: b.scrollWidth > b.clientWidth, right: Math.round(b.getBoundingClientRect().right),
      }));
      assert.ok(cut.right <= width, `${at}: the title ends on screen ${JSON.stringify(cut)}`);
      if (width === 375) assert.ok(cut.clipped && cut.ellipsis, `${at}: the title is cut with an ellipsis ${JSON.stringify(cut)}`);
      assert.ok(await page.locator('[data-mode="genie"]').isVisible(), `${at}: the Genie switch stays on screen`);
      assert.ok(await page.locator('[data-mode="genie"]').evaluate((b) => b.getBoundingClientRect().right <= window.innerWidth), `${at}: the Genie switch is inside the screen`);
    }
    assert.deepEqual(seen.errors, []);
    await context.close();
  }
});

// PRODUCT GAP (REQ-506): the shell draws no App title or subtitle any more; the App title is only the document title (App.jsx:184).
test('the App title and subtitle are in the browser tab title even though the header shows the use case', async () => {
  const title = 'N05-U01 Recommend Cross-Sell Item Bundles with Next-Best-Offer Playbook';
  const { page, context } = await openPage(appInfo({ title, subtitle: `${title} · built by Inspire` }, 1), 375);
  assert.ok((await page.title()).endsWith(` · ${title}`), await page.title());
  assert.ok((await page.locator('.top').innerText()).includes(title), 'the header says which App this is (PRODUCT GAP: it shows the use case only)');
  await context.close();
});

test('on a phone the calendar icon stays beside the first line of the data date when the line wraps', async () => {
  const sponsor = 'Head of Merchandising and Category Planning for the Gulf region';
  const { page, seen, context } = await openApp(browser, served.base, appInfo({}, 1, { sponsor }), { width: 375, hash: FIRST });
  await page.waitForFunction(chartsDrawn, 4);
  assert.equal(await page.locator('.ph-meta').count(), 1, 'PRODUCT GAP: the header has no line with the sponsor and the data date any more');
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
