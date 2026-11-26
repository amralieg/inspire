// C24 ROI (Amr P247): "tune values from the data processed; Settings option, default ticked; ROI box next to the Inspire value".
// (a) the Settings option is ticked by default and an untick persists; (b) a use case with a value shows an ROI (3 yr) box next to the value box;
// (c) no value, no ROI box; (d) the option changes the computed value of a plan that has data counts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { closeBrowser, openUi } from './uiSupport.mjs';
import { mountWizard, openCard } from './valueWizardSupport.mjs';
import { projectionOf } from './req507Support.mjs';

const VCP = createRequire(import.meta.url)('../../../backend/lib/valueCasePlan.js');

test.after(closeBrowser);

const LABEL = 'Tune values from the data Inspire processed';
const settingsMount = (app) => {
  app.get('/api/defaults', (_req, res) => res.json({ envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: 'https://workspace.example.com', warehouseId: 'wh1',
    inspireDatabase: 'main.inspire', notebookPath: '/Shared/inspire_ai' }));
  app.get('/api/warehouses', (_req, res) => res.json({ warehouses: [] }));
};

test('C24 (a): Settings shows the option ticked by default, and an untick persists', async () => {
  const ui = await openUi('settings', {}, '', { mount: settingsMount });
  try {
    const box = ui.page.getByRole('checkbox', { name: LABEL });
    await box.waitFor({ timeout: 15000 });
    assert.equal(await box.isChecked(), true, 'ticked by default');
    await box.uncheck();
    assert.equal(await box.isChecked(), false);
    await ui.page.reload();
    const again = ui.page.getByRole('checkbox', { name: LABEL });
    await again.waitFor({ timeout: 15000 });
    assert.equal(await again.isChecked(), false, 'the untick survives a reload');
    await again.check();
    await ui.page.reload();
    const third = ui.page.getByRole('checkbox', { name: LABEL });
    await third.waitFor({ timeout: 15000 });
    assert.equal(await third.isChecked(), true);
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

const yearly = (roi) => ({ verb: 'REDUCE COST', period: 'Per Year', estimated: false, calculated: true, currency: 'USD', total: { unit: 'USD', amount: 2390000 }, parts: [],
  groups: { grouping_label: 'By region', covered: 3, of: 3 }, case_noun: 'review case', attribution_pct: 100, version: 3,
  projection: { ...projectionOf(2390000, { build_cost: 100000, run_cost_per_year: 50000 }), roi_3y: roi } });
const entry = (y) => ({ version: 3, answers: { shape: 2, currency: 'USD', attribution_pct: 100, drivers: {}, calculated: true }, yearly: y, saved_at: '2026-11-20T10:42:00Z', saved_by: 'sara@example.com', stale: false });

test('C24 (b): a use case with a computed value shows the ROI (3 yr) box beside the value box, with the roi_3y percent and the disclaimer', async () => {
  const { ui, card } = await openCard(mountWizard({ saved: entry(yearly(11.5)) }));
  try {
    const value = card.locator('[data-value-box]');
    await value.waitFor({ timeout: 15000 });
    const roi = card.locator('[data-roi-box]');
    await roi.waitFor({ timeout: 15000 });
    assert.match((await roi.innerText()).replace(/\s+/g, ' '), /ROI \(3 yr\)/i);
    assert.equal((await roi.locator('[data-roi-amount]').innerText()).trim(), '1,150%');
    const a = await value.boundingBox();
    const b = await roi.boundingBox();
    assert.ok(Math.abs(a.width - b.width) <= 1 && Math.abs(a.height - b.height) <= 1, `same size: ${a.width}x${a.height} vs ${b.width}x${b.height}`);
    assert.ok(Math.abs(a.y - b.y) <= 1, 'same row');
    assert.ok(b.x > a.x, 'beside the value box');
    assert.ok((await roi.getAttribute('title')) && (await roi.getAttribute('title')) === (await value.getAttribute('title')), 'the ROI carries the value disclaimer');
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('C24 (c): no value, or a projection with no ROI (gross only), shows no ROI box', async () => {
  const none = await openCard(mountWizard({}));
  try {
    await none.card.locator('[data-value-calculate]').waitFor({ timeout: 15000 });
    assert.equal(await none.card.locator('[data-roi-box]').count(), 0);
  } finally { await none.ui.close(); }
  const gross = await openCard(mountWizard({ saved: entry(yearly(null)) }));
  try {
    await gross.card.locator('[data-value-box][data-value-yearly]').waitFor({ timeout: 15000 });
    assert.equal(await gross.card.locator('[data-roi-box]').count(), 0);
  } finally { await gross.ui.close(); }
});

test('C24 (d): the option changes the computed value for a plan with data counts; ticked is the default', () => {
  const plan = { case_noun: 'case', table: 't', date_column: 'd', days: 365, groupings: [], grouping: '', metrics: [{ id: 'amt', label: 'Amount', column: 'amount', agg: 'avg' }],
    groups: [{ g: 'A', records_per_year: 50000, metrics: { amt: 700 } }, { g: 'B', records_per_year: 30000, metrics: { amt: 500 } }],
    drivers: [{ id: 'risk_avoided', label: 'Losses avoided', verb: 'AVOID RISK', on: true, why: '', asks: [
      { id: 'incidents_per_year', label: 'Cases a year', kind: 'count', source: 'data', metric: 'records' },
      { id: 'cost_per_incident', label: 'Money at risk', kind: 'money', source: 'data', metric: 'amt' },
      { id: 'reduction_pct', label: 'Share stopped', kind: 'pct', source: 'estimate', default: 30 }] }] };
  const total = (answers) => VCP.yearlyOf(plan, { currency: 'USD', ...answers }).yearly;
  const dflt = total({});
  const on = total({ tune_from_data: true });
  const off = total({ tune_from_data: false });
  assert.equal(dflt.total.amount, on.total.amount, 'ticked is the default');
  assert.notEqual(off.total.amount, on.total.amount, 'unticked prices the estimates, not the counted data');
  assert.equal(on.tuned_from_data, true);
  assert.equal(off.tuned_from_data, false);
  const per = (y, id) => y.parts[0].inputs.find((i) => i.id === id).value;
  assert.equal(per(on, 'incidents_per_year'), 80000, 'the counted records drive the volume');
  assert.notEqual(per(off, 'incidents_per_year'), 80000);
});
