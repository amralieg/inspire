// c33 integration acceptance (REQ-577, REQ-578, REQ-579): the three lanes together, run by the coordinator after merging A, B and C.
// Find path: Start, Business, Data (find, one catalog), Plan, Goals, Settings, Review and start -> one POST plan/start, no direct launch.
// Match path: Start, Your use cases, Data, Review and start -> one POST match/start, no direct launch. Red on every lane alone by design.
// Written by the c33 planner; no lane edits this file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi, until } from './uiSupport.mjs';
import { ROUTES, WIZ_TITLE, WIZ_TITLE_MATCH } from '../../src/lib/startWizard.js';
import { PLAN } from './c33WizFixtures.mjs';

test.after(closeBrowser);

const BUSINESS = 'e.g. Contoso, Acme Corp, Retail Division';
const EMPTY = { sessions: [], portfolioRuns: [{ runs: '0', businesses: '0' }], portfolioUseCases: [], portfolioMvps: [] };
const errors = (ui) => ui.pageErrors.filter((line) => !/status of 40[13]/.test(line));
const next = (dialog) => dialog.getByRole('button', { name: 'Next', exact: true });
const nextWhenReady = async (dialog, what) => {
  await until(async () => !(await next(dialog).isDisabled()), `${what} is ready`, 20000);
  await next(dialog).click();
};

function mounts() {
  const planStarts = [];
  const matchStarts = [];
  const mount = (app) => {
    app.post(ROUTES.planSort, (_req, res) => res.json(PLAN));
    app.post(ROUTES.planStart, (req, res) => {
      planStarts.push(req.body);
      res.json({ plan_id: 'p1', runs: PLAN.runs.map((r, i) => ({ run_no: r.run_no, name: `Example Co: ${r.name}`, session_id: i ? null : '9101', run_id: i ? null : 99, status: i ? 'waiting' : 'running' })) });
    });
    app.post(ROUTES.planAdvance, (_req, res) => res.json({ started: [] }));
    app.post(ROUTES.matchStart, (req, res) => { matchStarts.push(req.body); res.json({ session_id: '7001', run_id: 88 }); });
  };
  return { planStarts, matchStarts, mount };
}

test('REQ-577: the find path sorts the data into a plan and starts it through plan/start (integration)', async () => {
  const m = mounts();
  const ui = await openUi('choose', EMPTY, '', { mount: m.mount });
  const { page, made } = ui;
  try {
    await page.locator('[data-start-new]').first().click();
    const dialog = page.getByRole('dialog', { name: WIZ_TITLE });
    await dialog.locator('[data-wiz-path="discover"]').click();
    await next(dialog).click();
    await dialog.locator('[data-wiz-step="business"]').getByPlaceholder(BUSINESS).fill('Example Co');
    await next(dialog).click();
    await dialog.locator('[data-wiz-step="find"]').getByRole('checkbox', { name: 'main', exact: true }).check();
    await nextWhenReady(dialog, 'Data');
    await dialog.locator('[data-wiz-step="plan"]').getByText('Your plan: 3 runs').waitFor({ timeout: 15000 });
    await nextWhenReady(dialog, 'Plan');
    await nextWhenReady(dialog, 'Goals');
    await nextWhenReady(dialog, 'Settings');
    await dialog.locator('[data-wiz-step="review"]').waitFor();
    assert.match(await dialog.locator('[data-wiz-step="review"]').innerText(), /3 runs/, 'the review shows the plan');
    await dialog.locator('[data-wiz-start]').click();
    await until(() => m.planStarts.length === 1, 'one plan/start', 20000);
    const body = m.planStarts[0];
    assert.equal(body.business_name, 'Example Co');
    assert.deepEqual(body.plan.runs.map((r) => r.name), PLAN.runs.map((r) => r.name));
    assert.equal(body.params['15_operation'], 'Discover Use Cases');
    await until(async () => (await page.locator('output[aria-label="Launched"]').innerText()) === '9101:99', 'the Start page hears run 1');
    assert.equal(made.launches.length, 0, 'no direct POST /api/run: the plan route launches run 1');
    assert.deepEqual(errors(ui), []);
  } finally { await ui.close(); }
});

test('REQ-578 / REQ-579: the match path takes the use cases and data and starts a Match run through match/start (integration)', async () => {
  const m = mounts();
  const ui = await openUi('choose', EMPTY, '', { mount: m.mount });
  const { page, made } = ui;
  try {
    await page.locator('[data-start-new]').first().click();
    await page.getByRole('dialog', { name: WIZ_TITLE }).locator('[data-wiz-path="match"]').click();
    const dialog = page.getByRole('dialog', { name: WIZ_TITLE_MATCH });
    await next(dialog).click();
    const usecases = dialog.locator('[data-wiz-step="usecases"]');
    await usecases.getByPlaceholder(BUSINESS).fill('Example Co');
    await usecases.getByRole('textbox', { name: 'Your use cases' }).fill('Forecast weekly demand: Predict units per store and week\nReduce customer churn');
    await nextWhenReady(dialog, 'Your use cases');
    await dialog.locator('[data-wiz-step="data"]').locator('button[title="main"]').click();
    await nextWhenReady(dialog, 'Data');
    const review = dialog.locator('[data-wiz-step="matchReview"]');
    await review.waitFor();
    assert.match(await review.innerText(), /2 use cases/);
    await dialog.locator('[data-wiz-start]').click();
    await until(() => m.matchStarts.length === 1, 'one match/start', 20000);
    assert.deepEqual(m.matchStarts[0].use_cases.map((u) => [u.input_no, u.name]), [[1, 'Forecast weekly demand'], [2, 'Reduce customer churn']]);
    assert.match(String(m.matchStarts[0].params['01_uc_metadata']), /^main/);
    await until(async () => (await page.locator('output[aria-label="Launched"]').innerText()) === '7001:88', 'the Start page hears the Match run');
    assert.equal(made.launches.length, 0, 'no direct POST /api/run: the match route launches');
    assert.deepEqual(errors(ui), []);
  } finally { await ui.close(); }
});
