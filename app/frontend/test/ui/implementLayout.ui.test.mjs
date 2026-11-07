import test from 'node:test';
import assert from 'node:assert/strict';
import { STUDIO_STATE } from './implementFixtures.js';
import { closeBrowser, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

test('on a short wide screen the Build header and summary keep their full height, while only the use case list and pane scroll (must-exclude: nothing above them is cut)', async () => {
  const ui = await openUi('implement', STUDIO_STATE);
  const { page } = ui;
  try {
    for (const height of [560, 700, 900]) {
      await page.setViewportSize({ width: 1440, height });
      const summary = page.getByRole('region', { name: 'Build summary', exact: true });
      await summary.waitFor();
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
      const cut = await page.locator('[data-implement-page] > *').evaluateAll((items) => items.slice(0, -1)
        .map((el) => ({ name: el.getAttribute('aria-label') || el.tagName, scroll: el.scrollHeight, client: el.clientHeight }))
        .filter((box) => box.scroll > box.client + 1));
      assert.deepEqual(cut, [], `at 1440x${height} a part above the list is cut short`);
    }
  } finally {
    await ui.close();
  }
});
