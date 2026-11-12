import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, goToStep, openUi, wizardInScreen } from './uiSupport.mjs';

test.after(closeBrowser);

const OWNER = ['owner', 'example.com'].join('@');
const ME = { me: { userName: OWNER, displayName: 'Owner' } };
const MARK = { method: '[data-measure-method]', direction: '[data-measure-direction]', currency: '[data-money-convert]', window: '[data-money-window]', off: '[data-money-off]', impact: '[aria-label="Measure impact"]' };
const parts = (page) => page.locator('[data-money-part]').evaluateAll((els) => els.map((e) => e.dataset.moneyPart));
const current = (page, part) => page.locator(`[data-money-part="${part}"]`).evaluate((el) => el.closest('li').hasAttribute('data-money-current'));
const visible = (page, sel) => page.locator(sel).evaluateAll((els) => els.some((e) => e.getClientRects().length > 0));

async function openMoreIfClosed(page) {
  const more = page.locator('[data-money-more]');
  if (await more.count() && !(await more.evaluate((d) => d.open))) await more.locator('summary').click();
}

async function assertOneDecision(page, part) {
  if (part === 'window' || part === 'off') await openMoreIfClosed(page);
  assert.equal(await visible(page, MARK[part]), true, `${part}: its decision is on screen`);
  for (const other of Object.keys(MARK).filter((p) => p !== part)) {
    assert.equal(await visible(page, MARK[other]), false, `${part}: ${other} is not on the same screen (must-exclude)`);
  }
}

test('Measure shows one decision per screen, Measure impact last, Following decision moves on, and a finished screen keeps its place', async () => {
  const ui = await openUi('wizard', ME);
  const { page } = ui;
  try {
    await goToStep(page, 'Measure');
    const list = await parts(page);
    assert.deepEqual(list, ['method', 'direction', 'currency', 'window', 'off', 'impact'], 'the Measure decisions read in this order');
    for (const [width, height] of [[1280, 800], [1440, 900]]) {
      await page.setViewportSize({ width, height });
      for (const [i, part] of list.entries()) {
        assert.equal(await current(page, part), true, `${part} is the current decision`);
        await assertOneDecision(page, part);
        await wizardInScreen(page, `Measure ${part} ${width}x${height}`, height);
        if (i < list.length - 1) {
          await page.locator('[data-money-next]').click();
          assert.equal(await current(page, list[i + 1]), true, `Following decision reaches ${list[i + 1]}`);
        }
      }
      for (let back = 1; back < list.length; back += 1) await page.locator('[data-money-back]').click();
    }
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a value typed on its decision survives moving to other decisions and back', async () => {
  const ui = await openUi('wizard', ME);
  const { page } = ui;
  try {
    await goToStep(page, 'Measure');
    await page.locator('[data-money-method="fixed"]').check({ force: true });
    await page.locator('[data-money-fixed-amount]').fill('10');
    await page.locator('[data-money-next]').click();
    await page.locator('[data-money-next]').click();
    await page.locator('[data-money-back]').click();
    await page.locator('[data-money-back]').click();
    assert.equal(await page.locator('[data-money-method="fixed"]').isChecked(), true, 'the fixed method is still chosen');
    assert.equal(await page.locator('[data-money-fixed-amount]').inputValue(), '10', 'the amount typed is still there');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
