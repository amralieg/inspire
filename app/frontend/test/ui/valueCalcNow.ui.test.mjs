// REQ-442 + REQ-497 on the REQ-507 8-step wizard: "Calculate now" saves the current numbers as a Provisional estimate (calculated false) and opens the Save step.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser } from './uiSupport.mjs';
import { PLAN, openCard, openWizard } from './valueWizardSupport.mjs';
import { mountReq507, textOf } from './req507Support.mjs';

test.after(closeBrowser);

const calcNow = (dialog) => dialog.getByRole('button', { name: 'Calculate now', exact: true });
const defaultsOf = (d) => Object.fromEntries(d.asks.filter((a) => a.source === 'estimate').map((a) => [a.id, a.default]));
// Click Next and wait for the page marker to change, so a slow page (the plan, the 12-month count) is never clicked past (goTo507 can skip it).
const markerOf = (dialog) => dialog.locator('[data-wizard-page]').first().getAttribute('data-wizard-page', { timeout: 15000 });
async function goTo507(dialog, target) {
  for (let i = 0; i < 24; i += 1) {
    const now = await markerOf(dialog);
    if (now === target) return;
    await dialog.getByRole('button', { name: 'Next', exact: true }).click();
    await dialog.page().waitForFunction((prev) => {
      const el = document.querySelector('[role=dialog] [data-wizard-page]');
      return el && el.getAttribute('data-wizard-page') !== prev;
    }, now, { timeout: 15000 });
  }
  throw new Error(`wizard never reached ${target}`);
}
const approve = async (dialog) => {
  await goTo507(dialog, 'story:approve');
  await dialog.getByRole('checkbox', { name: 'I have read and accept these terms' }).check();
  await dialog.getByRole('button', { name: 'Approve story and save' }).click();
  await dialog.locator('[data-wizard-page="save"]').waitFor({ timeout: 15000 });
};

