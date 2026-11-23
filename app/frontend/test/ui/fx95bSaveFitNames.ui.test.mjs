// REQ-496b / REQ-497 (FX-95b), REQ-507: the approval and Save steps fit a 1280x800 window with no scroll, and a value's status reads "Provisional estimate" (saved from a plan the
// model review did not approve) or "Reviewed calculation" (saved with "Approve story and save"), never "(estimated)" / "(calculated)".
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser } from './uiSupport.mjs';
import { fakeYearly, goTo, mountWizard, openCard, openWizard, saveFrom, PLAN } from './valueWizardSupport.mjs';

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

test('N1: the approval step and the Save step have no vertical scroll in the dialog body at 1280x800, with the tick, Approve story and save, and Close in view', async () => {
  const { ui, card, page } = await openCard(mountWizard({}));
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    const dialog = await openWizard(page, card);
    const measure = () => page.evaluate(() => {
      const dlg = document.querySelector('[role=dialog]');
      const body = dlg.querySelector('[data-wizard-page]').parentElement;
      const scroller = [dlg, ...dlg.querySelectorAll('*')].find((n) => n.scrollHeight > n.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(n).overflowY));
      const inView = (el) => { const r = el?.getBoundingClientRect(); return Boolean(r && r.top >= 0 && r.bottom <= window.innerHeight); };
      const button = (name) => [...dlg.querySelectorAll('button')].find((b) => b.textContent.trim() === name);
      const tick = [...dlg.querySelectorAll('input[type=checkbox]')].find((c) => /accept these terms/.test(c.closest('label')?.textContent || ''));
      return { inner: Boolean(scroller), bodyOver: body.scrollHeight > body.clientHeight + 1, bottom: dlg.getBoundingClientRect().bottom <= 800, terms: inView(tick),
        approve: inView(button('Approve story and save')), close: inView(button('Close')) };
    });
    await goTo(dialog, 'story:approve');
    await dialog.locator('[data-preview-state="ready"]').waitFor({ timeout: 15000 });
    assert.deepEqual(await measure(), { inner: false, bodyOver: false, bottom: true, terms: true, approve: true, close: false }, 'story:approve');
    await saveFrom(dialog);
    await dialog.locator('[data-preview-state="ready"]').waitFor({ timeout: 15000 });
    const saved = await measure();
    assert.equal(saved.inner, false, 'no inner scroller on the Save step');
    assert.equal(saved.bodyOver, false, 'the Save step body does not overflow');
    assert.equal(saved.bottom, true);
    assert.equal(saved.close, true, 'Close in view on the Save step');
    assert.equal(saved.terms, true, 'the terms stay in view on the Save step');
  } finally { await ui.close(); }
});

test('N2: a value saved from a plan the model review did not approve reads Provisional estimate, on the Save step and on the card, and never (estimated)', async () => {
  const unapproved = { ...PLAN, review: { approved: false, model: 'm1', reason: 'too high' } };
  const { ui, card, page } = await openCard(mountSaving({ planReply: { plan: unapproved } }));
  try {
    const dialog = await openWizard(page, card);
    await goTo(dialog, 'story:approve');
    await saveFrom(dialog);
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

test('N3: a value saved with Approve story and save reads Reviewed calculation on the card and never (calculated)', async () => {
  const puts = [];
  const { ui, card, page } = await openCard(mountSaving({ puts }));
  try {
    const dialog = await openWizard(page, card);
    await goTo(dialog, 'story:approve');
    await dialog.locator('[data-preview-state="ready"]').waitFor({ timeout: 15000 });
    await saveFrom(dialog);
    assert.equal(puts[0].answers.calculated, true);
    await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
    await dialog.waitFor({ state: 'hidden', timeout: 5000 });
    const q = card.locator('[data-value-qualifier]');
    await q.waitFor({ timeout: 15000 });
    assert.match(norm(await q.innerText()), /Reviewed calculation/);
    assert.doesNotMatch(norm(await card.innerText()), OLD);
    await card.getByRole('button', { name: 'Edit value' }).click();
    const again = page.getByRole('dialog', { name: /^Calculating Value at Stake for / });
    await goTo(again, 'story:approve');
    await saveFrom(again);
    await again.locator('[data-save-total]').filter({ hasText: /\$/ }).waitFor({ timeout: 15000 });
    const total = norm(await again.locator('[data-save-total]').innerText());
    assert.match(total, /Reviewed calculation/);
    assert.doesNotMatch(total, OLD);
    assert.equal(puts.length, 2);
    assert.equal(puts[1].answers.calculated, true);
  } finally { await ui.close(); }
});
