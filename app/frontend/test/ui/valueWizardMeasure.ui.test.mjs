// REQ-457: the MVP's measure settings live in the Calculate value wizard ("How the MVP measures it", Keep or Edit); the panel shows the number and Edit.
// Mounts MvpValuePanel through the harness (open=valuePanel) with HTTP-level stubs of totals, answers, case-plan, preview and a recording PUT.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi, totalsQueryMissing } from './uiSupport.mjs';
import { PLAN, fakeYearly, goTo } from './valueWizardSupport.mjs';

test.after(closeBrowser);

const OWNER = ['owner', 'example.com'].join('@');
const ME = { me: { userName: OWNER, displayName: 'Owner' } };
const ID = 'N01-U01';
const MONEY = { rule: 'gains', sign: { column: 'delta' }, currency: 'per_currency', value: { method: 'column', column: 'amount', currency: 'USD' } };

const yearlyOf = (amount = 2390000) => ({ verb: 'REDUCE COST', period: 'Per Year', estimated: false, calculated: true, currency: 'USD', total: { unit: 'USD', amount }, parts: [],
  groups: { grouping_label: 'By region', covered: 3, of: 3 }, case_noun: 'review case', attribution_pct: 100, version: 3, stale: false });
const answerEntry = () => ({ version: 3, answers: { shape: 2, currency: 'USD', attribution_pct: 100, drivers: {}, calculated: true, money: MONEY }, yearly: yearlyOf(),
  saved_at: '2026-11-20T10:42:00Z', saved_by: 'sara@example.com', stale: false });
const entry = (status, amount = null) => (status === 'none' ? { status, verb: null, amount: null, currency: null } : { status, verb: 'REDUCE COST', amount, currency: 'USD' });
const totalsOf = (e) => ({ run: { totals: [], n: 1, n_calculated: 0, n_estimated: 0, n_none: 0, n_measured: 0, by_verb: [] }, use_cases: { [ID]: e } });

function mountWith(state) {
  return (app) => {
    app.get('/api/inspire/value/totals', (req, res) => totalsQueryMissing(req, res) || res.json(state.totals));
    app.get('/api/inspire/value/answers', (_req, res) => res.json({ answers: state.answers || {} }));
    app.post('/api/inspire/value/case-plan', (_req, res) => res.json({ plan: PLAN }));
    app.post('/api/inspire/value/preview', (req, res) => res.json({ yearly: fakeYearly(req.body) }));
    app.put('/api/inspire/value/answers', (req, res) => { state.puts.push(req.body); res.json({ version: 4, yearly: yearlyOf(3000000), disclaimer: 'x' }); });
  };
}
const calculated = () => ({ answers: { [ID]: answerEntry() }, totals: totalsOf(entry('calculated', 2390000)), puts: [] });

async function openPanel(state, query = '') {
  const ui = await openUi('valuePanel', ME, query, { mount: mountWith(state) });
  const panel = ui.page.locator('[data-mvp-value]');
  await panel.waitFor({ timeout: 15000 });
  return { ui, page: ui.page, panel, dialog: ui.page.getByRole('dialog', { name: /^Calculating Value at Stake for / }) };
}
const button = (loc, name) => loc.getByRole('button', { name, exact: true });
const holdoutOn = (page) => page.evaluate(() => window.__measureSpec.holdout.enabled);

