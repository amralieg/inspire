import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, goToStep, openUi, stubMoney, wizardInScreen } from './uiSupport.mjs';

// The default rule previews its example rows on open; answer the preview so the page has no failed request.
const stubPreview = (page) => stubMoney('value-preview', () => ({ rows: [{ stake: 1, currency: 'USD' }] }), [])(page);

test.after(closeBrowser);

const OWNER = ['owner', 'example.com'].join('@');
const ME = { me: { userName: OWNER, displayName: 'Owner' } };
const MARK = { currency: '[data-money-convert]', window: '[data-money-window]', off: '[data-money-off]', kpi: '[data-choice="kpi"]', holdout: '[data-choice="holdout"]' };
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
  const ui = await openUi('wizard', ME, '', { init: stubPreview });
  const { page } = ui;
  try {
    await goToStep(page, 'Measure');
    const list = ['currency', 'window', 'off', 'kpi', 'holdout']; // REQ-473: no method, movement or sign question
    for (const [width, height] of [[1280, 800], [1440, 900]]) {
      await page.setViewportSize({ width, height });
      for (const [i, part] of list.entries()) {
        assert.deepEqual(await parts(page), list.slice(0, i + 1), `only the decisions Next has reached are on screen at ${part}, later ones are not rendered (must-exclude)`);
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
  const ui = await openUi('wizard', ME, '', { init: stubPreview });
  const { page } = ui;
  try {
    await goToStep(page, 'Measure');
    await page.locator('[data-money-next]').click();
    await page.locator('[data-money-window]').fill('3');
    await page.locator('[data-money-next]').click();
    await page.locator('[data-money-next]').click();
    await page.locator('[data-money-back]').click();
    await page.locator('[data-money-back]').click();
    assert.equal(await page.locator('[data-money-window]').inputValue(), '3', 'the periods typed are still there');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Periods and statuses shows its two text boxes on screen with no collapsed wrapper, and takes a typed value (REQ-004)', async () => {
  const ui = await openUi('wizard', ME);
  const { page } = ui;
  try {
    await goToStep(page, 'Measure');
    await page.locator('[data-money-next]').first().waitFor();
    await page.locator('[data-money-next]').click();
    assert.equal(await current(page, 'window'), true, 'Periods and statuses is the current decision');
    const closed = page.locator('[data-money-window]');
    await closed.waitFor();
    assert.equal(await visible(page, '[data-money-window]'), true, 'the Closed periods box is on screen without a More options wrapper (REQ-004)');
    assert.equal(await visible(page, '[data-money-statuses]'), true, 'the Statuses box is on screen without a More options wrapper (REQ-004)');
    assert.equal(await page.locator('[data-money-more]').count(), 0, 'no collapsed More options wrapper hides the boxes (REQ-004, must-exclude)');
    await closed.fill('2');
    assert.equal(await closed.inputValue(), '2', 'the Closed periods box takes a typed value');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
