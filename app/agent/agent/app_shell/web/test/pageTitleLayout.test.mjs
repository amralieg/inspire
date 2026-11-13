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

// The page title sits in the page header beside its tools. The title must keep a readable width and
// the tools must wrap under it, never squeeze the title into a sliver of one letter per line.
const measure = () => {
  const box = (el) => el.getBoundingClientRect();
  const h1 = document.querySelector('.pg-h h1');
  const tools = document.querySelector('.pg-h > .ph-tools');
  const b = box(h1);
  const t = box(tools);
  return {
    titleWidth: Math.round(b.width),
    titleLines: Math.round(b.height / parseFloat(getComputedStyle(h1).lineHeight)),
    toolsBelowTitle: t.top >= b.bottom - 1,
    toolsBesideTitle: t.left >= b.right - 1,
    genieOpen: document.querySelector('aside.genie')?.classList.contains('is-open') || false,
  };
};

for (const width of [1280, 1440, 1920]) {
  for (const open of [true, false]) {
    test(`at ${width}px with Ask Genie ${open ? 'open' : 'closed'}, the page title keeps a readable width and at most two lines`, async () => {
      const { page, context } = await openApp(browser, served.base, appInfo({ title: BRAND }, 1, { title: TITLE }), { width, height: 800, genie: open ? 'open' : 'closed' });
      try {
        await page.locator('.pg-h h1').waitFor({ timeout: 20000 });
        if (open) await page.locator('aside.genie.is-open').waitFor({ timeout: 20000 });
        await resizeTo(page, width, 800);
        const m = await page.evaluate(measure);
        assert.equal(m.genieOpen, open, `the Genie panel is ${open ? 'open' : 'closed'} for this check`);
        assert.ok(m.titleWidth >= 260, `the title is ${m.titleWidth}px wide, it is squeezed into a narrow column`);
        assert.ok(m.titleLines <= 2, `the title wraps to ${m.titleLines} lines, one letter per line is the failure`);
        assert.ok(m.toolsBelowTitle || m.toolsBesideTitle, 'the page tools do not overlap the title');
      } finally {
        await context.close();
      }
    });
  }
}

test('the longest title the App accepts (80 characters) keeps a readable width at 1440px with Ask Genie open', async () => {
  assert.equal(LONG.length, 80, `the test title has ${LONG.length} characters, the App accepts at most 80`);
  const { page, context } = await openApp(browser, served.base, appInfo({ title: BRAND }, 1, { title: LONG }), { width: 1440, height: 800, genie: 'open' });
  try {
    await page.locator('.pg-h h1').waitFor({ timeout: 20000 });
    await page.locator('aside.genie.is-open').waitFor({ timeout: 20000 });
    await resizeTo(page, 1440, 800);
    const m = await page.evaluate(measure);
    assert.ok(m.titleWidth >= 260, `the title is ${m.titleWidth}px wide`);
    assert.ok(m.titleLines <= 3, `the 80-character title wraps to ${m.titleLines} lines`);
  } finally {
    await context.close();
  }
});
