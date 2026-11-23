// REQ-496 (FX-95): the last step of the value dialog shows every number and the full disclaimer, and Save needs the accept tick first.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser } from './uiSupport.mjs';
import { goTo, mountWizard, openCard, openWizard } from './valueWizardSupport.mjs';
import disclaimer from '../../../backend/lib/valueDisclaimer.json' with { type: 'json' };

test.after(closeBrowser);

const saveBtn = (dialog) => dialog.locator('[data-save-button]');
const tick = (dialog) => dialog.getByRole('checkbox', { name: 'I have read and accept these terms' });
const toSave = async (dialog) => { await goTo(dialog, 'save'); await dialog.locator('[data-preview-state="ready"]').waitFor({ timeout: 15000 }); };

test('A1: before the tick Save is disabled, says to tick the box, and a click sends nothing', async () => {
  const puts = [];
  const { ui, card, page } = await openCard(mountWizard({ puts }));
  try {
    const dialog = await openWizard(page, card);
    await toSave(dialog);
    assert.equal(await tick(dialog).isChecked(), false, 'unticked by default');
    assert.equal((await saveBtn(dialog).innerText()).trim(), 'Tick the box to accept and save');
    assert.equal(await saveBtn(dialog).isDisabled(), true);
    await saveBtn(dialog).click({ force: true, timeout: 2000 }).catch(() => {});
    assert.equal(puts.length, 0, 'no PUT without the tick');
  } finally { await ui.close(); }
});

test('A2: after the tick the button reads Accept and save, is enabled, and one click sends one PUT', async () => {
  const puts = [];
  const { ui, card, page } = await openCard(mountWizard({ puts }));
  try {
    const dialog = await openWizard(page, card);
    await toSave(dialog);
    await tick(dialog).check();
    assert.equal((await saveBtn(dialog).innerText()).trim(), 'Accept and save');
    assert.equal(await saveBtn(dialog).isEnabled(), true);
    await saveBtn(dialog).click();
    await dialog.waitFor({ state: 'hidden', timeout: 5000 });
    assert.equal(puts.length, 1);
    assert.equal(puts[0].answers.calculated, true);
  } finally { await ui.close(); }
});

test('A3: the full disclaimer is in view at 1280x800 in a warning panel, and the summary lists the total and each kind', async () => {
  const { ui, card, page } = await openCard(mountWizard({}));
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    const dialog = await openWizard(page, card);
    await toSave(dialog);
    const panel = dialog.locator('[data-accept-terms]');
    await panel.waitFor({ timeout: 15000 });
    const norm = (s) => s.replace(/\s+/g, ' ').trim();
    assert.ok(norm(await panel.innerText()).includes(norm(disclaimer.full)), 'the full disclaimer text is in the panel');
    await panel.scrollIntoViewIfNeeded();
    const box = await panel.boundingBox();
    const vp = page.viewportSize();
    assert.ok(box && box.y >= 0 && box.y + box.height <= vp.height && box.x >= 0 && box.x + box.width <= vp.width, `panel inside the viewport: ${JSON.stringify(box)}`);
    assert.ok(await panel.locator('svg[aria-label="Warning"]').count() >= 1, 'warning icon');
    const summary = dialog.locator('[data-accept-summary]');
    const text = norm(await summary.innerText());
    const total = norm(await dialog.locator('[data-save-total] p.text-2xl').innerText()).replace(/\s*\((estimated|calculated)\)/, '');
    assert.ok(text.includes(total), `summary lists the yearly total ${total}: ${text}`);
    for (const label of ['Losses avoided', 'Analyst time saved', 'Customers kept']) assert.ok(text.includes(label), `summary lists ${label}`);
    assert.ok(text.includes('Credit') || /credit/i.test(text), 'summary lists the credit share');
  } finally { await ui.close(); }
});

test('A4: reopening the dialog starts unticked again', async () => {
  const puts = [];
  const { ui, card, page } = await openCard(mountWizard({ puts }));
  try {
    const dialog = await openWizard(page, card);
    await toSave(dialog);
    await tick(dialog).check();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await dialog.waitFor({ state: 'hidden', timeout: 5000 });
    const again = await openWizard(page, card);
    await toSave(again);
    assert.equal(await tick(again).isChecked(), false);
    assert.equal(await saveBtn(again).isDisabled(), true);
    assert.equal(puts.length, 0);
  } finally { await ui.close(); }
});
