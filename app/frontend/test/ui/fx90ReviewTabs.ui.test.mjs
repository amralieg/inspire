import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';
import { REVIEW_SESSIONS, REVIEW_STATE } from './reviewFixtures.js';

// REQ-490: Use cases and Overview are tabs across the top of the Review page at every width, not a left side panel.
test.after(closeBrowser);

const STATE = { ...REVIEW_STATE, sessions: REVIEW_SESSIONS };
const tablist = (page) => page.getByRole('tablist');
const tab = (page, name) => tablist(page).getByRole('tab', { name: new RegExp(`^${name}\\b`) });
const cards = (page) => page.getByRole('region', { name: 'Use case list' }).locator('[data-use-case-row]');

for (const [width, height] of [[1440, 900], [1280, 800]]) {
  test(`REQ-490: at ${width}x${height} the Review page has Use cases and Overview as tabs above the content`, async () => {
    const ui = await openUi('results', STATE, '', { init: (page) => page.setViewportSize({ width, height }) });
    const { page } = ui;
    try {
      await cards(page).first().waitFor();
      assert.equal(await tablist(page).count(), 1, 'one tablist');
      assert.deepEqual((await tablist(page).getByRole('tab').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim().replace(/ \d+$/, '')), ['Use cases', 'Overview']);
      assert.equal(await tab(page, 'Use cases').getAttribute('aria-selected'), 'true');
      assert.equal(await tab(page, 'Overview').getAttribute('aria-selected'), 'false');
      const boxes = await Promise.all(['Use cases', 'Overview'].map((n) => tab(page, n).boundingBox()));
      assert.ok(boxes.every((b) => Math.abs(b.y - boxes[0].y) < 2), `one row: ${JSON.stringify(boxes)}`);
      const cardTop = (await cards(page).first().boundingBox()).y;
      assert.ok(boxes.every((b) => b.y + b.height <= cardTop), 'tabs sit above the cards');
      // No left side nav item: nothing named Use cases / Overview is a button in a side panel.
      for (const n of ['Use cases', 'Overview']) {
        assert.equal(await page.getByRole('button', { name: new RegExp(`^${n}\\b`) }).count(), 0, `${n} is not a side-panel button`);
      }
      // Domains tree still reachable in Use cases.
      await page.getByRole('button', { name: /^Domains\b/ }).waitFor();
      // Keyboard arrows move between tabs.
      await tab(page, 'Use cases').focus();
      await page.keyboard.press('ArrowRight');
      assert.equal(await tab(page, 'Overview').getAttribute('aria-selected'), 'true');
      // Overview takes the full page width.
      await page.locator('[data-executive-summary]').waitFor();
      const w = (await page.locator('[data-executive-summary]').boundingBox()).width;
      assert.ok(w >= width * 0.6, `Overview is full width (${w} of ${width})`);
      assert.equal(await page.getByRole('button', { name: /^Domains\b/ }).count(), 0, 'Domains only under Use cases');
      assert.deepEqual(ui.pageErrors, []);
    } finally {
      await ui.close();
    }
  });
}