test('1: no value: Calculate value opens the dialog; no Skip, no Keep', async () => {
  const { ui, panel, dialog } = await openPanel({ answers: {}, totals: totalsOf(entry('none')), puts: [] });
  try {
    const calc = panel.locator('[data-value-calculate]');
    await calc.waitFor({ timeout: 15000 });
    assert.match(await calc.innerText(), /Calculate value/);
    assert.equal(await button(panel, "Skip, use Inspire's estimate").count(), 0);
    assert.equal(await button(panel, 'Keep').count(), 0);
    assert.equal(await button(panel, 'Calculate now').count(), 0);
    await calc.click();
    await dialog.waitFor();
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('2: a calculated value shows the amount, Edit and the pencil; Edit opens the dialog with 5 measure rows, Keep checked, no editor', async () => {
  const { ui, panel, dialog } = await openPanel(calculated());
  try {
    await panel.locator('[data-value-box]').waitFor({ timeout: 15000 });
    assert.equal((await panel.locator('[data-value-amount]').innerText()).trim(), '$2.39M');
    assert.equal(await button(panel, 'Edit').isVisible(), true);
    assert.equal(await panel.locator('[data-value-edit]').count(), 1);
    await button(panel, 'Edit').click();
    await dialog.waitFor();
    await goTo(dialog, 'data');
    const section = dialog.locator('[data-measure-settings]');
    await section.waitFor();
    assert.equal(await section.locator('[data-measure-row]').count(), 5);
    assert.equal(await section.locator('[data-measure-keep]').getAttribute('aria-checked'), 'true');
    assert.equal(await dialog.locator('[data-measure-editor]').count(), 0);
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('3: Edit shows the editor and changes the spec; Keep restores the opening value and Edit stays available', async () => {
  const { ui, page, panel, dialog } = await openPanel(calculated());
  try {
    await button(panel, 'Edit').click();
    await goTo(dialog, 'data');
    await dialog.locator('[data-measure-edit]').click();
    const editor = dialog.locator('[data-measure-editor]');
    await editor.waitFor();
    assert.equal(await holdoutOn(page), false);
    await editor.getByLabel('Hold back').check();
    assert.equal(await holdoutOn(page), true);
    await dialog.locator('[data-measure-keep]').click();
    assert.equal(await holdoutOn(page), false, 'Keep restores the opening value');
    assert.equal(await dialog.locator('[data-measure-editor]').count(), 0);
    assert.equal(await dialog.locator('[data-measure-edit]').isEnabled(), true);
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('4: Save sends one PUT with the toggled holdout and the panel money', async () => {
  const state = calculated();
  const { ui, panel, dialog } = await openPanel(state);
  try {
    await button(panel, 'Edit').click();
    await goTo(dialog, 'data');
    await dialog.locator('[data-measure-edit]').click();
    await dialog.locator('[data-measure-editor]').getByLabel('Hold back').check();
    await goTo(dialog, 'save');
    await dialog.locator('[data-preview-state="ready"]').waitFor({ timeout: 15000 });
    await button(dialog, 'Save').click();
    await dialog.waitFor({ state: 'detached' });
    assert.equal(state.puts.length, 1);
    assert.equal(state.puts[0].answers.holdout.enabled, true);
    assert.deepEqual(state.puts[0].answers.money, MONEY);
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('5: without a measure prop the dialog shows no measure section and Save carries the saved money through', async () => {
  const state = calculated();
  const { ui, panel, dialog } = await openPanel(state, '&step=nomeasure');
  try {
    await button(panel, 'Edit').click();
    await dialog.waitFor();
    assert.equal(await dialog.locator('[data-measure-settings]').count(), 0);
    await goTo(dialog, 'save');
    await dialog.locator('[data-preview-state="ready"]').waitFor({ timeout: 15000 });
    await button(dialog, 'Save').click();
    await dialog.waitFor({ state: 'detached' });
    assert.equal(state.puts.length, 1);
    assert.deepEqual(state.puts[0].answers.money, MONEY);
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('6: measured: no Edit button; the measure settings sit inline in the panel', async () => {
  const { ui, panel } = await openPanel({ answers: {}, totals: totalsOf(entry('measured', 1500000)), puts: [] });
  try {
    await panel.locator('[data-value-box]').waitFor({ timeout: 15000 });
    assert.equal(await button(panel, 'Edit').count(), 0);
    assert.equal(await panel.locator('[data-value-edit]').count(), 0);
    assert.equal(await panel.locator('[data-measure-settings]').count(), 1);
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('7: measure.open "holdout" opens the dialog on mount with the section in Edit', async () => {
  const { ui, dialog } = await openPanel(calculated(), '&step=open-holdout');
  try {
    await dialog.waitFor({ timeout: 15000 });
    await goTo(dialog, 'data');
    await dialog.locator('[data-measure-editor]').waitFor();
    assert.equal(await dialog.locator('[data-measure-edit]').getAttribute('aria-checked'), 'true');
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});