test('C1: on the first page where Calculate now is enabled it sends one PUT with calculated false and the plan defaults, then shows the Save step with the total', async () => {
  const puts = [];
  const { ui, card, page } = await openCard(mountReq507({ puts }));
  try {
    const dialog = await openWizard(page, card);
    await goTo507(dialog, 'kinds');
    await calcNow(dialog).waitFor();
    assert.equal(await calcNow(dialog).isEnabled(), true);
    await calcNow(dialog).click();
    await dialog.locator('[data-wizard-page="save"]').waitFor({ timeout: 15000 });
    assert.equal(puts.length, 1);
    assert.equal(puts[0].answers.shape, 2);
    assert.equal(puts[0].answers.calculated, false);
    for (const d of PLAN.drivers.filter((x) => x.on)) assert.deepEqual(puts[0].answers.drivers[d.id].inputs, defaultsOf(d), `${d.id} keeps its default numbers`);
    await dialog.locator('[data-save-total]').filter({ hasText: /\$/ }).waitFor({ timeout: 15000 });
    assert.match(await textOf(dialog.locator('[data-save-total]')), /Provisional estimate/, 'the Save step does not claim it was confirmed');
    assert.equal(await dialog.getByRole('dialog').count() + await page.getByRole('dialog', { name: /^Calculating Value at Stake for / }).count() > 0, true, 'the dialog stays open');
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('C2: on a kind page the number changed so far is the one sent', async () => {
  const puts = [];
  const { ui, card, page } = await openCard(mountReq507({ puts }));
  try {
    const dialog = await openWizard(page, card);
    await goTo507(dialog, 'driver:risk_avoided');
    await dialog.locator('[data-ask="reduction_pct"] input[type=number]').fill('33');
    await calcNow(dialog).click();
    await dialog.locator('[data-wizard-page="save"]').waitFor({ timeout: 15000 });
    assert.equal(puts.length, 1);
    assert.equal(puts[0].answers.calculated, false);
    assert.equal(puts[0].answers.drivers.risk_avoided.inputs.reduction_pct, 33);
  } finally { await ui.close(); }
});

test('C3: the Save step has no Calculate now button, and Approve story and save sends calculated true shown as Reviewed calculation', async () => {
  const puts = [];
  const { ui, card, page } = await openCard(mountReq507({ puts }));
  try {
    const dialog = await openWizard(page, card);
    await goTo507(dialog, 'kinds');
    assert.equal(await calcNow(dialog).count(), 1, 'Calculate now before the Save step');
    await goTo507(dialog, 'story:approve');
    assert.equal(await calcNow(dialog).count(), 1, 'Calculate now on the last page before the Save step');
    await dialog.getByRole('checkbox', { name: 'I have read and accept these terms' }).check();
    await dialog.getByRole('button', { name: 'Approve story and save' }).click();
    await dialog.locator('[data-wizard-page="save"]').waitFor({ timeout: 15000 });
    assert.equal(await calcNow(dialog).count(), 0, 'no Calculate now on the Save step');
    assert.equal(puts.length, 1);
    assert.equal(puts[0].answers.calculated, true);
    assert.match(await textOf(dialog.locator('[data-save-total]')), /Reviewed calculation/);
  } finally { await ui.close(); }
});

test('C4: a PUT answered 500 shows the error and the wizard stays on the same page', async () => {
  const puts = [];
  const { ui, card, page } = await openCard(mountReq507({ puts, putReply: { status: 500, body: { error: 'The value store is down.' } } }));
  try {
    const dialog = await openWizard(page, card);
    await goTo507(dialog, 'kinds');
    await calcNow(dialog).click();
    await dialog.getByRole('alert').filter({ hasText: /down|could not|500/i }).first().waitFor({ timeout: 15000 });
    assert.equal(puts.length, 1);
    assert.equal(await dialog.locator('[data-wizard-page="kinds"]').count(), 1, 'still on the same page');
    assert.equal(await dialog.locator('[data-wizard-page="save"]').count(), 0);
  } finally { await ui.close(); }
});

test('C5: after a confirmed save, Back and Calculate now with no change saves them again with calculated false and the Save step says Provisional estimate', async () => {
  const puts = [];
  const { ui, card, page } = await openCard(mountReq507({ puts }));
  try {
    const dialog = await openWizard(page, card);
    await approve(dialog);
    assert.match(await textOf(dialog.locator('[data-save-total]')), /Reviewed calculation/);
    await dialog.getByRole('button', { name: 'Back', exact: true }).click();
    await dialog.locator('[data-wizard-page="story:approve"]').waitFor({ timeout: 15000 });
    await calcNow(dialog).click();
    await dialog.locator('[data-wizard-page="save"]').waitFor({ timeout: 15000 });
    assert.equal(puts.length, 2);
    assert.equal(puts[0].answers.calculated, true);
    assert.equal(puts[1].answers.calculated, false);
    await dialog.locator('[data-save-total]').filter({ hasText: 'Provisional estimate' }).waitFor({ timeout: 15000 });
  } finally { await ui.close(); }
});

test('C6: on the ramp page Calculate now sends the economics in the PUT', async () => {
  const puts = [];
  const { ui, card, page } = await openCard(mountReq507({ puts }));
  try {
    const dialog = await openWizard(page, card);
    await goTo507(dialog, 'economics:ramp');
    await dialog.getByRole('spinbutton', { name: 'Year 1 share captured (%)' }).fill('25');
    await calcNow(dialog).click();
    await dialog.locator('[data-wizard-page="save"]').waitFor({ timeout: 15000 });
    assert.equal(puts.length, 1);
    assert.equal(puts[0].answers.calculated, false);
    assert.deepEqual(puts[0].answers.economics.ramp_pct, [25, 80, 100]);
  } finally { await ui.close(); }
});

// C7 changed by coordinator decision D-c22-03 (REQ-442, RC6-B-05): Calculate now is enabled on the scope pages; a press before the plan exists waits for it and sends nothing until it arrives.
test('C7: on the scope pages, before a plan exists, Calculate now is enabled, a press shows the waiting state and sends 0 PUTs, and when the plan arrives exactly 1 PUT is sent', async () => {
  for (const name of ['scope:facts', 'scope:choice', 'filter']) {
    const puts = [];
    const mount = (app) => {
      app.post('/api/inspire/value/case-plan', (req, res) => setTimeout(() => res.json({ plan: PLAN }), 2500));
      mountReq507({ puts })(app);
    };
    const { ui, card, page } = await openCard(mount);
    try {
      const dialog = await openWizard(page, card);
      await goTo507(dialog, name);
      assert.equal(await calcNow(dialog).count(), 1, `${name} shows the button`);
      assert.equal(await calcNow(dialog).isEnabled(), true, `${name} enabled`);
      await calcNow(dialog).click();
      assert.equal(await calcNow(dialog).isDisabled(), true, `${name} waiting: the button is held`);
      await dialog.getByText('Calculating...').first().waitFor({ timeout: 2000 });
      assert.equal(puts.length, 0, `${name}: nothing is sent without a plan`);
      await dialog.locator('[data-wizard-page="save"]').waitFor({ timeout: 30000 });
      assert.equal(puts.length, 1, `${name}: one PUT once the plan is in`);
      assert.equal(puts[0].answers.calculated, false);
    } finally { await ui.close(); }
  }
});

test('C7b: when the plan request fails, Calculate now saves nothing, the button is idle again and the failure message is visible', async () => {
  const puts = [];
  const { ui, card, page } = await openCard(mountReq507({ puts, planReply: { status: 500, body: { error: 'The plan service is down.' } } }));
  try {
    const dialog = await openWizard(page, card);
    await dialog.locator('[data-wizard-page="scope:facts"]').waitFor({ timeout: 15000 });
    await calcNow(dialog).click();
    await dialog.getByRole('alert').filter({ hasText: /down|could not|500/i }).first().waitFor({ timeout: 15000 });
    assert.equal(puts.length, 0, 'nothing is saved');
    assert.equal(await calcNow(dialog).isEnabled(), true, 'the button is idle again');
    assert.equal(await dialog.getByText('Calculating...').count(), 0, 'the waiting state is gone');
    assert.equal(await dialog.locator('[data-wizard-page="save"]').count(), 0);
  } finally { await ui.close(); }
});
