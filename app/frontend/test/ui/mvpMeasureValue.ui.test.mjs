// REQ-440: the use case value inside the Build MVP Measure step. One saved value per use case, shared by the card, the run totals and the MVP.
// HTTP-level stubs of GET /api/inspire/value/totals (C6 + measured), GET and PUT /api/inspire/value/answers (C3/C4), case-plan and preview.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, goToStep, openUi, wizardInScreen } from './uiSupport.mjs';
import { PLAN, fakeYearly, goTo } from './valueWizardSupport.mjs';

test.after(closeBrowser);

const OWNER = ['owner', 'example.com'].join('@');
const ME = { me: { userName: OWNER, displayName: 'Owner' } };
const ID = 'N01-U01';

const yearlyOf = ({ amount = 2390000, calculated = true } = {}) => ({ verb: 'REDUCE COST', period: 'Per Year', estimated: !calculated, calculated, currency: 'USD',
  total: { unit: 'USD', amount }, parts: [], groups: { grouping_label: 'By region', covered: 3, of: 3 }, case_noun: 'review case', attribution_pct: 100, version: 3, stale: false });
const answerEntry = (yearly) => ({ version: 3, answers: { shape: 2, currency: 'USD', attribution_pct: 100, drivers: {}, calculated: yearly.calculated }, yearly,
  saved_at: '2026-11-20T10:42:00Z', saved_by: 'sara@example.com', stale: false });
const entry = (status, amount = null) => (status === 'none' || status === 'no_data' ? { status, verb: null, amount: null, currency: null }
  : { status, verb: 'REDUCE COST', amount, currency: 'USD' });
const totalsOf = (e) => ({ run: { totals: [], n: 1, n_calculated: 0, n_estimated: 0, n_none: 0, n_measured: 0, by_verb: [] }, use_cases: { [ID]: e } });

// state: { answers, totals, puts }
function mountWith(state) {
  return (app) => {
    app.get('/api/inspire/value/totals', (_req, res) => res.json(state.totals));
    app.get('/api/inspire/value/answers', (_req, res) => res.json({ answers: state.answers || {} }));
    app.post('/api/inspire/value/case-plan', (_req, res) => res.json({ plan: PLAN }));
    app.post('/api/inspire/value/preview', (req, res) => res.json({ yearly: fakeYearly(req.body) }));
    app.put('/api/inspire/value/answers', (req, res) => {
      state.puts.push(req.body);
      const next = yearlyOf({ amount: 3000000 });
      state.answers = { [ID]: answerEntry(next) };
      state.totals = totalsOf(entry('calculated', 3000000));
      res.json({ version: 4, yearly: next, disclaimer: 'x' });
    });
  };
}

async function openMeasure(state) {
  state.puts = [];
  const ui = await openUi('wizard', ME, '', { mount: mountWith(state) });
  await goToStep(ui.page, 'Measure');
  const panel = ui.page.locator('[data-mvp-value]');
  await panel.waitFor({ timeout: 15000 });
  return { ui, page: ui.page, panel };
}
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ').trim();
const button = (panel, name) => panel.getByRole('button', { name, exact: true });

