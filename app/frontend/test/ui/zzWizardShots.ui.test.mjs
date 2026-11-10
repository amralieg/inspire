import test from 'node:test';
import { closeBrowser, openUi, onStep } from './uiSupport.mjs';

test.after(closeBrowser);

const OWNER = ['owner', 'example.com'].join('@');
const ME = { me: { userName: OWNER, displayName: 'Owner' } };
const OUT = '/tmp/cc_inspire/live/wizard';

test('screenshot every wizard step', async () => {
  for (const [w, h] of [[1280, 800], [1440, 900]]) {
    const ui = await openUi('wizard', ME);
    const { page } = ui;
    try {
      await page.setViewportSize({ width: w, height: h });
      await onStep(page, 'Data');
      await page.waitForTimeout(800);
      const labels = (await page.locator('[data-wizard-header] ol li').allTextContents()).map((l) => l.trim());
      for (let i = 0; i < labels.length; i += 1) {
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${OUT}/${w}x${h}-${String(i + 1).padStart(2, '0')}-${labels[i].replace(/^\d+\.\s*/, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png` });
        if (i < labels.length - 1) {
          const next = page.getByRole('button', { name: 'Next' });
          if (await next.count()) await next.click();
          await page.waitForTimeout(400);
        }
      }
      await page.locator('[data-use-case-details-open]').click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/${w}x${h}-drawer-use-case-details.png` });
      await page.keyboard.press('Escape');
    } finally {
      await ui.close();
    }
  }
});
