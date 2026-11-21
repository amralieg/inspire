// REQ-442: "Calculate now" in the value wizard saves the current numbers as estimated (calculated false) and jumps to the Save step.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser } from './uiSupport.mjs';
import { PLAN, goTo, mountWizard, openCard, openWizard } from './valueWizardSupport.mjs';

test.after(closeBrowser);

const text = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ').trim();
const calcNow = (dialog) => dialog.getByRole('button', { name: 'Calculate now', exact: true });
const defaultsOf = (d) => Object.fromEntries(d.asks.filter((a) => a.source === 'estimate').map((a) => [a.id, a.default]));

test('C1: on the first page Calculate now sends one PUT with calculated false and the plan defaults, then shows the Save step with the total', async () => {
  const puts = [];
  const { ui, card, page } = await openCard(mountWizard({ puts }));
  try {
    const dialog = await openWizard(page, card);
    await dialog.locator('[data-wizard-page="data"]').waitFor({ timeout: 15000 });
    await calcNow(dialog).click();
    await dialog.locator('[data-wizard-page="save"]').waitFor({ timeout: 15000 });
    assert.equal(puts.length, 1);
    assert.equal(puts[0].answers.shape, 2);
    assert.equal(puts[0].answers.calculated, false);
    for (const d of PLAN.drivers) assert.deepEqual(puts[0].answers.drivers[d.id].inputs, defaultsOf(d), `${d.id} keeps its default numbers`);
    assert.match(await text(dialog.locator('[data-save-total]')), /\$/);
    assert.match(await text(dialog.locator('[data-save-total]')), /\(estimated\)/, 'the save page does not claim it was confirmed');
  } finally { await ui.close(); }
});

test('C2: on a kind page the number changed so far is the one sent', async () => {
  const puts = [];
  const { ui, card, page } = await openCard(mountWizard({ puts }));
  try {
    const dialog = await openWizard(page, card);
    await goTo(dialog, 'driver:risk_avoided');
    await dialog.locator('[data-ask="reduction_pct"] input[type=number]').fill('33');
    await calcNow(dialog).click();
    await dialog.locator('[data-wizard-page="save"]').waitFor({ timeout: 15000 });
    assert.equal(puts.length, 1);
    assert.equal(puts[0].answers.calculated, false);
    assert.equal(puts[0].answers.drivers.risk_avoided.inputs.reduction_pct, 33);
  } finally { await ui.close(); }
});

test('C3: the Save page has no Calculate now button, and Save there sends calculated true', async () => {
  const puts = [];
  const { ui, card, page } = await openCard(mountWizard({ puts }));
  try {
    const dialog = await openWizard(page, card);
    await dialog.locator('[data-wizard-page="data"]').waitFor({ timeout: 15000 });
    assert.equal(await calcNow(dialog).count(), 1);
    await goTo(dialog, 'save');
    assert.equal(await calcNow(dialog).count(), 0);
    await dialog.locator('[data-preview-state="ready"]').waitFor({ timeout: 15000 });
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await dialog.locator('[data-save-total]').getByText('(calculated)').waitFor({ timeout: 15000 });
    assert.equal(puts.length, 1);
    assert.equal(puts[0].answers.calculated, true);
  } finally { await ui.close(); }
});

test('C4: a PUT answered 500 shows the error and the wizard stays on the same page', async () => {
  const puts = [];
  const { ui, card, page } = await openCard(mountWizard({ puts, putReply: { status: 500, body: { error: 'The value store is down.' } } }));
  try {
    const dialog = await openWizard(page, card);
    await dialog.locator('[data-wizard-page="data"]').waitFor({ timeout: 15000 });
    await calcNow(dialog).click();
    await dialog.getByRole('alert').filter({ hasText: /down|could not|500/i }).first().waitFor({ timeout: 15000 });
    assert.equal(puts.length, 1);
    assert.equal(await dialog.locator('[data-wizard-page="data"]').count(), 1, 'still on the first page');
    assert.equal(await dialog.locator('[data-wizard-page="save"]').count(), 0);
  } finally { await ui.close(); }
});
