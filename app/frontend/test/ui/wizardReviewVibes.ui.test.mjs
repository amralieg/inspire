import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, goToStep, openSettings, openUi } from './uiSupport.mjs';
import { STUDIO_STATE } from './implementFixtures.js';

test.after(closeBrowser);

const viewports = [{ width: 1280, height: 800 }, { width: 1024, height: 700 }];

test('Review & build shows the vibes box in full on the first screen, and the chosen options scroll in their own list at 1280x800 and 1024x700', async () => {
  const ui = await openUi('implement', STUDIO_STATE);
  const { page } = ui;
  try {
    await page.locator('[data-asset-tiles]').waitFor({ timeout: 20000 });
    const wizard = await openSettings(page);
    await goToStep(page, 'Review & build');
    for (const v of viewports) {
      await page.setViewportSize(v);
      await page.waitForTimeout(150);
      const vibes = await wizard.locator('[data-vibes="mvp"] textarea').boundingBox();
      assert.ok(vibes, 'the vibes box is on the Review & build step');
      assert.ok(vibes.y >= 0 && vibes.y + vibes.height <= v.height, `at ${v.width}x${v.height} the vibes box must sit fully on the first screen (y=${vibes.y}, h=${vibes.height}) without scrolling the page`);
      const list = await wizard.locator('[data-picked-summary]').evaluate((el) => ({ overflow: getComputedStyle(el).overflowY, scroll: el.scrollHeight, client: el.clientHeight }));
      assert.equal(list.overflow, 'auto', `at ${v.width}x${v.height} the chosen options are a scrollable list`);
      assert.ok(list.scroll > list.client, `at ${v.width}x${v.height} the list is taller than its box so the options scroll`);
    }
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
