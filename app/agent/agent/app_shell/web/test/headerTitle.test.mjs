import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { appInfo, openApp, resizeTo, serveDist } from './harness.mjs';

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

const BRAND = 'Databricks Inspire Use Case Hub';
const TITLE = 'Passenger profiles that may belong to the same person';
const LONG = 'Passenger profiles that may belong to the same person across every loyalty progr';

const measure = () => {
  const box = (el) => el.getBoundingClientRect();
  const top = document.querySelector('.top');
  const mark = box(document.querySelector('.top > .mark'));
  const genie = box(document.querySelector('.genie-btn'));
  const sw = document.querySelector('[data-switcher]');
  const title = document.querySelector('[data-switcher] .switch-t b');
  const t = box(sw);
  const b = box(title);
  const style = getComputedStyle(title);
  return {
    brand: document.querySelector('.top > .mark .mark-t b').innerText,
    centreGap: Math.round((t.left + t.right) / 2 - (mark.right + genie.left) / 2),
    gapLeft: Math.round(t.left - mark.right),
    gapRight: Math.round(genie.left - t.right),
    titleLineHeight: Math.round(b.height),
    fontSize: parseFloat(style.fontSize),
    headerHeight: Math.round(box(top).height),
    truncated: title.scrollWidth > title.clientWidth,
    whiteSpace: style.whiteSpace,
    textOverflow: style.textOverflow,
    tooltip: sw.getAttribute('title'),
    genieOpen: document.querySelector('aside.genie')?.classList.contains('is-open') || false,
  };
};

for (const width of [1280, 1440]) {
  for (const open of [true, false]) {
    test(`at ${width}px with Ask Genie ${open ? 'open' : 'closed'}, the brand, the centred use case title and Ask Genie share one line`, async () => {
      const { page, context } = await openApp(browser, served.base, appInfo({ title: BRAND }, 1, { title: TITLE }), { width, height: 800, genie: open ? 'open' : 'closed' });
      try {
        await page.locator('[data-switcher] .switch-t b').waitFor({ timeout: 20000 });
        if (open) await page.locator('aside.genie.is-open').waitFor({ timeout: 20000 });
        else await page.locator('.genie-btn').waitFor({ timeout: 20000 });
        await resizeTo(page, width, 800);
        const m = await page.evaluate(measure);
        assert.equal(m.genieOpen, open, `the Genie panel is ${open ? 'open' : 'closed'} for this check`);
        assert.equal(m.brand, BRAND, 'the brand sits on the left');
        assert.ok(m.gapLeft >= 0 && m.gapRight >= 0, `the title does not overlap the brand (${m.gapLeft}px) or Ask Genie (${m.gapRight}px)`);
        assert.ok(Math.abs(m.centreGap) <= 2, `the title centre is ${m.centreGap}px off the centre between the brand and Ask Genie`);
        assert.ok(m.titleLineHeight <= m.fontSize * 1.6, `the title is ${m.titleLineHeight}px tall, one line needs at most ${Math.round(m.fontSize * 1.6)}px`);
        assert.ok(m.headerHeight <= 64, `the header is ${m.headerHeight}px tall, so something wrapped`);
      } finally {
        await context.close();
      }
    });
  }
}

test('the longest title the App accepts (80 characters) stays on one line, ends in an ellipsis and shows the full title on hover', async () => {
  assert.equal(LONG.length, 80, `the test title has ${LONG.length} characters, the App accepts at most 80`);
  const { page, context } = await openApp(browser, served.base, appInfo({ title: BRAND }, 1, { title: LONG }), { width: 1280, height: 800, genie: 'open' });
  try {
    await page.locator('[data-switcher] .switch-t b').waitFor({ timeout: 20000 });
    await page.locator('aside.genie.is-open').waitFor({ timeout: 20000 });
    await resizeTo(page, 1280, 800);
    const m = await page.evaluate(measure);
    assert.equal(m.whiteSpace, 'nowrap', 'the title is set to never wrap');
    assert.equal(m.textOverflow, 'ellipsis', 'the title ends in an ellipsis');
    assert.ok(m.truncated, 'the 120-character title is cut to fit the header');
    assert.ok(m.titleLineHeight <= m.fontSize * 1.6, `the long title is ${m.titleLineHeight}px tall, so it wrapped`);
    assert.equal(m.tooltip, LONG, 'hovering the title shows the full title');
    assert.ok(Math.abs(m.centreGap) <= 2, `the long title centre is ${m.centreGap}px off the centre`);
  } finally {
    await context.close();
  }
});
