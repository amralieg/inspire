// REQ-442, REQ-507: "Calculate now" in the value wizard is a preview of the current numbers with no save. It sits on the Each value and Ramp and cost pages;
// the one write is "Approve story and save". (Waits on v507_fix: the button is not in the dialog yet, so these tests stay red until it lands.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser } from './uiSupport.mjs';
import { PLAN, goTo, mountWizard, openCard, openWizard, saveFrom } from './valueWizardSupport.mjs';

test.after(closeBrowser);

const text = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ').trim();
const calcNow = (dialog) => dialog.getByRole('button', { name: 'Calculate now', exact: true });
const defaultsOf = (d) => Object.fromEntries(d.asks.filter((a) => a.source === 'estimate').map((a) => [a.id, a.default]));

test('C1: on an Each value page Calculate now sends one preview with the plan defaults and no PUT, and shows the total', async () => {
  const puts = [];
  const previews = [];
  const { ui, card, page } = await openCard(mountWizard({ puts, previews }));
  try {
    const dialog = await openWizard(page, card);
    await goTo(dialog, 'driver:risk_avoided');
    await dialog.locator('[data-preview-state="ready"]').waitFor({ timeout: 15000 });
    previews.length = 0;
    await calcNow(dialog).click();
    await dialog.locator('[data-preview-state="ready"]').waitFor({ timeout: 15000 });
    assert.equal(puts.length, 0, 'a preview is not a save');
    assert.equal(previews.length, 1);
    for (const d of PLAN.drivers) assert.deepEqual(previews[0].answers.drivers[d.id].inputs, defaultsOf(d), `${d.id} keeps its default numbers`);
    assert.match(await text(dialog.locator('[data-run-total]')), /\$/);
    assert.equal(await dialog.locator('[data-wizard-page="driver:risk_avoided"]').count(), 1, 'still on the same page');
  } finally { await ui.close(); }
});

test('C2: on an Each value page the number changed so far is the one previewed, with no PUT', async () => {
  const puts = [];
  const previews = [];
  const { ui, card, page } = await openCard(mountWizard({ puts, previews }));
  try {
    const dialog = await openWizard(page, card);
    await goTo(dialog, 'driver:risk_avoided');
    await dialog.locator('[data-ask="reduction_pct"] input[type=number]').fill('33');
    await calcNow(dialog).click();
    await dialog.locator('[data-preview-state="ready"]').waitFor({ timeout: 15000 });
    assert.equal(puts.length, 0);
    assert.equal(previews.at(-1).answers.drivers.risk_avoided.inputs.reduction_pct, 33);
  } finally { await ui.close(); }
});

test('C3: Calculate now is on the Each value and Ramp and cost pages, not on the Save page; Approve story and save there sends calculated true', async () => {
  const puts = [];
  const { ui, card, page } = await openCard(mountWizard({ puts }));
  try {
    const dialog = await openWizard(page, card);
    await goTo(dialog, 'driver:risk_avoided');
    assert.equal(await calcNow(dialog).count(), 1, 'on Each value');
    await goTo(dialog, 'economics:ramp');
    assert.equal(await calcNow(dialog).count(), 1, 'on Ramp');
    await goTo(dialog, 'economics:cost');
    assert.equal(await calcNow(dialog).count(), 1, 'on Cost');
    await goTo(dialog, 'story:approve');
    await saveFrom(dialog);
    assert.equal(await calcNow(dialog).count(), 0, 'not on the Save page');
    assert.equal(puts.length, 1);
    assert.equal(puts[0].answers.calculated, true);
  } finally { await ui.close(); }
});

test('C4: a PUT answered 500 on Approve story and save shows the error and the wizard stays on the same page', async () => {
  const puts = [];
  const { ui, card, page } = await openCard(mountWizard({ puts, putReply: { status: 500, body: { error: 'The value store is down.' } } }));
  try {
    const dialog = await openWizard(page, card);
    await goTo(dialog, 'story:approve');
    await dialog.getByLabel('I have read and accept these terms').check();
    await dialog.getByRole('button', { name: 'Approve story and save' }).click();
    await dialog.getByRole('alert').filter({ hasText: /down|could not|500/i }).first().waitFor({ timeout: 15000 });
    assert.equal(puts.length, 1);
    assert.equal(await dialog.locator('[data-wizard-page="story:approve"]').count(), 1, 'still on the approval page');
    assert.equal(await dialog.locator('[data-wizard-page="save"]').count(), 0);
  } finally { await ui.close(); }
});

test('C5: after the value is saved, reopening and Calculate now with no change previews it and writes nothing more', async () => {
  const puts = [];
  const previews = [];
  const { ui, card, page } = await openCard(mountWizard({ puts, previews }));
  try {
    const dialog = await openWizard(page, card);
    await goTo(dialog, 'story:approve');
    await saveFrom(dialog);
    await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
    await dialog.waitFor({ state: 'hidden', timeout: 5000 });
    await card.getByRole('button', { name: 'Edit value' }).click();
    const again = page.getByRole('dialog', { name: /^Calculating Value at Stake for / });
    await goTo(again, 'driver:risk_avoided');
    await again.locator('[data-preview-state="ready"]').waitFor({ timeout: 15000 });
    previews.length = 0;
    await calcNow(again).click();
    await again.locator('[data-preview-state="ready"]').waitFor({ timeout: 15000 });
    assert.equal(previews.length, 1);
    assert.equal(puts.length, 1, 'only the first save wrote');
  } finally { await ui.close(); }
});
