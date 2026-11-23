// REQ-496b / REQ-497 (FX-95b): the Save step fits a 1280x800 window with no scroll, and a value's status reads "Provisional estimate" (saved without the accept tick)
// or "Reviewed calculation" (saved with "Accept and save"), never "(estimated)" / "(calculated)".
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser } from './uiSupport.mjs';
import { fakeYearly, goTo, mountWizard, openCard, openWizard } from './valueWizardSupport.mjs';

test.after(closeBrowser);

const norm = (s) => s.replace(/\s+/g, ' ').trim();
const OLD = /\((estimated|calculated)\)/;
// The shared mock answers every PUT as calculated; this one answers as the server does: calculated only when the body says so.
const mountSaving = (opts = {}) => (app) => {
  app.put('/api/inspire/value/answers', (req, res) => {
    opts.puts?.push(req.body);
    const { answers } = req.body;
    res.json({ version: 3, yearly: fakeYearly({ plan: answers.plan, answers }, { calculated: Boolean(answers.calculated) }), disclaimer: 'x' });
  });
  mountWizard(opts)(app);
};

test('N1: the Save step has no vertical scroll in the dialog body at 1280x800, with the tick and the Save button in view', async () => {
  const { ui, card, page } = await openCard(mountWizard({}));
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    const dialog = await openWizard(page, card);
    await goTo(dialog, 'save');
    await dialog.locator('[data-preview-state="ready"]').waitFor({ timeout: 15000 });
    const fit = await page.evaluate(() => {
      const dlg = document.querySelector('[role=dialog]');
      const body = dlg.querySelector('[data-wizard-page]').parentElement;
      const scroller = [dlg, ...dlg.querySelectorAll('*')].find((n) => n.scrollHeight > n.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(n).overflowY));
      const inView = (sel) => { const r = dlg.querySelector(sel)?.getBoundingClientRect(); return Boolean(r && r.top >= 0 && r.bottom <= window.innerHeight); };
      return { inner: Boolean(scroller), bodyOver: body.scrollHeight > body.clientHeight + 1, bottom: dlg.getBoundingClientRect().bottom <= 800, terms: inView('[data-accept-terms]'), save: inView('[data-save-button]') };
    });
    assert.deepEqual(fit, { inner: false, bodyOver: false, bottom: true, terms: true, save: true });
  } finally { await ui.close(); }
});

test('N2: a value saved with Calculate now reads Provisional estimate, on the Save step and on the card, and never (estimated)', async () => {
  const { ui, card, page } = await openCard(mountSaving());
  try {
    const dialog = await openWizard(page, card);
    await dialog.locator('[data-wizard-page="kinds"]').waitFor({ timeout: 15000 });
    await dialog.getByRole('button', { name: 'Calculate now', exact: true }).click();
    await dialog.locator('[data-wizard-page="save"]').waitFor({ timeout: 15000 });
    await dialog.locator('[data-save-total]').filter({ hasText: /\$/ }).waitFor({ timeout: 15000 });
    const total = norm(await dialog.locator('[data-save-total]').innerText());
    assert.match(total, /Provisional estimate/);
    const summary = norm(await dialog.locator('[data-accept-summary]').innerText());
    assert.match(summary, /Provisional estimate/);
    assert.doesNotMatch(total + summary, OLD);
    await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
    await dialog.waitFor({ state: 'hidden', timeout: 5000 });
    const q = card.locator('[data-value-qualifier]');
    await q.waitFor({ timeout: 15000 });
    assert.match(norm(await q.innerText()), /Provisional estimate/);
    assert.doesNotMatch(norm(await card.innerText()), OLD);
  } finally { await ui.close(); }
});

test('N3: a value saved with Accept and save reads Reviewed calculation on the card and never (calculated)', async () => {
  const puts = [];
  const { ui, card, page } = await openCard(mountSaving({ puts }));
  try {
    const dialog = await openWizard(page, card);
    await goTo(dialog, 'save');
    await dialog.locator('[data-preview-state="ready"]').waitFor({ timeout: 15000 });
    await dialog.getByRole('checkbox', { name: 'I have read and accept these terms' }).check();
    await dialog.locator('[data-save-button]').click();
    await dialog.waitFor({ state: 'hidden', timeout: 5000 });
    assert.equal(puts[0].answers.calculated, true);
    const q = card.locator('[data-value-qualifier]');
    await q.waitFor({ timeout: 15000 });
    assert.match(norm(await q.innerText()), /Reviewed calculation/);
    assert.doesNotMatch(norm(await card.innerText()), OLD);
    await card.getByRole('button', { name: 'Edit value' }).click();
    const again = page.getByRole('dialog', { name: /^Calculating Value at Stake for / });
    await goTo(again, 'save');
    await again.locator('[data-save-total]').filter({ hasText: /\$/ }).waitFor({ timeout: 15000 });
    const total = norm(await again.locator('[data-save-total]').innerText());
    assert.match(total, /Reviewed calculation/);
    assert.doesNotMatch(total, OLD);
  } finally { await ui.close(); }
});
