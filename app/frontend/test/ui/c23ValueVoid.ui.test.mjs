// C23: the Calculate value dialog body sizes to its content (no fixed height, so no big void), and each REQ-544 item renders:
// filter and data count, kinds, one page per kind with a big kind title at the top, value story, terms and conditions and accept.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser } from './uiSupport.mjs';
import { goTo, next, openCard, openWizard } from './valueWizardSupport.mjs';
import { mountReq507 } from './req507Support.mjs';

test.after(closeBrowser);

const REM = 16;
const body = (dialog) => dialog.locator('[data-wizard-body]');
// Pixels between the last content of the page and the bottom of the body (0 when the body scrolls).
const voidBelow = (dialog) => body(dialog).evaluate((el) => {
  if (el.scrollHeight > el.clientHeight + 1) return 0;
  const panel = el.querySelector('.tab-panel-enter');
  const last = panel.lastElementChild || panel;
  return Math.round(el.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom);
});

test('C23 (a): the wizard body has no fixed height and a max height', async () => {
  const { ui, card, page } = await openCard(mountReq507({}));
  try {
    const dialog = await openWizard(page, card);
    await dialog.locator('[data-wizard-page]').first().waitFor({ timeout: 15000 });
    const cls = await body(dialog).getAttribute('class');
    assert.doesNotMatch(cls, /(^|\s)h-\[/, `fixed height in: ${cls}`);
    assert.match(cls, /(^|\s)max-h-\[/, `no max height in: ${cls}`);
    const minPx = parseFloat(await body(dialog).evaluate((el) => getComputedStyle(el).minHeight));
    assert.ok(minPx <= 16 * REM, `min height ${minPx}px is at most 16rem`);
    // Footer stays in view and below the body on every page.
    for (const p of ['data', 'kinds', 'driver:risk_avoided', 'story', 'terms']) {
      await goTo(dialog, p);
      const b = await body(dialog).boundingBox();
      const nextBtn = dialog.getByRole('button', { name: p === 'terms' ? 'Back' : 'Next', exact: true });
      const n = await nextBtn.boundingBox();
      const vh = page.viewportSize().height;
      assert.ok(n.y >= b.y + b.height - 1, `footer button below the body at ${p}`);
      assert.ok(n.y + n.height <= vh, `footer in view at ${p}`);
    }
  } finally { await ui.close(); }
});

test('C23: short pages leave no empty band taller than 4rem above the footer', async () => {
  const { ui, card, page } = await openCard(mountReq507({}));
  try {
    const dialog = await openWizard(page, card);
    for (const p of ['data', 'kinds', 'driver:risk_avoided', 'terms']) {
      await goTo(dialog, p);
      const gap = await voidBelow(dialog);
      assert.ok(gap <= 4 * REM, `void of ${gap}px at ${p}`);
    }
  } finally { await ui.close(); }
});

test('C23 REQ-544: filter and data count, kinds, one page per kind with a big title at the top, value story, terms and accept', async () => {
  const { ui, card, page } = await openCard(mountReq507({}));
  try {
    const dialog = await openWizard(page, card);
    await dialog.locator('[data-wizard-page="data"]').waitFor({ timeout: 15000 });
    const stepSize = parseFloat(await dialog.getByRole('list', { name: 'Steps' }).locator('li').first().evaluate((el) => getComputedStyle(el).fontSize));
    // 1 filter and data count
    assert.match(await dialog.locator('[data-scope-facts]').innerText(), /3,412,880/);
    await dialog.locator('[data-scope-choice="filter"]').click();
    await dialog.locator('[data-wizard-page="filter"]').waitFor({ timeout: 5000 });
    await dialog.getByLabel('Describe the rows to keep').fill('Exclude cancelled and test records');
    await dialog.getByRole('button', { name: 'Check filter' }).click();
    await dialog.locator('[data-scope-count]').waitFor({ timeout: 5000 });
    assert.match(await dialog.locator('[data-scope-count]').innerText(), /1,198,406/);
    // 2 kinds
    await next(dialog);
    await dialog.locator('[data-wizard-page="kinds"]').waitFor({ timeout: 15000 });
    assert.ok(await dialog.getByRole('checkbox', { name: /^Include / }).count() >= 3);
    await next(dialog);
    // 3 one page per kind, the kind title is a heading and the first thing on the page
    for (const label of ['Losses avoided', 'Analyst time saved', 'Customers kept']) {
      const title = dialog.getByRole('heading', { name: label, exact: true });
      await title.waitFor({ timeout: 15000 });
      const first = await body(dialog).locator('.tab-panel-enter').evaluate((panel) => panel.firstElementChild.querySelector('[data-kind-title]') !== null);
      assert.equal(first, true, `kind title first on the ${label} page`);
      assert.ok(parseFloat(await title.evaluate((el) => getComputedStyle(el).fontSize)) >= stepSize * 1.5, `${label} title bigger than the step label`);
      assert.ok(await title.isVisible());
      await next(dialog);
    }
    // 4 value story
    await dialog.locator('[data-story-headline]').waitFor({ timeout: 15000 });
    await next(dialog);
    // 5 terms and conditions and accept
    await dialog.locator('[data-wizard-page="terms"]').waitFor({ timeout: 15000 });
    assert.ok(await dialog.getByText('Terms and conditions').first().isVisible());
    assert.ok(await dialog.locator('[data-value-disclaimer]').isVisible());
    assert.ok(await dialog.locator('[data-value-accept]').isVisible());
    assert.ok(await dialog.getByRole('button', { name: 'Accept and save' }).isVisible());
  } finally { await ui.close(); }
});
