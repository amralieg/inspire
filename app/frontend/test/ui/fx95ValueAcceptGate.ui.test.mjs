// REQ-496 (FX-95) on the REQ-507 8-step wizard: confirming the value needs the explicit accept (the tick, then "Accept and save"),
// the full disclaimer is in view beside it, and a value saved without the accept (Calculate now) is a Provisional estimate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser } from './uiSupport.mjs';
import { goTo, mountWizard, openCard, openWizard, saveFrom } from './valueWizardSupport.mjs';
import { goTo507, mountReq507, textOf } from './req507Support.mjs';
import disclaimer from '../../../backend/lib/valueDisclaimer.json' with { type: 'json' };

test.after(closeBrowser);

const approveBtn = (dialog) => dialog.getByRole('button', { name: 'Accept and save' });
const tick = (dialog) => dialog.getByRole('checkbox', { name: 'I have read and accept these terms' });
const toApprove = async (dialog) => { await goTo507(dialog, 'terms'); await dialog.locator('[data-accept-terms]').waitFor({ timeout: 15000 }); };

test('A1: before the tick Accept and save is disabled and a click sends nothing', async () => {
  const puts = [];
  const { ui, card, page } = await openCard(mountReq507({ puts }));
  try {
    const dialog = await openWizard(page, card);
    await toApprove(dialog);
    assert.equal(await tick(dialog).isChecked(), false, 'unticked by default');
    assert.equal(await approveBtn(dialog).isDisabled(), true);
    await approveBtn(dialog).click({ force: true, timeout: 2000 }).catch(() => {});
    assert.equal(puts.length, 0, 'no PUT without the tick');
  } finally { await ui.close(); }
});

test('A2: after the tick the button is enabled, one click sends one PUT with calculated true, and the Save step says Reviewed calculation', async () => {
  const puts = [];
  const { ui, card, page } = await openCard(mountReq507({ puts }));
  try {
    const dialog = await openWizard(page, card);
    await toApprove(dialog);
    await tick(dialog).check();
    assert.equal(await approveBtn(dialog).isEnabled(), true);
    await approveBtn(dialog).click();
    await dialog.locator('[data-wizard-page="save"]').waitFor({ timeout: 15000 });
    assert.equal(puts.length, 1);
    assert.equal(puts[0].answers.calculated, true);
    assert.match(await textOf(dialog.locator('[data-save-total]')), /Reviewed calculation/);
  } finally { await ui.close(); }
});

test('A3: the full disclaimer is in view at 1280x800 in the accept panel, and the Save step summary lists the total and each kind', async () => {
  const { ui, card, page } = await openCard(mountReq507({}));
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    const dialog = await openWizard(page, card);
    await toApprove(dialog);
    const panel = dialog.locator('[data-accept-terms]');
    const norm = (s) => s.replace(/\s+/g, ' ').trim();
    assert.ok(norm(await panel.innerText()).includes(norm(disclaimer.full)), 'the full disclaimer text is in the panel');
    await panel.scrollIntoViewIfNeeded();
    const box = await panel.boundingBox();
    const vp = page.viewportSize();
    assert.ok(box && box.y >= 0 && box.y + box.height <= vp.height && box.x >= 0 && box.x + box.width <= vp.width, `panel inside the viewport: ${JSON.stringify(box)}`);
    await tick(dialog).check();
    await approveBtn(dialog).click();
    await dialog.locator('[data-wizard-page="save"]').waitFor({ timeout: 15000 });
    const text = norm(await dialog.locator('[data-accept-summary]').innerText());
    const total = norm(await dialog.locator('[data-save-total] p.text-2xl').innerText());
    assert.ok(text.includes(total), `summary lists the yearly total ${total}: ${text}`);
    for (const label of ['Losses avoided', 'Analyst time saved', 'Customers kept']) assert.ok(text.includes(label), `summary lists ${label}`);
    assert.match(text, /Share caused by this use case/);
  } finally { await ui.close(); }
});

test('A4: reopening the dialog starts unticked again', async () => {
  const puts = [];
  const { ui, card, page } = await openCard(mountReq507({ puts }));
  try {
    const dialog = await openWizard(page, card);
    await toApprove(dialog);
    await tick(dialog).check();
    await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
    await dialog.waitFor({ state: 'hidden', timeout: 5000 });
    const again = await openWizard(page, card);
    await toApprove(again);
    assert.equal(await tick(again).isChecked(), false);
    assert.equal(await approveBtn(again).isDisabled(), true);
    assert.equal(puts.length, 0);
  } finally { await ui.close(); }
});

test('A5: a value saved without the accept (Calculate now) is a Provisional estimate, never a Reviewed calculation', async () => {
  const puts = [];
  const { ui, card, page } = await openCard(mountReq507({ puts }));
  try {
    const dialog = await openWizard(page, card);
    await toApprove(dialog);
    assert.equal(await tick(dialog).isChecked(), false);
    await dialog.getByRole('button', { name: 'Back', exact: true }).click(); // REQ-544: Calculate now lives on steps 1-4
    await dialog.getByRole('button', { name: 'Calculate now', exact: true }).click();
    await dialog.locator('[data-wizard-page="save"]').waitFor({ timeout: 15000 });
    assert.equal(puts.length, 1);
    assert.equal(puts[0].answers.calculated, false);
    const total = await textOf(dialog.locator('[data-save-total]'));
    assert.match(total, /Provisional estimate/);
    assert.doesNotMatch(total, /Reviewed calculation/);
  } finally { await ui.close(); }
});

// A6: v507_tw's A3, restored (the merge kept v507_cn's A3): the warning icon in the approval panel, and the Save step summary lists the total and each kind.
test('A6: the full disclaimer is in view on the approval step at 1280x800 in a warning panel, and the Save step summary lists the total and each kind', async () => {
  const { ui, card, page } = await openCard(mountWizard({}));
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    const dialog = await openWizard(page, card);
    await goTo(dialog, 'terms');
    await dialog.locator('[data-preview-state="ready"]').waitFor({ timeout: 15000 });
    const panel = dialog.locator('[data-accept-terms]');
    await panel.waitFor({ timeout: 15000 });
    const norm = (s) => s.replace(/\s+/g, ' ').trim();
    assert.ok(norm(await panel.innerText()).includes(norm(disclaimer.full)), 'the full disclaimer text is in the panel');
    await panel.scrollIntoViewIfNeeded();
    const box = await panel.boundingBox();
    const vp = page.viewportSize();
    assert.ok(box && box.y >= 0 && box.y + box.height <= vp.height && box.x >= 0 && box.x + box.width <= vp.width, `panel inside the viewport: ${JSON.stringify(box)}`);
    assert.ok(await panel.locator('svg[aria-label="Warning"]').count() >= 1, 'warning icon');
    await saveFrom(dialog);
    const summary = dialog.locator('[data-accept-summary]');
    const text = norm(await summary.innerText());
    const total = norm(await dialog.locator('[data-save-total] p.text-2xl').innerText()).replace(/\s*\((estimated|calculated)\)/, '');
    assert.ok(text.includes(total), `summary lists the yearly total ${total}: ${text}`);
    for (const label of ['Losses avoided', 'Analyst time saved', 'Customers kept']) assert.ok(text.includes(label), `summary lists ${label}`);
    assert.ok(text.includes('Share caused by this use case'), 'summary lists the share caused by this use case');
  } finally { await ui.close(); }
});
