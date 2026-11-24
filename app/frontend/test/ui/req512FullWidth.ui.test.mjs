// REQ-512 (Amr: "this must be true for all the pages of the app"): every page frame is `w-full px-6` with no max-width cap.
// Covers the page-level frames outside the lanes that own their own pages: the app header and the demo bar.
// Fail-pre (ec32ac92b): Header.jsx:31 max-w-screen-xl and ShowcaseBar.jsx:8 max-w-screen-xl cap the frame at 1280px.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

const FRAMES = [
  ['Header', 'header', 'header > div'],
  ['Demo bar', 'showcaseBar', 'section[aria-label="Demo"] > div'],
];

for (const width of [1440, 1920]) {
  for (const [name, open, selector] of FRAMES) {
    test(`${name} frame is full width with no max-width at ${width}px`, async () => {
      const ui = await openUi(open);
      const { page } = ui;
      try {
        await page.setViewportSize({ width, height: 900 });
        const frame = page.locator(selector).first();
        await frame.waitFor();
        const facts = await frame.evaluate((el) => ({ w: el.getBoundingClientRect().width, maxWidth: getComputedStyle(el).maxWidth }));
        assert.equal(facts.maxWidth, 'none', `${name}: no max-width cap`);
        assert.ok(facts.w >= width - 48, `${name}: frame is ${facts.w}px, needs at least ${width - 48}`);
        assert.deepEqual(ui.pageErrors, []);
      } finally {
        await ui.close();
      }
    });
  }
}
