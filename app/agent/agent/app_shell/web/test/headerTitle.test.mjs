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

// REQ-506: the top bar is the use case switcher on the left, then the Screen | Genie switch, the value chip and the avatar menu.
// There is no brand mark and no centred title any more; the title keeps its one line, its ellipsis and its hover.
const measure = () => {
  const box = (el) => el.getBoundingClientRect();
  const top = document.querySelector('.top');
  const genie = box(document.querySelector('[data-mode-switch]'));
  const sw = document.querySelector('[data-switcher]');
  const title = document.querySelector('[data-switcher] .switch-t b');
  const t = box(sw);
  const b = box(title);
  const style = getComputedStyle(title);
  return {
    gapLeft: Math.round(t.left - box(top).left),
    gapRight: Math.round(genie.left - t.right),
    titleLineHeight: Math.round(b.height),
    fontSize: parseFloat(style.fontSize),
    headerHeight: Math.round(box(top).height),
    truncated: title.scrollWidth > title.clientWidth,
    whiteSpace: style.whiteSpace,
    textOverflow: style.textOverflow,
    tooltip: sw.getAttribute('title'),
    genieOpen: !!document.querySelector('[data-genie-full]'),
    titleText: title.innerText,
  };
};

for (const width of [1280, 1440]) {
  for (const open of [true, false]) {
    test(`at ${width}px in ${open ? 'Genie' : 'Screen'} mode, the use case title and the Screen | Genie switch share one line`, async () => {
      const { page, context } = await openApp(browser, served.base, appInfo({ title: BRAND }, 1, { title: TITLE }), { width, height: 800, genie: open ? 'open' : 'closed' });
      try {
        await page.locator('[data-switcher] .switch-t b').waitFor({ timeout: 20000 });
        if (open) { await page.locator('[data-mode="genie"]').click(); await page.locator('[data-genie-full]').waitFor({ timeout: 20000 }); }
        else await page.locator('[data-mode-switch]').waitFor({ timeout: 20000 });
        await resizeTo(page, width, 800);
        const m = await page.evaluate(measure);
        assert.equal(m.genieOpen, open, `the Genie panel is ${open ? 'open' : 'closed'} for this check`);
        assert.ok(m.gapLeft >= 0 && m.gapRight >= 0, `the title stays inside the bar (${m.gapLeft}px) and does not overlap the Genie switch (${m.gapRight}px)`);
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
    await page.locator('[data-mode="genie"]').click();
    await page.locator('[data-genie-full]').waitFor({ timeout: 20000 });
    await resizeTo(page, 1280, 800);
    const m = await page.evaluate(measure);
    assert.equal(m.whiteSpace, 'nowrap', 'the title is set to never wrap');
    assert.equal(m.textOverflow, 'ellipsis', 'the title ends in an ellipsis');
    assert.ok(m.truncated, 'the 120-character title is cut to fit the header');
    assert.ok(m.titleLineHeight <= m.fontSize * 1.6, `the long title is ${m.titleLineHeight}px tall, so it wrapped`);
    assert.equal(m.tooltip, LONG, 'hovering the title shows the full title');
    assert.ok(m.gapLeft >= 0 && m.gapRight >= 0, `the long title overlaps its neighbours (${m.gapLeft}px, ${m.gapRight}px)`);
  } finally {
    await context.close();
  }
});