test('1: a calculated value shows the calculated box and the amount; Keep collapses the panel to the box and sends no PUT', async () => {
  const state = { answers: { [ID]: answerEntry(yearlyOf()) }, totals: totalsOf(entry('calculated', 2390000)) };
  const { ui, page, panel } = await openMeasure(state);
  try {
    const box = panel.locator('[data-value-box]');
    await box.waitFor({ timeout: 15000 });
    assert.equal(await box.getAttribute('data-value-box-state'), 'calculated');
    assert.equal(await text(box.locator('[data-value-amount]')), '$2.39M');
    assert.equal(await button(panel, 'Edit').isVisible(), true);
    await button(panel, 'Keep').click();
    assert.equal(await button(panel, 'Keep').count(), 0, 'Keep is gone once kept');
    assert.equal(await button(panel, 'Edit').count(), 0, 'Edit is gone once kept');
    assert.equal(await box.isVisible(), true, 'the box stays');
    assert.equal(state.puts.length, 0, 'Keep sends no PUT');
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
  assert.ok(page);
});

test('2: Edit opens the wizard over the MVP wizard; a stubbed Save updates the box in place and the MVP wizard stays on Measure', async () => {
  const state = { answers: { [ID]: answerEntry(yearlyOf()) }, totals: totalsOf(entry('calculated', 2390000)) };
  const { ui, page, panel } = await openMeasure(state);
  try {
    await panel.locator('[data-value-box]').waitFor({ timeout: 15000 });
    await button(panel, 'Edit').click();
    const dialog = page.getByRole('dialog', { name: 'Calculate value at stake' });
    await dialog.waitFor();
    await goTo(dialog, 'save');
    await dialog.locator('[data-preview-state="ready"]').waitFor({ timeout: 15000 });
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[data-mvp-value] [data-value-amount]')?.textContent.trim() === '$3M', null, { timeout: 15000 });
    assert.equal(state.puts.length, 1);
    assert.equal(await page.locator('[data-mvp-value]').count(), 1, 'still on the Measure step, no reload');
    assert.equal(await page.locator('[aria-current="step"]').innerText().then((t) => /Measure/i.test(t)), true, 'the MVP wizard is still on Measure');
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('3: no value: Calculate now opens the dialog; Skip sends no request and shows the estimate line', async () => {
  const state = { answers: {}, totals: totalsOf(entry('none')) };
  const { ui, page, panel } = await openMeasure(state);
  try {
    await button(panel, 'Calculate now').waitFor({ timeout: 15000 });
    await button(panel, 'Calculate now').click();
    await page.getByRole('dialog', { name: 'Calculate value at stake' }).waitFor();
    await page.getByRole('dialog', { name: 'Calculate value at stake' }).getByRole('button', { name: /close|cancel/i }).first().click();
    await page.getByRole('dialog', { name: 'Calculate value at stake' }).waitFor({ state: 'detached' });
    const before = state.puts.length;
    const sent = [];
    page.on('request', (r) => { if (r.method() !== 'GET') sent.push(r.url()); });
    await button(panel, "Skip, use Inspire's estimate").click();
    assert.match(await text(panel), /estimate is used/i);
    assert.equal(await button(panel, 'Calculate now').count(), 0);
    assert.deepEqual(sent, [], 'Skip sends no request');
    assert.equal(state.puts.length, before);
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('4: measured: tag MEASURED, label (measured), no Edit button', async () => {
  const state = { answers: {}, totals: totalsOf(entry('measured', 1500000)) };
  const { ui, panel } = await openMeasure(state);
  try {
    const box = panel.locator('[data-value-box]');
    await box.waitFor({ timeout: 15000 });
    assert.equal(await box.getAttribute('data-value-box-state'), 'measured');
    assert.equal(await text(box.locator('[data-value-tag]')), 'MEASURED');
    assert.equal(await text(box.locator('[data-value-qualifier]')), '(measured)');
    assert.equal(await text(box.locator('[data-value-amount]')), '$1.5M');
    assert.equal(await button(panel, 'Edit').count(), 0, 'no Edit button');
    assert.equal(await panel.locator('[data-value-edit]').count(), 0, 'no pencil either');
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('5: no_data: "No data to count" and no buttons', async () => {
  const state = { answers: {}, totals: totalsOf(entry('no_data')) };
  const { ui, panel } = await openMeasure(state);
  try {
    const box = panel.locator('[data-value-box]');
    await box.waitFor({ timeout: 15000 });
    assert.equal(await box.getAttribute('data-value-box-state'), 'no_data');
    assert.match(await text(box), /No data to count/);
    assert.equal(await panel.getByRole('button').count(), 0, 'no buttons');
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('6: the panel fits 1280x800 with no sideways scroll', async () => {
  const state = { answers: { [ID]: answerEntry(yearlyOf()) }, totals: totalsOf(entry('calculated', 2390000)) };
  const { ui, page, panel } = await openMeasure(state);
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await panel.locator('[data-value-box]').waitFor({ timeout: 15000 });
    await wizardInScreen(page, 'Measure value panel 1280x800', 800);
    const over = await page.evaluate(() => {
      const p = document.querySelector('[data-mvp-value]').getBoundingClientRect();
      return { page: document.documentElement.scrollWidth - document.documentElement.clientWidth, right: p.right, width: window.innerWidth };
    });
    assert.ok(over.page <= 0, `no sideways scroll on the page (${over.page})`);
    assert.ok(over.right <= over.width, `the panel's right edge ${over.right} is inside ${over.width}`);
    const inner = await panel.evaluate((el) => el.scrollWidth - el.clientWidth);
    assert.ok(inner <= 0, `no sideways scroll in the panel (${inner})`);
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});
