import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, goToStep, openUi, wizardInScreen } from './uiSupport.mjs';

test.after(closeBrowser);

const OWNER = ['owner', 'example.com'].join('@');
const ME = { me: { userName: OWNER, displayName: 'Owner' } };
const MARK = { method: '[data-measure-method]', direction: '[data-measure-direction]', currency: '[data-money-convert]', window: '[data-money-window]', off: '[data-money-off]' };
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

test('Measure shows one money decision per screen, Next decision moves on, and a finished screen keeps its place', async () => {
  const ui = await openUi('wizard', ME);
  const { page } = ui;
  try {
    await goToStep(page, 'Measure');
    const list = await parts(page);
    assert.deepEqual(list, ['method', 'direction', 'currency', 'window', 'off'], 'the Measure decisions read in this order');
    for (const [width, height] of [[1280, 800], [1440, 900]]) {
      await page.setViewportSize({ width, height });
      for (const [i, part] of list.entries()) {
        assert.equal(await current(page, part), true, `${part} is the current decision`);
        await assertOneDecision(page, part);
        await wizardInScreen(page, `Measure ${part} ${width}x${height}`, height);
        if (i < list.length - 1) {
          await page.locator('[data-money-next]').click();
          assert.equal(await current(page, list[i + 1]), true, `Next decision reaches ${list[i + 1]}`);
        }
      }
      await page.locator('[data-money-back]').click();
      await page.locator('[data-money-back]').click();
      await page.locator('[data-money-back]').click();
      await page.locator('[data-money-back]').click();
    }
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('when money is off, Measure holds only the off decision, and the other decisions are skipped', async () => {
  const ui = await openUi('wizard', ME);
  const { page } = ui;
  try {
    await goToStep(page, 'Measure');
    for (let i = 0; i < 4; i += 1) await page.locator('[data-money-next]').click();
    await assertOneDecision(page, 'off');
    await openMoreIfClosed(page);
    await page.locator('[data-money-off]').check({ force: true });
    await page.waitForFunction(() => document.querySelectorAll('[data-money-part]').length === 1, null, { timeout: 15000 });
    assert.deepEqual(await parts(page), ['off'], 'off leaves only the off decision (must-exclude the others)');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
