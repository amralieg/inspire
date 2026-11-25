// REQ-512 (Amr: "this must be true for all the pages of the app"): every page frame is `w-full px-6` with no max-width cap.
// Covers the page-level frames outside the lanes that own their own pages: the app header and the demo bar.
// Fail-pre (ec32ac92b): Header.jsx:31 max-w-screen-xl and ShowcaseBar.jsx:8 max-w-screen-xl cap the frame at 1280px.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

const FRAMES = [
  ['Header', 'header', 'header > div', true],
  ['Demo bar', 'showcaseBar', 'section[aria-label="Demo"] > div', false],
];

for (const width of [1440, 1920]) {
  for (const [name, open, selector, capped] of FRAMES) {
    test(`${name} frame is ${capped ? 'the REQ-520 centred 1440px column' : 'full width with no max-width'} at ${width}px`, async () => {
      const ui = await openUi(open);
      const { page } = ui;
      try {
        await page.setViewportSize({ width, height: 900 });
        const frame = page.locator(selector).first();
        await frame.waitFor();
        const facts = await frame.evaluate((el) => ({ w: el.getBoundingClientRect().width, left: el.getBoundingClientRect().left, maxWidth: getComputedStyle(el).maxWidth }));
        if (capped) {
          // REQ-520 (Caps everywhere): the header uses the FRAME column, 1488px with its gutters = 1440px of content, centred.
          const want = Math.min(width, 1488);
          assert.equal(facts.maxWidth, '1488px', `${name}: FRAME cap`);
          assert.equal(Math.round(facts.w), want, `${name}: frame is ${facts.w}px, needs ${want}`);
          assert.ok(Math.abs(facts.left - (width - facts.w - facts.left)) <= 1, `${name}: frame is centred`);
        } else {
          assert.equal(facts.maxWidth, 'none', `${name}: no max-width cap`);
          assert.ok(facts.w >= width - 48, `${name}: frame is ${facts.w}px, needs at least ${width - 48}`);
        }
        assert.deepEqual(ui.pageErrors, []);
      } finally {
        await ui.close();
      }
    });
  }
}
