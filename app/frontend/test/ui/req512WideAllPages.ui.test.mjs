// REQ-512 item 37 (Amr, 11-24 00:06: "you choose to have the wide design for the pages this must be true for all the pages of the app"):
// req512FullWidth covers the header and demo bar, req511FullWidth covers Monitor and Review. This spec walks every page of the real App at
// 1280 and 1920 px and checks, inside <main>:
//   (a) the page content spans the viewport less the px-6 gutters (some element at least viewport - 64 px wide), and
//   (b) no centred column caps the work: no element with a fixed max-width (px) below viewport - 64 that is at least 400 px wide and
//       holds 2 or more visible controls. Text measures (a capped paragraph, no controls), dialogs, menus, the reader and fixed
//       toasts are exempt, so a readable line length is still allowed.
// REQ-520 (owner decision "Caps everywhere", 2026-11-25) supersedes the 1920 half of REQ-512 item 37: working pages cap at a 1440 px
// FRAME, Home at 1280 px, and the Launch / Generate data / Setup forms at a 1040 px WIZARD column at every width, so this spec now runs
// at 1280 only and exempts the three WIZARD pages (Launch, Generate data; Setup is not walked here). req520_wideLayout.ui.test.mjs owns 1920 and 2560.
// Fail-pre (0289c7e85): GenerateDataPage.jsx:113 `max-w-2xl` caps the Generate data form at 672 px.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';
import { REVIEW_STATE } from './reviewFixtures.js';
import { mountReview } from './req512Support.mjs';

test.after(closeBrowser);

const KNOWN = { ...REVIEW_STATE, knownRuns: ['42', '41', '50', '51', '60', '61'] };
const PAGES = [
  ['Home', '#/home'], ['Start', '#/start'], ['Launch', '#/launch'], ['Generate data', '#/generate-data'], ['Monitor', '#/monitor/42'],
  ['Review: Use cases', '#/review/42'], ['Review: Business', '#/review/42', 'Business'], ['Review: Assets', '#/review/42', 'Assets'],
  ['Build', '#/build/42'], ['Run', '#/run'],
];

const frameFacts = (page) => page.evaluate(() => {
  const vw = document.documentElement.clientWidth;
  const main = document.querySelector('main');
  if (!main) return { vw, widest: 0, caps: ['no <main>'] };
  const CTRL = 'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="tab"]';
  const exempt = (el) => el.closest('[role="dialog"], [role="menu"], [role="listbox"], [role="tooltip"], [data-review-reader]')
    || (() => { for (let p = el; p && p !== main; p = p.parentElement) if (getComputedStyle(p).position === 'fixed') return true; return false; })();
  let widest = 0;
  const caps = [];
  for (const el of main.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (!r.width || !el.checkVisibility() || exempt(el)) continue;
    widest = Math.max(widest, r.width);
    const max = getComputedStyle(el).maxWidth;
    if (!max.endsWith('px') || parseFloat(max) >= vw - 64 || r.width < 400) continue;
    const n = [...el.querySelectorAll(CTRL)].filter((c) => c.checkVisibility() && c.getBoundingClientRect().width > 0).length;
    if (n >= 2) caps.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 70)} max-width ${max}, ${Math.round(r.width)}px, ${n} controls`);
  }
  return { vw, widest: Math.round(widest), caps };
});

const WIZARD_PAGES = new Set(['Launch', 'Generate data']);
for (const width of [1280]) {
  for (const [name, hash, tab] of PAGES.filter(([n]) => !WIZARD_PAGES.has(n))) {
    test(`W (${name} at ${width}px): the page spans the screen and no centred column caps its controls`, async () => {
      const ui = await openUi('app', KNOWN, hash, { mount: mountReview });
      const { page } = ui;
      try {
        await page.setViewportSize({ width, height: 900 });
        await page.waitForFunction(() => (document.querySelector('main')?.getBoundingClientRect().height || 0) > 200, null, { timeout: 20000 });
        if (tab) {
          await page.getByRole('navigation', { name: 'Results sections' }).getByRole('tab', { name: new RegExp(`^${tab}`) }).click();
          await page.waitForTimeout(300);
        }
        await page.waitForTimeout(1200);
        const f = await frameFacts(page);
        assert.ok(f.widest >= f.vw - 64, `${name}: the widest content is ${f.widest}px, needs at least ${f.vw - 64}px`);
        assert.deepEqual(f.caps, [], `${name}: a centred column caps the page`);
      } finally {
        await ui.close();
      }
    });
  }
}
